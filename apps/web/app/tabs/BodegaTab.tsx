'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { cn, hoyMX, diasAtrasMX, mesMX } from '../lib/utils';
import { Icon } from '../components/Icon';
import type {
  Area, AreaConfig, AreaCount, AreaProduct,
  SurtidoTransfer, Recuento, StagnantProduct,
  StockUbicacion, ResumenUbicacion, MovimientoUnificado, TipoMovimiento,
  ConsumoArea,
  EstadoFactura, FacturaCompra, FacturaConDetalle, FacturaDetalle,
  RecepcionEsperada, RecepcionEsperadaConDetalle, EstatusRecepcion,
  RecepcionDiscrepancia, CaducidadItem, SemaforoCaducidad,
} from '../lib/types';

// ── Sub-view config ────────────────────────────────────────────────────────────
type SubView = 'recepcion' | 'gestion-areas' | 'merma' | 'discrepancias' | 'facturas' | 'zebra';
const SUB_VIEWS: { id: SubView; label: string; icon: string; dev?: boolean }[] = [
  { id: 'recepcion',      label: 'Recepción',          icon: 'local_shipping' },
  { id: 'gestion-areas',  label: 'Áreas',              icon: 'warehouse'      },
  { id: 'merma',          label: 'Merma',              icon: 'event_busy'     },
  { id: 'discrepancias',  label: 'Discrepancias',      icon: 'difference'     },
  { id: 'facturas',       label: 'Facturas',            icon: 'receipt_long'   },
  { id: 'zebra',          label: 'Movimientos TC52',   icon: 'qr_code_scanner'},
];

type AreaMeta = { label: string; icon: string; color: string; bg: string };
const DEFAULT_areaMap: Record<string, AreaMeta> = {
  bodega:       { label: 'Bodega',       icon: 'warehouse',    color: 'text-emerald-700', bg: 'bg-emerald-50' },
  casita_1:     { label: 'Casita 1',     icon: 'storefront',   color: 'text-blue-700',    bg: 'bg-blue-50' },
  casita_2:     { label: 'Casita 2',     icon: 'store',        color: 'text-purple-700',  bg: 'bg-purple-50' },
  usa:          { label: 'USA',          icon: 'flight',       color: 'text-amber-700',   bg: 'bg-amber-50' },
  cocina:       { label: 'Cocina',       icon: 'restaurant',   color: 'text-orange-700',  bg: 'bg-orange-50' },
  refrigerador: { label: 'Refrigerador', icon: 'ac_unit',      color: 'text-cyan-700',    bg: 'bg-cyan-50' },
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
  id: number | string;
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

interface MermaStats {
  periodo:      string;
  totales:      { num_registros: number; total_unidades: number };
  porMotivo:    { motivo: string; num_registros: number; total_unidades: number }[];
  topProductos: { codigo: string; nombre: string; num_registros: number; total_unidades: number }[];
  porArea:      { area: string; num_registros: number; total_unidades: number }[];
  tendencia:    { mes: string; num_registros: number; total_unidades: number }[];
}

function MermaView() {
  const { areaMap } = useAreasCtx();
  const [tc52Records, setTc52Records] = useState<MermaTC52Record[]>([]);
  const [tc52Loading, setTc52Loading] = useState(false);
  const [tc52Fecha, setTc52Fecha] = useState(hoyMX());
  const [tc52Collapsed, setTc52Collapsed] = useState(false);
  const [stats,        setStats]        = useState<MermaStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsMes,     setStatsMes]     = useState(mesMX());
  const [statsCollapsed, setStatsCollapsed] = useState(false);

  const fetchTc52Merma = useCallback(async (fecha: string) => {
    setTc52Loading(true);
    try {
      const data = await fetch(`/api/almacen/merma/historial?fecha=${fecha}&limit=200`).then(r => r.json());
      setTc52Records(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    finally { setTc52Loading(false); }
  }, []);

  const fetchStats = useCallback(async (mes: string) => {
    setStatsLoading(true);
    try {
      const res  = await fetch(`/api/almacen/merma/stats?mes=${mes}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.totales) setStats(data);
    } catch { /* silent */ }
    finally { setStatsLoading(false); }
  }, []);

  useEffect(() => { fetchTc52Merma(tc52Fecha); }, [fetchTc52Merma, tc52Fecha]);
  useEffect(() => { fetchStats(statsMes); }, [fetchStats, statsMes]);

  const exportarExcel = () => {
    if (!tc52Records.length) return;
    const XLSX = require('xlsx');
    const mesLabel = new Date(tc52Fecha + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });

    const filas = tc52Records.map(r => ({
      'Fecha':          new Date(r.fecha).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      'Código':         r.codigo,
      'Producto':       r.nombre || r.codigo,
      'Motivo':         MOTIVO_META[r.motivo]?.label ?? r.motivo,
      'Área':           areaMap[r.area]?.label ?? r.area,
      'Cantidad':       r.cantidad,
      'Stock antes':    r.stock_antes,
      'Stock después':  r.stock_despues,
      'Notas':          r.notas || '',
      'Usuario':        r.usuario,
    }));

    const wb  = XLSX.utils.book_new();
    const ws  = XLSX.utils.json_to_sheet([], { skipHeader: true });
    XLSX.utils.sheet_add_aoa(ws, [
      [`Historial de Merma — La Casita Deli`],
      [`Fecha: ${mesLabel}`],
      [`Total: ${tc52Records.length} registros · ${tc52Records.reduce((s, r) => s + r.cantidad, 0)} unidades`],
      [],
    ]);
    XLSX.utils.sheet_add_json(ws, filas, { origin: 'A5' });

    // Column widths
    ws['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 36 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 28 }, { wch: 12 }];

    // Style header rows
    ['A1', 'A2', 'A3'].forEach(cell => {
      if (ws[cell]) ws[cell].s = { font: { bold: true } };
    });

    XLSX.utils.book_append_sheet(wb, ws, 'Merma');

    // Segunda hoja: resumen por motivo
    if (stats) {
      const resumen = stats.porMotivo.map(m => ({
        'Motivo':    MOTIVO_META[m.motivo as MermaTC52Record['motivo']]?.label ?? m.motivo,
        'Registros': m.num_registros,
        'Unidades':  m.total_unidades,
        '% del total': stats.totales.total_unidades > 0
          ? ((m.total_unidades / stats.totales.total_unidades) * 100).toFixed(1) + '%'
          : '0%',
      }));
      const ws2 = XLSX.utils.json_to_sheet(resumen);
      ws2['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws2, 'Por Motivo');

      const topWs = XLSX.utils.json_to_sheet(stats.topProductos.map(p => ({
        'Código':    p.codigo,
        'Producto':  p.nombre,
        'Registros': p.num_registros,
        'Unidades':  p.total_unidades,
      })));
      topWs['!cols'] = [{ wch: 14 }, { wch: 36 }, { wch: 12 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, topWs, 'Top Productos');
    }

    XLSX.writeFile(wb, `merma-${tc52Fecha}.xlsx`);
  };

  return (
    <div>
      {/* ── Estadísticas de merma ────────────────────────────────────────── */}
      <div className="mt-2">
        <button
          onClick={() => setStatsCollapsed(v => !v)}
          className="w-full flex items-center justify-between mb-4 group">
          <div className="flex items-center gap-2">
            <Icon name="bar_chart" className="text-base text-rose-600" />
            <span className="text-[11px] font-label font-bold uppercase tracking-widest text-stone-600">
              Estadísticas de Merma
            </span>
          </div>
          <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
            <input
              type="month"
              value={statsMes}
              onChange={e => setStatsMes(e.target.value)}
              className="px-3 py-1 bg-background border border-outline-variant/20 rounded-lg text-xs font-body outline-none focus:border-primary transition-colors"
            />
            <Icon
              name={statsCollapsed ? 'expand_more' : 'expand_less'}
              className="text-stone-400 group-hover:text-stone-600 transition-colors pointer-events-none"
            />
          </div>
        </button>

        {!statsCollapsed && (
          <>
            {statsLoading ? (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
              </div>
            ) : !stats || !stats.totales || stats.totales.num_registros === 0 ? (
              <div className="py-10 flex flex-col items-center text-stone-300">
                <Icon name="bar_chart" className="text-4xl opacity-20 mb-2" />
                <p className="text-xs font-label uppercase tracking-widest">Sin mermas en este período</p>
              </div>
            ) : (
              <div className="space-y-4 mb-6">
                {/* Summary cards */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-4">
                    <p className="text-[10px] font-label font-bold uppercase tracking-widest text-rose-400 mb-1">Unidades perdidas</p>
                    <p className="text-3xl font-serif text-rose-700">{stats.totales.total_unidades}</p>
                  </div>
                  <div className="rounded-xl border border-orange-100 bg-orange-50/60 p-4">
                    <p className="text-[10px] font-label font-bold uppercase tracking-widest text-orange-400 mb-1">Incidencias</p>
                    <p className="text-3xl font-serif text-orange-700">{stats.totales.num_registros}</p>
                  </div>
                </div>

                {/* Por motivo */}
                {stats.porMotivo.length > 0 && (
                  <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low/50 p-4">
                    <p className="text-[10px] font-label font-bold uppercase tracking-widest text-stone-500 mb-3">Por motivo</p>
                    <div className="space-y-3">
                      {stats.porMotivo.map(m => {
                        const meta = MOTIVO_META[m.motivo as MermaTC52Record['motivo']] ?? MOTIVO_META.otro;
                        const pct  = stats.totales.total_unidades > 0
                          ? (m.total_unidades / stats.totales.total_unidades) * 100
                          : 0;
                        return (
                          <div key={m.motivo}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-label text-stone-600">{meta.emoji} {meta.label}</span>
                              <span className="text-xs font-label font-bold text-stone-500">
                                {m.total_unidades} uds
                                <span className="text-stone-400 font-normal ml-1">({pct.toFixed(0)}%)</span>
                              </span>
                            </div>
                            <div className="h-2 rounded-full bg-stone-100 overflow-hidden">
                              <div
                                className={cn('h-full rounded-full transition-all duration-500', meta.bg)}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Top productos */}
                {stats.topProductos.length > 0 && (
                  <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low/50 p-4">
                    <p className="text-[10px] font-label font-bold uppercase tracking-widest text-stone-500 mb-3">Top productos con más merma</p>
                    <div className="space-y-2">
                      {stats.topProductos.slice(0, 8).map((p, i) => (
                        <div key={p.codigo} className="flex items-center gap-3">
                          <span className="text-[10px] font-label font-bold text-stone-300 w-4 text-right">{i + 1}</span>
                          <span className="flex-1 text-xs font-body text-on-surface truncate">{p.nombre || p.codigo}</span>
                          <span className="text-xs font-label font-bold text-rose-600 flex-shrink-0">{p.total_unidades} uds</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

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
              <button
                onClick={exportarExcel}
                disabled={!tc52Records.length}
                title="Exportar a Excel"
                className="p-1.5 text-stone-400 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                <Icon name="download" className="text-base" />
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
  const { areas, areaMap } = useAreasCtx();
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
            <p className="text-sm font-body text-on-surface font-semibold">Reporte semanal por correo</p>
            <p className="text-[10px] font-label text-stone-400 mt-0.5 leading-relaxed">
              Se envía automáticamente todos los lunes a las 8:00 AM a <span className="font-mono">lacasitadeli2000@gmail.com</span>.<br />
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

// ── Movimientos unificados (TC52 + merma + surtido) ──────────────────────────
const TIPO_META: Record<TipoMovimiento, { label: string; sign: string; badgeCls: string; iconCls: string }> = {
  entrada:       { label: 'Entrada',       sign: '+', badgeCls: 'bg-emerald-50 text-emerald-700 border border-emerald-200',    iconCls: 'text-emerald-600' },
  salida:        { label: 'Salida',        sign: '−', badgeCls: 'bg-red-50 text-red-700 border border-red-200',                iconCls: 'text-red-600' },
  merma:         { label: 'Merma',         sign: '−', badgeCls: 'bg-orange-50 text-orange-700 border border-orange-200',       iconCls: 'text-orange-600' },
  transferencia: { label: 'Transferencia', sign: '↔', badgeCls: 'bg-blue-50 text-blue-700 border border-blue-200',             iconCls: 'text-blue-600' },
};

// ── TC52 stock row type ────────────────────────────────────────────────────────
interface Tc52StockRow { art_codigo: string; nombre: string | null; ubicacion: string; cantidad: number; updated_at: string }
interface Tc52Ubic     { nombre: string; color: string; orden: number }

function Tc52StockPanel() {
  const [rows,       setRows]       = useState<Tc52StockRow[]>([]);
  const [ubics,      setUbics]      = useState<Tc52Ubic[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [search,     setSearch]     = useState('');
  const [collapsed,  setCollapsed]  = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dataRows, dataUbics] = await Promise.all([
        fetch('/api/almacen/tc52/stock').then(r => r.json()),
        fetch('/api/almacen/tc52/ubicaciones').then(r => r.json()),
      ]);
      if (Array.isArray(dataRows))  setRows(dataRows);
      if (Array.isArray(dataUbics)) setUbics(dataUbics);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Pivot: {art_codigo, nombre, ubicaciones: {[ubic]: qty}, total}
  type PivotRow = { art_codigo: string; nombre: string | null; locs: Record<string, number>; total: number };
  const pivot = useMemo<PivotRow[]>(() => {
    const map = new Map<string, PivotRow>();
    for (const r of rows) {
      if (!map.has(r.art_codigo)) map.set(r.art_codigo, { art_codigo: r.art_codigo, nombre: r.nombre, locs: {}, total: 0 });
      const p = map.get(r.art_codigo)!;
      p.locs[r.ubicacion] = (p.locs[r.ubicacion] || 0) + r.cantidad;
      p.total += r.cantidad;
    }
    return Array.from(map.values()).sort((a, b) => (a.nombre || a.art_codigo).localeCompare(b.nombre || b.art_codigo, 'es'));
  }, [rows]);

  const filtered = useMemo(() => {
    if (!search.trim()) return pivot;
    const q = search.toLowerCase();
    return pivot.filter(p => (p.nombre || p.art_codigo).toLowerCase().includes(q));
  }, [pivot, search]);

  const totalesGlobales = useMemo(() => {
    const t: Record<string, number> = {};
    for (const r of rows) t[r.ubicacion] = (t[r.ubicacion] || 0) + r.cantidad;
    return t;
  }, [rows]);

  return (
    <div className="mb-8 rounded-2xl border border-outline-variant/10 bg-surface-container-low overflow-hidden">
      {/* Header */}
      <button onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 group">
        <div className="flex items-center gap-2">
          <Icon name="inventory_2" className="text-base text-emerald-600" />
          <span className="text-[11px] font-label font-bold uppercase tracking-widest text-stone-600">
            Stock actual por ubicación (TC52)
          </span>
          {!loading && rows.length > 0 && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-label font-bold">
              {filtered.length} productos · {rows.reduce((s, r) => s + r.cantidad, 0).toLocaleString('es-MX')} uds
            </span>
          )}
        </div>
        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          <button onClick={fetchAll} disabled={loading}
            className={cn('p-1.5 rounded-lg text-stone-400 hover:text-primary transition-all', loading && 'animate-spin')}>
            <Icon name="refresh" className="text-base" />
          </button>
          <Icon name={collapsed ? 'expand_more' : 'expand_less'}
            className="text-stone-400 group-hover:text-stone-600 transition-colors pointer-events-none" />
        </div>
      </button>

      {!collapsed && (
        <div className="px-5 pb-5">
          {/* Resumen chips por ubicación */}
          {ubics.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {ubics.map(u => {
                const total = totalesGlobales[u.nombre] || 0;
                const prods = new Set(rows.filter(r => r.ubicacion === u.nombre).map(r => r.art_codigo)).size;
                return (
                  <div key={u.nombre} className="px-3 py-2 rounded-xl border text-left"
                    style={{ borderColor: `${u.color}30`, background: `${u.color}10` }}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: u.color }} />
                      <span className="text-[10px] font-label font-bold uppercase tracking-widest" style={{ color: u.color }}>
                        {u.nombre}
                      </span>
                    </div>
                    <p className="text-lg font-serif" style={{ color: u.color }}>{total.toLocaleString('es-MX')}</p>
                    <p className="text-[9px] font-label text-stone-400">{prods} prod.</p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Buscador */}
          <div className="relative mb-4">
            <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-base" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar producto..."
              className="w-full pl-9 pr-4 py-2 bg-background border border-outline-variant/20 rounded-xl text-sm font-body outline-none focus:border-primary transition-colors" />
          </div>

          {/* Tabla pivot */}
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 flex flex-col items-center text-stone-300 border border-dashed border-stone-200 rounded-xl">
              <Icon name="inventory_2" className="text-5xl opacity-20 mb-2" />
              <p className="text-sm font-label uppercase tracking-widest">
                {rows.length === 0 ? 'Sin datos — registra entradas desde el TC52' : 'Sin resultados'}
              </p>
            </div>
          ) : (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden">
              <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                <table className="w-full text-left">
                  <thead className="bg-surface-container-low/60 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container sticky top-0">
                    <tr>
                      <th className="px-4 py-3 min-w-[200px]">Producto</th>
                      {ubics.map(u => (
                        <th key={u.nombre} className="px-3 py-3 text-center min-w-[80px]">
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full" style={{ background: u.color }} />
                            {u.nombre}
                          </span>
                        </th>
                      ))}
                      <th className="px-4 py-3 text-center">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container">
                    {filtered.map(p => (
                      <tr key={p.art_codigo} className="hover:bg-background transition-colors">
                        <td className="px-4 py-3">
                          <p className="text-sm font-body text-on-surface truncate max-w-[220px]">{p.nombre || p.art_codigo}</p>
                          <p className="text-[9px] font-label text-stone-400 mt-0.5 font-mono">{p.art_codigo}</p>
                        </td>
                        {ubics.map(u => {
                          const qty = p.locs[u.nombre] || 0;
                          return (
                            <td key={u.nombre} className="px-3 py-3 text-center">
                              {qty > 0 ? (
                                <span className="inline-block px-2 py-0.5 rounded-full text-xs font-serif font-bold min-w-[32px]"
                                  style={{ background: `${u.color}20`, color: u.color }}>
                                  {qty.toLocaleString('es-MX')}
                                </span>
                              ) : (
                                <span className="text-stone-200 text-xs">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-4 py-3 text-center">
                          <span className="font-serif font-bold text-on-surface">{p.total.toLocaleString('es-MX')}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-3 border-t border-surface-container bg-surface-container-low/30 flex items-center justify-between">
                <p className="text-[10px] font-label text-stone-400 uppercase tracking-widest">
                  {filtered.length} producto{filtered.length !== 1 ? 's' : ''} con stock
                </p>
                <p className="text-[10px] font-label text-stone-400">
                  Total: {filtered.reduce((s, p) => s + p.total, 0).toLocaleString('es-MX')} uds
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ZebraView() {
  const { areas, areaMap } = useAreasCtx();
  // Hora de Ciudad de México: los botones Hoy/Ayer/7 días filtran el día correcto
  // sin importar la zona horaria del celular que abre el panel.
  const today = hoyMX();
  const diasAtras = (n: number) => diasAtrasMX(n);
  const [movimientos, setMovimientos] = useState<MovimientoUnificado[]>([]);
  // Totales REALES del rango (vienen del backend por agregación), para las tarjetas.
  const [totales,     setTotales]     = useState<Record<TipoMovimiento, { n: number; uds: number }> | null>(null);
  const [loading,     setLoading]     = useState(false);
  // Rango de fechas (por defecto: últimos 7 días, para ver los movimientos recientes)
  const [desde,       setDesde]       = useState(diasAtras(6));
  const [hasta,       setHasta]       = useState(today);
  const [tipo,        setTipo]        = useState<TipoMovimiento | 'todos'>('todos');
  const [areaFiltro,  setAreaFiltro]  = useState('todas');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchMovimientos = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ desde, hasta });
      if (tipo !== 'todos') params.set('tipo', tipo);
      if (areaFiltro !== 'todas') params.set('area', areaFiltro);
      const data = await fetch(`/api/almacen/movimientos/todos?${params}`).then(r => r.json());
      if (data && Array.isArray(data.movimientos)) {
        setMovimientos(data.movimientos);
        setTotales(data.totales ?? null);
        setLastRefresh(new Date());
      } else if (Array.isArray(data)) { // compat por si el backend aún no está actualizado
        setMovimientos(data); setTotales(null); setLastRefresh(new Date());
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [desde, hasta, tipo, areaFiltro]);

  useEffect(() => { fetchMovimientos(); }, [fetchMovimientos]);

  const byTipo = useMemo(() => {
    const acc: Record<TipoMovimiento, MovimientoUnificado[]> = { entrada: [], salida: [], merma: [], transferencia: [] };
    for (const m of movimientos) acc[m.tipo]?.push(m);
    return acc;
  }, [movimientos]);

  // Total real de movimientos del rango (suma de las 4 tarjetas) — el listado va topado.
  const totalMovs = useMemo(
    () => totales ? Object.values(totales).reduce((s, x) => s + x.n, 0) : movimientos.length,
    [totales, movimientos.length],
  );

  // Opciones del filtro de Área: las configuradas + las que REALMENTE aparecen en
  // los movimientos (p.ej. una mal escrita como "Bogeda"), para poder filtrarlas.
  const areaOpciones = useMemo<[string, string][]>(() => {
    const map = new Map<string, string>();
    for (const a of areas) map.set(a, areaMap[a]?.label ?? a);
    for (const m of movimientos) {
      for (const k of [m.area_origen, m.area_destino]) {
        if (k && !map.has(k)) map.set(k, k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '));
      }
    }
    return Array.from(map.entries());
  }, [areas, areaMap, movimientos]);

  const PRESETS_FECHA = [
    { label: 'Hoy',    desde: today,        hasta: today },
    { label: 'Ayer',   desde: diasAtras(1), hasta: diasAtras(1) },
    { label: '7 días', desde: diasAtras(6), hasta: today },
    { label: 'Todo',   desde: '2000-01-01', hasta: today },
  ];

  const TIPOS_FILTER: { id: TipoMovimiento | 'todos'; label: string }[] = [
    { id: 'todos',        label: 'Todos' },
    { id: 'entrada',      label: '↓ Entradas' },
    { id: 'salida',       label: '↑ Salidas' },
    { id: 'merma',        label: '🗑 Mermas' },
    { id: 'transferencia',label: '↔ Traslados' },
  ];

  return (
    <div>
      {/* Stock por ubicación TC52 */}
      <Tc52StockPanel />

      {/* Filtros movimientos */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div>
          <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Desde</label>
          <input type="date" value={desde} max={hasta} onChange={e => setDesde(e.target.value)}
            className="px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
        </div>
        <div>
          <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Hasta</label>
          <input type="date" value={hasta} min={desde} onChange={e => setHasta(e.target.value)}
            className="px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
        </div>
        <div className="flex gap-1.5">
          {PRESETS_FECHA.map(p => {
            const activo = desde === p.desde && hasta === p.hasta;
            return (
              <button key={p.label} onClick={() => { setDesde(p.desde); setHasta(p.hasta); }}
                className={cn('px-3 py-2 rounded-lg text-[10px] font-label font-bold uppercase tracking-widest transition-all border',
                  activo ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container-low text-stone-500 hover:bg-primary/10 hover:text-primary border-outline-variant/20')}>
                {p.label}
              </button>
            );
          })}
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
            {areaOpciones.map(([clave, label]) => <option key={clave} value={clave}>{label}</option>)}
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
          // Tarjetas = totales REALES del rango (agregación del backend). Fallback al
          // listado solo si el backend viejo aún no manda `totales`.
          const tot   = totales?.[t];
          const count = tot ? tot.n   : byTipo[t].length;
          const uds   = tot ? tot.uds : byTipo[t].reduce((s, m) => s + Number(m.cantidad), 0);
          const meta  = TIPO_META[t];
          return (
            <div key={t} className={cn('rounded-xl p-4 text-center', meta.badgeCls.replace('border', '').replace('border-emerald-200', '').replace('border-red-200', '').replace('border-orange-200', '').replace('border-blue-200', ''))}>
              <p className="text-[10px] font-label uppercase tracking-widest mb-1">{meta.label}</p>
              <p className="text-2xl font-serif">{count.toLocaleString('es-MX')}</p>
              <p className="text-[10px] font-label mt-1">{meta.sign}{uds.toLocaleString('es-MX')} uds</p>
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
                  const meta = TIPO_META[m.tipo] ?? { label: m.tipo || 'Movimiento', sign: '', badgeCls: 'bg-stone-100 text-stone-600', iconCls: 'text-stone-500' };
                  const pretty = (k: string) => areaMap[k as Area]?.label ?? (k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '));
                  const areaOrigen  = m.area_origen  ? pretty(m.area_origen)  : null;
                  const areaDestino = m.area_destino ? pretty(m.area_destino) : null;
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
              {totalMovs > movimientos.length
                ? `Mostrando ${movimientos.length} de ${totalMovs.toLocaleString('es-MX')} movimientos`
                : `${totalMovs.toLocaleString('es-MX')} movimientos`} · {desde === hasta ? desde : `${desde} a ${hasta}`}
            </p>
            <div className="flex gap-3 text-[10px] font-label text-stone-400">
              {(['entrada', 'salida', 'merma', 'transferencia'] as TipoMovimiento[]).map(t => {
                const n = totales?.[t]?.n ?? byTipo[t].length;
                return n > 0 ? <span key={t}>{TIPO_META[t].label}: {n.toLocaleString('es-MX')}</span> : null;
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Configuración de Áreas ─────────────────────────────────────────────────────
// ── Recepción de Mercancía ─────────────────────────────────────────────────────

const ESTATUS_META: Record<EstatusRecepcion, { label: string; color: string; bg: string; icon: string }> = {
  Pendiente: { label: 'Pendiente',    color: 'text-amber-700',   bg: 'bg-amber-50',   icon: 'schedule' },
  Parcial:   { label: 'En Recepción', color: 'text-blue-700',    bg: 'bg-blue-50',    icon: 'local_shipping' },
  Recibida:  { label: 'Recibida',     color: 'text-emerald-700', bg: 'bg-emerald-50', icon: 'check_circle' },
  Cancelada: { label: 'Cancelada',    color: 'text-stone-500',   bg: 'bg-stone-100',  icon: 'cancel' },
};

const SEMAFORO_META: Record<SemaforoCaducidad, { label: string; color: string; bg: string }> = {
  VENCIDO: { label: 'Vencido', color: 'text-on-error',        bg: 'bg-error' },
  CRITICO: { label: 'Crítico', color: 'text-white',           bg: 'bg-orange-500' },
  AVISO:   { label: 'Aviso',   color: 'text-yellow-900',      bg: 'bg-yellow-400' },
  OK:      { label: 'OK',      color: 'text-emerald-700',     bg: 'bg-emerald-100' },
};

interface ItemForm { codigo_barras: string; nombre: string; cajas_esperadas: string; piezas_por_caja: string; }

// Selector interno (segmentado) para las pestañas combinadas
function SubSegment({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: { id: string; label: string; icon: string }[];
}) {
  return (
    <div className="flex gap-1 bg-surface-container rounded-xl p-1 mb-5 w-fit">
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className={cn('px-3 sm:px-4 py-1.5 rounded-lg text-[11px] font-label uppercase tracking-widest flex items-center gap-1.5 transition-all',
            value === o.id ? 'bg-primary text-on-primary' : 'text-stone-500 hover:text-stone-700')}>
          <Icon name={o.icon} className="text-sm" /> {o.label}
        </button>
      ))}
    </div>
  );
}

// Recepción + Productos nuevos (al recibir, los empleados registran productos
// nuevos que no estaban contemplados).
function RecepcionYNuevosView() {
  const [sub, setSub] = useState<'recepcion' | 'nuevos'>('recepcion');
  return (
    <div>
      <SubSegment value={sub} onChange={v => setSub(v as 'recepcion' | 'nuevos')} options={[
        { id: 'recepcion', label: 'Recepción',       icon: 'local_shipping' },
        { id: 'nuevos',    label: 'Productos nuevos', icon: 'pending_actions' },
      ]} />
      {sub === 'recepcion' ? <RecepcionView /> : <PendientesView />}
    </div>
  );
}

function RecepcionView() {
  const [pedidos,       setPedidos]       = useState<RecepcionEsperada[]>([]);
  const [selected,      setSelected]      = useState<RecepcionEsperadaConDetalle | null>(null);
  const [discrepancias, setDiscrepancias] = useState<RecepcionDiscrepancia[]>([]);
  const [caducidades,   setCaducidades]   = useState<CaducidadItem[]>([]);
  const [showForm,      setShowForm]      = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [confirming,    setConfirming]    = useState(false);
  const [filtroEstado,  setFiltroEstado]  = useState<string>('activos');
  const [notif, setNotif] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Formulario nueva orden
  const [proveedor,      setProveedor]      = useState('');
  const [fechaEsperada,  setFechaEsperada]  = useState('');
  const [notas,          setNotas]          = useState('');
  const [items,          setItems]          = useState<ItemForm[]>([{ codigo_barras: '', nombre: '', cajas_esperadas: '', piezas_por_caja: '1' }]);
  const [busqueda,       setBusqueda]       = useState<Record<number, string>>({});
  const [sugerencias,    setSugerencias]    = useState<Record<number, { id: string; nombre: string }[]>>({});

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type }); setTimeout(() => setNotif(null), 3500);
  };

  const fetchPedidos = useCallback(async () => {
    setLoading(true);
    try {
      const estadoParam =
        filtroEstado === 'activos'    ? 'activos'   :
        filtroEstado === 'recibidas'  ? 'Recibida'  :
        filtroEstado === 'canceladas' ? 'Cancelada' : '';
      const url = `/api/recepcion/esperadas${estadoParam ? `?estado=${encodeURIComponent(estadoParam)}` : ''}`;
      const data = await fetch(url).then(r => r.json());
      setPedidos(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [filtroEstado]);

  const fetchDetalle = useCallback(async (id: number) => {
    try {
      const [det, disc, cad] = await Promise.all([
        fetch(`/api/recepcion/esperadas/${id}`).then(r => r.json()),
        fetch(`/api/recepcion/discrepancias/${id}`).then(r => r.json()),
        fetch('/api/recepcion/caducidades?dias=30').then(r => r.json()),
      ]);
      setSelected(det && !det.error ? det : null);
      setDiscrepancias(Array.isArray(disc) ? disc : []);
      setCaducidades(Array.isArray(cad) ? cad : []);
    } catch { notify('Error al cargar detalle', 'error'); }
  }, []);

  useEffect(() => { fetchPedidos(); }, [fetchPedidos]);

  // Auto-refresh del detalle cada 20s mientras la orden sigue activa, solo si la
  // pestaña está visible (menos carga a compucaja).
  useEffect(() => {
    if (!selected || selected.estatus === 'Recibida' || selected.estatus === 'Cancelada') return;
    const t = setInterval(() => { if (!document.hidden) fetchDetalle(selected.id); }, 20000);
    return () => clearInterval(t);
  }, [selected?.id, selected?.estatus, fetchDetalle]);

  const buscarProducto = async (idx: number, q: string) => {
    setBusqueda(p => ({ ...p, [idx]: q }));
    // Si el usuario escribe de nuevo, limpiar el código seleccionado previamente
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, codigo_barras: '', nombre: '' } : it));
    if (q.length < 2) { setSugerencias(p => ({ ...p, [idx]: [] })); return; }
    try {
      const res = await fetch(`/api/almacen/buscar?q=${encodeURIComponent(q)}`).then(r => r.json());
      setSugerencias(p => ({ ...p, [idx]: (res || []).slice(0, 6).map((r: any) => ({ id: r.codigo, nombre: r.nombre })) }));
    } catch { /* silent */ }
  };

  const seleccionarProducto = (idx: number, codigo: string, nombre: string) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, codigo_barras: codigo, nombre } : it));
    setBusqueda(p => ({ ...p, [idx]: nombre }));
    setSugerencias(p => ({ ...p, [idx]: [] }));
  };

  const agregarItem = () => setItems(p => [...p, { codigo_barras: '', nombre: '', cajas_esperadas: '', piezas_por_caja: '1' }]);
  const quitarItem  = (idx: number) => setItems(p => p.filter((_, i) => i !== idx));

  const crearPedido = async () => {
    const validItems = items.filter(it => it.codigo_barras && parseInt(it.cajas_esperadas) > 0);
    if (!validItems.length) { notify('Agrega al menos un producto con cajas esperadas', 'error'); return; }
    setSaving(true);
    try {
      const res  = await fetch('/api/recepcion/esperadas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proveedor,
          fecha_esperada: fechaEsperada || null,
          notas,
          items: validItems.map(it => ({
            codigo_barras:   it.codigo_barras,
            cajas_esperadas: parseInt(it.cajas_esperadas),
            piezas_por_caja: parseInt(it.piezas_por_caja) || 1,
          })),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        notify(`Orden ${data.folio} creada`);
        setShowForm(false);
        setProveedor(''); setFechaEsperada(''); setNotas('');
        setItems([{ codigo_barras: '', nombre: '', cajas_esperadas: '', piezas_por_caja: '1' }]);
        fetchPedidos();
      } else notify(data.error || 'Error al crear', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setSaving(false); }
  };

  const confirmarRecepcion = async () => {
    if (!selected) return;
    const real = selected.recepciones_reales?.[0];
    if (!real) { notify('Aún no hay recepción física del TC52 para confirmar', 'error'); return; }
    setConfirming(true);
    try {
      const res  = await fetch(`/api/recepcion/reales/${real.id}/confirmar`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) { notify(data.mensaje || 'Recepción confirmada · stock actualizado'); fetchDetalle(selected.id); fetchPedidos(); }
      else notify(data.error || 'Error al confirmar', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setConfirming(false); }
  };

  const cancelarOrden = async (id: number) => {
    try {
      await fetch(`/api/recepcion/esperadas/${id}/cancelar`, { method: 'PATCH' });
      notify('Orden cancelada');
      fetchPedidos();
      if (selected?.id === id) fetchDetalle(id);
    } catch { notify('Error', 'error'); }
  };

  // Caducidad más urgente por código de barras
  const caducidadMap = useMemo(() => {
    const m = new Map<string, CaducidadItem>();
    for (const c of caducidades) {
      const prev = m.get(c.codigo_barras);
      if (!prev || c.dias_para_vencer < prev.dias_para_vencer) m.set(c.codigo_barras, c);
    }
    return m;
  }, [caducidades]);

  // Filas de discrepancias: esperado (todos los items) + recibido (merge por código)
  const filas = useMemo(() => {
    const m = new Map<string, {
      codigo: string; nombre: string;
      cajas_esperadas: number; cajas_recibidas: number; diferencia_cajas: number;
      piezas_esperadas: number; piezas_recibidas: number;
    }>();
    for (const d of (selected?.detalle ?? [])) {
      m.set(d.codigo_barras, {
        codigo: d.codigo_barras, nombre: d.nombre,
        cajas_esperadas: d.cajas_esperadas, cajas_recibidas: 0, diferencia_cajas: -d.cajas_esperadas,
        piezas_esperadas: d.piezas_esperadas, piezas_recibidas: 0,
      });
    }
    for (const x of discrepancias) {
      m.set(x.codigo_barras, {
        codigo: x.codigo_barras, nombre: x.nombre,
        cajas_esperadas: x.cajas_esperadas, cajas_recibidas: x.cajas_recibidas, diferencia_cajas: x.diferencia_cajas,
        piezas_esperadas: x.piezas_esperadas, piezas_recibidas: x.piezas_recibidas,
      });
    }
    return Array.from(m.values());
  }, [selected, discrepancias]);

  const pedidosFiltrados = pedidos;

  return (
    <div>
      {notif && (
        <div className={cn('fixed top-4 right-4 z-[300] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-label font-bold',
          notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error')}>
          <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
          {notif.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h3 className="font-serif text-xl text-primary">Recepción de Mercancía</h3>
          <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mt-0.5">
            Registra lo esperado · el TC52 confirma lo recibido · el sistema detecta diferencias
          </p>
        </div>
        <button onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary text-on-primary rounded-xl text-[11px] font-label font-bold uppercase tracking-widest hover:bg-primary/90 shadow-sm transition-all">
          <Icon name={showForm ? 'close' : 'add'} className="text-base" />
          {showForm ? 'Cancelar' : 'Nueva Orden'}
        </button>
      </div>

      {/* Formulario nueva orden */}
      {showForm && (
        <div className="bg-surface-container-lowest rounded-2xl border border-primary/20 p-5 mb-6 space-y-4">
          <h4 className="font-serif text-base text-primary flex items-center gap-2">
            <Icon name="local_shipping" className="text-primary" /> Nueva Orden de Recepción
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Proveedor</label>
              <input value={proveedor} onChange={e => setProveedor(e.target.value)} placeholder="Nombre del proveedor"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Fecha esperada</label>
              <input type="date" value={fechaEsperada} onChange={e => setFechaEsperada(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Notas</label>
              <input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Opcional"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500">Productos esperados</label>
              <button onClick={agregarItem} className="flex items-center gap-1 text-[10px] font-label uppercase tracking-widest text-primary hover:underline">
                <Icon name="add_circle" className="text-sm" /> Agregar producto
              </button>
            </div>
            {/* Encabezados de columnas */}
            <div className="hidden sm:flex gap-2 items-center px-1 mb-1">
              <span className="flex-1 text-[9px] font-label uppercase tracking-widest text-stone-400">Producto</span>
              <span className="w-20 text-center text-[9px] font-label uppercase tracking-widest text-stone-400">Cajas</span>
              <span className="w-20 text-center text-[9px] font-label uppercase tracking-widest text-stone-400">Pzas/caja</span>
              <span className="w-8 flex-shrink-0" />
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  {/* Buscador de producto */}
                  <div className="flex-1 relative">
                    <div className="relative">
                      <input
                        value={busqueda[idx] ?? item.nombre}
                        onChange={e => buscarProducto(idx, e.target.value)}
                        placeholder="Buscar producto por nombre o código…"
                        className={cn(
                          'w-full px-3 py-2 bg-background border rounded-lg text-sm font-body outline-none focus:border-primary transition-colors pr-8',
                          item.codigo_barras ? 'border-emerald-400 bg-emerald-50/40' : 'border-outline-variant/20'
                        )}
                      />
                      {item.codigo_barras && (
                        <Icon name="check_circle" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-emerald-500 text-base pointer-events-none" />
                      )}
                    </div>
                    {item.codigo_barras && (
                      <p className="text-[9px] font-mono text-emerald-600 mt-0.5 ml-1">
                        {item.codigo_barras}
                      </p>
                    )}
                    {(sugerencias[idx] || []).length > 0 && (
                      <div className="absolute top-full left-0 right-0 z-50 bg-surface-container-lowest border border-outline-variant/20 rounded-xl shadow-xl mt-1 overflow-hidden">
                        {sugerencias[idx].map(s => (
                          <button key={s.id} onClick={() => seleccionarProducto(idx, s.id, s.nombre)}
                            className="w-full text-left px-3 py-2 text-sm font-body hover:bg-primary/5 flex items-center gap-2 border-b border-outline-variant/5 last:border-0">
                            <Icon name="inventory_2" className="text-stone-300 text-sm flex-shrink-0" />
                            <span className="flex-1 min-w-0 truncate">{s.nombre}</span>
                            <span className="text-[10px] font-mono text-stone-400 flex-shrink-0">{s.id}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Cajas esperadas */}
                  <div className="w-20 flex-shrink-0">
                    <input type="number" min="1" value={item.cajas_esperadas}
                      onChange={e => setItems(p => p.map((it, i) => i === idx ? { ...it, cajas_esperadas: e.target.value } : it))}
                      placeholder="Cajas"
                      className="w-full px-2 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors text-center"
                    />
                  </div>
                  {/* Piezas por caja */}
                  <div className="w-20 flex-shrink-0">
                    <input type="number" min="1" value={item.piezas_por_caja}
                      onChange={e => setItems(p => p.map((it, i) => i === idx ? { ...it, piezas_por_caja: e.target.value } : it))}
                      placeholder="Pzas"
                      className="w-full px-2 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors text-center"
                    />
                  </div>
                  <button onClick={() => quitarItem(idx)} disabled={items.length === 1}
                    className="p-2 text-stone-300 hover:text-error transition-colors disabled:opacity-20 flex-shrink-0 mt-0.5">
                    <Icon name="remove_circle_outline" className="text-lg" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={crearPedido} disabled={saving}
              className={cn('flex-1 py-2.5 rounded-xl text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all',
                saving ? 'bg-stone-200 text-stone-400' : 'bg-primary text-on-primary hover:bg-primary/90')}>
              {saving ? <div className="w-3 h-3 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" /> : <Icon name="save" className="text-sm" />}
              Crear Orden
            </button>
            <button onClick={() => setShowForm(false)} className="px-5 py-2.5 bg-surface-container text-stone-500 rounded-xl text-xs font-label uppercase tracking-widest">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Vista detalle de una orden */}
      {selected && (
        <div className="mb-6 bg-surface-container-lowest rounded-2xl border border-outline-variant/10 overflow-hidden">
          {/* Header del detalle */}
          <div className="p-4 border-b border-outline-variant/10 flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-serif text-primary font-bold">{selected.referencia}</span>
                <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-label font-bold uppercase tracking-widest flex items-center gap-1',
                  ESTATUS_META[selected.estatus].bg, ESTATUS_META[selected.estatus].color)}>
                  <Icon name={ESTATUS_META[selected.estatus].icon} className="text-xs" />
                  {ESTATUS_META[selected.estatus].label}
                </span>
              </div>
              <p className="text-xs font-body text-stone-500 mt-1">
                {selected.proveedor || 'Sin proveedor'}{selected.fecha_esperada ? ` · Esperado: ${new Date(selected.fecha_esperada.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
              </p>
              {selected.notas && <p className="text-xs font-body text-stone-400 mt-0.5 italic">{selected.notas}</p>}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {selected.estatus === 'Parcial' && (
                <span className="flex items-center gap-1.5 text-[9px] font-label uppercase tracking-widest text-blue-600 bg-blue-50 border border-blue-200 px-2 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse inline-block" />
                  TC52 activo · live
                </span>
              )}
              <button onClick={() => fetchDetalle(selected.id)}
                className="p-1.5 rounded-lg text-stone-400 hover:text-primary hover:bg-surface-container transition-all"
                title="Actualizar">
                <Icon name="refresh" className="text-base" />
              </button>
              {selected.estatus !== 'Recibida' && selected.estatus !== 'Cancelada' && (
                <button onClick={confirmarRecepcion} disabled={confirming}
                  className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-label font-bold uppercase tracking-widest transition-all border',
                    confirming ? 'bg-stone-100 text-stone-400 border-stone-200' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200')}>
                  {confirming
                    ? <div className="w-3 h-3 border-2 border-emerald-400/40 border-t-emerald-600 rounded-full animate-spin" />
                    : <Icon name="check_circle" className="text-sm" />}
                  Confirmar recepción
                </button>
              )}
              {selected.estatus === 'Pendiente' && (
                <button onClick={() => cancelarOrden(selected.id)}
                  className="p-1.5 rounded-lg text-stone-300 hover:text-error hover:bg-error-container/20 transition-all"
                  title="Cancelar orden">
                  <Icon name="block" className="text-base" />
                </button>
              )}
              <button onClick={() => setSelected(null)}
                className="p-1.5 rounded-lg text-stone-300 hover:text-stone-500 hover:bg-surface-container transition-all">
                <Icon name="close" className="text-lg" />
              </button>
            </div>
          </div>

          {/* Tabla de discrepancias (cajas + piezas) */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-container-low">
                  <th className="text-left px-4 py-2.5 text-[10px] font-label uppercase tracking-widest text-stone-500">Producto</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-label uppercase tracking-widest text-stone-500">Cajas esp.</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-label uppercase tracking-widest text-stone-500">Cajas rec.</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-label uppercase tracking-widest text-stone-500">Dif.</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-label uppercase tracking-widest text-stone-500">Pzas esp.</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-label uppercase tracking-widest text-stone-500">Pzas rec.</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(f => {
                  const ok       = f.diferencia_cajas === 0;
                  const faltante = f.diferencia_cajas < 0;
                  const sobrante = f.diferencia_cajas > 0;
                  const cad      = caducidadMap.get(f.codigo);
                  return (
                    <tr key={f.codigo} className="border-t border-outline-variant/5 hover:bg-surface-container-low/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-body text-on-surface text-sm">{f.nombre || f.codigo}</p>
                          {cad && (
                            <span
                              title={`Caduca ${cad.caducidad}${cad.lote ? ` · Lote ${cad.lote}` : ''}`}
                              className={cn('px-1.5 py-0.5 rounded-full text-[9px] font-label font-bold uppercase tracking-wider', SEMAFORO_META[cad.semaforo].bg, SEMAFORO_META[cad.semaforo].color)}>
                              {SEMAFORO_META[cad.semaforo].label}{cad.dias_para_vencer >= 0 ? ` · ${cad.dias_para_vencer}d` : ''}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] font-mono text-stone-400">{f.codigo}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-body font-semibold text-stone-600">{f.cajas_esperadas}</td>
                      <td className="px-4 py-3 text-right font-body font-semibold">
                        <span className={f.cajas_recibidas === 0 ? 'text-stone-300' : 'text-on-surface'}>{f.cajas_recibidas}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-serif font-bold text-base">
                        <span className={ok ? 'text-emerald-600' : faltante ? 'text-error' : 'text-amber-600'}>
                          {sobrante ? '+' : ''}{f.diferencia_cajas}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-body text-stone-600">{Number(f.piezas_esperadas).toLocaleString('es-MX')}</td>
                      <td className="px-4 py-3 text-right font-body">
                        <span className={f.piezas_recibidas === 0 ? 'text-stone-300' : 'text-on-surface'}>{Number(f.piezas_recibidas).toLocaleString('es-MX')}</span>
                      </td>
                    </tr>
                  );
                })}
                {filas.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-stone-300 text-xs font-label uppercase tracking-widest">
                      Sin productos en esta orden
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Resumen */}
          <div className="p-4 border-t border-outline-variant/10 flex gap-4 flex-wrap">
            {(() => {
              const faltantes  = filas.filter(f => f.diferencia_cajas < 0).length;
              const sobrantes  = filas.filter(f => f.diferencia_cajas > 0).length;
              const okc        = filas.filter(f => f.diferencia_cajas === 0 && f.cajas_recibidas > 0).length;
              const pendientes = filas.filter(f => f.cajas_recibidas === 0).length;
              return (
                <>
                  <div className="flex items-center gap-1.5 text-[11px] font-label text-emerald-600"><Icon name="check_circle" className="text-sm" />{okc} correctos</div>
                  <div className="flex items-center gap-1.5 text-[11px] font-label text-error"><Icon name="warning" className="text-sm" />{faltantes} faltantes</div>
                  <div className="flex items-center gap-1.5 text-[11px] font-label text-amber-600"><Icon name="info" className="text-sm" />{sobrantes} sobrantes</div>
                  <div className="flex items-center gap-1.5 text-[11px] font-label text-stone-400"><Icon name="schedule" className="text-sm" />{pendientes} sin recibir</div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-2 mb-4">
        {[
          { id: 'activos',    label: 'Activos' },
          { id: 'recibidas',  label: 'Recibidas' },
          { id: 'canceladas', label: 'Canceladas' },
          { id: 'todos',      label: 'Todos' },
        ].map(f => (
          <button key={f.id} onClick={() => setFiltroEstado(f.id)}
            className={cn('px-3 py-1.5 rounded-lg text-[10px] font-label font-bold uppercase tracking-widest transition-all',
              filtroEstado === f.id ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-stone-500 hover:text-primary hover:bg-primary/5')}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Lista de pedidos */}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-7 h-7 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      ) : pedidosFiltrados.length === 0 ? (
        <div className="py-14 flex flex-col items-center text-stone-300 border border-dashed border-stone-200 rounded-2xl">
          <Icon name="local_shipping" className="text-5xl opacity-20 mb-3" />
          <p className="text-xs font-label uppercase tracking-widest">Sin órdenes en esta categoría</p>
          <p className="text-xs font-body text-stone-300 mt-1">Crea una nueva orden cuando esperes un trailer</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pedidosFiltrados.map(p => {
            const meta = ESTATUS_META[p.estatus];
            return (
              <button key={p.id} onClick={() => fetchDetalle(p.id)}
                className={cn('w-full text-left bg-surface-container-lowest rounded-xl border transition-all hover:border-primary/30 hover:shadow-sm p-4',
                  selected?.id === p.id ? 'border-primary/40 ring-1 ring-primary/20' : 'border-outline-variant/10')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-serif text-sm text-primary font-bold">{p.referencia}</span>
                      <span className={cn('px-2 py-0.5 rounded-full text-[9px] font-label font-bold uppercase tracking-widest flex items-center gap-1', meta.bg, meta.color)}>
                        <Icon name={meta.icon} className="text-[10px]" />{meta.label}
                      </span>
                    </div>
                    <p className="text-xs font-body text-stone-500 mt-0.5 truncate">
                      {p.proveedor || 'Sin proveedor'}{p.fecha_esperada ? ` · ${new Date(p.fecha_esperada.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}` : ''}
                      {' · '}{p.num_items} productos
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-label font-bold text-stone-600">{p.total_cajas_esperadas} cajas</p>
                    <p className="text-[10px] font-label text-stone-400">{Number(p.total_piezas_esperadas).toLocaleString('es-MX')} pzas esp.</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

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

// ── Facturas sub-view ─────────────────────────────────────────────────────────
const ESTADO_FACTURA_META: Record<EstadoFactura, { label: string; color: string; bg: string; icon: string }> = {
  en_camino:  { label: 'En Camino',  color: 'text-blue-700',  bg: 'bg-blue-100',  icon: 'local_shipping' },
  en_almacen: { label: 'En Almacén', color: 'text-green-700', bg: 'bg-green-100', icon: 'inventory_2' },
  cancelada:  { label: 'Cancelada',  color: 'text-stone-500', bg: 'bg-stone-100', icon: 'cancel' },
};

interface FacturaItemForm { art_codigo: string; nombre: string; cantidad: string; precio_unitario: string }
const ITEM_VACIO: FacturaItemForm = { art_codigo: '', nombre: '', cantidad: '', precio_unitario: '' };

// ── Lector de facturas PDF → orden de recepción ───────────────────────────────
type PdfMapeo = { codigo_barras: string; nombre_interno: string | null; piezas_por_caja: number };
type PdfItem = {
  sku_proveedor: string; descripcion_proveedor: string; unidad: string;
  cajas_esperadas: number; cajas_ordenadas: number | null;
  precio_unitario: number | null; importe: number | null; mapeo: PdfMapeo | null;
  pendiente?: boolean; // registrado como producto nuevo (aún sin código en NovaCaja)
};
type PdfData = {
  ok: boolean; proveedor: string; referencia: string | null; fecha: string | null;
  total_items: number; mapeados: number; sin_mapear: number; items: PdfItem[];
};

// Sub-fila para enlazar un SKU del proveedor con un producto interno
type Cand = { codigo: string; nombre: string; stock?: number };

function EnlazarSku({ item, proveedor, onLinked, onPending, onCancel, onNotify }: {
  item: PdfItem; proveedor: string;
  onLinked: (m: PdfMapeo) => void; onPending: () => void; onCancel: () => void;
  onNotify: (m: string, t?: 'success' | 'error') => void;
}) {
  const [q,   setQ]   = useState('');
  const [sug, setSug] = useState<Cand[]>([]);
  const [sel, setSel] = useState<Cand | null>(null);
  const [ppc, setPpc] = useState('1');
  const [saving,   setSaving]   = useState(false);
  const [regNuevo, setRegNuevo] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [auto,     setAuto]     = useState(true); // sugerencias por nombre (no manual)

  // Al abrir: auto-sugerir por NOMBRE (sin teclear) usando la descripción del proveedor
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch(`/api/almacen/buscar-coincidencias?desc=${encodeURIComponent(item.descripcion_proveedor)}`).then(r => r.json());
        if (vivo) setSug(Array.isArray(r.items) ? r.items : []);
      } catch { /* silent */ }
      finally { if (vivo) setCargando(false); }
    })();
    return () => { vivo = false; };
  }, [item.descripcion_proveedor]);

  const buscarManual = async (text: string) => {
    setQ(text); setSel(null); setAuto(false);
    if (text.trim().length < 2) { setSug([]); return; }
    setCargando(true);
    try {
      const r = await fetch(`/api/almacen/buscar?q=${encodeURIComponent(text)}`).then(r => r.json());
      setSug((Array.isArray(r) ? r : []).slice(0, 8).map((x: any) => ({ codigo: x.codigo, nombre: x.nombre, stock: x.stock })));
    } catch { /* silent */ }
    finally { setCargando(false); }
  };

  const guardar = async () => {
    if (!sel) { onNotify('Elige el producto interno', 'error'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/recepcion/equivalencias', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proveedor, sku_proveedor: item.sku_proveedor,
          descripcion_proveedor: item.descripcion_proveedor, unidad_compra: item.unidad,
          piezas_por_caja: parseInt(ppc) || 1, codigo_barras: sel.codigo,
        }),
      });
      const j = await res.json();
      if (res.ok) onLinked({ codigo_barras: sel.codigo, nombre_interno: j.nombre_interno || sel.nombre, piezas_por_caja: parseInt(ppc) || 1 });
      else onNotify(j.error || 'Error al enlazar', 'error');
    } catch { onNotify('Error de conexión', 'error'); }
    finally { setSaving(false); }
  };

  // Registrar como producto NUEVO (no está en NovaCaja). Queda pendiente: se le
  // asignará su código de barras al llegar a la bodega (TC52 o panel).
  const registrarNuevo = async () => {
    setRegNuevo(true);
    try {
      const res = await fetch('/api/almacen/productos-pendientes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proveedor, sku_proveedor: item.sku_proveedor,
          descripcion_proveedor: item.descripcion_proveedor, unidad: item.unidad,
          piezas_por_caja: parseInt(ppc) || 1, cajas: item.cajas_esperadas || 0,
          precio_unitario: item.precio_unitario, origen: 'pdf',
        }),
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        onNotify(j.yaExistia ? 'Ya estaba registrado como pendiente' : 'Registrado como producto nuevo (pendiente)');
        onPending();
      } else onNotify(j.error || 'Error al registrar', 'error');
    } catch { onNotify('Error de conexión', 'error'); }
    finally { setRegNuevo(false); }
  };

  return (
    <div className="bg-amber-50/60 border border-amber-200 rounded-lg p-3 mt-1">
      <p className="text-[10px] font-label uppercase tracking-widest text-amber-700 mb-2">
        Enlazar “{item.descripcion_proveedor}” (SKU {item.sku_proveedor})
      </p>
      <div className="flex flex-col sm:flex-row gap-2 mb-2">
        <input value={q} onChange={e => buscarManual(e.target.value)}
          placeholder="¿No es ninguna de abajo? Busca por nombre o código…"
          className={cn('flex-1 px-3 py-2 bg-background border rounded-lg text-sm font-body outline-none focus:border-primary',
            sel ? 'border-emerald-400 bg-emerald-50/40' : 'border-outline-variant/20')} />
        <div className="w-28 flex-shrink-0">
          <input type="number" min="1" value={ppc} onChange={e => setPpc(e.target.value)} placeholder="Pzas/caja"
            title="Piezas por caja"
            className="w-full px-2 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body text-center outline-none focus:border-primary" />
        </div>
        <button onClick={guardar} disabled={saving || !sel}
          className={cn('px-3 py-2 rounded-lg text-[11px] font-label font-bold uppercase tracking-widest',
            saving || !sel ? 'bg-stone-200 text-stone-400' : 'bg-primary text-on-primary')}>
          {saving ? '...' : 'Enlazar'}
        </button>
        <button onClick={onCancel} className="px-2 py-2 text-stone-400 hover:text-stone-600 rounded-lg">
          <Icon name="close" className="text-base" />
        </button>
      </div>

      {/* Coincidencias (auto por nombre, o resultados de búsqueda) */}
      <p className="text-[9px] font-label uppercase tracking-widest text-stone-400 mb-1">
        {auto ? 'Coincidencias en el inventario por nombre' : 'Resultados'}
      </p>
      {cargando ? (
        <p className="text-[11px] font-body text-stone-400 py-1">Buscando…</p>
      ) : sug.length === 0 ? (
        <p className="text-[11px] font-body text-stone-400 py-1">
          Sin coincidencias. Escribe arriba para buscar manualmente.
        </p>
      ) : (
        <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
          {sug.map(s => (
            <button key={s.codigo} onClick={() => { setSel(s); setQ(s.nombre); }}
              className={cn('w-full text-left px-3 py-1.5 rounded-lg text-sm font-body flex items-center gap-2 border transition-all',
                sel?.codigo === s.codigo ? 'border-emerald-400 bg-emerald-50' : 'border-outline-variant/10 bg-surface hover:bg-primary/5')}>
              {sel?.codigo === s.codigo && <Icon name="check_circle" className="text-emerald-500 text-sm flex-shrink-0" />}
              <span className="flex-1 min-w-0 truncate">{s.nombre}</span>
              {typeof s.stock === 'number' && <span className="text-[10px] font-label text-stone-400 flex-shrink-0">stock {s.stock}</span>}
              <span className="text-[10px] font-mono text-stone-400 flex-shrink-0">{s.codigo}</span>
            </button>
          ))}
        </div>
      )}

      {/* ¿De plano no está en la DB? Registrarlo como producto nuevo (pendiente) */}
      <div className="mt-2 pt-2 border-t border-amber-200/60 flex items-center justify-between gap-2">
        <span className="text-[10px] font-body text-stone-500">
          ¿No está en el inventario? Regístralo y asígnale su código al llegar a bodega.
        </span>
        <button onClick={registrarNuevo} disabled={regNuevo}
          className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[10px] font-label font-bold uppercase tracking-widest hover:bg-amber-600 transition-all flex items-center gap-1 disabled:opacity-50 flex-shrink-0">
          <Icon name="add_circle" className="text-sm" /> {regNuevo ? '...' : 'Registrar como nuevo'}
        </button>
      </div>
    </div>
  );
}

function FacturaPdfModal({ onClose, onNotify, onCreated }: {
  onClose: () => void; onNotify: (m: string, t?: 'success' | 'error') => void; onCreated: () => void;
}) {
  const [loading,  setLoading]  = useState(false);
  const [data,     setData]     = useState<PdfData | null>(null);
  const [creating, setCreating] = useState(false);
  const [linkIdx,  setLinkIdx]  = useState<number | null>(null);

  const subir = async (file: File) => {
    setLoading(true); setData(null);
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch('/api/facturas/leer-pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: buf,
      });
      const j = await res.json();
      if (!res.ok || !j.ok) onNotify(j.error || 'No se pudo leer el PDF', 'error');
      else setData(j);
    } catch { onNotify('Error al leer el PDF', 'error'); }
    finally { setLoading(false); }
  };

  const aplicarMapeo = (idx: number, mapeo: PdfMapeo) => {
    setData(d => d ? { ...d, items: d.items.map((it, i) => i === idx ? { ...it, mapeo, pendiente: false } : it) } : d);
    setLinkIdx(null);
  };

  const marcarPendiente = (idx: number) => {
    setData(d => d ? { ...d, items: d.items.map((it, i) => i === idx ? { ...it, pendiente: true, mapeo: null } : it) } : d);
    setLinkIdx(null);
  };

  const items      = data?.items ?? [];
  const mapeados   = items.filter(i => i.mapeo).length;
  const pendientes = items.filter(i => i.pendiente).length;
  const listos     = items.filter(i => i.mapeo && i.cajas_esperadas > 0).length;

  const crearOrden = async () => {
    if (!data) return;
    const itemsOrden = items.filter(i => i.mapeo && i.cajas_esperadas > 0).map(i => ({
      codigo_barras:      i.mapeo!.codigo_barras,
      cajas_esperadas:    i.cajas_esperadas,
      piezas_por_caja:    i.mapeo!.piezas_por_caja || 1,
      // precio de compra de la factura (por caja) → alimenta el costo exacto
      precio_compra_caja: i.precio_unitario ?? null,
    }));
    if (!itemsOrden.length) { onNotify('No hay productos enlazados con cajas para crear la orden', 'error'); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/recepcion/esperadas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proveedor: data.proveedor, fecha_esperada: null,
          notas: `Importado de factura ${data.referencia || ''} (PDF)`.trim(),
          items: itemsOrden,
        }),
      });
      const j = await res.json();
      if (res.ok) { onNotify(`Orden ${j.folio} creada con ${itemsOrden.length} productos`); onCreated(); onClose(); }
      else onNotify(j.error || 'Error al crear la orden', 'error');
    } catch { onNotify('Error de conexión', 'error'); }
    finally { setCreating(false); }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface w-full max-w-5xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 border-b border-outline-variant/10 flex items-center justify-between">
          <div>
            <h3 className="font-serif text-xl text-primary">Leer factura PDF</h3>
            <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mt-0.5">
              Sube el PDF → enlaza los productos → crea la orden de recepción
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-surface-container">
            <Icon name="close" className="text-xl" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {!data ? (
            <div className="flex flex-col items-center justify-center py-16">
              {loading ? (
                <>
                  <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
                  <p className="font-serif italic text-primary">Leyendo el PDF…</p>
                </>
              ) : (
                <>
                  <Icon name="picture_as_pdf" className="text-6xl text-stone-300 mb-4" />
                  <label className="px-5 py-2.5 bg-primary text-on-primary rounded-xl text-xs font-label font-bold uppercase tracking-widest cursor-pointer hover:bg-primary-container transition-all flex items-center gap-2">
                    <Icon name="upload_file" className="text-base" /> Seleccionar PDF
                    <input type="file" accept="application/pdf" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) subir(f); }} />
                  </label>
                  <p className="text-[11px] font-body text-stone-400 mt-3 text-center max-w-xs">
                    Proveedores soportados: Nassau Candy. Otros formatos se reconocen y avisan si no hay plantilla.
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Resumen */}
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="font-serif text-lg text-primary">{data.proveedor}</span>
                {data.referencia && <span className="text-xs font-mono text-stone-500">Factura {data.referencia}</span>}
                {data.fecha && <span className="text-xs font-label text-stone-400">{data.fecha}</span>}
                <span className="ml-auto text-[10px] font-label uppercase tracking-widest text-stone-500">
                  {items.length} renglones · <span className="text-emerald-600">{mapeados} enlazados</span>
                  {pendientes > 0 && <> · <span className="text-purple-600">{pendientes} nuevos</span></>}
                  {' · '}<span className="text-amber-600">{items.length - mapeados - pendientes} por enlazar</span>
                </span>
              </div>

              {/* Tabla */}
              <div className="border border-outline-variant/10 rounded-xl overflow-hidden">
                <div className="max-h-[48vh] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-container-low sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 text-[10px] font-label uppercase tracking-widest text-stone-500">SKU</th>
                        <th className="text-left px-3 py-2 text-[10px] font-label uppercase tracking-widest text-stone-500">Descripción (proveedor)</th>
                        <th className="text-right px-3 py-2 text-[10px] font-label uppercase tracking-widest text-stone-500">Cajas</th>
                        <th className="text-left px-3 py-2 text-[10px] font-label uppercase tracking-widest text-stone-500">Producto interno</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-container">
                      {items.map((it, idx) => (
                        <React.Fragment key={`${it.sku_proveedor}-${idx}`}>
                          <tr className="hover:bg-background">
                            <td className="px-3 py-2 font-mono text-[11px] text-stone-500 align-top">{it.sku_proveedor}</td>
                            <td className="px-3 py-2 font-body text-on-surface align-top">{it.descripcion_proveedor}</td>
                            <td className="px-3 py-2 text-right font-serif font-bold align-top">
                              <span className={it.cajas_esperadas > 0 ? 'text-on-surface' : 'text-stone-300'}>{it.cajas_esperadas}</span>
                            </td>
                            <td className="px-3 py-2 align-top">
                              {it.mapeo ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-label text-emerald-700">
                                  <Icon name="check_circle" className="text-sm" />
                                  {it.mapeo.nombre_interno || it.mapeo.codigo_barras}
                                  <span className="text-stone-400 ml-1">×{it.mapeo.piezas_por_caja}</span>
                                </span>
                              ) : it.pendiente ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-label text-purple-700">
                                  <Icon name="schedule" className="text-sm" /> Producto nuevo (pendiente)
                                  <button onClick={() => setLinkIdx(idx)} className="ml-1 text-stone-400 hover:text-stone-600 underline text-[10px]">cambiar</button>
                                </span>
                              ) : linkIdx === idx ? null : (
                                <button onClick={() => setLinkIdx(idx)}
                                  className="px-2.5 py-1 bg-amber-100 text-amber-700 rounded-lg text-[10px] font-label font-bold uppercase tracking-wider hover:bg-amber-200 transition-all flex items-center gap-1">
                                  <Icon name="link" className="text-sm" /> Enlazar
                                </button>
                              )}
                            </td>
                          </tr>
                          {linkIdx === idx && (
                            <tr><td colSpan={4} className="px-3 pb-2">
                              <EnlazarSku item={it} proveedor={data.proveedor} onNotify={onNotify}
                                onCancel={() => setLinkIdx(null)} onLinked={(m) => aplicarMapeo(idx, m)}
                                onPending={() => marcarPendiente(idx)} />
                            </td></tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {data && (
          <div className="p-4 border-t border-outline-variant/10 flex items-center justify-between gap-3">
            <p className="text-[11px] font-label text-stone-400">
              Se crearán <span className="text-primary font-bold">{listos}</span> productos (solo los enlazados con cajas &gt; 0).
              {pendientes > 0 && <> Los <span className="text-purple-600 font-bold">{pendientes} nuevos</span> quedan pendientes hasta tener código.</>}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setData(null)} className="px-4 py-2 bg-surface-container text-stone-500 rounded-lg text-xs font-label uppercase tracking-widest">
                Otro PDF
              </button>
              <button onClick={crearOrden} disabled={creating || listos === 0}
                className={cn('px-4 py-2 rounded-lg text-xs font-label font-bold uppercase tracking-widest flex items-center gap-2 transition-all',
                  creating || listos === 0 ? 'bg-stone-200 text-stone-400' : 'bg-primary text-on-primary hover:bg-primary-container')}>
                {creating ? <div className="w-3 h-3 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" /> : <Icon name="local_shipping" className="text-base" />}
                Crear orden de recepción
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Productos nuevos pendientes de código ────────────────────────────────────
type Pendiente = {
  id: number; proveedor: string | null; sku_proveedor: string | null;
  descripcion_proveedor: string; unidad: string | null; piezas_por_caja: number;
  cajas: number; precio_unitario: number | null; estado: string;
  codigo_barras: string | null; origen: string; created_at: string;
};

function PendientesView() {
  const [lista,   setLista]   = useState<Pendiente[]>([]);
  const [loading, setLoading] = useState(false);
  const [estado,  setEstado]  = useState<'pendiente' | 'resuelto' | 'todos'>('pendiente');
  const [resolIdx, setResolIdx] = useState<number | null>(null);
  const [notif,   setNotif]   = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type }); setTimeout(() => setNotif(null), 3500);
  };

  const fetchLista = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/almacen/productos-pendientes?estado=${estado}`).then(r => r.json());
      setLista(Array.isArray(r) ? r : []);
    } catch { notify('Error al cargar pendientes', 'error'); }
    finally { setLoading(false); }
  }, [estado]);

  useEffect(() => { fetchLista(); }, [fetchLista]);

  const descartar = async (id: number) => {
    if (!confirm('¿Descartar este producto pendiente?')) return;
    try {
      const res = await fetch(`/api/almacen/productos-pendientes/${id}`, { method: 'DELETE' });
      if (res.ok) { notify('Descartado'); fetchLista(); }
      else notify('No se pudo descartar', 'error');
    } catch { notify('Error de conexión', 'error'); }
  };

  return (
    <div className="space-y-4">
      {notif && (
        <div className={cn('fixed top-6 right-6 z-[300] px-4 py-2.5 rounded-xl shadow-lg text-sm font-label',
          notif.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white')}>
          {notif.msg}
        </div>
      )}

      {/* Header + filtro */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-serif text-xl text-primary">Productos nuevos</h3>
          <p className="text-[11px] font-body text-stone-400 mt-0.5">
            Los que registra el empleado en el TC52 ya tienen su stock en la bodega. Aquí solo les pones el <b>precio</b>. (El alta en NovaCaja sigue siendo manual en el POS.)
          </p>
        </div>
        <div className="flex bg-surface-container rounded-xl p-1">
          {(['pendiente', 'resuelto', 'todos'] as const).map(e => (
            <button key={e} onClick={() => setEstado(e)}
              className={cn('px-3 py-1.5 rounded-lg text-[11px] font-label uppercase tracking-widest transition-all',
                estado === e ? 'bg-primary text-on-primary' : 'text-stone-500 hover:text-stone-700')}>
              {e === 'pendiente' ? 'Pendientes' : e === 'resuelto' ? 'Resueltos' : 'Todos'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>
      ) : lista.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-stone-300">
          <Icon name="check_circle" className="text-5xl mb-3" />
          <p className="font-body text-stone-400">No hay productos {estado === 'pendiente' ? 'pendientes' : estado === 'resuelto' ? 'resueltos' : ''}.</p>
        </div>
      ) : (
        <div className="border border-outline-variant/10 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-low">
              <tr>
                <th className="text-left px-3 py-2 text-[10px] font-label uppercase tracking-widest text-stone-500">Descripción</th>
                <th className="text-left px-3 py-2 text-[10px] font-label uppercase tracking-widest text-stone-500">Proveedor / SKU</th>
                <th className="text-right px-3 py-2 text-[10px] font-label uppercase tracking-widest text-stone-500">Pzas/caja</th>
                <th className="text-left px-3 py-2 text-[10px] font-label uppercase tracking-widest text-stone-500">Estado</th>
                <th className="text-left px-3 py-2 text-[10px] font-label uppercase tracking-widest text-stone-500">Precio</th>
                <th className="text-right px-3 py-2 text-[10px] font-label uppercase tracking-widest text-stone-500">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container">
              {lista.map((p, idx) => (
                <React.Fragment key={p.id}>
                  <tr className="hover:bg-background">
                    <td className="px-3 py-2 font-body text-on-surface align-top">{p.descripcion_proveedor}</td>
                    <td className="px-3 py-2 align-top text-[11px]">
                      <span className="font-label text-stone-600">{p.proveedor || '—'}</span>
                      {p.sku_proveedor && <span className="font-mono text-stone-400 ml-1">· {p.sku_proveedor}</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-serif align-top">{p.piezas_por_caja}</td>
                    <td className="px-3 py-2 align-top">
                      {p.estado === 'resuelto' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-label text-emerald-700">
                          <Icon name="check_circle" className="text-sm" /> {p.codigo_barras}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-label text-purple-700">
                          <Icon name="schedule" className="text-sm" /> Pendiente
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {p.estado === 'resuelto'
                        ? <PrecioPendiente pendiente={p} onNotify={notify} onSaved={fetchLista} />
                        : <span className="text-[11px] font-body text-stone-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      {p.estado === 'pendiente' && (
                        <div className="inline-flex gap-1">
                          <button onClick={() => setResolIdx(resolIdx === idx ? null : idx)}
                            className="px-2.5 py-1 bg-primary text-on-primary rounded-lg text-[10px] font-label font-bold uppercase tracking-wider hover:bg-primary-container transition-all flex items-center gap-1">
                            <Icon name="barcode_scanner" className="text-sm" /> Asignar código
                          </button>
                          <button onClick={() => descartar(p.id)}
                            className="px-2 py-1 text-stone-400 hover:text-rose-600 rounded-lg">
                            <Icon name="delete" className="text-base" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {resolIdx === idx && p.estado === 'pendiente' && (
                    <tr><td colSpan={6} className="px-3 pb-2">
                      <ResolverPendiente pendiente={p} onNotify={notify}
                        onCancel={() => setResolIdx(null)}
                        onResolved={() => { setResolIdx(null); fetchLista(); }} />
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Sub-fila para asignar el código de barras real a un producto pendiente
function ResolverPendiente({ pendiente, onResolved, onCancel, onNotify }: {
  pendiente: Pendiente; onResolved: () => void; onCancel: () => void;
  onNotify: (m: string, t?: 'success' | 'error') => void;
}) {
  const [codigo, setCodigo] = useState('');
  const [ppc,    setPpc]    = useState(String(pendiente.piezas_por_caja || 1));
  const [saving, setSaving] = useState(false);

  const resolver = async () => {
    const cb = codigo.trim();
    if (!cb) { onNotify('Escribe o escanea el código de barras', 'error'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/almacen/productos-pendientes/${pendiente.id}/resolver`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo_barras: cb, piezas_por_caja: parseInt(ppc) || 1 }),
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        onNotify(j.equivalencia ? 'Código asignado y enlace creado para futuras facturas' : 'Código asignado');
        onResolved();
      } else onNotify(j.error || 'Error al asignar', 'error');
    } catch { onNotify('Error de conexión', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 mt-1 flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
      <div className="flex-1">
        <label className="text-[9px] font-label uppercase tracking-widest text-stone-400">Código de barras real</label>
        <input autoFocus value={codigo} onChange={e => setCodigo(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') resolver(); }}
          placeholder="Escanea o escribe el código…"
          className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-mono outline-none focus:border-primary" />
      </div>
      <div className="w-28 flex-shrink-0">
        <label className="text-[9px] font-label uppercase tracking-widest text-stone-400">Pzas/caja</label>
        <input type="number" min="1" value={ppc} onChange={e => setPpc(e.target.value)}
          className="w-full px-2 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body text-center outline-none focus:border-primary" />
      </div>
      <button onClick={resolver} disabled={saving}
        className="px-3 py-2 bg-primary text-on-primary rounded-lg text-[11px] font-label font-bold uppercase tracking-widest disabled:opacity-50">
        {saving ? '...' : 'Guardar'}
      </button>
      <button onClick={onCancel} className="px-2 py-2 text-stone-400 hover:text-stone-600 rounded-lg">
        <Icon name="close" className="text-base" />
      </button>
    </div>
  );
}

// Editor de precio para un producto ya resuelto (con stock en la bodega).
// El admin solo le pone el precio de venta; no toca NovaCaja.
function PrecioPendiente({ pendiente, onNotify, onSaved }: {
  pendiente: Pendiente;
  onNotify: (m: string, t?: 'success' | 'error') => void;
  onSaved: () => void;
}) {
  const [precio, setPrecio] = useState(pendiente.precio_unitario != null ? String(pendiente.precio_unitario) : '');
  const [saving, setSaving] = useState(false);
  const tiene = pendiente.precio_unitario != null;

  const guardar = async () => {
    const val = parseFloat(precio);
    if (!(val >= 0)) { onNotify('Escribe un precio válido', 'error'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/almacen/productos-pendientes/${pendiente.id}/precio`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ precio_unitario: val }),
      });
      const j = await res.json();
      if (res.ok && j.ok) { onNotify('Precio guardado'); onSaved(); }
      else onNotify(j.error || 'Error al guardar precio', 'error');
    } catch { onNotify('Error de conexión', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="inline-flex items-center gap-1">
      <span className="text-stone-400 text-[11px]">$</span>
      <input type="number" min="0" step="0.01" value={precio}
        onChange={e => setPrecio(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') guardar(); }}
        placeholder="0.00"
        className={cn('w-20 px-2 py-1 bg-background border rounded-lg text-sm font-body text-right outline-none focus:border-primary',
          tiene ? 'border-emerald-300' : 'border-outline-variant/20')} />
      <button onClick={guardar} disabled={saving}
        className="px-2 py-1 bg-primary text-on-primary rounded-lg text-[10px] font-label font-bold uppercase tracking-wider disabled:opacity-50">
        {saving ? '...' : tiene ? 'Cambiar' : 'Guardar'}
      </button>
    </div>
  );
}

function FacturasView() {
  const [facturas,     setFacturas]     = useState<FacturaCompra[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [filtroEstado, setFiltroEstado] = useState<EstadoFactura | 'todos'>('todos');
  const [busqueda,     setBusqueda]     = useState('');
  const [detalle,      setDetalle]      = useState<FacturaConDetalle | null>(null);
  const [detalleOpen,  setDetalleOpen]  = useState(false);
  const [detalleLoad,  setDetalleLoad]  = useState(false);
  const [showForm,     setShowForm]     = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [pdfOpen,      setPdfOpen]      = useState(false);
  const [notif,        setNotif]        = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const [form, setForm] = useState({
    proveedor: '', numero_factura: '', fecha_emision: '', fecha_esperada: '', notas: '',
  });
  const [items, setItems] = useState<FacturaItemForm[]>([{ ...ITEM_VACIO }]);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 3500);
  };

  const fetchFacturas = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (filtroEstado !== 'todos') params.set('estado', filtroEstado);
      if (busqueda) params.set('q', busqueda);
      const data = await fetch(`/api/facturas?${params}`).then(r => r.json());
      setFacturas(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [filtroEstado, busqueda]);

  useEffect(() => { fetchFacturas(); }, [fetchFacturas]);

  const openDetalle = async (id: number) => {
    setDetalleLoad(true);
    setDetalleOpen(true);
    setDetalle(null);
    try {
      const data = await fetch(`/api/facturas/${id}`).then(r => r.json());
      setDetalle(data);
    } catch { notify('Error al cargar detalle', 'error'); }
    finally { setDetalleLoad(false); }
  };

  const cambiarEstado = async (id: number, estado: EstadoFactura) => {
    try {
      const res  = await fetch(`/api/facturas/${id}/estado`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado }),
      });
      const data = await res.json();
      if (res.ok) {
        notify(data.message || 'Estado actualizado');
        setDetalleOpen(false);
        fetchFacturas();
      } else notify(data.error || 'Error', 'error');
    } catch { notify('Error de conexión', 'error'); }
  };

  const addItem    = () => setItems(p => [...p, { ...ITEM_VACIO }]);
  const removeItem = (i: number) => setItems(p => p.filter((_, idx) => idx !== i));
  const setItem    = (i: number, field: keyof FacturaItemForm, val: string) =>
    setItems(p => p.map((row, idx) => idx === i ? { ...row, [field]: val } : row));

  const totalForm = items.reduce((s, r) => {
    const q = parseFloat(r.cantidad) || 0;
    const p = parseFloat(r.precio_unitario) || 0;
    return s + q * p;
  }, 0);

  const saveFactura = async () => {
    if (!form.proveedor.trim()) { notify('El proveedor es requerido', 'error'); return; }
    const validItems = items.filter(r => r.art_codigo.trim() && parseFloat(r.cantidad) > 0 && parseFloat(r.precio_unitario) >= 0);
    if (!validItems.length) { notify('Agrega al menos un artículo con código y cantidad', 'error'); return; }
    setSaving(true);
    try {
      const res  = await fetch('/api/facturas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, items: validItems }),
      });
      const data = await res.json();
      if (res.ok) {
        notify(`Factura ${data.folio} registrada · Pedido ${data.pedido_folio} creado`);
        setShowForm(false);
        setForm({ proveedor: '', numero_factura: '', fecha_emision: '', fecha_esperada: '', notas: '' });
        setItems([{ ...ITEM_VACIO }]);
        fetchFacturas();
      } else notify(data.error || 'Error al guardar', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setSaving(false); }
  };

  const fmt = (n: number) => `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const filtradas = facturas.filter(f =>
    busqueda === '' ||
    f.proveedor.toLowerCase().includes(busqueda.toLowerCase()) ||
    (f.numero_factura ?? '').toLowerCase().includes(busqueda.toLowerCase()) ||
    f.folio.toLowerCase().includes(busqueda.toLowerCase())
  );

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

      {/* Modal detalle */}
      {detalleOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-start justify-between p-6 border-b border-outline-variant/10">
              <div>
                {detalle && (
                  <>
                    <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mb-1">{detalle.folio}</p>
                    <h3 className="font-serif text-xl text-primary">{detalle.proveedor}</h3>
                    {detalle.numero_factura && (
                      <p className="text-xs font-label text-stone-500 mt-0.5">Factura proveedor: <strong>{detalle.numero_factura}</strong></p>
                    )}
                  </>
                )}
              </div>
              <button onClick={() => setDetalleOpen(false)}
                className="p-1.5 text-stone-400 hover:text-on-surface rounded-lg transition-colors">
                <Icon name="close" className="text-xl" />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 p-6 space-y-5">
              {detalleLoad ? (
                <div className="flex justify-center py-12">
                  <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                </div>
              ) : detalle ? (
                <>
                  {/* Estado + fechas */}
                  <div className="flex flex-wrap gap-3">
                    {(() => {
                      const m = ESTADO_FACTURA_META[detalle.estado];
                      return (
                        <span className={cn('flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-label font-bold uppercase tracking-widest', m.bg, m.color)}>
                          <Icon name={m.icon} className="text-sm" /> {m.label}
                        </span>
                      );
                    })()}
                    {detalle.fecha_emision && (
                      <span className="text-[10px] font-label text-stone-400 flex items-center gap-1">
                        <Icon name="calendar_today" className="text-xs" />
                        Emitida: {new Date(detalle.fecha_emision + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                    {detalle.fecha_esperada && (
                      <span className="text-[10px] font-label text-stone-400 flex items-center gap-1">
                        <Icon name="local_shipping" className="text-xs" />
                        Esperada: {new Date(detalle.fecha_esperada + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                    {detalle.entregado_at && (
                      <span className="text-[10px] font-label text-green-600 flex items-center gap-1">
                        <Icon name="check_circle" className="text-xs" />
                        Entregado: {new Date(detalle.entregado_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                  </div>

                  {/* Pedido vinculado */}
                  {detalle.pedido && (
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Icon name="qr_code_scanner" className="text-sm text-primary" />
                          <span className="text-[10px] font-label font-bold uppercase tracking-widest text-primary">Pedido TC52</span>
                          <span className="text-[10px] font-label text-stone-500">{detalle.pedido.folio}</span>
                        </div>
                        <span className={cn(
                          'text-[9px] font-label font-bold uppercase tracking-widest px-2 py-0.5 rounded-full',
                          detalle.pedido.estado === 'cerrado'   ? 'bg-green-100 text-green-700' :
                          detalle.pedido.estado === 'en_recepcion' ? 'bg-blue-100 text-blue-700' :
                          detalle.pedido.estado === 'cancelado' ? 'bg-stone-100 text-stone-500' :
                          'bg-yellow-100 text-yellow-700'
                        )}>
                          {detalle.pedido.estado.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: detalle.pedido.total_esperado > 0 ? `${Math.min(100, (detalle.pedido.total_recibido / detalle.pedido.total_esperado) * 100)}%` : '0%' }}
                        />
                      </div>
                      <p className="text-[10px] font-label text-stone-400 mt-1">
                        {detalle.pedido.total_recibido} de {detalle.pedido.total_esperado} uds recibidas
                      </p>
                    </div>
                  )}

                  {/* Detalle de artículos */}
                  <div>
                    <p className="text-[10px] font-label font-bold uppercase tracking-widest text-stone-500 mb-2">Artículos</p>
                    <div className="rounded-xl border border-outline-variant/10 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-surface-container-low/50">
                          <tr>
                            <th className="text-left px-3 py-2 font-label uppercase tracking-widest text-stone-400 text-[10px]">Producto</th>
                            <th className="text-right px-3 py-2 font-label uppercase tracking-widest text-stone-400 text-[10px]">Cant.</th>
                            <th className="text-right px-3 py-2 font-label uppercase tracking-widest text-stone-400 text-[10px]">P.Unit.</th>
                            <th className="text-right px-3 py-2 font-label uppercase tracking-widest text-stone-400 text-[10px]">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-outline-variant/10">
                          {detalle.detalle.map(d => (
                            <tr key={d.id} className="hover:bg-surface-container-low/30 transition-colors">
                              <td className="px-3 py-2.5">
                                <p className="font-body text-on-surface">{d.nombre || d.art_codigo}</p>
                                <p className="text-stone-400 font-mono text-[10px]">{d.art_codigo}</p>
                              </td>
                              <td className="px-3 py-2.5 text-right font-label text-on-surface">{d.cantidad}</td>
                              <td className="px-3 py-2.5 text-right font-label text-stone-500">{fmt(d.precio_unitario)}</td>
                              <td className="px-3 py-2.5 text-right font-label font-bold text-on-surface">{fmt(d.subtotal)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-surface-container-low/50 border-t border-outline-variant/10">
                          <tr>
                            <td colSpan={3} className="px-3 py-2.5 text-right font-label font-bold uppercase tracking-widest text-[10px] text-stone-500">Total</td>
                            <td className="px-3 py-2.5 text-right font-serif text-lg text-primary">{fmt(detalle.total_calculado)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  {/* Notas */}
                  {detalle.notas && (
                    <p className="text-xs font-body text-stone-500 bg-stone-50 rounded-lg p-3 border border-stone-100">
                      {detalle.notas}
                    </p>
                  )}
                </>
              ) : null}
            </div>

            {/* Footer acciones */}
            {detalle && detalle.estado !== 'cancelada' && (
              <div className="p-4 border-t border-outline-variant/10 flex items-center gap-3">
                {detalle.estado === 'en_camino' && (
                  <button
                    onClick={() => cambiarEstado(detalle.id, 'en_almacen')}
                    className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-green-700 transition-all shadow-sm">
                    <Icon name="inventory_2" className="text-base" />
                    Marcar como Recibido
                  </button>
                )}
                <button
                  onClick={() => cambiarEstado(detalle.id, 'cancelada')}
                  className="px-4 py-2.5 text-stone-400 hover:text-error hover:bg-error-container/20 rounded-xl text-xs font-label font-bold uppercase tracking-widest transition-all">
                  Cancelar Factura
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Header + filtros */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between mb-5">
        <div className="flex gap-1.5 flex-wrap">
          {(['todos', 'en_camino', 'en_almacen', 'cancelada'] as const).map(e => {
            const m = e === 'todos' ? null : ESTADO_FACTURA_META[e];
            return (
              <button key={e} onClick={() => setFiltroEstado(e)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-[10px] font-label font-bold uppercase tracking-widest transition-all',
                  filtroEstado === e
                    ? (m ? cn(m.bg, m.color) : 'bg-primary text-on-primary')
                    : 'bg-stone-100 text-stone-400 hover:bg-stone-200'
                )}>
                {e === 'todos' ? 'Todas' : m!.label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button onClick={() => setPdfOpen(true)}
            className="px-4 py-2 bg-secondary text-on-primary rounded-lg text-xs font-label font-bold uppercase tracking-widest flex items-center gap-2 shadow-md hover:opacity-90 transition-all">
            <Icon name="picture_as_pdf" className="text-base" /> Leer PDF
          </button>
          <button onClick={() => setShowForm(v => !v)}
            className="px-4 py-2 bg-primary text-on-primary rounded-lg text-xs font-label font-bold uppercase tracking-widest flex items-center gap-2 shadow-md hover:bg-primary-container transition-all">
            <Icon name={showForm ? 'close' : 'add'} className="text-base" />
            {showForm ? 'Cancelar' : 'Nueva Factura'}
          </button>
        </div>
      </div>

      {pdfOpen && (
        <FacturaPdfModal onClose={() => setPdfOpen(false)} onNotify={notify} onCreated={fetchFacturas} />
      )}

      {/* Búsqueda */}
      <div className="relative mb-5">
        <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-base" />
        <input
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por proveedor, folio o número de factura..."
          className="w-full pl-9 pr-4 py-2.5 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm font-body outline-none focus:border-primary transition-colors"
        />
      </div>

      {/* Formulario nueva factura */}
      {showForm && (
        <div className="bg-surface-container-low rounded-2xl border border-primary/20 p-5 mb-6 space-y-5">
          <h4 className="text-[10px] font-label font-bold uppercase tracking-widest text-stone-500">Nueva Factura de Compra</h4>

          {/* Datos generales */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Proveedor *</label>
              <input value={form.proveedor} onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))}
                placeholder="Nombre del proveedor"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">N° Factura del Proveedor</label>
              <input value={form.numero_factura} onChange={e => setForm(f => ({ ...f, numero_factura: e.target.value }))}
                placeholder="Ej: F-2026-0045"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Fecha de emisión</label>
              <input type="date" value={form.fecha_emision} onChange={e => setForm(f => ({ ...f, fecha_emision: e.target.value }))}
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div>
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Fecha esperada de entrega</label>
              <input type="date" value={form.fecha_esperada} onChange={e => setForm(f => ({ ...f, fecha_esperada: e.target.value }))}
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Notas</label>
              <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                placeholder="Opcional"
                className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
            </div>
          </div>

          {/* Tabla de artículos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-label font-bold uppercase tracking-widest text-stone-500">Artículos</p>
              <button onClick={addItem}
                className="flex items-center gap-1 text-[10px] font-label font-bold uppercase tracking-widest text-primary hover:text-primary-container transition-colors">
                <Icon name="add_circle_outline" className="text-sm" /> Agregar fila
              </button>
            </div>
            <div className="rounded-xl border border-outline-variant/10 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-surface-container-low/70">
                  <tr>
                    <th className="text-left px-2 py-2 font-label uppercase tracking-widest text-stone-400 text-[10px]">Código</th>
                    <th className="text-left px-2 py-2 font-label uppercase tracking-widest text-stone-400 text-[10px]">Nombre</th>
                    <th className="text-right px-2 py-2 font-label uppercase tracking-widest text-stone-400 text-[10px]">Cant.</th>
                    <th className="text-right px-2 py-2 font-label uppercase tracking-widest text-stone-400 text-[10px]">P. Unit.</th>
                    <th className="text-right px-2 py-2 font-label uppercase tracking-widest text-stone-400 text-[10px]">Subtotal</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {items.map((row, i) => {
                    const sub = (parseFloat(row.cantidad) || 0) * (parseFloat(row.precio_unitario) || 0);
                    return (
                      <tr key={i} className="bg-background">
                        <td className="px-2 py-1.5">
                          <input value={row.art_codigo} onChange={e => setItem(i, 'art_codigo', e.target.value)}
                            placeholder="Código"
                            className="w-full px-2 py-1 bg-transparent border border-outline-variant/20 rounded-md text-xs font-body outline-none focus:border-primary transition-colors" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input value={row.nombre} onChange={e => setItem(i, 'nombre', e.target.value)}
                            placeholder="Nombre"
                            className="w-full px-2 py-1 bg-transparent border border-outline-variant/20 rounded-md text-xs font-body outline-none focus:border-primary transition-colors" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" min="0" step="0.01" value={row.cantidad} onChange={e => setItem(i, 'cantidad', e.target.value)}
                            placeholder="0"
                            className="w-20 px-2 py-1 bg-transparent border border-outline-variant/20 rounded-md text-xs font-body text-right outline-none focus:border-primary transition-colors" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" min="0" step="0.01" value={row.precio_unitario} onChange={e => setItem(i, 'precio_unitario', e.target.value)}
                            placeholder="0.00"
                            className="w-24 px-2 py-1 bg-transparent border border-outline-variant/20 rounded-md text-xs font-body text-right outline-none focus:border-primary transition-colors" />
                        </td>
                        <td className="px-2 py-1.5 text-right font-label font-bold text-on-surface whitespace-nowrap">
                          {sub > 0 ? fmt(sub) : '—'}
                        </td>
                        <td className="px-2 py-1.5">
                          {items.length > 1 && (
                            <button onClick={() => removeItem(i)}
                              className="p-0.5 text-stone-300 hover:text-error transition-colors">
                              <Icon name="close" className="text-sm" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-surface-container-low/50 border-t border-outline-variant/10">
                  <tr>
                    <td colSpan={4} className="px-3 py-2.5 text-right font-label font-bold uppercase tracking-widest text-[10px] text-stone-500">Total estimado</td>
                    <td className="px-2 py-2.5 text-right font-serif text-base text-primary">{fmt(totalForm)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Aviso pedido */}
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
            <Icon name="info" className="text-sm flex-shrink-0 mt-0.5" />
            <span>Al guardar se creará automáticamente un <strong>pedido de recepción</strong> para que el TC52 pueda escanear la llegada de la mercancía.</span>
          </div>

          <button onClick={saveFactura} disabled={saving}
            className={cn(
              'w-full py-3 rounded-xl text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-md',
              saving ? 'bg-stone-200 text-stone-400' : 'bg-primary text-on-primary hover:bg-primary-container'
            )}>
            {saving
              ? <div className="w-4 h-4 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />
              : <Icon name="receipt_long" className="text-base" />}
            Registrar Factura
          </button>
        </div>
      )}

      {/* Lista de facturas */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      ) : filtradas.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-stone-300">
          <Icon name="receipt_long" className="text-5xl opacity-20 mb-3" />
          <p className="text-sm font-label uppercase tracking-widest">
            {filtroEstado === 'todos' ? 'Sin facturas registradas' : `Sin facturas "${ESTADO_FACTURA_META[filtroEstado as EstadoFactura]?.label}"`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtradas.map(f => {
            const m = ESTADO_FACTURA_META[f.estado];
            return (
              <button key={f.id} onClick={() => openDetalle(f.id)}
                className="w-full text-left bg-surface-container-lowest rounded-xl border border-outline-variant/10 hover:border-primary/20 hover:shadow-sm p-4 flex items-center gap-4 transition-all group">
                {/* Estado */}
                <div className={cn('w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0', m.bg)}>
                  <Icon name={m.icon} className={cn('text-lg', m.color)} />
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-body text-sm text-on-surface font-medium truncate">{f.proveedor}</p>
                    {f.numero_factura && (
                      <span className="text-[10px] font-label text-stone-400 flex-shrink-0">· {f.numero_factura}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-label text-stone-400 font-mono">{f.folio}</span>
                    {f.fecha_esperada && (
                      <span className="text-[10px] font-label text-stone-400">
                        Llega: {new Date(f.fecha_esperada + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                    <span className={cn('text-[9px] font-label font-bold uppercase tracking-widest px-2 py-0.5 rounded-full', m.bg, m.color)}>
                      {m.label}
                    </span>
                  </div>
                </div>
                {/* Total */}
                <div className="text-right flex-shrink-0">
                  <p className="font-serif text-base text-on-surface">{fmt(f.total_calculado)}</p>
                  <p className="text-[10px] font-label text-stone-400">
                    {new Date(f.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <Icon name="chevron_right" className="text-stone-300 group-hover:text-primary transition-colors flex-shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Áreas combinado: Asignar + Configurar ─────────────────────────────────────
// ── Ventas → Stock: liga las ventas de NovaCaja al inventario de bodega ────────
interface VsConfig { activo: boolean; fecha_inicio: string | null; ultima_fecha: string | null; ultimo_run: string | null; }
interface VsRow { codigo: string; nombre: string | null; area: string; vendido: number; stockActual: number; stockNuevo: number; }
interface VsMapa { est_codigo: string; area: string; }
interface SinContarRow { area: string; codigo: string; nombre: string; vendido: number; enOtraArea: boolean; }

function VentasSyncView() {
  const { areas, areaMap } = useAreasCtx();
  const [cfg,     setCfg]     = useState<VsConfig | null>(null);
  const [mapa,    setMapa]    = useState<VsMapa[]>([]);
  const [prev,    setPrev]    = useState<VsRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg,     setMsg]     = useState<string | null>(null);
  const [nCaja,   setNCaja]   = useState('');
  const [nArea,   setNArea]   = useState('');
  const [sinContar,  setSinContar]  = useState<SinContarRow[] | null>(null);
  const [scDias,     setScDias]     = useState(7);
  const [scLoading,  setScLoading]  = useState(false);

  const load = useCallback(() => {
    fetch('/api/ventas-sync/config').then(r => r.json()).then(d => {
      if (d && !d.error) { if (d.config) setCfg(d.config); if (d.mapa) setMapa(d.mapa); }
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const cargarSinContar = useCallback(async (dias: number) => {
    setScLoading(true);
    try {
      const d = await fetch(`/api/ventas-sync/sin-contar?dias=${dias}`).then(r => r.json());
      setSinContar(Array.isArray(d.productos) ? d.productos : []);
    } catch { setSinContar([]); }
    finally { setScLoading(false); }
  }, []);
  useEffect(() => { cargarSinContar(scDias); }, [cargarSinContar, scDias]);

  const scPorArea = useMemo(() => {
    const m = new Map<string, SinContarRow[]>();
    for (const r of (sinContar ?? [])) { if (!m.has(r.area)) m.set(r.area, []); m.get(r.area)!.push(r); }
    return Array.from(m.entries());
  }, [sinContar]);

  const verPreview = async () => {
    setLoading(true); setMsg(null);
    try {
      const p = await fetch('/api/ventas-sync/preview').then(r => r.json());
      if (p.error) setMsg('Error: ' + p.error);
      else { setPrev(p.productos || []); if (p.config) setCfg(p.config); if (p.mapa) setMapa(p.mapa); }
    } catch { setMsg('Error de conexión'); }
    finally { setLoading(false); }
  };

  const toggleActivo = async () => {
    if (!cfg) return;
    const nuevo = !cfg.activo;
    if (nuevo && !window.confirm('Al activar, las ventas en caja empezarán a DESCONTAR del inventario de bodega según la caja, de aquí en adelante. ¿Continuar?')) return;
    setLoading(true);
    try {
      const body: Record<string, unknown> = { activo: nuevo };
      if (nuevo && !cfg.fecha_inicio) body.fecha_inicio = 'ahora';
      const d = await fetch('/api/ventas-sync/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
      if (d.config) setCfg(d.config);
    } finally { setLoading(false); }
  };

  const procesar = async () => {
    setLoading(true); setMsg('Procesando ventas...');
    try {
      const r = await fetch('/api/ventas-sync/run', { method: 'POST' }).then(r => r.json());
      setMsg(r.error ? 'Error: ' + r.error : `Listo: ${r.tickets} ticket(s) · ${r.productosDescontados} producto(s) · ${r.unidadesDescontadas} uds descontadas`);
      setPrev(null); load();
    } catch { setMsg('Error de conexión'); }
    finally { setLoading(false); }
  };

  const addMapa = async () => {
    if (!nCaja.trim() || !nArea) return;
    setLoading(true);
    try {
      const m = await fetch('/api/ventas-sync/mapa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ est_codigo: nCaja.trim(), area: nArea }) }).then(r => r.json());
      if (Array.isArray(m)) setMapa(m);
      setNCaja(''); setNArea('');
    } finally { setLoading(false); }
  };
  const delMapa = async (est: string) => {
    setLoading(true);
    try { const m = await fetch(`/api/ventas-sync/mapa/${encodeURIComponent(est)}`, { method: 'DELETE' }).then(r => r.json()); if (Array.isArray(m)) setMapa(m); }
    finally { setLoading(false); }
  };

  const fmt = (d: string | null) => d ? new Date(d).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—';

  return (
    <div>
      <div className="mb-5">
        <h3 className="font-serif text-xl text-primary">Ventas → Stock</h3>
        <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mt-0.5">
          Descuenta del inventario de bodega lo que se vende en caja, según la caja del ticket
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mb-5">
        {/* Estado */}
        <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[11px] font-label font-bold uppercase tracking-widest text-stone-500">Estado</span>
            <span className={cn('px-3 py-1 rounded-full text-[10px] font-label font-bold uppercase tracking-widest',
              cfg?.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500')}>
              {cfg?.activo ? '● Activo' : '○ Apagado'}
            </span>
          </div>
          <button onClick={toggleActivo} disabled={loading || !cfg}
            className={cn('w-full py-3 rounded-lg text-[11px] font-label font-bold uppercase tracking-widest transition-all',
              cfg?.activo ? 'bg-error-container text-on-error-container' : 'bg-primary text-on-primary')}>
            {cfg?.activo ? 'Desactivar' : 'Activar (descontar ventas)'}
          </button>
          <div className="text-[11px] font-label text-stone-500 space-y-0.5 mt-3">
            <p>Cuenta ventas desde: <span className="text-on-surface font-bold">{fmt(cfg?.fecha_inicio ?? null)}</span></p>
            <p>Último procesado: <span className="text-on-surface font-bold">{fmt(cfg?.ultimo_run ?? null)}</span></p>
          </div>
        </div>

        {/* Mapeo caja -> área */}
        <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low p-5">
          <span className="text-[11px] font-label font-bold uppercase tracking-widest text-stone-500">Caja → Área</span>
          <div className="mt-3 space-y-1.5">
            {mapa.length === 0 && <p className="text-[11px] font-label text-stone-400">Sin cajas mapeadas — agrega abajo.</p>}
            {mapa.map(m => (
              <div key={m.est_codigo} className="flex items-center gap-2 text-sm">
                <span className="font-label text-stone-500">Caja {m.est_codigo}</span>
                <Icon name="arrow_forward" className="text-xs text-stone-400" />
                <span className="font-body text-on-surface font-bold">{m.area}</span>
                <button onClick={() => delMapa(m.est_codigo)} disabled={loading}
                  className="ml-auto p-1 text-stone-400 hover:text-error rounded"><Icon name="close" className="text-sm" /></button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-outline-variant/10">
            <input value={nCaja} onChange={e => setNCaja(e.target.value)} placeholder="Caja #"
              className="w-20 px-2 py-1.5 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary" />
            <select value={nArea} onChange={e => setNArea(e.target.value)}
              className="flex-1 px-2 py-1.5 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary">
              <option value="">Área…</option>
              {areas.map(k => <option key={k} value={areaMap[k]?.label || k}>{areaMap[k]?.label || k}</option>)}
            </select>
            <button onClick={addMapa} disabled={loading || !nCaja.trim() || !nArea}
              className="px-3 py-1.5 bg-primary text-on-primary rounded-lg text-[11px] font-label font-bold uppercase tracking-widest disabled:opacity-40">
              +
            </button>
          </div>
        </div>
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button onClick={verPreview} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-surface-container text-on-surface rounded-lg text-[11px] font-label font-bold uppercase tracking-widest hover:bg-surface-container-high disabled:opacity-50">
          <Icon name="visibility" className="text-base" /> Ver qué descontaría (preview)
        </button>
        <button onClick={procesar} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg text-[11px] font-label font-bold uppercase tracking-widest hover:bg-primary/90 disabled:opacity-50">
          <Icon name="play_arrow" className="text-base" /> Procesar ahora
        </button>
        {msg && <span className="text-[11px] font-label text-stone-600">{msg}</span>}
      </div>

      {/* Preview */}
      {prev && (
        <div className="rounded-xl border border-outline-variant/10 overflow-hidden">
          <div className="px-4 py-2.5 bg-surface-container-low/60">
            <span className="text-[10px] font-label font-bold uppercase tracking-widest text-stone-500">
              Preview · {prev.length} producto(s) que se descontarían
            </span>
          </div>
          {prev.length === 0 ? (
            <p className="py-10 text-center text-sm font-label uppercase tracking-widest text-stone-300">
              Nada que descontar por ahora
            </p>
          ) : (
            <div className="overflow-x-auto max-h-[460px]">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-container-low/40 text-stone-500 font-label uppercase tracking-widest text-[10px] sticky top-0">
                  <tr>
                    <th className="px-4 py-2">Producto</th>
                    <th className="px-4 py-2">Área</th>
                    <th className="px-4 py-2 text-center">Vendido</th>
                    <th className="px-4 py-2 text-center">Stock actual</th>
                    <th className="px-4 py-2 text-center">Quedaría</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {prev.map((r, i) => (
                    <tr key={`${r.codigo}-${r.area}-${i}`} className="hover:bg-background">
                      <td className="px-4 py-2">
                        <p className="font-body text-on-surface">{r.nombre || r.codigo}</p>
                        <p className="text-[9px] font-label text-stone-400">{r.codigo}</p>
                      </td>
                      <td className="px-4 py-2 text-[11px] font-label text-stone-500">{r.area}</td>
                      <td className="px-4 py-2 text-center font-serif text-red-600">−{r.vendido}</td>
                      <td className="px-4 py-2 text-center font-serif text-stone-500">{r.stockActual}</td>
                      <td className="px-4 py-2 text-center font-serif font-bold text-on-surface">{r.stockNuevo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Se vende pero NO está contado aquí (por eso "no se descuenta") */}
      <div className="mt-8 border-t border-outline-variant/10 pt-6">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Icon name="report_problem" className="text-base text-amber-600" />
            <span className="text-[11px] font-label font-bold uppercase tracking-widest text-stone-600">
              Se vende pero NO está contado aquí
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {[7, 30].map(d => (
              <button key={d} onClick={() => setScDias(d)}
                className={cn('px-2.5 py-1 rounded-lg text-[10px] font-label font-bold uppercase tracking-widest border transition-all',
                  scDias === d ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container-low text-stone-500 border-outline-variant/20 hover:bg-primary/5')}>
                {d} días
              </button>
            ))}
            <button onClick={() => cargarSinContar(scDias)} disabled={scLoading}
              className="p-1.5 text-stone-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-colors">
              <Icon name="refresh" className={cn('text-base', scLoading && 'animate-spin')} />
            </button>
          </div>
        </div>
        <p className="text-[10px] font-label text-stone-400 mb-4 leading-relaxed">
          Se vendieron en el local (según su caja) pero el TC52 no los tiene contados en esa área, por eso NO se descuentan.
          Cuéntalos con el TC52 en esa área para que empiecen a bajar del inventario.
        </p>
        {scLoading && !sinContar ? (
          <div className="flex justify-center py-8"><div className="w-6 h-6 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>
        ) : scPorArea.length === 0 ? (
          <div className="py-8 flex flex-col items-center text-stone-300">
            <Icon name="check_circle" className="text-4xl opacity-30 mb-2" />
            <p className="text-xs font-label uppercase tracking-widest">Todo lo que se vende está contado ✓</p>
          </div>
        ) : (
          <div className="space-y-4">
            {scPorArea.map(([area, rows]) => (
              <div key={area} className="rounded-xl border border-amber-200/50 bg-amber-50/30 overflow-hidden">
                <div className="px-4 py-2 bg-amber-100/40 flex items-center justify-between">
                  <span className="text-[11px] font-label font-bold text-amber-800">{area}</span>
                  <span className="text-[10px] font-label text-amber-600">{rows.length} producto(s)</span>
                </div>
                <div className="divide-y divide-amber-100/60 max-h-[320px] overflow-y-auto">
                  {rows.map(r => (
                    <div key={r.codigo} className="px-4 py-2 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-body text-on-surface truncate">{r.nombre}</p>
                        <p className="text-[9px] font-label text-stone-400">{r.codigo}{r.enOtraArea && ' · contado en otra área'}</p>
                      </div>
                      <span className="text-sm font-serif font-bold text-amber-700 flex-shrink-0">{r.vendido} vend.</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[10px] font-label text-stone-400 mt-4 leading-relaxed">
        Cada venta se descuenta del área de SU caja (caja 21 → Casita 1, caja 7 → Casita 2…). Las cajas
        no mapeadas y los productos no contados en esa área se ignoran. Idempotente: nunca descuenta un ticket dos veces.
      </p>
    </div>
  );
}

// Busca en go-upc.com el nombre de los productos que la zebra metió pero no
// existen en NovaCaja (salen en blanco) y los rellena.
function RellenarNombresBtn() {
  const [faltan,  setFaltan]  = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg,     setMsg]     = useState<string | null>(null);

  const contar = useCallback(() => {
    fetch('/api/almacen/nombres-faltantes/contar')
      .then(r => r.json())
      .then(d => { if (typeof d.total === 'number') setFaltan(d.total); })
      .catch(() => {});
  }, []);
  useEffect(() => { contar(); }, [contar]);

  const rellenar = async () => {
    if (loading) return;
    setLoading(true);
    setMsg('Buscando nombres en go-upc… (puede tardar ~½ min)');
    try {
      const r = await fetch('/api/almacen/nombres-faltantes/rellenar', { method: 'POST' });
      const d = await r.json();
      if (d.error) setMsg('Error: ' + d.error);
      else setMsg(`Listo: ${d.rellenados} de ${d.revisados} rellenados${d.sinResultado ? ` · ${d.sinResultado} sin coincidencia en go-upc` : ''}`);
      contar();
    } catch { setMsg('Error de conexión'); }
    finally { setLoading(false); }
  };

  // Nada que rellenar y sin mensaje previo → no mostrar el botón
  if (faltan === 0 && !msg && !loading) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {msg && <span className="text-[11px] font-label text-stone-500 max-w-[280px]">{msg}</span>}
      <button onClick={rellenar} disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg text-[11px] font-label font-bold uppercase tracking-widest hover:bg-primary/90 disabled:opacity-50 transition-all shrink-0">
        <Icon name={loading ? 'autorenew' : 'auto_fix_high'} className={cn('text-base', loading && 'animate-spin')} />
        {loading ? 'Buscando…' : `Rellenar nombres${faltan ? ` (${faltan})` : ''}`}
      </button>
    </div>
  );
}

function GestionAreasView() {
  const [inner, setInner] = useState<'asignar' | 'config'>('asignar');
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="flex gap-1 bg-surface-container-low p-1 rounded-xl w-fit">
          {([
            { id: 'asignar', label: 'Asignar Áreas',    icon: 'warehouse' },
            { id: 'config',  label: 'Configurar Áreas', icon: 'tune'      },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setInner(t.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-label font-bold uppercase tracking-widest transition-all',
                inner === t.id ? 'bg-surface text-primary shadow-sm' : 'text-stone-400 hover:text-stone-600'
              )}>
              <Icon name={t.icon} className="text-base" />
              {t.label}
            </button>
          ))}
        </div>
        <RellenarNombresBtn />
      </div>
      {inner === 'asignar' && <AreasView />}
      {inner === 'config'  && <ConfiguracionAreasView />}
    </div>
  );
}

// ── Main BodegaTab ─────────────────────────────────────────────────────────────
export default function BodegaTab() {
  const [view,      setView]      = useState<SubView>('recepcion');
  const [areasData, setAreasData] = useState<AreaConfig[]>([]);

  const loadAreas = useCallback(async () => {
    try {
      // Fuente unificada de áreas: MSSQL ubicaciones_bodega (las 6 reales)
      const data = await fetch('/api/almacen/ubicaciones/areas-bodega').then(r => r.json());
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
        {view === 'recepcion'      && <RecepcionYNuevosView />}
        {view === 'gestion-areas'  && <GestionAreasView />}
        {view === 'merma'          && <MermaView />}
        {view === 'discrepancias'  && <DiscrepanciasView />}
        {view === 'facturas'       && <FacturasView />}
        {view === 'zebra'          && <ZebraView />}
      </div>
    </section>
    </AreasCtx.Provider>
  );
}
