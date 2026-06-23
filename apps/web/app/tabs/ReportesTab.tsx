'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { DayCalendar } from '../components/DayCalendar';
import { TicketDetalleModal, type TicketKey } from '../components/TicketDetalleModal';
import dynamic from 'next/dynamic';
import { cn } from '../lib/utils';
import { Icon } from '../components/Icon';
import type { PolizaTicket, PolizaSummary } from '../lib/types';

const ExportModal = dynamic(() => import('../components/ExportModal'), { ssr: false });

interface SinCostoItem {
  codigo: string; nombre: string; categoria: string;
  precio: number; costoReposicion: number; stock: number;
}
interface SinCostoReporte {
  total: number;
  items: SinCostoItem[];
  porCategoria: { categoria: string; n: number }[];
}

// ── Tipos Conteo ──────────────────────────────────────────────────────────────
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
    setLoadingPreview(true); setPreview([]);
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
    setSyncing(true); setConfirming(false);
    try {
      const res  = await fetch('/api/bodega/conteo/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify({ startDate, endDate }),
      });
      const data = await res.json();
      if (res.ok) { notify(data.message || 'Sincronización completada'); setPreview([]); fetchHistorial(); }
      else notify(data.error || 'Error al sincronizar', 'error');
    } catch { notify('Error de conexión', 'error'); }
    finally { setSyncing(false); }
  };

  const totalUnidades = preview.reduce((s, p) => s + (Number(p.total_vendido) || 0), 0);
  const negativeCount = preview.filter(p => p.stock_actual - p.total_vendido < 0).length;

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

      <p className="text-[10px] font-label text-stone-400 mb-5 flex items-center gap-1.5">
        <Icon name="info" className="text-sm text-stone-300" />
        Lee TicketsPS y descuenta del inventario en NovaCaja. No apliques el mismo periodo dos veces.
      </p>

      {loadingPreview && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {!loadingPreview && preview.length > 0 && (
        <div>
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
                        <td className="px-4 py-2.5"><span className="text-[10px] font-label text-stone-400">{item.art_codigo}</span></td>
                        <td className="px-4 py-2.5"><p className="text-sm font-body text-on-surface truncate max-w-[220px]">{item.nombre || item.art_codigo}</p></td>
                        <td className="px-4 py-2.5 text-center text-xs font-body text-stone-400">{item.num_tickets}</td>
                        <td className="px-4 py-2.5 text-center"><span className="font-serif font-bold text-secondary">{item.total_vendido}</span></td>
                        <td className="px-4 py-2.5 text-center text-sm font-body text-stone-500">{item.stock_actual}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={cn('font-serif font-bold', resultante < 0 ? 'text-error' : 'text-primary')}>{resultante}</span>
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

      {!loadingPreview && preview.length === 0 && (
        <div className="py-14 flex flex-col items-center text-stone-300 border border-dashed border-stone-200 rounded-xl mb-6">
          <Icon name="calculate" className="text-5xl opacity-20 mb-3" />
          <p className="text-sm font-label uppercase tracking-widest">Selecciona un periodo y haz clic en Vista Previa</p>
        </div>
      )}

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

// ── Vista de Salidas del almacén ──────────────────────────────────────────────
interface SalidaRow {
  id:            number;
  codigo:        string;
  nombre:        string | null;
  cantidad:      number;
  area:          string;
  stock_antes:   number;
  stock_despues: number;
  notas:         string | null;
  fecha:         string;
}

interface BusquedaProducto {
  codigo: string;
  nombre: string;
  stock:  number;
}

function SalidaView() {
  const today = new Date().toISOString().slice(0, 10);
  const [fecha,   setFecha]   = useState(today);
  const [rows,    setRows]    = useState<SalidaRow[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Formulario de nueva salida ─────────────────────────────────────────────
  const [showForm,    setShowForm]    = useState(false);
  const [query,       setQuery]       = useState('');
  const [results,     setResults]     = useState<BusquedaProducto[]>([]);
  const [searching,   setSearching]   = useState(false);
  const [selected,    setSelected]    = useState<BusquedaProducto | null>(null);
  const [cantidad,    setCantidad]    = useState('1');
  const [notas,       setNotas]       = useState('');
  const [saving,      setSaving]      = useState(false);
  const [notif,       setNotif]       = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setNotif({ msg, type }); setTimeout(() => setNotif(null), 3500);
  };

  const fetchSalidas = useCallback(async (f: string) => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/almacen/movimientos/historial?tipo=salida&fecha=${f}&limit=300`);
      if (!res.ok) return;
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSalidas(fecha); }, [fecha, fetchSalidas]);

  // Buscar productos con debounce
  const searchRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    if (query.length < 2) { setResults([]); return; }
    searchRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res  = await fetch(`/api/almacen/buscar?q=${encodeURIComponent(query)}`);
        if (!res.ok) return;
        const data = await res.json();
        setResults(Array.isArray(data) ? data.slice(0, 8) : []);
      } catch { /* silent */ }
      finally { setSearching(false); }
    }, 300);
  }, [query]);

  const seleccionar = (p: BusquedaProducto) => {
    setSelected(p);
    setQuery(p.nombre);
    setResults([]);
  };

  const registrar = async () => {
    if (!selected || !cantidad || parseFloat(cantidad) <= 0) {
      notify('Selecciona un producto y una cantidad válida', 'error'); return;
    }
    setSaving(true);
    try {
      const res  = await fetch('/api/almacen/salida', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          codigo:   selected.codigo,
          nombre:   selected.nombre,
          cantidad: parseFloat(cantidad),
          area:     'bodega',
          notas:    notas.trim() || 'Retiro autorizado',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        notify(`Retiro registrado: ${selected.nombre} (${cantidad} uds)`);
        setSelected(null); setQuery(''); setCantidad('1'); setNotas('');
        fetchSalidas(today);
      } else {
        notify(data.mensaje || data.ok === false ? (data.mensaje || 'Error') : 'Error', 'error');
      }
    } catch { notify('Error de conexión', 'error'); }
    finally { setSaving(false); }
  };

  const totalUds = rows.reduce((s, r) => s + Number(r.cantidad), 0);

  return (
    <div>
      {/* Notificacion */}
      {notif && (
        <div className={cn(
          'fixed top-4 right-4 z-[300] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-label font-bold',
          notif.type === 'success' ? 'bg-primary text-on-primary' : 'bg-error text-on-error'
        )}>
          <Icon name={notif.type === 'success' ? 'check_circle' : 'error'} className="text-lg" />
          {notif.msg}
        </div>
      )}

      {/* ── Formulario de registro ────────────────────────────────────────── */}
      <div className="mb-6">
        <button onClick={() => setShowForm(v => !v)}
          className="px-4 py-2.5 bg-error text-on-error rounded-xl text-xs font-label font-bold uppercase tracking-widest flex items-center gap-2 shadow-md hover:bg-error/90 transition-all mb-4">
          <Icon name={showForm ? 'close' : 'output'} className="text-base" />
          {showForm ? 'Cancelar' : 'Registrar Retiro'}
        </button>

        {showForm && (
          <div className="bg-surface-container-low rounded-2xl border border-outline-variant/10 p-5 space-y-4">
            <h4 className="text-[10px] font-label font-bold uppercase tracking-widest text-stone-500">Nuevo Retiro Autorizado</h4>

            {/* Buscador de producto */}
            <div className="relative">
              <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Producto</label>
              <div className="relative">
                <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-xl" />
                {searching && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                )}
                <input
                  value={query}
                  onChange={e => { setQuery(e.target.value); setSelected(null); }}
                  placeholder="Buscar por nombre o código..."
                  className="w-full pl-10 pr-10 py-2.5 bg-background border border-outline-variant/20 rounded-xl text-sm font-body outline-none focus:border-primary transition-colors"
                />
              </div>
              {results.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-surface rounded-xl border border-outline-variant/10 shadow-xl overflow-hidden">
                  {results.map(p => (
                    <button key={p.codigo} onClick={() => seleccionar(p)}
                      className="w-full px-4 py-3 text-left hover:bg-surface-container-low transition-colors flex items-center justify-between gap-3 border-b border-surface-container last:border-0">
                      <div>
                        <p className="text-sm font-body text-on-surface">{p.nombre}</p>
                        <p className="text-[10px] font-label text-stone-400">{p.codigo}</p>
                      </div>
                      <span className={cn('text-xs font-label font-bold flex-shrink-0', p.stock <= 0 ? 'text-error' : 'text-stone-500')}>
                        {p.stock} en stock
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Producto seleccionado */}
            {selected && (
              <div className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-body text-on-surface font-bold">{selected.nombre}</p>
                  <p className="text-[10px] font-label text-stone-400">{selected.codigo} · {selected.stock} en stock</p>
                </div>
                <button onClick={() => { setSelected(null); setQuery(''); }}
                  className="p-1 text-stone-400 hover:text-stone-600 rounded-full">
                  <Icon name="close" className="text-sm" />
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Cantidad</label>
                <input type="number" min="1" step="1" value={cantidad}
                  onChange={e => setCantidad(e.target.value)}
                  className="w-full px-3 py-2.5 bg-background border border-outline-variant/20 rounded-xl text-sm font-body outline-none focus:border-primary transition-colors" />
              </div>
              <div>
                <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Motivo / Notas</label>
                <input value={notas} onChange={e => setNotas(e.target.value)}
                  placeholder="Ej: uso personal, cocina..."
                  className="w-full px-3 py-2.5 bg-background border border-outline-variant/20 rounded-xl text-sm font-body outline-none focus:border-primary transition-colors" />
              </div>
            </div>

            <button onClick={registrar} disabled={saving || !selected}
              className={cn(
                'w-full py-3 rounded-xl text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all',
                saving || !selected
                  ? 'bg-stone-200 text-stone-400 cursor-not-allowed'
                  : 'bg-error text-on-error hover:bg-error/90 shadow-md'
              )}>
              {saving
                ? <div className="w-4 h-4 border-2 border-stone-400/30 border-t-stone-400 rounded-full animate-spin" />
                : <Icon name="output" className="text-base" />}
              {saving ? 'Registrando...' : 'Confirmar retiro'}
            </button>
          </div>
        )}
      </div>

      {/* ── Historial del día ─────────────────────────────────────────────── */}
      <div className="flex items-end gap-3 mb-4 flex-wrap">
        <div>
          <label className="text-[10px] font-label uppercase tracking-widest text-stone-500 mb-1 block">Ver historial del día</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
            className="px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body outline-none focus:border-primary transition-colors" />
        </div>
        <button onClick={() => fetchSalidas(fecha)} disabled={loading}
          className="p-2 rounded-lg hover:bg-surface-container-low text-stone-400 hover:text-primary transition-all">
          <Icon name="refresh" className={cn('text-base', loading && 'animate-spin')} />
        </button>
        {rows.length > 0 && (
          <span className="ml-auto text-[10px] font-label text-stone-400">
            {rows.length} movimiento{rows.length !== 1 ? 's' : ''} · {totalUds} uds
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="py-12 flex flex-col items-center text-stone-300 border border-dashed border-stone-200 rounded-xl">
          <Icon name="output" className="text-5xl opacity-20 mb-3" />
          <p className="text-sm font-label uppercase tracking-widest">Sin retiros en esta fecha</p>
        </div>
      ) : (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden">
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-left">
              <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container sticky top-0">
                <tr>
                  <th className="px-4 py-3">Hora</th>
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3 text-center">Cant.</th>
                  <th className="px-4 py-3 text-center">Stock →</th>
                  <th className="px-4 py-3">Notas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-background transition-colors">
                    <td className="px-4 py-2.5 text-xs text-stone-400 font-body whitespace-nowrap">
                      {new Date(r.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="text-sm font-body text-on-surface truncate max-w-[200px]">{r.nombre || r.codigo}</p>
                      <p className="text-[10px] font-label text-stone-400">{r.codigo}</p>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="font-serif font-bold text-error">−{r.cantidad}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={cn('font-serif text-sm', r.stock_despues < 0 ? 'text-error font-bold' : 'text-stone-500')}>
                        {r.stock_antes} → {r.stock_despues}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[11px] font-body text-stone-400 truncate max-w-[160px]">
                      {r.notas || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-surface-container bg-surface-container-low/30">
            <p className="text-[10px] font-label text-stone-400 uppercase tracking-widest">
              {rows.length} retiros · {totalUds} unidades
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

interface LiveTicket {
  folio:        number;
  folTda?:      number | string;
  folEst?:      number | string;
  folDoc?:      number | string;
  fecha:        string;
  cajero:       string | null;
  vendedor:     string | null;
  importeTotal: number;
}

type TimeFilter = 'Hoy' | 'Esta semana' | 'Este mes';

const PERIOD_CONFIG: Record<TimeFilter, { period: string; limit: number; label: string }> = {
  'Hoy':         { period: 'day',   limit: 2000, label: 'hoy' },
  'Esta semana': { period: 'week',  limit: 5000, label: 'esta semana' },
  'Este mes':    { period: 'month', limit: 7000, label: 'este mes' },
};

interface Props {
  timeFilter: string;
}

export default function ReportesTab({ timeFilter }: Props) {
  const [reportView, setReportView] = useState<'polizas' | 'conteo' | 'salida'>('polizas');
  const [ticketModal, setTicketModal] = useState<TicketKey | null>(null);
  const [tickets,          setTickets]          = useState<PolizaTicket[]>([]);
  const [summary,          setSummary]          = useState<PolizaSummary | null>(null);
  const [totalTickets,     setTotalTickets]      = useState(0);
  const [loading,          setLoading]           = useState(false);
  const [showExport,       setShowExport]        = useState(false);
  const [liveTickets,      setLiveTickets]       = useState<LiveTicket[]>([]);
  const [liveLoading,      setLiveLoading]       = useState(false);
  const [lastLiveRefresh,  setLastLiveRefresh]   = useState<Date | null>(null);
  const [showCostTable,    setShowCostTable]     = useState(true);
  const [desgloseDate,     setDesgloseDate]      = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [showSinCosto,     setShowSinCosto]      = useState(false);
  const [sinCosto,         setSinCosto]          = useState<SinCostoReporte | null>(null);
  const [sinCostoLoading,  setSinCostoLoading]   = useState(false);

  const config = PERIOD_CONFIG[timeFilter as TimeFilter] ?? PERIOD_CONFIG['Hoy'];

  const fetchSinCosto = useCallback(async () => {
    setSinCostoLoading(true);
    try {
      const d = await fetch('/api/novacaja/sin-costo').then(r => r.json());
      if (!d.error) setSinCosto(d);
    } catch { /* silent */ }
    finally { setSinCostoLoading(false); }
  }, []);

  const toggleSinCosto = () => {
    setShowSinCosto(v => !v);
    if (!sinCosto && !sinCostoLoading) fetchSinCosto();
  };

  // KPIs del periodo del encabezado (Hoy/Semana/Mes) — del Dashboard, para que las
  // cifras coincidan exactamente con el Dashboard.
  const fetchData = useCallback(async (period: string) => {
    try {
      const dashRes = await fetch(`/api/novacaja/dashboard?period=${period}`).then(r => r.json()).catch(() => null);
      if (dashRes?.kpis) {
        setSummary({
          totalImporte:  dashRes.kpis.totalVentas,
          numTickets:    dashRes.kpis.totalTickets,
          totalCosto:    dashRes.kpis.totalCosto,
          totalGanancia: dashRes.kpis.ganancia,
        });
      }
    } catch (e) { console.error('Error cargando KPIs', e); }
  }, []);

  // Desglose: TODOS los tickets de un día (el del calendario), con su detalle.
  const fetchDesglose = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/novacaja/poliza-ventas?date=${date}`).then(r => r.json());
      if (res.error) { console.error(res.error); setTickets([]); setTotalTickets(0); return; }
      setTickets(res.tickets || []);
      setTotalTickets(res.totalTickets ?? (res.tickets?.length || 0));
    } catch (e) { console.error('Error desglose', e); setTickets([]); }
    finally { setLoading(false); }
  }, []);

  const fetchLiveTickets = useCallback(async () => {
    setLiveLoading(true);
    try {
      const res  = await fetch('/api/novacaja/tickets/recent?limit=50');
      const data = await res.json();
      if (Array.isArray(data)) { setLiveTickets(data); setLastLiveRefresh(new Date()); }
    } catch (e) { console.error('Error live tickets', e); }
    finally { setLiveLoading(false); }
  }, []);

  useEffect(() => { fetchData(config.period); }, [config.period, fetchData]);
  useEffect(() => { fetchDesglose(desgloseDate); }, [desgloseDate, fetchDesglose]);

  useEffect(() => {
    fetchLiveTickets();
    // Cada 90 s y SOLO si la pestaña está visible (menos carga a compucaja).
    const tick  = () => { if (!document.hidden) fetchLiveTickets(); };
    const id    = setInterval(tick, 90_000);
    const onVis = () => { if (!document.hidden) fetchLiveTickets(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [fetchLiveTickets]);

  const limitReached = totalTickets > tickets.length && tickets.length > 0;
  const fechaDesgloseLabel = new Date(desgloseDate + 'T12:00:00').toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <section className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
      {ticketModal !== null && <TicketDetalleModal tk={ticketModal} onClose={() => setTicketModal(null)} />}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 mb-6 lg:mb-8">
        <div>
          <h2 className="text-2xl lg:text-3xl font-serif italic text-primary">Reporte de Ventas</h2>
          <p className="text-[10px] font-label uppercase tracking-widest text-stone-500 mt-1">
            Resumen {config.label} · y desglose de todos los tickets por día
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Indicador del periodo activo */}
          <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-lg px-3 py-2">
            <Icon name={timeFilter === 'Hoy' ? 'today' : timeFilter === 'Esta semana' ? 'date_range' : 'calendar_month'} className="text-primary text-base" />
            <span className="text-xs font-label font-bold text-primary uppercase tracking-widest">{timeFilter}</span>
          </div>
          <button
            onClick={() => { fetchData(config.period); fetchDesglose(desgloseDate); }}
            className={cn('p-2 rounded-lg hover:bg-surface-container-low transition-all text-stone-400 hover:text-primary', loading && 'animate-spin')}>
            <Icon name="refresh" />
          </button>
          <button onClick={() => setShowExport(true)} className="px-4 py-2 bg-primary text-on-primary rounded-lg text-xs font-label font-bold flex items-center gap-2 hover:bg-primary-container transition-all shadow-md">
            <Icon name="download" className="text-base" />
            <span className="hidden sm:inline">Exportar</span>
          </button>
        </div>
      </div>

      {/* Toggle */}
      <div className="flex gap-1 mb-6 bg-surface-container-low p-1 rounded-xl w-fit flex-wrap">
        {([
          { id: 'polizas', label: 'Pólizas de venta', icon: 'receipt_long' },
          { id: 'conteo',  label: 'Conteo de ventas', icon: 'calculate'    },
          { id: 'salida',  label: 'Retiro Autorizado',  icon: 'output'       },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setReportView(t.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-label font-bold uppercase tracking-widest transition-all',
              reportView === t.id ? 'bg-surface text-primary shadow-sm' : 'text-stone-400 hover:text-stone-600'
            )}>
            <Icon name={t.icon} className="text-base" />
            {t.label}
          </button>
        ))}
      </div>

      {reportView === 'conteo' && <ConteoView />}
      {reportView === 'salida'  && <SalidaView />}

      {reportView === 'polizas' && (<>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-6">
          {[
            {
              label: 'Tickets',
              value: summary.numTickets.toLocaleString('es-MX'),
              icon: 'receipt_long',
              color: 'bg-primary/10 text-primary',
              sub: totalTickets > summary.numTickets ? `de ${totalTickets.toLocaleString('es-MX')} totales` : config.label,
            },
            {
              label: 'Ventas',
              value: `$${summary.totalImporte.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`,
              icon: 'payments',
              color: 'bg-secondary/10 text-secondary',
              sub: config.label,
            },
            {
              label: 'Costo',
              value: `$${summary.totalCosto.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`,
              icon: 'inventory_2',
              color: 'bg-error/10 text-error',
              sub: config.label,
            },
            {
              label: 'Ganancia',
              value: `$${summary.totalGanancia.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`,
              icon: 'trending_up',
              color: summary.totalGanancia >= 0 ? 'bg-tertiary/10 text-tertiary' : 'bg-error/10 text-error',
              sub: summary.totalImporte > 0 ? `${((summary.totalGanancia / summary.totalImporte) * 100).toFixed(1)}% margen` : config.label,
            },
          ].map(card => (
            <div key={card.label} className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-5 shadow-[0px_4px_12px_rgba(28,28,25,0.04)]">
              <div className="flex items-center gap-3 mb-3">
                <div className={cn('w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0', card.color)}>
                  <Icon name={card.icon} className="text-lg" />
                </div>
                <span className="text-[10px] font-label uppercase tracking-widest text-stone-400">{card.label}</span>
              </div>
              <p className="text-2xl font-serif text-on-surface">{card.value}</p>
              <p className="text-[10px] font-label text-stone-400 mt-1">{card.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Live tickets feed */}
      <div className="mb-6 bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden shadow-[0px_4px_12px_rgba(28,28,25,0.04)]">
        <div className="px-5 py-4 border-b border-surface-container flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm font-serif text-primary">Últimas 50 Ventas</span>
            <span className="text-[9px] font-label uppercase tracking-widest bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full border border-emerald-200">En vivo</span>
            <span className="text-[9px] font-label text-stone-300 hidden sm:inline">· Toca un ticket para ver el desglose</span>
          </div>
          <div className="flex items-center gap-2">
            {lastLiveRefresh && (
              <span className="text-[9px] font-label text-stone-400 hidden sm:inline">
                {lastLiveRefresh.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
            <button onClick={fetchLiveTickets}
              className={cn('p-1.5 rounded-full hover:bg-stone-100 text-stone-400 hover:text-primary transition-all', liveLoading && 'animate-spin')}>
              <Icon name="refresh" className="text-sm" />
            </button>
          </div>
        </div>
        {liveLoading && liveTickets.length === 0 ? (
          <div className="py-10 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-left">
              <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container sticky top-0">
                <tr>
                  <th className="px-4 py-3">Ticket</th>
                  <th className="px-4 py-3">Fecha y hora</th>
                  <th className="px-4 py-3">Cajero</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {liveTickets.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-stone-300 text-xs font-label uppercase tracking-widest">
                      Sin ventas recientes
                    </td>
                  </tr>
                ) : liveTickets.map((t, i) => (
                  <tr key={t.folio}
                    onClick={() => setTicketModal({
                      folio: Number(t.folio),
                      tda: Number(t.folTda), est: Number(t.folEst), doc: Number(t.folDoc),
                    })}
                    className={cn('hover:bg-background transition-colors cursor-pointer', i === 0 && 'bg-emerald-50/30')}>
                    <td className="px-4 py-2.5">
                      <span className="font-label font-bold text-[10px] text-primary bg-primary-fixed/30 px-2 py-0.5 rounded">#{t.folio}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-stone-500 font-body whitespace-nowrap">
                      {new Date(t.fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-stone-400 font-body">{t.cajero || '—'}</td>
                    <td className="px-4 py-2.5 text-right font-serif font-bold text-on-surface">
                      ${Number(t.importeTotal).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Collapsible cost breakdown */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow-[0px_4px_12px_rgba(28,28,25,0.02)] overflow-hidden">
        <button
          onClick={() => setShowCostTable(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface-container-low/50 transition-colors text-left">
          <div className="flex items-center gap-3">
            <Icon name="table_view" className="text-stone-400 text-base" />
            <span className="text-[11px] font-label font-bold uppercase tracking-widest text-stone-500">
              Todos los tickets de un día
            </span>
            {tickets.length > 0 && (
              <span className="text-[9px] font-label bg-surface-container text-stone-400 px-2 py-0.5 rounded uppercase tracking-widest">
                {tickets.length.toLocaleString('es-MX')} tickets
              </span>
            )}
          </div>
          <Icon name={showCostTable ? 'expand_less' : 'expand_more'} className="text-stone-400 text-xl flex-shrink-0" />
        </button>

        {showCostTable && (
          <div className="border-t border-surface-container">
            {/* Calendario + día seleccionado */}
            <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start gap-4 border-b border-surface-container">
              <DayCalendar value={desgloseDate} onChange={setDesgloseDate} />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mb-1">Tickets del día</p>
                <h4 className="font-serif text-xl text-primary capitalize leading-tight">{fechaDesgloseLabel}</h4>
                <p className="text-sm font-body text-stone-500 mt-2">
                  {loading ? 'Cargando…' : (
                    <>
                      <span className="font-bold text-primary">{tickets.length.toLocaleString('es-MX')}</span> tickets
                      {limitReached && <span className="text-stone-400"> (de {totalTickets.toLocaleString('es-MX')})</span>}
                    </>
                  )}
                </p>
                <p className="text-[10px] font-label text-stone-300 mt-2">Toca un ticket para ver su desglose completo</p>
              </div>
            </div>

            {loading ? (
              <div className="py-16 flex flex-col items-center text-stone-400">
                <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-3" />
                <p className="text-xs font-label uppercase tracking-widest">Cargando tickets…</p>
              </div>
            ) : tickets.length === 0 ? (
              <div className="py-16 flex flex-col items-center text-stone-300">
                <Icon name="receipt_long" className="text-5xl opacity-20 mb-3" />
                <p className="text-sm font-label uppercase tracking-widest">Sin ventas este día</p>
              </div>
            ) : (
              <div className="overflow-x-auto overflow-y-auto max-h-[640px]">
                <table className="w-full text-left">
                  <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container">
                    <tr>
                      <th className="px-5 py-4">Ticket</th>
                      <th className="px-5 py-4">Fecha y hora</th>
                      <th className="px-5 py-4">Factura</th>
                      <th className="px-5 py-4 text-center">Items</th>
                      <th className="px-5 py-4 text-right">Importe</th>
                      <th className="px-5 py-4 text-right">Costo</th>
                      <th className="px-5 py-4 text-right">Ganancia</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container">
                    {tickets.map((t, i) => {
                      const margen = t.totalImporte > 0 ? (t.ganancia / t.totalImporte) * 100 : 0;
                      return (
                        <tr key={i}
                          onClick={() => setTicketModal({
                            folio: Number(t.folConsecutivo ?? t.ticket),
                            tda: Number(t.folTda), est: Number(t.folEst), doc: Number(t.folDoc),
                          })}
                          className="hover:bg-background transition-colors cursor-pointer">
                          <td className="px-5 py-3">
                            <span className="font-label font-bold text-primary text-[10px] tracking-widest bg-primary-fixed/30 px-2 py-1 rounded">
                              #{t.ticket}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-xs text-stone-500 font-body whitespace-nowrap">
                            {new Date(t.fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                          </td>
                          <td className="px-5 py-3 text-xs text-stone-400 font-body">{t.factura || '—'}</td>
                          <td className="px-5 py-3 text-center text-xs text-stone-500 font-body">{t.numProductos}</td>
                          <td className="px-5 py-3 text-right font-body text-sm text-on-surface">
                            ${Number(t.totalImporte).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-5 py-3 text-right font-body text-sm text-stone-400">
                            ${Number(t.totalCosto).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <span className={cn('font-serif text-sm font-bold', t.ganancia >= 0 ? 'text-primary' : 'text-error')}>
                              ${Number(t.ganancia).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                            </span>
                            <span className="block text-[9px] font-label text-stone-400 text-right">{margen.toFixed(1)}%</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Productos sin costo registrado ─────────────────────────────────── */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow-[0px_4px_12px_rgba(28,28,25,0.02)] overflow-hidden mt-6">
        <button onClick={toggleSinCosto}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-surface-container-low/50 transition-colors text-left">
          <div className="flex items-center gap-3">
            <Icon name="price_change" className="text-amber-600 text-base" />
            <span className="text-[11px] font-label font-bold uppercase tracking-widest text-stone-500">
              Productos sin costo registrado
            </span>
            {sinCosto && (
              <span className="text-[9px] font-label bg-amber-100 text-amber-700 px-2 py-0.5 rounded uppercase tracking-widest">
                {sinCosto.total.toLocaleString('es-MX')} productos
              </span>
            )}
          </div>
          <Icon name={showSinCosto ? 'expand_less' : 'expand_more'} className="text-stone-400 text-xl flex-shrink-0" />
        </button>

        {showSinCosto && (
          sinCostoLoading ? (
            <div className="py-16 flex flex-col items-center text-stone-400 border-t border-surface-container">
              <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-3" />
              <p className="text-xs font-label uppercase tracking-widest">Cargando…</p>
            </div>
          ) : !sinCosto || sinCosto.items.length === 0 ? (
            <div className="py-12 text-center text-stone-400 border-t border-surface-container">
              <Icon name="check_circle" className="text-emerald-500 text-3xl mb-2" />
              <p className="text-sm font-body">Todos los productos tienen costo registrado. 🎉</p>
            </div>
          ) : (
            <div className="border-t border-surface-container">
              <p className="px-5 pt-4 text-[11px] font-body text-stone-500">
                Productos cuyo costo está en <strong>$0</strong> (lo que el panel muestra como costo). Captura su costo real en NovaCaja o recíbelos por factura para que la ganancia salga exacta.
              </p>

              {/* Gráfica: por categoría (barras) */}
              {sinCosto.porCategoria.length > 0 && (() => {
                const maxN = Math.max(...sinCosto.porCategoria.map(c => c.n));
                return (
                  <div className="px-5 py-4 space-y-1.5">
                    <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mb-2">Por categoría</p>
                    {sinCosto.porCategoria.map(c => (
                      <div key={c.categoria} className="flex items-center gap-2">
                        <span className="w-28 sm:w-40 text-[11px] font-body text-stone-600 truncate flex-shrink-0" title={c.categoria}>{c.categoria}</span>
                        <div className="flex-1 h-3.5 bg-surface-container rounded-full overflow-hidden">
                          <div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.max(4, (c.n / maxN) * 100)}%` }} />
                        </div>
                        <span className="w-10 text-right text-[11px] font-serif font-bold text-stone-600 flex-shrink-0">{c.n}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Tabla */}
              <div className="overflow-x-auto border-t border-surface-container">
                <table className="w-full text-left">
                  <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container">
                    <tr>
                      <th className="px-5 py-3">Producto</th>
                      <th className="px-5 py-3">Categoría</th>
                      <th className="px-5 py-3 text-right">Precio venta</th>
                      <th className="px-5 py-3 text-right">Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container">
                    {sinCosto.items.map((p, i) => (
                      <tr key={i} className="hover:bg-background transition-colors">
                        <td className="px-5 py-3">
                          <p className="text-sm font-body text-on-surface">{p.nombre}</p>
                          <p className="text-[10px] font-mono text-stone-400">{p.codigo}</p>
                        </td>
                        <td className="px-5 py-3 text-xs text-stone-500 font-body">{p.categoria}</td>
                        <td className="px-5 py-3 text-right font-body text-sm">
                          {p.precio > 0 ? `$${Number(p.precio).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                        </td>
                        <td className="px-5 py-3 text-right font-body text-sm">{p.stock}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sinCosto.total > sinCosto.items.length && (
                <div className="px-5 py-3 border-t border-surface-container bg-surface-container-low/30">
                  <p className="text-[10px] font-label text-stone-400 uppercase tracking-widest">
                    Mostrando {sinCosto.items.length.toLocaleString('es-MX')} de {sinCosto.total.toLocaleString('es-MX')} productos sin costo
                  </p>
                </div>
              )}
            </div>
          )
        )}
      </div>

      </>)}
    </section>
  );
}
