'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { cn } from './lib/utils';
import { Icon } from './components/Icon';
import { Notification } from './components/Notification';
import { ProductModal } from './components/ProductModal';
import type { Product, Category } from './lib/types';

// ── Lazy-load tabs (cada pestaña se descarga solo cuando se visita) ────────────
const DashboardTab  = dynamic(() => import('./tabs/DashboardTab'),  { ssr: false });
const InventarioTab = dynamic(() => import('./tabs/InventarioTab'), { ssr: false });
const VentasTab     = dynamic(() => import('./tabs/VentasTab'),     { ssr: false });
const ReportesTab   = dynamic(() => import('./tabs/ReportesTab'),   { ssr: false });
const AlertasTab    = dynamic(() => import('./tabs/AlertasTab'),    { ssr: false });

const TabSpinner = () => (
  <div className="flex-1 flex flex-col items-center justify-center p-20">
    <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
    <p className="font-serif italic text-primary">Cargando...</p>
  </div>
);

// ── Main ───────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [activeTab,         setActiveTab]         = useState('Dashboard');
  const [products,          setProducts]          = useState<Product[]>([]);
  const [categories,        setCategories]        = useState<Category[]>([]);
  const [loading,           setLoading]           = useState(true);
  const [dbStatus,          setDbStatus]          = useState<'unknown' | 'ok' | 'error'>('unknown');
  const [notification,      setNotification]      = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [timeFilter,        setTimeFilter]        = useState('Hoy');
  const [showProductModal,  setShowProductModal]  = useState(false);
  const [editingProduct,    setEditingProduct]    = useState<Product | null>(null);

  const lowStockProducts = products.filter(p => p.stock <= p.minStock);

  const notify = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // ── Fetch de datos compartidos ──────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [prodRes, catRes, healthRes] = await Promise.all([
        fetch('/api/products?pageSize=100000').then(r => r.json()),
        fetch('/api/products/categories').then(r => r.json()),
        fetch('/api/health').then(r => r.json()).catch(() => ({ status: 'error' })),
      ]);
      if (Array.isArray(prodRes))  setProducts(prodRes);
      else if (prodRes?.data)      setProducts(prodRes.data);
      if (Array.isArray(catRes))   setCategories(catRes);
      else if (catRes?.data)       setCategories(catRes.data);
      setDbStatus(healthRes?.db === 'connected' ? 'ok' : 'error');
    } catch { setDbStatus('error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Product CRUD ────────────────────────────────────────────────────────────
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const fd   = new FormData(form);
    const body: Record<string, any> = {};
    fd.forEach((v, k) => { body[k] = v; });
    ['salePrice', 'costPrice', 'stock', 'minStock'].forEach(f => {
      if (body[f] !== '') body[f] = parseFloat(body[f]);
    });
    if (body.categoryId === '') body.categoryId = null;
    body.visibleWeb = fd.get('visibleWeb') === 'on';
    const method = editingProduct ? 'PUT'  : 'POST';
    const url    = editingProduct ? `/api/products/${editingProduct.id}` : '/api/products';
    try {
      const res  = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok) { notify(data.message || 'Operación exitosa'); setShowProductModal(false); setEditingProduct(null); fetchData(); }
      else notify(data.error || 'Error al guardar', 'error');
    } catch { notify('Error de conexión', 'error'); }
  };

  const handleDeleteProduct = async (id: number) => {
    if (!confirm('¿Eliminar este producto?')) return;
    try {
      const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
      if (res.ok) { notify('Producto eliminado'); fetchData(); }
      else notify('Error al eliminar', 'error');
    } catch { notify('Error de conexión', 'error'); }
  };

  const openEditProduct = (product: Product | null) => {
    setEditingProduct(product);
    setShowProductModal(true);
  };

  // ── Tab routing ─────────────────────────────────────────────────────────────
  const renderContent = () => {
    if (loading) return (
      <div className="flex-1 flex flex-col items-center justify-center p-20">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
        <p className="font-serif italic text-primary text-xl">Loading editorial data...</p>
      </div>
    );

    return (
      <Suspense fallback={<TabSpinner />}>
        {activeTab === 'Dashboard'  && <DashboardTab  timeFilter={timeFilter} lowStockProducts={lowStockProducts} dbStatus={dbStatus} setActiveTab={setActiveTab} />}
        {activeTab === 'Inventario' && <InventarioTab products={products} lowStockProducts={lowStockProducts} categories={categories} onEdit={openEditProduct} onDelete={handleDeleteProduct} />}
        {activeTab === 'Ventas'     && <VentasTab />}
        {activeTab === 'Reportes'   && <ReportesTab timeFilter={timeFilter} />}
        {activeTab === 'Alertas'    && <AlertasTab   lowStockProducts={lowStockProducts} onRestock={openEditProduct} />}
      </Suspense>
    );
  };

  // ── Layout ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen bg-background text-on-surface font-sans relative w-full overflow-hidden">
      {notification && <Notification msg={notification.message} type={notification.type} />}
      {showProductModal && (
        <ProductModal
          editingProduct={editingProduct}
          categories={categories}
          onSave={handleSaveProduct}
          onClose={() => { setShowProductModal(false); setEditingProduct(null); }}
        />
      )}

      {/* Sidebar */}
      <aside className="h-screen w-64 bg-stone-50 dark:bg-stone-950 border-r border-stone-200/50 flex flex-col py-6 space-y-2 sticky top-0 flex-shrink-0">
        <div className="px-6 mb-8">
          <h1 className="text-2xl font-serif text-primary">La Casita Deli</h1>
          <div className="flex items-center gap-2 mt-1">
            <div className={cn('w-1.5 h-1.5 rounded-full', dbStatus === 'ok' ? 'bg-emerald-500 animate-pulse' : 'bg-error')} />
            <p className="font-label text-[10px] tracking-widest uppercase text-stone-500">Admin Terminal</p>
          </div>
        </div>

        <nav className="flex-1 px-2 space-y-1">
          {[
            { id: 'Dashboard',  label: 'Dashboard',  icon: 'dashboard' },
            { id: 'Inventario', label: 'Inventario', icon: 'inventory_2' },
            { id: 'Ventas',     label: 'Análisis',   icon: 'bar_chart' },
            { id: 'Reportes',   label: 'Reportes',   icon: 'receipt_long' },
            { id: 'Alertas',    label: 'Alertas',    icon: 'notifications', badge: lowStockProducts.length },
          ].map(item => (
            <button key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn('w-full flex items-center px-4 py-3 rounded-lg transition-all active:opacity-80 group',
                activeTab === item.id ? 'bg-primary text-on-primary shadow-lg' : 'text-stone-600 hover:bg-stone-200'
              )}>
              <Icon name={item.icon} className={cn('mr-3 text-xl', activeTab === item.id ? 'text-on-primary' : 'text-stone-400 group-hover:text-primary')} />
              <span className="font-label text-sm tracking-wide">{item.label}</span>
              {item.badge ? <span className="ml-auto bg-error text-on-error text-[8px] font-bold px-1.5 py-0.5 rounded-full">{item.badge}</span> : null}
            </button>
          ))}
        </nav>

        <div className="px-4 mt-auto pt-6">
          <div className="mt-6 flex items-center px-2 py-4 border-t border-stone-200/50">
            <div className="w-10 h-10 rounded-full bg-surface-container-highest overflow-hidden mr-3 border-2 border-primary/10">
              <img alt="Staff" className="w-full h-full object-cover" src="https://media.istockphoto.com/id/1300845620/es/vector/icono-de-usuario-plano-aislado-sobre-fondo-blanco-s%C3%ADmbolo-de-usuario-ilustraci%C3%B3n-vectorial.jpg?s=2048x2048&w=is&k=20&c=j5BJ73etsLPYk0gCN6_bdDcWevL934SiU6eSOwVceYM=" />
            </div>
            <div>
              <p className="text-xs font-bold text-on-surface font-body">Admin Staff</p>
              <p className="text-[10px] text-stone-400 font-label uppercase tracking-widest">Shift Manager</p>
            </div>
            <button className="ml-auto text-stone-300 hover:text-error transition-colors"><Icon name="logout" className="text-lg" /></button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-h-screen min-w-0 overflow-y-auto bg-background">
        <header className="w-full bg-background flex justify-between items-center px-8 py-4 sticky top-0 z-10 border-b border-stone-100/50 glass">
          <div className="flex items-center space-x-4">
            <h2 className="text-2xl font-serif italic tracking-tight text-primary uppercase">
              {activeTab === 'Ventas' ? 'Análisis' : activeTab}
            </h2>
            <div className="px-3 py-1 bg-secondary-fixed text-on-secondary-fixed text-[10px] font-label uppercase tracking-widest rounded-full">Live Dashboard</div>
          </div>
          <div className="flex items-center space-x-6">
            <div className="flex items-center gap-2 bg-surface-container-low px-2 py-1 rounded-lg border border-outline-variant/10">
              {['Hoy', 'Esta semana', 'Este mes'].map(p => (
                <button key={p} onClick={() => setTimeFilter(p)}
                  className={cn('px-4 py-1.5 rounded-md text-[10px] font-label font-bold uppercase tracking-widest transition-all',
                    timeFilter === p ? 'bg-surface text-primary shadow-sm' : 'text-stone-400 hover:text-stone-600')}>
                  {p}
                </button>
              ))}
            </div>
            <div className="flex items-center space-x-4 text-primary">
              <button onClick={fetchData} className={cn('p-2 hover:bg-stone-100 rounded-full transition-all', loading && 'animate-spin')}>
                <Icon name="refresh" className="text-xl" />
              </button>
              <div className="h-6 w-px bg-stone-200" />
              <div className="flex items-center gap-2 text-stone-500 font-label text-[10px] uppercase tracking-widest">
                <Icon name="calendar_today" className="text-lg" />
                <span>{new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</span>
              </div>
            </div>
          </div>
        </header>

        {renderContent()}

        
        
      </main>
    </div>
  );
}
