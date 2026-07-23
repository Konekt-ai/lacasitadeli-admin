'use client';
import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { cn, hoyMX } from '../lib/utils';
import { Icon } from './Icon';

type PeriodOption = 'day' | 'week' | 'month' | 'custom';

interface ExportRow {
  ticket: string;
  fecha: string;
  factura: string;
  totalArticulos: number;
  totalImporte: number;
  totalCosto: number;
  ganancia: number;
  numLineas: number;
}

interface Props {
  onClose: () => void;
}

const PERIOD_OPTS: { id: PeriodOption; label: string; sub: string; icon: string }[] = [
  { id: 'day',    label: 'Hoy',                  sub: 'Todos los tickets del día',        icon: 'today' },
  { id: 'week',   label: 'Esta semana',           sub: 'Últimos 7 días',                   icon: 'date_range' },
  { id: 'month',  label: 'Este mes',              sub: 'Últimos 30 días',                  icon: 'calendar_month' },
  { id: 'custom', label: 'Intervalo personalizado', sub: 'Elige fecha inicio y fin',       icon: 'tune' },
];

function buildUrl(period: PeriodOption, start: string, end: string): string {
  if (period === 'custom') {
    const params = new URLSearchParams();
    if (start) params.set('startDate', start);
    if (end)   params.set('endDate',   end);
    return `/api/novacaja/poliza-ventas/export?${params}`;
  }
  return `/api/novacaja/poliza-ventas/export?period=${period}`;
}

function toExcel(rows: ExportRow[], sheetName: string) {
  // Header row
  const headers = ['Ticket', 'Fecha y Hora', 'Factura', 'Artículos', 'Importe ($)', 'Costo ($)', 'Ganancia ($)', 'Margen (%)'];

  const data = rows.map(r => {
    const margen = r.totalImporte > 0 ? ((r.ganancia / r.totalImporte) * 100) : 0;
    return [
      r.ticket,
      r.fecha,
      r.factura || '',
      r.totalArticulos ?? r.numLineas,
      Number(r.totalImporte),
      Number(r.totalCosto),
      Number(r.ganancia),
      parseFloat(margen.toFixed(2)),
    ];
  });

  // Summary row
  const totImporte  = rows.reduce((s, r) => s + Number(r.totalImporte), 0);
  const totCosto    = rows.reduce((s, r) => s + Number(r.totalCosto),   0);
  const totGanancia = rows.reduce((s, r) => s + Number(r.ganancia),     0);
  const totMargen   = totImporte > 0 ? parseFloat(((totGanancia / totImporte) * 100).toFixed(2)) : 0;

  data.push([]);  // blank separator
  data.push(['TOTAL', '', '', rows.reduce((s, r) => s + (r.totalArticulos ?? r.numLineas), 0), totImporte, totCosto, totGanancia, totMargen]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  // Column widths
  ws['!cols'] = [
    { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 10 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 },
  ];

  // Style header row (bold) – SheetJS community edition doesn't support cell styles,
  // but we can set number formats for currency columns.
  const currencyFmt = '"$"#,##0.00';
  const pctFmt      = '0.00"%"';
  const dataStart   = 1; // row index (0-indexed, 1 = second row)
  data.forEach((_, i) => {
    const r = dataStart + i;
    (['E', 'F', 'G'] as const).forEach(col => {
      const cell = ws[`${col}${r + 1}`];
      if (cell) cell.z = currencyFmt;
    });
    const hCell = ws[`H${r + 1}`];
    if (hCell) hCell.z = pctFmt;
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const date = hoyMX();
  XLSX.writeFile(wb, `reporte-ventas-${sheetName.toLowerCase().replace(/ /g, '-')}-${date}.xlsx`);
}

export default function ExportModal({ onClose }: Props) {
  const [selected,  setSelected]  = useState<PeriodOption>('day');
  const [startDate, setStartDate] = useState('');
  const [endDate,   setEndDate]   = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  const canDownload = selected !== 'custom' || (startDate && endDate && startDate <= endDate);

  const handleDownload = async () => {
    if (!canDownload) { setError('Selecciona un rango de fechas válido.'); return; }
    setError('');
    setLoading(true);
    try {
      const url = buildUrl(selected, startDate, endDate);
      const res  = await fetch(url);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }

      const rows: ExportRow[] = data.tickets || [];
      if (rows.length === 0) { setError('No hay datos para el periodo seleccionado.'); return; }

      const sheetNames: Record<PeriodOption, string> = {
        day:    'Hoy',
        week:   'Últimos 7 días',
        month:  'Últimos 30 días',
        custom: `${startDate} al ${endDate}`,
      };

      toExcel(rows, sheetNames[selected]);
      onClose();
    } catch (e) {
      setError('Error al conectar con el servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div className="bg-surface rounded-2xl w-full max-w-md shadow-2xl border border-outline-variant/15 overflow-hidden">

        {/* Header */}
        <div className="flex justify-between items-center px-6 py-5 bg-surface-container-low border-b border-outline-variant/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
              <Icon name="download" className="text-primary text-lg" />
            </div>
            <div>
              <h3 className="font-serif text-lg text-primary">Exportar Excel</h3>
              <p className="text-[10px] font-label uppercase tracking-widest text-stone-400">Selecciona el periodo</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-variant rounded-full text-stone-400 transition-colors">
            <Icon name="close" />
          </button>
        </div>

        {/* Period options */}
        <div className="p-6 space-y-2">
          {PERIOD_OPTS.map(opt => (
            <button
              key={opt.id}
              onClick={() => { setSelected(opt.id); setError(''); }}
              className={cn(
                'w-full flex items-center gap-4 px-4 py-3.5 rounded-xl border-2 transition-all text-left',
                selected === opt.id
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-outline-variant/15 hover:border-outline-variant/40 hover:bg-surface-container-low'
              )}>
              <div className={cn('w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0', selected === opt.id ? 'bg-primary text-on-primary' : 'bg-surface-container text-stone-400')}>
                <Icon name={opt.icon} className="text-base" />
              </div>
              <div className="flex-1">
                <p className={cn('text-sm font-label font-bold', selected === opt.id ? 'text-primary' : 'text-on-surface')}>{opt.label}</p>
                <p className="text-[10px] text-stone-400 font-body">{opt.sub}</p>
              </div>
              {selected === opt.id && <Icon name="check_circle" className="text-primary text-xl flex-shrink-0" />}
            </button>
          ))}

          {/* Custom date range */}
          {selected === 'custom' && (
            <div className="mt-2 grid grid-cols-2 gap-3 p-4 bg-surface-container-low rounded-xl border border-outline-variant/10">
              <div className="space-y-1.5">
                <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">Desde</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => { setStartDate(e.target.value); setError(''); }}
                  className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-label font-bold text-stone-500 uppercase tracking-widest">Hasta</label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={e => { setEndDate(e.target.value); setError(''); }}
                  className="w-full px-3 py-2 bg-background border border-outline-variant/20 rounded-lg text-sm font-body focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 bg-error-container/30 text-on-error-container px-4 py-2.5 rounded-lg border border-error/20">
              <Icon name="error" className="text-error text-base flex-shrink-0" />
              <p className="text-xs font-body">{error}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-3 bg-surface-variant text-on-surface-variant rounded-xl text-xs font-label font-bold hover:bg-stone-200 transition-all uppercase tracking-widest">
            Cancelar
          </button>
          <button
            onClick={handleDownload}
            disabled={!canDownload || loading}
            className={cn(
              'flex-1 py-3 rounded-xl text-xs font-label font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-md',
              canDownload && !loading
                ? 'bg-primary text-on-primary hover:bg-primary-container'
                : 'bg-stone-200 text-stone-400 cursor-not-allowed'
            )}>
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Generando...
              </>
            ) : (
              <>
                <Icon name="download" className="text-base" />
                Descargar Excel
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
