require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const cron       = require('node-cron');
const mssql      = require('./db/mssql');
const { getDb }  = require('./db');
const emailSvc   = require('./modules/emailService');

const app  = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

app.use('/api',          require('./modules/auth'));
app.use('/api/products', require('./modules/products'));
app.use('/api/sales',    require('./modules/sales'));
app.use('/api/novacaja', require('./modules/novacaja'));
app.use('/api/bodega',   require('./modules/bodega'));
app.use('/api/almacen',  require('./modules/almacen'));
app.use('/api/facturas', require('./modules/facturas'));
app.use('/api/admin',   require('./modules/admin'));

app.get('/api/health', async (req, res) => {
  const status = { api: 'ok', sqlserver: 'error', sqlite: 'error' };
  try { await mssql.getPool(); status.sqlserver = 'connected'; } catch {}
  try { getDb(); status.sqlite = 'connected'; } catch {}
  const ok = status.sqlserver === 'connected';
  res.status(ok ? 200 : 503).json({ ...status, db: status.sqlserver });
});

// Reporte mensual automático: día 1 de cada mes a las 8:00 AM
cron.schedule('0 8 1 * *', async () => {
  console.log('[cron] Enviando reporte mensual de inventario...');
  try {
    const result = await emailSvc.sendMonthlyReport();
    console.log('[cron] Reporte mensual enviado:', result);
  } catch (err) {
    console.error('[cron] Error al enviar reporte mensual:', err.message);
  }
}, { timezone: 'America/Mexico_City' });

// Atrapar errores no manejados para que no tumben el proceso
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.message : reason);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`La Casita Admin — API en http://0.0.0.0:${PORT}`);
});