'use client';

// ── Página web ─────────────────────────────────────────────────────────────────
// Muestra qué productos del inventario están en la tienda en línea (Shopify) y
// qué les falta para verse bien (foto, precio, publicar), con edición directa:
// subir fotos, corregir título/descripción/precio y publicar borradores.
// También lista los productos CON stock en bodega que aún no existen en la
// página, con botón para crearlos como borrador.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '../lib/utils';
import { Icon } from '../components/Icon';

const PAGE_SIZE = 50;

interface Resumen {
  total: number; activos: number; borradores: number; archivados: number;
  sin_foto: number; sin_precio: number; sin_codigo: number;
  con_stock_bodega: number; falta_pagina: number; actualizado: string;
}
interface ProdWeb {
  id: number; title: string; handle: string; status: string;
  image: string | null; price: number | null; barcode: string | null;
  variantId: number | null; qtyShopify: number | null; variantes: number;
  stock_bodega: number | null; faltantes: string[];
}
interface Candidato { codigo: string; nombre: string; stock: number; precio: number | null }
interface DetalleImg { id: number; src: string }
interface Detalle {
  id: number; title: string; status: string; handle: string; descripcion: string;
  imagenes: DetalleImg[];
  variantes: { id: number; option1: string; price: string; barcode: string | null; qty: number | null }[];
}

const ETIQUETA_FALTANTE: Record<string, { texto: string; clase: string }> = {
  sin_foto:          { texto: 'Sin foto',    clase: 'bg-amber-100 text-amber-800' },
  sin_precio:        { texto: 'Sin precio',  clase: 'bg-error/10 text-error' },
  sin_codigo:        { texto: 'Sin código',  clase: 'bg-stone-200 text-stone-600' },
  borrador:          { texto: 'Borrador',    clase: 'bg-blue-100 text-blue-800' },
  archivado:         { texto: 'Archivado',   clase: 'bg-stone-200 text-stone-500' },
  sin_conteo_bodega: { texto: 'Sin conteo',  clase: 'bg-purple-100 text-purple-700' },
};

const CHIP_STATUS: Record<string, string> = {
  active:   'bg-emerald-100 text-emerald-800',
  draft:    'bg-blue-100 text-blue-800',
  archived: 'bg-stone-200 text-stone-500',
};
const TXT_STATUS: Record<string, string> = { active: 'Publicado', draft: 'Borrador', archived: 'Archivado' };

export default function PaginaWebTab() {
  const [resumen,  setResumen]  = useState<Resumen | null>(null);
  const [vista,    setVista]    = useState<'en_pagina' | 'falta_pagina'>('en_pagina');
  const [productos, setProductos] = useState<ProdWeb[]>([]);
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [total,    setTotal]    = useState(0);
  const [page,     setPage]     = useState(1);
  const [buscar,   setBuscar]   = useState('');
  const [filtro,   setFiltro]   = useState('');
  const [loading,  setLoading]  = useState(true);
  const [creando,  setCreando]  = useState<string | null>(null);
  const [errorApi, setErrorApi] = useState<string | null>(null);

  // Panel lateral de edición
  const [panel,    setPanel]    = useState<Detalle | null>(null);
  const [panelProd, setPanelProd] = useState<ProdWeb | null>(null);
  const [pTitle,   setPTitle]   = useState('');
  const [pDesc,    setPDesc]    = useState('');
  const [pPrecio,  setPPrecio]  = useState('');
  // Originales al abrir: solo mandamos al guardar lo que el usuario SÍ cambió
  // (crítico en descripción: reenviarla siempre destruiría el HTML original)
  const [orig, setOrig] = useState<{ title: string; desc: string; precio: string }>({ title: '', desc: '', precio: '' });
  const [saving,   setSaving]   = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [cargandoPanel, setCargandoPanel] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [notif, setNotif] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 3000);
  };

  // Refs espejo para que los callbacks no dependan del estado (patrón del panel)
  const buscarRef = useRef(buscar); buscarRef.current = buscar;
  const filtroRef = useRef(filtro); filtroRef.current = filtro;
  const vistaRef  = useRef(vista);  vistaRef.current  = vista;

  const fetchResumen = useCallback(async () => {
    try {
      const res = await fetch('/api/shopify-web/resumen');
      const data = await res.json();
      if (!res.ok || data.error) { setErrorApi(data.error || 'Error al cargar el resumen'); return; }
      setErrorApi(null);
      setResumen(data);
    } catch { setErrorApi('Error de conexión con la API'); }
  }, []);

  const fetchProductos = useCallback(async (pg: number) => {
    // Fija la vista AL LANZAR el request: si el usuario cambia de vista antes
    // de que responda, la respuesta vieja se descarta (no aterriza en la lista
    // equivocada).
    const vistaPedida = vistaRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        vista: vistaPedida,
        buscar: buscarRef.current,
        filtro: filtroRef.current,
        pagina: String(pg),
        porPagina: String(PAGE_SIZE),
      });
      const res = await fetch(`/api/shopify-web/productos?${params}`);
      const data = await res.json();
      if (vistaPedida !== vistaRef.current) return; // respuesta obsoleta
      if (!res.ok || data.error) { notify(data.error || 'Error al cargar productos', 'error'); return; }
      if (vistaPedida === 'falta_pagina') setCandidatos(data.productos ?? []);
      else setProductos(data.productos ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      notify('Error de conexión con la API', 'error');
      console.error(e);
    } finally { if (vistaPedida === vistaRef.current) setLoading(false); }
  }, []);

  useEffect(() => { fetchResumen(); fetchProductos(1); }, [fetchResumen, fetchProductos]);

  // Debounce al buscar/filtrar/cambiar vista. loading se prende DESDE YA para
  // no mostrar un "sin productos" fantasma durante los 300 ms de espera.
  const primerRender = useRef(true);
  useEffect(() => {
    if (primerRender.current) { primerRender.current = false; return; }
    setLoading(true);
    const t = setTimeout(() => { setPage(1); fetchProductos(1); }, 300);
    return () => clearTimeout(t);
  }, [buscar, filtro, vista, fetchProductos]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const irPagina = (pg: number) => { setPage(pg); fetchProductos(pg); };

  // ── Panel de edición ─────────────────────────────────────────────────────────
  const abrirPanel = async (p: ProdWeb) => {
    setPanelProd(p);
    setCargandoPanel(true);
    setPanel(null);
    try {
      const res = await fetch(`/api/shopify-web/producto/${p.id}`);
      const data = await res.json();
      if (!res.ok || data.error) { notify(data.error || 'No se pudo abrir el producto', 'error'); setPanelProd(null); return; }
      setPanel(data);
      const descPlana = data.descripcion.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const precioIni = data.variantes[0]?.price ?? '';
      setPTitle(data.title);
      setPDesc(descPlana);
      setPPrecio(precioIni);
      setOrig({ title: data.title, desc: descPlana, precio: precioIni });
    } catch { notify('Error de conexión con la API', 'error'); setPanelProd(null); }
    finally { setCargandoPanel(false); }
  };
  const cerrarPanel = () => { setPanel(null); setPanelProd(null); };

  const guardarPanel = async (nuevoStatus?: string) => {
    if (!panel) return;
    // Solo mandamos lo que el usuario CAMBIÓ. En especial la descripción: aquí
    // se edita como texto plano, así que reenviarla sin cambios destruiría el
    // formato HTML original que el producto tenga en Shopify.
    const body: Record<string, unknown> = {};
    if (pTitle !== orig.title) body.title = pTitle;
    if (pDesc !== orig.desc) body.descripcion = pDesc ? `<p>${pDesc}</p>` : '';
    if (pPrecio !== orig.precio && pPrecio !== '') {
      body.precio = pPrecio;
      body.variantId = panel.variantes[0]?.id ?? null;
    }
    if (nuevoStatus) body.status = nuevoStatus;
    if (Object.keys(body).length === 0) { cerrarPanel(); return; } // nada que guardar
    setSaving(true);
    try {
      const res = await fetch(`/api/shopify-web/producto/${panel.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && !data.error) {
        notify(nuevoStatus === 'active' ? '¡Publicado en la página!' : 'Guardado');
        cerrarPanel();
        fetchResumen();
        fetchProductos(page);
      } else notify(data.error || 'Error al guardar', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setSaving(false); }
  };

  const subirFoto = async (file: File) => {
    if (!panel) return;
    setSubiendo(true);
    try {
      const params = new URLSearchParams({ filename: file.name, barcode: panelProd?.barcode || '' });
      const res = await fetch(`/api/shopify-web/producto/${panel.id}/foto?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const data = await res.json();
      if (res.ok && !data.error) {
        notify('Foto subida');
        if (data.imagen && data.imagen.id) setPanel({ ...panel, imagenes: [...panel.imagenes, data.imagen] });
        fetchResumen();
      } else notify(data.error || 'Error al subir la foto', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setSubiendo(false); }
  };

  const borrarFoto = async (img: DetalleImg) => {
    if (!panel) return;
    if (!window.confirm('¿Eliminar esta foto de la página? No se puede deshacer.')) return;
    try {
      const res = await fetch(`/api/shopify-web/producto/${panel.id}/foto/${img.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && !data.error) {
        setPanel({ ...panel, imagenes: panel.imagenes.filter(i => i.id !== img.id) });
        notify('Foto eliminada');
      } else notify(data.error || 'No se pudo eliminar', 'error');
    } catch { notify('Error de conexión', 'error'); }
  };

  const crearEnShopify = async (c: Candidato) => {
    setCreando(c.codigo);
    try {
      const res = await fetch('/api/shopify-web/crear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: c.codigo }),
      });
      const data = await res.json();
      if (res.ok && !data.error) {
        notify(`Creado como borrador: ${data.title}`);
        setCandidatos(prev => prev.filter(x => x.codigo !== c.codigo));
        fetchResumen();
        // Abre de una vez el editor del producto recién creado para ponerle
        // foto y revisar precio (si no, la dueña lo pierde de vista).
        abrirPanel({
          id: data.id, title: data.title, handle: '', status: 'draft',
          image: null, price: c.precio, barcode: c.codigo, variantId: null,
          qtyShopify: c.stock, variantes: 1, stock_bodega: c.stock, faltantes: ['borrador', 'sin_foto'],
        });
      } else notify(data.error || 'Error al crear', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setCreando(null); }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  const money = (v: number | string | null) =>
    v == null || v === '' || Number(v) === 0 ? '—' : `$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;

  const kpis: { label: string; valor: number | string; icon: string; onClick?: () => void; activo?: boolean }[] = resumen ? [
    { label: 'En la página',   valor: resumen.activos,      icon: 'storefront', onClick: () => { setVista('en_pagina'); setFiltro(''); }, activo: vista === 'en_pagina' && !filtro },
    { label: 'Borradores',     valor: resumen.borradores,   icon: 'edit_note',  onClick: () => { setVista('en_pagina'); setFiltro('borrador'); }, activo: filtro === 'borrador' },
    { label: 'Sin foto',       valor: resumen.sin_foto,     icon: 'no_photography', onClick: () => { setVista('en_pagina'); setFiltro('sin_foto'); }, activo: filtro === 'sin_foto' },
    { label: 'Sin precio',     valor: resumen.sin_precio,   icon: 'money_off',  onClick: () => { setVista('en_pagina'); setFiltro('sin_precio'); }, activo: filtro === 'sin_precio' },
    { label: 'Con stock aquí', valor: resumen.con_stock_bodega, icon: 'warehouse' },
    { label: 'Faltan en página', valor: resumen.falta_pagina, icon: 'add_business', onClick: () => { setVista('falta_pagina'); setFiltro(''); }, activo: vista === 'falta_pagina' },
  ] : [];

  return (
    <section className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
      {notif && (
        <div className={cn('fixed top-6 right-6 z-[300] px-5 py-3 rounded-xl shadow-xl flex items-center gap-2 font-label text-sm',
          notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error')}>
          <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
          {notif.msg}
        </div>
      )}

      {errorApi && (
        <div className="mb-6 p-4 bg-error/10 text-error rounded-xl flex items-center gap-3">
          <Icon name="cloud_off" className="text-2xl" />
          <div>
            <p className="font-label text-sm font-bold uppercase tracking-widest">Sin conexión con Shopify</p>
            <p className="text-sm">{errorApi}</p>
          </div>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {kpis.map(k => (
          <button key={k.label} onClick={k.onClick} disabled={!k.onClick}
            className={cn('bg-surface-container-lowest rounded-xl border p-4 text-left transition-all',
              k.activo ? 'border-primary shadow-md' : 'border-outline-variant/10 shadow',
              k.onClick ? 'hover:border-primary/40 cursor-pointer' : 'cursor-default')}>
            <Icon name={k.icon} className={cn('text-xl mb-2', k.activo ? 'text-primary' : 'text-stone-400')} />
            <p className="text-2xl font-bold text-on-surface leading-none">{k.valor}</p>
            <p className="font-label text-[10px] uppercase tracking-widest text-stone-500 mt-1">{k.label}</p>
          </button>
        ))}
      </div>

      {/* Barra de búsqueda + filtros */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1 relative">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-xl" />
          <input value={buscar} onChange={e => setBuscar(e.target.value)}
            placeholder={vista === 'falta_pagina' ? 'Buscar por nombre o código...' : 'Buscar producto o código de barras...'}
            className="w-full pl-10 pr-4 py-2.5 bg-background border border-outline-variant/20 rounded-xl outline-none focus:ring-1 focus:ring-primary font-body text-sm" />
        </div>
        {vista === 'en_pagina' && (
          <select value={filtro} onChange={e => setFiltro(e.target.value)}
            className="px-3 py-2.5 bg-background border border-outline-variant/20 rounded-xl outline-none focus:ring-1 focus:ring-primary font-body text-sm">
            <option value="">Todos</option>
            <option value="sin_foto">Sin foto</option>
            <option value="sin_precio">Sin precio</option>
            <option value="borrador">Borradores</option>
            <option value="archivado">Archivados</option>
            <option value="sin_conteo_bodega">Sin conteo en bodega</option>
            <option value="completos">Completos (listos)</option>
          </select>
        )}
        <div className="flex bg-surface-container-low rounded-xl p-1 border border-outline-variant/10">
          {([['en_pagina', 'En la página'], ['falta_pagina', 'Faltan']] as const).map(([v, l]) => (
            <button key={v} onClick={() => { setVista(v); setFiltro(''); }}
              className={cn('px-4 py-1.5 rounded-lg text-[10px] font-label font-bold uppercase tracking-widest transition-all',
                vista === v ? 'bg-surface text-primary shadow-sm' : 'text-stone-400 hover:text-stone-600')}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow overflow-hidden">
        {loading ? (
          <div className="py-20 flex flex-col items-center">
            <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-3" />
            <p className="font-serif italic text-primary">Cargando...</p>
          </div>
        ) : vista === 'en_pagina' ? (
          productos.length === 0 ? (
            <div className="py-20 flex flex-col items-center text-stone-300">
              <Icon name="storefront" className="text-6xl opacity-20 mb-3" />
              <p className="text-sm font-label uppercase tracking-widest">Sin productos</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase text-[10px] tracking-widest">
                  <tr>
                    <th className="px-4 py-3 text-left">Producto</th>
                    <th className="px-4 py-3 text-left hidden sm:table-cell">Estado</th>
                    <th className="px-4 py-3 text-right">Precio</th>
                    <th className="px-4 py-3 text-right hidden sm:table-cell">Stock aquí</th>
                    <th className="px-4 py-3 text-right hidden lg:table-cell">Stock web</th>
                    <th className="px-4 py-3 text-left hidden md:table-cell">Le falta</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {productos.map(p => (
                    <tr key={p.id} onClick={() => abrirPanel(p)} className="hover:bg-surface-container-low/40 cursor-pointer">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3 min-w-0">
                          {p.image ? (
                            <img src={p.image} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-outline-variant/10"
                              onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-surface-container-low flex items-center justify-center flex-shrink-0">
                              <Icon name="image" className="text-stone-300 text-xl" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-on-surface truncate max-w-[220px] sm:max-w-xs">{p.title}</p>
                            <p className="text-[11px] text-stone-400 font-mono">{p.barcode || 'sin código'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 hidden sm:table-cell">
                        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-label font-bold uppercase tracking-wide', CHIP_STATUS[p.status] || 'bg-stone-100 text-stone-500')}>
                          {TXT_STATUS[p.status] || p.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">{money(p.price)}</td>
                      <td className="px-4 py-2.5 text-right hidden sm:table-cell">
                        {p.stock_bodega == null ? <span className="text-stone-300">—</span> : p.stock_bodega}
                      </td>
                      <td className="px-4 py-2.5 text-right hidden lg:table-cell">
                        {p.qtyShopify == null ? <span className="text-stone-300">—</span> : p.qtyShopify}
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {p.faltantes.length === 0 ? (
                            <span className="text-emerald-600 flex items-center gap-1 text-[11px]"><Icon name="check_circle" className="text-sm" />Listo</span>
                          ) : p.faltantes.map(f => (
                            <span key={f} className={cn('px-2 py-0.5 rounded-full text-[10px] font-label', (ETIQUETA_FALTANTE[f] || { clase: 'bg-stone-100 text-stone-500' }).clase)}>
                              {(ETIQUETA_FALTANTE[f] || { texto: f }).texto}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-right"><Icon name="chevron_right" className="text-stone-300" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          candidatos.length === 0 ? (
            <div className="py-20 flex flex-col items-center text-stone-300">
              <Icon name="task_alt" className="text-6xl opacity-20 mb-3" />
              <p className="text-sm font-label uppercase tracking-widest">Todo lo que tiene stock ya está en la página</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase text-[10px] tracking-widest">
                  <tr>
                    <th className="px-4 py-3 text-left">Producto del inventario</th>
                    <th className="px-4 py-3 text-right">Stock</th>
                    <th className="px-4 py-3 text-right hidden sm:table-cell">Precio venta</th>
                    <th className="px-4 py-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {candidatos.map(c => (
                    <tr key={c.codigo} className="hover:bg-surface-container-low/40">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-on-surface">{c.nombre || '(sin nombre)'}</p>
                        <p className="text-[11px] text-stone-400 font-mono">{c.codigo}</p>
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">{c.stock}</td>
                      <td className="px-4 py-2.5 text-right hidden sm:table-cell">{money(c.precio)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button onClick={() => crearEnShopify(c)} disabled={creando === c.codigo}
                          className={cn('px-3 py-1.5 rounded-lg font-label text-[10px] font-bold uppercase tracking-widest inline-flex items-center gap-1.5',
                            creando === c.codigo ? 'bg-stone-200 text-stone-400 cursor-not-allowed' : 'bg-primary text-on-primary hover:opacity-90')}>
                          {creando === c.codigo ? (
                            <span className="w-3 h-3 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />
                          ) : (
                            <Icon name="add_business" className="text-sm" />
                          )}
                          Crear en la página
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Paginación */}
        {!loading && total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-outline-variant/10">
            <p className="text-[11px] text-stone-400 font-label uppercase tracking-widest">{total} productos</p>
            <div className="flex items-center gap-2">
              <button onClick={() => irPagina(Math.max(1, page - 1))} disabled={page <= 1}
                className={cn('p-1.5 rounded-lg', page <= 1 ? 'text-stone-300' : 'text-primary hover:bg-stone-100')}>
                <Icon name="chevron_left" className="text-xl" />
              </button>
              <span className="text-sm font-medium">{page} / {totalPages}</span>
              <button onClick={() => irPagina(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
                className={cn('p-1.5 rounded-lg', page >= totalPages ? 'text-stone-300' : 'text-primary hover:bg-stone-100')}>
                <Icon name="chevron_right" className="text-xl" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Drawer de edición ──────────────────────────────────────────────────── */}
      {panelProd && (
        <>
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[200]" onClick={cerrarPanel} />
          <div className="fixed right-0 top-0 h-full w-full sm:w-[420px] bg-surface z-[201] flex flex-col shadow-2xl">
            <div className="flex-shrink-0 px-6 py-4 border-b border-outline-variant/10 flex items-center justify-between">
              <div className="min-w-0">
                <p className="font-label text-[10px] uppercase tracking-widest text-stone-400">Producto en la página</p>
                <h3 className="font-serif italic text-primary text-lg truncate">{panelProd.title}</h3>
              </div>
              <button onClick={cerrarPanel} className="p-2 hover:bg-stone-100 rounded-full flex-shrink-0">
                <Icon name="close" className="text-xl text-stone-500" />
              </button>
            </div>

            {cargandoPanel || !panel ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {/* Fotos */}
                  <div>
                    <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-2">Fotos</p>
                    <div className="grid grid-cols-3 gap-2">
                      {panel.imagenes.map(img => (
                        <div key={img.id} className="relative group aspect-square">
                          <img src={img.src} alt="" className="w-full h-full object-cover rounded-lg border border-outline-variant/10" />
                          <button onClick={() => borrarFoto(img)}
                            className="absolute top-1 right-1 p-1 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                            <Icon name="delete" className="text-sm" />
                          </button>
                        </div>
                      ))}
                      <button onClick={() => fileRef.current?.click()} disabled={subiendo}
                        className="aspect-square rounded-lg border-2 border-dashed border-outline-variant/30 flex flex-col items-center justify-center text-stone-400 hover:border-primary hover:text-primary transition-colors">
                        {subiendo ? (
                          <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                        ) : (
                          <>
                            <Icon name="add_a_photo" className="text-2xl" />
                            <span className="text-[9px] font-label uppercase tracking-widest mt-1">Subir</span>
                          </>
                        )}
                      </button>
                    </div>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) subirFoto(f); if (e.target) e.target.value = ''; }} />
                    <p className="text-[10px] text-stone-400 mt-2">Desde el teléfono puedes tomar la foto directo con la cámara.</p>
                  </div>

                  {/* Título */}
                  <div>
                    <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-1">Nombre en la página</p>
                    <input value={pTitle} onChange={e => setPTitle(e.target.value)}
                      className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant/20 rounded-xl focus:border-primary outline-none font-body text-sm" />
                  </div>

                  {/* Precio */}
                  <div>
                    <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-1">Precio de venta</p>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">$</span>
                      <input value={pPrecio} onChange={e => setPPrecio(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal"
                        className="w-full pl-7 pr-3 py-2 bg-surface-container-low border border-outline-variant/20 rounded-xl focus:border-primary outline-none font-body text-sm" />
                    </div>
                  </div>

                  {/* Descripción */}
                  <div>
                    <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-1">Descripción</p>
                    <textarea value={pDesc} onChange={e => setPDesc(e.target.value)} rows={4}
                      className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant/20 rounded-xl focus:border-primary outline-none font-body text-sm resize-none" />
                  </div>

                  {/* Datos de referencia */}
                  <div className="bg-surface-container-low/60 rounded-xl p-4 space-y-1.5 text-sm">
                    <div className="flex justify-between"><span className="text-stone-500">Código de barras</span><span className="font-mono text-xs">{panelProd.barcode || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-stone-500">Stock en tienda</span><span>{panelProd.stock_bodega ?? '—'}</span></div>
                    <div className="flex justify-between"><span className="text-stone-500">Stock en la web</span><span>{panelProd.qtyShopify ?? '—'}</span></div>
                    <div className="flex justify-between"><span className="text-stone-500">Estado</span>
                      <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-label font-bold uppercase', CHIP_STATUS[panel.status])}>{TXT_STATUS[panel.status] || panel.status}</span>
                    </div>
                  </div>
                </div>

                <div className="flex-shrink-0 p-4 border-t border-outline-variant/10 space-y-2">
                  {panel.status !== 'active' && (
                    <button onClick={() => guardarPanel('active')} disabled={saving}
                      className={cn('w-full py-2.5 rounded-xl font-label text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2',
                        saving ? 'bg-stone-200 text-stone-400 cursor-not-allowed' : 'bg-emerald-600 text-white hover:opacity-90')}>
                      <Icon name="publish" className="text-base" /> Guardar y publicar
                    </button>
                  )}
                  <div className="flex gap-2">
                    <button onClick={cerrarPanel}
                      className="flex-1 py-2.5 rounded-xl font-label text-xs font-bold uppercase tracking-widest bg-surface-container-low text-stone-500 hover:bg-stone-200">
                      Cancelar
                    </button>
                    <button onClick={() => guardarPanel()} disabled={saving}
                      className={cn('flex-1 py-2.5 rounded-xl font-label text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2',
                        saving ? 'bg-stone-200 text-stone-400 cursor-not-allowed' : 'bg-primary text-on-primary hover:opacity-90')}>
                      {saving && <span className="w-3.5 h-3.5 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />}
                      Guardar
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
