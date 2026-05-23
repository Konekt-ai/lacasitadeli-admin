'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { cn } from './lib/utils';
import { Icon } from './components/Icon';
import { Notification } from './components/Notification';
import type { Product, Category } from './lib/types';

// ── Lazy-load tabs ─────────────────────────────────────────────────────────────
const DashboardTab  = dynamic(() => import('./tabs/DashboardTab'),  { ssr: false });
const InventarioTab = dynamic(() => import('./tabs/InventarioTab'), { ssr: false });
const VentasTab     = dynamic(() => import('./tabs/VentasTab'),     { ssr: false });
const ReportesTab   = dynamic(() => import('./tabs/ReportesTab'),   { ssr: false });
const AlertasTab      = dynamic(() => import('./tabs/AlertasTab'),      { ssr: false });
const ProveedoresTab  = dynamic(() => import('./tabs/ProveedoresTab'),  { ssr: false });

const TABS = [
  { id: 'Dashboard',  label: 'Dashboard',  icon: 'dashboard' },
  { id: 'Inventario', label: 'Inventario', icon: 'inventory_2' },
  { id: 'Ventas',     label: 'Análisis',   icon: 'bar_chart' },
  { id: 'Reportes',   label: 'Reportes',   icon: 'receipt_long' },
  { id: 'Alertas',     label: 'Alertas',     icon: 'notifications' },
  { id: 'Proveedores', label: 'Proveedores', icon: 'local_shipping' },
] as const;

const TabSpinner = () => (
  <div className="flex-1 flex flex-col items-center justify-center p-12">
    <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
    <p className="font-serif italic text-primary">Cargando...</p>
  </div>
);

// ── Main ───────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [activeTab,   setActiveTab]   = useState('Dashboard');
  const [products,         setProducts]         = useState<Product[]>([]);
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([]);
  const [categories,       setCategories]       = useState<Category[]>([]);
  const [loading,          setLoading]          = useState(true);
  const [productsLoading,  setProductsLoading]  = useState(false);
  const [allProductsFetched, setAllProductsFetched] = useState(false);
  const [dbStatus,         setDbStatus]         = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [notification,     setNotification]     = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [timeFilter,       setTimeFilter]       = useState('Hoy');

  const notify = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // Light fetch: only low-stock products + categories + health (fast, runs on startup)
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [lowRes, catRes, healthRes] = await Promise.all([
        fetch('/api/products?lowStock=true&pageSize=10000').then(r => r.json()),
        fetch('/api/products/categories').then(r => r.json()),
        fetch('/api/health').then(r => r.json()).catch(() => ({ status: 'error' })),
      ]);
      const lowList = Array.isArray(lowRes) ? lowRes : (lowRes?.data ?? []);
      setLowStockProducts(lowList);
      if (Array.isArray(catRes))  setCategories(catRes);
      else if (catRes?.data)      setCategories(catRes.data);
      setDbStatus(healthRes?.db === 'connected' ? 'ok' : 'error');
    } catch { setDbStatus('error'); }
    finally { setLoading(false); }
  }, []);

  // Heavy fetch: all products — only when Inventario tab is opened
  const fetchAllProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const data = await fetch('/api/products?pageSize=100000').then(r => r.json());
      if (Array.isArray(data))  setProducts(data);
      else if (data?.data)      setProducts(data.data);
      setAllProductsFetched(true);
    } catch (e) { console.error('Error cargando inventario:', e); }
    finally { setProductsLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Lazy-load full product list the first time Inventario tab is opened
  useEffect(() => {
    if (activeTab === 'Inventario' && !allProductsFetched) fetchAllProducts();
  }, [activeTab, allProductsFetched, fetchAllProducts]);

  // ── Tab content ─────────────────────────────────────────────────────────────
  const renderContent = () => {
    if (loading) return (
      <div className="flex-1 flex flex-col items-center justify-center p-12">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
        <p className="font-serif italic text-primary text-lg">Cargando datos...</p>
      </div>
    );
    return (
      <Suspense fallback={<TabSpinner />}>
        {activeTab === 'Dashboard'  && <DashboardTab  timeFilter={timeFilter} lowStockProducts={lowStockProducts} dbStatus={dbStatus} setActiveTab={setActiveTab} />}
        {activeTab === 'Inventario' && <InventarioTab products={products} lowStockProducts={lowStockProducts} categories={categories} loading={productsLoading} onRefresh={() => { fetchData(); fetchAllProducts(); }} />}
        {activeTab === 'Ventas'     && <VentasTab />}
        {activeTab === 'Reportes'   && <ReportesTab timeFilter={timeFilter} />}
        {activeTab === 'Alertas'     && <AlertasTab     lowStockProducts={lowStockProducts} onRefresh={fetchData} />}
        {activeTab === 'Proveedores' && <ProveedoresTab timeFilter={timeFilter} />}
      </Suspense>
    );
  };

  const showTimeFilter = activeTab === 'Dashboard' || activeTab === 'Reportes' || activeTab === 'Proveedores';

  return (
    <div className="flex min-h-screen bg-background text-on-surface font-sans w-full">
      {notification && <Notification msg={notification.message} type={notification.type} />}

      {/* ── Desktop sidebar ─────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex h-screen w-64 bg-stone-50 dark:bg-stone-950 border-r border-stone-200/50 flex-col py-6 sticky top-0 flex-shrink-0">
        <div className="px-6 mb-8">
          <h1 className="text-2xl font-serif text-primary">La Casita Deli</h1>
          <div className="flex items-center gap-2 mt-1">
            <div className={cn('w-1.5 h-1.5 rounded-full', dbStatus === 'ok' ? 'bg-emerald-500 animate-pulse' : 'bg-error')} />
            <p className="font-label text-[10px] tracking-widest uppercase text-stone-500">Admin Terminal</p>
          </div>
        </div>

        <nav className="flex-1 px-2 space-y-1">
          {TABS.map(item => (
            <button key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn('w-full flex items-center px-4 py-3 rounded-lg transition-all active:opacity-80 group',
                activeTab === item.id ? 'bg-primary text-on-primary shadow-lg' : 'text-stone-600 hover:bg-stone-200'
              )}>
              <Icon name={item.icon} className={cn('mr-3 text-xl', activeTab === item.id ? 'text-on-primary' : 'text-stone-400 group-hover:text-primary')} />
              <span className="font-label text-sm tracking-wide">{item.label}</span>
              {item.id === 'Alertas' && lowStockProducts.length > 0 && (
                <span className="ml-auto bg-error text-on-error text-[8px] font-bold px-1.5 py-0.5 rounded-full">{lowStockProducts.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="px-4 mt-auto">
          <div className="flex items-center px-2 py-4 border-t border-stone-200/50">
            <div className="w-10 h-10 rounded-full bg-surface-container-highest overflow-hidden mr-3 border-2 border-primary/10">
              <img alt="Staff" className="w-full h-full object-cover"
                src="https://media.istockphoto.com/id/1300845620/es/vector/icono-de-usuario-plano-aislado-sobre-fondo-blanco-s%C3%ADmbolo-de-usuario-ilustraci%C3%B3n-vectorial.jpg?s=2048x2048&w=is&k=20&c=j5BJ73etsLPYk0gCN6_bdDcWevL934SiU6eSOwVceYM=" />
            </div>
            <div>
              <p className="text-xs font-bold text-on-surface font-body">Admin Staff</p>
              <p className="text-[10px] text-stone-400 font-label uppercase tracking-widest">Shift Manager</p>
            </div>
            <button className="ml-auto text-stone-300 hover:text-error transition-colors">
              <Icon name="logout" className="text-lg" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-h-screen min-w-0 overflow-y-auto bg-background pb-[68px] lg:pb-0">

        {/* Header */}
        <header className="w-full bg-background/95 backdrop-blur-sm sticky top-0 z-10 border-b border-stone-100/50">
          {/* Primary row */}
          <div className="flex justify-between items-center px-4 lg:px-8 py-3 lg:py-4">
            <div className="flex items-center gap-3 min-w-0">
              <h2 className="text-xl lg:text-2xl font-serif italic tracking-tight text-primary uppercase truncate">
                {activeTab === 'Ventas' ? 'Análisis' : activeTab}
              </h2>
              <div className="hidden lg:block px-3 py-1 bg-secondary-fixed text-on-secondary-fixed text-[10px] font-label uppercase tracking-widest rounded-full flex-shrink-0">
                Live Dashboard
              </div>
            </div>

            <div className="flex items-center gap-2 lg:gap-4 flex-shrink-0">
              {/* Time filter — desktop only */}
              {showTimeFilter && (
                <div className="hidden lg:flex items-center gap-1.5 bg-surface-container-low px-2 py-1 rounded-lg border border-outline-variant/10">
                  {['Hoy', 'Esta semana', 'Este mes'].map(p => (
                    <button key={p} onClick={() => setTimeFilter(p)}
                      className={cn('px-4 py-1.5 rounded-md text-[10px] font-label font-bold uppercase tracking-widest transition-all',
                        timeFilter === p ? 'bg-surface text-primary shadow-sm' : 'text-stone-400 hover:text-stone-600')}>
                      {p}
                    </button>
                  ))}
                </div>
              )}

              {/* DB status dot — mobile */}
              <div className={cn('lg:hidden w-2 h-2 rounded-full flex-shrink-0',
                dbStatus === 'ok' ? 'bg-emerald-500 animate-pulse' : 'bg-error')} />

              <button onClick={fetchData}
                className={cn('p-2 hover:bg-stone-100 rounded-full transition-all text-primary', loading && 'animate-spin')}>
                <Icon name="refresh" className="text-xl" />
              </button>

              <div className="hidden lg:flex items-center gap-2 text-stone-500 font-label text-[10px] uppercase tracking-widest">
                <div className="h-6 w-px bg-stone-200" />
                <Icon name="calendar_today" className="text-lg" />
                <span>{new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</span>
              </div>
            </div>
          </div>

          {/* Time filter strip — mobile only, below title */}
          {showTimeFilter && (
            <div className="lg:hidden px-4 pb-3 flex gap-2">
              {[
                { key: 'Hoy',         short: 'Hoy' },
                { key: 'Esta semana', short: 'Semana' },
                { key: 'Este mes',    short: 'Mes' },
              ].map(({ key, short }) => (
                <button key={key} onClick={() => setTimeFilter(key)}
                  className={cn('flex-1 py-2 rounded-xl text-[11px] font-label font-bold uppercase tracking-widest transition-all',
                    timeFilter === key
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'bg-surface-container-low text-stone-400 hover:text-stone-600')}>
                  {short}
                </button>
              ))}
            </div>
          )}
        </header>

        {renderContent()}

      </main>

      {/* ── Mobile bottom navigation ─────────────────────────────────────────── */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-surface/95 backdrop-blur-md border-t border-stone-100 flex h-[68px] safe-area-inset-bottom">
        {TABS.map(item => (
          <button key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-0.5 transition-all relative active:opacity-70',
              activeTab === item.id ? 'text-primary' : 'text-stone-400'
            )}>
            {/* Active indicator line */}
            {activeTab === item.id && (
              <span className="absolute top-0 left-3 right-3 h-0.5 bg-primary rounded-b-full" />
            )}
            <div className="relative">
              <Icon name={item.icon} className="text-[22px]" />
              {item.id === 'Alertas' && lowStockProducts.length > 0 && (
                <span className="absolute -top-1 -right-2 bg-error text-on-error text-[8px] font-bold px-1 py-px rounded-full leading-none min-w-[14px] text-center">
                  {lowStockProducts.length}
                </span>
              )}
            </div>
            <span className="text-[9px] font-label uppercase tracking-wide leading-none mt-0.5">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
