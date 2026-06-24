'use client';
import React, { useMemo, useState } from 'react';
import { cn, hoyMX } from '../lib/utils';
import { Icon } from './Icon';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS_SEM = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const pad = (n: number) => String(n).padStart(2, '0');
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Calendario para elegir un día (no permite días futuros). value/onChange en ISO
// 'YYYY-MM-DD'. Reusable (Reportes, etc.).
export function DayCalendar({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  // "Hoy" SIEMPRE en hora de Ciudad de México, no en la zona del dispositivo.
  const todayISO = useMemo(() => hoyMX(), []);
  const ty       = Number(todayISO.slice(0, 4));     // año CDMX
  const tm       = Number(todayISO.slice(5, 7)) - 1; // mes CDMX (0-11)
  const sel      = value || todayISO;
  const [vy, setVy] = useState(Number(sel.slice(0, 4)));
  const [vm, setVm] = useState(Number(sel.slice(5, 7)) - 1); // 0-11

  const shift = (d: number) => { const nd = new Date(vy, vm + d, 1); setVy(nd.getFullYear()); setVm(nd.getMonth()); };
  const startWeekday = (new Date(vy, vm, 1).getDay() + 6) % 7; // Lunes = 0
  const daysInMonth  = new Date(vy, vm + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(startWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const enFuturo = vy > ty || (vy === ty && vm >= tm);

  return (
    <div className="bg-surface p-4 rounded-xl border border-outline-variant/10 w-full sm:w-[280px]">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => shift(-1)} className="p-1.5 hover:bg-stone-100 rounded-full text-stone-500 transition-colors">
          <Icon name="chevron_left" className="text-lg" />
        </button>
        <span className="font-serif text-base text-primary">{MESES[vm]} {vy}</span>
        <button onClick={() => shift(1)} disabled={enFuturo}
          className={cn('p-1.5 rounded-full transition-colors', enFuturo ? 'text-stone-200 cursor-not-allowed' : 'hover:bg-stone-100 text-stone-500')}>
          <Icon name="chevron_right" className="text-lg" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DIAS_SEM.map((d, i) => (
          <div key={i} className="text-center text-[9px] font-label uppercase tracking-widest text-stone-400 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const iso      = toISO(new Date(vy, vm, day));
          const esFuturo = iso > todayISO;
          const esHoy    = iso === todayISO;
          const esSel    = iso === sel;
          return (
            <button key={i} disabled={esFuturo} onClick={() => onChange(iso)}
              className={cn(
                'aspect-square rounded-md text-xs font-body flex items-center justify-center transition-all',
                esFuturo && 'text-stone-200 cursor-not-allowed',
                !esFuturo && !esSel && 'text-on-surface hover:bg-primary/10',
                esSel && 'bg-primary text-on-primary font-bold shadow-sm',
                !esSel && esHoy && 'ring-1 ring-primary/40 text-primary font-bold',
              )}>
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
