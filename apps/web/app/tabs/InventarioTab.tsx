'use client';
import React, { useState, useEffect } from 'react';
import { cn } from '../lib/utils';
import { Icon } from '../components/Icon';
import type { Product, Category, Area } from '../lib/types';

const AREA_LABELS: Record<Area, string> = {
  bodega: 'Bodega', cocina: 'Cocina', tienda: 'Tienda', refrigerador: 'Refri', otro: 'Otro',
};
const AREA_COLORS: Record<Area, string> = {
  bodega: 'bg-blue-50 text-blue-700', cocina: 'bg-amber-50 text-amber-700',
  tienda: 'bg-green-50 text-green-700', refrigerador: 'bg-cyan-50 text-cyan-700', otro: 'bg-stone-100 text-stone-600',
};

interface Props {
  products:         Product[];
  lowStockProducts: Product[];
  categories:       Category[];
  onRefresh:        () => void;
  loading?:         boolean;
}

interface PanelState {
  stock:     string;
  salePrice: string;
  image:     string;
}

export default function InventarioTab({ products, lowStockProducts, categories, onRefresh, loading = false }: Props) {
  const [searchQuery,    setSearchQuery]    = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [areaFilter,     setAreaFilter]     = useState('');
  const [inventoryView,  setInventoryView]  = useState<'list' | 'grid'>('list');
  const [locationMap,    setLocationMap]    = useState<Map<string, Area>>(new Map());

  useEffect(() => {
    fetch('/api/bodega/products-by-area')
      .then(r => r.json())
      .then((data: { art_codigo: string; area: Area }[]) => {
        if (Array.isArray(data)) setLocationMap(new Map(data.map(r => [r.art_codigo, r.area])));
      })
      .catch(() => {/* silent */});
  }, [products]);

  // Edit side-panel
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [panel,          setPanel]          = useState<PanelState>({ stock: '', salePrice: '', image: '' });
  const [panelSaving,    setPanelSaving]    = useState(false);

  // Inline stock edit
  const [inlineId,  setInlineId]  = useState<string | null>(null);
  const [inlineVal, setInlineVal] = useState('');

  // Local notifications
  const [notif, setNotif] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 3000);
  };

  const filtered = products.filter(p => {
    const matchSearch = !searchQuery ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.barcode || '').includes(searchQuery);
    const matchCat  = !categoryFilter || p.category === categoryFilter;
    const matchArea = !areaFilter || (locationMap.get(String(p.id)) || 'bodega') === areaFilter;
    return matchSearch && matchCat && matchArea;
  });

  // ── Edit panel ──────────────────────────────────────────────────────────────
  const openPanel = (p: Product) => {
    setEditingProduct(p);
    setPanel({ stock: String(p.stock), salePrice: String(p.salePrice), image: p.image || '' });
  };

  const closePanel = () => { setEditingProduct(null); };

  const savePanel = async () => {
    if (!editingProduct) return;
    setPanelSaving(true);
    try {
      const res  = await fetch(`/api/products/${editingProduct.id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          stock:     parseFloat(panel.stock),
          salePrice: parseFloat(panel.salePrice),
          image:     panel.image || null,
        }),
      });
      const data = await res.json();
      if (res.ok) { notify(data.message || 'Guardado'); closePanel(); onRefresh(); }
      else        notify(data.error || 'Error al guardar', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally   { setPanelSaving(false); }
  };

  // ── Inline stock save ───────────────────────────────────────────────────────
  const saveInlineStock = async (id: string) => {
    const newStock = parseFloat(inlineVal);
    setInlineId(null);
    if (isNaN(newStock)) return;
    try {
      const res  = await fetch(`/api/products/${id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ stock: newStock }),
      });
      const data = await res.json();
      if (res.ok) { notify('Stock actualizado'); onRefresh(); }
      else        notify(data.error || 'Error', 'error');
    } catch { notify('Error de conexión', 'error'); }
  };

  return (
    <section className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">

      {/* Toast notification */}
      {notif && (
        <div className={cn(
          'fixed top-6 right-6 z-[300] px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-sm font-label font-bold transition-all',
          notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error'
        )}>
          <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
          {notif.msg}
        </div>
      )}

      {/* ── Edit side panel ─────────────────────────────────────────────────── */}
      {editingProduct && (
        <>
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[200]" onClick={closePanel} />
          <div className="fixed right-0 top-0 h-full w-[400px] bg-surface shadow-2xl z-[201] flex flex-col border-l border-outline-variant/15 overflow-hidden">

            {/* Panel header */}
            <div className="p-6 border-b border-outline-variant/10 bg-surface-container-low flex items-start justify-between flex-shrink-0">
              <div className="pr-4 min-w-0">
                <h3 className="font-serif text-xl text-primary">Editar Producto</h3>
                <p className="text-[10px] font-label text-stone-400 uppercase tracking-widest mt-0.5 truncate">{editingProduct.name}</p>
                {editingProduct.category && (
                  <span className="mt-2 inline-block text-[9px] font-label bg-primary/10 text-primary px-2 py-0.5 rounded-full uppercase tracking-widest">
                    {editingProduct.category}
                  </span>
                )}
              </div>
              <button onClick={closePanel} className="p-2 hover:bg-surface-variant rounded-full text-stone-400 transition-colors flex-shrink-0">
                <Icon name="close" />
              </button>
            </div>

            {/* Panel body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">

              {/* Stock */}
              <div className="space-y-2">
                <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest flex items-center gap-2">
                  <Icon name="inventory" className="text-sm" /> Cantidad en inventario
                </label>
                <input
                  type="number" min="0" step="1"
                  value={panel.stock}
                  onChange={e => setPanel(p => ({ ...p, stock: e.target.value }))}
                  className="w-full px-4 py-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-2xl font-serif focus:outline-none focus:border-primary transition-colors"
                />
                <p className="text-[9px] font-label text-stone-400 uppercase tracking-widest">
                  Actual: {editingProduct.stock} uds · actualiza ArticulosAlmacen
                </p>
              </div>

              {/* Sale Price */}
              <div className="space-y-2">
                <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest flex items-center gap-2">
                  <Icon name="sell" className="text-sm" /> Precio de venta
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400 font-body">$</span>
                  <input
                    type="number" min="0" step="0.01"
                    value={panel.salePrice}
                    onChange={e => setPanel(p => ({ ...p, salePrice: e.target.value }))}
                    className="w-full pl-8 pr-4 py-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-2xl font-serif focus:outline-none focus:border-primary transition-colors"
                  />
                </div>
                <p className="text-[9px] font-label text-stone-400 uppercase tracking-widest">
                  Actual: ${Number(editingProduct.salePrice).toFixed(2)} · actualiza ListaPreciosArt (lista 1)
                </p>
              </div>

              {/* Cost (read-only) */}
              <div className="space-y-2">
                <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">Costo (solo lectura)</label>
                <div className="px-4 py-3 bg-surface-container rounded-xl text-xl font-serif text-stone-400">
                  ${Number(editingProduct.costPrice).toFixed(2)}
                </div>
              </div>

              {/* Image URL */}
              <div className="space-y-2">
                <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest flex items-center gap-2">
                  <Icon name="image" className="text-sm" /> URL de imagen
                </label>
                <input
                  type="text"
                  value={panel.image}
                  onChange={e => setPanel(p => ({ ...p, image: e.target.value }))}
                  placeholder="https://..."
                  className="w-full px-4 py-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm font-body focus:outline-none focus:border-primary transition-colors"
                />
                {panel.image && (
                  <img
                    src={panel.image} alt=""
                    className="w-full h-36 object-cover rounded-xl border border-outline-variant/10 mt-2"
                    onError={e => ((e.target as HTMLImageElement).style.display = 'none')}
                  />
                )}
              </div>

              {/* Product details (read-only) */}
              {(editingProduct.barcode || editingProduct.brand) && (
                <div className="bg-surface-container-low rounded-xl p-4 space-y-2">
                  <p className="text-[9px] font-label uppercase tracking-widest text-stone-400">Información adicional</p>
                  {editingProduct.barcode && (
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-label text-stone-400">Código de barras</span>
                      <span className="font-label text-xs text-on-surface font-bold">{editingProduct.barcode}</span>
                    </div>
                  )}
                  {editingProduct.brand && (
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-label text-stone-400">Marca</span>
                      <span className="font-label text-xs text-on-surface">{editingProduct.brand}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Panel footer */}
            <div className="p-6 border-t border-outline-variant/10 flex gap-3 flex-shrink-0">
              <button onClick={closePanel}
                className="flex-1 py-3 bg-surface-variant text-on-surface-variant rounded-xl text-xs font-label font-bold uppercase tracking-widest hover:bg-stone-200 transition-all">
                Cancelar
              </button>
              <button onClick={savePanel} disabled={panelSaving}
                className={cn(
                  'flex-1 py-3 rounded-xl text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-md',
                  panelSaving
                    ? 'bg-stone-200 text-stone-400 cursor-not-allowed'
                    : 'bg-primary text-on-primary hover:bg-primary-container'
                )}>
                {panelSaving
                  ? <div className="w-4 h-4 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />
                  : <Icon name="save" className="text-base" />}
                Guardar
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="text-3xl font-serif italic text-primary">Inventario</h2>
          <p className="text-[10px] font-label uppercase tracking-widest text-stone-500 mt-1">
            {products.length.toLocaleString('es-MX')} productos · {lowStockProducts.length} alertas
          </p>
        </div>
      </div>

      {/* ── Table container ─────────────────────────────────────────────────── */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow-[0px_12px_32px_rgba(28,28,25,0.04)] overflow-hidden">

        {/* Toolbar */}
        <div className="p-6 border-b border-surface-container flex justify-between items-center bg-surface-container-low/30 flex-wrap gap-4">
          <div className="flex gap-3 flex-1 min-w-0 max-w-2xl">
            <div className="relative flex-1 min-w-0">
              <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-xl" />
              <input
                type="text"
                placeholder="Buscar producto o código..."
                className="w-full pl-10 pr-4 py-2 bg-background border-none rounded-lg text-sm outline-none focus:ring-1 focus:ring-primary font-body"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="px-4 py-2 bg-background border-none rounded-lg text-sm outline-none focus:ring-1 focus:ring-primary font-body cursor-pointer max-w-[180px]">
              <option value="">Todas las categorías</option>
              {categories.map((c, i) => (
                <option key={`${c.id}-${i}`} value={String(c.name)}>{c.name}</option>
              ))}
            </select>
            <select
              value={areaFilter}
              onChange={e => setAreaFilter(e.target.value)}
              className="px-4 py-2 bg-background border-none rounded-lg text-sm outline-none focus:ring-1 focus:ring-primary font-body cursor-pointer max-w-[150px]">
              <option value="">Todas las áreas</option>
              <option value="bodega">Bodega</option>
              <option value="cocina">Cocina</option>
              <option value="tienda">Tienda</option>
              <option value="refrigerador">Refrigerador</option>
              <option value="otro">Otro</option>
            </select>
          </div>
          <div className="flex bg-background p-1 rounded-lg border border-outline-variant/10">
            <button
              onClick={() => setInventoryView('list')}
              className={cn('p-1.5 rounded-md transition-all', inventoryView === 'list' ? 'bg-surface shadow-sm text-primary' : 'text-stone-400')}>
              <Icon name="list" className="text-lg" />
            </button>
            <button
              onClick={() => setInventoryView('grid')}
              className={cn('p-1.5 rounded-md transition-all', inventoryView === 'grid' ? 'bg-surface shadow-sm text-primary' : 'text-stone-400')}>
              <Icon name="grid_view" className="text-lg" />
            </button>
          </div>
        </div>

        {/* ── List view ─────────────────────────────────────────────────────── */}
        {inventoryView === 'list' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container">
                <tr>
                  <th className="px-6 py-4">Producto</th>
                  <th className="px-6 py-4 text-center">Stock</th>
                  <th className="px-6 py-4">Precio</th>
                  <th className="px-6 py-4">Estado</th>
                  <th className="px-6 py-4 text-right">Editar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {filtered.map((p, i) => (
                  <tr key={`${p.id}-${i}`} className="hover:bg-background transition-colors group">

                    {/* Product info */}
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-background flex items-center justify-center overflow-hidden border border-outline-variant/10 flex-shrink-0">
                          {p.image
                            ? <img src={p.image} className="w-full h-full object-cover" alt={p.name} />
                            : <Icon name="image" className="text-stone-300" />}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-on-surface font-body text-sm truncate max-w-[280px]">{p.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <p className="text-[10px] text-stone-400 font-label tracking-widest uppercase">
                              {p.category || 'Sin categoría'}
                            </p>
                            {(() => {
                              const area = locationMap.get(String(p.id));
                              if (area && area !== 'bodega') return (
                                <span className={cn('text-[8px] font-label font-bold px-1.5 py-0.5 rounded uppercase tracking-wider', AREA_COLORS[area])}>
                                  {AREA_LABELS[area]}
                                </span>
                              );
                              return null;
                            })()}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Inline stock edit */}
                    <td className="px-6 py-4 text-center">
                      {inlineId === String(p.id) ? (
                        <div className="flex items-center gap-1 justify-center">
                          <input
                            type="number" min="0" step="1"
                            value={inlineVal}
                            onChange={e => setInlineVal(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter')  saveInlineStock(String(p.id));
                              if (e.key === 'Escape') setInlineId(null);
                            }}
                            autoFocus
                            className="w-20 text-center py-1.5 px-2 bg-surface-container-low border border-primary/40 rounded-lg font-serif text-base outline-none focus:border-primary"
                          />
                          <button
                            onClick={() => saveInlineStock(String(p.id))}
                            className="p-1.5 text-primary hover:bg-primary/10 rounded-md transition-colors">
                            <Icon name="check" className="text-base" />
                          </button>
                          <button
                            onClick={() => setInlineId(null)}
                            className="p-1.5 text-stone-400 hover:bg-stone-100 rounded-md transition-colors">
                            <Icon name="close" className="text-base" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setInlineId(String(p.id)); setInlineVal(String(p.stock)); }}
                          className="group/s flex flex-col items-center hover:bg-primary/5 rounded-lg px-3 py-1 transition-colors w-full"
                          title="Clic para editar stock">
                          <span className={cn('font-serif text-xl', p.stock <= p.minStock ? 'text-error' : 'text-on-surface')}>
                            {p.stock}
                          </span>
                          <span className="text-[9px] text-stone-400 font-label flex items-center gap-1">
                            uds <Icon name="edit" className="text-[9px] opacity-0 group-hover/s:opacity-60 transition-opacity" />
                          </span>
                        </button>
                      )}
                    </td>

                    {/* Price */}
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold text-primary font-body">${Number(p.salePrice).toFixed(2)}</p>
                      <p className="text-[10px] text-stone-400 font-label">Costo: ${Number(p.costPrice).toFixed(2)}</p>
                    </td>

                    {/* Status badge */}
                    <td className="px-6 py-4">
                      <span className={cn(
                        'px-3 py-1 rounded-full text-[10px] font-label uppercase tracking-widest',
                        p.stock > p.minStock
                          ? 'bg-primary-fixed text-on-primary-fixed-variant'
                          : 'bg-error-container text-on-error-container'
                      )}>
                        {p.stock > p.minStock ? 'En Stock' : 'Stock Bajo'}
                      </span>
                    </td>

                    {/* Edit action */}
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => openPanel(p)}
                        className="p-2 hover:bg-primary-fixed/20 rounded-lg text-primary transition-all opacity-0 group-hover:opacity-100"
                        title="Editar producto">
                        <Icon name="edit" className="text-lg" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* ── Grid view ──────────────────────────────────────────────────────── */
          <div className="p-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {filtered.map((p, i) => (
              <div key={`${p.id}-${i}`} className="group bg-surface-container-low/30 rounded-xl p-4 hover:shadow-xl transition-all border border-transparent hover:border-outline-variant/20">
                <div className="aspect-square bg-background rounded-lg mb-4 overflow-hidden relative border border-outline-variant/10">
                  {p.image
                    ? <img src={p.image} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" alt={p.name} />
                    : <div className="w-full h-full flex items-center justify-center"><Icon name="image" className="text-stone-200 text-4xl" /></div>}
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openPanel(p)}
                      className="p-2 bg-surface rounded-lg text-primary shadow-sm hover:bg-primary hover:text-on-primary transition-all">
                      <Icon name="edit" className="text-sm" />
                    </button>
                  </div>
                </div>
                <p className="text-[9px] font-label font-bold text-primary uppercase tracking-[0.2em]">{p.category || 'General'}</p>
                <h4 className="font-serif text-base text-on-surface line-clamp-2 mt-1">{p.name}</h4>
                <div className="flex justify-between items-end mt-4">
                  <div>
                    <p className="text-[10px] font-label text-stone-500 uppercase">Stock</p>
                    <p className={cn('text-xl font-serif', p.stock <= p.minStock ? 'text-error' : 'text-on-surface')}>{p.stock}</p>
                  </div>
                  <p className="text-xl font-serif text-primary">${Number(p.salePrice).toFixed(2)}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {filtered.length === 0 && (
          <div className="py-20 flex flex-col items-center text-stone-300">
            {loading ? (
              <>
                <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
                <p className="text-sm font-label uppercase tracking-widest text-stone-400">Cargando inventario...</p>
              </>
            ) : (
              <>
                <Icon name="inventory_2" className="text-6xl opacity-20 mb-4" />
                <p className="text-sm font-label uppercase tracking-widest">Sin resultados</p>
              </>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-3 border-t border-surface-container bg-surface-container-low/30 flex items-center justify-between">
          <p className="text-[10px] font-label text-stone-400 uppercase tracking-widest">
            Mostrando {filtered.length.toLocaleString('es-MX')} de {products.length.toLocaleString('es-MX')} productos
            {lowStockProducts.length > 0 && (
              <span className="ml-2 text-error font-bold">· {lowStockProducts.length} bajo stock</span>
            )}
          </p>
          <p className="text-[9px] font-label text-stone-300 uppercase tracking-widest hidden md:block">
            Clic en stock para editar · icono de edición para más opciones
          </p>
        </div>
      </div>
    </section>
  );
}
