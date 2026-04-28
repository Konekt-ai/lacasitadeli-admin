const sql = require('mssql');
require('dotenv').config();

const config = {
  server:   process.env.MSSQL_SERVER   || '192.168.1.68',
  database: process.env.MSSQL_DATABASE || 'novacaja22',
  user:     process.env.MSSQL_USER     || 'sa',
  password: process.env.MSSQL_PASSWORD || '',
  port:     parseInt(process.env.MSSQL_PORT || '1433'),
  options: {
    encrypt:                false,
    trustServerCertificate: true,
    enableArithAbort:       true,
  },
  connectionTimeout: 10000,
  requestTimeout:    15000,
};

let pool = null;

async function getPool() {
  if (pool && pool.connected) return pool;
  pool = await sql.connect(config);
  return pool;
}

async function query(text, params = []) {
  const p   = await getPool();
  const req = p.request();
  // Convierte $1, $2... a @p1, @p2...
  let sqlText = text.replace(/\$(\d+)/g, (_, n) => `@p${n}`);
  params.forEach((val, i) => req.input(`p${i + 1}`, val));
  const result = await req.query(sqlText);
  return { rows: result.recordset || [] };
}

module.exports = { query, getPool, sql };
