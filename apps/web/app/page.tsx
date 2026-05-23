"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell, Legend,
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

const Icon = ({ name, className }: { name: string; className?: string }) => (
  <span className={cn("material-symbols-outlined", className)} data-icon={name}>{name}</span>
);

// ── Types ──────────────────────────────────────────────────────────────────────
interface Product {
  id: number; barcode: string | null; name: string; description: string | null;
  costPrice: number; salePrice: number; stock: number; minStock: number;
  image: string | null; active: boolean; visibleWeb: boolean;
  category: string | null; categoryId: number | null; createdAt: string;
}
interface Category { id: number; name: string; description: string | null; }
interface SalesSummary {
  totalVentas: number; totalIngresos: number; ticketPromedio: number;
  totalEfectivo: number; totalTarjeta: number; totalTransferencia: number; gananciaEstimada: number;
}
interface Sale {
  id: number; invoiceNumber: string; total: number; paymentMethod: string;
  canal: string; createdAt: string; cajero: string | null; numProductos: number;
}
interface TopProduct { name: string; unidadesVendidas: number; ingresos: number; category?: string; image?: string; }

// Analytics types
interface HourRow   { hora: number; numTickets: number; unidadesVendidas: number; totalVentas: number; totalCosto: number; }
interface MonthRow  { anio: number; mes: number; numTickets: number; unidadesVendidas: number; totalVentas: number; totalCosto: number; }
interface ProdHour  { nombre: string; hora: number; unidades: number; ingresos: number; }
interface ProdMonth { nombre: string; anio: number; mes: number; unidades: number; ingresos: number; }

interface AnalyticsData {
  byHour:          HourRow[];
  byMonth:         MonthRow[];
  productsByHour:  ProdHour[];
  productsByMonth: ProdMonth[];
}

// ── Notification ───────────────────────────────────────────────────────────────
const Notification = ({ msg, type }: { msg: string; type: 'success' | 'error' }) => (
  <div className={cn(
    "fixed top-4 right-4 z-[110] px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 border animate-in slide-in-from-top-4 duration-300",
    type === 'success' ? "bg-primary text-white border-primary-fixed-dim" : "bg-error text-on-error border-error-container"
  )}>
    <Icon name={type === 'success' ? 'check_circle' : 'error'} className="text-xl" />
    <p className="text-sm font-label font-bold">{msg}</p>
  </div>
);

// ── Paleta de colores para productos ──────────────────────────────────────────
const PROD_COLORS = [
  '#012d1d','#1b4332','#2d6a4f','#40916c','#52b788',
  '#7b5819','#a47a23','#c9a843','#eebf76','#ffdeae',
];

// ── Main ───────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [activeTab, setActiveTab]               = useState('Dashboard');
  const [inventoryView, setInventoryView]       = useState<'list' | 'grid'>('list');
  const [products, setProducts]                 = useState<Product[]>([]);
  const [categories, setCategories]             = useState<Category[]>([]);
  const [salesSummary, setSalesSummary]         = useState<SalesSummary | null>(null);
  const [recentSales, setRecentSales]           = useState<Sale[]>([]);
  const [topProducts, setTopProducts]           = useState<TopProduct[]>([]);
  const [searchQuery, setSearchQuery]           = useState('');
  const [loading, setLoading]                   = useState(true);
  const [notification, setNotification]         = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [timeFilter, setTimeFilter]             = useState('Hoy');
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct]     = useState<Product | null>(null);
  const [categoryFilter, setCategoryFilter]     = useState('');
  const [dbStatus, setDbStatus]                 = useState<'unknown' | 'ok' | 'error'>('unknown');

  // Analytics state
  const [analytics, setAnalytics]               = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsMonths, setAnalyticsMonths]   = useState(3);
  const [analyticsMetric, setAnalyticsMetric]   = useState<'unidadesVendidas' | 'totalVentas'>('unidadesVendidas');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);

  const notify = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // ── Fetch principal ─────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const today  = new Date().toISOString().split('T')[0];
      const [prodRes, catRes, salesRes, healthRes] = await Promise.all([
        fetch('/api/products?pageSize=100000').then(r => r.json()),
        fetch('/api/products/categories').then(r => r.json()),
        fetch(`/api/sales/report?date=${today}`).then(r => r.json()).catch(() => null),
        fetch('/api/health').then(r => r.json()).catch(() => ({ status: 'error' })),
      ]);
      if (Array.isArray(prodRes)) setProducts(prodRes);
      else if (prodRes?.data) setProducts(prodRes.data);
      if (Array.isArray(catRes)) setCategories(catRes);
      else if (catRes?.data) setCategories(catRes.data);
      if (salesRes?.summary)     setSalesSummary(salesRes.summary);
      if (salesRes?.ventas)      setRecentSales(salesRes.ventas);
      if (salesRes?.topProducts) setTopProducts(salesRes.topProducts);
      setDbStatus(healthRes?.db === 'connected' ? 'ok' : 'error');
    } catch { setDbStatus('error'); } finally { setLoading(false); }
  }, []);

  // ── Fetch analytics ─────────────────────────────────────────────────────────
  const fetchAnalytics = useCallback(async (months: number) => {
    setAnalyticsLoading(true);
    try {
      const res  = await fetch(`/api/novacaja/analytics?months=${months}`);
      const data = await res.json();
      if (data.error) { notify(data.error, 'error'); return; }
      setAnalytics(data);
      // Auto-seleccionar top 5 productos
      const topN = [...new Set((data.productsByHour as ProdHour[]).map(r => r.nombre))].slice(0, 5);
      setSelectedProducts(topN);
    } catch (e: any) { notify('Error cargando analytics', 'error'); }
    finally { setAnalyticsLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (activeTab === 'Ventas') fetchAnalytics(analyticsMonths);
  }, [activeTab, analyticsMonths]);

  // ── Analytics computed ──────────────────────────────────────────────────────
  const allProductNames = useMemo(() => {
    if (!analytics) return [];
    return [...new Set(analytics.productsByHour.map(r => r.nombre))].slice(0, 20);
  }, [analytics]);

  // Horas con datos de cada producto seleccionado → heatmap rows
  const heatmapData = useMemo(() => {
    if (!analytics) return [];
    const hours = Array.from({ length: 24 }, (_, h) => {
      const row: Record<string, any> = { hora: h, label: `${h}:00` };
      selectedProducts.forEach(nombre => {
        const found = analytics.productsByHour.find(r => r.nombre === nombre && r.hora === h);
        row[nombre] = found ? found.unidades : 0;
      });
      return row;
    });
    return hours;
  }, [analytics, selectedProducts]);

  // Línea de volumen total por hora
  const hourLineData = useMemo(() => {
    if (!analytics) return [];
    return Array.from({ length: 24 }, (_, h) => {
      const found = analytics.byHour.find(r => r.hora === h);
      return {
        hora:    h,
        label:   `${h}:00`,
        tickets: found?.numTickets       || 0,
        unidades: found?.unidadesVendidas || 0,
        ventas:  found?.totalVentas      || 0,
      };
    });
  }, [analytics]);

  // Meses formateados
  const monthChartData = useMemo(() => {
    if (!analytics) return [];
    const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return analytics.byMonth.map(r => ({
      label:    `${MESES[r.mes - 1]} ${r.anio}`,
      tickets:  r.numTickets,
      unidades: r.unidadesVendidas,
      ventas:   r.totalVentas,
      costo:    r.totalCosto,
      ganancia: r.totalVentas - r.totalCosto,
    }));
  }, [analytics]);

  // Productos por mes (stacked)
  const productMonthData = useMemo(() => {
    if (!analytics || !selectedProducts.length) return [];
    const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const monthKeys = [...new Set(analytics.productsByMonth.map(r => `${r.anio}-${r.mes}`))].sort();
    return monthKeys.map(key => {
      const [anio, mes] = key.split('-').map(Number);
      const row: Record<string, any> = { label: `${MESES[mes-1]} ${anio}` };
      selectedProducts.forEach(nombre => {
        const found = analytics.productsByMonth.find(r => r.nombre === nombre && r.anio === anio && r.mes === mes);
        row[nombre] = found ? (analyticsMetric === 'unidadesVendidas' ? found.unidades : found.ingresos) : 0;
      });
      return row;
    });
  }, [analytics, selectedProducts, analyticsMetric]);

  // ── Max para heatmap cell sizing ────────────────────────────────────────────
  const heatmapMax = useMemo(() => {
    let max = 0;
    heatmapData.forEach(row => {
      selectedProducts.forEach(p => { if (row[p] > max) max = row[p]; });
    });
    return max || 1;
  }, [heatmapData, selectedProducts]);

  // ── Filtered products ───────────────────────────────────────────────────────
  const filteredProducts = products.filter(p => {
    const matchSearch = !searchQuery ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.barcode || '').includes(searchQuery);
    const matchCat = !categoryFilter || String(p.categoryId) === categoryFilter;
    return matchSearch && matchCat;
  });
  const lowStockProducts = products.filter(p => p.stock <= p.minStock);

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
    const method = editingProduct ? 'PUT' : 'POST';
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

  // ── Product Modal ───────────────────────────────────────────────────────────
  const ProductModal = () => (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden border border-outline-variant/15">
        <div className="p-6 border-b border-surface-variant flex justify-between items-center bg-surface-container-low">
          <div>
            <h3 className="text-xl font-serif text-primary">{editingProduct ? 'Editar Producto' : 'Nuevo Producto'}</h3>
            <p className="text-[10px] text-stone-500 font-label uppercase tracking-widest mt-1">Terminal de Administración</p>
          </div>
          <button onClick={() => { setShowProductModal(false); setEditingProduct(null); }}
            className="p-2 hover:bg-surface-variant rounded-full text-stone-400 transition-colors"><Icon name="close" /></button>
        </div>
        <form onSubmit={handleSaveProduct} className="p-6 space-y-4 overflow-y-auto max-h-[75vh]">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1">
              <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">Nombre *</label>
              <input name="name" defaultValue={editingProduct?.name} required
                className="w-full px-4 py-2.5 bg-surface-container-low border border-transparent focus:border-primary rounded-lg text-sm outline-none font-body"
                placeholder="Ej: Pan de Masa Madre" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">Código de barras</label>
              <div className="relative">
                <Icon name="barcode_scanner" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <input name="barcode" defaultValue={editingProduct?.barcode || ''}
                  className="w-full pl-10 pr-4 py-2.5 bg-surface-container-low border border-transparent focus:border-primary rounded-lg text-sm outline-none font-label"
                  placeholder="7501234..." />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">Categoría</label>
              <select name="categoryId" defaultValue={editingProduct?.categoryId || ''}
                className="w-full px-4 py-2.5 bg-surface-container-low border border-transparent focus:border-primary rounded-lg text-sm outline-none appearance-none cursor-pointer font-body">
                <option value="">Sin categoría</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">Precio venta *</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
                <input name="salePrice" type="number" step="0.01" min="0" defaultValue={editingProduct?.salePrice} required
                  className="w-full pl-8 pr-4 py-2.5 bg-surface-container-low border border-transparent focus:border-primary rounded-lg text-sm outline-none font-bold font-body" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">Costo</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
                <input name="costPrice" type="number" step="0.01" min="0" defaultValue={editingProduct?.costPrice || 0}
                  className="w-full pl-8 pr-4 py-2.5 bg-surface-container-low border border-transparent focus:border-primary rounded-lg text-sm outline-none font-bold font-body" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">Stock</label>
              <input name="stock" type="number" min="0" defaultValue={editingProduct?.stock ?? 0}
                className="w-full px-4 py-2.5 bg-surface-container-low border border-transparent focus:border-primary rounded-lg text-sm outline-none font-bold font-body" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">Stock mínimo</label>
              <input name="minStock" type="number" min="0" defaultValue={editingProduct?.minStock ?? 5}
                className="w-full px-4 py-2.5 bg-surface-container-low border border-transparent focus:border-primary rounded-lg text-sm outline-none font-bold font-body" />
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">URL Imagen</label>
              <input name="image" defaultValue={editingProduct?.image || ''}
                className="w-full px-4 py-2.5 bg-surface-container-low border border-transparent focus:border-primary rounded-lg text-sm outline-none font-body"
                placeholder="https://..." />
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">Descripción</label>
              <textarea name="description" defaultValue={editingProduct?.description || ''}
                className="w-full px-4 py-2.5 bg-surface-container-low border border-transparent focus:border-primary rounded-lg text-sm outline-none resize-none font-body"
                rows={2} placeholder="Descripción opcional..." />
            </div>
            <div className="col-span-2 flex items-center gap-3">
              <input type="checkbox" name="visibleWeb" id="visibleWeb" defaultChecked={editingProduct?.visibleWeb ?? true}
                className="w-4 h-4 accent-primary rounded" />
              <label htmlFor="visibleWeb" className="text-sm text-on-surface font-body font-medium cursor-pointer">Visible en página web</label>
            </div>
          </div>
          <div className="pt-2 flex gap-3">
            <button type="button" onClick={() => { setShowProductModal(false); setEditingProduct(null); }}
              className="flex-1 py-3 bg-surface-variant text-on-surface-variant rounded-lg text-xs font-label font-bold hover:bg-stone-200 transition-all uppercase tracking-widest">
              Cancelar
            </button>
            <button type="submit"
              className="flex-1 py-3 bg-primary text-on-primary rounded-lg text-xs font-label font-bold shadow-lg hover:bg-primary-container active:scale-[0.98] transition-all uppercase tracking-widest">
              {editingProduct ? 'Guardar cambios' : 'Crear producto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  // ── Custom Tooltip para horas ───────────────────────────────────────────────
  const HourTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-surface border border-outline-variant/20 rounded-xl shadow-2xl p-4 min-w-[160px]">
        <p className="font-serif text-primary text-lg mb-2">{label}</p>
        {payload.map((p: any, i: number) => (
          <div key={i} className="flex justify-between gap-4 text-xs font-label">
            <span style={{ color: p.color }} className="truncate max-w-[100px]">{p.dataKey === 'unidades' ? 'Total' : p.name}</span>
            <span className="font-bold text-on-surface">{Number(p.value).toLocaleString('es-MX')}</span>
          </div>
        ))}
      </div>
    );
  };

  // ── renderContent ───────────────────────────────────────────────────────────
  const renderContent = () => {
    switch (activeTab) {

      // ── DASHBOARD ─────────────────────────────────────────────────────────────
      case 'Dashboard':
        return (
          <section className="p-8 max-w-7xl mx-auto w-full">
            {dbStatus === 'error' && (
              <div className="bg-error-container border border-error/20 rounded-xl p-4 flex items-center gap-3 mb-8">
                <Icon name="error" className="text-error" />
                <p className="text-sm text-on-error-container font-body font-medium">
                  No se pudo conectar a la base de datos. Verifica que la API esté corriendo y el <code>.env</code> esté configurado.
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
              {[
                { label: 'Ventas Hoy',  value: salesSummary?.totalVentas ?? 0, icon: 'trending_up',  sub: `Ticket prom: $${(salesSummary?.ticketPromedio ?? 0).toFixed(2)}`, color: 'text-emerald-700', bg: 'bg-primary-fixed/30' },
                { label: 'Ingresos',    value: `$${(salesSummary?.totalIngresos ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`, icon: 'payments', sub: `Ganancia est: $${(salesSummary?.gananciaEstimada ?? 0).toFixed(2)}`, color: 'text-amber-700', bg: 'bg-secondary-fixed/30' },
                { label: 'Productos',   value: products.length, icon: 'inventory_2', sub: `${lowStockProducts.length} con stock bajo`, color: 'text-stone-600', bg: 'bg-surface-container-highest' },
                { label: 'Stock Bajo',  value: lowStockProducts.length, icon: 'warning', sub: 'Reorder required soon', color: 'text-error', bg: 'bg-error-container/30', danger: lowStockProducts.length > 0 },
              ].map((card, i) => (
                <div key={i} className={cn("bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/15 flex flex-col justify-between shadow-[0px_12px_32px_rgba(28,28,25,0.04)]", card.danger && "border-l-4 border-l-error")}>
                  <div className="flex justify-between items-start mb-4">
                    <span className="text-[10px] font-label uppercase tracking-widest text-stone-500">{card.label}</span>
                    <Icon name={card.icon} className={cn(card.color, card.bg, "p-2 rounded-lg")} />
                  </div>
                  <div>
                    <p className={cn("text-3xl font-serif", card.danger ? "text-error" : "text-on-surface")}>{card.value}</p>
                    <p className={cn("text-[11px] mt-1 font-body font-medium", card.danger ? "text-error" : "text-emerald-700")}>{card.sub}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 bg-surface p-8 rounded-xl border border-outline-variant/10">
                <div className="flex justify-between items-baseline mb-8">
                  <h3 className="text-2xl font-serif italic text-primary">Ingresos por Método</h3>
                </div>
                <div className="grid grid-cols-3 gap-4 mb-8">
                  {[
                    { label: 'Efectivo',      icon: 'wallet',   value: salesSummary?.totalEfectivo ?? 0,      color: 'text-emerald-700' },
                    { label: 'Tarjeta',       icon: 'credit_card', value: salesSummary?.totalTarjeta ?? 0,    color: 'text-amber-700' },
                    { label: 'Transferencia', icon: 'sync_alt', value: salesSummary?.totalTransferencia ?? 0, color: 'text-primary' },
                  ].map((m, i) => (
                    <div key={i} className="p-4 bg-surface-container-low rounded-xl border border-outline-variant/10">
                      <div className="flex items-center gap-2 mb-2">
                        <Icon name={m.icon} className={cn("text-sm", m.color)} />
                        <span className="text-[10px] font-label uppercase tracking-widest text-stone-500">{m.label}</span>
                      </div>
                      <p className="text-lg font-serif text-on-surface">${m.value.toLocaleString('es-MX')}</p>
                    </div>
                  ))}
                </div>
                {/* Fix for ResponsiveContainer warning */}
                <div className="h-80 w-full" style={{ minWidth: 0, minHeight: 0 }}>
                  <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                    <BarChart data={topProducts.slice(0, 7)}>
                      <Bar dataKey="ingresos" fill="#012d1d" radius={[4, 4, 0, 0]} />
                      <XAxis dataKey="name" hide />
                      <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-surface-container-low p-8 rounded-xl border border-outline-variant/10">
                <h3 className="text-xl font-serif text-primary mb-6">Top Productos</h3>
                <div className="space-y-6">
                  {topProducts.length === 0 ? (
                    <p className="text-xs font-body text-stone-500 italic">No hay datos de ventas hoy.</p>
                  ) : topProducts.slice(0, 5).map((p, i) => (
                    <div key={i} className="flex items-center">
                      <div className="w-12 h-12 rounded-lg bg-surface-container-lowest overflow-hidden flex-shrink-0 border border-outline-variant/10">
                        {p.image ? <img alt={p.name} className="w-full h-full object-cover" src={p.image} /> : <div className="w-full h-full flex items-center justify-center text-stone-300"><Icon name="image" /></div>}
                      </div>
                      <div className="ml-4 flex-1 min-w-0">
                        <p className="text-sm font-semibold text-on-surface truncate font-body">{p.name}</p>
                        <p className="text-xs text-stone-500 font-body">{p.category || 'General'}</p>
                      </div>
                      <div className="text-right ml-2">
                        <p className="text-sm font-bold text-primary font-body">{p.unidadesVendidas}</p>
                        <p className="text-[10px] text-stone-400 uppercase tracking-tighter font-label">Units</p>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={() => setActiveTab('Inventario')}
                  className="w-full mt-8 py-3 border border-primary/20 text-primary rounded-lg font-label text-xs uppercase tracking-widest hover:bg-primary hover:text-on-primary transition-all">
                  View Inventory
                </button>
              </div>
            </div>

            <div className="mt-12">
              <div className="mb-6 flex justify-between items-center">
                <h3 className="text-xl font-serif text-on-surface">Alertas de Inventario</h3>
                <button onClick={() => setActiveTab('Alertas')} className="text-primary text-[10px] font-label uppercase tracking-widest border-b border-primary pb-1">Review All</button>
              </div>
              <div className="bg-surface-container-lowest rounded-xl shadow-[0px_4px_12px_rgba(28,28,25,0.02)] overflow-hidden border border-outline-variant/10">
                {lowStockProducts.length === 0 ? (
                  <div className="p-8 text-center">
                    <Icon name="check_circle" className="text-emerald-600 text-3xl mb-2" />
                    <p className="text-sm font-body text-stone-500">Todo el inventario está en niveles óptimos.</p>
                  </div>
                ) : lowStockProducts.slice(0, 3).map((p, i) => (
                  <div key={i} className="flex items-center p-5 border-b border-surface-container hover:bg-background transition-colors">
                    <Icon name="error" className="text-error mr-4" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-on-surface font-body">{p.name}</p>
                      <p className="text-xs text-stone-500 font-body">Critical Stock: {p.stock} units remaining</p>
                    </div>
                    <span className="px-3 py-1 bg-error-container text-on-error-container text-[10px] rounded-full uppercase font-label">Critical</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        );

      // ── INVENTARIO ────────────────────────────────────────────────────────────
      case 'Inventario':
        return (
          <section className="p-8 max-w-7xl mx-auto w-full">
            <div className="flex justify-between items-end mb-8">
              <div>
                <h2 className="text-3xl font-serif italic text-primary">Inventario</h2>
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-500 mt-1">{products.length} productos · {lowStockProducts.length} alertas</p>
              </div>
              <button onClick={() => { setEditingProduct(null); setShowProductModal(true); }}
                className="px-6 py-2.5 bg-primary text-on-primary rounded-lg text-sm font-label font-bold flex items-center gap-2 shadow-lg hover:bg-primary-container transition-all">
                <Icon name="add_circle" className="text-lg" /> Nuevo Producto
              </button>
            </div>

            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow-[0px_12px_32px_rgba(28,28,25,0.04)] overflow-hidden">
              <div className="p-6 border-b border-surface-container flex justify-between items-center bg-surface-container-low/30">
                <div className="flex gap-4 flex-1 max-w-2xl">
                  <div className="relative flex-1">
                    <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-xl" />
                    <input type="text" placeholder="Search inventory..."
                      className="w-full pl-10 pr-4 py-2 bg-background border-none rounded-lg text-sm outline-none focus:ring-1 focus:ring-primary font-body"
                      value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                  </div>
                  <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
                    className="px-4 py-2 bg-background border-none rounded-lg text-sm outline-none focus:ring-1 focus:ring-primary font-body cursor-pointer">
                    <option value="">Todas las categorías</option>
                    {categories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                  </select>
                </div>
                <div className="flex bg-background p-1 rounded-lg border border-outline-variant/10 ml-4">
                  <button onClick={() => setInventoryView('list')} className={cn("p-1.5 rounded-md transition-all", inventoryView === 'list' ? "bg-surface shadow-sm text-primary" : "text-stone-400")}><Icon name="list" className="text-lg" /></button>
                  <button onClick={() => setInventoryView('grid')} className={cn("p-1.5 rounded-md transition-all", inventoryView === 'grid' ? "bg-surface shadow-sm text-primary" : "text-stone-400")}><Icon name="grid_view" className="text-lg" /></button>
                </div>
              </div>

              {inventoryView === 'list' ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container">
                      <tr>
                        <th className="px-6 py-4">Producto</th>
                        <th className="px-6 py-4 text-center">Stock</th>
                        <th className="px-6 py-4">Precio</th>
                        <th className="px-6 py-4">Estado</th>
                        <th className="px-6 py-4 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-container">
                      {filteredProducts.map(p => (
                        <tr key={p.id} className="hover:bg-background transition-colors group">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-lg bg-background flex items-center justify-center overflow-hidden border border-outline-variant/10">
                                {p.image ? <img src={p.image} className="w-full h-full object-cover" alt={p.name} /> : <Icon name="image" className="text-stone-300" />}
                              </div>
                              <div>
                                <p className="font-bold text-on-surface font-body text-sm">{p.name}</p>
                                <p className="text-[10px] text-stone-400 font-label tracking-widest uppercase mt-0.5">{p.category || 'Sin categoría'}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={cn("font-serif text-lg", p.stock <= p.minStock ? "text-error" : "text-on-surface")}>{p.stock}</span>
                            <span className="text-[10px] text-stone-400 font-label block">unidades</span>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm font-bold text-primary font-body">${Number(p.salePrice).toFixed(2)}</p>
                            <p className="text-[10px] text-stone-400 font-label">Costo: ${Number(p.costPrice).toFixed(2)}</p>
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn("px-3 py-1 rounded-full text-[10px] font-label uppercase tracking-widest", p.stock > p.minStock ? "bg-primary-fixed text-on-primary-fixed-variant" : "bg-error-container text-on-error-container")}>
                              {p.stock > p.minStock ? "En Stock" : "Bajo"}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => { setEditingProduct(p); setShowProductModal(true); }} className="p-2 hover:bg-primary-fixed/20 rounded-lg text-primary transition-all"><Icon name="edit" className="text-lg" /></button>
                              <button onClick={() => handleDeleteProduct(p.id)} className="p-2 hover:bg-error-container/20 rounded-lg text-error transition-all"><Icon name="delete" className="text-lg" /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {filteredProducts.map(p => (
                    <div key={p.id} className="group bg-surface-container-low/30 rounded-xl p-4 hover:shadow-xl transition-all border border-transparent hover:border-outline-variant/20">
                      <div className="aspect-square bg-background rounded-lg mb-4 overflow-hidden relative border border-outline-variant/10">
                        {p.image ? <img src={p.image} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" alt={p.name} /> : <div className="w-full h-full flex items-center justify-center"><Icon name="image" className="text-stone-200 text-4xl" /></div>}
                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => { setEditingProduct(p); setShowProductModal(true); }} className="p-2 bg-surface rounded-lg text-primary shadow-sm hover:bg-primary hover:text-on-primary transition-all"><Icon name="edit" className="text-sm" /></button>
                        </div>
                      </div>
                      <p className="text-[9px] font-label font-bold text-primary uppercase tracking-[0.2em]">{p.category || 'General'}</p>
                      <h4 className="font-serif text-lg text-on-surface line-clamp-1 mt-1">{p.name}</h4>
                      <div className="flex justify-between items-end mt-4">
                        <div>
                          <p className="text-[10px] font-label text-stone-500 uppercase">Stock</p>
                          <p className={cn("text-xl font-serif", p.stock <= p.minStock ? "text-error" : "text-on-surface")}>{p.stock}</p>
                        </div>
                        <p className="text-2xl font-serif text-primary">${Number(p.salePrice).toFixed(0)}<span className="text-sm">.{Number(p.salePrice).toFixed(2).split('.')[1]}</span></p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        );

      // ── VENTAS — ANALYTICS ────────────────────────────────────────────────────
      case 'Ventas':
        return (
          <section className="p-8 max-w-7xl mx-auto w-full space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
              <div>
                <h2 className="text-3xl font-serif italic text-primary">Análisis de Ventas</h2>
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-500 mt-1">
                  Volumen histórico por hora · por mes · por producto
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-label uppercase tracking-widest text-stone-500">Periodo:</span>
                {[
                  { label: '1 mes',  value: 1  },
                  { label: '3 meses', value: 3 },
                  { label: '6 meses', value: 6 },
                  { label: '1 año',  value: 12 },
                ].map(opt => (
                  <button key={opt.value}
                    onClick={() => setAnalyticsMonths(opt.value)}
                    className={cn(
                      "px-4 py-2 rounded-lg text-[11px] font-label font-bold uppercase tracking-widest transition-all",
                      analyticsMonths === opt.value ? "bg-primary text-on-primary shadow-md" : "bg-surface-container-low text-stone-500 hover:bg-stone-200"
                    )}>
                    {opt.label}
                  </button>
                ))}
                <button
                  onClick={() => fetchAnalytics(analyticsMonths)}
                  className={cn("p-2 rounded-lg hover:bg-surface-container-low transition-all text-stone-400 hover:text-primary", analyticsLoading && "animate-spin")}>
                  <Icon name="refresh" />
                </button>
              </div>
            </div>

            {analyticsLoading ? (
              <div className="flex flex-col items-center justify-center py-32">
                <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
                <p className="font-serif italic text-primary">Cargando datos históricos...</p>
              </div>
            ) : !analytics ? (
              <div className="flex flex-col items-center justify-center py-32 text-stone-300">
                <Icon name="bar_chart" className="text-6xl mb-4 opacity-30" />
                <p className="font-label uppercase tracking-widest text-sm">Sin datos — verifica la conexión al servidor</p>
              </div>
            ) : (
              <>
                {/* ── Selección de productos ─────────────────────────────────────── */}
                <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-label font-bold uppercase tracking-widest text-stone-500">
                      Productos visualizados <span className="text-primary ml-2">{selectedProducts.length} / {allProductNames.length}</span>
                    </h3>
                    <div className="flex gap-2">
                      <button onClick={() => setSelectedProducts(allProductNames.slice(0, 5))}
                        className="text-[10px] font-label uppercase tracking-widest text-primary border border-primary/20 px-3 py-1 rounded-lg hover:bg-primary/5 transition-all">
                        Top 5
                      </button>
                      <button onClick={() => setSelectedProducts(allProductNames.slice(0, 10))}
                        className="text-[10px] font-label uppercase tracking-widest text-primary border border-primary/20 px-3 py-1 rounded-lg hover:bg-primary/5 transition-all">
                        Top 10
                      </button>
                      <button onClick={() => setSelectedProducts([])}
                        className="text-[10px] font-label uppercase tracking-widest text-stone-400 border border-stone-200 px-3 py-1 rounded-lg hover:bg-stone-100 transition-all">
                        Limpiar
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {allProductNames.map((nombre, i) => {
                      const isSelected = selectedProducts.includes(nombre);
                      const color      = PROD_COLORS[i % PROD_COLORS.length];
                      return (
                        <button
                          key={nombre}
                          onClick={() => setSelectedProducts(prev =>
                            isSelected ? prev.filter(n => n !== nombre) : [...prev, nombre]
                          )}
                          className={cn(
                            "px-3 py-1.5 rounded-full text-[11px] font-label font-bold transition-all border truncate max-w-[220px]",
                            isSelected ? "text-white border-transparent shadow-sm" : "bg-transparent text-stone-500 border-stone-200 hover:border-stone-300"
                          )}
                          style={isSelected ? { backgroundColor: color, borderColor: color } : {}}>
                          {nombre}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ── Gráfica 1: Volumen total por hora ──────────────────────────── */}
                <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-8">
                  <div className="flex justify-between items-baseline mb-6">
                    <div>
                      <h3 className="text-2xl font-serif italic text-primary">Volumen por Hora del Día</h3>
                      <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mt-1">
                        Promedio acumulado — últimos {analyticsMonths} {analyticsMonths === 1 ? 'mes' : 'meses'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {(['unidades', 'tickets', 'ventas'] as const).map(m => (
                        <span key={m} className="text-[10px] font-label text-stone-400 uppercase tracking-widest px-2 py-1 bg-surface-container-low rounded">
                          {m === 'unidades' ? 'Unids' : m === 'tickets' ? 'Tickets' : '$'}
                        </span>
                      ))}
                    </div>
                  </div>
                  {/* Fix for ResponsiveContainer warning */}
                  <div className="h-64 w-full" style={{ minWidth: 0, minHeight: 0 }}>
                    <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                      <AreaChart data={hourLineData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gradUnidades" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#012d1d" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#012d1d" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gradTickets" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#7b5819" stopOpacity={0.12} />
                            <stop offset="95%" stopColor="#7b5819" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} interval={1} />
                        <YAxis tick={{ fontSize: 10, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} width={40} />
                        <Tooltip content={<HourTooltip />} />
                        <Area type="monotone" dataKey="unidades" name="Unidades" stroke="#012d1d" strokeWidth={2} fill="url(#gradUnidades)" dot={false} />
                        <Area type="monotone" dataKey="tickets"  name="Tickets"  stroke="#7b5819" strokeWidth={1.5} fill="url(#gradTickets)"  dot={false} strokeDasharray="4 2" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Peak hour indicators */}
                  {hourLineData.length > 0 && (() => {
                    const sorted = [...hourLineData].sort((a, b) => b.unidades - a.unidades);
                    const top3   = sorted.slice(0, 3);
                    return (
                      <div className="mt-6 flex gap-4 flex-wrap">
                        {top3.map((h, i) => (
                          <div key={i} className="flex items-center gap-3 bg-surface-container-low rounded-lg px-4 py-2">
                            <div className={cn("w-2 h-2 rounded-full", i === 0 ? "bg-primary" : i === 1 ? "bg-secondary" : "bg-stone-300")} />
                            <span className="font-serif text-xl text-on-surface">{h.label}</span>
                            <span className="text-[10px] font-label text-stone-500 uppercase tracking-widest">
                              {h.unidades.toLocaleString('es-MX')} uds · {h.tickets} tickets
                            </span>
                          </div>
                        ))}
                        <div className="ml-auto flex items-center gap-2 text-stone-400">
                          <Icon name="info" className="text-sm" />
                          <span className="text-[10px] font-label uppercase tracking-widest">Horas pico</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* ── Gráfica 2: Heatmap — producto × hora ──────────────────────── */}
                {selectedProducts.length > 0 && (
                  <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-8">
                    <div className="mb-6">
                      <h3 className="text-2xl font-serif italic text-primary">Mapa de Calor · Producto × Hora</h3>
                      <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mt-1">
                        Intensidad = unidades vendidas en ese rango horario
                      </p>
                    </div>

                    {/* Heatmap grid */}
                    <div className="overflow-x-auto">
                      <div style={{ minWidth: `${24 * 38 + 180}px` }}>
                        {/* Hora labels */}
                        <div className="flex mb-1" style={{ paddingLeft: '180px' }}>
                          {Array.from({ length: 24 }, (_, h) => (
                            <div key={h} className="text-[9px] font-label text-stone-400 text-center" style={{ width: '38px', flexShrink: 0 }}>{h}</div>
                          ))}
                        </div>
                        {/* Rows */}
                        {selectedProducts.map((nombre, pi) => {
                          const color = PROD_COLORS[pi % PROD_COLORS.length];
                          return (
                            <div key={nombre} className="flex items-center mb-1">
                              <div className="text-[10px] font-label text-stone-600 truncate pr-2 text-right" style={{ width: '180px', flexShrink: 0 }}>{nombre}</div>
                              {Array.from({ length: 24 }, (_, h) => {
                                const val  = heatmapData[h]?.[nombre] || 0;
                                const pct  = val / heatmapMax;
                                const opacity = val === 0 ? 0.04 : 0.1 + pct * 0.85;
                                return (
                                  <div
                                    key={h}
                                    title={`${nombre} · ${h}:00 — ${val} uds`}
                                    className="rounded-sm cursor-pointer transition-all hover:scale-110 hover:z-10 relative"
                                    style={{
                                      width: '34px', height: '28px', flexShrink: 0, margin: '0 2px',
                                      backgroundColor: color,
                                      opacity,
                                    }}
                                  >
                                    {val > 0 && pct > 0.5 && (
                                      <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold text-white">{val}</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 mt-4 justify-end">
                      <span className="text-[9px] font-label text-stone-400 uppercase">Sin ventas</span>
                      <div className="flex gap-1">
                        {[0.1, 0.3, 0.5, 0.7, 0.9].map((o, i) => (
                          <div key={i} className="w-5 h-3 rounded-sm" style={{ backgroundColor: '#012d1d', opacity: o }} />
                        ))}
                      </div>
                      <span className="text-[9px] font-label text-stone-400 uppercase">Mayor volumen</span>
                    </div>
                  </div>
                )}

                {/* ── Gráfica 3: Ventas por mes ─────────────────────────────────── */}
                <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-8">
                  <div className="flex justify-between items-baseline mb-6">
                    <div>
                      <h3 className="text-2xl font-serif italic text-primary">Volumen Mensual</h3>
                      <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mt-1">Unidades · Ingresos · Ganancia</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setAnalyticsMetric('unidadesVendidas')}
                        className={cn("px-4 py-1.5 rounded-lg text-[10px] font-label font-bold uppercase tracking-widest transition-all",
                          analyticsMetric === 'unidadesVendidas' ? "bg-primary text-on-primary" : "bg-surface-container-low text-stone-400 hover:bg-stone-200")}>
                        Unidades
                      </button>
                      <button onClick={() => setAnalyticsMetric('totalVentas')}
                        className={cn("px-4 py-1.5 rounded-lg text-[10px] font-label font-bold uppercase tracking-widest transition-all",
                          analyticsMetric === 'totalVentas' ? "bg-secondary text-on-primary" : "bg-surface-container-low text-stone-400 hover:bg-stone-200")}>
                        Ingresos $
                      </button>
                    </div>
                  </div>
                  {/* Fix for ResponsiveContainer warning */}
                  <div className="h-72 w-full" style={{ minWidth: 0, minHeight: 0 }}>
                    <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                      <BarChart data={monthChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 10, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} width={50}
                          tickFormatter={v => analyticsMetric === 'totalVentas' ? `$${(v/1000).toFixed(0)}k` : v.toLocaleString()} />
                        <Tooltip
                          formatter={(v: number, name: string) => [
                            analyticsMetric === 'totalVentas' ? `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : v.toLocaleString('es-MX'),
                            name
                          ]}
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        />
                        <Bar dataKey={analyticsMetric === 'unidadesVendidas' ? 'unidades' : 'ventas'} name={analyticsMetric === 'unidadesVendidas' ? 'Unidades' : 'Ingresos'} radius={[4, 4, 0, 0]}>
                          {monthChartData.map((_, i) => (
                            <Cell key={i} fill={i === monthChartData.length - 1 ? '#012d1d' : '#40916c'} opacity={0.7 + (i / monthChartData.length) * 0.3} />
                          ))}
                        </Bar>
                        {analyticsMetric === 'totalVentas' && (
                          <Bar dataKey="ganancia" name="Ganancia" radius={[4, 4, 0, 0]} fill="#7b5819" opacity={0.6} />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* ── Gráfica 4: Productos × Mes (stacked) ──────────────────────── */}
                {selectedProducts.length > 0 && productMonthData.length > 0 && (
                  <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-8">
                    <div className="mb-6">
                      <h3 className="text-2xl font-serif italic text-primary">Productos por Mes</h3>
                      <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mt-1">
                        {analyticsMetric === 'unidadesVendidas' ? 'Unidades vendidas' : 'Ingresos'} — productos seleccionados
                      </p>
                    </div>
                    {/* Fix for ResponsiveContainer warning */}
                    <div className="h-72 w-full" style={{ minWidth: 0, minHeight: 0 }}>
                      <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                        <BarChart data={productMonthData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} />
                          <YAxis tick={{ fontSize: 10, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} width={50}
                            tickFormatter={v => analyticsMetric === 'totalVentas' ? `$${(v/1000).toFixed(0)}k` : String(v)} />
                          <Tooltip
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                            formatter={(v: number) => [
                              analyticsMetric === 'totalVentas' ? `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : v.toLocaleString('es-MX')
                            ]}
                          />
                          <Legend wrapperStyle={{ fontSize: '10px', fontFamily: 'Inter' }} />
                          {selectedProducts.map((nombre, i) => (
                            <Bar key={nombre} dataKey={nombre} stackId="stack" fill={PROD_COLORS[i % PROD_COLORS.length]} radius={i === selectedProducts.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        );

      // ── REPORTES ──────────────────────────────────────────────────────────────
      case 'Reportes':
        return (
          <section className="p-8 max-w-7xl mx-auto w-full">
            <div className="flex justify-between items-end mb-8">
              <div>
                <h2 className="text-3xl font-serif italic text-primary">Reporte de Ventas</h2>
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-500 mt-1">Historial detallado de transacciones</p>
              </div>
              <button onClick={() => window.print()} className="px-6 py-2.5 bg-surface-container-low text-primary rounded-lg text-sm font-label font-bold flex items-center gap-2 hover:bg-stone-200 transition-all">
                <Icon name="download" className="text-lg" /> Exportar
              </button>
            </div>
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow-[0px_12px_32px_rgba(28,28,25,0.04)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container">
                    <tr>
                      <th className="px-6 py-4">Folio</th><th className="px-6 py-4">Hora</th>
                      <th className="px-6 py-4">Cajero</th><th className="px-6 py-4">Método</th>
                      <th className="px-6 py-4">Items</th><th className="px-6 py-4 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container">
                    {recentSales.map((s, i) => (
                      <tr key={i} className="hover:bg-background transition-colors">
                        <td className="px-6 py-4"><span className="font-label font-bold text-primary text-[10px] tracking-widest bg-primary-fixed/30 px-2 py-1 rounded">#{s.invoiceNumber}</span></td>
                        <td className="px-6 py-4 text-sm text-stone-500 font-body">{new Date(s.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="px-6 py-4 font-bold text-on-surface font-body text-sm">{s.cajero || 'Sistema'}</td>
                        <td className="px-6 py-4 capitalize">
                          <span className={cn("px-3 py-1 rounded-full text-[9px] font-label uppercase tracking-widest", s.paymentMethod === 'efectivo' ? "bg-primary-fixed text-on-primary-fixed-variant" : s.paymentMethod === 'tarjeta' ? "bg-secondary-fixed text-on-secondary-fixed-variant" : "bg-tertiary-fixed text-on-tertiary-fixed-variant")}>{s.paymentMethod}</span>
                        </td>
                        <td className="px-6 py-4 text-sm text-stone-500 font-body">{s.numProductos} artículos</td>
                        <td className="px-6 py-4 text-right font-serif text-lg text-primary font-bold">${s.total.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {recentSales.length === 0 && (
                <div className="py-20 flex flex-col items-center text-stone-300">
                  <Icon name="receipt_long" className="text-6xl opacity-20 mb-4" />
                  <p className="text-sm font-label uppercase tracking-widest">Sin ventas en el periodo</p>
                </div>
              )}
            </div>
          </section>
        );

      // ── ALERTAS ───────────────────────────────────────────────────────────────
      case 'Alertas':
        return (
          <section className="p-8 max-w-4xl mx-auto w-full">
            <div className="mb-10 text-center">
              <h2 className="text-4xl font-serif italic text-primary">Alertas de Inventario</h2>
              <p className="text-[11px] font-label uppercase tracking-[0.3em] text-stone-400 mt-2">Critical Stock Monitoring</p>
            </div>
            <div className="space-y-4">
              {lowStockProducts.length === 0 ? (
                <div className="bg-surface-container-low p-16 rounded-2xl border border-outline-variant/10 flex flex-col items-center text-center">
                  <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6"><Icon name="verified" className="text-4xl text-primary" /></div>
                  <h3 className="text-2xl font-serif text-primary">¡Todo en Orden!</h3>
                  <p className="text-sm text-stone-500 font-body mt-2 max-w-xs">Todos los niveles de inventario están por encima del mínimo requerido.</p>
                </div>
              ) : lowStockProducts.map(p => (
                <div key={p.id} className="bg-surface-container-lowest p-6 rounded-xl border border-error/15 shadow-[0px_4px_12px_rgba(186,26,26,0.04)] flex items-center gap-6 hover:shadow-lg transition-all group">
                  <div className="w-16 h-16 rounded-full bg-error-container/30 flex items-center justify-center text-error"><Icon name="warning" className="text-3xl" /></div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xl font-serif text-on-surface">{p.name}</h4>
                      <span className="text-[10px] text-stone-400 font-label font-bold uppercase tracking-widest">{p.barcode || 'Sin SKU'}</span>
                    </div>
                    <div className="flex items-center gap-4 mt-2">
                      <div className="flex items-center gap-1.5"><span className="text-[10px] font-label text-stone-400 uppercase">Actual</span><span className="font-serif text-lg text-error">{p.stock}</span></div>
                      <div className="w-px h-4 bg-surface-container" />
                      <div className="flex items-center gap-1.5"><span className="text-[10px] font-label text-stone-400 uppercase">Mínimo</span><span className="font-serif text-lg text-on-surface">{p.minStock}</span></div>
                      <div className="w-px h-4 bg-surface-container" />
                      <span className="text-[10px] font-label text-stone-500 bg-surface-container-low px-2 py-0.5 rounded uppercase tracking-wider">{p.category || 'General'}</span>
                    </div>
                  </div>
                  <button onClick={() => { setEditingProduct(p); setShowProductModal(true); }}
                    className="px-6 py-3 bg-primary text-on-primary rounded-lg text-xs font-label font-bold uppercase tracking-widest hover:bg-primary-container transition-all shadow-md">
                    Reabastecer
                  </button>
                </div>
              ))}
            </div>
          </section>
        );

      default: return null;
    }
  };

  // ── Layout ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen bg-background text-on-surface font-sans relative w-full overflow-hidden">
      {notification && <Notification msg={notification.message} type={notification.type} />}
      {showProductModal && <ProductModal />}

      {/* Sidebar */}
      <aside className="h-screen w-64 bg-stone-50 dark:bg-stone-950 border-r border-stone-200/50 flex flex-col py-6 space-y-2 sticky top-0 flex-shrink-0">
        <div className="px-6 mb-8">
          <h1 className="text-2xl font-serif text-primary">La Casita Deli</h1>
          <div className="flex items-center gap-2 mt-1">
            <div className={cn("w-1.5 h-1.5 rounded-full", dbStatus === 'ok' ? "bg-emerald-500 animate-pulse" : "bg-error")} />
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
              onClick={() => { setActiveTab(item.id); setSearchQuery(''); setCategoryFilter(''); }}
              className={cn("w-full flex items-center px-4 py-3 rounded-lg transition-all active:opacity-80 group",
                activeTab === item.id ? "bg-primary text-on-primary shadow-lg" : "text-stone-600 hover:bg-stone-200"
              )}>
              <Icon name={item.icon} className={cn("mr-3 text-xl", activeTab === item.id ? "text-on-primary" : "text-stone-400 group-hover:text-primary")} />
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
                  className={cn("px-4 py-1.5 rounded-md text-[10px] font-label font-bold uppercase tracking-widest transition-all",
                    timeFilter === p ? "bg-surface text-primary shadow-sm" : "text-stone-400 hover:text-stone-600")}>
                  {p}
                </button>
              ))}
            </div>
            <div className="flex items-center space-x-4 text-primary">
              <button onClick={fetchData} className={cn("p-2 hover:bg-stone-100 rounded-full transition-all", loading && "animate-spin")}><Icon name="refresh" className="text-xl" /></button>
              <div className="h-6 w-px bg-stone-200" />
              <div className="flex items-center gap-2 text-stone-500 font-label text-[10px] uppercase tracking-widest">
                <Icon name="calendar_today" className="text-lg" />
                <span>{new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</span>
              </div>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-20">
            <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
            <p className="font-serif italic text-primary text-xl">Loading editorial data...</p>
          </div>
        ) : renderContent()}

        <footer className="w-full mt-auto bg-stone-50 border-t border-stone-100 flex flex-col md:flex-row justify-between items-center px-12 py-10 font-label uppercase text-[9px] tracking-[0.3em] text-stone-400">
          <div>© 2024 La Casita Deli. Artisanal Quality.</div>
          <div className="flex space-x-8 mt-6 md:mt-0">
            <a className="hover:text-primary transition-all underline-offset-8 hover:underline" href="#">Provenance</a>
            <a className="hover:text-primary transition-all underline-offset-8 hover:underline" href="#">Shipping</a>
            <a className="hover:text-primary transition-all underline-offset-8 hover:underline" href="#">Contact</a>
            <a className="hover:text-primary transition-all underline-offset-8 hover:underline" href="#">Privacy</a>
          </div>
        </footer>
      </main>
    </div>
  );
}