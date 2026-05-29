'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '../lib/utils';
import { Icon } from '../components/Icon';
import type {
  Area, AreaConfig, AreaCount, AreaProduct, ExpiryRecord,
  SurtidoTransfer, Recuento, StagnantProduct,
  StockUbicacion, ResumenUbicacion, MovimientoUnificado, TipoMovimiento,
} from '../lib/types';

// ── Sub-view config ────────────────────────────────────────────────────────────
type SubView = 'areas' | 'ubicaciones' | 'merma' | 'surtido' | 'discrepancias' | 'conteo' | 'facturas' | 'zebra' | 'config';
const SUB_VIEWS: { id: SubView; label: string; icon: string; dev?: boolean }[] = [
  { id: 'ubicaciones',   label: 'Ubicaciones',     icon: 'inventory_2' },
  { id: 'areas',         label: 'Asignar Áreas',   icon: 'warehouse' },
  { id: 'merma',         label: 'Merma / Caducidad', icon: 'event_busy' },
  { id: 'surtido',       label: 'Surtido',         icon: 'swap_horiz' },
  { id: 'discrepancias', label: 'Discrepancias',   icon: 'difference' },
  { id: 'conteo',        label: 'Conteo Ventas',   icon: 'calculate' },
  { id: 'facturas',      label: 'Facturas PDF',    icon: 'receipt_long', dev: true },
  { id: 'zebra',         label: 'Movimientos TC52', icon: 'qr_code_scanner' },
  { id: 'config',        label: 'Configurar Áreas', icon: 'tune' },
];

type AreaMeta = { label: string; icon: string; color: string; bg: string };
const DEFAULT_areaMap: Record<string, AreaMeta> = {
  bodega:       { label: 'Bodega',       icon: 'warehouse',    color: 'text-blue-700',  bg: 'bg-blue-50' },
  cocina:       { label: 'Cocina',       icon: 'restaurant',   color: 'text-amber-700', bg: 'bg-amber-50' },
  tienda:       { label: 'Tienda',       icon: 'storefront',   color: 'text-green-700', bg: 'bg-green-50' },
  refrigerador: { label: 'Refrigerador', icon: 'ac_unit',      color: 'text-cyan-700',  bg: 'bg-cyan-50' },
  otro:         { label: 'Otro',         icon: 'category',     color: 'text-stone-600', bg: 'bg-stone-100' },
};
const DEFAULT_areas = Object.keys(DEFAULT_areaMap);
const FALLBACK_META: AreaMeta = { label: '—', icon: 'category', color: 'text-stone-500', bg: 'bg-stone-100' };

interface AreasCtxValue {
  areas:       string[];
  areaMap:     Record<string, AreaMeta>;
  reloadAreas: () => void;
}
const AreasCtx = React.createContext<AreasCtxValue>({
  areas:       DEFAULT_areas,
  areaMap:     DEFAULT_areaMap,
  reloadAreas: () => {},
});
const useAreasCtx = () => React.useContext(AreasCtx);

const PALETA_COLORES = [
  { bg: 'bg-blue-50',    text: 'text-blue-700',   nombre: 'Azul' },
  { bg: 'bg-amber-50',   text: 'text-amber-700',  nombre: 'Ámbar' },
  { bg: 'bg-green-50',   text: 'text-green-700',  nombre: 'Verde' },
  { bg: 'bg-cyan-50',    text: 'text-cyan-700',   nombre: 'Cyan' },
  { bg: 'bg-purple-50',  text: 'text-purple-700', nombre: 'Morado' },
  { bg: 'bg-rose-50',    text: 'text-rose-700',   nombre: 'Rosa' },
  { bg: 'bg-stone-100',  text: 'text-stone-600',  nombre: 'Gris' },
  { bg: 'bg-orange-50',  text: 'text-orange-700', nombre: 'Naranja' },
  { bg: 'bg-teal-50',    text: 'text-teal-700',   nombre: 'Teal' },
  { bg: 'bg-indigo-50',  text: 'text-indigo-700', nombre: 'Índigo' },
  { bg: 'bg-pink-50',    text: 'text-pink-700',   nombre: 'Rosa oscuro' },
  { bg: 'bg-emerald-50', text: 'text-emerald-700',nombre: 'Esmeralda' },
];
const ICONOS_DISPONIBLES = [
  'warehouse', 'storefront', 'restaurant', 'ac_unit', 'category',
  'inventory_2', 'local_shipping', 'delivery_dining', 'store',
  'home', 'business', 'place', 'directions_car', 'kitchen',
  'science', 'thermostat', 'shopping_basket', 'recycling',
];

// ── Dev-in-progress placeholder ────────────────────────────────────────────────
function DevPlaceholder({ label, icon }: { label: string; icon: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-8 text-center">
      <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
        <Icon name={icon} className="text-4xl text-primary" />
      </div>
      <h3 className="text-2xl font-serif text-primary mb-2">{label}</h3>
      <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-full border border-amber-200 text-xs font-label font-bold uppercase tracking-widest mt-2">
        <Icon name="construction" className="text-base" />
        En Desarrollo
      </div>
      <p className="text-sm text-stone-400 font-body mt-4 max-w-sm">
        Esta función está siendo desarrollada y estará disponible próximamente. Regresa pronto.
      </p>
    </div>
  );
}

// ── Áreas sub-view ─────────────────────────────────────────────────────────────
function AreasView() {
  const { areas, areaMap } = useAreasCtx();
  const [counts,        setCounts]        = useState<AreaCount[]>([]);
  const [selectedArea,  setSelectedArea]  = useState<Area | null>(null);
  const [areaProducts,  setAreaProducts]  = useState<AreaProduct[]>([]);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [loadingProds,  setLoadingProds]  = useState(false);
  const [search,        setSearch]        = useState('');
  const [reassignId,    setReassignId]    = useState<string | null>(null);
  const [notif, setNotif] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 3000);
  };

  const fetchCounts = useCallback(async () => {
    setLoadingCounts(true);
    try {
      const data = await fetch('/api/bodega/area-counts').then(r => r.json());
      if (Array.isArray(data)) setCounts(data);
    } catch { /* silent */ }
    finally { setLoadingCounts(false); }
  }, []);

  const fetchAreaProducts = useCallback(async (area: Area, q = '') => {
    setLoadingProds(true);
    try {
      const url  = `/api/bodega/areas/${area}/products${q ? `?search=${encodeURIComponent(q)}` : ''}`;
      const data = await fetch(url).then(r => r.json());
      setAreaProducts(Array.isArray(data) ? data : []);
    } catch { setAreaProducts([]); }
    finally { setLoadingProds(false); }
  }, []);

  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  useEffect(() => {
    if (selectedArea) fetchAreaProducts(selectedArea, search);
  }, [selectedArea, fetchAreaProducts]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedArea) fetchAreaProducts(selectedArea, search);
  };

  const reassign = async (artCodigo: string, newArea: Area) => {
    try {
      const res  = await fetch(`/api/bodega/products/${artCodigo}/location`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ area: newArea }),
      });
      const data = await res.json();
      if (res.ok) {
        notify(`Movido a ${areaMap[newArea].label}`);
        setReassignId(null);
        if (selectedArea) fetchAreaProducts(selectedArea, search);
        fetchCounts();
      } else notify(data.error || 'Error', 'error');
    } catch { notify('Error de conexión', 'error'); }
  };

  if (!selectedArea) {
    return (
      <div>
        {notif && (
          <div className={cn(
            'fixed top-4 right-4 z-[300] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-label font-bold',
            notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error'
          )}>
            <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
            {notif.msg}
          </div>
        )}
        <p className="text-[11px] font-label uppercase tracking-widest text-stone-400 mb-6">
          Selecciona un área para ver los productos asignados
        </p>
        {loadingCounts ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-3 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {areas.map(area => {
              const meta  = areaMap[area];
              const count = counts.find(c => c.area === area)?.total ?? 0;
              return (
                <button key={area}
                  onClick={() => { setSelectedArea(area); setSearch(''); }}
                  className="group bg-surface-container-lowest rounded-xl p-5 border border-outline-variant/10 hover:border-primary/30 hover:shadow-lg transition-all text-left flex flex-col gap-3">
                  <div className={cn('w-12 h-12 rounded-full flex items-center justify-center', meta.bg)}>
                    <Icon name={meta.icon} className={cn('text-2xl', meta.color)} />
                  </div>
                  <div>
                    <p className="font-serif text-lg text-on-surface">{meta.label}</p>
                    <p className={cn('text-2xl font-serif font-bold mt-1', meta.color)}>{count}</p>
                    <p className="text-[9px] font-label uppercase tracking-widest text-stone-400">
                      {count === 1 ? 'producto' : 'productos'}
                      {area === 'bodega' && count === 0 && (
                        <span className="ml-1">(todos)</span>
                      )}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <p className="text-[10px] font-label text-stone-400 mt-4 text-center">
          Los productos sin área asignada se encuentran en Bodega por defecto
        </p>
      </div>
    );
  }

  const meta = areaMap[selectedArea];
  return (
    <div>
      {notif && (
        <div className={cn(
          'fixed top-4 right-4 z-[300] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-label font-bold',
          notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error'
        )}>
          <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
          {notif.msg}
        </div>
      )}

      {/* Back + header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => { setSelectedArea(null); setSearch(''); setAreaProducts([]); }}
          className="p-2 hover:bg-stone-100 rounded-full text-stone-500 transition-colors">
          <Icon name="arrow_back" className="text-xl" />
        </button>
        <div className={cn('w-10 h-10 rounded-full flex items-center justify-center', meta.bg)}>
          <Icon name={meta.icon} className={cn('text-xl', meta.color)} />
        </div>
        <div>
          <h3 className="font-serif text-xl text-primary">{meta.label}</h3>
          <p className="text-[10px] font-label uppercase tracking-widest text-stone-400">
            {areaProducts.length} productos
          </p>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-5">
        <div className="relative flex-1">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-xl" />
          <input
            type="text"
            placeholder="Buscar producto o código..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-background border border-outline-variant/20 rounded-xl text-sm font-body outline-none focus:border-primary transition-colors"
          />
        </div>
        <button type="submit"
          className="px-4 py-2.5 bg-primary text-on-primary rounded-xl text-xs font-label font-bold uppercase tracking-widest">
          Buscar
        </button>
      </form>

      {/* Products table */}
      {loadingProds ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container">
              <tr>
                <th className="px-5 py-3">Producto</th>
                <th className="px-5 py-3 text-center">Stock</th>
                <th className="px-5 py-3">Categoría</th>
                <th className="px-5 py-3 text-right">Mover a</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container">
              {areaProducts.map(p => (
                <tr key={p.id} className="hover:bg-background transition-colors group">
                  <td className="px-5 py-3">
                    <p className="text-sm font-body text-on-surface">{p.name}</p>
                    <p className="text-[9px] font-label text-stone-400 mt-0.5">{p.id}</p>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className="font-serif text-lg text-on-surface">{p.stock}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-[10px] font-label text-stone-500 bg-surface-container px-2 py-0.5 rounded uppercase tracking-wider">
                      {p.category || 'Sin categoría'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {reassignId === p.id ? (
                      <div className="flex gap-1 justify-end flex-wrap">
                        {areas.filter(a => a !== selectedArea).map(a => (
                          <button key={a}
                            onClick={() => reassign(p.id, a)}
                            className={cn(
                              'px-2 py-1 rounded-lg text-[9px] font-label font-bold uppercase tracking-wider transition-all',
                              areaMap[a].bg, areaMap[a].color
                            )}>
                            {areaMap[a].label}
                          </button>
                        ))}
                        <button onClick={() => setReassignId(null)}
                          className="p-1 text-stone-400 hover:text-stone-600 rounded-lg">
                          <Icon name="close" className="text-sm" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setReassignId(p.id)}
                        className="opacity-0 group-hover:opacity-100 px-3 py-1.5 bg-surface-container text-stone-500 rounded-lg text-[10px] font-label hover:bg-primary/10 hover:text-primary transition-all">
                        <Icon name="swap_horiz" className="text-sm" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {areaProducts.length === 0 && (
            <div className="py-14 flex flex-col items-center text-stone-300">
              <Icon name="inventory_2" className="text-5xl mb-3 opacity-20" />
              <p className="text-sm font-label uppercase tracking-widest">Sin productos en esta área</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Ubicaciones — stock actual por área ──────────────────────────────────────

function UbicacionesView() {
  const { areas, areaMap } = useAreasCtx();
  const [rows,    setRows]    = useState<StockUbicacion[]>([]);
  const [resumen, setResumen] = useState<ResumenUbicacion[]>([]);
  const [loading, setLoading] = useState(false);
  const [search,  setSearch]  = useState('');
  const [areaFiltro, setAreaFiltro] = useState<string>('todas');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dataRows, dataResumen] = await Promise.all([
        fetch('/api/almacen/ubicaciones').then(r => r.json()),
        fetch('/api/almacen/ubicaciones/resumen').then(r => r.json()),
      ]);
      setRows(Array.isArray(dataRows) ? dataRows : []);
      setResumen(Array.isArray(dataResumen) ? dataResumen : []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Agrupar por producto para tabla pivot
  type Pivot = { codigo: string; nombre: string | null; areas: Partial<Record<string, number>>; total: number };
  const pivot = useMemo<Pivot[]>(() => {
    const map = new Map<string, Pivot>();
    for (const r of rows) {
      if (!map.has(r.art_codigo)) map.set(r.art_codigo, { codigo: r.art_codigo, nombre: r.nombre, areas: {}, total: 0 });
      const p = map.get(r.art_codigo)!;
      p.areas[r.area] = (p.areas[r.area] || 0) + r.cantidad;
      p.total += r.cantidad;
    }
    return Array.from(map.values()).sort((a, b) => (a.nombre || a.codigo).localeCompare(b.nombre || b.codigo, 'es'));
  }, [rows]);

  const filtered = useMemo(() => {
    let data = pivot;
    if (search.trim()) {
      const q = search.toLowerCase();
      data = data.filter(p => (p.nombre || p.codigo).toLowerCase().includes(q));
    }
    if (areaFiltro !== 'todas') {
      data = data.filter(p => (p.areas[areaFiltro] || 0) > 0);
    }
    return data;
  }, [pivot, search, areaFiltro]);

  const resumenMap = useMemo(() => {
    const m: Partial<Record<string, ResumenUbicacion>> = {};
    for (const r of resumen) m[r.area] = r;
    return m;
  }, [resumen]);

  return (
    <div>
      {/* Resumen por área */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {areas.map(area => {
          const r = resumenMap[area];
          const m = areaMap[area];
          return (
            <button key={area} onClick={() => setAreaFiltro(areaFiltro === area ? 'todas' : area)}
              className={cn(
                'rounded-xl border p-4 text-left transition-all',
                areaFiltro === area
                  ? `${m.bg} border-current`
                  : 'bg-surface-container-low border-outline-variant/10 hover:bg-primary/5'
              )}>
              <div className="flex items-center gap-2 mb-2">
                <Icon name={m.icon} className={cn('text-base', areaFiltro === area ? m.color : 'text-stone-400')} />
                <span className={cn('text-[10px] font-label font-bold uppercase tracking-widest', areaFiltro === area ? m.color : 'text-stone-500')}>
                  {m.label}
                </span>
              </div>
              <p className={cn('text-2xl font-serif', areaFiltro === area ? m.color : 'text-on-surface')}>
                {r?.productos ?? 0}
              </p>
              <p className="text-[10px] font-label text-stone-400 mt-0.5">
                {r ? `${Number(r.unidades).toLocaleString('es-MX')} uds` : 'sin stock'}
              </p>
            </button>
          );
        })}
      </div>

      {/* Buscador + refresh */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-base" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar producto..."
            className="w-full pl-9 pr-4 py-2 bg-background border border-outline-variant/20 rounded-xl text-sm font-body outline-none focus:border-primary transition-colors"
          />
        </div>
        <button onClick={fetchAll} disabled={loading}
          className={cn('p-2 rounded-lg hover:bg-surface-container-low transition-all text-stone-400 hover:text-primary', loading && 'animate-spin')}>
          <Icon name="refresh" />
        </button>
        {areaFiltro !== 'todas' && (
          <button onClick={() => setAreaFiltro('todas')}
            className="px-3 py-2 bg-primary/10 text-primary rounded-lg text-[10px] font-label font-bold uppercase tracking-widest flex items-center gap-1">
            {areaMap[areaFiltro as Area]?.label}
            <Icon name="close" className="text-sm" />
          </button>
        )}
      </div>

      {/* Tabla pivot */}
      {loading ? (
        <div className="flex justify-center py-14">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-stone-300 border border-dashed border-stone-200 rounded-xl">
          <Icon name="inventory_2" className="text-5xl opacity-20 mb-3" />
          <p className="text-sm font-label uppercase tracking-widest">
            {rows.length === 0 ? 'Sin datos de ubicaciones aún' : 'Sin resultados'}
          </p>
          {rows.length === 0 && (
            <p className="text-[11px] font-body text-stone-400 mt-2 text-center max-w-xs">
              Los datos se generan automáticamente al registrar entradas, salidas, mermas o surtidos desde el TC52
            </p>
          )}
        </div>
      ) : (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden">
          <div className="overflow-x-auto max-h-[540px] overflow-y-auto">
            <table className="w-full text-left">
              <thead className="bg-surface-container-low/60 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container sticky top-0">
                <tr>
                  <th className="px-4 py-3 min-w-[200px]">Producto</th>
                  {areas.map(a => (
                    <th key={a} className="px-3 py-3 text-center min-w-[80px]">{areaMap[a].label}</th>
                  ))}
                  <th className="px-4 py-3 text-center">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {filtered.map(p => (
                  <tr key={p.codigo} className="hover:bg-background transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-sm font-body text-on-surface truncate max-w-[220px]">{p.nombre || p.codigo}</p>
                      <p className="text-[9px] font-label text-stone-400 mt-0.5">{p.codigo}</p>
                    </td>
                    {areas.map(a => {
                      const qty = p.areas[a] || 0;
                      return (
                        <td key={a} className="px-3 py-3 text-center">
                          {qty > 0 ? (
                            <span className={cn(
                              'inline-block px-2 py-0.5 rounded-full text-xs font-serif font-bold min-w-[32px]',
                              qty < 5 ? 'bg-amber-100 text-amber-700' : `${areaMap[a].bg} ${areaMap[a].color}`
                            )}>
                              {Number(qty).toLocaleString('es-MX')}
                            </span>
                          ) : (
                            <span className="text-stone-200 text-xs">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-center">
                      <span className="font-serif font-bold text-on-surface">{Number(p.total).toLocaleString('es-MX')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-surface-container bg-surface-container-low/30 flex items-center justify-between">
            <p className="text-[10px] font-label text-stone-400 uppercase tracking-widest">
              {filtered.length} producto{filtered.length !== 1 ? 's' : ''} con stock ubicado
            </p>
            <p className="text-[10px] font-label text-stone-400">
              Total: {filtered.reduce((s, p) => s + p.total, 0).toLocaleString('es-MX')} uds
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Merma / Caducidad sub-view ──────────────────────────────────────────────────
interface MermaTC52Record {
  id: number;
  codigo: string;
  nombre: string | null;
  motivo: 'vencimiento' | 'dano' | 'cocina' | 'robo' | 'otro';
  area: string;
  cantidad: number;
  stock_antes: number;
  stock_despues: number;
  notas: string | null;
  usuario: string;
  fecha: string;
}

const MOTIVO_META: Record<MermaTC52Record['motivo'], { label: string; emoji: string; color: string; bg: string }> = {
  vencimiento: { label: 'Vencimiento', emoji: '📅', color: 'text-orange-700', bg: 'bg-orange-100' },
  dano:        { label: 'Daño',        emoji: '💥', color: 'text-red-700',    bg: 'bg-red-100' },
  cocina:      { label: 'Cocina',      emoji: '🍳', color: 'text-amber-700',  bg: 'bg-amber-100' },
  robo:        { label: 'Robo',        emoji: '🚨', color: 'text-rose-800',   bg: 'bg-rose-100' },
  otro:        { label: 'Otro',        emoji: '❓', color: 'text-stone-600',  bg: 'bg-stone-100' },
};

function MermaView() {
  const { areas, areaMap } = useAreasCtx();
  const [records, setRecords] = useState<ExpiryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ art_codigo: '', nombre: '', fecha_caducidad: '', cantidad: '', area: 'bodega' as Area, notas: '' });
  const [saving, setSaving] = useState(false);
  const [notif, setNotif] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [tc52Records, setTc52Records] = useState<MermaTC52Record[]>([]);
  const [tc52Loading, setTc52Loading] = useState(false);
  const [tc52Fecha, setTc52Fecha] = useState(new Date().toISOString().slice(0, 10));
  const [tc52Collapsed, setTc52Collapsed] = useState(false);

  const fetchTc52Merma = useCallback(async (fecha: string) => {
    setTc52Loading(true);
    try {
      const data = await fetch(`/api/almacen/merma/historial?fecha=${fecha}&limit=100`).then(r => r.json());
      setTc52Records(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    finally { setTc52Loading(false); }
  }, []);

  useEffect(() => { fetchTc52Merma(tc52Fecha); }, [fetchTc52Merma, tc52Fecha]);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 3500);
  };

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetch('/api/bodega/expiry').then(r => r.json());
      setRecords(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const saveExpiry = async () => {
    if (!form.art_codigo || !form.fecha_caducidad) {
      notify('Código y fecha son requeridos', 'error'); return;
    }
    setSaving(true);
    try {
      const res  = await fetch('/api/bodega/expiry', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        notify(data.message || 'Guardado');
        setShowForm(false);
        setForm({ art_codigo: '', nombre: '', fecha_caducidad: '', cantidad: '', area: 'bodega', notas: '' });
        fetchRecords();
      } else notify(data.error || 'Error', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setSaving(false); }
  };

  const deleteRecord = async (id: number) => {
    try {
      await fetch(`/api/bodega/expiry/${id}`, { method: 'DELETE' });
      notify('Eliminado');
      fetchRecords();
    } catch { notify('Error', 'error'); }
  };

  const sendAlert = async (items: ExpiryRecord[]) => {
    setSending(true);
    try {
      const res  = await fetch('/api/bodega/alerts/send-email', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type: 'expiry', items }),
      });
      const data = await res.json();
      if (res.ok) notify(data.message || 'Alerta enviada');
      else notify(data.error || 'Error al enviar', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setSending(false); }
  };

  const today    = new Date().toISOString().slice(0, 10);
  const in7      = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  const in30     = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  const expired  = records.filter(r => r.fecha_caducidad < today);
  const critical = records.filter(r => r.fecha_caducidad >= today && r.fecha_caducidad <= in7);
  const warning  = records.filter(r => r.fecha_caducidad > in7 && r.fecha_caducidad <= in30);
  const ok       = records.filter(r => r.fecha_caducidad > in30);

  const rowColor = (r: ExpiryRecord) => {
    if (r.fecha_caducidad < today) return 'border-error/20 bg-error-container/10';
    if (r.fecha_caducidad <= in7)  return 'border-orange-200 bg-orange-50/50';
    if (r.fecha_caducidad <= in30) return 'border-yellow-200 bg-yellow-50/30';
    return 'border-outline-variant/10';
  };

  const badgeColor = (r: ExpiryRecord) => {
    if (r.fecha_caducidad < today) return 'bg-error text-on-error';
    if (r.fecha_caducidad <= in7)  return 'bg-orange-500 text-white';
    if (r.fecha_caducidad <= in30) return 'bg-yellow-400 text-yellow-900';
    return 'bg-primary-fixed text-on-primary-fixed-variant';
  };

  const badgeLabel = (r: ExpiryRecord) => {
    if (r.fecha_caducidad < today) return 'Vencido';
    const days = Math.ceil((new Date(r.fecha_caducidad).getTime() - new Date(today).getTime()) / 86400_000);
    return days === 0 ? 'Hoy' : `${days}d`;
  };

  return (
    <div>
      {notif && (
        <div className={cn(
          'fixed top-4 right-4 z-[300] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-label font-bold',
          notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error'
        )}>
          <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
          {notif.msg}
        </div>
      )}

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 mb-5">
        {[
          { label: 'Vencidos',      count: expired.length,  color: 'bg-error-container/50 text-on-error-container' },
          { label: 'Crítico (7d)',  count: critical.length, color: 'bg-orange-100 text-orange-700' },
          { label: 'Aviso (30d)',   count: warning.length,  color: 'bg-yellow-100 text-yellow-700' },
          { label: 'En orden',      count: ok.length,       color: 'bg-primary-fixed/30 text-primary' },
        ].map(c => (
          <span key={c.label}
            className={cn('px-3 py-1 rounded-full text-[10px] font-label font-bold uppercase tracking-widest', c.color)}>
            {c.label}: {c.count}
          </span>
        ))}
        {(expired.length > 0 || critical.length > 0) && (
          <button
            onClick={() => sendAlert([...expired, ...critical])}
            disabled={sending}
            className="ml-auto px-3 py-1 bg-primary text-on-primary rounded-full text-[10px] font-label font-bold uppercase tracking-widest flex items-center gap-1 hover:bg-primary-container transition-all">
            {sending ? (
              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Icon name="mail" className="text-sm" />
            )}
            Enviar Alerta por Correo
          </button>
        )}
      </div>

      {/* Add button */}
      <div className="flex justify-end mb-4">
        <button onClick={() => setShowForm(v => !v)}
          className="px-4 py-2 bg-primary text-on-primary rounded-lg text-xs font-label font-bold uppercase tracking-widest flex items-center gap-2 shadow-md hover:bg-primary-container transition-all">
          <Icon name={showForm ? 'close' : 'add'} className="text-base" />
          {showForm ? 'Cancelar' : 'Registrar Caducidad'}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="bg-surface-container-low rounded-xl border border-primary/20 p-5 mb-5 space-y-4">
          <h4 className="text-[10px] font-label font-bold uppercase tracking-widest text-stone-500">Nuevo Registro de Caducidad</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Código *</label>
              <input value={form.art_codigo} onChange={e => setForm(f => ({ ...f, art_codigo: e.target.value }))}
                placeholder="Art_Codigo"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Nombre</label>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Nombre del producto"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Fecha de caducidad *</label>
              <input type="date" value={form.fecha_caducidad} onChange={e => setForm(f => ({ ...f, fecha_caducidad: e.target.value }))}
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Cantidad</label>
              <input type="number" min="0" value={form.cantidad} onChange={e => setForm(f => ({ ...f, cantidad: e.target.value }))}
                placeholder="Ej: 10"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Área</label>
              <select value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value as Area }))}
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors">
                {areas.map(a => <option key={a} value={a}>{areaMap[a].label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Notas</label>
              <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                placeholder="Opcional"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
          </div>
          <button onClick={saveExpiry} disabled={saving}
            className={cn(
              'w-full py-2.5 rounded-xl text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all',
              saving ? 'bg-stone-200 text-stone-400' : 'bg-primary text-on-primary hover:bg-primary-container'
            )}>
            {saving
              ? <div className="w-4 h-4 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />
              : <Icon name="save" className="text-base" />}
            Guardar
          </button>
        </div>
      )}

      {/* Records list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      ) : records.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-stone-300">
          <Icon name="event_available" className="text-5xl opacity-20 mb-3" />
          <p className="text-sm font-label uppercase tracking-widest">Sin registros de caducidad</p>
        </div>
      ) : (
        <div className="space-y-2">
          {records.map(r => (
            <div key={r.id}
              className={cn('rounded-xl border p-4 flex items-center gap-4 transition-all', rowColor(r))}>
              <div className={cn('px-2.5 py-1 rounded-full text-[10px] font-label font-bold min-w-[50px] text-center', badgeColor(r))}>
                {badgeLabel(r)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-body text-sm text-on-surface truncate">{r.nombre || r.art_codigo}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-[10px] font-label text-stone-400">
                    Vence: {new Date(r.fecha_caducidad + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                  {r.cantidad > 0 && (
                    <span className="text-[10px] font-label text-stone-400">{r.cantidad} uds</span>
                  )}
                  <span className={cn('text-[9px] font-label px-1.5 py-0.5 rounded uppercase', areaMap[r.area as Area]?.bg, areaMap[r.area as Area]?.color)}>
                    {areaMap[r.area as Area]?.label || r.area}
                  </span>
                </div>
              </div>
              <button onClick={() => deleteRecord(r.id)}
                className="p-1.5 text-stone-300 hover:text-error hover:bg-error-container/20 rounded-lg transition-colors flex-shrink-0">
                <Icon name="delete_outline" className="text-lg" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── TC52 Merma Historial ─────────────────────────────────────────── */}
      <div className="mt-8 border-t border-outline-variant/10 pt-6">
        <button
          onClick={() => setTc52Collapsed(v => !v)}
          className="w-full flex items-center justify-between mb-4 group">
          <div className="flex items-center gap-2">
            <Icon name="qr_code_scanner" className="text-base text-orange-600" />
            <span className="text-[11px] font-label font-bold uppercase tracking-widest text-stone-600">
              Merma registrada en TC52
            </span>
          </div>
          <Icon
            name={tc52Collapsed ? 'expand_more' : 'expand_less'}
            className="text-stone-400 group-hover:text-stone-600 transition-colors"
          />
        </button>

        {!tc52Collapsed && (
          <>
            <div className="flex items-center gap-3 mb-4">
              <input
                type="date"
                value={tc52Fecha}
                onChange={e => setTc52Fecha(e.target.value)}
                className="px-3 py-1.5 bg-background border border-outline-variant/20 rounded-lg text-xs font-body outline-none focus:border-primary transition-colors"
              />
              <button
                onClick={() => fetchTc52Merma(tc52Fecha)}
                disabled={tc52Loading}
                className="p-1.5 text-stone-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors">
                <Icon name="refresh" className={cn('text-base', tc52Loading && 'animate-spin')} />
              </button>
              {tc52Records.length > 0 && (
                <span className="ml-auto text-[10px] font-label text-stone-400">
                  {tc52Records.length} registro{tc52Records.length !== 1 ? 's' : ''}
                  {' · '}
                  {tc52Records.reduce((s, r) => s + r.cantidad, 0)} pzas
                </span>
              )}
            </div>

            {tc52Loading ? (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-3 border-primary/20 border-t-primary rounded-full animate-spin" />
              </div>
            ) : tc52Records.length === 0 ? (
              <div className="py-10 flex flex-col items-center text-stone-300">
                <Icon name="inventory_2" className="text-4xl opacity-20 mb-2" />
                <p className="text-xs font-label uppercase tracking-widest">Sin mermas registradas en el TC52</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {tc52Records.map(r => {
                  const m = MOTIVO_META[r.motivo] ?? MOTIVO_META.otro;
                  const areaM = areaMap[r.area as Area];
                  return (
                    <div key={r.id}
                      className="rounded-xl border border-outline-variant/10 bg-surface-container-low/50 p-3.5 flex items-center gap-3">
                      <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-label font-bold whitespace-nowrap', m.bg, m.color)}>
                        {m.emoji} {m.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-body text-on-surface truncate">{r.nombre || r.codigo}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] font-label text-stone-400 font-mono">−{r.cantidad} pzas</span>
                          {areaM && (
                            <span className={cn('text-[9px] font-label px-1.5 py-0.5 rounded uppercase', areaM.bg, areaM.color)}>
                              {areaM.label}
                            </span>
                          )}
                          {r.notas && (
                            <span className="text-[10px] font-label text-stone-400 truncate max-w-[120px]">{r.notas}</span>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] font-label text-stone-400 flex-shrink-0">
                        {new Date(r.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Surtido sub-view ──────────────────────────────────────────────────────────
function SurtidoView() {
  const { areas, areaMap } = useAreasCtx();
  const [transfers, setTransfers] = useState<SurtidoTransfer[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [showForm,  setShowForm]  = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [form, setForm] = useState({
    art_codigo: '', nombre: '',
    de_area: 'bodega' as Area, a_area: 'cocina' as Area,
    cantidad: '', notas: '',
  });
  const [notif, setNotif] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 3000);
  };

  const fetchTransfers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetch('/api/bodega/surtido').then(r => r.json());
      setTransfers(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchTransfers(); }, [fetchTransfers]);

  const saveTransfer = async () => {
    if (!form.art_codigo || !form.cantidad) { notify('Código y cantidad son requeridos', 'error'); return; }
    setSaving(true);
    try {
      const res  = await fetch('/api/bodega/surtido', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        notify(data.message || 'Transferencia registrada');
        setShowForm(false);
        setForm({ art_codigo: '', nombre: '', de_area: 'bodega', a_area: 'cocina', cantidad: '', notas: '' });
        fetchTransfers();
      } else notify(data.error || 'Error', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setSaving(false); }
  };

  const autorizar = async (id: number) => {
    try {
      const res  = await fetch(`/api/bodega/surtido/${id}/autorizar`, { method: 'PUT' });
      const data = await res.json();
      if (res.ok) { notify(data.message || 'Autorizado'); fetchTransfers(); }
      else notify(data.error || 'Error', 'error');
    } catch { notify('Error de conexión', 'error'); }
  };

  // Group by week
  const byWeek = transfers.reduce<Record<string, SurtidoTransfer[]>>((acc, t) => {
    const key = t.semana || 'Sin semana';
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});

  return (
    <div>
      {notif && (
        <div className={cn(
          'fixed top-4 right-4 z-[300] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-label font-bold',
          notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error'
        )}>
          <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
          {notif.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center mb-5">
        <p className="text-[11px] font-label uppercase tracking-widest text-stone-400">
          Registro de movimientos bodega ↔ áreas
        </p>
        <button onClick={() => setShowForm(v => !v)}
          className="px-4 py-2 bg-primary text-on-primary rounded-lg text-xs font-label font-bold uppercase tracking-widest flex items-center gap-2 shadow-md hover:bg-primary-container transition-all">
          <Icon name={showForm ? 'close' : 'add'} className="text-base" />
          {showForm ? 'Cancelar' : 'Nuevo Surtido'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-surface-container-low rounded-xl border border-primary/20 p-5 mb-5 space-y-4">
          <h4 className="text-[10px] font-label font-bold uppercase tracking-widest text-stone-500">Registrar Surtido</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Código *</label>
              <input value={form.art_codigo} onChange={e => setForm(f => ({ ...f, art_codigo: e.target.value }))}
                placeholder="Art_Codigo"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Nombre</label>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Nombre del producto"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">De área</label>
              <select value={form.de_area} onChange={e => setForm(f => ({ ...f, de_area: e.target.value as Area }))}
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors">
                {areas.map(a => <option key={a} value={a}>{areaMap[a].label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">A área</label>
              <select value={form.a_area} onChange={e => setForm(f => ({ ...f, a_area: e.target.value as Area }))}
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors">
                {areas.map(a => <option key={a} value={a}>{areaMap[a].label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Cantidad *</label>
              <input type="number" min="0.01" step="0.01" value={form.cantidad} onChange={e => setForm(f => ({ ...f, cantidad: e.target.value }))}
                placeholder="Ej: 5"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Notas</label>
              <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                placeholder="Opcional"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs font-body text-amber-700">
            <strong>Nota:</strong> Al <strong>autorizar</strong> una transferencia desde Bodega, la cantidad se descontará automáticamente del inventario principal en el sistema.
          </div>
          <button onClick={saveTransfer} disabled={saving}
            className={cn(
              'w-full py-2.5 rounded-xl text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all',
              saving ? 'bg-stone-200 text-stone-400' : 'bg-primary text-on-primary hover:bg-primary-container'
            )}>
            {saving
              ? <div className="w-4 h-4 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />
              : <Icon name="save" className="text-base" />}
            Registrar
          </button>
        </div>
      )}

      {/* Transfers by week */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      ) : transfers.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-stone-300">
          <Icon name="swap_horiz" className="text-5xl opacity-20 mb-3" />
          <p className="text-sm font-label uppercase tracking-widest">Sin transferencias registradas</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(byWeek).map(([week, list]) => (
            <div key={week}>
              <p className="text-[10px] font-label font-bold uppercase tracking-widest text-stone-400 mb-2">{week}</p>
              <div className="space-y-2">
                {list.map(t => (
                  <div key={t.id}
                    className={cn(
                      'bg-surface-container-lowest rounded-xl border p-4 flex items-center gap-4',
                      t.autorizado ? 'border-primary/15' : 'border-outline-variant/10'
                    )}>
                    <div className="flex flex-col items-center gap-1 flex-shrink-0">
                      <div className={cn('w-8 h-8 rounded-full flex items-center justify-center', areaMap[t.de_area as Area]?.bg || 'bg-stone-100')}>
                        <Icon name={areaMap[t.de_area as Area]?.icon || 'warehouse'} className={cn('text-sm', areaMap[t.de_area as Area]?.color || 'text-stone-500')} />
                      </div>
                      <Icon name="arrow_downward" className="text-stone-300 text-sm" />
                      <div className={cn('w-8 h-8 rounded-full flex items-center justify-center', areaMap[t.a_area as Area]?.bg || 'bg-stone-100')}>
                        <Icon name={areaMap[t.a_area as Area]?.icon || 'category'} className={cn('text-sm', areaMap[t.a_area as Area]?.color || 'text-stone-500')} />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-sm text-on-surface truncate">{t.nombre || t.art_codigo}</p>
                      <p className="text-[10px] font-label text-stone-400 mt-0.5">
                        {areaMap[t.de_area as Area]?.label || t.de_area} → {areaMap[t.a_area as Area]?.label || t.a_area} · {t.cantidad} uds
                      </p>
                      <p className="text-[9px] font-label text-stone-300">
                        {new Date(t.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                        {t.notas && ` · ${t.notas}`}
                      </p>
                    </div>
                    {t.autorizado ? (
                      <span className="flex-shrink-0 px-2.5 py-1 bg-primary-fixed/30 text-primary text-[9px] font-label font-bold uppercase tracking-widest rounded-full">
                        Autorizado
                      </span>
                    ) : (
                      <button onClick={() => autorizar(t.id)}
                        className="flex-shrink-0 px-3 py-1.5 bg-primary text-on-primary rounded-lg text-[10px] font-label font-bold uppercase tracking-widest hover:bg-primary-container transition-all shadow-sm">
                        Autorizar
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Discrepancias sub-view ─────────────────────────────────────────────────────
function StagnantTable({
  items, tipo, onDismiss,
}: { items: StagnantProduct[]; tipo: 'stagnant' | 'noSales'; onDismiss: (id: string) => void }) {
  const [dismissing, setDismissing] = useState<string | null>(null);

  const dismiss = async (id: string) => {
    setDismissing(id);
    try {
      await fetch('/api/bodega/alerts/descartar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ art_codigo: id, tipo }),
      });
      onDismiss(id);
    } catch { /* silent */ }
    finally { setDismissing(null); }
  };

  if (items.length === 0) {
    return (
      <div className="py-10 flex flex-col items-center text-stone-300 border border-dashed border-stone-200 rounded-xl">
        <Icon name="check_circle" className="text-4xl opacity-20 mb-2" />
        <p className="text-xs font-label uppercase tracking-widest">Sin productos en esta categoría</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden">
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
        <table className="w-full text-left">
          <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container sticky top-0">
            <tr>
              <th className="px-5 py-3">Producto</th>
              <th className="px-5 py-3 text-center">Stock</th>
              <th className="px-5 py-3">Última Venta</th>
              <th className="px-5 py-3">Categoría</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-container">
            {items.map(p => {
              const days = p.ultima_venta
                ? Math.floor((Date.now() - new Date(p.ultima_venta).getTime()) / 86400_000)
                : null;
              return (
                <tr key={p.id} className="hover:bg-background transition-colors">
                  <td className="px-5 py-3">
                    <p className="text-sm font-body text-on-surface">{p.name}</p>
                    <p className="text-[9px] font-label text-stone-400">{p.id}</p>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className="font-serif text-lg text-amber-600">{p.stock}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs font-body text-stone-500">
                      {p.ultima_venta
                        ? new Date(p.ultima_venta).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
                        : 'Sin registro'}
                    </span>
                    {days !== null && (
                      <span className={cn(
                        'ml-2 px-1.5 py-0.5 rounded text-[9px] font-label font-bold',
                        days > 90 ? 'bg-red-100 text-red-700' : days > 30 ? 'bg-amber-100 text-amber-700' : 'bg-yellow-100 text-yellow-700'
                      )}>
                        {days}d
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-[10px] font-label text-stone-500 bg-surface-container px-2 py-0.5 rounded uppercase tracking-wider">
                      {p.category || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => dismiss(p.id)}
                      disabled={dismissing === p.id}
                      title="Descartar alerta"
                      className="p-1.5 rounded-lg text-stone-300 hover:text-stone-500 hover:bg-surface-container transition-all">
                      {dismissing === p.id
                        ? <div className="w-3.5 h-3.5 border-2 border-stone-300/30 border-t-stone-400 rounded-full animate-spin" />
                        : <Icon name="close" className="text-sm" />}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-2.5 border-t border-surface-container bg-surface-container-low/30">
        <p className="text-[10px] font-label text-stone-400 uppercase tracking-widest">
          {items.length} producto{items.length !== 1 ? 's' : ''} · Presiona × para descartar falsos positivos
        </p>
      </div>
    </div>
  );
}

interface ReportLog { id: number; tipo: string; productos_detectados: number; noSales: number; stagnant: number; expiry: number; enviado_a: string | null; created_at: string; }

function DiscrepanciasView() {
  const { areas } = useAreasCtx();
  const [stagnant,  setStagnant]  = useState<StagnantProduct[]>([]);
  const [noSales,   setNoSales]   = useState<StagnantProduct[]>([]);
  const [recuentos, setRecuentos] = useState<Recuento[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [showForm,  setShowForm]  = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [form, setForm] = useState({ art_codigo: '', nombre: '', stock_sistema: '', stock_conteo: '', area: 'bodega' as Area, notas: '' });
  const [notif, setNotif] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const [reportLog,     setReportLog]     = useState<ReportLog[]>([]);
  const [sendingReport, setSendingReport] = useState(false);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type }); setTimeout(() => setNotif(null), 3000);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [disc, log] = await Promise.all([
        fetch('/api/bodega/discrepancias').then(r => r.json()),
        fetch('/api/bodega/alerts/report-log').then(r => r.json()),
      ]);
      setStagnant(disc.stagnant || []);
      setNoSales(disc.noSales || []);
      setRecuentos(disc.recuentos || []);
      setReportLog(Array.isArray(log) ? log : []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const sendReport = async () => {
    setSendingReport(true);
    try {
      const res  = await fetch('/api/bodega/alerts/send-report', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        notify(`Reporte enviado a ${data.to} · ${data.total} productos`, 'success');
        fetchData();
      } else {
        notify(data.error || 'Error al enviar', 'error');
      }
    } catch { notify('Error de conexión', 'error'); }
    finally { setSendingReport(false); }
  };

  const saveRecuento = async () => {
    if (!form.art_codigo) { notify('Código requerido', 'error'); return; }
    setSaving(true);
    try {
      const res  = await fetch('/api/bodega/recuento', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) { notify(data.message || 'Guardado'); setShowForm(false); setForm({ art_codigo: '', nombre: '', stock_sistema: '', stock_conteo: '', area: 'bodega', notas: '' }); fetchData(); }
      else notify(data.error || 'Error', 'error');
    } catch { notify('Error', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div>
      {notif && (
        <div className={cn(
          'fixed top-4 right-4 z-[300] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-label font-bold',
          notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error'
        )}>
          <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
          {notif.msg}
        </div>
      )}

      {/* Email report card */}
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/10 p-4 mb-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-start gap-3 flex-1">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Icon name="mark_email_unread" className="text-xl text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-body text-on-surface font-semibold">Reporte mensual por correo</p>
            <p className="text-[10px] font-label text-stone-400 mt-0.5 leading-relaxed">
              Se envía automáticamente el día 1 de cada mes a <span className="font-mono">lacasitadeli2000@gmail.com</span>.<br />
              Incluye productos sin venta, inventario estancado y caducidades con porcentajes y unidades.
            </p>
            {reportLog.length > 0 && (
              <p className="text-[10px] font-label text-stone-400 mt-1.5 flex items-center gap-1">
                <Icon name="check_circle" className="text-emerald-500 text-xs" />
                Último envío: {new Date(reportLog[0].created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                · {reportLog[0].productos_detectados} productos detectados
              </p>
            )}
          </div>
        </div>
        <button
          onClick={sendReport}
          disabled={sendingReport}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-label font-bold uppercase tracking-widest transition-all flex-shrink-0',
            sendingReport
              ? 'bg-stone-100 text-stone-400 cursor-not-allowed'
              : 'bg-primary text-on-primary hover:bg-primary/90 shadow-sm hover:shadow-md'
          )}>
          {sendingReport
            ? <div className="w-3.5 h-3.5 border-2 border-stone-300/40 border-t-stone-400 rounded-full animate-spin" />
            : <Icon name="send" className="text-sm" />}
          {sendingReport ? 'Enviando…' : 'Enviar ahora'}
        </button>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 mb-5">
        <span className={cn('px-3 py-1.5 rounded-full text-[10px] font-label font-bold uppercase tracking-widest flex items-center gap-1.5',
          stagnant.length > 0 ? 'bg-amber-100 text-amber-700' : 'bg-surface-container-low text-stone-400')}>
          <Icon name="do_not_disturb" className="text-sm" />
          Estancado 30d+: {loading ? '…' : stagnant.length}
        </span>
        <span className={cn('px-3 py-1.5 rounded-full text-[10px] font-label font-bold uppercase tracking-widest flex items-center gap-1.5',
          noSales.length > 0 ? 'bg-orange-100 text-orange-700' : 'bg-surface-container-low text-stone-400')}>
          <Icon name="trending_down" className="text-sm" />
          Sin ventas este mes: {loading ? '…' : noSales.length}
        </span>
        <button onClick={() => setShowForm(v => !v)}
          className="ml-auto px-3 py-1.5 bg-surface-container-low text-stone-500 rounded-lg text-[10px] font-label font-bold uppercase tracking-widest flex items-center gap-1.5 hover:bg-primary/10 hover:text-primary transition-all border border-outline-variant/20">
          <Icon name="checklist" className="text-sm" />
          Registrar Recuento
        </button>
      </div>

      {/* Recount form */}
      {showForm && (
        <div className="bg-surface-container-low rounded-xl border border-primary/20 p-5 mb-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Código *</label>
              <input value={form.art_codigo} onChange={e => setForm(f => ({ ...f, art_codigo: e.target.value }))} placeholder="Art_Codigo"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Nombre</label>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Stock sistema</label>
              <input type="number" min="0" value={form.stock_sistema} onChange={e => setForm(f => ({ ...f, stock_sistema: e.target.value }))}
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Stock conteo físico</label>
              <input type="number" min="0" value={form.stock_conteo} onChange={e => setForm(f => ({ ...f, stock_conteo: e.target.value }))}
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={saveRecuento} disabled={saving}
              className={cn('flex-1 py-2 rounded-lg text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all',
                saving ? 'bg-stone-200 text-stone-400' : 'bg-primary text-on-primary hover:bg-primary-container')}>
              {saving ? <div className="w-3 h-3 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" /> : null}
              Guardar
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-surface-container text-stone-500 rounded-lg text-xs font-label uppercase tracking-widest">Cancelar</button>
          </div>
        </div>
      )}

      {/* Inventario Estancado 30+ días */}
      <div className="mb-7">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="do_not_disturb" className="text-amber-500" />
          <div>
            <h4 className="font-serif text-base text-primary">Inventario Estancado</h4>
            <p className="text-[10px] font-label uppercase tracking-widest text-stone-400">
              Stock disponible sin ventas en 30+ días · Se actualiza automáticamente desde NovaCaja
            </p>
          </div>
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-7 h-7 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        ) : (
          <StagnantTable items={stagnant} tipo="stagnant" onDismiss={id => setStagnant(p => p.filter(x => x.id !== id))} />
        )}
      </div>

      {/* Sin ventas este mes */}
      <div className="mb-7">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="trending_down" className="text-orange-500" />
          <div>
            <h4 className="font-serif text-base text-primary">Sin Ventas Este Mes</h4>
            <p className="text-[10px] font-label uppercase tracking-widest text-stone-400">
              Productos con stock que no han tenido venta en el mes actual
            </p>
          </div>
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-7 h-7 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        ) : (
          <StagnantTable items={noSales} tipo="noSales" onDismiss={id => setNoSales(p => p.filter(x => x.id !== id))} />
        )}
      </div>

      {/* Recuento history */}
      {recuentos.length > 0 && (
        <div>
          <h4 className="font-serif text-base text-primary mb-3">Historial de Recuentos</h4>
          <div className="space-y-2">
            {recuentos.map(r => {
              const diff = r.stock_conteo - r.stock_sistema;
              return (
                <div key={r.id} className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-4 flex items-center gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-body text-on-surface">{r.nombre || r.art_codigo}</p>
                    <p className="text-[10px] font-label text-stone-400">
                      {new Date(r.created_at).toLocaleDateString('es-MX')} · {areaMap[r.area as Area]?.label || r.area}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-label text-stone-400">Sistema: {r.stock_sistema} · Conteo: {r.stock_conteo}</p>
                    <span className={cn('text-xs font-serif font-bold', diff === 0 ? 'text-primary' : diff > 0 ? 'text-emerald-600' : 'text-error')}>
                      {diff > 0 ? '+' : ''}{diff} uds
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Conteo sub-view ────────────────────────────────────────────────────────────
interface ConteoItem {
  art_codigo:    string;
  nombre:        string | null;
  total_vendido: number;
  stock_actual:  number;
  num_tickets:   number;
}
interface SyncSession {
  id:                     number;
  periodo_inicio:         string;
  periodo_fin:            string;
  productos_actualizados: number;
  total_unidades:         number;
  estado:                 string;
  notas:                  string | null;
  created_at:             string;
}

function ConteoView() {
  const today   = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate,   setEndDate]   = useState(today);
  const [preview,   setPreview]   = useState<ConteoItem[]>([]);
  const [historial, setHistorial] = useState<SyncSession[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [syncing,        setSyncing]        = useState(false);
  const [confirming,     setConfirming]     = useState(false);
  const [notif, setNotif] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type }); setTimeout(() => setNotif(null), 4000);
  };

  const setPreset = (days: number) => {
    const end   = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(end.toISOString().slice(0, 10));
    setPreview([]);
  };

  const fetchPreview = useCallback(async () => {
    setLoadingPreview(true);
    setPreview([]);
    try {
      const res  = await fetch(`/api/bodega/conteo/preview?startDate=${startDate}&endDate=${endDate}`);
      const data = await res.json();
      if (res.ok) setPreview(Array.isArray(data) ? data : []);
      else notify(data.error || 'Error al cargar vista previa', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setLoadingPreview(false); }
  }, [startDate, endDate]);

  const fetchHistorial = useCallback(async () => {
    try {
      const data = await fetch('/api/bodega/conteo/historial').then(r => r.json());
      if (Array.isArray(data)) setHistorial(data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchHistorial(); }, [fetchHistorial]);

  const runSync = async () => {
    setSyncing(true);
    setConfirming(false);
    try {
      const res  = await fetch('/api/bodega/conteo/sync', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ startDate, endDate }),
      });
      const data = await res.json();
      if (res.ok) {
        notify(data.message || 'Sincronización completada');
        setPreview([]);
        fetchHistorial();
      } else {
        notify(data.error || 'Error al sincronizar', 'error');
      }
    } catch { notify('Error de conexión', 'error'); }
    finally { setSyncing(false); }
  };

  const totalUnidades  = preview.reduce((s, p) => s + (Number(p.total_vendido) || 0), 0);
  const negativeCount  = preview.filter(p => p.stock_actual - p.total_vendido < 0).length;

  return (
    <div>
      {notif && (
        <div className={cn(
          'fixed top-4 right-4 z-[300] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-label font-bold',
          notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error'
        )}>
          <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
          {notif.msg}
        </div>
      )}

      {/* Date selector */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div>
          <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Desde</label>
          <input type="date" value={startDate}
            onChange={e => { setStartDate(e.target.value); setPreview([]); }}
            className="px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
        </div>
        <div>
          <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Hasta</label>
          <input type="date" value={endDate}
            onChange={e => { setEndDate(e.target.value); setPreview([]); }}
            className="px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
        </div>
        <div className="flex gap-1.5">
          {[{ label: 'Hoy', days: 0 }, { label: '7 días', days: 7 }, { label: '30 días', days: 30 }].map(p => (
            <button key={p.label} onClick={() => setPreset(p.days)}
              className="px-3 py-2 bg-surface-container-low text-stone-500 rounded-lg text-[10px] font-label font-bold uppercase tracking-widest hover:bg-primary/10 hover:text-primary transition-all border border-outline-variant/20">
              {p.label}
            </button>
          ))}
        </div>
        <button onClick={fetchPreview} disabled={loadingPreview}
          className={cn(
            'px-5 py-2 rounded-lg text-xs font-label font-bold uppercase tracking-widest flex items-center gap-2 transition-all',
            loadingPreview ? 'bg-stone-200 text-stone-400' : 'bg-primary text-on-primary hover:bg-primary-container shadow-md'
          )}>
          {loadingPreview
            ? <div className="w-4 h-4 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />
            : <Icon name="search" className="text-base" />}
          Vista Previa
        </button>
      </div>

      {/* Warning */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 mb-5 text-sm font-body text-amber-800">
        <Icon name="warning" className="text-amber-500 text-xl flex-shrink-0 mt-0.5" />
        <div>
          <strong>Advertencia:</strong> Esta operación lee <code>TicketsPS</code> y descuenta las cantidades vendidas del inventario en NovaCaja.
          <strong> No apliques el mismo periodo dos veces</strong> — causaría doble deducción.
        </div>
      </div>

      {/* Loading state */}
      {loadingPreview && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {/* Preview results */}
      {!loadingPreview && preview.length > 0 && (
        <div>
          {/* Summary bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 rounded-lg px-4 py-2 text-center">
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-500">Productos</p>
                <p className="text-2xl font-serif text-primary">{preview.length.toLocaleString('es-MX')}</p>
              </div>
              <div className="bg-secondary/10 rounded-lg px-4 py-2 text-center">
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-500">Unidades</p>
                <p className="text-2xl font-serif text-secondary">{totalUnidades.toLocaleString('es-MX')}</p>
              </div>
              {negativeCount > 0 && (
                <div className="bg-error/10 rounded-lg px-4 py-2 text-center">
                  <p className="text-[10px] font-label uppercase tracking-widest text-error">Stock negativo</p>
                  <p className="text-2xl font-serif text-error">{negativeCount}</p>
                </div>
              )}
            </div>
            <button onClick={() => setConfirming(true)} disabled={syncing}
              className={cn(
                'px-5 py-2.5 rounded-xl text-xs font-label font-bold uppercase tracking-widest flex items-center gap-2 transition-all shadow-md',
                syncing ? 'bg-stone-200 text-stone-400' : 'bg-error text-on-error hover:bg-error/90'
              )}>
              {syncing
                ? <div className="w-4 h-4 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />
                : <Icon name="remove_shopping_cart" className="text-base" />}
              Aplicar Descuento
            </button>
          </div>

          {/* Table */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden mb-6">
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
              <table className="w-full text-left">
                <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container sticky top-0">
                  <tr>
                    <th className="px-4 py-3">Código</th>
                    <th className="px-4 py-3">Producto</th>
                    <th className="px-4 py-3 text-center">Tickets</th>
                    <th className="px-4 py-3 text-center">Vendido</th>
                    <th className="px-4 py-3 text-center">Stock actual</th>
                    <th className="px-4 py-3 text-center">Stock resultante</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {preview.map(item => {
                    const resultante = item.stock_actual - item.total_vendido;
                    return (
                      <tr key={item.art_codigo} className="hover:bg-background transition-colors">
                        <td className="px-4 py-2.5">
                          <span className="text-[10px] font-label text-stone-400">{item.art_codigo}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="text-sm font-body text-on-surface truncate max-w-[220px]">{item.nombre || item.art_codigo}</p>
                        </td>
                        <td className="px-4 py-2.5 text-center text-xs font-body text-stone-400">{item.num_tickets}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="font-serif font-bold text-secondary">{item.total_vendido}</span>
                        </td>
                        <td className="px-4 py-2.5 text-center text-sm font-body text-stone-500">{item.stock_actual}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={cn('font-serif font-bold', resultante < 0 ? 'text-error' : 'text-primary')}>
                            {resultante}
                          </span>
                          {resultante < 0 && <Icon name="warning" className="text-error text-xs ml-1" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loadingPreview && preview.length === 0 && (
        <div className="py-14 flex flex-col items-center text-stone-300 border border-dashed border-stone-200 rounded-xl mb-6">
          <Icon name="calculate" className="text-5xl opacity-20 mb-3" />
          <p className="text-sm font-label uppercase tracking-widest">Selecciona un periodo y haz clic en Vista Previa</p>
        </div>
      )}

      {/* Confirmation modal */}
      {confirming && (
        <div className="fixed inset-0 bg-black/50 z-[400] flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center flex-shrink-0">
                <Icon name="warning" className="text-2xl text-error" />
              </div>
              <div>
                <h3 className="font-serif text-xl text-on-surface">¿Confirmar descuento?</h3>
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-400">Operación irreversible</p>
              </div>
            </div>
            <p className="text-sm font-body text-stone-600 mb-2">
              Se descontarán <strong className="text-primary">{totalUnidades.toLocaleString('es-MX')} unidades</strong> de{' '}
              <strong className="text-primary">{preview.length} productos</strong> del inventario de NovaCaja.
            </p>
            <p className="text-sm font-body text-stone-500 mb-4">
              Periodo: <strong>{startDate}</strong> al <strong>{endDate}</strong>
            </p>
            {negativeCount > 0 && (
              <div className="bg-error/10 border border-error/20 rounded-lg p-3 mb-4 text-xs font-body text-error">
                <strong>{negativeCount} productos</strong> quedarán con stock negativo. Verifica antes de continuar.
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={runSync}
                className="flex-1 py-3 bg-error text-on-error rounded-xl text-xs font-label font-bold uppercase tracking-widest hover:bg-error/90 transition-all">
                Sí, aplicar
              </button>
              <button onClick={() => setConfirming(false)}
                className="flex-1 py-3 bg-surface-container text-stone-600 rounded-xl text-xs font-label uppercase tracking-widest hover:bg-stone-200 transition-all">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Historial */}
      {historial.length > 0 && (
        <div>
          <h4 className="font-serif text-base text-primary mb-3">Historial de Sincronizaciones</h4>
          <div className="space-y-2">
            {historial.map(s => (
              <div key={s.id} className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-4 flex items-center gap-4">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Icon name="sync" className="text-primary text-base" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-body text-on-surface">
                    {s.periodo_inicio}{s.periodo_fin !== s.periodo_inicio ? ` al ${s.periodo_fin}` : ''}
                  </p>
                  <p className="text-[10px] font-label text-stone-400">
                    {new Date(s.created_at).toLocaleString('es-MX')} · {s.productos_actualizados} productos
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-serif text-primary font-bold">{Number(s.total_unidades).toLocaleString('es-MX')} uds</p>
                  <span className="text-[9px] font-label uppercase tracking-widest bg-primary-fixed/30 text-primary px-2 py-0.5 rounded-full">
                    {s.estado}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Movimientos unificados (TC52 + merma + surtido) ──────────────────────────
const TIPO_META: Record<TipoMovimiento, { label: string; sign: string; badgeCls: string; iconCls: string }> = {
  entrada:       { label: 'Entrada',       sign: '+', badgeCls: 'bg-emerald-50 text-emerald-700 border border-emerald-200',    iconCls: 'text-emerald-600' },
  salida:        { label: 'Salida',        sign: '−', badgeCls: 'bg-red-50 text-red-700 border border-red-200',                iconCls: 'text-red-600' },
  merma:         { label: 'Merma',         sign: '−', badgeCls: 'bg-orange-50 text-orange-700 border border-orange-200',       iconCls: 'text-orange-600' },
  transferencia: { label: 'Transferencia', sign: '↔', badgeCls: 'bg-blue-50 text-blue-700 border border-blue-200',             iconCls: 'text-blue-600' },
};

function ZebraView() {
  const { areas, areaMap } = useAreasCtx();
  const today = new Date().toISOString().slice(0, 10);
  const [movimientos, setMovimientos] = useState<MovimientoUnificado[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [fecha,       setFecha]       = useState(today);
  const [tipo,        setTipo]        = useState<TipoMovimiento | 'todos'>('todos');
  const [areaFiltro,  setAreaFiltro]  = useState('todas');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchMovimientos = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ fecha });
      if (tipo !== 'todos') params.set('tipo', tipo);
      if (areaFiltro !== 'todas') params.set('area', areaFiltro);
      const data = await fetch(`/api/almacen/movimientos/todos?${params}`).then(r => r.json());
      if (Array.isArray(data)) { setMovimientos(data); setLastRefresh(new Date()); }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [fecha, tipo, areaFiltro]);

  useEffect(() => { fetchMovimientos(); }, [fetchMovimientos]);

  const byTipo = useMemo(() => {
    const acc: Record<TipoMovimiento, MovimientoUnificado[]> = { entrada: [], salida: [], merma: [], transferencia: [] };
    for (const m of movimientos) acc[m.tipo]?.push(m);
    return acc;
  }, [movimientos]);

  const setPresetFecha = (days: number) => {
    const d = new Date(); d.setDate(d.getDate() - days);
    setFecha(d.toISOString().slice(0, 10));
  };

  const TIPOS_FILTER: { id: TipoMovimiento | 'todos'; label: string }[] = [
    { id: 'todos',        label: 'Todos' },
    { id: 'entrada',      label: '↓ Entradas' },
    { id: 'salida',       label: '↑ Salidas' },
    { id: 'merma',        label: '🗑 Mermas' },
    { id: 'transferencia',label: '↔ Traslados' },
  ];

  return (
    <div>
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div>
          <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Fecha</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
            className="px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
        </div>
        <div className="flex gap-1.5">
          {[{ label: 'Hoy', days: 0 }, { label: 'Ayer', days: 1 }, { label: '7d', days: 7 }].map(p => (
            <button key={p.label} onClick={() => setPresetFecha(p.days)}
              className="px-3 py-2 bg-surface-container-low text-stone-500 rounded-lg text-[10px] font-label font-bold uppercase tracking-widest hover:bg-primary/10 hover:text-primary transition-all border border-outline-variant/20">
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          {TIPOS_FILTER.map(t => (
            <button key={t.id} onClick={() => setTipo(t.id as TipoMovimiento | 'todos')}
              className={cn(
                'px-3 py-2 rounded-lg text-[10px] font-label font-bold uppercase tracking-widest border transition-all',
                tipo === t.id ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container-low text-stone-500 border-outline-variant/20 hover:bg-primary/5'
              )}>
              {t.label}
            </button>
          ))}
        </div>
        <div>
          <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Área</label>
          <select value={areaFiltro} onChange={e => setAreaFiltro(e.target.value)}
            className="px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors">
            <option value="todas">Todas las áreas</option>
            {areas.map(a => <option key={a} value={a}>{areaMap[a].label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {lastRefresh && (
            <span className="text-[10px] font-label text-stone-400">
              {lastRefresh.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button onClick={fetchMovimientos} disabled={loading}
            className={cn('p-2 rounded-lg hover:bg-surface-container-low transition-all text-stone-400 hover:text-primary', loading && 'animate-spin')}>
            <Icon name="refresh" />
          </button>
        </div>
      </div>

      {/* Tarjetas resumen */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {(['entrada', 'salida', 'merma', 'transferencia'] as TipoMovimiento[]).map(t => {
          const items = byTipo[t];
          const total = items.reduce((s, m) => s + Number(m.cantidad), 0);
          const meta  = TIPO_META[t];
          return (
            <div key={t} className={cn('rounded-xl p-4 text-center', meta.badgeCls.replace('border', '').replace('border-emerald-200', '').replace('border-red-200', '').replace('border-orange-200', '').replace('border-blue-200', ''))}>
              <p className="text-[10px] font-label uppercase tracking-widest mb-1">{meta.label}</p>
              <p className="text-2xl font-serif">{items.length}</p>
              <p className="text-[10px] font-label mt-1">{meta.sign}{total.toLocaleString('es-MX')} uds</p>
            </div>
          );
        })}
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="flex justify-center py-14">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      ) : movimientos.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-stone-300 border border-dashed border-stone-200 rounded-xl">
          <Icon name="history" className="text-5xl opacity-20 mb-3" />
          <p className="text-sm font-label uppercase tracking-widest">Sin movimientos para esta fecha</p>
        </div>
      ) : (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden">
          <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
            <table className="w-full text-left">
              <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container sticky top-0">
                <tr>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3">Área</th>
                  <th className="px-4 py-3 text-center">Cantidad</th>
                  <th className="px-4 py-3 text-center">Stock</th>
                  <th className="px-4 py-3">Hora</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {movimientos.map(m => {
                  const meta = TIPO_META[m.tipo];
                  const areaOrigen  = m.area_origen  ? areaMap[m.area_origen as Area]?.label  ?? m.area_origen  : null;
                  const areaDestino = m.area_destino ? areaMap[m.area_destino as Area]?.label ?? m.area_destino : null;
                  return (
                    <tr key={m.uid} className="hover:bg-background transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={cn('px-2.5 py-1 rounded-full text-[10px] font-label font-bold uppercase tracking-widest', meta.badgeCls)}>
                          {meta.label}
                        </span>
                        {m.motivo && (
                          <p className="text-[9px] font-label text-stone-400 mt-0.5">{m.motivo}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-body text-on-surface">{m.nombre || m.codigo}</p>
                        <p className="text-[9px] font-label text-stone-400">{m.codigo}</p>
                      </td>
                      <td className="px-4 py-3">
                        {m.tipo === 'transferencia' ? (
                          <span className="text-xs font-label text-stone-500">
                            {areaOrigen} → {areaDestino}
                          </span>
                        ) : (
                          <span className={cn(
                            'text-[10px] font-label px-2 py-0.5 rounded',
                            areaMap[(m.area_origen ?? m.area_destino ?? 'bodega') as Area]?.bg,
                            areaMap[(m.area_origen ?? m.area_destino ?? 'bodega') as Area]?.color,
                          )}>
                            {areaOrigen ?? areaDestino ?? '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn('font-serif font-bold text-lg', meta.iconCls)}>
                          {meta.sign}{Number(m.cantidad).toLocaleString('es-MX')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {m.stock_despues != null ? (
                          <span className="font-serif font-bold text-on-surface text-sm">
                            {Number(m.stock_despues).toLocaleString('es-MX')}
                          </span>
                        ) : <span className="text-stone-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs font-body text-stone-400 whitespace-nowrap">
                        {new Date(m.fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-surface-container bg-surface-container-low/30 flex items-center justify-between">
            <p className="text-[10px] font-label text-stone-400 uppercase tracking-widest">
              {movimientos.length} movimientos · {fecha}
            </p>
            <div className="flex gap-3 text-[10px] font-label text-stone-400">
              {(['entrada', 'salida', 'merma', 'transferencia'] as TipoMovimiento[]).map(t =>
                byTipo[t].length > 0 ? (
                  <span key={t}>{TIPO_META[t].label}: {byTipo[t].length}</span>
                ) : null
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Configuración de Áreas ─────────────────────────────────────────────────────
const DEFAULT_CLAVES = ['bodega', 'cocina', 'tienda', 'refrigerador', 'otro'];

function ConfiguracionAreasView() {
  const { reloadAreas } = useAreasCtx();
  const [configs,   setConfigs]  = useState<AreaConfig[]>([]);
  const [loading,   setLoading]  = useState(false);
  const [showForm,  setShowForm] = useState(false);
  const [editing,   setEditing]  = useState<AreaConfig | null>(null);
  const [form, setForm] = useState({ nombre: '', icono: 'category', color_bg: 'bg-stone-100', color_text: 'text-stone-600' });
  const [saving,    setSaving]   = useState(false);
  const [notif, setNotif] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type }); setTimeout(() => setNotif(null), 3000);
  };

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetch('/api/almacen/ubicaciones/config').then(r => r.json());
      setConfigs(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const saveArea = async () => {
    if (!form.nombre.trim()) { notify('El nombre es requerido', 'error'); return; }
    setSaving(true);
    try {
      const url    = editing ? `/api/almacen/ubicaciones/config/${editing.id}` : '/api/almacen/ubicaciones/config';
      const method = editing ? 'PUT' : 'POST';
      const res  = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json();
      if (res.ok) {
        notify(editing ? 'Área actualizada' : 'Área creada');
        setShowForm(false); setEditing(null);
        setForm({ nombre: '', icono: 'category', color_bg: 'bg-stone-100', color_text: 'text-stone-600' });
        fetchConfigs(); reloadAreas();
      } else notify(data.error || 'Error', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setSaving(false); }
  };

  const deleteArea = async (id: number) => {
    try {
      const res = await fetch(`/api/almacen/ubicaciones/config/${id}`, { method: 'DELETE' });
      if (res.ok) { notify('Área desactivada'); fetchConfigs(); reloadAreas(); }
      else notify('Error', 'error');
    } catch { notify('Error', 'error'); }
  };

  const moveArea = async (id: number, direction: 'up' | 'down') => {
    try {
      await fetch(`/api/almacen/ubicaciones/config/${id}/orden`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction }),
      });
      fetchConfigs(); reloadAreas();
    } catch { /* silent */ }
  };

  const startEdit = (cfg: AreaConfig) => {
    setEditing(cfg);
    setForm({ nombre: cfg.nombre, icono: cfg.icono, color_bg: cfg.color_bg, color_text: cfg.color_text });
    setShowForm(true);
  };

  const cancelEdit = () => {
    setEditing(null); setShowForm(false);
    setForm({ nombre: '', icono: 'category', color_bg: 'bg-stone-100', color_text: 'text-stone-600' });
  };

  const selectedColor = PALETA_COLORES.find(c => c.bg === form.color_bg);

  return (
    <div>
      {notif && (
        <div className={cn('fixed top-4 right-4 z-[300] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-label font-bold',
          notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error')}>
          <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
          {notif.msg}
        </div>
      )}

      <div className="flex items-center justify-between mb-5">
        <div>
          <h4 className="font-serif text-base text-primary">Áreas de Ubicación</h4>
          <p className="text-[10px] font-label uppercase tracking-widest text-stone-400">
            Define las áreas donde se almacenan productos · se refleja en TC52 y reportes
          </p>
        </div>
        <button onClick={() => { if (showForm && !editing) cancelEdit(); else { cancelEdit(); setShowForm(true); } }}
          className="px-4 py-2 bg-primary text-on-primary rounded-lg text-xs font-label font-bold flex items-center gap-2 shadow-md hover:bg-primary-container transition-all">
          <Icon name={showForm && !editing ? 'close' : 'add'} className="text-base" />
          {showForm && !editing ? 'Cancelar' : 'Nueva Área'}
        </button>
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <div className="bg-surface-container-low rounded-xl border border-primary/20 p-5 mb-5 space-y-4">
          <h5 className="text-[10px] font-label font-bold uppercase tracking-widest text-stone-500">
            {editing ? `Editando: ${editing.nombre}` : 'Nueva Área'}
          </h5>

          <div>
            <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Nombre *</label>
            <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
              placeholder="Ej: Tienda Norte, Almacén 2, En camino..."
              className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
          </div>

          <div>
            <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-2 block">Ícono</label>
            <div className="flex flex-wrap gap-2">
              {ICONOS_DISPONIBLES.map(ic => (
                <button key={ic} onClick={() => setForm(f => ({ ...f, icono: ic }))}
                  className={cn('w-9 h-9 rounded-lg flex items-center justify-center transition-all border',
                    form.icono === ic
                      ? 'bg-primary text-on-primary border-primary shadow-md'
                      : 'bg-surface-container-low text-stone-400 border-outline-variant/20 hover:bg-primary/5')}>
                  <Icon name={ic} className="text-base" />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-2 block">Color</label>
            <div className="flex flex-wrap gap-2">
              {PALETA_COLORES.map(c => (
                <button key={c.bg} onClick={() => setForm(f => ({ ...f, color_bg: c.bg, color_text: c.text }))}
                  title={c.nombre}
                  className={cn('w-9 h-9 rounded-full flex items-center justify-center transition-all border-2',
                    form.color_bg === c.bg ? 'border-stone-700 scale-110 shadow-md' : 'border-transparent hover:scale-105',
                    c.bg)}>
                  {form.color_bg === c.bg && <Icon name="check" className={cn('text-sm font-bold', c.text)} />}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-2 block">Vista previa</label>
            <span className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-label font-bold', form.color_bg, form.color_text)}>
              <Icon name={form.icono} className="text-sm" />
              {form.nombre || 'Nombre del área'}
            </span>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={saveArea} disabled={saving}
              className={cn('flex-1 py-2 rounded-lg text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all',
                saving ? 'bg-stone-200 text-stone-400' : 'bg-primary text-on-primary hover:bg-primary-container')}>
              {saving ? <div className="w-3 h-3 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" /> : <Icon name="save" className="text-sm" />}
              {editing ? 'Guardar cambios' : 'Crear área'}
            </button>
            <button onClick={cancelEdit} className="px-4 py-2 bg-surface-container text-stone-500 rounded-lg text-xs font-label uppercase tracking-widest">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-7 h-7 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {configs.map((cfg, idx) => (
            <div key={cfg.id} className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-4 flex items-center gap-3">
              <div className={cn('w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0', cfg.color_bg)}>
                <Icon name={cfg.icono} className={cn('text-lg', cfg.color_text)} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-body text-on-surface font-semibold">{cfg.nombre}</p>
                <p className="text-[9px] font-label text-stone-400 mt-0.5">clave: <span className="font-mono">{cfg.clave}</span></p>
              </div>
              {DEFAULT_CLAVES.includes(cfg.clave) && (
                <span className="text-[8px] font-label bg-primary/10 text-primary px-1.5 py-0.5 rounded uppercase tracking-widest flex-shrink-0">
                  default
                </span>
              )}
              <div className="flex items-center gap-0.5">
                <button onClick={() => moveArea(cfg.id, 'up')} disabled={idx === 0}
                  className="p-1.5 rounded-lg text-stone-300 hover:text-stone-500 hover:bg-surface-container transition-all disabled:opacity-20">
                  <Icon name="keyboard_arrow_up" className="text-sm" />
                </button>
                <button onClick={() => moveArea(cfg.id, 'down')} disabled={idx === configs.length - 1}
                  className="p-1.5 rounded-lg text-stone-300 hover:text-stone-500 hover:bg-surface-container transition-all disabled:opacity-20">
                  <Icon name="keyboard_arrow_down" className="text-sm" />
                </button>
                <button onClick={() => startEdit(cfg)}
                  className="p-1.5 rounded-lg text-stone-400 hover:text-primary hover:bg-primary/5 transition-all">
                  <Icon name="edit" className="text-sm" />
                </button>
                <button onClick={() => deleteArea(cfg.id)}
                  title="Desactivar área (los datos históricos se conservan)"
                  className="p-1.5 rounded-lg text-stone-300 hover:text-error hover:bg-error/5 transition-all">
                  <Icon name="delete_outline" className="text-sm" />
                </button>
              </div>
            </div>
          ))}
          {configs.length === 0 && (
            <div className="py-10 flex flex-col items-center text-stone-300 border border-dashed border-stone-200 rounded-xl">
              <Icon name="tune" className="text-4xl opacity-20 mb-2" />
              <p className="text-xs font-label uppercase tracking-widest">Sin áreas configuradas</p>
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] font-label text-stone-400 mt-5 leading-relaxed">
        Las áreas desactivadas dejan de aparecer en el selector del TC52 y en los filtros del panel.<br />
        Los datos históricos de stock y movimientos con esa área se conservan.
      </p>
    </div>
  );
}

// ── Main BodegaTab ─────────────────────────────────────────────────────────────
export default function BodegaTab() {
  const [view,      setView]      = useState<SubView>('ubicaciones');
  const [areasData, setAreasData] = useState<AreaConfig[]>([]);

  const loadAreas = useCallback(async () => {
    try {
      const data = await fetch('/api/almacen/ubicaciones/config').then(r => r.json());
      if (Array.isArray(data) && data.length > 0) setAreasData(data);
    } catch { /* use defaults */ }
  }, []);

  useEffect(() => { loadAreas(); }, [loadAreas]);

  const areaMap = useMemo<Record<string, AreaMeta>>(() => {
    if (areasData.length === 0) return DEFAULT_areaMap;
    const m: Record<string, AreaMeta> = {};
    for (const a of areasData) {
      m[a.clave] = { label: a.nombre, icon: a.icono, color: a.color_text, bg: a.color_bg };
    }
    return m;
  }, [areasData]);

  const areas = useMemo(
    () => areasData.length > 0 ? areasData.map(a => a.clave) : DEFAULT_areas,
    [areasData]
  );

  return (
    <AreasCtx.Provider value={{ areas, areaMap, reloadAreas: loadAreas }}>
    <section className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">

      {/* Title */}
      <div className="mb-6">
        <h2 className="text-3xl font-serif italic text-primary">Control de Bodega</h2>
        <p className="text-[10px] font-label uppercase tracking-widest text-stone-500 mt-1">
          Control interno · merma · surtido · trazabilidad
        </p>
      </div>

      {/* Sub-nav */}
      <div className="flex gap-1 overflow-x-auto pb-1 mb-6 scrollbar-hide">
        {SUB_VIEWS.map(sv => (
          <button key={sv.id}
            onClick={() => setView(sv.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-label font-bold uppercase tracking-widest whitespace-nowrap transition-all flex-shrink-0',
              view === sv.id
                ? 'bg-primary text-on-primary shadow-md'
                : 'bg-surface-container-low text-stone-500 hover:text-primary hover:bg-primary/5'
            )}>
            <Icon name={sv.icon} className="text-base" />
            {sv.label}
            {sv.dev && (
              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[8px] font-bold rounded-full uppercase">
                Dev
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-[400px]">
        {view === 'ubicaciones'   && <UbicacionesView />}
        {view === 'areas'         && <AreasView />}
        {view === 'merma'         && <MermaView />}
        {view === 'surtido'       && <SurtidoView />}
        {view === 'discrepancias' && <DiscrepanciasView />}
        {view === 'conteo'        && <ConteoView />}
        {view === 'facturas'      && <DevPlaceholder label="Automatización de Facturas PDF" icon="receipt_long" />}
        {view === 'zebra'         && <ZebraView />}
        {view === 'config'        && <ConfiguracionAreasView />}
      </div>
    </section>
    </AreasCtx.Provider>
  );
}
