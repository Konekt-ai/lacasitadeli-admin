'use client';
import React from 'react';
import { cn } from '../lib/utils';
import { Icon } from './Icon';
import type { Product, Category } from '../lib/types';

interface Props {
  editingProduct: Product | null;
  categories: Category[];
  onSave: (e: React.FormEvent) => Promise<void>;
  onClose: () => void;
}

export const ProductModal = ({ editingProduct, categories, onSave, onClose }: Props) => (
  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
    <div className="bg-surface rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden border border-outline-variant/15">
      <div className="p-6 border-b border-surface-variant flex justify-between items-center bg-surface-container-low">
        <div>
          <h3 className="text-xl font-serif text-primary">{editingProduct ? 'Editar Producto' : 'Nuevo Producto'}</h3>
          <p className="text-[10px] text-stone-500 font-label uppercase tracking-widest mt-1">Terminal de Administración</p>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-surface-variant rounded-full text-stone-400 transition-colors">
          <Icon name="close" />
        </button>
      </div>
      <form onSubmit={onSave} className="p-6 space-y-4 overflow-y-auto max-h-[75vh]">
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
          <button type="button" onClick={onClose}
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
