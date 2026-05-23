// Conexión de solo lectura a la base novacaja22 (POS del cliente)
const sql = require('mssql');
require('dotenv').config();

const config = {
  server:   process.env.MSSQL_SERVER   || 'localhost',
  database: process.env.MSSQL_DATABASE || 'novacaja22',
  user:     process.env.MSSQL_USER     || 'sa',
  password: process.env.MSSQL_PASSWORD || '',
  port:     parseInt(process.env.MSSQL_PORT || '1433'),
  options: {
    encrypt:                false,
    trustServerCertificate: true,
    enableArithAbort:       true,
  },
  connectionTimeout: 60000, // Aumentado a 60 segundos
  requestTimeout:    60000, // Aumentado a 60 segundos
};

let pool = null;

async function getPool() {
  if (pool && pool.connected) return pool;
  pool = await sql.connect(config);
  return pool;
}

async function query(queryStr, params = {}) {
  const p   = await getPool();
  const req = p.request();
  for (const [key, value] of Object.entries(params)) {
    req.input(key, value);
  }
  return req.query(queryStr);
}

module.exports = { getPool, query, sql };