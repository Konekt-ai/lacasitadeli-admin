'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell, Legend,
} from 'recharts';
import { cn } from '../lib/utils';
import { Icon } from '../components/Icon';
import type { AnalyticsData, ProdHour } from '../lib/types';

const PROD_COLORS = [
  '#012d1d','#1b4332','#2d6a4f','#40916c','#52b788',
  '#7b5819','#a47a23','#c9a843','#eebf76','#ffdeae',
];

const HourTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-outline-variant/20 rounded-xl shadow-2xl p-4 min-w-[160px]">
      <p className="font-serif text-primary text-lg mb-2">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex justify-between gap-4 text-xs font-label">
          <span style={{ color: p.color }} className="truncate max-w-[100px]">{p.dataKey === 'unidades' ? 'Total' : p.name}</span>
          <span className="font-bold text-on-surface">{Number(p.value).toLocaleString('es-MX')}</span>
        </div>
      ))}
    </div>
  );
};

export default function VentasTab() {
  const [analytics,        setAnalytics]        = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsMonths,  setAnalyticsMonths]  = useState(3);
  const [analyticsMetric,  setAnalyticsMetric]  = useState<'unidadesVendidas' | 'totalVentas'>('unidadesVendidas');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);

  const fetchAnalytics = useCallback(async (months: number) => {
    setAnalyticsLoading(true);
    try {
      const res  = await fetch(`/api/novacaja/analytics?months=${months}`);
      const data = await res.json();
      if (data.error) { console.error(data.error); return; }
      setAnalytics(data);
      const topN = [...new Set((data.productsByHour as ProdHour[]).map(r => r.nombre))].slice(0, 5);
      setSelectedProducts(topN);
    } catch (e) { console.error('Error analytics', e); }
    finally { setAnalyticsLoading(false); }
  }, []);

  useEffect(() => { fetchAnalytics(analyticsMonths); }, [analyticsMonths, fetchAnalytics]);

  const allProductNames = useMemo(() => {
    if (!analytics) return [];
    return [...new Set(analytics.productsByHour.map(r => r.nombre))].slice(0, 20);
  }, [analytics]);

  const heatmapData = useMemo(() => {
    if (!analytics) return [];
    return Array.from({ length: 24 }, (_, h) => {
      const row: Record<string, any> = { hora: h, label: `${h}:00` };
      selectedProducts.forEach(nombre => {
        const found = analytics.productsByHour.find(r => r.nombre === nombre && r.hora === h);
        row[nombre] = found ? found.unidades : 0;
      });
      return row;
    });
  }, [analytics, selectedProducts]);

  const hourLineData = useMemo(() => {
    if (!analytics) return [];
    return Array.from({ length: 24 }, (_, h) => {
      const found = analytics.byHour.find(r => r.hora === h);
      return { hora: h, label: `${h}:00`, tickets: found?.numTickets || 0, unidades: found?.unidadesVendidas || 0, ventas: found?.totalVentas || 0 };
    });
  }, [analytics]);

  const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  const monthChartData = useMemo(() => {
    if (!analytics) return [];
    return analytics.byMonth.map(r => ({
      label: `${MESES[r.mes - 1]} ${r.anio}`,
      tickets: r.numTickets, unidades: r.unidadesVendidas,
      ventas: r.totalVentas, costo: r.totalCosto,
      ganancia: r.totalVentas - r.totalCosto,
    }));
  }, [analytics]);

  const productMonthData = useMemo(() => {
    if (!analytics || !selectedProducts.length) return [];
    const monthKeys = [...new Set(analytics.productsByMonth.map(r => `${r.anio}-${r.mes}`))].sort();
    return monthKeys.map(key => {
      const [anio, mes] = key.split('-').map(Number);
      const row: Record<string, any> = { label: `${MESES[mes-1]} ${anio}` };
      selectedProducts.forEach(nombre => {
        const found = analytics.productsByMonth.find(r => r.nombre === nombre && r.anio === anio && r.mes === mes);
        row[nombre] = found ? (analyticsMetric === 'unidadesVendidas' ? found.unidades : found.ingresos) : 0;
      });
      return row;
    });
  }, [analytics, selectedProducts, analyticsMetric]);

  const heatmapMax = useMemo(() => {
    let max = 0;
    heatmapData.forEach(row => { selectedProducts.forEach(p => { if (row[p] > max) max = row[p]; }); });
    return max || 1;
  }, [heatmapData, selectedProducts]);

  return (
    <section className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-6 lg:space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-3xl font-serif italic text-primary">Análisis de Ventas</h2>
          <p className="text-[10px] font-label uppercase tracking-widest text-stone-500 mt-1">
            Volumen histórico por hora · por mes · por producto
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-label uppercase tracking-widest text-stone-500">Periodo:</span>
          {[
            { label: '1 mes',   value: 1  },
            { label: '3 meses', value: 3  },
            { label: '6 meses', value: 6  },
            { label: '1 año',   value: 12 },
          ].map(opt => (
            <button key={opt.value}
              onClick={() => setAnalyticsMonths(opt.value)}
              className={cn(
                'px-4 py-2 rounded-lg text-[11px] font-label font-bold uppercase tracking-widest transition-all',
                analyticsMonths === opt.value ? 'bg-primary text-on-primary shadow-md' : 'bg-surface-container-low text-stone-500 hover:bg-stone-200'
              )}>
              {opt.label}
            </button>
          ))}
          <button
            onClick={() => fetchAnalytics(analyticsMonths)}
            className={cn('p-2 rounded-lg hover:bg-surface-container-low transition-all text-stone-400 hover:text-primary', analyticsLoading && 'animate-spin')}>
            <Icon name="refresh" />
          </button>
        </div>
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
          {/* Selección de productos */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-label font-bold uppercase tracking-widest text-stone-500">
                Productos visualizados <span className="text-primary ml-2">{selectedProducts.length} / {allProductNames.length}</span>
              </h3>
              <div className="flex gap-2">
                <button onClick={() => setSelectedProducts(allProductNames.slice(0, 5))}
                  className="text-[10px] font-label uppercase tracking-widest text-primary border border-primary/20 px-3 py-1 rounded-lg hover:bg-primary/5 transition-all">Top 5</button>
                <button onClick={() => setSelectedProducts(allProductNames.slice(0, 10))}
                  className="text-[10px] font-label uppercase tracking-widest text-primary border border-primary/20 px-3 py-1 rounded-lg hover:bg-primary/5 transition-all">Top 10</button>
                <button onClick={() => setSelectedProducts([])}
                  className="text-[10px] font-label uppercase tracking-widest text-stone-400 border border-stone-200 px-3 py-1 rounded-lg hover:bg-stone-100 transition-all">Limpiar</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {allProductNames.map((nombre, i) => {
                const isSelected = selectedProducts.includes(nombre);
                const color = PROD_COLORS[i % PROD_COLORS.length];
                return (
                  <button key={nombre}
                    onClick={() => setSelectedProducts(prev => isSelected ? prev.filter(n => n !== nombre) : [...prev, nombre])}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-[11px] font-label font-bold transition-all border truncate max-w-[220px]',
                      isSelected ? 'text-white border-transparent shadow-sm' : 'bg-transparent text-stone-500 border-stone-200 hover:border-stone-300'
                    )}
                    style={isSelected ? { backgroundColor: color, borderColor: color } : {}}>
                    {nombre}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Gráfica 1: Volumen por hora */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-8">
            <div className="flex justify-between items-baseline mb-6">
              <div>
                <h3 className="text-2xl font-serif italic text-primary">Volumen por Hora del Día</h3>
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mt-1">
                  Promedio acumulado — últimos {analyticsMonths} {analyticsMonths === 1 ? 'mes' : 'meses'}
                </p>
              </div>
            </div>
            <div className="h-64 w-full" style={{ minWidth: 0, minHeight: 0 }}>
              <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
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
                  <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} interval={1} />
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
                      <span className="text-[10px] font-label text-stone-500 uppercase tracking-widest">{h.unidades.toLocaleString('es-MX')} uds · {h.tickets} tickets</span>
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

          {/* Gráfica 2: Heatmap */}
          {selectedProducts.length > 0 && (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-8">
              <div className="mb-6">
                <h3 className="text-2xl font-serif italic text-primary">Mapa de Calor · Producto × Hora</h3>
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mt-1">Intensidad = unidades vendidas en ese rango horario</p>
              </div>
              <div className="overflow-x-auto">
                <div style={{ minWidth: `${24 * 38 + 180}px` }}>
                  <div className="flex mb-1" style={{ paddingLeft: '180px' }}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={h} className="text-[9px] font-label text-stone-400 text-center" style={{ width: '38px', flexShrink: 0 }}>{h}</div>
                    ))}
                  </div>
                  {selectedProducts.map((nombre, pi) => {
                    const color = PROD_COLORS[pi % PROD_COLORS.length];
                    return (
                      <div key={nombre} className="flex items-center mb-1">
                        <div className="text-[10px] font-label text-stone-600 truncate pr-2 text-right" style={{ width: '180px', flexShrink: 0 }}>{nombre}</div>
                        {Array.from({ length: 24 }, (_, h) => {
                          const val = heatmapData[h]?.[nombre] || 0;
                          const pct = val / heatmapMax;
                          const opacity = val === 0 ? 0.04 : 0.1 + pct * 0.85;
                          return (
                            <div key={h} title={`${nombre} · ${h}:00 — ${val} uds`}
                              className="rounded-sm cursor-pointer transition-all hover:scale-110 hover:z-10 relative"
                              style={{ width: '34px', height: '28px', flexShrink: 0, margin: '0 2px', backgroundColor: color, opacity }}>
                              {val > 0 && pct > 0.5 && (
                                <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold text-white">{val}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center gap-3 mt-4 justify-end">
                <span className="text-[9px] font-label text-stone-400 uppercase">Sin ventas</span>
                <div className="flex gap-1">
                  {[0.1, 0.3, 0.5, 0.7, 0.9].map((o, i) => (
                    <div key={i} className="w-5 h-3 rounded-sm" style={{ backgroundColor: '#012d1d', opacity: o }} />
                  ))}
                </div>
                <span className="text-[9px] font-label text-stone-400 uppercase">Mayor volumen</span>
              </div>
            </div>
          )}

          {/* Gráfica 3: Ventas por mes */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-8">
            <div className="flex justify-between items-baseline mb-6">
              <div>
                <h3 className="text-2xl font-serif italic text-primary">Volumen Mensual</h3>
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mt-1">Unidades · Ingresos · Ganancia</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setAnalyticsMetric('unidadesVendidas')}
                  className={cn('px-4 py-1.5 rounded-lg text-[10px] font-label font-bold uppercase tracking-widest transition-all',
                    analyticsMetric === 'unidadesVendidas' ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-stone-400 hover:bg-stone-200')}>
                  Unidades
                </button>
                <button onClick={() => setAnalyticsMetric('totalVentas')}
                  className={cn('px-4 py-1.5 rounded-lg text-[10px] font-label font-bold uppercase tracking-widest transition-all',
                    analyticsMetric === 'totalVentas' ? 'bg-secondary text-on-primary' : 'bg-surface-container-low text-stone-400 hover:bg-stone-200')}>
                  Ingresos $
                </button>
              </div>
            </div>
            <div className="h-72 w-full" style={{ minWidth: 0, minHeight: 0 }}>
              <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                <BarChart data={monthChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} width={50}
                    tickFormatter={v => analyticsMetric === 'totalVentas' ? `$${(v/1000).toFixed(0)}k` : v.toLocaleString()} />
                  <Tooltip
                    formatter={(v: number, name: string) => [
                      analyticsMetric === 'totalVentas' ? `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : v.toLocaleString('es-MX'),
                      name
                    ]}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey={analyticsMetric === 'unidadesVendidas' ? 'unidades' : 'ventas'} name={analyticsMetric === 'unidadesVendidas' ? 'Unidades' : 'Ingresos'} radius={[4, 4, 0, 0]}>
                    {monthChartData.map((_, i) => (
                      <Cell key={i} fill={i === monthChartData.length - 1 ? '#012d1d' : '#40916c'} opacity={0.7 + (i / monthChartData.length) * 0.3} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Gráfica 4: Productos por mes (stacked) */}
          {selectedProducts.length > 0 && productMonthData.length > 0 && (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-8">
              <div className="mb-6">
                <h3 className="text-2xl font-serif italic text-primary">Productos por Mes</h3>
                <p className="text-[10px] font-label uppercase tracking-widest text-stone-400 mt-1">
                  {analyticsMetric === 'unidadesVendidas' ? 'Unidades vendidas' : 'Ingresos $'} — productos seleccionados
                </p>
              </div>
              <div className="h-72 w-full" style={{ minWidth: 0, minHeight: 0 }}>
                <ResponsiveContainer width="99%" height="100%" minWidth={1} minHeight={1}>
                  <BarChart data={productMonthData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fontFamily: 'Inter', fill: '#a8a29e' }} tickLine={false} axisLine={false} width={50}
                      tickFormatter={v => analyticsMetric === 'totalVentas' ? `$${(v/1000).toFixed(0)}k` : String(v)} />
                    <Tooltip
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      formatter={(v: number) => [
                        analyticsMetric === 'totalVentas' ? `$${v.toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : v.toLocaleString('es-MX')
                      ]}
                    />
                    <Legend wrapperStyle={{ fontSize: '10px', fontFamily: 'Inter' }} />
                    {selectedProducts.map((nombre, i) => (
                      <Bar key={nombre} dataKey={nombre} stackId="stack" fill={PROD_COLORS[i % PROD_COLORS.length]} radius={i === selectedProducts.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
