'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { cn } from '../lib/utils';
import { Icon } from '../components/Icon';
import HistorialView from './HistorialTab';
import type { Product } from '../lib/types';

// ── Types locales del endpoint /api/novacaja/dashboard ─────────────────────────
interface DashKPI {
  totalTickets:      number;
  totalVentas:       number;
  totalCosto:        number;
  ganancia:          number;
  unidadesVendidas:  number;
  ticketPromedio:    number;
  totalProducts:     number;
  lowStockAlerts:    number;
}

interface DashProduct {
  name:             string;
  category:         string;
  brand:            string;
  unidadesVendidas: number;
  ingresos:         number;
  costo:            number;
}

interface RecentTicket {
  folio:        number;
  fecha:        string;
  cajero:       string | null;
  vendedor:     string | null;
  importeTotal: number;
}

type TimeFilter = 'Hoy' | 'Esta semana' | 'Este mes';

const PERIOD_MAP: Record<TimeFilter, string> = {
  'Hoy':         'day',
  'Esta semana': 'week',
  'Este mes':    'month',
};

const PERIOD_LABEL: Record<string, string> = {
  day:   'hoy',
  week:  'esta semana',
  month: 'este mes',
};

const BAR_COLORS = ['#012d1d','#1b4332','#2d6a4f','#40916c','#52b788','#7b5819','#a47a23','#c9a843','#eebf76','#ffdeae'];

// ── Custom tooltip para la gráfica ─────────────────────────────────────────────
const ProdTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-outline-variant/20 rounded-xl shadow-2xl p-3 min-w-[160px]">
      <p className="font-body text-xs text-stone-500 mb-1 truncate max-w-[160px]">{label}</p>
      <p className="font-serif text-primary text-lg font-bold">{Number(payload[0]?.value).toLocaleString('es-MX')} uds</p>
      <p className="text-[10px] text-stone-400 font-label">
        ${Number(payload[0]?.payload?.ingresos).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
    </div>
  );
};

// ── Props ──────────────────────────────────────────────────────────────────────
interface Props {
  timeFilter:       string;
  dbStatus:         'unknown' | 'ok' | 'error';
  lowStockProducts: Product[];
  setActiveTab:     (tab: string) => void;
}

export default function DashboardTab({ timeFilter, dbStatus, lowStockProducts, setActiveTab }: Props) {
  const [dashView,       setDashView]       = useState<'resumen' | 'historial'>('resumen');
  const [kpis,           setKpis]           = useState<DashKPI | null>(null);
  const [topProducts,    setTopProducts]    = useState<DashProduct[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [recentTickets,  setRecentTickets]  = useState<RecentTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [lastRefresh,    setLastRefresh]    = useState<Date | null>(null);

  const period = PERIOD_MAP[timeFilter as TimeFilter] ?? 'day';

  const fetchDash = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/novacaja/dashboard?period=${p}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.error) { console.error(data.error); return; }
      setKpis(data.kpis        || null);
      setTopProducts(data.topProducts || []);
    } catch (e) { console.error('Error dashboard', e); }
    finally { setLoading(false); }
  }, []);

  // Carga inicial + auto-refresh cada 2 min SOLO si la pestaña está visible
  // (para no cargar la BD de compucaja cuando el panel está en segundo plano).
  // Además refresca al volver a la pestaña.
  useEffect(() => {
    fetchDash(period);
    const tick  = () => { if (!document.hidden) fetchDash(period); };
    const id    = setInterval(tick, 120_000);
    const onVis = () => { if (!document.hidden) fetchDash(period); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [period, fetchDash]);

  const fetchRecentTickets = useCallback(async () => {
    setTicketsLoading(true);
    try {
      const res  = await fetch('/api/novacaja/tickets/recent?limit=10');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) { setRecentTickets(data); setLastRefresh(new Date()); }
    } catch (e) { console.error('Error tickets live', e); }
    finally { setTicketsLoading(false); }
  }, []);

  useEffect(() => {
    fetchRecentTickets();
    const tick  = () => { if (!document.hidden) fetchRecentTickets(); };
    const id    = setInterval(tick, 90_000);
    const onVis = () => { if (!document.hidden) fetchRecentTickets(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [fetchRecentTickets]);

  const fmt  = (n: number) => `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct  = kpis && kpis.totalVentas > 0
    ? ((kpis.ganancia / kpis.totalVentas) * 100).toFixed(1)
    : '0.0';

  const kpiCards = kpis ? [
    {
      label: 'Tickets',
      value: kpis.totalTickets.toLocaleString('es-MX'),
      sub:   `Ticket prom: ${fmt(kpis.ticketPromedio)}`,
      icon:  'receipt_long',
      color: 'text-emerald-700',
      bg:    'bg-primary-fixed/30',
    },
    {
      label: 'Ventas',
      value: fmt(kpis.totalVentas),
      sub:   `${kpis.unidadesVendidas.toLocaleString('es-MX')} unidades`,
      icon:  'payments',
      color: 'text-amber-700',
      bg:    'bg-secondary-fixed/30',
    },
    {
      label: 'Costo',
      value: fmt(kpis.totalCosto),
      sub:   `Margen: ${pct}%`,
      icon:  'inventory_2',
      color: 'text-stone-600',
      bg:    'bg-surface-container-highest',
    },
    {
      label: 'Ganancia',
      value: fmt(kpis.ganancia),
      sub:   `${pct}% sobre ventas`,
      icon:  'trending_up',
      color: kpis.ganancia >= 0 ? 'text-emerald-700' : 'text-error',
      bg:    kpis.ganancia >= 0 ? 'bg-primary-fixed/30' : 'bg-error-container/30',
      danger: kpis.ganancia < 0,
    },
  ] : [];

  const chartData = topProducts.slice(0, 8).map(p => ({
    name:     p.name.length > 18 ? p.name.slice(0, 18) + '…' : p.name,
    fullName: p.name,
    unidades: p.unidadesVendidas,
    ingresos: p.ingresos,
  }));

  return (
    <section className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
      {/* DB error banner */}
      {dbStatus === 'error' && (
        <div className="bg-error-container border border-error/20 rounded-xl p-4 flex items-center gap-3 mb-8">
          <Icon name="error" className="text-error" />
          <p className="text-sm text-on-error-container font-body font-medium">
            No se pudo conectar a la base de datos. Verifica que la API esté corriendo y el <code>.env</code> esté configurado.
          </p>
        </div>
      )}

      {/* Toggle Resumen / Historial */}
      <div className="flex gap-1 mb-6 bg-surface-container-low p-1 rounded-xl w-fit">
        {([
          { id: 'resumen',   label: 'Resumen',   icon: 'dashboard' },
          { id: 'historial', label: 'Historial', icon: 'calendar_month' },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setDashView(t.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-label font-bold uppercase tracking-widest transition-all',
              dashView === t.id ? 'bg-surface text-primary shadow-sm' : 'text-stone-400 hover:text-stone-600'
            )}>
            <Icon name={t.icon} className="text-base" />
            {t.label}
          </button>
        ))}
      </div>

      {dashView === 'historial' ? <HistorialView /> : (
      <>

      {/* ── KPI Cards ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-6 mb-6 lg:mb-10">
          {[0,1,2,3].map(i => (
            <div key={i} className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/15 h-28 animate-pulse bg-stone-100" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-6 mb-6 lg:mb-10">
          {kpiCards.map((card, i) => (
            <div key={i} className={cn(
              'bg-surface-container-lowest p-4 sm:p-6 rounded-xl border border-outline-variant/15 flex flex-col justify-between shadow-[0px_12px_32px_rgba(28,28,25,0.04)] min-w-0 overflow-hidden',
              card.danger && 'border-l-4 border-l-error'
            )}>
              <div className="flex justify-between items-start gap-2 mb-3 sm:mb-4">
                <span className="text-[10px] font-label uppercase tracking-widest text-stone-500">{card.label}</span>
                <Icon name={card.icon} className={cn(card.color, card.bg, 'p-2 rounded-lg flex-shrink-0')} />
              </div>
              <div className="min-w-0">
                <p className={cn('text-xl sm:text-2xl lg:text-3xl font-serif tabular-nums tracking-tight leading-tight break-words', card.danger ? 'text-error' : 'text-on-surface')}>{card.value}</p>
                <p className={cn('text-[11px] mt-1 font-body font-medium truncate', card.danger ? 'text-error' : 'text-emerald-700')}>{card.sub}</p>
              </div>
            </div>
          ))}
          {/* Si aún no hay datos muestra placeholders */}
          {!kpis && !loading && [0,1,2,3].map(i => (
            <div key={i} className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/15 flex flex-col justify-between shadow-[0px_12px_32px_rgba(28,28,25,0.04)]">
              <span className="text-[10px] font-label uppercase tracking-widest text-stone-400">Sin datos</span>
              <p className="text-3xl font-serif text-stone-200 mt-4">—</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Top Productos + Barra de Ganancia ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-8 mb-6 lg:mb-10">

        {/* Gráfica de barras */}
        <div className="lg:col-span-2 bg-surface p-4 sm:p-6 lg:p-8 rounded-xl border border-outline-variant/10">
          <div className="flex justify-between items-baseline mb-2">
            <h3 className="text-2xl font-serif italic text-primary">Top Productos</h3>
            <span className="text-[10px] font-label uppercase tracking-widest text-stone-400">{PERIOD_LABEL[period]}</span>
          </div>
          <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mb-6">
            Unidades vendidas — {PERIOD_LABEL[period]}
          </p>

          {/* Margen bar */}
          {kpis && kpis.totalVentas > 0 && (
            <div className="mb-6 p-4 bg-surface-container-low rounded-xl border border-outline-variant/10">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[10px] font-label uppercase tracking-widest text-stone-400">Margen de ganancia {PERIOD_LABEL[period]}</span>
                <span className="text-sm font-serif text-primary font-bold">{pct}%</span>
              </div>
              <div className="h-2.5 bg-surface-container rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-700"
                  style={{ width: `${Math.max(0, Math.min(parseFloat(pct), 100))}%` }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[9px] font-label text-stone-400">Costo {fmt(kpis.totalCosto)}</span>
                <span className="text-[9px] font-label text-primary">Ganancia {fmt(kpis.ganancia)}</span>
              </div>
            </div>
          )}

          {loading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-stone-300">
              <Icon name="bar_chart" className="text-5xl opacity-30 mb-2" />
              <p className="text-xs font-label uppercase tracking-widest">Sin datos {PERIOD_LABEL[period]}</p>
            </div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height={256}>
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 40 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 9, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} angle={-35} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 9, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} width={35} />
                  <Tooltip content={<ProdTooltip />} cursor={{ fill: 'rgba(1,45,29,0.04)' }} />
                  <Bar dataKey="unidades" radius={[4, 4, 0, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Lista Top Productos */}
        <div className="bg-surface-container-low p-4 sm:p-6 lg:p-8 rounded-xl border border-outline-variant/10">
          <h3 className="text-xl font-serif text-primary mb-1">Top 10 Productos</h3>
          <p className="text-[10px] font-label text-stone-400 uppercase tracking-widest mb-6">{PERIOD_LABEL[period]}</p>
          <div className="space-y-4">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="w-8 h-8 rounded-full bg-stone-200 flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-stone-200 rounded w-3/4" />
                    <div className="h-2 bg-stone-100 rounded w-1/2" />
                  </div>
                </div>
              ))
            ) : topProducts.length === 0 ? (
              <p className="text-xs font-body text-stone-400 italic">No hay datos de ventas {PERIOD_LABEL[period]}.</p>
            ) : topProducts.slice(0, 10).map((p, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-label font-bold flex-shrink-0',
                  i === 0 ? 'bg-primary text-on-primary' : i < 3 ? 'bg-primary/20 text-primary' : 'bg-surface-container text-stone-400'
                )}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-on-surface truncate font-body">{p.name}</p>
                  <p className="text-[10px] text-stone-400 font-label">{p.category || 'General'}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-primary font-body">{p.unidadesVendidas.toLocaleString('es-MX')}</p>
                  <p className="text-[9px] text-stone-400 font-label uppercase">uds</p>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => setActiveTab('Ventas')}
            className="w-full mt-8 py-3 border border-primary/20 text-primary rounded-lg font-label text-xs uppercase tracking-widest hover:bg-primary hover:text-on-primary transition-all">
            Ver Análisis Completo
          </button>
        </div>
      </div>

      {/* ── Stock Bajo preview ────────────────────────────────────────────────── */}
      <div>
        <div className="mb-6 flex justify-between items-center">
          <h3 className="text-xl font-serif text-on-surface">Alertas de Inventario</h3>
          <button onClick={() => setActiveTab('Alertas')} className="text-primary text-[10px] font-label uppercase tracking-widest border-b border-primary pb-1">
            Ver todas
          </button>
        </div>
        <div className="bg-surface-container-lowest rounded-xl shadow-[0px_4px_12px_rgba(28,28,25,0.02)] overflow-hidden border border-outline-variant/10">
          {lowStockProducts.length === 0 ? (
            <div className="p-8 text-center">
              <Icon name="check_circle" className="text-emerald-600 text-3xl mb-2" />
              <p className="text-sm font-body text-stone-500">Todo el inventario está en niveles óptimos.</p>
            </div>
          ) : lowStockProducts.slice(0, 3).map((p, i) => (
            <div key={i} className="flex items-center p-5 border-b border-surface-container hover:bg-background transition-colors">
              <Icon name="error" className="text-error mr-4 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-on-surface font-body truncate">{p.name}</p>
                <p className="text-xs text-stone-500 font-body">Stock crítico: {p.stock} unidades</p>
              </div>
              <span className="px-3 py-1 bg-error-container text-on-error-container text-[10px] rounded-full uppercase font-label ml-3 flex-shrink-0">
                Crítico
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Últimas Ventas — Live Feed ────────────────────────────────────────── */}
      <div className="mt-8">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <h3 className="text-xl font-serif text-on-surface">Últimas Ventas</h3>
            <span className="text-[9px] font-label uppercase tracking-widest bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">En vivo</span>
          </div>
          <div className="flex items-center gap-2">
            {lastRefresh && (
              <span className="text-[9px] font-label text-stone-400 hidden sm:inline">
                {lastRefresh.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
            <button onClick={fetchRecentTickets}
              className={cn('p-1.5 rounded-full hover:bg-stone-100 text-stone-400 hover:text-primary transition-all', ticketsLoading && 'animate-spin')}>
              <Icon name="refresh" className="text-base" />
            </button>
            <button onClick={() => setActiveTab('Reportes')}
              className="text-primary text-[10px] font-label uppercase tracking-widest border-b border-primary pb-0.5">
              Ver reporte
            </button>
          </div>
        </div>
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden shadow-[0px_4px_12px_rgba(28,28,25,0.02)]">
          {ticketsLoading && recentTickets.length === 0 ? (
            <div className="py-10 flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          ) : recentTickets.length === 0 ? (
            <div className="py-10 text-center text-stone-300">
              <Icon name="receipt_long" className="text-4xl opacity-20 mb-2" />
              <p className="text-xs font-label uppercase tracking-widest">Sin ventas recientes</p>
            </div>
          ) : (
            <div className="divide-y divide-surface-container">
              {recentTickets.map((t, i) => (
                <div key={t.folio} className={cn('flex items-center px-5 py-3 hover:bg-background transition-colors', i === 0 && 'bg-emerald-50/40')}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-label font-bold text-[10px] text-primary bg-primary-fixed/30 px-2 py-0.5 rounded">#{t.folio}</span>
                      {i === 0 && <span className="text-[8px] font-label uppercase tracking-widest bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Reciente</span>}
                    </div>
                    <p className="text-[10px] font-label text-stone-400 mt-0.5">
                      {new Date(t.fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                      {t.cajero && ` · Cajero ${t.cajero}`}
                    </p>
                  </div>
                  <p className="font-serif text-lg font-bold text-on-surface tabular-nums">
                    ${Number(t.importeTotal).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Botón grande: Ver Historial por día ───────────────────────────────── */}
      <button onClick={() => { setDashView('historial'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        className="w-full mt-8 p-5 sm:p-6 rounded-2xl bg-primary text-on-primary flex items-center gap-4 shadow-lg hover:bg-primary/90 transition-all">
        <span className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">
          <Icon name="calendar_month" className="text-2xl" />
        </span>
        <span className="text-left flex-1 min-w-0">
          <span className="block font-serif text-lg sm:text-xl">Ver Historial por día</span>
          <span className="block text-[11px] font-label uppercase tracking-widest opacity-80">Ventas, costos y ganancia de cualquier día pasado</span>
        </span>
        <Icon name="arrow_forward" className="text-2xl flex-shrink-0" />
      </button>
      </>
      )}
    </section>
  );
}
