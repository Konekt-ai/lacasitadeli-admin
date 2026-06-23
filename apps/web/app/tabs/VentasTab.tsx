'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell, LabelList,
  PieChart, Pie,
} from 'recharts';
import { cn } from '../lib/utils';
import { Icon } from '../components/Icon';
import type { AnalyticsData } from '../lib/types';

const PROD_COLORS = [
  '#012d1d','#2d6a4f','#40916c','#52b788','#74c69d',
  '#7b5819','#a47a23','#c9a843','#eebf76','#b08968',
  '#1b4332','#95d5b2',
];

const DIAS       = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
const DIAS_CORTO = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
const MESES      = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

const fmtNum   = (v: number) => Number(v || 0).toLocaleString('es-MX');
const fmtMoney = (v: number) => `$${Number(v || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtMoneyShort = (v: number) => `$${(Number(v || 0) / 1000).toFixed(0)}k`;

const HourTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-outline-variant/20 rounded-xl shadow-2xl p-4 min-w-[160px]">
      <p className="font-serif text-primary text-lg mb-2">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex justify-between gap-4 text-xs font-label">
          <span style={{ color: p.color }} className="truncate max-w-[100px]">{p.dataKey === 'unidades' ? 'Total' : p.name}</span>
          <span className="font-bold text-on-surface">{fmtNum(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

export default function VentasTab() {
  const [analytics,        setAnalytics]        = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsMonths,  setAnalyticsMonths]  = useState(3);
  const [analyticsMetric,  setAnalyticsMetric]  = useState<'unidadesVendidas' | 'totalVentas'>('totalVentas');
  const [sendingResumen,   setSendingResumen]   = useState(false);
  const [resumenMsg,       setResumenMsg]       = useState<{ ok: boolean; text: string } | null>(null);

  const isMoney = analyticsMetric === 'totalVentas';

  const enviarResumen = useCallback(async () => {
    setSendingResumen(true);
    setResumenMsg(null);
    try {
      const res  = await fetch('/api/novacaja/enviar-resumen', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) setResumenMsg({ ok: true, text: `Resumen enviado a ${data.to}` });
      else                   setResumenMsg({ ok: false, text: data.error || 'No se pudo enviar el correo' });
    } catch {
      setResumenMsg({ ok: false, text: 'Error de conexión' });
    } finally {
      setSendingResumen(false);
      setTimeout(() => setResumenMsg(null), 8000);
    }
  }, []);

  const fetchAnalytics = useCallback(async (months: number) => {
    setAnalyticsLoading(true);
    try {
      const res  = await fetch(`/api/novacaja/analytics?months=${months}`);
      const data = await res.json();
      if (data.error) { console.error(data.error); return; }
      setAnalytics(data);
    } catch (e) { console.error('Error analytics', e); }
    finally { setAnalyticsLoading(false); }
  }, []);

  useEffect(() => { fetchAnalytics(analyticsMonths); }, [analyticsMonths, fetchAnalytics]);

  // ── Detección de móvil (≤ 640px, ej. iPhone 15 = 393px) ──
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // ── Volumen por hora ──
  const hourLineData = useMemo(() => {
    if (!analytics) return [];
    return Array.from({ length: 24 }, (_, h) => {
      const found = analytics.byHour.find(r => r.hora === h);
      return { hora: h, label: `${h}:00`, tickets: found?.numTickets || 0, unidades: found?.unidadesVendidas || 0, ventas: found?.totalVentas || 0 };
    });
  }, [analytics]);

  // ── Ventas por día de la semana ──
  const weekdayData = useMemo(() => {
    if (!analytics) return [];
    return Array.from({ length: 7 }, (_, d) => {
      const found = analytics.byWeekday.find(r => r.diaSemana === d);
      return {
        dia: d, label: DIAS_CORTO[d], full: DIAS[d],
        tickets: found?.numTickets || 0,
        unidades: found?.unidadesVendidas || 0,
        ventas: found?.totalVentas || 0,
      };
    });
  }, [analytics]);

  const topWeekday = useMemo(() => {
    if (!weekdayData.length) return null;
    return [...weekdayData].sort((a, b) => b.ventas - a.ventas)[0];
  }, [weekdayData]);

  // ── Volumen mensual ──
  const monthChartData = useMemo(() => {
    if (!analytics) return [];
    return analytics.byMonth.map(r => ({
      label: `${MESES[r.mes - 1]} ${r.anio}`,
      tickets: r.numTickets, unidades: r.unidadesVendidas,
      ventas: r.totalVentas, costo: r.totalCosto,
      ganancia: r.totalVentas - r.totalCosto,
    }));
  }, [analytics]);

  // ── Mezcla por categoría ──
  const categoryData = useMemo(() => {
    if (!analytics) return [];
    const rows = analytics.byCategory.map(r => ({
      name: r.categoria,
      value: isMoney ? r.totalVentas : r.unidadesVendidas,
    })).filter(r => r.value > 0);
    const total = rows.reduce((s, r) => s + r.value, 0) || 1;
    return rows.map(r => ({ ...r, pct: (r.value / total) * 100 }));
  }, [analytics, isMoney]);

  const categoryTotal = useMemo(() => categoryData.reduce((s, r) => s + r.value, 0), [categoryData]);

  // ── Top productos ──
  const topProductsData = useMemo(() => {
    if (!analytics) return [];
    const key = isMoney ? 'ingresos' : 'unidades';
    return [...analytics.topProducts]
      .sort((a, b) => (b[key] as number) - (a[key] as number))
      .slice(0, 10)
      .map(p => ({
        nombre: p.nombre,
        corto: p.nombre.length > 26 ? p.nombre.slice(0, 25) + '…' : p.nombre,
        unidades: p.unidades,
        ingresos: p.ingresos,
        ganancia: p.ganancia,
        margen: p.ingresos > 0 ? (p.ganancia / p.ingresos) * 100 : 0,
        valor: isMoney ? p.ingresos : p.unidades,
      }));
  }, [analytics, isMoney]);

  const fmtMetric = (v: number) => isMoney ? fmtMoney(v) : fmtNum(v);
  const fmtMetricAxis = (v: number) => isMoney ? fmtMoneyShort(v) : fmtNum(v);

  return (
    <section className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-6 lg:space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-serif italic text-primary">Análisis de Ventas</h2>
          <p className="text-[10px] font-label uppercase tracking-widest text-stone-500 mt-1">
            Cuándo vendes · qué vendes · de dónde sale el dinero
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 sm:gap-3 w-full md:w-auto">
          {/* Métrica global */}
          <div className="flex gap-1 bg-surface-container-low rounded-lg p-1">
            <button onClick={() => setAnalyticsMetric('totalVentas')}
              className={cn('flex-1 sm:flex-none px-3 py-1.5 rounded-md text-[10px] font-label font-bold uppercase tracking-widest transition-all',
                isMoney ? 'bg-primary text-on-primary shadow-sm' : 'text-stone-500 hover:text-primary')}>
              Ingresos $
            </button>
            <button onClick={() => setAnalyticsMetric('unidadesVendidas')}
              className={cn('flex-1 sm:flex-none px-3 py-1.5 rounded-md text-[10px] font-label font-bold uppercase tracking-widest transition-all',
                !isMoney ? 'bg-primary text-on-primary shadow-sm' : 'text-stone-500 hover:text-primary')}>
              Unidades
            </button>
          </div>
          {/* Periodo */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="hidden sm:inline text-[10px] font-label uppercase tracking-widest text-stone-500">Periodo:</span>
            {[
              { label: '1 mes',   value: 1  },
              { label: '3 meses', value: 3  },
              { label: '6 meses', value: 6  },
              { label: '1 año',   value: 12 },
            ].map(opt => (
              <button key={opt.value}
                onClick={() => setAnalyticsMonths(opt.value)}
                className={cn(
                  'flex-1 sm:flex-none px-2 sm:px-3 py-2 rounded-lg text-[10px] sm:text-[11px] font-label font-bold uppercase tracking-widest transition-all whitespace-nowrap',
                  analyticsMonths === opt.value ? 'bg-primary text-on-primary shadow-md' : 'bg-surface-container-low text-stone-500 hover:bg-stone-200'
                )}>
                {opt.label}
              </button>
            ))}
            <button
              onClick={() => fetchAnalytics(analyticsMonths)}
              className={cn('p-2 rounded-lg hover:bg-surface-container-low transition-all text-stone-400 hover:text-primary flex-shrink-0', analyticsLoading && 'animate-spin')}>
              <Icon name="refresh" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Enviar resumen de ventas por correo (manual) ──────────────────────── */}
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/10 p-4 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Icon name="mark_email_unread" className="text-xl text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-body text-on-surface font-semibold">Enviar resumen de ventas por correo</p>
            <p className="text-[10px] font-label text-stone-400 mt-0.5 leading-relaxed">
              Manda al instante el resumen de <b>hoy, esta semana y este mes</b> (ventas, tickets, costo y ganancia) a <span className="font-mono">lacasitadeli2000@gmail.com</span>. Útil para revisar a media semana sin esperar el correo del lunes.
            </p>
            {resumenMsg && (
              <p className={cn('text-[10px] font-label mt-1.5 flex items-center gap-1', resumenMsg.ok ? 'text-emerald-600' : 'text-error')}>
                <Icon name={resumenMsg.ok ? 'check_circle' : 'error'} className="text-xs" />
                {resumenMsg.text}
              </p>
            )}
          </div>
        </div>
        <button onClick={enviarResumen} disabled={sendingResumen}
          className={cn('flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-label font-bold uppercase tracking-widest transition-all flex-shrink-0',
            sendingResumen ? 'bg-stone-100 text-stone-400 cursor-not-allowed' : 'bg-primary text-on-primary hover:bg-primary/90 shadow-sm hover:shadow-md')}>
          {sendingResumen
            ? <div className="w-3.5 h-3.5 border-2 border-stone-300/40 border-t-stone-400 rounded-full animate-spin" />
            : <Icon name="send" className="text-sm" />}
          {sendingResumen ? 'Enviando…' : 'Enviar ahora'}
        </button>
      </div>

      {analyticsLoading ? (
        <div className="flex flex-col items-center justify-center py-32">
          <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
          <p className="font-serif italic text-primary">Cargando datos históricos...</p>
        </div>
      ) : !analytics ? (
        <div className="flex flex-col items-center justify-center py-32 text-stone-300">
          <Icon name="bar_chart" className="text-6xl mb-4 opacity-30" />
          <p className="font-label uppercase tracking-widest text-sm">Sin datos — verifica la conexión al servidor</p>
        </div>
      ) : (
        <>
          {/* Gráfica 1: Volumen por hora */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-4 sm:p-6 lg:p-8">
            <div className="flex justify-between items-baseline mb-6">
              <div>
                <h3 className="text-xl sm:text-2xl font-serif italic text-primary">Volumen por Hora del Día</h3>
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mt-1">
                  Acumulado — últimos {analyticsMonths} {analyticsMonths === 1 ? 'mes' : 'meses'}
                </p>
              </div>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height={256}>
                <AreaChart data={hourLineData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradUnidades" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#012d1d" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#012d1d" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradTickets" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#7b5819" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="#7b5819" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} interval={isMobile ? 3 : 1} />
                  <YAxis tick={{ fontSize: 10, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} width={40} />
                  <Tooltip content={<HourTooltip />} />
                  <Area type="monotone" dataKey="unidades" name="Unidades" stroke="#012d1d" strokeWidth={2} fill="url(#gradUnidades)" dot={false} />
                  <Area type="monotone" dataKey="tickets"  name="Tickets"  stroke="#7b5819" strokeWidth={1.5} fill="url(#gradTickets)" dot={false} strokeDasharray="4 2" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {hourLineData.length > 0 && (() => {
              const top3 = [...hourLineData].sort((a, b) => b.unidades - a.unidades).slice(0, 3);
              return (
                <div className="mt-6 flex gap-4 flex-wrap">
                  {top3.map((h, i) => (
                    <div key={i} className="flex items-center gap-3 bg-surface-container-low rounded-lg px-4 py-2">
                      <div className={cn('w-2 h-2 rounded-full', i === 0 ? 'bg-primary' : i === 1 ? 'bg-secondary' : 'bg-stone-300')} />
                      <span className="font-serif text-xl text-on-surface">{h.label}</span>
                      <span className="text-[10px] font-label text-stone-500 uppercase tracking-widest">{fmtNum(h.unidades)} uds · {h.tickets} tickets</span>
                    </div>
                  ))}
                  <div className="ml-auto flex items-center gap-2 text-stone-400">
                    <Icon name="info" className="text-sm" />
                    <span className="text-[10px] font-label uppercase tracking-widest">Horas pico</span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Gráfica 2: Ventas por día de la semana */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-4 sm:p-6 lg:p-8">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-baseline gap-3 mb-6">
              <div>
                <h3 className="text-xl sm:text-2xl font-serif italic text-primary">Ventas por Día de la Semana</h3>
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mt-1">
                  {isMoney ? 'Ingresos' : 'Unidades'} acumulados por día — útil para compras y personal
                </p>
              </div>
              {topWeekday && (
                <div className="flex items-center gap-3 bg-surface-container-low rounded-lg px-4 py-2 self-start sm:self-auto flex-shrink-0">
                  <span className="text-[10px] font-label text-stone-500 uppercase tracking-widest">Día más fuerte</span>
                  <span className="font-serif text-xl text-primary">{topWeekday.full}</span>
                </div>
              )}
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height={256}>
                <BarChart data={weekdayData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fontFamily: 'Inter', fill: '#78716c' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} width={50}
                    tickFormatter={fmtMetricAxis} />
                  <Tooltip
                    cursor={{ fill: '#012d1d', fillOpacity: 0.04 }}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    labelFormatter={(_: any, p: any) => p?.[0]?.payload?.full || ''}
                    formatter={(v: any) => [fmtMetric(Number(v)), isMoney ? 'Ingresos' : 'Unidades']}
                  />
                  <Bar dataKey={isMoney ? 'ventas' : 'unidades'} radius={[6, 6, 0, 0]}>
                    {weekdayData.map((row, i) => (
                      <Cell key={i} fill={topWeekday && row.dia === topWeekday.dia ? '#012d1d' : '#52b788'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Gráfica 3: Volumen mensual */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-4 sm:p-6 lg:p-8">
            <div className="flex justify-between items-baseline mb-6">
              <div>
                <h3 className="text-xl sm:text-2xl font-serif italic text-primary">Tendencia Mensual</h3>
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mt-1">
                  {isMoney ? 'Ingresos por mes' : 'Unidades vendidas por mes'}
                </p>
              </div>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height={288}>
                <BarChart data={monthChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} width={50}
                    tickFormatter={fmtMetricAxis} />
                  <Tooltip
                    cursor={{ fill: '#012d1d', fillOpacity: 0.04 }}
                    formatter={(v: any) => [fmtMetric(Number(v)), isMoney ? 'Ingresos' : 'Unidades']}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey={isMoney ? 'ventas' : 'unidades'} radius={[4, 4, 0, 0]}>
                    {monthChartData.map((_, i) => (
                      <Cell key={i} fill={i === monthChartData.length - 1 ? '#012d1d' : '#40916c'} opacity={0.7 + (i / Math.max(monthChartData.length, 1)) * 0.3} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Gráficas 4 y 5: Categoría + Top productos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
            {/* Mezcla por categoría */}
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-4 sm:p-6 lg:p-8">
              <div className="mb-6">
                <h3 className="text-xl sm:text-2xl font-serif italic text-primary">Mezcla por Categoría</h3>
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mt-1">
                  Participación en {isMoney ? 'ingresos' : 'unidades'}
                </p>
              </div>
              {categoryData.length === 0 ? (
                <div className="flex items-center justify-center h-64 text-stone-300 text-sm font-label uppercase tracking-widest">Sin datos de categoría</div>
              ) : (
                <div className="flex flex-col sm:flex-row items-center gap-6">
                  <div className="relative h-56 w-56 flex-shrink-0">
                    <ResponsiveContainer width="100%" height={224}>
                      <PieChart>
                        <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                          innerRadius={58} outerRadius={88} paddingAngle={2} stroke="none">
                          {categoryData.map((_, i) => (
                            <Cell key={i} fill={PROD_COLORS[i % PROD_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                          formatter={(v: any, n: any) => [`${fmtMetric(Number(v))} · ${((Number(v) / (categoryTotal || 1)) * 100).toFixed(1)}%`, n]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-[9px] font-label uppercase tracking-widest text-stone-400">Total</span>
                      <span className="font-serif text-lg text-primary">{isMoney ? fmtMoneyShort(categoryTotal) : fmtNum(categoryTotal)}</span>
                    </div>
                  </div>
                  <div className="flex-1 w-full space-y-1.5 sm:max-h-56 sm:overflow-y-auto">
                    {categoryData.map((c, i) => (
                      <div key={c.name} className="flex items-center gap-2 text-xs">
                        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: PROD_COLORS[i % PROD_COLORS.length] }} />
                        <span className="font-label text-stone-600 truncate flex-1">{c.name}</span>
                        <span className="font-label text-stone-400 tabular-nums">{c.pct.toFixed(1)}%</span>
                        <span className="font-bold text-on-surface tabular-nums w-20 text-right">{isMoney ? fmtMoneyShort(c.value) : fmtNum(c.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Top productos */}
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-4 sm:p-6 lg:p-8">
              <div className="mb-6">
                <h3 className="text-xl sm:text-2xl font-serif italic text-primary">Top 10 Productos</h3>
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mt-1">
                  Ranking por {isMoney ? 'ingresos' : 'unidades'}
                </p>
              </div>
              {topProductsData.length === 0 ? (
                <div className="flex items-center justify-center h-72 text-stone-300 text-sm font-label uppercase tracking-widest">Sin datos de productos</div>
              ) : (
                <div style={{ height: `${Math.max(topProductsData.length * 34, 120)}px`, minWidth: 0 }}>
                  <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                    <BarChart data={topProductsData} layout="vertical" margin={{ top: 0, right: isMobile ? 42 : 56, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
                      <XAxis type="number" hide tickFormatter={fmtMetricAxis} />
                      <YAxis type="category" dataKey="corto" width={isMobile ? 96 : 170}
                        tickFormatter={(v: any) => { const s = String(v); const max = isMobile ? 13 : 28; return s.length > max ? s.slice(0, max - 1) + '…' : s; }}
                        tick={{ fontSize: 10, fontFamily: 'Inter', fill: '#57534e' }} tickLine={false} axisLine={false} />
                      <Tooltip
                        cursor={{ fill: '#012d1d', fillOpacity: 0.04 }}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        labelFormatter={(_: any, p: any) => p?.[0]?.payload?.nombre || ''}
                        formatter={(v: any, _n: any, p: any) => {
                          const d = p?.payload || {};
                          return isMoney
                            ? [`${fmtMoney(Number(v))}  ·  margen ${d.margen?.toFixed(0)}%`, 'Ingresos']
                            : [`${fmtNum(Number(v))} uds`, 'Unidades'];
                        }}
                      />
                      <Bar dataKey="valor" radius={[0, 6, 6, 0]} barSize={18}>
                        {topProductsData.map((_, i) => (
                          <Cell key={i} fill={PROD_COLORS[i % PROD_COLORS.length]} />
                        ))}
                        <LabelList dataKey="valor" position="right"
                          formatter={(v: any) => isMoney ? fmtMoneyShort(Number(v)) : fmtNum(Number(v))}
                          style={{ fontSize: 10, fontFamily: 'Inter', fill: '#78716c', fontWeight: 700 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
