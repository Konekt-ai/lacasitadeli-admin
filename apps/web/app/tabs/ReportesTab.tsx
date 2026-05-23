'use client';
import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { cn } from '../lib/utils';
import { Icon } from '../components/Icon';
import type { PolizaTicket, PolizaSummary } from '../lib/types';

const ExportModal = dynamic(() => import('../components/ExportModal'), { ssr: false });

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
  const [tickets,       setTickets]       = useState<PolizaTicket[]>([]);
  const [summary,       setSummary]       = useState<PolizaSummary | null>(null);
  const [totalTickets,  setTotalTickets]  = useState(0);
  const [loading,       setLoading]       = useState(false);
  const [showExport,    setShowExport]    = useState(false);

  const config = PERIOD_CONFIG[timeFilter as TimeFilter] ?? PERIOD_CONFIG['Hoy'];

  const fetchData = useCallback(async (period: string) => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/novacaja/poliza-ventas?period=${period}`);
      const data = await res.json();
      if (data.error) { console.error(data.error); return; }
      setTickets(data.tickets      || []);
      setSummary(data.summary      || null);
      setTotalTickets(data.totalTickets ?? 0);
    } catch (e) { console.error('Error cargando poliza', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(config.period); }, [config.period, fetchData]);

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

      {/* Profit bar */}
      {summary && summary.totalImporte > 0 && (
        <div className="mb-6 bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-5 shadow-[0px_4px_12px_rgba(28,28,25,0.04)]">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] font-label uppercase tracking-widest text-stone-400">Margen de ganancia</span>
            <span className="text-sm font-serif text-primary font-bold">
              {((summary.totalGanancia / summary.totalImporte) * 100).toFixed(1)}%
            </span>
          </div>
          <div className="h-3 bg-surface-container rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-700"
              style={{ width: `${Math.max(0, Math.min((summary.totalGanancia / summary.totalImporte) * 100, 100))}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[9px] font-label text-stone-400 uppercase">
              Costo ${summary.totalCosto.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[9px] font-label text-primary uppercase">
              Ganancia ${summary.totalGanancia.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      )}

      {/* Tickets table */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 shadow-[0px_12px_32px_rgba(28,28,25,0.04)] overflow-hidden">
        {loading ? (
          <div className="py-24 flex flex-col items-center text-stone-400">
            <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
            <p className="text-sm font-label uppercase tracking-widest">Cargando tickets {config.label}...</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
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
              <div className="py-20 flex flex-col items-center text-stone-300">
                <Icon name="receipt_long" className="text-6xl opacity-20 mb-4" />
                <p className="text-sm font-label uppercase tracking-widest">Sin ventas {config.label}</p>
              </div>
            )}

            {tickets.length > 0 && (
              <div className="px-5 py-3 border-t border-surface-container bg-surface-container-low/30 flex items-center justify-between">
                <p className="text-[10px] font-label text-stone-400 uppercase tracking-widest">
                  Mostrando {tickets.length.toLocaleString('es-MX')} tickets
                  {limitReached && (
                    <span className="ml-1 text-primary font-bold">
                      · existen {totalTickets.toLocaleString('es-MX')} en total {config.label}
                    </span>
                  )}
                </p>
                {limitReached && (
                  <span className="text-[9px] font-label bg-primary/10 text-primary px-2 py-0.5 rounded uppercase tracking-widest">
                    Límite {config.limit.toLocaleString('es-MX')} alcanzado
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
