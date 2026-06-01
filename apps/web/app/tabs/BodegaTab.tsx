'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { cn } from '../lib/utils';
import { Icon } from '../components/Icon';
import type {
  Area, AreaConfig, AreaCount, AreaProduct, ExpiryRecord,
  SurtidoTransfer, Recuento, StagnantProduct,
  StockUbicacion, ResumenUbicacion, MovimientoUnificado, TipoMovimiento,
  ConsumoArea,
  EstadoFactura, FacturaCompra, FacturaConDetalle, FacturaDetalle,
  RecepcionEsperada, RecepcionEsperadaConDetalle, EstatusRecepcion,
  RecepcionDiscrepancia, CaducidadItem, SemaforoCaducidad,
} from '../lib/types';

// ── Sub-view config ────────────────────────────────────────────────────────────
type SubView = 'stock-surtido' | 'gestion-areas' | 'recepcion' | 'merma' | 'caducidades' | 'discrepancias' | 'facturas' | 'zebra';
const SUB_VIEWS: { id: SubView; label: string; icon: string; dev?: boolean }[] = [
  { id: 'stock-surtido',  label: 'Stock & Surtido',   icon: 'inventory_2'    },
  { id: 'recepcion',      label: 'Recepción',          icon: 'local_shipping' },
  { id: 'gestion-areas',  label: 'Áreas',              icon: 'warehouse'      },
  { id: 'merma',          label: 'Merma / Caducidad',  icon: 'event_busy'     },
  { id: 'caducidades',    label: 'Caducidades',        icon: 'hourglass_bottom'},
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

interface MermaStats {
  periodo:      string;
  totales:      { num_registros: number; total_unidades: number };
  porMotivo:    { motivo: string; num_registros: number; total_unidades: number }[];
  topProductos: { codigo: string; nombre: string; num_registros: number; total_unidades: number }[];
  porArea:      { area: string; num_registros: number; total_unidades: number }[];
  tendencia:    { mes: string; num_registros: number; total_unidades: number }[];
}

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
  const [stats,        setStats]        = useState<MermaStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsMes,     setStatsMes]     = useState(new Date().toISOString().slice(0, 7));
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

      {/* ── Estadísticas de merma ────────────────────────────────────────── */}
      <div className="mt-8 border-t border-outline-variant/10 pt-6">
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

// ── Surtido sub-view ──────────────────────────────────────────────────────────
function SurtidoView() {
  const { areas, areaMap } = useAreasCtx();

  // ── Surtido (transferencias) ──────────────────────────────────────────────
  const [transfers, setTransfers] = useState<SurtidoTransfer[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [showForm,  setShowForm]  = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [form, setForm] = useState({
    art_codigo: '', nombre: '',
    de_area: 'bodega' as Area, a_area: 'cocina' as Area,
    cantidad: '', notas: '',
  });

  // ── Stock actual por área ─────────────────────────────────────────────────
  const nonBodegaAreas = areas.filter(a => a !== 'bodega');
  const [stockArea,      setStockArea]      = useState<Area>(nonBodegaAreas[0] ?? 'cocina');
  const [stockItems,     setStockItems]     = useState<StockUbicacion[]>([]);
  const [stockLoading,   setStockLoading]   = useState(false);
  const [stockCollapsed, setStockCollapsed] = useState(false);

  // ── Consumo por área ──────────────────────────────────────────────────────
  const [consumos,       setConsumos]       = useState<ConsumoArea[]>([]);
  const [consumoLoading, setConsumoLoading] = useState(false);
  const [showConsumo,    setShowConsumo]    = useState(false);
  const [savingConsumo,  setSavingConsumo]  = useState(false);
  const [consumoForm,    setConsumoForm]    = useState({ art_codigo: '', nombre: '', cantidad: '', notas: '' });

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

  const fetchStock = useCallback(async (area: Area) => {
    setStockLoading(true);
    try {
      const data = await fetch(`/api/bodega/stock-ubicaciones?area=${encodeURIComponent(area)}`).then(r => r.json());
      setStockItems(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    finally { setStockLoading(false); }
  }, []);

  const fetchConsumos = useCallback(async (area: Area) => {
    setConsumoLoading(true);
    try {
      const data = await fetch(`/api/bodega/consumo-area?area=${encodeURIComponent(area)}`).then(r => r.json());
      setConsumos(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    finally { setConsumoLoading(false); }
  }, []);

  useEffect(() => { fetchTransfers(); }, [fetchTransfers]);
  useEffect(() => { fetchStock(stockArea); fetchConsumos(stockArea); }, [fetchStock, fetchConsumos, stockArea]);

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
      if (res.ok) { notify(data.message || 'Autorizado'); fetchTransfers(); fetchStock(stockArea); }
      else notify(data.error || 'Error', 'error');
    } catch { notify('Error de conexión', 'error'); }
  };

  const saveConsumo = async () => {
    if (!consumoForm.art_codigo || !consumoForm.cantidad) { notify('Código y cantidad son requeridos', 'error'); return; }
    setSavingConsumo(true);
    try {
      const res  = await fetch('/api/bodega/consumo-area', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...consumoForm, area: stockArea }),
      });
      const data = await res.json();
      if (res.ok) {
        notify('Consumo registrado');
        setShowConsumo(false);
        setConsumoForm({ art_codigo: '', nombre: '', cantidad: '', notas: '' });
        fetchStock(stockArea);
        fetchConsumos(stockArea);
      } else notify(data.error || 'Error', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setSavingConsumo(false); }
  };

  // Group transfers by week
  const byWeek = transfers.reduce<Record<string, SurtidoTransfer[]>>((acc, t) => {
    const key = t.semana || 'Sin semana';
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});

  const totalUdsArea = stockItems.reduce((s, i) => s + i.cantidad, 0);

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

      {/* ── Panel: Stock actual por área ────────────────────────────────── */}
      <div className="mb-6 rounded-2xl border border-outline-variant/10 bg-surface-container-low overflow-hidden">
        <button
          onClick={() => setStockCollapsed(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 group">
          <div className="flex items-center gap-2">
            <Icon name="inventory_2" className="text-base text-primary" />
            <span className="text-[11px] font-label font-bold uppercase tracking-widest text-stone-600">
              Stock físico por área
            </span>
          </div>
          <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
            {/* Area tabs */}
            <div className="flex gap-1">
              {nonBodegaAreas.map(a => (
                <button
                  key={a}
                  onClick={() => setStockArea(a)}
                  className={cn(
                    'px-3 py-1 rounded-full text-[10px] font-label font-bold uppercase tracking-widest transition-all',
                    stockArea === a
                      ? cn(areaMap[a]?.bg || 'bg-primary/10', areaMap[a]?.color || 'text-primary')
                      : 'bg-stone-100 text-stone-400 hover:bg-stone-200'
                  )}>
                  {areaMap[a]?.label || a}
                </button>
              ))}
            </div>
            <Icon
              name={stockCollapsed ? 'expand_more' : 'expand_less'}
              className="text-stone-400 group-hover:text-stone-600 transition-colors pointer-events-none"
            />
          </div>
        </button>

        {!stockCollapsed && (
          <div className="px-5 pb-5">
            {/* Área header + consumo button */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={cn('w-7 h-7 rounded-full flex items-center justify-center', areaMap[stockArea]?.bg || 'bg-stone-100')}>
                  <Icon name={areaMap[stockArea]?.icon || 'category'} className={cn('text-sm', areaMap[stockArea]?.color || 'text-stone-500')} />
                </div>
                <div>
                  <p className="text-sm font-serif text-on-surface">{areaMap[stockArea]?.label || stockArea}</p>
                  {!stockLoading && (
                    <p className="text-[10px] font-label text-stone-400">
                      {stockItems.length} producto{stockItems.length !== 1 ? 's' : ''} · {totalUdsArea} uds totales
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setShowConsumo(v => !v)}
                className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-[10px] font-label font-bold uppercase tracking-widest flex items-center gap-1.5 hover:bg-amber-700 transition-all shadow-sm">
                <Icon name={showConsumo ? 'close' : 'remove_circle_outline'} className="text-sm" />
                {showConsumo ? 'Cancelar' : 'Registrar Consumo'}
              </button>
            </div>

            {/* Consumo form */}
            {showConsumo && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 space-y-3">
                <p className="text-[10px] font-label font-bold uppercase tracking-widest text-amber-700">
                  Consumo en {areaMap[stockArea]?.label || stockArea}
                </p>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Código *</label>
                    <input
                      value={consumoForm.art_codigo}
                      onChange={e => setConsumoForm(f => ({ ...f, art_codigo: e.target.value }))}
                      placeholder="Art_Codigo"
                      list="stock-area-list"
                      className="w-full px-3 py-2 bg-white border border-amber-200 rounded-lg text-sm font-body outline-none focus:border-amber-400 transition-colors" />
                    <datalist id="stock-area-list">
                      {stockItems.map(i => <option key={i.art_codigo} value={i.art_codigo}>{i.nombre || i.art_codigo}</option>)}
                    </datalist>
                  </div>
                  <div>
                    <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Nombre</label>
                    <input
                      value={consumoForm.nombre}
                      onChange={e => setConsumoForm(f => ({ ...f, nombre: e.target.value }))}
                      placeholder="Nombre del producto"
                      className="w-full px-3 py-2 bg-white border border-amber-200 rounded-lg text-sm font-body outline-none focus:border-amber-400 transition-colors" />
                  </div>
                  <div>
                    <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Cantidad *</label>
                    <input
                      type="number" min="0.01" step="0.01"
                      value={consumoForm.cantidad}
                      onChange={e => setConsumoForm(f => ({ ...f, cantidad: e.target.value }))}
                      placeholder="Ej: 2"
                      className="w-full px-3 py-2 bg-white border border-amber-200 rounded-lg text-sm font-body outline-none focus:border-amber-400 transition-colors" />
                  </div>
                  <div>
                    <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Notas</label>
                    <input
                      value={consumoForm.notas}
                      onChange={e => setConsumoForm(f => ({ ...f, notas: e.target.value }))}
                      placeholder="Opcional"
                      className="w-full px-3 py-2 bg-white border border-amber-200 rounded-lg text-sm font-body outline-none focus:border-amber-400 transition-colors" />
                  </div>
                </div>
                <button onClick={saveConsumo} disabled={savingConsumo}
                  className={cn(
                    'w-full py-2 rounded-xl text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all',
                    savingConsumo ? 'bg-stone-200 text-stone-400' : 'bg-amber-600 text-white hover:bg-amber-700'
                  )}>
                  {savingConsumo
                    ? <div className="w-4 h-4 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />
                    : <Icon name="check" className="text-base" />}
                  Confirmar Consumo
                </button>
              </div>
            )}

            {/* Stock table */}
            {stockLoading ? (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
              </div>
            ) : stockItems.length === 0 ? (
              <div className="py-8 flex flex-col items-center text-stone-300">
                <Icon name="inventory_2" className="text-4xl opacity-20 mb-2" />
                <p className="text-xs font-label uppercase tracking-widest">
                  Sin stock registrado en {areaMap[stockArea]?.label || stockArea}
                </p>
                <p className="text-[10px] font-label text-stone-300 mt-1">Autoriza surtidos desde bodega para que aparezca aquí</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
                {stockItems.map(item => (
                  <div key={item.art_codigo}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-background border border-outline-variant/10 hover:border-primary/20 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-body text-on-surface truncate">{item.nombre || item.art_codigo}</p>
                      <p className="text-[10px] font-label text-stone-400 font-mono">{item.art_codigo}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-label font-bold text-on-surface">{item.cantidad}</p>
                      <p className="text-[9px] font-label text-stone-300">uds</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Últimos consumos */}
            {consumos.length > 0 && (
              <div className="mt-4 pt-4 border-t border-outline-variant/10">
                <p className="text-[10px] font-label font-bold uppercase tracking-widest text-stone-400 mb-2">Consumos recientes</p>
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
                  {consumos.slice(0, 10).map(c => (
                    <div key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-amber-50/50 border border-amber-100">
                      <Icon name="remove_circle_outline" className="text-sm text-amber-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-body text-on-surface truncate">{c.nombre || c.art_codigo}</p>
                        {c.notas && <p className="text-[10px] font-label text-stone-400 truncate">{c.notas}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-label font-bold text-amber-700">−{c.cantidad}</p>
                        <p className="text-[9px] font-label text-stone-300">
                          {new Date(c.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Registrar surtido ────────────────────────────────────────────── */}
      <div className="flex justify-between items-center mb-5">
        <p className="text-[11px] font-label uppercase tracking-widest text-stone-400">
          Historial de movimientos bodega ↔ áreas
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
      {/* Stock por ubicación TC52 */}
      <Tc52StockPanel />

      {/* Filtros movimientos */}
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

  // Auto-refresh del detalle cada 8s mientras la orden sigue activa (Pendiente/Parcial)
  useEffect(() => {
    if (!selected || selected.estatus === 'Recibida' || selected.estatus === 'Cancelada') return;
    const t = setInterval(() => fetchDetalle(selected.id), 8000);
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
        <button onClick={() => setShowForm(v => !v)}
          className="px-4 py-2 bg-primary text-on-primary rounded-lg text-xs font-label font-bold uppercase tracking-widest flex items-center gap-2 shadow-md hover:bg-primary-container transition-all flex-shrink-0">
          <Icon name={showForm ? 'close' : 'add'} className="text-base" />
          {showForm ? 'Cancelar' : 'Nueva Factura'}
        </button>
      </div>

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
function GestionAreasView() {
  const [inner, setInner] = useState<'asignar' | 'config'>('asignar');
  return (
    <div>
      <div className="flex gap-1 mb-6 bg-surface-container-low p-1 rounded-xl w-fit">
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
      {inner === 'asignar' && <AreasView />}
      {inner === 'config'  && <ConfiguracionAreasView />}
    </div>
  );
}

// ── Stock + Surtido combinado ──────────────────────────────────────────────────
function StockSurtidoView() {
  const [inner, setInner] = useState<'ubicaciones' | 'surtido'>('ubicaciones');
  return (
    <div>
      <div className="flex gap-1 mb-6 bg-surface-container-low p-1 rounded-xl w-fit">
        {([
          { id: 'ubicaciones', label: 'Stock por área', icon: 'inventory_2' },
          { id: 'surtido',     label: 'Surtido',        icon: 'swap_horiz'  },
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
      {inner === 'ubicaciones' && <UbicacionesView />}
      {inner === 'surtido'     && <SurtidoView />}
    </div>
  );
}

// ── Caducidades sub-view ───────────────────────────────────────────────────────
const DIAS_OPCIONES = [7, 15, 30, 60, 90];

function CaducidadesView() {
  const [items,   setItems]   = useState<CaducidadItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [dias,    setDias]    = useState(30);

  const fetchData = useCallback(async (d: number) => {
    setLoading(true);
    try {
      const data = await fetch(`/api/recepcion/caducidades?dias=${d}`).then(r => r.json());
      const arr = (Array.isArray(data) ? data : []) as CaducidadItem[];
      // Orden por fecha de vencimiento ascendente (más próximos arriba)
      arr.sort((a, b) => (a.caducidad || '').localeCompare(b.caducidad || ''));
      setItems(arr);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(dias); }, [fetchData, dias]);

  const counts = useMemo(() => {
    const c: Record<SemaforoCaducidad, number> = { VENCIDO: 0, CRITICO: 0, AVISO: 0, OK: 0 };
    for (const it of items) c[it.semaforo] = (c[it.semaforo] ?? 0) + 1;
    return c;
  }, [items]);

  const exportarExcel = () => {
    if (!items.length) return;
    const XLSX = require('xlsx');
    const filas = items.map(it => ({
      'Producto':         it.nombre || it.codigo_barras,
      'Código':           it.codigo_barras,
      'Ubicación':        it.ubicacion || '',
      'Lote':             it.lote || '',
      'Vence':            it.caducidad || '',
      'Días restantes':   it.dias_para_vencer,
      'Piezas':           it.piezas_totales,
      'Estado':           SEMAFORO_META[it.semaforo].label,
      'Folio recepción':  it.folio_recepcion || '',
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([], { skipHeader: true });
    XLSX.utils.sheet_add_aoa(ws, [
      ['Caducidades — La Casita Deli'],
      [`Alertas de los próximos ${dias} días`],
      [`Total: ${items.length} lote${items.length !== 1 ? 's' : ''} · ${items.reduce((s, r) => s + Number(r.piezas_totales || 0), 0)} piezas`],
      [],
    ]);
    XLSX.utils.sheet_add_json(ws, filas, { origin: 'A5' });
    ws['!cols'] = [{ wch: 36 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 18 }];
    ['A1', 'A2', 'A3'].forEach(cell => { if (ws[cell]) ws[cell].s = { font: { bold: true } }; });
    XLSX.utils.book_append_sheet(wb, ws, 'Caducidades');
    XLSX.writeFile(wb, `caducidades-${dias}d.xlsx`);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h3 className="font-serif text-xl text-primary">Caducidades</h3>
          <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mt-0.5">
            Lotes con fecha de vencimiento registrada en recepciones confirmadas
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[10px] font-label uppercase tracking-widest text-stone-500">Próximos</label>
          <select value={dias} onChange={e => setDias(Number(e.target.value))}
            className="px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors">
            {DIAS_OPCIONES.map(d => <option key={d} value={d}>{d} días</option>)}
          </select>
          <button onClick={() => fetchData(dias)} disabled={loading}
            className={cn('p-2 rounded-lg hover:bg-surface-container-low transition-all text-stone-400 hover:text-primary', loading && 'animate-spin')}
            title="Actualizar">
            <Icon name="refresh" />
          </button>
          <button onClick={exportarExcel} disabled={!items.length}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg text-[11px] font-label font-bold uppercase tracking-widest hover:bg-primary/90 shadow-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed">
            <Icon name="download" className="text-base" /> Exportar Excel
          </button>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 mb-5">
        {[
          { label: 'Vencidos',     count: counts.VENCIDO, color: 'bg-error-container/50 text-on-error-container' },
          { label: 'Crítico (7d)', count: counts.CRITICO, color: 'bg-orange-100 text-orange-700' },
          { label: 'Aviso',        count: counts.AVISO,   color: 'bg-yellow-100 text-yellow-700' },
          { label: 'En orden',     count: counts.OK,      color: 'bg-emerald-100 text-emerald-700' },
        ].map(c => (
          <span key={c.label}
            className={cn('px-3 py-1 rounded-full text-[10px] font-label font-bold uppercase tracking-widest', c.color)}>
            {c.label}: {c.count}
          </span>
        ))}
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="flex justify-center py-14">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-stone-300 border border-dashed border-stone-200 rounded-xl">
          <Icon name="hourglass_empty" className="text-5xl opacity-20 mb-3" />
          <p className="text-sm font-label uppercase tracking-widest">Sin caducidades en los próximos {dias} días</p>
          <p className="text-[11px] font-body text-stone-400 mt-2 text-center max-w-xs">
            Las caducidades se registran al recibir mercancía con fecha de vencimiento desde el TC52
          </p>
        </div>
      ) : (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container">
                <tr>
                  <th className="px-5 py-3">Producto</th>
                  <th className="px-4 py-3">Ubicación</th>
                  <th className="px-4 py-3">Lote</th>
                  <th className="px-4 py-3">Vence</th>
                  <th className="px-4 py-3 text-center">Días restantes</th>
                  <th className="px-4 py-3 text-right">Piezas</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {items.map((it, i) => {
                  const meta = SEMAFORO_META[it.semaforo];
                  return (
                    <tr key={`${it.codigo_barras}-${it.lote ?? ''}-${it.caducidad}-${i}`} className="hover:bg-background transition-colors">
                      <td className="px-5 py-3">
                        <p className="text-sm font-body text-on-surface">{it.nombre || it.codigo_barras}</p>
                        <p className="text-[9px] font-mono text-stone-400 mt-0.5">{it.codigo_barras}</p>
                      </td>
                      <td className="px-4 py-3 text-sm font-body text-stone-600">{it.ubicacion || '—'}</td>
                      <td className="px-4 py-3 text-sm font-body text-stone-600">{it.lote || '—'}</td>
                      <td className="px-4 py-3 text-sm font-body text-stone-600">
                        {it.caducidad ? new Date(it.caducidad + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn('font-serif font-bold', it.dias_para_vencer < 0 ? 'text-error' : it.dias_para_vencer <= 7 ? 'text-orange-600' : 'text-on-surface')}>
                          {it.dias_para_vencer < 0 ? `${Math.abs(it.dias_para_vencer)}d vencido` : `${it.dias_para_vencer}d`}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-serif font-bold text-on-surface">
                        {Number(it.piezas_totales).toLocaleString('es-MX')}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn('inline-block px-2.5 py-1 rounded-full text-[10px] font-label font-bold uppercase tracking-wider', meta.bg, meta.color)}>
                          {meta.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-surface-container bg-surface-container-low/30 flex items-center justify-between">
            <p className="text-[10px] font-label text-stone-400 uppercase tracking-widest">
              {items.length} lote{items.length !== 1 ? 's' : ''} con caducidad
            </p>
            <p className="text-[10px] font-label text-stone-400">
              Total: {items.reduce((s, r) => s + Number(r.piezas_totales || 0), 0).toLocaleString('es-MX')} pzas
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main BodegaTab ─────────────────────────────────────────────────────────────
export default function BodegaTab() {
  const [view,      setView]      = useState<SubView>('stock-surtido');
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
        {view === 'stock-surtido'  && <StockSurtidoView />}
        {view === 'recepcion'      && <RecepcionView />}
        {view === 'gestion-areas'  && <GestionAreasView />}
        {view === 'merma'          && <MermaView />}
        {view === 'caducidades'    && <CaducidadesView />}
        {view === 'discrepancias'  && <DiscrepanciasView />}
        {view === 'facturas'       && <FacturasView />}
        {view === 'zebra'          && <ZebraView />}
      </div>
    </section>
    </AreasCtx.Provider>
  );
}
