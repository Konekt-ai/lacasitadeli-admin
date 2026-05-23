require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const mssql   = require('./db/mssql');
const { getDb } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

app.use('/api',          require('./modules/auth'));
app.use('/api/products', require('./modules/products'));
app.use('/api/sales',    require('./modules/sales'));
app.use('/api/novacaja', require('./modules/novacaja'));

app.get('/api/health', async (req, res) => {
  const status = { api: 'ok', sqlserver: 'error', sqlite: 'error' };
  try { await mssql.getPool(); status.sqlserver = 'connected'; } catch {}
  try { getDb(); status.sqlite = 'connected'; } catch {}
  const ok = status.sqlserver === 'connected';
  res.status(ok ? 200 : 503).json({ ...status, db: status.sqlserver });
});

// Implementación para aceptar conexiones externas a través de Tailscale
app.listen(PORT, '0.0.0.0', () => {
  console.log(`La Casita Admin — API en http://0.0.0.0:${PORT}`);
});