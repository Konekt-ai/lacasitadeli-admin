'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '../lib/utils';
import { Icon } from '../components/Icon';
import SinAltaNovacaja from './SinAltaNovacaja';
import type { Product, Category, Area } from '../lib/types';

const PAGE_SIZE = 50;

interface Props {
  lowStockProducts: Product[];
  categories:       Category[];
  onRefresh:        () => void;
}

interface PanelState {
  stock:         string;
  salePrice:     string;
  image:         string;
  descontinuado: boolean;
}

// GET /api/resurtido/sugerencia/:codigo — cuánto conviene mover y por qué
interface Sugerencia {
  codigo: string; nombre: string; origen: string; destino: string;
  stock_origen: number; stock_destino: number | null; apartado_destino: number; disponible_destino: number;
  vendidas_ventana: number; ventana_dias: number; venta_diaria: number; cobertura_dias: number | null;
  ultima_venta: string | null; sugerido: number; sugerido_sin_tope: number; objetivo_dias: number;
  unidades_por_caja: number | null;
}

// Resumen de la solicitud que ya existe (409 al pedir resurtido repetido)
interface SolicitudResumen {
  id: number; cantidad: number; de_ubicacion: string; a_ubicacion: string;
  nota: string | null; solicitado_por: string | null; estado: string;
}

// SQLite guarda UTC ("YYYY-MM-DD HH:MM:SS" o ISO con Z); mostrar en hora CDMX como dd/mm/aa
const fmtFechaCorta = (iso: string) => {
  const s = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(iso) ? `${iso.replace(' ', 'T')}Z` : iso;
  const d = new Date(s);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Mexico_City' });
};

export default function InventarioTab({ lowStockProducts, categories, onRefresh }: Props) {
  // ── Products state ────────────────────────────────────────────────────────────
  const [products,    setProducts]    = useState<Product[]>([]);
  const [total,       setTotal]       = useState(0);
  const [totalPages,  setTotalPages]  = useState(1);
  const [page,        setPage]        = useState(1);
  const [loading,     setLoading]     = useState(false);

  // ── Filters ───────────────────────────────────────────────────────────────────
  const [searchQuery,    setSearchQuery]    = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [areaFilter,     setAreaFilter]     = useState('');
  const [sinPrecio,      setSinPrecio]      = useState(false);
  // Default del panel = solo productos con stock (igual que la Bodega TC52),
  // ordenados de mayor a menor. "Ver todos" muestra el catálogo completo.
  const [soloConStock,   setSoloConStock]   = useState(true);
  const [soloFaltantes,  setSoloFaltantes]  = useState(false);
  // "Descontinuado" es un estatus REAL que marca el dueño (no es "lleva tiempo sin venderse").
  const [soloDescontinuados, setSoloDescontinuados] = useState(false);
  const [nDescontinuados,    setNDescontinuados]    = useState(0);
  const [inventoryView,  setInventoryView]  = useState<'list' | 'grid'>('list');

  // ── Categorías / tipos propios (asignados por Excel) ──────────────────────────
  const [miCatFilter,    setMiCatFilter]    = useState('');
  const [tipoFilter,     setTipoFilter]     = useState('');
  const [catAsignadas,   setCatAsignadas]   = useState<string[]>([]);
  const [tiposAsignados, setTiposAsignados] = useState<string[]>([]);
  const [importing,      setImporting]      = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Area assignments (from SQLite) ────────────────────────────────────────────
  const [locationMap, setLocationMap] = useState<Map<string, Area>>(new Map());
  const [areaOptions, setAreaOptions] = useState<{ area: string; nombre: string; color?: string | null }[]>([]);
  // Stock por ubicación (lo que cuenta el TC52): art_codigo → [{area, cantidad}]
  const [ubicMap, setUbicMap] = useState<Map<string, { area: string; cantidad: number }[]>>(new Map());

  // ── Edit side-panel ───────────────────────────────────────────────────────────
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [panel,          setPanel]          = useState<PanelState>({ stock: '', salePrice: '', image: '', descontinuado: false });
  const [panelSaving,    setPanelSaving]    = useState(false);

  // ── Solicitud de resurtido (modal) ────────────────────────────────────────────
  // El botón NO mueve stock: crea una solicitud que bodega ejecuta con la TC52.
  const [resurtir,     setResurtir]     = useState<Product | null>(null);
  const [ubicaciones,  setUbicaciones]  = useState<{ venta: string[]; respaldo: string[] } | null>(null);
  const [rDestino,     setRDestino]     = useState('');
  const [rOrigen,      setROrigen]      = useState('');
  const [rSug,         setRSug]         = useState<Sugerencia | null>(null);
  const [rSugLoading,  setRSugLoading]  = useState(false);
  const [rCantidad,    setRCantidad]    = useState('1');
  const [rNota,        setRNota]        = useState('');
  const [rSaving,      setRSaving]      = useState(false);
  const [rError,       setRError]       = useState<string | null>(null);
  const [rExistente,   setRExistente]   = useState<SolicitudResumen | null>(null);

  // ── Inline stock edit ─────────────────────────────────────────────────────────
  const [inlineId,  setInlineId]  = useState<string | null>(null);
  const [inlineVal, setInlineVal] = useState('');

  // ── Notifications ─────────────────────────────────────────────────────────────
  const [notif, setNotif] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success', ms = 3000) => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), ms);
  };

  // Categorías y tipos que el cliente ya asignó (para los dropdowns de filtro)
  // + cuántos productos están marcados como descontinuados (para el chip).
  const loadCatAsignadas = useCallback(() => {
    fetch('/api/products/categorias-asignadas')
      .then(r => r.json())
      .then((d: { categorias?: string[]; tipos?: string[]; descontinuados?: number }) => {
        setCatAsignadas(Array.isArray(d?.categorias) ? d.categorias : []);
        setTiposAsignados(Array.isArray(d?.tipos) ? d.tipos : []);
        setNDescontinuados(Number(d?.descontinuados) || 0);
      })
      .catch(() => {});
  }, []);
  useEffect(() => { loadCatAsignadas(); }, [loadCatAsignadas]);

  // ── Fetch areas ───────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/bodega/products-by-area')
      .then(r => r.json())
      .then((data: { art_codigo: string; area: Area }[]) => {
        if (Array.isArray(data)) setLocationMap(new Map(data.map(r => [r.art_codigo, r.area])));
      })
      .catch(() => {});

    fetch('/api/bodega/area-counts')
      .then(r => r.json())
      .then((data: { area: string; nombre: string; color?: string | null }[]) => {
        if (Array.isArray(data)) setAreaOptions(data);
      })
      .catch(() => {});

    // Stock por ubicación (TC52) → mapa por producto, ignorando ceros
    fetch('/api/almacen/ubicaciones')
      .then(r => r.json())
      .then((data: { art_codigo: string; area: string; cantidad: number }[]) => {
        if (!Array.isArray(data)) return;
        const m = new Map<string, { area: string; cantidad: number }[]>();
        for (const r of data) {
          if (!r.cantidad) continue;
          const arr = m.get(r.art_codigo) ?? [];
          arr.push({ area: r.area, cantidad: r.cantidad });
          m.set(r.art_codigo, arr);
        }
        setUbicMap(m);
      })
      .catch(() => {});
  }, []);

  const areaName  = (area: string) => areaOptions.find(a => a.area === area)?.nombre ?? area;
  const areaColor = (area: string) => areaOptions.find(a => a.area === area)?.color || '#6B7280';

  // Semáforo de stock (como los Zebra): gris = agotado, naranja = por acabarse, verde = ok.
  const stockColor = (stock: number, min: number) =>
    stock <= 0 ? 'text-stone-400' : stock <= min ? 'text-orange-600' : 'text-emerald-600';
  // "Descontinuado" manda sobre el semáforo (el número de stock conserva su color).
  const stockLabel = (p: Product) =>
    p.descontinuado ? 'Descontinuado' : p.stock <= 0 ? 'Agotado' : p.stock <= p.minStock ? 'Bajo' : 'En stock';
  const stockBadgeClass = (p: Product) =>
    p.descontinuado ? 'bg-stone-900 text-white'
      : p.stock <= 0 ? 'bg-stone-100 text-stone-500'
      : p.stock <= p.minStock ? 'bg-orange-100 text-orange-700'
      : 'bg-emerald-100 text-emerald-700';

  // ── Fetch products — debounced on search/category, immediate on page ──────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchRef       = useRef(searchQuery);
  const categoryRef     = useRef(categoryFilter);
  const sinPrecioRef    = useRef(sinPrecio);
  const soloConStockRef = useRef(soloConStock);
  const miCatRef        = useRef(miCatFilter);
  const tipoRef         = useRef(tipoFilter);
  const descRef         = useRef(soloDescontinuados);
  searchRef.current       = searchQuery;
  categoryRef.current     = categoryFilter;
  sinPrecioRef.current    = sinPrecio;
  soloConStockRef.current = soloConStock;
  miCatRef.current        = miCatFilter;
  tipoRef.current         = tipoFilter;
  descRef.current         = soloDescontinuados;

  const fetchProducts = useCallback(async (pg: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        q:        searchRef.current,
        category: categoryRef.current,
        page:     String(pg),
        pageSize: String(PAGE_SIZE),
      });
      if (sinPrecioRef.current) params.set('sinPrecio', 'true');
      // Descontinuados: el backend ignora conStock en esa ruta, así que solo
      // mandamos conStock cuando el chip de descontinuados está apagado.
      if (descRef.current) params.set('descontinuado', 'true');
      else if (soloConStockRef.current) params.set('conStock', 'true');
      if (miCatRef.current) params.set('catLocal', miCatRef.current);
      if (tipoRef.current)  params.set('tipoLocal', tipoRef.current);
      const res  = await fetch(`/api/products?${params}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        notify(data.error || 'Error al cargar productos', 'error');
        return;
      }
      setProducts(data.data ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.pages ?? 1);
    } catch (e) {
      notify('Error de conexión con la API', 'error');
      console.error('Error inventario:', e);
    }
    finally { setLoading(false); }
  }, []);

  // Search/category change → debounce 300ms, reset to page 1
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      fetchProducts(1);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchQuery, categoryFilter, sinPrecio, soloConStock, miCatFilter, tipoFilter, soloDescontinuados, fetchProducts]);

  // Page change → fetch immediately
  const prevPage = useRef(1);
  useEffect(() => {
    if (prevPage.current !== page) {
      prevPage.current = page;
      fetchProducts(page);
    }
  }, [page, fetchProducts]);

  // ── Client-side area filter (on current page only) ────────────────────────────
  let displayed = areaFilter
    ? products.filter(p => (locationMap.get(String(p.id)) || 'bodega') === areaFilter)
    : products;
  // Un descontinuado ya no cuenta como faltante (no se va a resurtir).
  if (soloFaltantes) displayed = displayed.filter(p => !p.descontinuado && p.stock <= p.minStock);

  // ── Edit panel ────────────────────────────────────────────────────────────────
  const openPanel  = (p: Product) => {
    setEditingProduct(p);
    setPanel({ stock: String(p.stock), salePrice: String(p.salePrice), image: p.image || '', descontinuado: !!p.descontinuado });
  };
  const closePanel = () => setEditingProduct(null);

  const savePanel = async () => {
    if (!editingProduct) return;
    setPanelSaving(true);
    try {
      // descontinuado solo se manda si cambió, para no pisar la fecha "desde".
      const cambioDesc = panel.descontinuado !== !!editingProduct.descontinuado;
      const res  = await fetch(`/api/products/${editingProduct.id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          stock:     parseFloat(panel.stock),
          salePrice: parseFloat(panel.salePrice),
          image:     panel.image || null,
          ...(cambioDesc ? { descontinuado: panel.descontinuado } : {}),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        notify(data.message || 'Guardado');
        closePanel();
        fetchProducts(page);
        if (cambioDesc) loadCatAsignadas();
        onRefresh();
      }
      else        notify(data.error || 'Error al guardar', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally   { setPanelSaving(false); }
  };

  // ── Solicitud de resurtido ────────────────────────────────────────────────────
  const openResurtir = async (p: Product) => {
    if (p.descontinuado) return;
    setResurtir(p);
    setRSug(null); setRError(null); setRExistente(null); setRNota(''); setRCantidad('1');
    let u = ubicaciones;
    if (!u) {
      try {
        const d = await fetch('/api/resurtido/ubicaciones').then(r => r.json());
        u = { venta: Array.isArray(d?.venta) ? d.venta : [], respaldo: Array.isArray(d?.respaldo) ? d.respaldo : [] };
      } catch { u = { venta: [], respaldo: [] }; }
      setUbicaciones(u);
    }
    setRDestino(u.venta[0] || '');
    setROrigen(u.respaldo.includes('Bodega') ? 'Bodega' : (u.respaldo[0] || ''));
  };
  const closeResurtir = () => { if (!rSaving) setResurtir(null); };

  // Al cambiar destino/origen → pedir sugerencia y prellenar "Piezas a mover".
  const resurtirId = resurtir ? String(resurtir.id) : null;
  useEffect(() => {
    if (!resurtirId || !rDestino || !rOrigen) { setRSug(null); return; }
    let alive = true;
    setRSugLoading(true);
    const params = new URLSearchParams({ destino: rDestino, origen: rOrigen });
    fetch(`/api/resurtido/sugerencia/${encodeURIComponent(resurtirId)}?${params}`)
      .then(r => r.json())
      .then((d: Sugerencia & { error?: string }) => {
        if (!alive) return;
        if (!d || d.error) { setRSug(null); return; }
        setRSug(d);
        setRCantidad(String(Math.max(1, Math.round(Number(d.sugerido) || 0))));
      })
      .catch(() => { if (alive) setRSug(null); })
      .finally(() => { if (alive) setRSugLoading(false); });
    return () => { alive = false; };
  }, [resurtirId, rDestino, rOrigen]);

  // Esc cierra el modal de resurtido
  useEffect(() => {
    if (!resurtir) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeResurtir(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resurtir, rSaving]);

  const enviarResurtido = async () => {
    if (!resurtir) return;
    const cantidad = parseFloat(rCantidad);
    if (!rDestino || !rOrigen) { setRError('Elige de dónde y hacia dónde se mueve'); return; }
    if (rDestino === rOrigen)  { setRError('El origen y el destino no pueden ser el mismo'); return; }
    if (!(cantidad >= 1))      { setRError('Indica cuántas piezas mover (mínimo 1)'); return; }
    setRSaving(true); setRError(null); setRExistente(null);
    try {
      const res  = await fetch('/api/resurtido', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          codigo_barras: String(resurtir.id),
          a_ubicacion:   rDestino,
          de_ubicacion:  rOrigen,
          cantidad,
          nota:          rNota.trim() || undefined,
          origen:        'panel',
          usuario:       'panel',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const aviso = data?.aviso ? ` · ${data.aviso}` : '';
        notify(`Solicitud creada: bodega la verá en la TC52${aviso}`, 'success', aviso ? 6000 : 3000);
        setResurtir(null);
      } else if (res.status === 409) {
        setRError(data?.error || 'Ya hay una solicitud pendiente para este producto');
        setRExistente(data?.existente || null);
      } else {
        setRError(data?.error || 'No se pudo crear la solicitud');
      }
    } catch { notify('Error de conexión con la API', 'error'); }
    finally { setRSaving(false); }
  };

  // ── Inline stock ──────────────────────────────────────────────────────────────
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
      if (res.ok) { notify('Stock actualizado'); fetchProducts(page); onRefresh(); }
      else        notify(data.error || 'Error', 'error');
    } catch { notify('Error de conexión', 'error'); }
  };

  // ── Exportar / importar categorías por Excel ──────────────────────────────────
  const exportarCategorias = async () => {
    try {
      notify('Preparando Excel de todos los productos…');
      const data = await fetch('/api/products/export').then(r => r.json());
      const rows = (data.data || []) as { codigo: string; nombre: string; categoria_novacaja: string; categoria: string; tipo: string }[];
      const XLSX = require('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows.map(r => ({
        'Código':               r.codigo,
        'Producto':             r.nombre,
        'Categoría (NovaCaja)': r.categoria_novacaja,
        'Categoría':            r.categoria,
        'Tipo':                 r.tipo,
      })));
      ws['!cols'] = [{ wch: 16 }, { wch: 44 }, { wch: 22 }, { wch: 20 }, { wch: 16 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Categorías');
      XLSX.writeFile(wb, 'categorias-productos.xlsx');
      notify(`${rows.length.toLocaleString('es-MX')} productos exportados`);
    } catch { notify('Error al exportar', 'error'); }
  };

  const importarCategorias = async (file: File) => {
    setImporting(true);
    try {
      const XLSX = require('xlsx');
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const raw  = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, unknown>[];
      const pick = (r: Record<string, unknown>, ...keys: string[]) => {
        for (const k of keys) { const v = r[k]; if (v != null && String(v).trim() !== '') return String(v).trim(); }
        return '';
      };
      const items = raw.map(r => ({
        codigo:    pick(r, 'Código', 'Codigo', 'codigo', 'CÓDIGO'),
        categoria: pick(r, 'Categoría', 'Categoria', 'categoria'),
        tipo:      pick(r, 'Tipo', 'tipo', 'TIPO'),
      })).filter(x => x.codigo);
      if (!items.length) { notify('No se encontró la columna "Código" en el Excel', 'error'); setImporting(false); return; }
      const res  = await fetch('/api/products/categorias-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ items }),
      });
      const data = await res.json();
      if (res.ok) { notify(`${data.actualizados} productos actualizados`); loadCatAsignadas(); fetchProducts(page); onRefresh(); }
      else        notify(data.error || 'Error al importar', 'error');
    } catch { notify('Error al leer el Excel', 'error'); }
    finally { setImporting(false); }
  };

  return (
    <section className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">

      {/* Toast */}
      {notif && (
        <div className={cn(
          'fixed top-6 right-6 z-[500] px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-sm font-label font-bold',
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

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest flex items-center gap-2">
                  <Icon name="inventory" className="text-sm" /> Cantidad en inventario
                </label>
                <input type="number" min="0" step="1" value={panel.stock}
                  onChange={e => setPanel(p => ({ ...p, stock: e.target.value }))}
                  className="w-full px-4 py-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-2xl font-serif focus:outline-none focus:border-primary transition-colors" />
                <p className="text-[9px] font-label text-stone-400 uppercase tracking-widest">
                  Actual: {editingProduct.stock} uds · actualiza ArticulosAlmacen
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest flex items-center gap-2">
                  <Icon name="sell" className="text-sm" /> Precio de venta
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400 font-body">$</span>
                  <input type="number" min="0" step="0.01" value={panel.salePrice}
                    onChange={e => setPanel(p => ({ ...p, salePrice: e.target.value }))}
                    className="w-full pl-8 pr-4 py-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-2xl font-serif focus:outline-none focus:border-primary transition-colors" />
                </div>
                <p className="text-[9px] font-label text-stone-400 uppercase tracking-widest">
                  Actual: ${Number(editingProduct.salePrice).toFixed(2)} · actualiza ListaPreciosArt (lista 1)
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">Costo (solo lectura)</label>
                <div className="px-4 py-3 bg-surface-container rounded-xl text-xl font-serif text-stone-400">
                  ${Number(editingProduct.costPrice).toFixed(2)}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest flex items-center gap-2">
                  <Icon name="image" className="text-sm" /> URL de imagen
                </label>
                <input type="text" value={panel.image}
                  onChange={e => setPanel(p => ({ ...p, image: e.target.value }))}
                  placeholder="https://..."
                  className="w-full px-4 py-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm font-body focus:outline-none focus:border-primary transition-colors" />
                {panel.image && (
                  <img src={panel.image} alt=""
                    className="w-full h-36 object-cover rounded-xl border border-outline-variant/10 mt-2"
                    onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
                )}
              </div>

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

              {/* Descontinuado: estatus real que decide el dueño (no es "sin movimiento") */}
              <div className={cn('rounded-xl p-4 space-y-2 border transition-colors',
                panel.descontinuado ? 'bg-stone-900 border-stone-900' : 'bg-surface-container-low border-transparent')}>
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className={cn('text-[10px] font-label font-bold uppercase tracking-widest flex items-center gap-2',
                    panel.descontinuado ? 'text-white' : 'text-stone-500')}>
                    <Icon name="block" className="text-sm" /> Descontinuado
                  </span>
                  <input type="checkbox" checked={panel.descontinuado}
                    onChange={e => setPanel(p => ({ ...p, descontinuado: e.target.checked }))}
                    className="w-4 h-4 accent-primary rounded cursor-pointer" />
                </label>
                <p className={cn('text-[11px] font-body leading-relaxed', panel.descontinuado ? 'text-stone-300' : 'text-stone-500')}>
                  Marcarlo significa que YA NO se va a resurtir. Sigue apareciendo en el inventario con sus existencias,
                  pero deja de contar como alerta de stock bajo y la app de resurtido lo muestra como Descontinuado.
                  Lo que solo lleva tiempo sin venderse NO es descontinuado.
                </p>
                {editingProduct.descontinuado && editingProduct.descontinuadoDesde && (
                  <p className={cn('text-[9px] font-label uppercase tracking-widest', panel.descontinuado ? 'text-stone-400' : 'text-stone-400')}>
                    Descontinuado desde {fmtFechaCorta(editingProduct.descontinuadoDesde)}
                  </p>
                )}
              </div>
            </div>

            {/* Resurtir = solicitud para bodega (no mueve stock) */}
            <div className="px-6 pt-4 border-t border-outline-variant/10 flex-shrink-0">
              <button onClick={() => openResurtir(editingProduct)}
                aria-disabled={panel.descontinuado}
                title={panel.descontinuado ? 'Producto descontinuado: no se resurte' : 'Solicitar resurtido (lo ejecuta bodega con la TC52)'}
                className={cn('w-full py-3 rounded-xl text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all border',
                  panel.descontinuado
                    ? 'bg-stone-100 text-stone-400 border-transparent cursor-not-allowed'
                    : 'bg-surface-container-low text-primary border-outline-variant/20 hover:border-primary/40 hover:bg-primary/5')}>
                <Icon name="local_shipping" className="text-base" />
                Solicitar resurtido
              </button>
              <p className="text-[9px] font-label text-stone-400 uppercase tracking-widest mt-2 text-center">
                {panel.descontinuado ? 'Un descontinuado ya no se resurte' : 'Crea una solicitud · bodega la ejecuta con la TC52'}
              </p>
            </div>

            <div className="p-6 flex gap-3 flex-shrink-0">
              <button onClick={closePanel}
                className="flex-1 py-3 bg-surface-variant text-on-surface-variant rounded-xl text-xs font-label font-bold uppercase tracking-widest hover:bg-stone-200 transition-all">
                Cancelar
              </button>
              <button onClick={savePanel} disabled={panelSaving}
                className={cn(
                  'flex-1 py-3 rounded-xl text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-md',
                  panelSaving ? 'bg-stone-200 text-stone-400 cursor-not-allowed' : 'bg-primary text-on-primary hover:bg-primary-container'
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

      {/* ── Modal: solicitar resurtido (crea una SOLICITUD; bodega la ejecuta con la TC52) ── */}
      {resurtir && (
        <div className="fixed inset-0 bg-black/50 z-[400] flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={e => e.target === e.currentTarget && closeResurtir()}>
          <div className="bg-surface rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-start justify-between px-6 py-4 border-b border-outline-variant/10 flex-shrink-0">
              <div className="pr-4 min-w-0">
                <h3 className="font-serif text-xl text-primary">Solicitar resurtido</h3>
                <p className="text-sm font-body font-bold text-on-surface truncate mt-0.5">{resurtir.name}</p>
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-400">Código {resurtir.id}</p>
              </div>
              <button onClick={closeResurtir} className="p-2 hover:bg-stone-100 rounded-full text-stone-400 transition-colors flex-shrink-0">
                <Icon name="close" className="text-xl" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-6 space-y-5">
              {ubicaciones && ubicaciones.venta.length === 0 && ubicaciones.respaldo.length === 0 ? (
                <div className="bg-error/10 text-error rounded-xl p-4 text-xs font-body">
                  No se pudieron cargar las ubicaciones. Revisa que la API esté corriendo e inténtalo de nuevo.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest flex items-center gap-2">
                      <Icon name="storefront" className="text-sm" /> Hacia
                    </label>
                    <select value={rDestino} onChange={e => setRDestino(e.target.value)}
                      className="w-full px-3 py-2.5 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm font-body outline-none focus:border-primary cursor-pointer">
                      {!ubicaciones && <option value="">Cargando…</option>}
                      {(ubicaciones?.venta ?? []).map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest flex items-center gap-2">
                      <Icon name="warehouse" className="text-sm" /> Desde
                    </label>
                    <select value={rOrigen} onChange={e => setROrigen(e.target.value)}
                      className="w-full px-3 py-2.5 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm font-body outline-none focus:border-primary cursor-pointer">
                      {!ubicaciones && <option value="">Cargando…</option>}
                      {(ubicaciones?.respaldo ?? []).map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {/* Sugerencia: qué hay, cuánto se vende y cuánto conviene mover */}
              <div className="bg-surface-container-low rounded-xl p-4">
                {rSugLoading ? (
                  <div className="flex items-center gap-3 text-stone-400">
                    <div className="w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                    <span className="text-[10px] font-label uppercase tracking-widest">Calculando sugerencia…</span>
                  </div>
                ) : rSug ? (
                  <div className="space-y-1.5">
                    <p className="text-[9px] font-label uppercase tracking-widest text-stone-400">Sugerencia</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-body text-on-surface">
                      <span>
                        En <b>{rSug.destino}</b>:{' '}
                        {rSug.stock_destino == null
                          ? <span className="text-stone-400 italic">sin conteo</span>
                          : <b>{rSug.stock_destino.toLocaleString('es-MX')} pzas</b>}
                        {rSug.apartado_destino > 0 && <span className="text-stone-400"> ({rSug.apartado_destino} apartadas)</span>}
                      </span>
                      <span>·</span>
                      <span>
                        {rSug.venta_diaria > 0
                          ? <>Se venden <b>~{rSug.venta_diaria.toLocaleString('es-MX', { maximumFractionDigits: 1 })}</b> al día</>
                          : <span className="text-stone-400">Sin ventas en {rSug.ventana_dias} días</span>}
                      </span>
                      <span>·</span>
                      <span>
                        {rSug.cobertura_dias == null
                          ? <span className="text-stone-400">Cobertura: —</span>
                          : <>Alcanza para <b className={cn(rSug.cobertura_dias < rSug.objetivo_dias ? 'text-orange-600' : 'text-emerald-600')}>
                              {Math.round(rSug.cobertura_dias).toLocaleString('es-MX')} días</b></>}
                      </span>
                      <span>·</span>
                      <span>En <b>{rSug.origen}</b>: <b>{rSug.stock_origen.toLocaleString('es-MX')} pzas</b></span>
                    </div>
                    <p className="text-sm font-body text-primary font-bold pt-1">
                      Sugerido: {rSug.sugerido.toLocaleString('es-MX')} pzas
                      <span className="text-[10px] font-label text-stone-400 font-normal uppercase tracking-widest ml-2">
                        para {rSug.objetivo_dias} días
                        {rSug.sugerido_sin_tope > rSug.sugerido && ` · harían falta ${rSug.sugerido_sin_tope.toLocaleString('es-MX')}, hay ${rSug.stock_origen.toLocaleString('es-MX')} en ${rSug.origen}`}
                      </span>
                    </p>
                  </div>
                ) : (
                  <p className="text-[10px] font-label uppercase tracking-widest text-stone-400">
                    {rDestino && rOrigen ? 'Sin sugerencia disponible para este producto' : 'Elige de dónde y hacia dónde para ver la sugerencia'}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest flex items-center gap-2">
                    <Icon name="inventory" className="text-sm" /> Piezas a mover
                  </label>
                  <input type="number" min="1" step="1" value={rCantidad}
                    onChange={e => setRCantidad(e.target.value)}
                    className="w-full px-4 py-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-2xl font-serif focus:outline-none focus:border-primary transition-colors" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest flex items-center gap-2">
                    <Icon name="sticky_note_2" className="text-sm" /> Nota (opcional)
                  </label>
                  <input type="text" value={rNota} maxLength={200}
                    onChange={e => setRNota(e.target.value)}
                    placeholder="Ej. urge para el fin de semana"
                    className="w-full px-4 py-3 bg-surface-container-low border border-outline-variant/20 rounded-xl text-sm font-body focus:outline-none focus:border-primary transition-colors" />
                </div>
              </div>

              <p className="text-[11px] font-body text-stone-500 leading-relaxed flex items-start gap-2">
                <Icon name="info" className="text-sm text-stone-400 flex-shrink-0 mt-0.5" />
                <span>Esto crea una solicitud. El de bodega la verá en la TC52, moverá las piezas y las registrará escaneando; el inventario cambia hasta entonces.</span>
              </p>

              {rError && (
                <div className={cn('rounded-xl p-4 space-y-1.5 border', rExistente ? 'bg-orange-50 border-orange-200' : 'bg-error/10 border-error/20')}>
                  <p className={cn('text-xs font-body font-bold', rExistente ? 'text-orange-800' : 'text-error')}>{rError}</p>
                  {rExistente && (
                    <>
                      <p className="text-xs font-body text-orange-800">
                        Ya hay una solicitud pendiente de <b>{rExistente.cantidad.toLocaleString('es-MX')} pzas</b> (#{rExistente.id})
                        {' '}· {rExistente.de_ubicacion} → {rExistente.a_ubicacion}
                        {rExistente.solicitado_por && ` · pidió: ${rExistente.solicitado_por}`}
                      </p>
                      {rExistente.nota && <p className="text-[11px] font-body text-orange-700 italic">“{rExistente.nota}”</p>}
                      <p className="text-[9px] font-label uppercase tracking-widest text-stone-500">Ver en Bodega → Resurtido</p>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="p-6 border-t border-outline-variant/10 flex gap-3 flex-shrink-0">
              <button onClick={closeResurtir} disabled={rSaving}
                className="flex-1 py-3 bg-surface-variant text-on-surface-variant rounded-xl text-xs font-label font-bold uppercase tracking-widest hover:bg-stone-200 transition-all disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={enviarResurtido} disabled={rSaving || !!rExistente || !rDestino || !rOrigen}
                className={cn(
                  'flex-1 py-3 rounded-xl text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-md',
                  (rSaving || !!rExistente || !rDestino || !rOrigen) ? 'bg-stone-200 text-stone-400 cursor-not-allowed' : 'bg-primary text-on-primary hover:bg-primary-container'
                )}>
                {rSaving
                  ? <div className="w-4 h-4 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />
                  : <Icon name="local_shipping" className="text-base" />}
                Solicitar resurtido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="flex justify-between items-end mb-8 gap-3 flex-wrap">
        <div>
          <h2 className="text-3xl font-serif italic text-primary">Inventario</h2>
          <p className="text-[10px] font-label uppercase tracking-widest text-stone-500 mt-1">
            {total.toLocaleString('es-MX')} {soloDescontinuados ? 'descontinuados' : soloConStock && !searchQuery && !sinPrecio ? 'con stock' : 'productos'} · {lowStockProducts.length} alertas
            {nDescontinuados > 0 && !soloDescontinuados && ` · ${nDescontinuados.toLocaleString('es-MX')} descontinuados`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) importarCategorias(f); if (e.target) e.target.value = ''; }} />
          <button onClick={exportarCategorias}
            title="Descargar todos los productos en Excel para asignar Categoría y Tipo"
            className="flex items-center gap-2 px-4 py-2 bg-surface-container-low border border-outline-variant/20 text-stone-600 rounded-lg text-[11px] font-label font-bold uppercase tracking-widest hover:text-primary hover:border-primary/40 transition-all">
            <Icon name="download" className="text-base" /> Exportar Excel
          </button>
          <button onClick={() => fileInputRef.current?.click()} disabled={importing}
            title="Subir el Excel con las categorías/tipos que asignaste"
            className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-label font-bold uppercase tracking-widest transition-all shadow-sm',
              importing ? 'bg-stone-200 text-stone-400 cursor-not-allowed' : 'bg-primary text-on-primary hover:bg-primary/90')}>
            {importing ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Icon name="upload" className="text-base" />}
            {importing ? 'Importando…' : 'Importar categorías'}
          </button>
        </div>
      </div>

      {/* Productos con stock en bodega que NO están dados de alta en NovaCaja */}
      <SinAltaNovacaja onAltaDone={() => { fetchProducts(page); onRefresh(); }} />

      {/* ── Table container ─────────────────────────────────────────────────── */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow-[0px_12px_32px_rgba(28,28,25,0.04)] overflow-hidden">

        {/* Toolbar */}
        <div className="p-4 sm:p-6 border-b border-surface-container bg-surface-container-low/30 space-y-3">
          {/* Fila 1: buscar + vista */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 min-w-0">
              <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-xl" />
              {loading && searchQuery && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
              )}
              <input
                type="text"
                placeholder="Buscar producto o código..."
                className="w-full pl-10 pr-10 py-2.5 bg-background border-none rounded-lg text-base sm:text-sm outline-none focus:ring-1 focus:ring-primary font-body"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex bg-background p-1 rounded-lg border border-outline-variant/10 shrink-0">
              <button onClick={() => setInventoryView('list')}
                className={cn('p-1.5 rounded-md transition-all', inventoryView === 'list' ? 'bg-surface shadow-sm text-primary' : 'text-stone-400')}>
                <Icon name="list" className="text-lg" />
              </button>
              <button onClick={() => setInventoryView('grid')}
                className={cn('p-1.5 rounded-md transition-all', inventoryView === 'grid' ? 'bg-surface shadow-sm text-primary' : 'text-stone-400')}>
                <Icon name="grid_view" className="text-lg" />
              </button>
            </div>
          </div>
          {/* Fila 2: filtros (envuelven sin encimarse) */}
          <div className="flex flex-wrap items-center gap-2">
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
              className="px-3 py-2 bg-background border-none rounded-lg text-sm outline-none focus:ring-1 focus:ring-primary font-body cursor-pointer min-w-[150px]">
              <option value="">Todas las categorías</option>
              {categories.map((c, i) => (<option key={`${c.id}-${i}`} value={String(c.name)}>{c.name}</option>))}
            </select>
            <select value={areaFilter} onChange={e => setAreaFilter(e.target.value)}
              className="px-3 py-2 bg-background border-none rounded-lg text-sm outline-none focus:ring-1 focus:ring-primary font-body cursor-pointer min-w-[140px]">
              <option value="">Todas las áreas</option>
              {areaOptions.map(a => (<option key={a.area} value={a.area}>{a.nombre}</option>))}
            </select>
            {catAsignadas.length > 0 && (
              <select value={miCatFilter} onChange={e => { setMiCatFilter(e.target.value); setPage(1); }}
                className="px-3 py-2 bg-background border-none rounded-lg text-sm outline-none focus:ring-1 focus:ring-primary font-body cursor-pointer min-w-[150px]">
                <option value="">Mi categoría (todas)</option>
                {catAsignadas.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            {tiposAsignados.length > 0 && (
              <select value={tipoFilter} onChange={e => { setTipoFilter(e.target.value); setPage(1); }}
                className="px-3 py-2 bg-background border-none rounded-lg text-sm outline-none focus:ring-1 focus:ring-primary font-body cursor-pointer min-w-[130px]">
                <option value="">Tipo (todos)</option>
                {tiposAsignados.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            <button onClick={() => { setSoloConStock(v => !v); setPage(1); }}
              title={soloDescontinuados
                ? 'Con el filtro de descontinuados se muestran todos, con o sin stock'
                : 'Con stock: solo productos con existencia (como la Bodega), de mayor a menor. Ver todos: catálogo completo.'}
              className={cn('px-3 py-2 rounded-lg text-[11px] font-label font-bold uppercase tracking-widest whitespace-nowrap transition-all border shrink-0 flex items-center gap-1.5',
                soloConStock ? 'bg-primary text-on-primary border-primary' : 'bg-background text-stone-500 border-outline-variant/20 hover:text-primary',
                soloDescontinuados && 'opacity-40')}>
              <Icon name={soloConStock ? 'inventory_2' : 'apps'} className="text-base" />
              {soloConStock ? 'Con stock' : 'Ver todos'}
            </button>
            <button onClick={() => { setSinPrecio(v => !v); setPage(1); }}
              title="Mostrar solo productos sin precio de venta registrado"
              className={cn('px-3 py-2 rounded-lg text-[11px] font-label font-bold uppercase tracking-widest whitespace-nowrap transition-all border shrink-0 flex items-center gap-1.5',
                sinPrecio ? 'bg-primary text-on-primary border-primary' : 'bg-background text-stone-500 border-outline-variant/20 hover:text-primary')}>
              <Icon name="price_change" className="text-base" />
              Sin precio
            </button>
            <button onClick={() => setSoloFaltantes(v => !v)}
              title="Mostrar solo productos por acabarse o agotados (según su mínimo)"
              className={cn('px-3 py-2 rounded-lg text-[11px] font-label font-bold uppercase tracking-widest whitespace-nowrap transition-all border shrink-0 flex items-center gap-1.5',
                soloFaltantes ? 'bg-orange-500 text-white border-orange-500' : 'bg-background text-stone-500 border-outline-variant/20 hover:text-orange-600')}>
              <Icon name="warning" className="text-base" />
              Solo faltantes
            </button>
            <button onClick={() => { setSoloDescontinuados(v => !v); setPage(1); }}
              title="Mostrar solo los productos que el dueño marcó como descontinuados (ya no se resurten). No es lo mismo que llevar tiempo sin venderse."
              className={cn('px-3 py-2 rounded-lg text-[11px] font-label font-bold uppercase tracking-widest whitespace-nowrap transition-all border shrink-0 flex items-center gap-1.5',
                soloDescontinuados ? 'bg-stone-900 text-white border-stone-900' : 'bg-background text-stone-500 border-outline-variant/20 hover:text-stone-900')}>
              <Icon name="block" className="text-base" />
              Descontinuados{nDescontinuados > 0 && ` · ${nDescontinuados.toLocaleString('es-MX')}`}
            </button>
          </div>
        </div>

        {/* ── List view ─────────────────────────────────────────────────────── */}
        {inventoryView === 'list' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container">
                <tr>
                  <th className="px-3 sm:px-6 py-3 sm:py-4">Producto</th>
                  <th className="px-2 sm:px-6 py-3 sm:py-4 text-center">Stock</th>
                  <th className="px-2 sm:px-6 py-3 sm:py-4">Precio</th>
                  <th className="px-3 sm:px-6 py-3 sm:py-4 hidden sm:table-cell">Estado</th>
                  <th className="px-3 sm:px-6 py-3 sm:py-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {displayed.map((p, i) => (
                  <tr key={`${p.id}-${i}`} className="hover:bg-background transition-colors group">
                    <td className="px-3 sm:px-6 py-3 sm:py-4">
                      <div className="flex items-center gap-2 sm:gap-4">
                        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-background flex items-center justify-center overflow-hidden border border-outline-variant/10 flex-shrink-0">
                          {p.image
                            ? <img src={p.image} className="w-full h-full object-cover" alt={p.name} />
                            : <Icon name="image" className="text-stone-300" />}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-on-surface font-body text-sm truncate max-w-[150px] sm:max-w-[280px]">{p.name}</p>
                          <p className="text-[10px] text-stone-400 font-label tracking-widest uppercase mt-0.5 flex items-center gap-1.5 flex-wrap">
                            <span>{p.category || 'Sin categoría'}</span>
                            {p.tipo && <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-bold normal-case tracking-normal">{p.tipo}</span>}
                          </p>
                          {p.descontinuado && p.descontinuadoDesde && (
                            <span className="mt-1 inline-flex items-center gap-1 text-[9px] font-label font-bold px-2 py-0.5 rounded-full bg-stone-200 text-stone-700 uppercase tracking-wider">
                              <Icon name="block" className="text-[10px]" /> Descontinuado desde {fmtFechaCorta(p.descontinuadoDesde)}
                            </span>
                          )}
                          {(() => {
                            const locs = ubicMap.get(String(p.id));
                            if (!locs || locs.length === 0) return null;
                            return (
                              <div className="flex flex-wrap items-center gap-1 mt-1">
                                {locs.map(l => (
                                  <span key={l.area}
                                    style={{ backgroundColor: `${areaColor(l.area)}18`, color: areaColor(l.area), borderColor: `${areaColor(l.area)}55` }}
                                    className="text-[10px] font-label font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border inline-flex items-center gap-1">
                                    <Icon name="place" className="text-[10px]" />{areaName(l.area)}: {l.cantidad}
                                  </span>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </td>

                    <td className="px-2 sm:px-6 py-3 sm:py-4 text-center">
                      {inlineId === String(p.id) ? (
                        <div className="flex items-center gap-1 justify-center">
                          <input type="number" min="0" step="1" value={inlineVal}
                            onChange={e => setInlineVal(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter')  saveInlineStock(String(p.id));
                              if (e.key === 'Escape') setInlineId(null);
                            }}
                            autoFocus
                            className="w-20 text-center py-1.5 px-2 bg-surface-container-low border border-primary/40 rounded-lg font-serif text-base outline-none focus:border-primary" />
                          <button onClick={() => saveInlineStock(String(p.id))}
                            className="p-1.5 text-primary hover:bg-primary/10 rounded-md transition-colors">
                            <Icon name="check" className="text-base" />
                          </button>
                          <button onClick={() => setInlineId(null)}
                            className="p-1.5 text-stone-400 hover:bg-stone-100 rounded-md transition-colors">
                            <Icon name="close" className="text-base" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setInlineId(String(p.id)); setInlineVal(String(p.stock)); }}
                          className="group/s flex flex-col items-center hover:bg-primary/5 rounded-lg px-3 py-1 transition-colors w-full"
                          title="Clic para editar stock">
                          <span className={cn('font-serif text-xl font-bold', stockColor(p.stock, p.minStock))}>
                            {p.stock}
                          </span>
                          <span className={cn('text-[9px] font-label flex items-center gap-1',
                            p.stock <= 0 ? 'text-stone-400' : p.stock <= p.minStock ? 'text-orange-600 font-bold' : 'text-stone-400')}>
                            {p.stock <= 0 ? 'agotado' : p.stock <= p.minStock ? 'bajo' : 'uds'} <Icon name="edit" className="text-[9px] opacity-0 group-hover/s:opacity-60 transition-opacity" />
                          </span>
                        </button>
                      )}
                    </td>

                    <td className="px-2 sm:px-6 py-3 sm:py-4">
                      <p className="text-sm font-bold text-primary font-body whitespace-nowrap">${Number(p.salePrice).toFixed(2)}</p>
                      <p className="text-[10px] text-stone-400 font-label whitespace-nowrap">Costo: ${Number(p.costPrice).toFixed(2)}</p>
                    </td>

                    <td className="px-3 sm:px-6 py-3 sm:py-4 hidden sm:table-cell">
                      <span className={cn(
                        'px-3 py-1 rounded-full text-[10px] font-label font-bold uppercase tracking-widest whitespace-nowrap',
                        stockBadgeClass(p)
                      )}>
                        {stockLabel(p)}
                      </span>
                    </td>

                    <td className="px-3 sm:px-6 py-3 sm:py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openResurtir(p)}
                          aria-disabled={!!p.descontinuado}
                          className={cn('p-2 rounded-lg transition-all opacity-100 sm:opacity-0 sm:group-hover:opacity-100',
                            p.descontinuado ? 'text-stone-300 cursor-not-allowed' : 'text-primary hover:bg-primary-fixed/20')}
                          title={p.descontinuado ? 'Producto descontinuado: no se resurte' : 'Solicitar resurtido (lo ejecuta bodega con la TC52)'}>
                          <Icon name="local_shipping" className="text-lg" />
                        </button>
                        <button onClick={() => openPanel(p)}
                          className="p-2 hover:bg-primary-fixed/20 rounded-lg text-primary transition-all opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                          title="Editar producto">
                          <Icon name="edit" className="text-lg" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {displayed.map((p, i) => (
              <div key={`${p.id}-${i}`} className="group bg-surface-container-low/30 rounded-xl p-4 hover:shadow-xl transition-all border border-transparent hover:border-outline-variant/20">
                <div className="aspect-square bg-background rounded-lg mb-4 overflow-hidden relative border border-outline-variant/10">
                  {p.image
                    ? <img src={p.image} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" alt={p.name} />
                    : <div className="w-full h-full flex items-center justify-center"><Icon name="image" className="text-stone-200 text-4xl" /></div>}
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    <button onClick={() => openResurtir(p)}
                      aria-disabled={!!p.descontinuado}
                      className={cn('p-2 bg-surface rounded-lg shadow-sm transition-all',
                        p.descontinuado ? 'text-stone-300 cursor-not-allowed' : 'text-primary hover:bg-primary hover:text-on-primary')}
                      title={p.descontinuado ? 'Producto descontinuado: no se resurte' : 'Solicitar resurtido (lo ejecuta bodega con la TC52)'}>
                      <Icon name="local_shipping" className="text-sm" />
                    </button>
                    <button onClick={() => openPanel(p)}
                      className="p-2 bg-surface rounded-lg text-primary shadow-sm hover:bg-primary hover:text-on-primary transition-all"
                      title="Editar producto">
                      <Icon name="edit" className="text-sm" />
                    </button>
                  </div>
                </div>
                <p className="text-[9px] font-label font-bold text-primary uppercase tracking-[0.2em] flex items-center gap-1.5 flex-wrap">
                  <span>{p.category || 'General'}</span>
                  {p.tipo && <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary normal-case tracking-normal">{p.tipo}</span>}
                </p>
                <h4 className="font-serif text-base text-on-surface line-clamp-2 mt-1">{p.name}</h4>
                {p.descontinuado && p.descontinuadoDesde && (
                  <span className="mt-1 inline-flex items-center gap-1 text-[9px] font-label font-bold px-2 py-0.5 rounded-full bg-stone-200 text-stone-700 uppercase tracking-wider">
                    <Icon name="block" className="text-[10px]" /> Descontinuado desde {fmtFechaCorta(p.descontinuadoDesde)}
                  </span>
                )}
                <div className="flex justify-between items-end mt-4">
                  <div>
                    <p className="text-[10px] font-label text-stone-500 uppercase">Stock</p>
                    <p className={cn('text-xl font-serif font-bold', stockColor(p.stock, p.minStock))}>{p.stock}</p>
                    {p.descontinuado ? (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-stone-900 text-white text-[9px] font-label font-bold uppercase tracking-wider mt-0.5">
                        {stockLabel(p)}
                      </span>
                    ) : (
                      <p className={cn('text-[9px] font-label font-bold uppercase tracking-wider mt-0.5',
                        p.stock <= 0 ? 'text-stone-400' : p.stock <= p.minStock ? 'text-orange-600' : 'text-emerald-600')}>
                        {stockLabel(p)}
                      </p>
                    )}
                  </div>
                  <p className="text-xl font-serif text-primary">${Number(p.salePrice).toFixed(2)}</p>
                </div>
                {(() => {
                  const locs = ubicMap.get(String(p.id));
                  if (!locs || locs.length === 0) return null;
                  return (
                    <div className="flex flex-wrap items-center gap-1 mt-3 pt-3 border-t border-outline-variant/10">
                      {locs.map(l => (
                        <span key={l.area}
                          style={{ backgroundColor: `${areaColor(l.area)}18`, color: areaColor(l.area), borderColor: `${areaColor(l.area)}55` }}
                          className="text-[10px] font-label font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border inline-flex items-center gap-1">
                          <Icon name="place" className="text-[10px]" />{areaName(l.area)}: {l.cantidad}
                        </span>
                      ))}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        )}

        {/* Empty / loading state */}
        {displayed.length === 0 && (
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

        {/* ── Footer: count + pagination ───────────────────────────────────── */}
        <div className="px-6 py-3 border-t border-surface-container bg-surface-container-low/30 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-[10px] font-label text-stone-400 uppercase tracking-widest">
            {(areaFilter || soloFaltantes)
              ? `${displayed.length} en esta página${soloFaltantes ? ' con faltante' : ''} · ${total.toLocaleString('es-MX')} total`
              : `Mostrando ${((page - 1) * PAGE_SIZE + 1).toLocaleString('es-MX')}–${Math.min(page * PAGE_SIZE, total).toLocaleString('es-MX')} de ${total.toLocaleString('es-MX')}`}
            {lowStockProducts.length > 0 && (
              <span className="ml-2 text-error font-bold">· {lowStockProducts.length} bajo stock</span>
            )}
          </p>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
                className="p-1.5 rounded-lg hover:bg-surface-container disabled:opacity-30 transition-all">
                <Icon name="chevron_left" className="text-lg text-stone-500" />
              </button>
              <span className="text-[10px] font-label text-stone-500 uppercase tracking-widest min-w-[80px] text-center">
                Pág. {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages || loading}
                className="p-1.5 rounded-lg hover:bg-surface-container disabled:opacity-30 transition-all">
                <Icon name="chevron_right" className="text-lg text-stone-500" />
              </button>
            </div>
          )}

          <p className="text-[9px] font-label text-stone-300 uppercase tracking-widest hidden md:block">
            Clic en stock para editar · lápiz para más opciones · camión para solicitar resurtido
          </p>
        </div>
      </div>
    </section>
  );
}
