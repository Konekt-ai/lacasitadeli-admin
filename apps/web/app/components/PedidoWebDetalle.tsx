'use client';

// ── Detalle de un pedido de la página web (Shopify) ────────────────────────────
// Drawer lateral autocontenido: baja su propio detalle de /api/pedidos-web,
// permite preparar (escaneo manual, código, ubicación), entregar/enviar (salida
// física de bodega), cancelar, cambiar tipo de entrega y dejar notas internas.
// Se abre desde "Pedidos web" y también desde Bodega (feed de movimientos).
import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '../lib/utils';
import { Icon } from './Icon';

// ── Tipos (locales: este módulo es el dueño de las formas del API) ─────────────
export interface StockUbic { ubicacion: string; fisico: number; apartado: number; disponible: number }
export interface LineaWeb {
  id: number; pedido_id: number; shopify_line_id: number | null; variant_id: number | null; product_id: number | null;
  codigo_barras: string | null; sku: string | null; titulo: string; variante: string | null;
  cantidad: number; cantidad_original: number; precio: number | null; descuento: number | null; total: number | null;
  ubicacion: string | null; ubicacion_fija: number; stock_al_reservar: number | null;
  faltante: number; escaneado: number; surtido_qty: number; sin_conteo: number;
  nombre_bodega: string | null; apartado_linea: number;
  stock_area: StockUbic | null; stock_otras: StockUbic[];
}
export interface ReservaWeb {
  id: number; codigo_barras: string; ubicacion: string; cantidad: number; pedido_id: number; linea_id: number | null;
  activa: number; creado: string; liberado: string | null; motivo_liberacion: string | null;
}
export interface EventoWeb {
  id: number; pedido_id: number; fecha: string; tipo: string; de: string | null; a: string | null; usuario: string | null; detalle: string | null;
}
export interface PedidoWebResumen {
  id: number; shopify_order_id: number; numero: string; order_number: number | null; fecha_pedido: string;
  cliente_nombre: string | null; cliente_email: string | null; cliente_telefono: string | null; direccion: string | null;
  tipo_entrega: string; entrega_detalle: string | null; metodo_pago: string | null; estado_pago: string | null;
  estado_envio_shopify: string | null; moneda: string | null;
  subtotal: number | null; envio: number | null; impuestos: number | null; descuentos: number | null; total: number | null;
  estado: string; ubicacion: string | null; reservado: number; surtido: number;
  fecha_surtido: string | null; fecha_cancelado: string | null; motivo_cancelacion: string | null;
  notas_cliente: string | null; notas_internas: string | null; tags: string | null; origen: string | null;
  shopify_fulfillment_ok: number | null; creado: string; actualizado: string;
  n_lineas: number; unidades: number; escaneadas: number; faltantes: number; sin_codigo: number;
}
export interface PedidoWebDetalleData extends PedidoWebResumen {
  lineas: LineaWeb[]; reservas: ReservaWeb[]; eventos: EventoWeb[]; completo: boolean; pago_ok: boolean;
}
export interface UbicacionTc52 { nombre: string; color: string | null; orden: number }

// ── Helpers compartidos (los usa también la pestaña "Pedidos web") ─────────────
export const PAGO_OK = new Set(['paid', 'partially_paid', 'authorized', 'partially_refunded']);
export const ESTADOS_FINALES = new Set(['entregado', 'enviado', 'cancelado']);

export const CHIP_ESTADO: Record<string, string> = {
  nuevo:      'bg-blue-100 text-blue-800',
  preparando: 'bg-amber-100 text-amber-800',
  listo:      'bg-emerald-100 text-emerald-800',
  entregado:  'bg-emerald-700 text-white',
  enviado:    'bg-emerald-700 text-white',
  cancelado:  'bg-stone-200 text-stone-500',
};
export const TXT_ESTADO: Record<string, string> = {
  nuevo: 'Nuevo', preparando: 'Preparando', listo: 'Listo', entregado: 'Entregado', enviado: 'Enviado', cancelado: 'Cancelado',
};
export const ENTREGA: Record<string, { icon: string; texto: string }> = {
  recoger: { icon: 'storefront',      texto: 'Recoger en tienda' },
  envio:   { icon: 'local_shipping',  texto: 'Envío a domicilio' },
  local:   { icon: 'directions_bike', texto: 'Entrega local' },
};
export function chipPago(estadoPago: string | null | undefined): { texto: string; clase: string } {
  const e = String(estadoPago || '').toLowerCase();
  if (e === 'paid' || e === 'authorized' || e === 'partially_paid' || e === 'partially_refunded') return { texto: 'Pagado', clase: 'bg-emerald-100 text-emerald-800' };
  if (e === 'pending')  return { texto: 'Pendiente',   clase: 'bg-amber-100 text-amber-800' };
  if (e === 'refunded') return { texto: 'Reembolsado', clase: 'bg-error/10 text-error' };
  if (e === 'voided')   return { texto: 'Anulado',     clase: 'bg-error/10 text-error' };
  return { texto: e || '—', clase: 'bg-stone-100 text-stone-500' };
}
export const money = (v: number | string | null | undefined) =>
  `$${Number(v || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Las fechas DATETIME llegan como ISO con "Z" pero SON hora de la tienda (CDMX):
// se formatean con timeZone UTC para no correrlas 6 horas.
export const fmtFecha = (x: string | null | undefined) =>
  x ? new Date(x).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }) : '—';
export const fmtHora = (x: string | null | undefined) =>
  x ? new Date(x).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : '—';

const TXT_EVENTO: Record<string, string> = {
  importado: 'Importado', pago: 'Pago', linea: 'Línea', apartado: 'Apartado', reapartado: 'Re-apartado', estado: 'Estado',
  escaneo: 'Escaneo', salida: 'Salida de bodega', cancelado: 'Cancelado', shopify: 'Shopify', ubicacion: 'Ubicación', entrega: 'Entrega',
};

const TIENDA_FALLBACK = 'https://admin.shopify.com/store/lacasitadeli';
const UBIC_FALLBACK = ['Casita 1', 'Casita 2', 'Bodega'];
// Caché de módulo: la tienda y las ubicaciones no cambian; así abrir varios
// pedidos seguidos no vuelve a pegarle al API.
let tiendaCache: string | null = null;
let ubicCache: string[] | null = null;

const CHIP = 'px-2 py-0.5 rounded-full text-[10px] font-label font-bold uppercase tracking-wide';
const INPUT = 'w-full px-3 py-2 bg-surface-container-low border border-outline-variant/20 rounded-xl focus:border-primary outline-none font-body text-sm';
const SELECT_SM = 'px-2 py-1 bg-surface-container-low border border-outline-variant/20 rounded-lg outline-none focus:border-primary font-body text-xs';
const BTN_SEC = 'px-3 py-1.5 rounded-lg font-label text-[10px] font-bold uppercase tracking-widest inline-flex items-center gap-1.5 bg-surface-container-low text-stone-500 hover:bg-stone-200 disabled:opacity-50 disabled:cursor-not-allowed';

export function PedidoWebDetalle({ pedidoId, onClose, onChange, usuario = 'panel' }: {
  pedidoId: number; onClose: () => void; onChange?: () => void; usuario?: string;
}) {
  const [pedido,   setPedido]   = useState<PedidoWebDetalleData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [accion,   setAccion]   = useState<string | null>(null); // acción en curso (clave)
  const [tienda,   setTienda]   = useState<string>(tiendaCache || TIENDA_FALLBACK);
  const [ubics,    setUbics]    = useState<string[]>(ubicCache || UBIC_FALLBACK);
  const [notas,    setNotas]    = useState('');
  const [codigoEdit, setCodigoEdit] = useState<Record<number, string>>({});

  const [notif, setNotif] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 3000);
  };

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      const res = await fetch(`/api/pedidos-web/pedidos/${pedidoId}`);
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error || 'No se pudo abrir el pedido'); return; }
      setError(null);
      setPedido(data);
      setNotas(data.notas_internas || '');
    } catch { setError('Error de conexión con la API'); }
    finally { setLoading(false); }
  }, [pedidoId]);

  useEffect(() => { cargar(); }, [cargar]);

  // Tienda (link a Shopify) y ubicaciones de la TC52: una sola vez.
  useEffect(() => {
    if (!tiendaCache) {
      fetch('/api/pedidos-web/estado').then(r => r.json()).then(d => {
        if (d && d.tienda) { tiendaCache = d.tienda; setTienda(d.tienda); }
      }).catch(() => { /* fallback */ });
    }
    if (!ubicCache) {
      fetch('/api/almacen/tc52/ubicaciones').then(r => r.json()).then((d: UbicacionTc52[]) => {
        if (Array.isArray(d) && d.length) { ubicCache = d.map(u => u.nombre); setUbics(ubicCache); }
      }).catch(() => { /* fallback */ });
    }
  }, []);

  // Aplica la respuesta de una acción: casi todas regresan el detalle completo.
  const aplicar = (data: { pedido?: PedidoWebDetalleData }) => {
    if (data && data.pedido) { setPedido(data.pedido); setNotas(data.pedido.notas_internas || ''); }
    else cargar(true);
    onChange?.();
  };

  const llamar = async (clave: string, url: string, method: 'POST' | 'PUT', body: Record<string, unknown>, okMsg?: string | ((d: Record<string, unknown>) => string)) => {
    setAccion(clave);
    try {
      const res = await fetch(`/api/pedidos-web/pedidos/${pedidoId}${url}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.error && data.ok !== false) {
        if (okMsg) notify(typeof okMsg === 'function' ? okMsg(data) : okMsg);
        aplicar(data);
        return data;
      }
      notify(data.error || 'No se pudo guardar', 'error');
      return null;
    } catch { notify('Error de conexión', 'error'); return null; }
    finally { setAccion(null); }
  };

  // ── Cambios de estado (con el flujo 402 "¿ya se cobró?") ──────────────────
  const cambiarEstado = async (estado: string, extra: Record<string, unknown> = {}) => {
    setAccion('estado');
    try {
      const post = (b: Record<string, unknown>) => fetch(`/api/pedidos-web/pedidos/${pedidoId}/estado`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado, usuario, ...b }),
      });
      let res = await post(extra);
      let data = await res.json().catch(() => ({}));
      if (res.status === 402 && data.requiereForzar) {
        if (!window.confirm('El pago sigue pendiente en Shopify. ¿Ya se cobró en tienda? Entregar de todos modos')) return;
        res = await post({ ...extra, forzar: true });
        data = await res.json().catch(() => ({}));
      }
      if (res.ok && !data.error && data.ok !== false) {
        let msg = `Pedido ${(TXT_ESTADO[estado] || estado).toLowerCase()}`;
        if (estado === 'entregado' || estado === 'enviado') {
          msg = data.yaSurtido
            ? 'Ya había salido de bodega; solo se cambió el estado'
            : `${TXT_ESTADO[estado]}: ${data.unidades ?? 0} pza(s) descontadas de bodega${data.sinConteo ? ` · ${data.sinConteo} línea(s) sin conteo` : ''}`;
        }
        if (estado === 'cancelado') msg = data.yaSurtido ? 'Cancelado (la mercancía ya había salido: no regresa sola)' : 'Pedido cancelado; el apartado se liberó';
        notify(msg);
        aplicar(data);
      } else notify(data.error || 'No se pudo cambiar el estado', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setAccion(null); }
  };

  const marcarListo = () => {
    if (!pedido) return;
    if (!pedido.completo && !window.confirm(`Aún faltan piezas por escanear (${pedido.escaneadas} de ${pedido.unidades}). ¿Marcar como listo de todos modos?`)) return;
    cambiarEstado('listo');
  };

  const entregar = () => {
    if (!pedido) return;
    const final = pedido.tipo_entrega === 'recoger' ? 'entregado' : 'enviado';
    const porUbic: Record<string, number> = {};
    for (const l of pedido.lineas) {
      if (!l.codigo_barras || l.cantidad <= 0) continue;
      const u = l.ubicacion || pedido.ubicacion || 'bodega';
      porUbic[u] = (porUbic[u] || 0) + l.cantidad;
    }
    const partes = Object.entries(porUbic).map(([u, n]) => `${n} piezas de ${u}`);
    let msg = partes.length ? `Se descontarán ${partes.join(' y ')}.` : 'No hay líneas con código: no se descontará nada de bodega.';
    if (!pedido.completo) msg += `\nOjo: solo se han escaneado ${pedido.escaneadas} de ${pedido.unidades} piezas.`;
    if (pedido.sin_codigo > 0) msg += `\n${pedido.sin_codigo} línea(s) sin código NO se descontarán.`;
    msg += `\n¿Marcar el pedido como ${TXT_ESTADO[final].toLowerCase()}?`;
    if (!window.confirm(msg)) return;
    cambiarEstado(final);
  };

  const cancelar = () => {
    if (!pedido) return;
    const motivo = window.prompt('Motivo de la cancelación (opcional):', '');
    if (motivo === null) return;
    if (pedido.surtido && !window.confirm('Este pedido ya salió de bodega. Al cancelarlo la mercancía NO regresa sola (habría que registrar una entrada con la TC52). ¿Cancelar de todos modos?')) return;
    cambiarEstado('cancelado', motivo.trim() ? { motivo: motivo.trim() } : {});
  };

  // ── Otras acciones ──────────────────────────────────────────────────────────
  const cambiarEntrega   = (t: string) => llamar('entrega', '/entrega', 'POST', { tipo_entrega: t }, 'Tipo de entrega guardado');
  const cambiarUbicacion = (u: string) => llamar('ubicacion', '/ubicacion', 'POST', { ubicacion: u }, `Se surtirá desde ${u}`);
  const reapartar        = () => llamar('reservar', '/reservar', 'POST', {}, d => String(d.resumen || 'Apartado recalculado'));
  const reiniciarEscaneo = () => {
    if (!window.confirm('¿Reiniciar el escaneo de todas las líneas a 0?')) return;
    llamar('reset', '/escaneo/reset', 'POST', {}, 'Escaneo reiniciado');
  };
  const setEscaneado = (l: LineaWeb, n: number) =>
    llamar(`esc-${l.id}`, `/lineas/${l.id}/escaneado`, 'POST', { escaneado: Math.max(0, Math.min(l.cantidad, n)) });
  const guardarCodigo = (l: LineaWeb) => {
    const c = (codigoEdit[l.id] || '').trim();
    if (!c) { notify('Escribe el código de barras', 'error'); return; }
    llamar(`cod-${l.id}`, `/lineas/${l.id}`, 'PUT', { codigo_barras: c }, 'Código guardado y apartado recalculado')
      .then(d => { if (d) setCodigoEdit(prev => { const n = { ...prev }; delete n[l.id]; return n; }); });
  };
  const cambiarUbicLinea = (l: LineaWeb, u: string) =>
    llamar(`ubl-${l.id}`, `/lineas/${l.id}`, 'PUT', { ubicacion: u || null }, u ? `Línea: se surtirá desde ${u}` : 'Ubicación de la línea liberada');
  const guardarNota = async () => {
    if (!pedido || notas === (pedido.notas_internas || '')) return;
    try {
      const res = await fetch(`/api/pedidos-web/pedidos/${pedidoId}/nota`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notas_internas: notas, usuario }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.error) { setPedido({ ...pedido, notas_internas: notas }); notify('Nota guardada'); onChange?.(); }
      else notify(data.error || 'No se pudo guardar la nota', 'error');
    } catch { notify('Error de conexión', 'error'); }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const esFinal   = !!pedido && ESTADOS_FINALES.has(pedido.estado);
  const ocupado   = accion !== null;
  const pago      = chipPago(pedido?.estado_pago);
  const entrega   = ENTREGA[pedido?.tipo_entrega || ''] || { icon: 'help', texto: pedido?.tipo_entrega || '—' };
  const pct       = pedido && pedido.unidades > 0 ? Math.min(100, Math.round((pedido.escaneadas / pedido.unidades) * 100)) : 0;
  // El select siempre debe poder mostrar la ubicación actual aunque no esté en la TC52.
  const opcionesUbic = (extra: (string | null | undefined)[]) =>
    Array.from(new Set([...ubics, ...extra.filter((x): x is string => !!x)]));
  const finalLabel = pedido?.tipo_entrega === 'recoger' ? 'Entregado' : 'Enviado';

  return (
    <>
      {notif && (
        <div className={cn('fixed top-6 right-6 z-[450] px-5 py-3 rounded-xl shadow-xl flex items-center gap-2 font-label text-sm',
          notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error')}>
          <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
          {notif.msg}
        </div>
      )}
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[400]" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full sm:w-[520px] bg-surface z-[401] flex flex-col shadow-2xl">
        {/* Encabezado */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-outline-variant/10 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-label text-[10px] uppercase tracking-widest text-stone-400">Pedido de la página web</p>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-serif italic text-primary text-lg">{pedido?.numero || `#${pedidoId}`}</h3>
              {pedido && (
                <span className={cn(CHIP, CHIP_ESTADO[pedido.estado] || 'bg-stone-100 text-stone-500')}>{TXT_ESTADO[pedido.estado] || pedido.estado}</span>
              )}
            </div>
            {pedido && (
              <p className="text-[11px] text-stone-400 mt-0.5">
                {fmtFecha(pedido.fecha_pedido)}
                {' · '}
                <a href={`${tienda}/orders/${pedido.shopify_order_id}`} target="_blank" rel="noreferrer"
                  className="text-primary underline inline-flex items-center gap-0.5">
                  Ver en Shopify <Icon name="open_in_new" className="text-xs" />
                </a>
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-full flex-shrink-0">
            <Icon name="close" className="text-xl text-stone-500" />
          </button>
        </div>

        {loading && !pedido ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        ) : error && !pedido ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <Icon name="cloud_off" className="text-5xl text-stone-300 mb-3" />
            <p className="text-sm text-error mb-4">{error}</p>
            <button onClick={() => cargar()} className={BTN_SEC}><Icon name="refresh" className="text-sm" /> Reintentar</button>
          </div>
        ) : pedido && (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Cliente */}
              <div>
                <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-2">Cliente</p>
                <div className="bg-surface-container-low/60 rounded-xl p-4 space-y-1.5 text-sm">
                  <p className="font-medium text-on-surface">{pedido.cliente_nombre || `Cliente ${pedido.numero}`}</p>
                  {pedido.cliente_telefono && (
                    <p className="flex items-center gap-1.5"><Icon name="phone" className="text-sm text-stone-400" />
                      <a href={`tel:${pedido.cliente_telefono}`} className="text-primary underline">{pedido.cliente_telefono}</a></p>
                  )}
                  {pedido.cliente_email && (
                    <p className="flex items-center gap-1.5 min-w-0"><Icon name="mail" className="text-sm text-stone-400" />
                      <a href={`mailto:${pedido.cliente_email}`} className="text-primary underline truncate">{pedido.cliente_email}</a></p>
                  )}
                  {pedido.direccion && (
                    <p className="flex items-start gap-1.5"><Icon name="place" className="text-sm text-stone-400 mt-0.5" /><span>{pedido.direccion}</span></p>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <Icon name={entrega.icon} className="text-base text-stone-500" />
                    <select value={pedido.tipo_entrega || 'recoger'} onChange={e => cambiarEntrega(e.target.value)} disabled={ocupado || esFinal}
                      className={SELECT_SM}>
                      <option value="recoger">Recoger en tienda</option>
                      <option value="envio">Envío a domicilio</option>
                      <option value="local">Entrega local</option>
                    </select>
                    {pedido.entrega_detalle && <span className="text-xs text-stone-500 truncate" title={pedido.entrega_detalle}>{pedido.entrega_detalle}</span>}
                  </div>
                  {pedido.notas_cliente && (
                    <div className="mt-2 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 text-sm flex gap-2">
                      <Icon name="chat" className="text-base flex-shrink-0" />
                      <div><p className="text-[10px] font-label font-bold uppercase tracking-widest">Nota del cliente</p><p>{pedido.notas_cliente}</p></div>
                    </div>
                  )}
                </div>
              </div>

              {/* Pago */}
              <div>
                <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-2">Pago</p>
                <div className="bg-surface-container-low/60 rounded-xl p-4 space-y-1.5 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-stone-500">Estado del pago</span>
                    <span className="flex items-center gap-2">
                      {pedido.metodo_pago && <span className="text-xs text-stone-500">{pedido.metodo_pago}</span>}
                      <span className={cn(CHIP, pago.clase)}>{pago.texto}</span>
                    </span>
                  </div>
                  <div className="flex justify-between"><span className="text-stone-500">Subtotal</span><span>{money(pedido.subtotal)}</span></div>
                  <div className="flex justify-between"><span className="text-stone-500">Envío</span><span>{money(pedido.envio)}</span></div>
                  {Number(pedido.descuentos) > 0 && <div className="flex justify-between"><span className="text-stone-500">Descuentos</span><span>−{money(pedido.descuentos)}</span></div>}
                  {Number(pedido.impuestos) > 0 && <div className="flex justify-between"><span className="text-stone-500">Impuestos</span><span>{money(pedido.impuestos)}</span></div>}
                  <div className="flex justify-between border-t border-outline-variant/10 pt-1.5">
                    <span className="text-stone-500">Total</span><span className="font-serif font-bold text-primary text-base">{money(pedido.total)}</span>
                  </div>
                </div>
              </div>

              {/* Surtido */}
              <div>
                <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-2">Surtido</p>
                <div className="bg-surface-container-low/60 rounded-xl p-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-stone-500">Surtir desde</span>
                    <select value={pedido.ubicacion || ''} onChange={e => e.target.value && cambiarUbicacion(e.target.value)}
                      disabled={ocupado || !!pedido.surtido || esFinal} className={SELECT_SM}>
                      {!pedido.ubicacion && <option value="">—</option>}
                      {opcionesUbic([pedido.ubicacion]).map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-stone-500">Escaneado con la TC52</span>
                      <span className={cn('font-medium', pedido.completo ? 'text-emerald-700' : 'text-on-surface')}>
                        {pedido.escaneadas} / {pedido.unidades} pzas{pedido.completo && pedido.unidades > 0 ? ' · completo' : ''}
                      </span>
                    </div>
                    <div className="h-2 bg-stone-200 rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full transition-all', pedido.completo ? 'bg-emerald-500' : 'bg-amber-400')} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {pedido.faltantes > 0 && <span className={cn(CHIP, 'bg-error/10 text-error')}>Faltan {pedido.faltantes} pzas</span>}
                    {pedido.sin_codigo > 0 && <span className={cn(CHIP, 'bg-error/10 text-error')}>{pedido.sin_codigo} sin código</span>}
                    {!!pedido.surtido && <span className={cn(CHIP, 'bg-emerald-100 text-emerald-800')}>Ya salió de bodega</span>}
                    {!pedido.reservado && !pedido.surtido && !esFinal && <span className={cn(CHIP, 'bg-stone-200 text-stone-600')}>Sin apartar</span>}
                  </div>
                  {!esFinal && (
                    <div className="flex gap-2">
                      <button onClick={reapartar} disabled={ocupado} className={BTN_SEC}>
                        {accion === 'reservar' ? <span className="w-3 h-3 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" /> : <Icon name="sync" className="text-sm" />}
                        Re-apartar
                      </button>
                      <button onClick={reiniciarEscaneo} disabled={ocupado} className={BTN_SEC}>
                        <Icon name="restart_alt" className="text-sm" /> Reiniciar escaneo
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] text-stone-400">Escanear solo valida piezas. El stock se descuenta al marcar el pedido como {finalLabel.toLowerCase()}.</p>
                </div>
              </div>

              {/* Líneas */}
              <div>
                <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-2">Productos ({pedido.n_lineas})</p>
                <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase text-[10px] tracking-widest">
                        <tr>
                          <th className="px-3 py-2 text-left">Producto</th>
                          <th className="px-2 py-2 text-right">Cant.</th>
                          <th className="px-2 py-2 text-center">Escaneado</th>
                          <th className="px-2 py-2 text-left">Ubicación</th>
                          <th className="px-3 py-2 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-container">
                        {pedido.lineas.map(l => {
                          const completa = l.cantidad <= 0 || l.escaneado >= l.cantidad;
                          const otras = l.stock_otras.filter(s => Number(s.disponible) > 0);
                          const ocupadaLinea = accion === `esc-${l.id}` || accion === `cod-${l.id}` || accion === `ubl-${l.id}`;
                          return (
                            <tr key={l.id} className={cn(l.cantidad <= 0 && 'opacity-50')}>
                              <td className="px-3 py-2 align-top min-w-[180px]">
                                <p className="font-medium text-on-surface">{l.titulo}{l.variante && l.variante !== 'Default Title' ? <span className="text-stone-500"> · {l.variante}</span> : null}</p>
                                {l.nombre_bodega && l.nombre_bodega !== l.titulo && <p className="text-[10px] text-stone-400">En bodega: {l.nombre_bodega}</p>}
                                {l.codigo_barras ? (
                                  <p className="text-[11px] text-stone-400 font-mono">{l.codigo_barras}</p>
                                ) : (
                                  <div className="mt-1">
                                    <span className={cn(CHIP, 'bg-error/10 text-error')}>Sin código</span>
                                    {!esFinal && (
                                      <div className="flex gap-1 mt-1">
                                        <input value={codigoEdit[l.id] ?? ''} onChange={e => setCodigoEdit(prev => ({ ...prev, [l.id]: e.target.value }))}
                                          onKeyDown={e => { if (e.key === 'Enter') guardarCodigo(l); }}
                                          placeholder="Código de barras" inputMode="numeric"
                                          className="w-32 px-2 py-1 bg-surface-container-low border border-outline-variant/20 rounded-lg outline-none focus:border-primary font-mono text-xs" />
                                        <button onClick={() => guardarCodigo(l)} disabled={ocupado}
                                          className="px-2 py-1 rounded-lg font-label text-[10px] font-bold uppercase tracking-widest bg-primary text-on-primary hover:opacity-90 disabled:opacity-50">
                                          Guardar
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {l.stock_area && (
                                  <p className="text-[10px] text-stone-500 mt-1">
                                    Stock en {l.stock_area.ubicacion}: disp {l.stock_area.disponible} · fís {l.stock_area.fisico} · apart {l.stock_area.apartado}
                                  </p>
                                )}
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {l.faltante > 0 && <span className={cn(CHIP, 'bg-error/10 text-error')}>Faltan {l.faltante} — sin stock contado</span>}
                                  {!!l.sin_conteo && <span className={cn(CHIP, 'bg-purple-100 text-purple-700')}>No se descontó (sin conteo)</span>}
                                </div>
                                {otras.length > 0 && (l.faltante > 0 || !l.stock_area || Number(l.stock_area.disponible) < l.cantidad) && (
                                  <p className="text-[10px] text-amber-700 mt-1">Hay {otras.map(s => `${s.disponible} en ${s.ubicacion}`).join(', ')}</p>
                                )}
                              </td>
                              <td className="px-2 py-2 text-right align-top font-medium">
                                {l.cantidad}
                                {l.cantidad !== l.cantidad_original && <p className="text-[10px] text-stone-400 line-through">{l.cantidad_original}</p>}
                              </td>
                              <td className="px-2 py-2 align-top">
                                <div className="flex items-center justify-center gap-1">
                                  {!esFinal && (
                                    <button onClick={() => setEscaneado(l, l.escaneado - 1)} disabled={ocupado || l.escaneado <= 0}
                                      className="w-6 h-6 rounded-md bg-surface-container-low text-stone-600 hover:bg-stone-200 disabled:opacity-40 flex items-center justify-center">
                                      <Icon name="remove" className="text-sm" />
                                    </button>
                                  )}
                                  <span className={cn('min-w-[36px] text-center font-medium tabular-nums inline-flex items-center justify-center gap-0.5', completa && l.cantidad > 0 ? 'text-emerald-700' : 'text-on-surface')}>
                                    {ocupadaLinea ? <span className="w-3 h-3 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" /> : `${l.escaneado}/${l.cantidad}`}
                                    {completa && l.cantidad > 0 && !ocupadaLinea && <Icon name="check_circle" className="text-sm" />}
                                  </span>
                                  {!esFinal && (
                                    <button onClick={() => setEscaneado(l, l.escaneado + 1)} disabled={ocupado || l.escaneado >= l.cantidad}
                                      className="w-6 h-6 rounded-md bg-surface-container-low text-stone-600 hover:bg-stone-200 disabled:opacity-40 flex items-center justify-center">
                                      <Icon name="add" className="text-sm" />
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-2 align-top">
                                <select value={l.ubicacion || ''} onChange={e => cambiarUbicLinea(l, e.target.value)}
                                  disabled={ocupado || !!pedido.surtido || esFinal} className={SELECT_SM}>
                                  <option value="">(la del pedido)</option>
                                  {opcionesUbic([l.ubicacion]).map(u => <option key={u} value={u}>{u}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-2 text-right align-top">
                                <p className="font-medium">{money(l.total)}</p>
                                <p className="text-[10px] text-stone-400">{money(l.precio)} c/u</p>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Notas internas */}
              <div>
                <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-1">Notas internas</p>
                <textarea value={notas} onChange={e => setNotas(e.target.value)} onBlur={guardarNota} rows={3} maxLength={500}
                  placeholder="Solo las ve el equipo de la tienda. Se guarda al salir del cuadro."
                  className={cn(INPUT, 'resize-none')} />
              </div>

              {/* Historial */}
              <div>
                <p className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest mb-2">Historial</p>
                {pedido.eventos.length === 0 ? (
                  <p className="text-xs text-stone-400">Sin movimientos.</p>
                ) : (
                  <div className="space-y-2">
                    {pedido.eventos.map(e => (
                      <div key={e.id} className="flex gap-3 text-xs">
                        <div className="w-1.5 h-1.5 rounded-full bg-stone-300 mt-1.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-stone-400">{fmtFecha(e.fecha)}{e.usuario ? ` · ${e.usuario}` : ''}</p>
                          <p>
                            <span className="font-bold text-on-surface">{TXT_EVENTO[e.tipo] || e.tipo}</span>
                            {(e.de || e.a) && <span className="text-stone-600"> {e.de ? `${TXT_ESTADO[e.de] || e.de} → ` : ''}{TXT_ESTADO[e.a || ''] || e.a || ''}</span>}
                            {e.detalle && <span className="text-stone-500"> — {e.detalle}</span>}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Pie: acciones según estado */}
            <div className="flex-shrink-0 p-4 border-t border-outline-variant/10 space-y-2">
              {esFinal ? (
                <>
                  <div className="bg-surface-container-low/60 rounded-xl p-3 text-sm space-y-1">
                    {pedido.estado === 'cancelado' ? (
                      <>
                        <p className="flex items-center gap-1.5 text-stone-600"><Icon name="cancel" className="text-base" /> Cancelado el {fmtFecha(pedido.fecha_cancelado)}</p>
                        {pedido.motivo_cancelacion && <p className="text-xs text-stone-500">Motivo: {pedido.motivo_cancelacion}</p>}
                      </>
                    ) : (
                      <p className="flex items-center gap-1.5 text-emerald-700"><Icon name="task_alt" className="text-base" /> {TXT_ESTADO[pedido.estado]} el {fmtFecha(pedido.fecha_surtido)}</p>
                    )}
                    {pedido.surtido ? <p className="text-xs text-stone-500">La mercancía ya se descontó de bodega.</p> : null}
                  </div>
                  <button onClick={onClose}
                    className="w-full py-2.5 rounded-xl font-label text-xs font-bold uppercase tracking-widest bg-surface-container-low text-stone-500 hover:bg-stone-200">
                    Cerrar
                  </button>
                </>
              ) : (
                <>
                  <button onClick={entregar} disabled={ocupado}
                    className={cn('w-full py-2.5 rounded-xl font-label text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2',
                      ocupado ? 'bg-stone-200 text-stone-400 cursor-not-allowed' : 'bg-emerald-600 text-white hover:opacity-90')}>
                    {accion === 'estado' ? <span className="w-3.5 h-3.5 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" /> : <Icon name={entrega.icon} className="text-base" />}
                    {finalLabel}
                  </button>
                  <div className="flex gap-2">
                    {pedido.estado === 'nuevo' && (
                      <button onClick={() => cambiarEstado('preparando')} disabled={ocupado}
                        className={cn('flex-1 py-2.5 rounded-xl font-label text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2',
                          ocupado ? 'bg-stone-200 text-stone-400 cursor-not-allowed' : 'bg-primary text-on-primary hover:opacity-90')}>
                        <Icon name="play_arrow" className="text-base" /> Empezar a preparar
                      </button>
                    )}
                    {pedido.estado === 'preparando' && (
                      <button onClick={marcarListo} disabled={ocupado}
                        className={cn('flex-1 py-2.5 rounded-xl font-label text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2',
                          ocupado ? 'bg-stone-200 text-stone-400 cursor-not-allowed' : 'bg-primary text-on-primary hover:opacity-90')}>
                        <Icon name="check" className="text-base" /> Marcar listo
                      </button>
                    )}
                    <button onClick={cancelar} disabled={ocupado}
                      className="flex-1 py-2.5 rounded-xl font-label text-xs font-bold uppercase tracking-widest bg-surface-container-low text-error hover:bg-error/10 disabled:opacity-50">
                      Cancelar pedido
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default PedidoWebDetalle;
