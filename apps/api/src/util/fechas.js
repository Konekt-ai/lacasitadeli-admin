// ── Fechas en hora de Ciudad de México ──────────────────────────────────────
// El negocio opera en CDMX (UTC-6, sin horario de verano desde 2022). Centralizamos
// el cálculo de "hoy" / rangos para que NO dependa de UTC (toISOString() siempre da
// UTC y causaba el bug de "Hoy" mostrando el día equivocado de noche) ni de la zona
// del servidor.
const TZ_MX = 'America/Mexico_City';

// 'en-CA' => YYYY-MM-DD. Intl con timeZone funciona sin importar process.env.TZ.
const _fmtFechaMX = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ_MX, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Fecha (YYYY-MM-DD) de un instante, en hora de CDMX. */
function fechaMX(d = new Date()) { return _fmtFechaMX.format(d); }
/** Hoy en CDMX (YYYY-MM-DD). */
function hoyMX() { return _fmtFechaMX.format(new Date()); }
/** Hace n días respecto a hoy, en CDMX (YYYY-MM-DD). n negativo = futuro. */
function diasAtrasMX(n) { return _fmtFechaMX.format(new Date(Date.now() - n * 86_400_000)); }
/** Mes actual en CDMX (YYYY-MM). */
function mesMX() { return hoyMX().slice(0, 7); }

// Las marcas created_at de SQLite se guardan en UTC (datetime('now')). Para
// comparar por DÍA en hora de CDMX usamos este desfase fijo (-6h, sin DST).
// Uso:  DATE(created_at, SQLITE_MX)  →  día calendario en CDMX.
const SQLITE_MX = '-6 hours';

module.exports = { TZ_MX, fechaMX, hoyMX, diasAtrasMX, mesMX, SQLITE_MX };
