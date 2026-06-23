'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { cn } from '../lib/utils';
import { Icon } from '../components/Icon';
import { TicketDetalleModal, type TicketKey } from '../components/TicketDetalleModal';
import type { PolizaTicket } from '../lib/types';

// ── Tipos del endpoint /api/novacaja/dia ──────────────────────────────────────
interface DiaKPI {
  totalTickets:     number;
  totalVentas:      number;
  totalCosto:       number;
  ganancia:         number;
  unidadesVendidas: number;
  ticketPromedio:   number;
}
interface DiaProducto {
  productCode:      string;
  name:             string;
  brand:            string;
  category:         string;
  unidadesVendidas: number;
  ingresos:         number;
}
interface HoraRow {
  hora:             number;
  numTickets:       number;
  unidadesVendidas: number;
  totalVentas:      number;
  totalCosto:       number;
}
interface DiaData {
  date:        string;
  kpis:        DiaKPI;
  topProducts: DiaProducto[];
  byHour:      HoraRow[];
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS_SEM = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const BAR_COLORS = ['#012d1d', '#1b4332', '#2d6a4f', '#40916c', '#52b788', '#7b5819', '#a47a23', '#c9a843', '#eebf76', '#ffdeae'];

const pad = (n: number) => String(n).padStart(2, '0');
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmt = (n: number) => `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Tooltip de la gráfica por hora ────────────────────────────────────────────
const HoraTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  return (
    <div className="bg-surface border border-outline-variant/20 rounded-xl shadow-2xl p-3 min-w-[150px]">
      <p className="font-body text-xs text-stone-500 mb-1">{label}</p>
      <p className="font-serif text-primary text-lg font-bold">{fmt(p?.ventas ?? 0)}</p>
      <p className="text-[10px] text-stone-400 font-label">{p?.tickets ?? 0} tickets</p>
    </div>
  );
};

export default function HistorialView() {
  const today    = useMemo(() => new Date(), []);
  const todayISO = toISO(today);

  const [selected,  setSelected]  = useState<string>(todayISO);
  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-11
  const [data,      setData]      = useState<DiaData | null>(null);
  const [loading,   setLoading]   = useState(false);

  // Lista de tickets del día (primeros 50 por defecto; "Ver todos" muestra el resto).
  const [tickets,     setTickets]     = useState<PolizaTicket[]>([]);
  const [ticketsLoad, setTicketsLoad] = useState(false);
  const [verTodos,    setVerTodos]    = useState(false);
  const [ticketModal, setTicketModal] = useState<TicketKey | null>(null);
  const TOPE = 50;

  const fetchDia = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/novacaja/dia?date=${date}`);
      const d   = await res.json();
      if (!d.error) setData(d); else setData(null);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, []);

  const fetchTickets = useCallback(async (date: string) => {
    setTicketsLoad(true);
    try {
      const res = await fetch(`/api/novacaja/poliza-ventas?date=${date}`);
      const d   = await res.json();
      setTickets(Array.isArray(d.tickets) ? d.tickets : []);
    } catch { setTickets([]); }
    finally { setTicketsLoad(false); }
  }, []);

  useEffect(() => { fetchDia(selected); }, [selected, fetchDia]);
  useEffect(() => { setVerTodos(false); fetchTickets(selected); }, [selected, fetchTickets]);

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  // ── Celdas del calendario ───────────────────────────────────────────────────
  const startWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7; // Lunes = 0
  const daysInMonth  = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(startWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const enFuturo = viewYear > today.getFullYear() || (viewYear === today.getFullYear() && viewMonth >= today.getMonth());

  const kpis = data?.kpis;
  const pct  = kpis && kpis.totalVentas > 0 ? ((kpis.ganancia / kpis.totalVentas) * 100).toFixed(1) : '0.0';

  const horaData = (data?.byHour || []).map(h => ({
    horaLabel: `${pad(h.hora)}h`,
    ventas:    Number(h.totalVentas) || 0,
    tickets:   Number(h.numTickets)  || 0,
  }));
  const maxVentaHora = horaData.reduce((m, h) => Math.max(m, h.ventas), 0);

  const fechaLabel = new Date(selected + 'T12:00:00').toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const sinVentas = !loading && (!kpis || kpis.totalTickets === 0);

  const kpiCards = kpis ? [
    { label: 'Tickets',  value: kpis.totalTickets.toLocaleString('es-MX'), sub: `Ticket prom: ${fmt(kpis.ticketPromedio)}`, icon: 'receipt_long', color: 'text-emerald-700', bg: 'bg-primary-fixed/30' },
    { label: 'Ventas',   value: fmt(kpis.totalVentas), sub: `${kpis.unidadesVendidas.toLocaleString('es-MX')} unidades`, icon: 'payments', color: 'text-amber-700', bg: 'bg-secondary-fixed/30' },
    { label: 'Costo',    value: fmt(kpis.totalCosto), sub: `Margen: ${pct}%`, icon: 'inventory_2', color: 'text-stone-600', bg: 'bg-surface-container-highest' },
    { label: 'Ganancia', value: fmt(kpis.ganancia), sub: `${pct}% sobre ventas`, icon: 'trending_up', color: kpis.ganancia >= 0 ? 'text-emerald-700' : 'text-error', bg: kpis.ganancia >= 0 ? 'bg-primary-fixed/30' : 'bg-error-container/30', danger: kpis.ganancia < 0 },
  ] : [];

  return (
    <>
    {ticketModal && <TicketDetalleModal tk={ticketModal} onClose={() => setTicketModal(null)} />}
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-8">

        {/* ── Calendario ──────────────────────────────────────────────────────── */}
        <div className="lg:col-span-1">
          <div className="bg-surface p-4 sm:p-6 rounded-xl border border-outline-variant/10">
            <div className="flex items-center justify-between mb-5">
              <button onClick={() => shiftMonth(-1)} className="p-2 hover:bg-stone-100 rounded-full text-stone-500 transition-colors">
                <Icon name="chevron_left" className="text-xl" />
              </button>
              <span className="font-serif text-lg text-primary">{MESES[viewMonth]} {viewYear}</span>
              <button onClick={() => shiftMonth(1)} disabled={enFuturo}
                className={cn('p-2 rounded-full transition-colors', enFuturo ? 'text-stone-200 cursor-not-allowed' : 'hover:bg-stone-100 text-stone-500')}>
                <Icon name="chevron_right" className="text-xl" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-2">
              {DIAS_SEM.map((d, i) => (
                <div key={i} className="text-center text-[10px] font-label uppercase tracking-widest text-stone-400 py-1">{d}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {cells.map((day, i) => {
                if (day === null) return <div key={i} />;
                const iso      = toISO(new Date(viewYear, viewMonth, day));
                const esFuturo = iso > todayISO;
                const esHoy    = iso === todayISO;
                const esSel    = iso === selected;
                return (
                  <button key={i} disabled={esFuturo}
                    onClick={() => setSelected(iso)}
                    className={cn(
                      'aspect-square rounded-lg text-sm font-body flex items-center justify-center transition-all',
                      esFuturo && 'text-stone-200 cursor-not-allowed',
                      !esFuturo && !esSel && 'text-on-surface hover:bg-primary/10',
                      esSel && 'bg-primary text-on-primary font-bold shadow-md',
                      !esSel && esHoy && 'ring-1 ring-primary/40 text-primary font-bold',
                    )}>
                    {day}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); setSelected(todayISO); }}
              className="mt-5 w-full py-2 rounded-lg bg-surface-container-low text-[11px] font-label font-bold uppercase tracking-widest text-stone-500 hover:text-primary hover:bg-primary/5 transition-colors">
              Ir a hoy
            </button>
          </div>
        </div>

        {/* ── Dashboard del día ───────────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <div className="flex items-baseline gap-3 mb-4">
            <h3 className="text-xl font-serif italic text-primary capitalize">{fechaLabel}</h3>
            {selected === todayISO && (
              <span className="text-[9px] font-label uppercase tracking-widest text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">En vivo</span>
            )}
          </div>

          {/* KPIs */}
          {loading ? (
            <div className="grid grid-cols-2 gap-3 mb-6">
              {[0, 1, 2, 3].map(i => <div key={i} className="bg-stone-100 rounded-xl h-24 animate-pulse" />)}
            </div>
          ) : sinVentas ? (
            <div className="py-16 flex flex-col items-center text-stone-300 bg-surface rounded-xl border border-outline-variant/10">
              <Icon name="event_busy" className="text-5xl opacity-30 mb-3" />
              <p className="text-sm font-label uppercase tracking-widest">Sin ventas este día</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 mb-6">
                {kpiCards.map((card, i) => (
                  <div key={i} className={cn(
                    'bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/15 flex flex-col justify-between shadow-[0px_12px_32px_rgba(28,28,25,0.04)] min-w-0 overflow-hidden',
                    card.danger && 'border-l-4 border-l-error'
                  )}>
                    <div className="flex justify-between items-start gap-2 mb-3">
                      <span className="text-[10px] font-label uppercase tracking-widest text-stone-500">{card.label}</span>
                      <Icon name={card.icon} className={cn(card.color, card.bg, 'p-2 rounded-lg flex-shrink-0')} />
                    </div>
                    <div className="min-w-0">
                      <p className={cn('text-lg sm:text-2xl font-serif tabular-nums tracking-tight leading-tight break-words', card.danger ? 'text-error' : 'text-on-surface')}>{card.value}</p>
                      <p className={cn('text-[11px] mt-1 font-body font-medium truncate', card.danger ? 'text-error' : 'text-emerald-700')}>{card.sub}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Ventas por hora */}
              <div className="bg-surface p-4 sm:p-6 rounded-xl border border-outline-variant/10 mb-6">
                <div className="flex justify-between items-baseline mb-1">
                  <h4 className="text-lg font-serif italic text-primary">Ventas por hora</h4>
                  {maxVentaHora > 0 && (
                    <span className="text-[10px] font-label uppercase tracking-widest text-stone-400">Pico {fmt(maxVentaHora)}</span>
                  )}
                </div>
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mb-5">Distribución del día</p>
                {horaData.length === 0 ? (
                  <div className="h-56 flex flex-col items-center justify-center text-stone-300">
                    <Icon name="schedule" className="text-4xl opacity-30 mb-2" />
                    <p className="text-xs font-label uppercase tracking-widest">Sin movimiento por hora</p>
                  </div>
                ) : (
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height={224}>
                      <BarChart data={horaData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                        <XAxis dataKey="horaLabel" tick={{ fontSize: 9, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} interval={0} />
                        <YAxis tick={{ fontSize: 9, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} width={45}
                          tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                        <Tooltip content={<HoraTooltip />} cursor={{ fill: 'rgba(1,45,29,0.04)' }} />
                        <Bar dataKey="ventas" radius={[4, 4, 0, 0]}>
                          {horaData.map((_, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Top productos del día */}
              <div className="bg-surface p-4 sm:p-6 rounded-xl border border-outline-variant/10">
                <h4 className="text-lg font-serif italic text-primary mb-1">Top productos</h4>
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mb-5">Más vendidos del día</p>
                {(data?.topProducts || []).length === 0 ? (
                  <p className="text-xs font-body text-stone-400 italic py-6 text-center">Sin productos vendidos este día.</p>
                ) : (
                  <div className="space-y-2">
                    {(data?.topProducts || []).slice(0, 10).map((p, i) => (
                      <div key={p.productCode || i} className="flex items-center gap-3 py-2 border-b border-surface-container last:border-0">
                        <span className="w-6 h-6 flex-shrink-0 rounded-full bg-primary-fixed/30 text-primary text-[11px] font-label font-bold flex items-center justify-center">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-body text-on-surface truncate">{p.name}</p>
                          {p.category && <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 truncate">{p.category}</p>}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-serif text-sm text-primary font-bold tabular-nums">{Number(p.unidadesVendidas).toLocaleString('es-MX')} uds</p>
                          <p className="text-[10px] font-label text-stone-400">{fmt(p.ingresos)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Lista de tickets del día (primeros 50 + "Ver todos") ──────── */}
              <div className="bg-surface p-4 sm:p-6 rounded-xl border border-outline-variant/10">
                <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
                  <h4 className="text-lg font-serif italic text-primary">Tickets del día</h4>
                  <span className="text-[10px] font-label uppercase tracking-widest text-stone-400">
                    {ticketsLoad ? 'Cargando…' : `${tickets.length.toLocaleString('es-MX')} en total`}
                  </span>
                </div>
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mb-4">
                  {verTodos ? 'Mostrando todos' : `Primeros ${Math.min(TOPE, tickets.length)}`} · toca uno para su desglose
                </p>

                {ticketsLoad ? (
                  <div className="py-10 flex justify-center">
                    <div className="w-7 h-7 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                  </div>
                ) : tickets.length === 0 ? (
                  <p className="text-xs font-body text-stone-400 italic py-6 text-center">Sin tickets este día.</p>
                ) : (
                  <>
                    <div className="overflow-x-auto overflow-y-auto max-h-[520px] rounded-lg border border-surface-container">
                      <table className="w-full text-left">
                        <thead className="bg-surface-container-low/50 text-stone-500 font-label uppercase tracking-widest text-[10px] border-b border-surface-container sticky top-0">
                          <tr>
                            <th className="px-4 py-3">Ticket</th>
                            <th className="px-4 py-3">Hora</th>
                            <th className="px-4 py-3 text-center">Items</th>
                            <th className="px-4 py-3 text-right">Importe</th>
                            <th className="px-4 py-3 text-right">Ganancia</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-container">
                          {(verTodos ? tickets : tickets.slice(0, TOPE)).map((t, i) => (
                            <tr key={i}
                              onClick={() => setTicketModal({
                                folio: Number(t.folConsecutivo ?? t.ticket),
                                tda: Number(t.folTda), est: Number(t.folEst), doc: Number(t.folDoc),
                              })}
                              className="hover:bg-background transition-colors cursor-pointer">
                              <td className="px-4 py-2.5">
                                <span className="font-label font-bold text-primary text-[10px] tracking-widest bg-primary-fixed/30 px-2 py-1 rounded">#{t.ticket}</span>
                              </td>
                              <td className="px-4 py-2.5 text-xs text-stone-500 font-body whitespace-nowrap">
                                {new Date(t.fecha).toLocaleString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className="px-4 py-2.5 text-center text-xs text-stone-500 font-body">{t.numProductos}</td>
                              <td className="px-4 py-2.5 text-right font-body text-sm text-on-surface">
                                ${Number(t.totalImporte).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                <span className={cn('font-serif text-sm font-bold', t.ganancia >= 0 ? 'text-primary' : 'text-error')}>
                                  ${Number(t.ganancia).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {tickets.length > TOPE && (
                      <button onClick={() => setVerTodos(v => !v)}
                        className={cn('w-full mt-4 py-3 rounded-lg font-label text-xs uppercase tracking-widest transition-all',
                          verTodos ? 'text-stone-400 hover:text-primary' : 'border border-primary/20 text-primary hover:bg-primary hover:text-on-primary')}>
                        {verTodos ? `Mostrar solo los primeros ${TOPE}` : `Ver todos los ${tickets.length.toLocaleString('es-MX')} tickets`}
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
