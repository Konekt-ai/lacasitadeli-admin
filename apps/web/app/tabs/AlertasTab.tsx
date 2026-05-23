'use client';
import React from 'react';
import { cn } from '../lib/utils';
import { Icon } from '../components/Icon';
import type { Product } from '../lib/types';

interface Props {
  lowStockProducts: Product[];
  onRestock: (product: Product) => void;
}

export default function AlertasTab({ lowStockProducts, onRestock }: Props) {
  return (
    <section className="p-8 max-w-4xl mx-auto w-full">
      <div className="mb-10 text-center">
        <h2 className="text-4xl font-serif italic text-primary">Alertas de Inventario</h2>
        <p className="text-[11px] font-label uppercase tracking-[0.3em] text-stone-400 mt-2">Critical Stock Monitoring</p>
      </div>
      <div className="space-y-4">
        {lowStockProducts.length === 0 ? (
          <div className="bg-surface-container-low p-16 rounded-2xl border border-outline-variant/10 flex flex-col items-center text-center">
            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6">
              <Icon name="verified" className="text-4xl text-primary" />
            </div>
            <h3 className="text-2xl font-serif text-primary">¡Todo en Orden!</h3>
            <p className="text-sm text-stone-500 font-body mt-2 max-w-xs">Todos los niveles de inventario están por encima del mínimo requerido.</p>
          </div>
        ) : lowStockProducts.map(p => (
          <div key={p.id} className="bg-surface-container-lowest p-6 rounded-xl border border-error/15 shadow-[0px_4px_12px_rgba(186,26,26,0.04)] flex items-center gap-6 hover:shadow-lg transition-all group">
            <div className="w-16 h-16 rounded-full bg-error-container/30 flex items-center justify-center text-error">
              <Icon name="warning" className="text-3xl" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h4 className="text-xl font-serif text-on-surface">{p.name}</h4>
                <span className="text-[10px] text-stone-400 font-label font-bold uppercase tracking-widest">{p.barcode || 'Sin SKU'}</span>
              </div>
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-label text-stone-400 uppercase">Actual</span>
                  <span className="font-serif text-lg text-error">{p.stock}</span>
                </div>
                <div className="w-px h-4 bg-surface-container" />
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-label text-stone-400 uppercase">Mínimo</span>
                  <span className="font-serif text-lg text-on-surface">{p.minStock}</span>
                </div>
                <div className="w-px h-4 bg-surface-container" />
                <span className="text-[10px] font-label text-stone-500 bg-surface-container-low px-2 py-0.5 rounded uppercase tracking-wider">{p.category || 'General'}</span>
              </div>
            </div>
            <button
              onClick={() => onRestock(p)}
              className="px-6 py-3 bg-primary text-on-primary rounded-lg text-xs font-label font-bold uppercase tracking-widest hover:bg-primary-container transition-all shadow-md">
              Reabastecer
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
