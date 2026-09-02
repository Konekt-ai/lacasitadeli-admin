// Forzar la zona horaria de todo el proceso a Ciudad de México (UTC-6, sin horario
// de verano). Debe ir ANTES de cualquier uso de fechas para que los logs, los Date
// locales y los cron usen la hora del negocio sin importar la config del servidor.
process.env.TZ = 'America/Mexico_City';

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const cron       = require('node-cron');
const mssql      = require('./db/mssql');
const { getDb }  = require('./db');
const emailSvc   = require('./modules/emailService');
const { setupRecepcionRoutes } = require('./modules/recepcion');

const app  = express();
const PORT = process.env.PORT || 3002;

// CORS restringido: el panel habla con la API por el proxy de Next (mismo origen,
// SIN cabecera Origin), así que esto NO afecta al panel. Permitimos: sin-Origin
// (proxy/curl/apps nativas), localhost, red local privada y Tailscale (100.64/10),
// más lo que se liste en CORS_ORIGINS. Bloquea webs públicas (mitiga CSRF al estar
// la API sin autenticación). Para abrir un origen extra: CORS_ORIGINS en el .env.
const corsAllowList = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const corsOrigin = (origin, cb) => {
  if (!origin) return cb(null, true); // server-to-server / curl / apps nativas
  try {
    const host = new URL(origin).hostname;
    const ok = host === 'localhost' || host === '127.0.0.1'
      || /^10\./.test(host) || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      || /^100\./.test(host) // Tailscale CGNAT
      || corsAllowList.includes(origin);
    return cb(null, ok);
  } catch { return cb(null, false); }
};
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

app.use('/api',          require('./modules/auth'));
app.use('/api/products', require('./modules/products'));
app.use('/api/sales',    require('./modules/sales'));
const novacaja = require('./modules/novacaja');
app.use('/api/novacaja', novacaja);
app.use('/api/bodega',   require('./modules/bodega'));
app.use('/api/almacen',  require('./modules/almacen'));
app.use('/api/facturas', require('./modules/facturas'));
app.use('/api/admin',   require('./modules/admin'));
const ventasSync = require('./modules/ventas-sync');
app.use('/api/ventas-sync', ventasSync.router);
const shopifySync = require('./modules/shopify-sync');
app.use('/api/shopify-sync', shopifySync.router);
const shopifyWeb = require('./modules/shopify-web');
app.use('/api/shopify-web', shopifyWeb.router);
const pedidosWeb = require('./modules/pedidos-web');
app.use('/api/pedidos-web', pedidosWeb.router);
setupRecepcionRoutes(app);

app.get('/api/health', async (req, res) => {
  const status = { api: 'ok', sqlserver: 'error', sqlite: 'error' };
  try { await mssql.getPool(); status.sqlserver = 'connected'; } catch {}
  try { getDb(); status.sqlite = 'connected'; } catch {}
  const ok = status.sqlserver === 'connected';
  res.status(ok ? 200 : 503).json({ ...status, db: status.sqlserver });
});

// Reporte semanal automático: TODOS los lunes a las 8:00 AM
// ('0 8 * * 1' = min 0, hora 8, cualquier día del mes, cualquier mes, día 1 = lunes)
cron.schedule('0 8 * * 1', async () => {
  console.log('[cron] Enviando reporte semanal de inventario...');
  try {
    const result = await emailSvc.sendMonthlyReport();
    console.log('[cron] Reporte semanal enviado:', result);
  } catch (err) {
    console.error('[cron] Error al enviar reporte semanal:', err.message);
  }
  // Resumen de ventas (día + semana + mes). Tambien se puede mandar manual desde Análisis.
  console.log('[cron] Enviando resumen de ventas...');
  try {
    const r = await novacaja.enviarResumenVentas();
    console.log('[cron] Resumen de ventas enviado:', r);
  } catch (err) {
    console.error('[cron] Error al enviar resumen de ventas:', err.message);
  }
}, { timezone: 'America/Mexico_City' });

// Atrapar errores no manejados para que no tumben el proceso
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.message : reason);
});

// Sincronización de ventas (tickets -> inventario_bodega). Solo actúa si está
// activada en ventas_sync_config (apagada por defecto).
ventasSync.startScheduler();

// Inventario bodega -> Shopify (por código de barras). Solo actúa si está
// activado en shopify_sync_config (apagado por defecto).
shopifySync.startScheduler();

// Pedidos de la página web (Shopify -> apartado -> salida física). Requiere el
// permiso read_orders en la app de Shopify; si falta, lo reporta en /estado.
pedidosWeb.startScheduler();

// Copia las fotos de la página al Inventario del panel (cada 12 h por defecto).
shopifyWeb.startFotosScheduler();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`La Casita Admin — API en http://0.0.0.0:${PORT}`);
});