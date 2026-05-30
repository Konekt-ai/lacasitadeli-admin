'use client';
import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { cn } from '../lib/utils';
import { Icon } from '../components/Icon';
import type { PolizaTicket, PolizaSummary } from '../lib/types';

const ExportModal = dynamic(() => import('../components/ExportModal'), { ssr: false });

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

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 mb-5 text-sm font-body text-amber-800">
        <Icon name="warning" className="text-amber-500 text-xl flex-shrink-0 mt-0.5" />
        <div>
          <strong>Advertencia:</strong> Esta operación lee <code>TicketsPS</code> y descuenta las cantidades vendidas del inventario en NovaCaja.
          <strong> No apliques el mismo periodo dos veces</strong> — causaría doble deducción.
        </div>
      </div>

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

interface LiveTicket {
  folio:        number;
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
  const [reportView, setReportView] = useState<'polizas' | 'conteo'>('polizas');
  const [tickets,          setTickets]          = useState<PolizaTicket[]>([]);
  const [summary,          setSummary]          = useState<PolizaSummary | null>(null);
  const [totalTickets,     setTotalTickets]      = useState(0);
  const [loading,          setLoading]           = useState(false);
  const [showExport,       setShowExport]        = useState(false);
  const [liveTickets,      setLiveTickets]       = useState<LiveTicket[]>([]);
  const [liveLoading,      setLiveLoading]       = useState(false);
  const [lastLiveRefresh,  setLastLiveRefresh]   = useState<Date | null>(null);
  const [showCostTable,    setShowCostTable]     = useState(false);

  const config = PERIOD_CONFIG[timeFilter as TimeFilter] ?? PERIOD_CONFIG['Hoy'];

  const fetchData = useCallback(async (period: string) => {
    setLoading(true);
    try {
      const [polizaRes, tkpis] = await Promise.all([
        fetch(`/api/novacaja/poliza-ventas?period=${period}`).then(r => r.json()),
        fetch(`/api/novacaja/tickets/kpis?period=${period}`).then(r => r.json()).catch(() => null),
      ]);
      if (polizaRes.error) { console.error(polizaRes.error); return; }
      setTickets(polizaRes.tickets      || []);
      setTotalTickets(polizaRes.totalTickets ?? 0);
      const base = polizaRes.summary as PolizaSummary | null;
      if (base && tkpis && !tkpis.error) {
        setSummary({
          totalImporte:  tkpis.totalVentas  ?? base.totalImporte,
          numTickets:    tkpis.totalTickets ?? base.numTickets,
          totalCosto:    base.totalCosto,
          totalGanancia: (tkpis.totalVentas ?? base.totalImporte) - base.totalCosto,
        });
      } else {
        setSummary(base);
      }
    } catch (e) { console.error('Error cargando reporte', e); }
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

  useEffect(() => {
    fetchLiveTickets();
    const id = setInterval(fetchLiveTickets, 30_000);
    return () => clearInterval(id);
  }, [fetchLiveTickets]);

  const limitReached = tickets.length >= config.limit && totalTickets > config.limit;

  return (
    <section className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
      {showExport && <ExportModal onClose={() => setShowExport(false)} />}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 mb-6 lg:mb-8">
        <div>
          <h2 className="text-2xl lg:text-3xl font-serif italic text-primary">Reporte de Ventas</h2>
          <p className="text-[10px] font-label uppercase tracking-widest text-stone-500 mt-1">
            Ganancias {config.label} · hasta {config.limit.toLocaleString('es-MX')} tickets
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Indicador del periodo activo */}
          <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-lg px-3 py-2">
            <Icon name={timeFilter === 'Hoy' ? 'today' : timeFilter === 'Esta semana' ? 'date_range' : 'calendar_month'} className="text-primary text-base" />
            <span className="text-xs font-label font-bold text-primary uppercase tracking-widest">{timeFilter}</span>
          </div>
          <button
            onClick={() => fetchData(config.period)}
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
      <div className="flex gap-1 mb-6 bg-surface-container-low p-1 rounded-xl w-fit">
        {([
          { id: 'polizas', label: 'Pólizas de venta', icon: 'receipt_long' },
          { id: 'conteo',  label: 'Conteo de ventas', icon: 'calculate'    },
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
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm font-serif text-primary">Últimas 50 Ventas</span>
            <span className="text-[9px] font-label uppercase tracking-widest bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full border border-emerald-200">En vivo</span>
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
                  <tr key={t.folio} className={cn('hover:bg-background transition-colors', i === 0 && 'bg-emerald-50/30')}>
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
              Desglose de costos por ticket
            </span>
            {tickets.length > 0 && (
              <span className="text-[9px] font-label bg-surface-container text-stone-400 px-2 py-0.5 rounded uppercase tracking-widest">
                {tickets.length.toLocaleString('es-MX')} registros
              </span>
            )}
          </div>
          <Icon name={showCostTable ? 'expand_less' : 'expand_more'} className="text-stone-400 text-xl flex-shrink-0" />
        </button>

        {showCostTable && (
          loading ? (
            <div className="py-16 flex flex-col items-center text-stone-400 border-t border-surface-container">
              <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-3" />
              <p className="text-xs font-label uppercase tracking-widest">Cargando {config.label}...</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto border-t border-surface-container">
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
                        <tr key={i} className="hover:bg-background transition-colors">
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

              {tickets.length === 0 && (
                <div className="py-16 flex flex-col items-center text-stone-300 border-t border-surface-container">
                  <Icon name="receipt_long" className="text-5xl opacity-20 mb-3" />
                  <p className="text-sm font-label uppercase tracking-widest">Sin datos {config.label}</p>
                </div>
              )}

              {tickets.length > 0 && (
                <div className="px-5 py-3 border-t border-surface-container bg-surface-container-low/30 flex items-center justify-between">
                  <p className="text-[10px] font-label text-stone-400 uppercase tracking-widest">
                    {tickets.length.toLocaleString('es-MX')} tickets
                    {limitReached && (
                      <span className="ml-1 text-primary font-bold">
                        · {totalTickets.toLocaleString('es-MX')} en total
                      </span>
                    )}
                  </p>
                  {limitReached && (
                    <span className="text-[9px] font-label bg-primary/10 text-primary px-2 py-0.5 rounded uppercase tracking-widest">
                      Límite alcanzado
                    </span>
                  )}
                </div>
              )}
            </>
          )
        )}
      </div>

      </>)}
    </section>
  );
}
