'use client';
import React, { useState } from 'react';
import { cn } from '../lib/utils';
import { Icon } from '../components/Icon';
import type { Product, Category } from '../lib/types';

interface Props {
  products:         Product[];
  lowStockProducts: Product[];
  categories:       Category[];
  onEdit:           (product: Product) => void;
  onDelete:         (id: number) => void;
}

export default function InventarioTab({ products, lowStockProducts, categories, onEdit, onDelete }: Props) {
  const [searchQuery,    setSearchQuery]    = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [inventoryView,  setInventoryView]  = useState<'list' | 'grid'>('list');

  const filtered = products.filter(p => {
    const matchSearch = !searchQuery ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.barcode || '').includes(searchQuery);
    const matchCat = !categoryFilter || String(p.categoryId) === categoryFilter;
    return matchSearch && matchCat;
  });

  return (
    <section className="p-8 max-w-7xl mx-auto w-full">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="text-3xl font-serif italic text-primary">Inventario</h2>
          <p className="text-[10px] font-label uppercase tracking-widest text-stone-500 mt-1">{products.length} productos · {lowStockProducts.length} alertas</p>
        </div>
        <button onClick={() => onEdit(null as any)}
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
            <button onClick={() => setInventoryView('list')} className={cn('p-1.5 rounded-md transition-all', inventoryView === 'list' ? 'bg-surface shadow-sm text-primary' : 'text-stone-400')}>
              <Icon name="list" className="text-lg" />
            </button>
            <button onClick={() => setInventoryView('grid')} className={cn('p-1.5 rounded-md transition-all', inventoryView === 'grid' ? 'bg-surface shadow-sm text-primary' : 'text-stone-400')}>
              <Icon name="grid_view" className="text-lg" />
            </button>
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
                {filtered.map(p => (
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
                      <span className={cn('font-serif text-lg', p.stock <= p.minStock ? 'text-error' : 'text-on-surface')}>{p.stock}</span>
                      <span className="text-[10px] text-stone-400 font-label block">unidades</span>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold text-primary font-body">${Number(p.salePrice).toFixed(2)}</p>
                      <p className="text-[10px] text-stone-400 font-label">Costo: ${Number(p.costPrice).toFixed(2)}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn('px-3 py-1 rounded-full text-[10px] font-label uppercase tracking-widest', p.stock > p.minStock ? 'bg-primary-fixed text-on-primary-fixed-variant' : 'bg-error-container text-on-error-container')}>
                        {p.stock > p.minStock ? 'En Stock' : 'Bajo'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => onEdit(p)} className="p-2 hover:bg-primary-fixed/20 rounded-lg text-primary transition-all"><Icon name="edit" className="text-lg" /></button>
                        <button onClick={() => onDelete(p.id)} className="p-2 hover:bg-error-container/20 rounded-lg text-error transition-all"><Icon name="delete" className="text-lg" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {filtered.map(p => (
              <div key={p.id} className="group bg-surface-container-low/30 rounded-xl p-4 hover:shadow-xl transition-all border border-transparent hover:border-outline-variant/20">
                <div className="aspect-square bg-background rounded-lg mb-4 overflow-hidden relative border border-outline-variant/10">
                  {p.image
                    ? <img src={p.image} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" alt={p.name} />
                    : <div className="w-full h-full flex items-center justify-center"><Icon name="image" className="text-stone-200 text-4xl" /></div>}
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => onEdit(p)} className="p-2 bg-surface rounded-lg text-primary shadow-sm hover:bg-primary hover:text-on-primary transition-all"><Icon name="edit" className="text-sm" /></button>
                  </div>
                </div>
                <p className="text-[9px] font-label font-bold text-primary uppercase tracking-[0.2em]">{p.category || 'General'}</p>
                <h4 className="font-serif text-lg text-on-surface line-clamp-1 mt-1">{p.name}</h4>
                <div className="flex justify-between items-end mt-4">
                  <div>
                    <p className="text-[10px] font-label text-stone-500 uppercase">Stock</p>
                    <p className={cn('text-xl font-serif', p.stock <= p.minStock ? 'text-error' : 'text-on-surface')}>{p.stock}</p>
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
}
