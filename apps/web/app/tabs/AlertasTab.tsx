'use client';
import React, { useState } from 'react';
import { cn } from '../lib/utils';
import { Icon } from '../components/Icon';
import type { Product } from '../lib/types';

interface Props {
  lowStockProducts: Product[];
  onRefresh:        () => void;
}

export default function AlertasTab({ lowStockProducts, onRefresh }: Props) {
  const [restockId,  setRestockId]  = useState<string | null>(null);
  const [restockVal, setRestockVal] = useState('');
  const [saving,     setSaving]     = useState(false);
  const [notif,      setNotif]      = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 3000);
  };

  const openRestock = (p: Product) => {
    setRestockId(String(p.id));
    setRestockVal(String(p.stock));
  };

  const cancelRestock = () => { setRestockId(null); setRestockVal(''); };

  const saveRestock = async (id: string) => {
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
    finally   { setSaving(false); }
  };

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
          {lowStockProducts.length === 0 ? 'Todo en orden' : `${lowStockProducts.length} productos bajo stock mínimo`}
        </p>
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {lowStockProducts.length === 0 ? (
          <div className="bg-surface-container-low p-12 lg:p-16 rounded-2xl border border-outline-variant/10 flex flex-col items-center text-center">
            <div className="w-16 h-16 lg:w-20 lg:h-20 bg-primary/10 rounded-full flex items-center justify-center mb-5">
              <Icon name="verified" className="text-3xl lg:text-4xl text-primary" />
            </div>
            <h3 className="text-xl lg:text-2xl font-serif text-primary">¡Todo en Orden!</h3>
            <p className="text-sm text-stone-500 font-body mt-2 max-w-xs">
              Todos los niveles de inventario están por encima del mínimo requerido.
            </p>
          </div>
        ) : lowStockProducts.map(p => {
          const isEditing = restockId === String(p.id);
          return (
            <div key={p.id}
              className={cn(
                'bg-surface-container-lowest rounded-xl border transition-all',
                isEditing
                  ? 'border-primary/30 shadow-lg'
                  : 'border-error/15 shadow-[0px_4px_12px_rgba(186,26,26,0.04)] hover:shadow-md'
              )}>

              {/* Main row */}
              <div className="p-4 sm:p-5 flex items-center gap-3 sm:gap-5">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-error-container/30 flex items-center justify-center text-error flex-shrink-0">
                  <Icon name="warning" className="text-2xl sm:text-3xl" />
                </div>

                <div className="flex-1 min-w-0">
                  <h4 className="text-base sm:text-lg font-serif text-on-surface truncate">{p.name}</h4>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-4 mt-1.5">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-label text-stone-400 uppercase">Stock actual</span>
                      <span className={cn('font-serif text-base sm:text-lg font-bold ml-1', p.stock === 0 ? 'text-error' : 'text-amber-600')}>
                        {p.stock}
                      </span>
                    </div>
                    <div className="w-px h-3 bg-surface-container hidden sm:block" />
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-label text-stone-400 uppercase">Mínimo</span>
                      <span className="font-serif text-base sm:text-lg text-on-surface ml-1">{p.minStock}</span>
                    </div>
                    {p.category && (
                      <>
                        <div className="w-px h-3 bg-surface-container hidden sm:block" />
                        <span className="text-[9px] font-label text-stone-500 bg-surface-container-low px-2 py-0.5 rounded uppercase tracking-wider">
                          {p.category}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Reabastecer button */}
                {!isEditing && (
                  <button
                    onClick={() => openRestock(p)}
                    className="flex-shrink-0 px-4 sm:px-6 py-2.5 bg-primary text-on-primary rounded-lg text-[11px] font-label font-bold uppercase tracking-widest hover:bg-primary-container transition-all shadow-md active:scale-95">
                    Reabastecer
                  </button>
                )}
              </div>

              {/* Inline restock form */}
              {isEditing && (
                <div className="px-4 sm:px-5 pb-4 sm:pb-5 border-t border-primary/10">
                  <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mt-4 mb-3">
                    Nueva cantidad en inventario
                  </p>
                  <div className="flex gap-2 items-center">
                    <div className="relative flex-1">
                      <Icon name="inventory" className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-lg" />
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={restockVal}
                        onChange={e => setRestockVal(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter')  saveRestock(String(p.id));
                          if (e.key === 'Escape') cancelRestock();
                        }}
                        autoFocus
                        placeholder="Ej: 50"
                        className="w-full pl-10 pr-4 py-3 bg-surface-container-low border border-primary/30 rounded-xl font-serif text-xl focus:outline-none focus:border-primary transition-colors"
                      />
                    </div>
                    <button
                      onClick={() => saveRestock(String(p.id))}
                      disabled={saving}
                      className={cn(
                        'px-5 py-3 rounded-xl text-sm font-label font-bold uppercase tracking-widest flex items-center gap-2 transition-all shadow-md flex-shrink-0',
                        saving ? 'bg-stone-200 text-stone-400' : 'bg-primary text-on-primary hover:bg-primary-container active:scale-95'
                      )}>
                      {saving
                        ? <div className="w-4 h-4 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />
                        : <Icon name="check" className="text-lg" />}
                      Guardar
                    </button>
                    <button
                      onClick={cancelRestock}
                      className="p-3 rounded-xl text-stone-400 hover:bg-surface-container transition-colors flex-shrink-0">
                      <Icon name="close" className="text-lg" />
                    </button>
                  </div>
                  <p className="text-[9px] font-label text-stone-400 mt-2 uppercase tracking-widest">
                    Actualiza ArticulosAlmacen · Enter para guardar · Esc para cancelar
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
