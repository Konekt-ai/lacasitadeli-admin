import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ── Zona horaria del negocio ────────────────────────────────────────────────
// Todo el sistema usa la hora de Ciudad de México (UTC-6, sin horario de verano
// desde 2022). Calculamos "hoy" / "ayer" / "hace N días" SIEMPRE en esta zona,
// no con toISOString() (que da UTC) ni con la zona del celular/navegador. Así los
// botones Hoy/Ayer/7 días filtran el día correcto sin importar dónde esté el
// dispositivo que abre el panel.
export const TZ_MX = 'America/Mexico_City';

// 'en-CA' formatea como YYYY-MM-DD, justo lo que esperan los inputs <input type="date">
const _fmtFechaMX = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ_MX, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Fecha (YYYY-MM-DD) de un instante, en hora de Ciudad de México. */
export function fechaMX(d: Date = new Date()): string {
  return _fmtFechaMX.format(d);
}
/** Hoy en Ciudad de México (YYYY-MM-DD). */
export function hoyMX(): string {
  return _fmtFechaMX.format(new Date());
}
/** Hace n días respecto a hoy, en CDMX (YYYY-MM-DD). n negativo = hacia el futuro. */
export function diasAtrasMX(n: number): string {
  return _fmtFechaMX.format(new Date(Date.now() - n * 86_400_000));
}
/** Mes actual en CDMX (YYYY-MM). */
export function mesMX(): string {
  return hoyMX().slice(0, 7);
}
