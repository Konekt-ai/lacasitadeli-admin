'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '../lib/utils';
import { Icon } from '../components/Icon';
import type { Product, BodegaAlerts } from '../lib/types';

interface Props {
  lowStockProducts: Product[];
  onRefresh:        () => void;
}

type CategoryId = 'lowStock' | 'expirySoon' | 'expired' | 'stagnant' | 'noSales';

interface AlertCategory {
  id:       CategoryId;
  label:    string;
  sub:      string;
  icon:     string;
  severity: 'critical' | 'warning' | 'info' | 'ok';
}

const CATEGORIES: AlertCategory[] = [
  { id: 'lowStock',   label: 'Stock Bajo',             sub: 'Productos por debajo del mínimo',      icon: 'inventory_2',    severity: 'critical' },
  { id: 'expired',    label: 'Productos Vencidos',      sub: 'Caducidad superada',                   icon: 'event_busy',     severity: 'critical' },
  { id: 'expirySoon', label: 'Próximos a Vencer',       sub: 'Vencen en los próximos 30 días',       icon: 'schedule',       severity: 'warning'  },
  { id: 'stagnant',   label: 'Inventario Estancado',    sub: 'Sin ventas en 30+ días',               icon: 'do_not_disturb', severity: 'warning'  },
  { id: 'noSales',    label: 'Sin Ventas Este Mes',     sub: 'Stock disponible sin movimiento',      icon: 'trending_down',  severity: 'info'     },
];

const SEVERITY_STYLES: Record<string, { card: string; badge: string; icon: string; count: string }> = {
  critical: {
    card:  'border-error/20 bg-error-container/5',
    badge: 'bg-error text-on-error',
    icon:  'text-error',
    count: 'text-error',
  },
  warning: {
    card:  'border-amber-200 bg-amber-50/30',
    badge: 'bg-amber-500 text-white',
    icon:  'text-amber-600',
    count: 'text-amber-600',
  },
  info: {
    card:  'border-blue-100 bg-blue-50/20',
    badge: 'bg-blue-500 text-white',
    icon:  'text-blue-500',
    count: 'text-blue-500',
  },
  ok: {
    card:  'border-outline-variant/10 bg-surface-container-lowest',
    badge: 'bg-primary-fixed text-on-primary-fixed-variant',
    icon:  'text-primary',
    count: 'text-primary',
  },
};

export default function AlertasTab({ lowStockProducts, onRefresh }: Props) {
  const [expanded,    setExpanded]    = useState<CategoryId | null>(null);
  const [bodegaData,  setBodegaData]  = useState<BodegaAlerts | null>(null);
  const [loadingBod,  setLoadingBod]  = useState(false);

  // Restock state
  const [restockId,  setRestockId]  = useState<string | null>(null);
  const [restockVal, setRestockVal] = useState('');
  const [saving,     setSaving]     = useState(false);
  const [notif, setNotif] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type }); setTimeout(() => setNotif(null), 3000);
  };

  const fetchBodegaAlerts = useCallback(async () => {
    setLoadingBod(true);
    try {
      const data = await fetch('/api/bodega/alerts').then(r => r.json());
      if (!data.error) setBodegaData(data);
    } catch { /* silent */ }
    finally { setLoadingBod(false); }
  }, []);

  useEffect(() => { fetchBodegaAlerts(); }, [fetchBodegaAlerts]);

  const getCount = (id: CategoryId): number => {
    if (id === 'lowStock')   return lowStockProducts.length;
    if (!bodegaData)         return 0;
    if (id === 'expirySoon') return bodegaData.totals.expirySoon;
    if (id === 'expired')    return bodegaData.totals.expired;
    if (id === 'stagnant')   return bodegaData.totals.stagnant;
    if (id === 'noSales')    return bodegaData.totals.noSales;
    return 0;
  };

  const totalAlerts = CATEGORIES.reduce((sum, c) => sum + getCount(c.id), 0);

  // ── Restock helpers ────────────────────────────────────────────────────────
  const openRestock  = (p: Product) => { setRestockId(String(p.id)); setRestockVal(String(p.stock)); };
  const cancelRestock = () => { setRestockId(null); setRestockVal(''); };
  const saveRestock  = async (id: string) => {
    const newStock = parseFloat(restockVal);
    if (isNaN(newStock) || newStock < 0) { cancelRestock(); return; }
    setSaving(true);
    try {
      const res  = await fetch(`/api/products/${id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ stock: newStock }),
      });
      const data = await res.json();
      if (res.ok) { notify('Stock actualizado'); cancelRestock(); onRefresh(); }
      else        notify(data.error || 'Error al guardar', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setSaving(false); }
  };

  // ── Category panel toggle ─────────────────────────────────────────────────
  const toggle = (id: CategoryId) => setExpanded(cur => cur === id ? null : id);

  return (
    <section className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full">

      {/* Toast */}
      {notif && (
        <div className={cn(
          'fixed top-4 right-4 z-[300] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-label font-bold',
          notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error'
        )}>
          <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
          {notif.msg}
        </div>
      )}

      {/* Title */}
      <div className="mb-8 text-center">
        <h2 className="text-3xl lg:text-4xl font-serif italic text-primary">Alertas de Inventario</h2>
        <p className="text-[11px] font-label uppercase tracking-[0.3em] text-stone-400 mt-2">
          {totalAlerts === 0
            ? 'Todo en orden'
            : `${totalAlerts} alertas activas · presiona una categoría para ver el detalle`}
        </p>
      </div>

      {/* All clear state */}
      {totalAlerts === 0 && !loadingBod && (
        <div className="bg-surface-container-low p-12 lg:p-16 rounded-2xl border border-outline-variant/10 flex flex-col items-center text-center">
          <div className="w-16 h-16 lg:w-20 lg:h-20 bg-primary/10 rounded-full flex items-center justify-center mb-5">
            <Icon name="verified" className="text-3xl lg:text-4xl text-primary" />
          </div>
          <h3 className="text-xl lg:text-2xl font-serif text-primary">¡Todo en Orden!</h3>
          <p className="text-sm text-stone-500 font-body mt-2 max-w-xs">
            No hay alertas activas en ninguna categoría.
          </p>
        </div>
      )}

      {/* Category accordion */}
      <div className="space-y-3">
        {CATEGORIES.map(cat => {
          const count   = getCount(cat.id);
          const styles  = SEVERITY_STYLES[count > 0 ? cat.severity : 'ok'];
          const isOpen  = expanded === cat.id;

          return (
            <div key={cat.id}
              className={cn(
                'rounded-xl border transition-all',
                count > 0 ? styles.card : 'border-outline-variant/10 bg-surface-container-lowest'
              )}>

              {/* Category header — always visible */}
              <button
                onClick={() => toggle(cat.id)}
                className="w-full flex items-center gap-4 p-5 text-left">
                <div className={cn(
                  'w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0',
                  count > 0 ? `${styles.badge} bg-opacity-15` : 'bg-surface-container'
                )}>
                  <Icon name={cat.icon}
                    className={cn('text-2xl', count > 0 ? styles.icon : 'text-stone-400')} />
                </div>

                <div className="flex-1 min-w-0">
                  <h4 className={cn('text-base font-serif', count > 0 ? 'text-on-surface' : 'text-stone-400')}>
                    {cat.label}
                  </h4>
                  <p className="text-[10px] font-label text-stone-400 uppercase tracking-widest mt-0.5">
                    {cat.sub}
                  </p>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  {loadingBod && cat.id !== 'lowStock' ? (
                    <div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                  ) : (
                    <span className={cn(
                      'min-w-[32px] text-center px-2 py-1 rounded-full text-sm font-serif font-bold',
                      count > 0 ? styles.count : 'text-stone-300'
                    )}>
                      {count}
                    </span>
                  )}
                  {count > 0 && (
                    <Icon
                      name={isOpen ? 'expand_less' : 'expand_more'}
                      className={cn('text-xl transition-transform', count > 0 ? styles.icon : 'text-stone-300')}
                    />
                  )}
                </div>
              </button>

              {/* Expanded detail */}
              {isOpen && count > 0 && (
                <div className="border-t border-surface-container px-5 pb-5 pt-4">
                  {cat.id === 'lowStock' && (
                    <LowStockList
                      products={lowStockProducts}
                      restockId={restockId}
                      restockVal={restockVal}
                      saving={saving}
                      onOpenRestock={openRestock}
                      onCancelRestock={cancelRestock}
                      onSaveRestock={saveRestock}
                      onRestockValChange={setRestockVal}
                    />
                  )}
                  {cat.id === 'expirySoon' && bodegaData && (
                    <ExpiryList records={bodegaData.expirySoon} />
                  )}
                  {cat.id === 'expired' && bodegaData && (
                    <ExpiryList records={bodegaData.expired} isExpired />
                  )}
                  {cat.id === 'stagnant' && bodegaData && (
                    <StagnantList products={bodegaData.stagnant} />
                  )}
                  {cat.id === 'noSales' && bodegaData && (
                    <StagnantList products={bodegaData.noSales} noSalesMode />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Sub-lists ─────────────────────────────────────────────────────────────────

function LowStockList({
  products, restockId, restockVal, saving,
  onOpenRestock, onCancelRestock, onSaveRestock, onRestockValChange,
}: {
  products: Product[];
  restockId: string | null; restockVal: string; saving: boolean;
  onOpenRestock: (p: Product) => void;
  onCancelRestock: () => void;
  onSaveRestock: (id: string) => void;
  onRestockValChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      {products.map(p => {
        const isEditing = restockId === String(p.id);
        return (
          <div key={p.id}
            className={cn(
              'bg-surface-container-lowest rounded-xl border transition-all',
              isEditing ? 'border-primary/30 shadow-lg' : 'border-error/10'
            )}>
            <div className="p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-serif text-on-surface truncate">{p.name}</h4>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="text-[9px] font-label text-stone-400 uppercase">Stock</span>
                  <span className={cn('font-serif text-base font-bold', p.stock === 0 ? 'text-error' : 'text-amber-600')}>
                    {p.stock}
                  </span>
                  <span className="text-stone-200">·</span>
                  <span className="text-[9px] font-label text-stone-400 uppercase">Mín</span>
                  <span className="font-serif text-base text-on-surface">{p.minStock}</span>
                  {p.category && (
                    <span className="text-[9px] font-label text-stone-500 bg-surface-container px-2 py-0.5 rounded uppercase tracking-wider">
                      {p.category}
                    </span>
                  )}
                </div>
              </div>
              {!isEditing && (
                <button onClick={() => onOpenRestock(p)}
                  className="flex-shrink-0 px-4 py-2 bg-primary text-on-primary rounded-lg text-[10px] font-label font-bold uppercase tracking-widest hover:bg-primary-container transition-all shadow-sm">
                  Reabastecer
                </button>
              )}
            </div>

            {isEditing && (
              <div className="px-4 pb-4 border-t border-primary/10">
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mt-3 mb-2">
                  Nueva cantidad en inventario
                </p>
                <div className="flex gap-2 items-center">
                  <div className="relative flex-1">
                    <Icon name="inventory" className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-lg" />
                    <input
                      type="number" min="0" step="1"
                      value={restockVal}
                      onChange={e => onRestockValChange(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter')  onSaveRestock(String(p.id));
                        if (e.key === 'Escape') onCancelRestock();
                      }}
                      autoFocus
                      placeholder="Ej: 50"
                      className="w-full pl-10 pr-4 py-2.5 bg-surface-container-low border border-primary/30 rounded-xl font-serif text-xl focus:outline-none focus:border-primary transition-colors"
                    />
                  </div>
                  <button onClick={() => onSaveRestock(String(p.id))} disabled={saving}
                    className={cn(
                      'px-4 py-2.5 rounded-xl text-sm font-label font-bold uppercase tracking-widest flex items-center gap-2 transition-all shadow-md flex-shrink-0',
                      saving ? 'bg-stone-200 text-stone-400' : 'bg-primary text-on-primary hover:bg-primary-container'
                    )}>
                    {saving
                      ? <div className="w-4 h-4 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />
                      : <Icon name="check" className="text-lg" />}
                  </button>
                  <button onClick={onCancelRestock}
                    className="p-2.5 rounded-xl text-stone-400 hover:bg-surface-container transition-colors flex-shrink-0">
                    <Icon name="close" className="text-lg" />
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ExpiryList({ records, isExpired = false }: { records: { id: number; nombre: string | null; art_codigo: string; fecha_caducidad: string; cantidad: number; area: string }[]; isExpired?: boolean }) {
  return (
    <div className="space-y-2">
      {records.map(r => (
        <div key={r.id} className={cn(
          'rounded-xl border p-3.5 flex items-center gap-3',
          isExpired ? 'bg-error-container/10 border-error/15' : 'bg-amber-50/50 border-amber-200/50'
        )}>
          <Icon name="event_busy" className={cn('text-xl flex-shrink-0', isExpired ? 'text-error' : 'text-amber-600')} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-body text-on-surface truncate">{r.nombre || r.art_codigo}</p>
            <p className="text-[10px] font-label text-stone-400 mt-0.5">
              {isExpired ? 'Venció:' : 'Vence:'}{' '}
              {new Date(r.fecha_caducidad + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}
              {r.cantidad > 0 && ` · ${r.cantidad} uds`}
              {` · ${r.area}`}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function StagnantList({ products, noSalesMode = false }: { products: { id: string; name: string; stock: number; category: string | null; ultima_venta?: string | null }[]; noSalesMode?: boolean }) {
  return (
    <div className="space-y-2">
      {products.map(p => (
        <div key={p.id} className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-3.5 flex items-center gap-3">
          <Icon name={noSalesMode ? 'trending_down' : 'do_not_disturb'} className="text-xl text-stone-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-body text-on-surface truncate">{p.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] font-label text-stone-400">Stock: {p.stock}</span>
              {p.category && (
                <span className="text-[9px] font-label text-stone-400 bg-surface-container px-2 py-0.5 rounded uppercase tracking-wider">
                  {p.category}
                </span>
              )}
              {!noSalesMode && 'ultima_venta' in p && (
                <span className="text-[10px] font-label text-stone-400">
                  · Últ. venta: {p.ultima_venta
                    ? new Date(p.ultima_venta).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
                    : 'Sin registro'}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
