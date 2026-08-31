'use client';

// ── Pedidos web ────────────────────────────────────────────────────────────────
// Pedidos de la tienda en línea (Shopify) dentro del sistema: lista para
// prepararlos en tienda, ventas del periodo, apartados activos en bodega y la
// configuración de la sincronización. Cada pedido abre el drawer PedidoWebDetalle.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '../lib/utils';
import { Icon } from '../components/Icon';
import {
  PedidoWebDetalle, CHIP_ESTADO, TXT_ESTADO, ENTREGA, PAGO_OK, chipPago, money, fmtFecha, fmtHora,
  type PedidoWebResumen, type UbicacionTc52,
} from '../components/PedidoWebDetalle';

const PAGE_SIZE = 50;

type TimeFilter = 'Hoy' | 'Esta semana' | 'Últimos 30 días' | 'Este mes';
const PERIOD_MAP: Record<TimeFilter, string> = {
  'Hoy':            'day',
  'Esta semana':    'week',
  'Últimos 30 días': 'days30',
  'Este mes':       'month',
};
const PERIOD_LABEL: Record<string, string> = {
  day:    'hoy',
  week:   'últimos 7 días',
  days30: 'últimos 30 días',
  month:  'este mes',
};

interface Contadores {
  nuevos: number; preparando: number; listos: number; surtidos_hoy: number; pago_pendiente: number;
  pedidos_hoy: number; ventas_hoy: number; con_faltantes: number; reservas_activas: number; unidades_apartadas: number;
}
interface ConfigSync {
  ubicacion_default: string; ubicaciones_orden: string[];
  reservar_sin_pago: boolean; salida_por_fulfillment: boolean; fulfill_en_shopify: boolean;
}
interface EstadoSync {
  configurado: boolean; activo: boolean; intervalo_min?: number; desde?: string | null;
  ultima_sync?: string | null; ultimo_resumen?: string | null; ultimo_error?: string | null;
  sincronizando?: boolean;
  permisos: { read_orders: boolean; fulfillment: boolean; scopes?: string[]; error?: string | null };
  config?: ConfigSync;
  contadores: Contadores | null;
  tienda?: string | null;
}
interface VentasData {
  period: string; pedidos: number; total: number; subtotal: number; envio: number; descuentos: number; total_pagado: number;
  pendientes_pago: number; unidades: number; cancelados: number; total_cancelado: number; ticket_promedio: number;
  por_dia: { fecha: string; pedidos: number; total: number }[];
  por_estado: { estado: string; n: number; total: number }[];
  por_entrega: { tipo_entrega: string; n: number; total: number }[];
  top_productos: { codigo: string; titulo: string; unidades: number; total: number; pedidos: number }[];
}
interface ReservaRow {
  id: number; codigo_barras: string; ubicacion: string; cantidad: number; creado: string;
  pedido_id: number; numero: string; estado: string; cliente_nombre: string | null; nombre: string | null;
}
interface ConfigForm {
  activo: boolean; reservar_sin_pago: boolean; salida_por_fulfillment: boolean; fulfill_en_shopify: boolean;
  ubicacion_default: string; ubicaciones_orden: string[]; intervalo_min: number; desde: string;
}
type Vista = 'pedidos' | 'ventas' | 'apartados' | 'config';

// Filtros de la lista. Los que traen `local` se filtran aquí (el API no filtra por
// pago/faltantes): son pocos pedidos activos, así que se bajan todos (máx 500).
const FILTROS: Record<string, { label: string; params: Record<string, string>; local?: (p: PedidoWebResumen) => boolean }> = {
  activos:    { label: 'Activos',    params: { activos: '1' } },
  nuevo:      { label: 'Nuevo',      params: { estado: 'nuevo' } },
  preparando: { label: 'Preparando', params: { estado: 'preparando' } },
  listo:      { label: 'Listo',      params: { estado: 'listo' } },
  entregado:  { label: 'Entregado',  params: { estado: 'entregado' } },
  enviado:    { label: 'Enviado',    params: { estado: 'enviado' } },
  cancelado:  { label: 'Cancelado',  params: { estado: 'cancelado' } },
  todos:      { label: 'Todos',      params: {} },
  surtidos:       { label: 'Entregados y enviados', params: { estado: 'entregado,enviado' } },
  pago_pendiente: { label: 'Pago pendiente', params: { activos: '1', limit: '500' }, local: p => !PAGO_OK.has(String(p.estado_pago || '')) },
  con_faltantes:  { label: 'Con faltantes',  params: { activos: '1', limit: '500' }, local: p => Number(p.faltantes) > 0 || Number(p.sin_codigo) > 0 },
};
const CHIPS_FILTRO = ['activos', 'nuevo', 'preparando', 'listo', 'entregado', 'enviado', 'cancelado', 'todos'];

const CHIP = 'px-2 py-0.5 rounded-full text-[10px] font-label font-bold uppercase tracking-wide';
const INPUT = 'w-full px-3 py-2 bg-surface-container-low border border-outline-variant/20 rounded-xl focus:border-primary outline-none font-body text-sm';
const BTN_SEC = 'px-3 py-1.5 rounded-lg font-label text-[10px] font-bold uppercase tracking-widest inline-flex items-center gap-1.5 bg-surface-container-low text-stone-500 hover:bg-stone-200 disabled:opacity-50 disabled:cursor-not-allowed';
const n0 = (v: unknown) => Number(v || 0);

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} disabled={disabled}
      className={cn('relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors', on ? 'bg-emerald-600' : 'bg-stone-300',
        disabled && 'opacity-50 cursor-not-allowed')}>
      <span className={cn('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', on && 'translate-x-5')} />
    </button>
  );
}

// datetime-local ↔ formato del API ('YYYY-MM-DD HH:mm:ss', hora de la tienda; el
// ISO que llega trae "Z" pero es hora CDMX, así que se recorta sin convertir).
const aInputFecha = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 16) : '');
const aFechaApi   = (v: string) => (v ? `${v.replace('T', ' ')}:00`.slice(0, 19) : '');

const formDe = (e: EstadoSync): ConfigForm => ({
  activo: !!e.activo,
  reservar_sin_pago: !!e.config?.reservar_sin_pago,
  salida_por_fulfillment: !!e.config?.salida_por_fulfillment,
  fulfill_en_shopify: !!e.config?.fulfill_en_shopify,
  ubicacion_default: e.config?.ubicacion_default || '',
  ubicaciones_orden: e.config?.ubicaciones_orden || [],
  intervalo_min: e.intervalo_min || 2,
  desde: aInputFecha(e.desde),
});

export default function PedidosWebTab({ timeFilter, setActiveTab }: { timeFilter: string; setActiveTab: (t: string) => void }) {
  const period = PERIOD_MAP[timeFilter as TimeFilter] ?? 'day';

  const [estado,    setEstado]    = useState<EstadoSync | null>(null);
  const [estadoErr, setEstadoErr] = useState<string | null>(null);
  const [vista,     setVista]     = useState<Vista>('pedidos');
  const [checando,  setChecando]  = useState(false);
  const [sincronizando,   setSincronizando]   = useState(false);
  const [cambiandoActivo, setCambiandoActivo] = useState(false);

  // Lista de pedidos
  const [pedidos,  setPedidos]  = useState<PedidoWebResumen[]>([]);
  const [total,    setTotal]    = useState(0);
  const [page,     setPage]     = useState(1);
  const [buscar,   setBuscar]   = useState('');
  const [filtro,   setFiltro]   = useState('activos');
  const [loading,  setLoading]  = useState(true);
  const [detalleId, setDetalleId] = useState<number | null>(null);

  // Ventas / apartados / configuración
  const [ventas,   setVentas]   = useState<VentasData | null>(null);
  const [loadingVentas,   setLoadingVentas]   = useState(false);
  const [reservas, setReservas] = useState<ReservaRow[]>([]);
  const [loadingReservas, setLoadingReservas] = useState(false);
  const [form,     setForm]     = useState<ConfigForm | null>(null);
  const [ubics,    setUbics]    = useState<string[]>([]);
  const [saving,   setSaving]   = useState(false);

  const [notif, setNotif] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 3000);
  };

  // Refs espejo para que los callbacks/polling no dependan del estado
  const buscarRef = useRef(buscar); buscarRef.current = buscar;
  const filtroRef = useRef(filtro); filtroRef.current = filtro;
  const vistaRef  = useRef(vista);  vistaRef.current  = vista;
  const pageRef   = useRef(page);   pageRef.current   = page;
  const periodRef = useRef(period); periodRef.current = period;

  const fetchEstado = useCallback(async (refrescar = false): Promise<EstadoSync | null> => {
    try {
      const res = await fetch(`/api/pedidos-web/estado${refrescar ? '?refrescar=1' : ''}`);
      const data = await res.json();
      if (!res.ok || data.error) { setEstadoErr(data.error || 'Error al cargar el estado'); return null; }
      setEstadoErr(null);
      setEstado(data);
      return data;
    } catch { setEstadoErr('Error de conexión con la API'); return null; }
  }, []);

  const fetchPedidos = useCallback(async (pg: number, silencioso = false) => {
    // Fija el filtro AL LANZAR el request: si cambia antes de que responda,
    // la respuesta vieja se descarta.
    const filtroPedido = filtroRef.current;
    const f = FILTROS[filtroPedido] || FILTROS.activos;
    if (!silencioso) setLoading(true);
    try {
      const params = new URLSearchParams({ ...f.params, q: buscarRef.current });
      if (!f.params.limit) { params.set('limit', String(PAGE_SIZE)); params.set('offset', String((pg - 1) * PAGE_SIZE)); }
      const res = await fetch(`/api/pedidos-web/pedidos?${params}`);
      const data = await res.json();
      if (filtroPedido !== filtroRef.current) return; // respuesta obsoleta
      if (!res.ok || data.error) { notify(data.error || 'Error al cargar pedidos', 'error'); return; }
      let lista: PedidoWebResumen[] = data.pedidos ?? [];
      if (f.local) lista = lista.filter(f.local);
      setPedidos(lista);
      setTotal(f.local ? lista.length : (data.total ?? 0));
    } catch (e) {
      notify('Error de conexión con la API', 'error');
      console.error(e);
    } finally { if (filtroPedido === filtroRef.current) setLoading(false); }
  }, []);

  const fetchVentas = useCallback(async (p: string) => {
    setLoadingVentas(true);
    try {
      const res = await fetch(`/api/pedidos-web/ventas?period=${p}`);
      const data = await res.json();
      if (!res.ok || data.error) { notify(data.error || 'Error al cargar ventas', 'error'); return; }
      setVentas(data);
    } catch { notify('Error de conexión con la API', 'error'); }
    finally { setLoadingVentas(false); }
  }, []);

  const fetchReservas = useCallback(async () => {
    setLoadingReservas(true);
    try {
      const res = await fetch('/api/pedidos-web/reservas');
      const data = await res.json();
      if (!res.ok || data.error) { notify(data.error || 'Error al cargar apartados', 'error'); return; }
      setReservas(data.reservas ?? []);
    } catch { notify('Error de conexión con la API', 'error'); }
    finally { setLoadingReservas(false); }
  }, []);

  const fetchUbics = useCallback(async () => {
    try {
      const res = await fetch('/api/almacen/tc52/ubicaciones');
      const data: UbicacionTc52[] = await res.json();
      if (Array.isArray(data)) setUbics(data.map(u => u.nombre));
    } catch { /* silent */ }
  }, []);

  // Carga inicial + polling cada 60 s (solo con la pestaña visible)
  useEffect(() => {
    fetchEstado(); fetchPedidos(1);
    const tick = () => {
      if (document.hidden) return;
      fetchEstado();
      if (vistaRef.current === 'pedidos') fetchPedidos(pageRef.current, true);
    };
    const id = setInterval(tick, 60_000);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [fetchEstado, fetchPedidos]);

  // Debounce al buscar/filtrar. loading se prende DESDE YA para no mostrar un
  // "sin pedidos" fantasma durante los 300 ms de espera.
  const primerRender = useRef(true);
  useEffect(() => {
    if (primerRender.current) { primerRender.current = false; return; }
    setLoading(true);
    const t = setTimeout(() => { setPage(1); fetchPedidos(1); }, 300);
    return () => clearTimeout(t);
  }, [buscar, filtro, fetchPedidos]);

  // Sub-vistas: cargan al entrar (ventas también al cambiar el periodo)
  useEffect(() => { if (vista === 'ventas') fetchVentas(period); }, [vista, period, fetchVentas]);
  useEffect(() => { if (vista === 'apartados') fetchReservas(); }, [vista, fetchReservas]);
  useEffect(() => { if (vista === 'config') fetchUbics(); }, [vista, fetchUbics]);
  useEffect(() => {
    if (vista !== 'config') { setForm(null); return; }
    if (!form && estado && estado.configurado) setForm(formDe(estado));
  }, [vista, estado, form]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const irPagina = (pg: number) => { setPage(pg); fetchPedidos(pg); };
  const conPaginacion = !FILTROS[filtro]?.local;

  const refrescarTodo = useCallback(() => {
    fetchEstado();
    if (vistaRef.current === 'pedidos')   fetchPedidos(pageRef.current, true);
    if (vistaRef.current === 'apartados') fetchReservas();
    if (vistaRef.current === 'ventas')    fetchVentas(periodRef.current);
  }, [fetchEstado, fetchPedidos, fetchReservas, fetchVentas]);

  // ── Acciones de sincronización ───────────────────────────────────────────────
  const toggleActivo = async (v: boolean) => {
    setCambiandoActivo(true);
    try {
      const res = await fetch('/api/pedidos-web/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activo: v }) });
      const data = await res.json();
      if (res.ok && !data.error) { notify(v ? 'Sincronización activada' : 'Sincronización apagada'); const d = await fetchEstado(); if (d && form) setForm({ ...form, activo: !!d.activo }); }
      else notify(data.error || 'Error al guardar', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setCambiandoActivo(false); }
  };

  const sincronizarAhora = async () => {
    setSincronizando(true);
    try {
      const res = await fetch('/api/pedidos-web/sincronizar', { method: 'POST' });
      const data = await res.json();
      if (res.ok && !data.error) notify(data.resumen || 'Sincronizado');
      else notify(data.error || 'Error al sincronizar', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setSincronizando(false); refrescarTodo(); }
  };

  const volverAChecar = async () => {
    setChecando(true);
    const d = await fetchEstado(true);
    setChecando(false);
    if (d && d.permisos?.read_orders) notify('Permiso read_orders detectado');
    else if (d) notify('Todavía falta el permiso read_orders', 'error');
  };

  const guardarConfig = async () => {
    if (!form || !estado) return;
    const body: Record<string, unknown> = {
      activo: form.activo, reservar_sin_pago: form.reservar_sin_pago, salida_por_fulfillment: form.salida_por_fulfillment,
      fulfill_en_shopify: form.fulfill_en_shopify, ubicacion_default: form.ubicacion_default,
      ubicaciones_orden: form.ubicaciones_orden, intervalo_min: Math.min(60, Math.max(1, Number(form.intervalo_min) || 2)),
    };
    if (form.desde && form.desde !== aInputFecha(estado.desde)) body.desde = aFechaApi(form.desde);
    setSaving(true);
    try {
      const res = await fetch('/api/pedidos-web/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok && !data.error) {
        notify('Configuración guardada');
        const d = await fetchEstado();
        if (d && d.configurado) setForm(formDe(d));
      } else notify(data.error || 'Error al guardar', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setSaving(false); }
  };

  const moverUbic = (i: number, dir: -1 | 1) => {
    if (!form) return;
    const arr = [...form.ubicaciones_orden];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setForm({ ...form, ubicaciones_orden: arr });
  };
  const quitarUbic  = (i: number) => { if (form) setForm({ ...form, ubicaciones_orden: form.ubicaciones_orden.filter((_, k) => k !== i) }); };
  const agregarUbic = (u: string) => { if (form && u && !form.ubicaciones_orden.includes(u)) setForm({ ...form, ubicaciones_orden: [...form.ubicaciones_orden, u] }); };

  // ── Render ───────────────────────────────────────────────────────────────────
  const c = estado?.contadores;
  const kpis: { label: string; valor: number | string; icon: string; f: string }[] = c ? [
    { label: 'Nuevos',         valor: n0(c.nuevos),         icon: 'fiber_new',       f: 'nuevo' },
    { label: 'Preparando',     valor: n0(c.preparando),     icon: 'pending_actions', f: 'preparando' },
    { label: 'Listos',         valor: n0(c.listos),         icon: 'task_alt',        f: 'listo' },
    { label: 'Entregados hoy', valor: n0(c.surtidos_hoy),   icon: 'check_circle',    f: 'surtidos' },
    { label: 'Pago pendiente', valor: n0(c.pago_pendiente), icon: 'payments',        f: 'pago_pendiente' },
    { label: 'Con faltantes',  valor: n0(c.con_faltantes),  icon: 'report_problem',  f: 'con_faltantes' },
  ] : [];

  const ventasKpis: { label: string; valor: string; sub?: string; icon: string }[] = ventas ? [
    { label: 'Pedidos',         valor: n0(ventas.pedidos).toLocaleString('es-MX'),  icon: 'shopping_cart', sub: `${n0(ventas.por_dia.length)} día(s) con venta` },
    { label: 'Ventas',          valor: money(ventas.total),                         icon: 'payments',      sub: `Cobrado: ${money(ventas.total_pagado)}` },
    { label: 'Ticket promedio', valor: money(ventas.ticket_promedio),               icon: 'receipt_long' },
    { label: 'Unidades',        valor: n0(ventas.unidades).toLocaleString('es-MX'), icon: 'inventory_2' },
    { label: 'Pago pendiente',  valor: n0(ventas.pendientes_pago).toLocaleString('es-MX'), icon: 'schedule', sub: 'pedidos sin cobrar' },
    { label: 'Cancelados',      valor: n0(ventas.cancelados).toLocaleString('es-MX'), icon: 'cancel',     sub: money(ventas.total_cancelado) },
  ] : [];
  const maxDia = ventas ? Math.max(1, ...ventas.por_dia.map(d => n0(d.total))) : 1;
  const totalApartadas = reservas.reduce((s, r) => s + n0(r.cantidad), 0);
  const opcionesUbic = form ? Array.from(new Set([...ubics, ...form.ubicaciones_orden, form.ubicacion_default].filter(Boolean))) : ubics;
  const ubicsPorAgregar = form ? opcionesUbic.filter(u => !form.ubicaciones_orden.includes(u)) : [];

  return (
    <section className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
      {notif && (
        <div className={cn('fixed top-6 right-6 z-[300] px-5 py-3 rounded-xl shadow-xl flex items-center gap-2 font-label text-sm',
          notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error')}>
          <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
          {notif.msg}
        </div>
      )}

      {/* ── Avisos ─────────────────────────────────────────────────────────── */}
      {estadoErr && (
        <div className="mb-6 p-4 bg-error/10 text-error rounded-xl flex items-center gap-3">
          <Icon name="cloud_off" className="text-2xl" />
          <div>
            <p className="font-label text-sm font-bold uppercase tracking-widest">Sin conexión con Shopify</p>
            <p className="text-sm">{estadoErr}</p>
          </div>
        </div>
      )}
      {estado && !estado.configurado && (
        <div className="mb-6 p-4 bg-error/10 text-error rounded-xl flex items-center gap-3">
          <Icon name="cloud_off" className="text-2xl" />
          <div>
            <p className="font-label text-sm font-bold uppercase tracking-widest">Sin conexión con Shopify</p>
            <p className="text-sm">Faltan las credenciales de Shopify en el servidor (.env). Sin ellas no se pueden bajar los pedidos.</p>
          </div>
        </div>
      )}
      {estado?.configurado && estado.permisos?.read_orders === false && (
        <div className="mb-6 p-4 bg-error text-on-error rounded-xl">
          <div className="flex items-start gap-3">
            <Icon name="report_problem" className="text-2xl flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-label text-sm font-bold uppercase tracking-widest">La app de Shopify no tiene el permiso read_orders; los pedidos no se pueden bajar</p>
              <ol className="list-decimal ml-4 mt-2 text-sm space-y-0.5">
                <li>Entra al Dev Dashboard de Shopify y abre la app <b>&quot;Inventario Casita&quot;</b>.</li>
                <li>Ve a <b>Configuración → Access scopes</b> y agrega <code className="font-mono">read_orders</code> (opcional: <code className="font-mono">read_merchant_managed_fulfillment_orders</code> y <code className="font-mono">write_merchant_managed_fulfillment_orders</code> para marcar como enviado desde aquí).</li>
                <li>Da clic en <b>Release</b> (publicar la versión).</li>
                <li>En la tienda, acepta los permisos nuevos de la app.</li>
              </ol>
              {estado.permisos.error && <p className="text-xs mt-2 opacity-80">Detalle: {estado.permisos.error}</p>}
              <button onClick={volverAChecar} disabled={checando}
                className="mt-3 px-3 py-1.5 rounded-lg font-label text-[10px] font-bold uppercase tracking-widest inline-flex items-center gap-1.5 bg-white text-error hover:opacity-90 disabled:opacity-60">
                {checando ? <span className="w-3 h-3 border-2 border-error/30 border-t-error rounded-full animate-spin" /> : <Icon name="refresh" className="text-sm" />}
                Volver a checar
              </button>
            </div>
          </div>
        </div>
      )}
      {estado?.ultimo_error && (
        <div className="mb-6 p-4 bg-amber-100 text-amber-900 rounded-xl flex items-center gap-3">
          <Icon name="warning" className="text-2xl" />
          <div className="min-w-0">
            <p className="font-label text-sm font-bold uppercase tracking-widest">Último error de sincronización</p>
            <p className="text-sm break-words">{estado.ultimo_error}</p>
          </div>
        </div>
      )}

      {/* ── Franja de sincronización ───────────────────────────────────────── */}
      {estado?.configurado && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow p-4 mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Toggle on={estado.activo} onChange={toggleActivo} disabled={cambiandoActivo} />
            <div className="min-w-0">
              <p className="font-label text-[10px] uppercase tracking-widest text-stone-500">
                Sincronización con la página{' '}
                <span className={estado.activo ? 'text-emerald-700 font-bold' : 'text-error font-bold'}>{estado.activo ? 'activa' : 'apagada'}</span>
                {estado.activo && estado.intervalo_min ? <span className="text-stone-400"> · cada {estado.intervalo_min} min</span> : null}
              </p>
              <p className="text-sm text-on-surface truncate">
                Última sincronización: {estado.ultima_sync ? fmtHora(estado.ultima_sync) : 'nunca'}
                {estado.ultimo_resumen ? ` — ${estado.ultimo_resumen}` : ''}
              </p>
            </div>
          </div>
          <button onClick={sincronizarAhora} disabled={sincronizando || !!estado.sincronizando}
            className={cn('px-4 py-2 rounded-xl font-label text-[10px] font-bold uppercase tracking-widest inline-flex items-center justify-center gap-1.5 flex-shrink-0',
              sincronizando || estado.sincronizando ? 'bg-stone-200 text-stone-400 cursor-not-allowed' : 'bg-primary text-on-primary hover:opacity-90')}>
            {sincronizando || estado.sincronizando
              ? <span className="w-3 h-3 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />
              : <Icon name="sync" className="text-sm" />}
            Sincronizar ahora
          </button>
        </div>
      )}

      {/* ── Sub-vistas ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex bg-surface-container-low rounded-xl p-1 border border-outline-variant/10 w-fit">
          {([['pedidos', 'Pedidos'], ['ventas', 'Ventas'], ['apartados', 'Apartados'], ['config', 'Configuración']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setVista(v)}
              className={cn('px-4 py-1.5 rounded-lg text-[10px] font-label font-bold uppercase tracking-widest transition-all',
                vista === v ? 'bg-surface text-primary shadow-sm' : 'text-stone-400 hover:text-stone-600')}>
              {l}
            </button>
          ))}
        </div>
        {vista === 'ventas' && (
          <p className="text-[11px] text-stone-400 font-label uppercase tracking-widest">Ventas de la página · {PERIOD_LABEL[period]}</p>
        )}
      </div>

      {/* ══ PEDIDOS ═══════════════════════════════════════════════════════════ */}
      {vista === 'pedidos' && (
        <>
          {/* KPI cards: cada tarjeta aplica el filtro con el que se calculó su número */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {kpis.map(k => (
              <button key={k.label} onClick={() => setFiltro(filtro === k.f ? 'activos' : k.f)}
                className={cn('bg-surface-container-lowest rounded-xl border p-4 text-left transition-all hover:border-primary/40 cursor-pointer',
                  filtro === k.f ? 'border-primary shadow-md' : 'border-outline-variant/10 shadow')}>
                <Icon name={k.icon} className={cn('text-xl mb-2', filtro === k.f ? 'text-primary' : 'text-stone-400')} />
                <p className="text-2xl font-bold text-on-surface leading-none">{k.valor}</p>
                <p className="font-label text-[10px] uppercase tracking-widest text-stone-500 mt-1">{k.label}</p>
              </button>
            ))}
          </div>

          {/* Búsqueda + chips de estado */}
          <div className="flex flex-col gap-3 mb-4">
            <div className="relative">
              <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-xl" />
              <input value={buscar} onChange={e => setBuscar(e.target.value)}
                placeholder="Buscar por número, cliente, teléfono, producto o código..."
                className="w-full pl-10 pr-4 py-2.5 bg-background border border-outline-variant/20 rounded-xl outline-none focus:ring-1 focus:ring-primary font-body text-sm" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CHIPS_FILTRO.map(f => (
                <button key={f} onClick={() => setFiltro(f)}
                  className={cn('px-3 py-1 rounded-full text-[10px] font-label font-bold uppercase tracking-widest transition-all border',
                    filtro === f ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container-lowest text-stone-500 border-outline-variant/20 hover:border-primary/40')}>
                  {FILTROS[f].label}
                </button>
              ))}
              {!CHIPS_FILTRO.includes(filtro) && FILTROS[filtro] && (
                <button onClick={() => setFiltro('activos')}
                  className="px-3 py-1 rounded-full text-[10px] font-label font-bold uppercase tracking-widest bg-primary text-on-primary border border-primary inline-flex items-center gap-1">
                  {FILTROS[filtro].label} <Icon name="close" className="text-xs" />
                </button>
              )}
            </div>
          </div>

          {/* Tabla */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow overflow-hidden">
            {loading ? (
              <div className="py-20 flex flex-col items-center">
                <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-3" />
                <p className="font-serif italic text-primary">Cargando...</p>
              </div>
            ) : pedidos.length === 0 ? (
              <div className="py-20 flex flex-col items-center text-stone-300">
                <Icon name="shopping_cart" className="text-6xl opacity-20 mb-3" />
                <p className="text-sm font-label uppercase tracking-widest">Sin pedidos</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase text-[10px] tracking-widest">
                    <tr>
                      <th className="px-4 py-3 text-left">Pedido</th>
                      <th className="px-4 py-3 text-left">Cliente</th>
                      <th className="px-4 py-3 text-left hidden sm:table-cell">Pago</th>
                      <th className="px-4 py-3 text-left hidden md:table-cell">Productos</th>
                      <th className="px-4 py-3 text-left hidden sm:table-cell">Preparación</th>
                      <th className="px-4 py-3 text-right">Total</th>
                      <th className="px-4 py-3 text-left">Estado</th>
                      <th className="px-4 py-3 text-left hidden lg:table-cell">Ubicación</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container">
                    {pedidos.map(p => {
                      const ent = ENTREGA[p.tipo_entrega] || { icon: 'help', texto: p.tipo_entrega || '—' };
                      const pago = chipPago(p.estado_pago);
                      const uni = n0(p.unidades), esc = n0(p.escaneadas);
                      const pct = uni > 0 ? Math.min(100, Math.round((esc / uni) * 100)) : 0;
                      return (
                        <tr key={p.id} onClick={() => setDetalleId(p.id)} className="hover:bg-surface-container-low/40 cursor-pointer">
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-on-surface">{p.numero}</p>
                            <p className="text-[11px] text-stone-400">{fmtFecha(p.fecha_pedido)}</p>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span title={p.entrega_detalle || ent.texto} className="inline-flex flex-shrink-0">
                                <Icon name={ent.icon} className="text-base text-stone-400" />
                              </span>
                              <div className="min-w-0">
                                <p className="truncate max-w-[160px] sm:max-w-[220px]">{p.cliente_nombre || '—'}</p>
                                {p.notas_cliente && <p className="text-[10px] text-amber-700 truncate max-w-[160px] sm:max-w-[220px]" title={p.notas_cliente}>Nota: {p.notas_cliente}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 hidden sm:table-cell">
                            <span className={cn(CHIP, pago.clase)}>{pago.texto}</span>
                          </td>
                          <td className="px-4 py-2.5 hidden md:table-cell text-stone-600 whitespace-nowrap">
                            {n0(p.n_lineas)} línea{n0(p.n_lineas) !== 1 ? 's' : ''} · {uni} pza{uni !== 1 ? 's' : ''}
                          </td>
                          <td className="px-4 py-2.5 hidden sm:table-cell">
                            <div className="flex items-center gap-2">
                              <div className="w-20 h-1.5 bg-stone-200 rounded-full overflow-hidden flex-shrink-0">
                                <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : 'bg-amber-400')} style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs text-stone-500 tabular-nums whitespace-nowrap">{esc}/{uni}</span>
                            </div>
                            {(n0(p.faltantes) > 0 || n0(p.sin_codigo) > 0) && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {n0(p.faltantes) > 0 && <span className={cn(CHIP, 'bg-error/10 text-error')}>Faltan {n0(p.faltantes)}</span>}
                                {n0(p.sin_codigo) > 0 && <span className={cn(CHIP, 'bg-error/10 text-error')}>Sin código</span>}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium whitespace-nowrap">{money(p.total)}</td>
                          <td className="px-4 py-2.5">
                            <span className={cn(CHIP, CHIP_ESTADO[p.estado] || 'bg-stone-100 text-stone-500')}>{TXT_ESTADO[p.estado] || p.estado}</span>
                          </td>
                          <td className="px-4 py-2.5 hidden lg:table-cell text-stone-600">{p.ubicacion || <span className="text-stone-300">—</span>}</td>
                          <td className="px-2 py-2.5 text-right"><Icon name="chevron_right" className="text-stone-300" /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Paginación */}
            {!loading && (conPaginacion ? total > PAGE_SIZE : total > 0) && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-outline-variant/10">
                <p className="text-[11px] text-stone-400 font-label uppercase tracking-widest">{total} pedidos</p>
                {conPaginacion && (
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
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ══ VENTAS ════════════════════════════════════════════════════════════ */}
      {vista === 'ventas' && (
        loadingVentas && !ventas ? (
          <div className="py-20 flex flex-col items-center">
            <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-3" />
            <p className="font-serif italic text-primary">Cargando...</p>
          </div>
        ) : ventas && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              {ventasKpis.map(k => (
                <div key={k.label} className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow p-4 min-w-0">
                  <Icon name={k.icon} className="text-xl mb-2 text-stone-400" />
                  <p className="text-2xl font-bold text-on-surface leading-none truncate">{k.valor}</p>
                  <p className="font-label text-[10px] uppercase tracking-widest text-stone-500 mt-1">{k.label}</p>
                  {k.sub && <p className="text-[11px] text-emerald-700 mt-0.5 truncate">{k.sub}</p>}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              {/* Ventas por día */}
              <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow p-4">
                <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-3">Ventas por día</p>
                {ventas.por_dia.length === 0 ? (
                  <p className="text-sm text-stone-400 py-8 text-center">Sin ventas {PERIOD_LABEL[period]}</p>
                ) : (
                  <div className="flex items-end gap-1 h-44 overflow-x-auto">
                    {ventas.por_dia.map(d => (
                      <div key={d.fecha} className="flex-1 min-w-[22px] h-full flex flex-col items-center"
                        title={`${d.fecha}: ${n0(d.pedidos)} pedido(s) · ${money(d.total)}`}>
                        <div className="flex-1 w-full flex items-end">
                          <div className="w-full bg-primary/80 rounded-t hover:bg-primary transition-colors" style={{ height: `${Math.max(3, (n0(d.total) / maxDia) * 100)}%` }} />
                        </div>
                        <span className="text-[9px] text-stone-400 mt-1 whitespace-nowrap">{d.fecha.slice(8, 10)}/{d.fecha.slice(5, 7)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Por entrega / por estado */}
              <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow p-4 space-y-4">
                <div>
                  <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-2">Por tipo de entrega</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ventas.por_entrega.length === 0 && <span className="text-sm text-stone-400">—</span>}
                    {ventas.por_entrega.map(e => {
                      const ent = ENTREGA[e.tipo_entrega] || { icon: 'help', texto: e.tipo_entrega || 'Sin definir' };
                      return (
                        <span key={e.tipo_entrega || 'x'} className="px-3 py-1.5 rounded-full bg-surface-container-low text-xs inline-flex items-center gap-1.5">
                          <Icon name={ent.icon} className="text-sm text-stone-500" />
                          <span className="font-medium">{ent.texto}</span>
                          <span className="text-stone-500">{n0(e.n)} · {money(e.total)}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-2">Por estado</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ventas.por_estado.length === 0 && <span className="text-sm text-stone-400">—</span>}
                    {ventas.por_estado.map(e => (
                      <span key={e.estado} className={cn('px-3 py-1.5 rounded-full text-xs inline-flex items-center gap-1.5', CHIP_ESTADO[e.estado] || 'bg-stone-100 text-stone-500')}>
                        <span className="font-bold uppercase text-[10px] font-label tracking-wide">{TXT_ESTADO[e.estado] || e.estado}</span>
                        <span>{n0(e.n)} · {money(e.total)}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <p className="text-[10px] text-stone-400">Los cancelados no cuentan en ventas ni unidades; se muestran aparte.</p>
              </div>
            </div>

            {/* Top productos */}
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow overflow-hidden">
              <div className="px-4 py-3 border-b border-outline-variant/10">
                <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">Top productos · {PERIOD_LABEL[period]}</p>
              </div>
              {ventas.top_productos.length === 0 ? (
                <div className="py-12 flex flex-col items-center text-stone-300">
                  <Icon name="inventory_2" className="text-5xl opacity-20 mb-2" />
                  <p className="text-sm font-label uppercase tracking-widest">Sin productos vendidos</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase text-[10px] tracking-widest">
                      <tr>
                        <th className="px-4 py-3 text-left">Producto</th>
                        <th className="px-4 py-3 text-right">Unidades</th>
                        <th className="px-4 py-3 text-right hidden sm:table-cell">Pedidos</th>
                        <th className="px-4 py-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-container">
                      {ventas.top_productos.map((t, i) => (
                        <tr key={`${t.codigo}-${i}`} className="hover:bg-surface-container-low/40">
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-on-surface truncate max-w-[260px] sm:max-w-md">{t.titulo}</p>
                            <p className="text-[11px] text-stone-400 font-mono">{t.codigo || 'sin código'}</p>
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium">{n0(t.unidades)}</td>
                          <td className="px-4 py-2.5 text-right hidden sm:table-cell">{n0(t.pedidos)}</td>
                          <td className="px-4 py-2.5 text-right font-medium">{money(t.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )
      )}

      {/* ══ APARTADOS ═════════════════════════════════════════════════════════ */}
      {vista === 'apartados' && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div>
              <p className="text-sm text-on-surface"><b>{reservas.length}</b> apartado{reservas.length !== 1 ? 's' : ''} · <b>{totalApartadas}</b> pieza{totalApartadas !== 1 ? 's' : ''} apartadas en bodega</p>
              <p className="text-[11px] text-stone-400">Apartado = piezas reservadas para pedidos web que aún no salen. La página solo vende lo disponible (físico − apartado).</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setActiveTab('Bodega')} className={BTN_SEC}><Icon name="warehouse" className="text-sm" /> Ver bodega</button>
              <button onClick={fetchReservas} disabled={loadingReservas} className={BTN_SEC}>
                {loadingReservas ? <span className="w-3 h-3 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" /> : <Icon name="refresh" className="text-sm" />}
                Actualizar
              </button>
            </div>
          </div>
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow overflow-hidden">
            {loadingReservas && reservas.length === 0 ? (
              <div className="py-20 flex flex-col items-center">
                <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-3" />
                <p className="font-serif italic text-primary">Cargando...</p>
              </div>
            ) : reservas.length === 0 ? (
              <div className="py-20 flex flex-col items-center text-stone-300">
                <Icon name="inventory" className="text-6xl opacity-20 mb-3" />
                <p className="text-sm font-label uppercase tracking-widest">Sin apartados</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase text-[10px] tracking-widest">
                    <tr>
                      <th className="px-4 py-3 text-left">Producto</th>
                      <th className="px-4 py-3 text-left hidden sm:table-cell">Ubicación</th>
                      <th className="px-4 py-3 text-right">Apartadas</th>
                      <th className="px-4 py-3 text-left">Pedido</th>
                      <th className="px-4 py-3 text-left hidden md:table-cell">Cliente</th>
                      <th className="px-4 py-3 text-left hidden lg:table-cell">Desde</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container">
                    {reservas.map(r => (
                      <tr key={r.id} className="hover:bg-surface-container-low/40">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-on-surface truncate max-w-[220px] sm:max-w-xs">{r.nombre || '(sin nombre)'}</p>
                          <p className="text-[11px] text-stone-400 font-mono">{r.codigo_barras}</p>
                        </td>
                        <td className="px-4 py-2.5 hidden sm:table-cell">{r.ubicacion}</td>
                        <td className="px-4 py-2.5 text-right font-medium">{n0(r.cantidad)}</td>
                        <td className="px-4 py-2.5">
                          <button onClick={() => setDetalleId(r.pedido_id)} className="text-primary underline font-medium">{r.numero}</button>
                          <span className={cn(CHIP, 'ml-2', CHIP_ESTADO[r.estado] || 'bg-stone-100 text-stone-500')}>{TXT_ESTADO[r.estado] || r.estado}</span>
                        </td>
                        <td className="px-4 py-2.5 hidden md:table-cell truncate max-w-[200px]">{r.cliente_nombre || '—'}</td>
                        <td className="px-4 py-2.5 hidden lg:table-cell text-stone-500">{fmtFecha(r.creado)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ══ CONFIGURACIÓN ═════════════════════════════════════════════════════ */}
      {vista === 'config' && (
        !estado ? (
          <div className="py-20 flex flex-col items-center">
            <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-3" />
            <p className="font-serif italic text-primary">Cargando...</p>
          </div>
        ) : !estado.configurado || !form ? (
          <div className="py-12 flex flex-col items-center text-stone-300">
            <Icon name="cloud_off" className="text-6xl opacity-20 mb-3" />
            <p className="text-sm font-label uppercase tracking-widest">Sin conexión con Shopify</p>
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow p-6 space-y-6 max-w-3xl">
            {/* Sincronización */}
            <div>
              <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-3">Sincronización</p>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Toggle on={form.activo} onChange={v => setForm({ ...form, activo: v })} />
                  <div>
                    <p className="text-sm text-on-surface font-medium">Bajar pedidos de la página automáticamente</p>
                    <p className="text-[11px] text-stone-400">Apagado: no entran pedidos nuevos hasta que lo prendas o des clic en &quot;Sincronizar ahora&quot;.</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-1">Cada cuántos minutos</p>
                    <input type="number" min={1} max={60} value={form.intervalo_min}
                      onChange={e => setForm({ ...form, intervalo_min: Math.min(60, Math.max(1, parseInt(e.target.value) || 1)) })}
                      className={INPUT} />
                    <p className="text-[11px] text-stone-400 mt-1">Entre 1 y 60. Revisa Shopify con esta frecuencia.</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-1">Importar pedidos desde</p>
                    <input type="datetime-local" value={form.desde} onChange={e => setForm({ ...form, desde: e.target.value })} className={INPUT} />
                    <p className="text-[11px] text-stone-400 mt-1">Solo se importan pedidos creados a partir de esta fecha (los anteriores ya se surtieron a mano).</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Apartado y salida */}
            <div>
              <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-3">Apartado y salida de bodega</p>
              <div className="space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.reservar_sin_pago} onChange={e => setForm({ ...form, reservar_sin_pago: e.target.checked })} className="w-4 h-4 accent-primary rounded mt-0.5" />
                  <span>
                    <span className="block text-sm text-on-surface font-medium">Apartar aunque el pago esté pendiente</span>
                    <span className="block text-[11px] text-stone-400">Recomendado: Shopify ya lo tiene comprometido; así no se vende dos veces. Para entregar sí se pide el pago (o confirmar que se cobró en tienda).</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.salida_por_fulfillment} onChange={e => setForm({ ...form, salida_por_fulfillment: e.target.checked })} className="w-4 h-4 accent-primary rounded mt-0.5" />
                  <span>
                    <span className="block text-sm text-on-surface font-medium">Descontar de bodega cuando se marque como preparado en Shopify</span>
                    <span className="block text-[11px] text-stone-400">Si alguien lo marca como preparado/enviado desde Shopify, aquí se hace la salida sola para que el stock no se quede sin descontar.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.fulfill_en_shopify} onChange={e => setForm({ ...form, fulfill_en_shopify: e.target.checked })} className="w-4 h-4 accent-primary rounded mt-0.5" />
                  <span>
                    <span className="block text-sm text-on-surface font-medium">Marcar como preparado/enviado en Shopify al entregar</span>
                    <span className="block text-[11px] text-stone-400">Al entregar o enviar desde aquí, se avisa a Shopify (y al cliente). Necesita el permiso de fulfillment{estado.permisos?.fulfillment ? ' (ya lo tiene)' : ' (hoy NO lo tiene; se omite)'}.</span>
                  </span>
                </label>
              </div>
            </div>

            {/* Ubicaciones */}
            <div>
              <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-3">De dónde se surte</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-1">Ubicación principal</p>
                  <select value={form.ubicacion_default} onChange={e => setForm({ ...form, ubicacion_default: e.target.value })} className={INPUT}>
                    {!form.ubicacion_default && <option value="">—</option>}
                    {opcionesUbic.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <p className="text-[11px] text-stone-400 mt-1">Primero se aparta aquí si alcanza el stock.</p>
                </div>
                <div>
                  <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-1">Si no alcanza, buscar en este orden</p>
                  <div className="space-y-1">
                    {form.ubicaciones_orden.length === 0 && <p className="text-xs text-stone-400">Sin ubicaciones.</p>}
                    {form.ubicaciones_orden.map((u, i) => (
                      <div key={u} className="flex items-center gap-2 bg-surface-container-low rounded-lg px-3 py-1.5 text-sm">
                        <span className="text-stone-400 text-xs w-4">{i + 1}.</span>
                        <span className="flex-1 truncate">{u}</span>
                        <button onClick={() => moverUbic(i, -1)} disabled={i === 0} className="p-1 rounded hover:bg-stone-200 disabled:opacity-30"><Icon name="keyboard_arrow_up" className="text-base" /></button>
                        <button onClick={() => moverUbic(i, 1)} disabled={i === form.ubicaciones_orden.length - 1} className="p-1 rounded hover:bg-stone-200 disabled:opacity-30"><Icon name="keyboard_arrow_down" className="text-base" /></button>
                        <button onClick={() => quitarUbic(i)} className="p-1 rounded hover:bg-stone-200 text-stone-400"><Icon name="close" className="text-base" /></button>
                      </div>
                    ))}
                    {ubicsPorAgregar.length > 0 && (
                      <select value="" onChange={e => agregarUbic(e.target.value)}
                        className="w-full px-3 py-1.5 bg-background border border-dashed border-outline-variant/30 rounded-lg outline-none focus:border-primary font-body text-xs text-stone-500">
                        <option value="">+ Agregar ubicación...</option>
                        {ubicsPorAgregar.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-outline-variant/10">
              <button onClick={() => setForm(formDe(estado))} disabled={saving}
                className="px-5 py-2.5 rounded-xl font-label text-xs font-bold uppercase tracking-widest bg-surface-container-low text-stone-500 hover:bg-stone-200 disabled:opacity-50">
                Deshacer
              </button>
              <button onClick={guardarConfig} disabled={saving}
                className={cn('px-5 py-2.5 rounded-xl font-label text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2',
                  saving ? 'bg-stone-200 text-stone-400 cursor-not-allowed' : 'bg-primary text-on-primary hover:opacity-90')}>
                {saving && <span className="w-3.5 h-3.5 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        )
      )}

      {/* Drawer de detalle */}
      {detalleId !== null && (
        <PedidoWebDetalle pedidoId={detalleId} onClose={() => setDetalleId(null)} onChange={refrescarTodo} usuario="panel" />
      )}
    </section>
  );
}
