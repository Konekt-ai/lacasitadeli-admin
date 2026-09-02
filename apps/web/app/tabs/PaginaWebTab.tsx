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

// ── Fotos, áreas y "¿por qué no muestra stock?" ──────────────────────────────
interface FotosEstado {
  con_foto: number; ultima_sync: string | null; ultimo_resumen: string | null;
  corriendo: boolean; cada_horas: number;
}
interface AreaTC52 { nombre: string; color?: string | null; orden?: number | null }
interface SinSeguimiento { codigo_barras: string; motivo_bloqueo: string | null }
interface SyncEstado {
  activo: boolean; areas: string[]; areas_env: string[];
  sin_seguimiento: number; sin_seguimiento_lista: SinSeguimiento[]; ultimo_resumen: string | null;
}
interface UbicacionDiag { ubicacion: string; cantidad: number }
interface Diagnostico {
  causa: 'sin_codigo' | 'no_contado' | 'area_no_incluida' | 'sin_seguimiento' | 'ok';
  titulo: string; texto: string;
  accion: 'ligar' | 'contar' | 'areas' | 'shopify' | null;
  accion_texto: string | null;
  barcode: string | null; areas_web: string[]; ubicaciones: UbicacionDiag[];
  en_novacaja: { codigo: string; nombre: string } | null;
}
interface ResultadoInv { codigo: string; nombre: string; stock: number }

// Color del bloque "Existencia" según por qué el producto muestra (o no) stock.
const CAUSA_ESTILO: Record<string, { caja: string; titulo: string; icon: string }> = {
  ok:               { caja: 'bg-emerald-50 border-emerald-200', titulo: 'text-emerald-700', icon: 'check_circle' },
  sin_codigo:       { caja: 'bg-amber-50 border-amber-200',     titulo: 'text-amber-800',   icon: 'qr_code_2' },
  no_contado:       { caja: 'bg-amber-50 border-amber-200',     titulo: 'text-amber-800',   icon: 'inventory_2' },
  area_no_incluida: { caja: 'bg-blue-50 border-blue-200',       titulo: 'text-blue-800',    icon: 'place' },
  sin_seguimiento:  { caja: 'bg-error/10 border-error/30',      titulo: 'text-error',       icon: 'report_problem' },
};

const n0 = (v: number | null | undefined) => (v == null ? 0 : v).toLocaleString('es-MX');
/** Fecha que viene del backend → texto para la dueña (es-MX). */
const fmtFecha = (v: string | null | undefined) => {
  if (!v) return 'nunca';
  const s = String(v);
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? s : d.toLocaleString('es-MX');
};

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

  // Fotos de la página → inventario
  const [fotos,     setFotos]     = useState<FotosEstado | null>(null);
  const [fotosSync, setFotosSync] = useState(false);

  // Áreas que cuentan para la página (bloque plegable de ajustes)
  const [areasTodas,   setAreasTodas]   = useState<AreaTC52[]>([]);
  const [syncEstado,   setSyncEstado]   = useState<SyncEstado | null>(null);
  const [areasSel,     setAreasSel]     = useState<string[]>([]);
  const [areasAbierto, setAreasAbierto] = useState(false);
  const [areasSaving,  setAreasSaving]  = useState(false);
  const areasRef = useRef<HTMLDivElement>(null);

  // Diagnóstico de existencia del producto abierto + buscador para ligarlo
  const [diag,         setDiag]         = useState<Diagnostico | null>(null);
  const [cargandoDiag, setCargandoDiag] = useState(false);
  const [ligarQ,       setLigarQ]       = useState('');
  const [ligarRes,     setLigarRes]     = useState<ResultadoInv[]>([]);
  const [ligarBuscando, setLigarBuscando] = useState(false);
  const [ligando,      setLigando]      = useState<string | null>(null);

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

  // ── Fotos que ya están en la página → inventario ─────────────────────────────
  const fetchFotos = useCallback(async () => {
    try {
      const res = await fetch('/api/shopify-web/fotos/estado');
      const data = await res.json();
      if (!res.ok || data.error) return;
      setFotos(data);
    } catch { /* el aviso de conexión ya lo da el resumen */ }
  }, []);

  const traerFotos = async () => {
    setFotosSync(true);
    try {
      // Tarda entre 30 s y 1 min: recorre todo el catálogo de la página.
      const res = await fetch('/api/shopify-web/fotos/sincronizar', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || data.error) { notify(data.error || 'No se pudieron traer las fotos', 'error'); return; }
      if (data.skip) notify('Las fotos ya se están copiando en este momento; espera a que termine.');
      else notify(data.resumen || `Listo: ${n0(data.pegadas)} foto(s) nueva(s) en el inventario.`);
    } catch { notify('Error de conexión con la API', 'error'); }
    finally { setFotosSync(false); fetchFotos(); }
  };

  // ── Áreas que cuentan para la página ─────────────────────────────────────────
  const fetchAreas = useCallback(async () => {
    try {
      const res = await fetch('/api/almacen/tc52/ubicaciones');
      const data = await res.json();
      if (Array.isArray(data)) setAreasTodas(data);
    } catch { /* sin áreas: el bloque muestra el aviso de vacío */ }
  }, []);

  const fetchSyncEstado = useCallback(async () => {
    try {
      const res = await fetch('/api/shopify-sync/estado');
      const data = await res.json();
      if (!res.ok || data.error) return;
      setSyncEstado(data);
      setAreasSel(Array.isArray(data.areas) ? data.areas : []);
    } catch { /* el aviso de conexión ya lo da el resumen */ }
  }, []);

  useEffect(() => { fetchFotos(); fetchAreas(); fetchSyncEstado(); }, [fetchFotos, fetchAreas, fetchSyncEstado]);

  const toggleArea = (nombre: string) =>
    setAreasSel(prev => (prev.includes(nombre) ? prev.filter(a => a !== nombre) : [...prev, nombre]));

  const guardarAreas = async () => {
    if (!areasSel.length) return; // el botón ya está deshabilitado
    setAreasSaving(true);
    try {
      const res = await fetch('/api/shopify-sync/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ areas: areasSel }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { notify(data.error || 'No se pudieron guardar las áreas', 'error'); return; }
      notify(`Áreas guardadas: ${(data.areas || areasSel).join(' + ')}`);
      fetchSyncEstado();
      if (panelProd) cargarDiagnostico(panelProd.id); // el diagnóstico abierto cambia con las áreas
    } catch { notify('Error de conexión con la API', 'error'); }
    finally { setAreasSaving(false); }
  };

  // Abre el bloque de áreas y lo deja a la vista (desde el drawer).
  const irAAreas = () => {
    cerrarPanel();
    setAreasAbierto(true);
    setTimeout(() => areasRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };

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
  // "¿Por qué muestra (o no) el stock de la tienda?" — se pide al abrir el drawer.
  const cargarDiagnostico = useCallback(async (id: number) => {
    setCargandoDiag(true);
    setDiag(null);
    try {
      const res = await fetch(`/api/shopify-web/producto/${id}/diagnostico`);
      const data = await res.json();
      if (!res.ok || data.error) { setDiag(null); return; }
      setDiag(data);
    } catch { setDiag(null); }
    finally { setCargandoDiag(false); }
  }, []);

  const abrirPanel = async (p: ProdWeb) => {
    setPanelProd(p);
    setCargandoPanel(true);
    setPanel(null);
    setLigarQ(''); setLigarRes([]); setLigando(null);
    cargarDiagnostico(p.id); // va en paralelo con el detalle
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
  const cerrarPanel = () => {
    setPanel(null); setPanelProd(null);
    setDiag(null); setCargandoDiag(false);
    setLigarQ(''); setLigarRes([]); setLigando(null);
  };

  // ── Ligar un producto de la página con uno del inventario ────────────────────
  // Buscador con espera de 350 ms (para no golpear la caja en cada tecla) y corte
  // a los 15 s: la búsqueda del inventario a veces tarda.
  useEffect(() => {
    const q = ligarQ.trim();
    if (q.length < 2) { setLigarRes([]); setLigarBuscando(false); return; }
    let vivo = true;
    setLigarBuscando(true);
    const t = setTimeout(async () => {
      const ctrl = new AbortController();
      const corte = setTimeout(() => ctrl.abort(), 15000);
      try {
        const res = await fetch(`/api/almacen/buscar?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const data = await res.json();
        if (!vivo) return;
        setLigarRes(Array.isArray(data) ? data : []);
      } catch {
        if (vivo) { setLigarRes([]); notify('No se pudo buscar en el inventario', 'error'); }
      } finally {
        clearTimeout(corte);
        if (vivo) setLigarBuscando(false);
      }
    }, 350);
    return () => { vivo = false; clearTimeout(t); };
  }, [ligarQ]);

  const recargarDetalle = async (id: number) => {
    try {
      const res = await fetch(`/api/shopify-web/producto/${id}`);
      const data = await res.json();
      if (res.ok && !data.error) setPanel(data);
    } catch { /* el aviso ya salió al ligar */ }
  };

  const ligarCodigo = async (r: ResultadoInv) => {
    if (!panelProd) return;
    if (!window.confirm(`Se guardará el código ${r.codigo} en este producto de la página y su stock se sincronizará. ¿Continuar?`)) return;
    const id = panelProd.id;
    setLigando(r.codigo);
    try {
      const res = await fetch(`/api/shopify-web/producto/${id}/ligar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: r.codigo }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { notify(data.error || 'No se pudo ligar el producto', 'error'); return; }
      notify('Listo: ahora este producto muestra el stock de la tienda');
      setPanelProd(prev => prev ? { ...prev, barcode: data.codigo ?? r.codigo, stock_bodega: data.stock ?? prev.stock_bodega } : prev);
      setLigarQ(''); setLigarRes([]);
      cargarDiagnostico(id);
      recargarDetalle(id);
      fetchResumen();
      fetchProductos(page);
    } catch { notify('Error de conexión con la API', 'error'); }
    finally { setLigando(null); }
  };

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
  const estiloDiag = (diag && CAUSA_ESTILO[diag.causa]) || CAUSA_ESTILO.ok;
  const fotosOcupado = fotosSync || !!fotos?.corriendo;
  const money = (v: number | string | null) =>
    v == null || v === '' || Number(v) === 0 ? '—' : `$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;

  // Cada tarjeta aplica EXACTAMENTE el filtro con el que se calculó su número
  // (mismo predicado en el backend): tarjeta y lista siempre cuadran.
  const irFiltro = (f: string) => { setVista('en_pagina'); setFiltro(f); };
  const kpis: { label: string; valor: number | string; icon: string; onClick?: () => void; activo?: boolean }[] = resumen ? [
    { label: 'En la página',   valor: resumen.activos,      icon: 'storefront', onClick: () => irFiltro('publicado'), activo: vista === 'en_pagina' && filtro === 'publicado' },
    { label: 'Borradores',     valor: resumen.borradores,   icon: 'edit_note',  onClick: () => irFiltro('borrador'), activo: vista === 'en_pagina' && filtro === 'borrador' },
    { label: 'Sin foto',       valor: resumen.sin_foto,     icon: 'no_photography', onClick: () => irFiltro('sin_foto'), activo: vista === 'en_pagina' && filtro === 'sin_foto' },
    { label: 'Sin precio',     valor: resumen.sin_precio,   icon: 'money_off',  onClick: () => irFiltro('sin_precio'), activo: vista === 'en_pagina' && filtro === 'sin_precio' },
    { label: 'Con stock aquí', valor: resumen.con_stock_bodega, icon: 'warehouse', onClick: () => irFiltro('con_stock'), activo: vista === 'en_pagina' && filtro === 'con_stock' },
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

      {/* Ayuda de una línea: va justo debajo del título "Página web" del encabezado */}
      <p className="text-[11px] text-stone-400 mb-4 flex items-start gap-1.5">
        <Icon name="info" className="text-sm text-stone-300 flex-shrink-0" />
        <span>Los productos sin código de barras no muestran stock de la tienda ni se sincronizan: ábrelos y lígalos con tu inventario.</span>
      </p>

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

      {/* ── Fotos: traer al inventario las que ya están en la página ─────────── */}
      {fotos && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <Icon name="photo_library" className="text-2xl text-stone-400 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-on-surface">Fotos en el inventario: {n0(fotos.con_foto)} productos</p>
              <p className="text-[11px] text-stone-400">
                Última vez: {fmtFecha(fotos.ultima_sync)}{fotos.ultimo_resumen ? ` · ${fotos.ultimo_resumen}` : ''}
              </p>
              <p className="text-[11px] text-stone-400">Copia al Inventario las fotos que ya tienen los productos en la página; no borra las que subiste a mano.</p>
            </div>
          </div>
          <button onClick={traerFotos} disabled={fotosOcupado}
            className={cn('px-4 py-2.5 rounded-xl font-label text-[10px] font-bold uppercase tracking-widest inline-flex items-center justify-center gap-1.5 flex-shrink-0',
              fotosOcupado ? 'bg-stone-200 text-stone-400 cursor-not-allowed' : 'bg-primary text-on-primary hover:opacity-90')}>
            {fotosOcupado
              ? <span className="w-3 h-3 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />
              : <Icon name="cloud_download" className="text-sm" />}
            {fotosOcupado ? 'Trayendo fotos...' : 'Traer fotos de la página'}
          </button>
        </div>
      )}

      {/* ── Ajustes: áreas que cuentan para la página ────────────────────────── */}
      <div ref={areasRef} className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow mb-4 overflow-hidden">
        <button onClick={() => setAreasAbierto(v => !v)} className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-surface-container-low/40">
          <Icon name="tune" className="text-xl text-stone-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-on-surface">Áreas que cuentan para la página</p>
            <p className="text-[11px] text-stone-400 truncate">
              {!syncEstado ? 'Cargando...' : syncEstado.areas.length ? syncEstado.areas.join(' + ') : 'Sin áreas configuradas'}
            </p>
          </div>
          {!!syncEstado && syncEstado.sin_seguimiento > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-label font-bold uppercase tracking-wide bg-amber-100 text-amber-800 flex-shrink-0">
              {n0(syncEstado.sin_seguimiento)} sin control
            </span>
          )}
          <Icon name={areasAbierto ? 'expand_less' : 'expand_more'} className="text-xl text-stone-400 flex-shrink-0" />
        </button>

        {areasAbierto && (
          <div className="px-4 pb-4 pt-4 border-t border-outline-variant/10 space-y-4">
            <p className="text-[12px] text-stone-500 leading-relaxed">
              Solo el stock guardado en estas áreas se ofrece en la página. Si un producto vive en Refrigerador o Cocina y no las incluyes, la página no sabrá que hay existencia.
            </p>

            {areasTodas.length === 0 ? (
              <p className="text-[11px] text-stone-400">No se pudieron cargar las áreas del negocio.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {areasTodas.map(a => (
                  <label key={a.nombre} className="flex items-center gap-2.5 bg-surface-container-low rounded-xl px-3 py-2 cursor-pointer hover:bg-stone-100">
                    <input type="checkbox" checked={areasSel.includes(a.nombre)} onChange={() => toggleArea(a.nombre)}
                      className="w-4 h-4 accent-primary rounded flex-shrink-0" />
                    <span className="text-sm text-on-surface truncate">{a.nombre}</span>
                  </label>
                ))}
              </div>
            )}

            {areasSel.length === 0 && (
              <p className="text-[11px] text-error">Marca al menos un área: sin áreas, la página no mostraría existencia de nada.</p>
            )}

            {!!syncEstado && syncEstado.sin_seguimiento > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-start gap-2">
                  <Icon name="report_problem" className="text-lg text-amber-700 flex-shrink-0" />
                  <p className="text-[12px] text-amber-900 leading-relaxed">
                    {n0(syncEstado.sin_seguimiento)} productos no aceptan stock desde el sistema porque en Shopify tienen apagado el control de inventario (Track quantity).
                  </p>
                </div>
                <div className="mt-2 max-h-32 overflow-y-auto space-y-0.5 pl-7">
                  {(syncEstado.sin_seguimiento_lista || []).slice(0, 10).map(s => (
                    <p key={s.codigo_barras} className="text-[11px] text-amber-800 font-mono truncate">
                      {s.codigo_barras}{s.motivo_bloqueo ? ` — ${s.motivo_bloqueo}` : ''}
                    </p>
                  ))}
                </div>
                {(syncEstado.sin_seguimiento_lista || []).length > 10 && (
                  <p className="text-[11px] text-amber-700 mt-1 pl-7">
                    y {n0((syncEstado.sin_seguimiento_lista || []).length - 10)} más.
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1 border-t border-outline-variant/10">
              <button onClick={() => setAreasSel(syncEstado?.areas ?? [])} disabled={areasSaving}
                className="px-5 py-2.5 rounded-xl font-label text-xs font-bold uppercase tracking-widest bg-surface-container-low text-stone-500 hover:bg-stone-200 disabled:opacity-50">
                Deshacer
              </button>
              <button onClick={guardarAreas} disabled={areasSaving || areasSel.length === 0}
                className={cn('px-5 py-2.5 rounded-xl font-label text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2',
                  (areasSaving || areasSel.length === 0) ? 'bg-stone-200 text-stone-400 cursor-not-allowed' : 'bg-primary text-on-primary hover:opacity-90')}>
                {areasSaving && <span className="w-3.5 h-3.5 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />}
                Guardar áreas
              </button>
            </div>
          </div>
        )}
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
            <option value="publicado">Publicados</option>
            <option value="sin_foto">Sin foto</option>
            <option value="sin_precio">Sin precio</option>
            <option value="sin_codigo">Sin código de barras</option>
            <option value="borrador">Borradores</option>
            <option value="archivado">Archivados</option>
            <option value="con_stock">Con stock aquí</option>
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
                    <div className="flex justify-between"><span className="text-stone-500">Código de barras</span>
                      <span className={cn('font-mono text-xs', panelProd.barcode ? '' : 'text-error font-bold')}>{panelProd.barcode || 'sin código'}</span>
                    </div>
                    <div className="flex justify-between"><span className="text-stone-500">Stock en tienda</span><span>{panelProd.stock_bodega ?? '—'}</span></div>
                    <div className="flex justify-between"><span className="text-stone-500">Stock en la web</span><span>{panelProd.qtyShopify ?? '—'}</span></div>
                    <div className="flex justify-between"><span className="text-stone-500">Estado</span>
                      <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-label font-bold uppercase', CHIP_STATUS[panel.status])}>{TXT_STATUS[panel.status] || panel.status}</span>
                    </div>
                  </div>

                  {/* Existencia: por qué muestra (o no) el stock de la tienda */}
                  <div>
                    <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-2">Existencia</p>
                    {cargandoDiag ? (
                      <div className="py-6 flex justify-center">
                        <div className="w-6 h-6 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                      </div>
                    ) : !diag ? (
                      <p className="text-[11px] text-stone-400">No se pudo revisar la existencia de este producto.</p>
                    ) : (
                      <div className={cn('rounded-xl border p-4 space-y-3', estiloDiag.caja)}>
                        <div className="flex items-start gap-2">
                          <Icon name={estiloDiag.icon} className={cn('text-xl flex-shrink-0', estiloDiag.titulo)} />
                          <p className={cn('text-sm font-bold', estiloDiag.titulo)}>{diag.titulo}</p>
                        </div>
                        <p className="text-[12px] text-stone-600 leading-relaxed">{diag.texto}</p>

                        {diag.ubicaciones.length > 0 && (
                          <div className="bg-surface rounded-lg border border-outline-variant/10 overflow-hidden">
                            <table className="w-full text-xs">
                              <thead className="bg-surface-container-low/60 text-stone-500 font-label uppercase text-[9px] tracking-widest">
                                <tr>
                                  <th className="px-3 py-1.5 text-left">Área</th>
                                  <th className="px-3 py-1.5 text-right">Piezas</th>
                                  <th className="px-3 py-1.5 text-right">Cuenta para la web</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-surface-container">
                                {diag.ubicaciones.map(u => (
                                  <tr key={u.ubicacion}>
                                    <td className="px-3 py-1.5">{u.ubicacion}</td>
                                    <td className="px-3 py-1.5 text-right font-medium">{n0(u.cantidad)}</td>
                                    <td className="px-3 py-1.5 text-right">
                                      <span className={cn('px-2 py-0.5 rounded-full text-[9px] font-label font-bold uppercase tracking-wide',
                                        diag.areas_web.includes(u.ubicacion) ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-500')}>
                                        {diag.areas_web.includes(u.ubicacion) ? 'Sí' : 'No'}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {diag.accion_texto && (
                          <p className="text-[12px] text-stone-600 leading-relaxed">
                            <span className="font-bold">Qué hacer: </span>{diag.accion_texto}
                          </p>
                        )}

                        {diag.accion === 'areas' && (
                          <button onClick={irAAreas}
                            className="px-3 py-1.5 rounded-lg font-label text-[10px] font-bold uppercase tracking-widest inline-flex items-center gap-1.5 bg-blue-600 text-white hover:opacity-90">
                            <Icon name="tune" className="text-sm" /> Ajustar áreas
                          </button>
                        )}

                        {/* Sin código: lo ligamos con un producto del inventario */}
                        {diag.causa === 'sin_codigo' && (
                          <div className="pt-3 border-t border-amber-200">
                            <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-1">Ligar con un producto de tu inventario</p>
                            <div className="relative">
                              <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-lg" />
                              <input value={ligarQ} onChange={e => setLigarQ(e.target.value)}
                                placeholder="Escribe el nombre o el código..."
                                className="w-full pl-9 pr-3 py-2 bg-surface border border-outline-variant/20 rounded-xl outline-none focus:ring-1 focus:ring-primary font-body text-sm" />
                            </div>
                            {ligarQ.trim().length > 0 && ligarQ.trim().length < 2 && (
                              <p className="text-[11px] text-stone-400 mt-1">Escribe al menos 2 letras.</p>
                            )}
                            {ligarBuscando && (
                              <div className="mt-2 flex items-center gap-2 text-[11px] text-stone-400">
                                <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                                Buscando en el inventario...
                              </div>
                            )}
                            {!ligarBuscando && ligarQ.trim().length >= 2 && ligarRes.length === 0 && (
                              <p className="text-[11px] text-stone-400 mt-2">No se encontró nada con ese nombre o código.</p>
                            )}
                            {ligarRes.length > 0 && (
                              <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-outline-variant/10 bg-surface divide-y divide-surface-container">
                                {ligarRes.map(r => (
                                  <button key={r.codigo} onClick={() => ligarCodigo(r)} disabled={ligando !== null}
                                    className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-surface-container-low/60 disabled:opacity-50">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm text-on-surface truncate">{r.nombre || '(sin nombre)'}</p>
                                      <p className="text-[11px] text-stone-400 font-mono">{r.codigo}</p>
                                    </div>
                                    <span className="text-xs text-stone-500 flex-shrink-0">{n0(r.stock)} pza</span>
                                    {ligando === r.codigo
                                      ? <span className="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin flex-shrink-0" />
                                      : <Icon name="link" className="text-base text-primary flex-shrink-0" />}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
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
