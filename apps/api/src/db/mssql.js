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
  pool: {
    max:                  10,
    min:                  2,
    idleTimeoutMillis:    30_000,
    acquireTimeoutMillis: 15_000,
  },
  connectionTimeout: 30_000,
  requestTimeout:    60_000,
};

let pool = null;

async function getPool() {
  if (pool && pool.connected && !pool._destroyed) return pool;
  try {
    pool = await sql.connect(config);
    return pool;
  } catch (err) {
    pool = null; // reset para que el proximo intento cree conexion fresca
    throw err;
  }
}

async function query(queryStr, params = {}) {
  const p   = await getPool();
  const req = p.request();
  for (const [key, value] of Object.entries(params)) {
    req.input(key, value);
  }
  return req.query(queryStr);
}

// Pre-warm the connection when the module loads so the first request is fast
getPool().catch(() => {});

module.exports = { getPool, query, sql };
