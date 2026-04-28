#!/usr/bin/env node
/**
 * init-sqlserver.js — Inicializa el schema de La Casita en SQL Server
 *
 * Uso: node infra/init-sqlserver.js
 * Requiere que MSSQL_* estén en apps/api/.env
 */

const sql  = require('mssql');
const fs   = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../apps/api/.env') });

const config = {
  server:   process.env.MSSQL_SERVER   || '192.168.1.68',
  user:     process.env.MSSQL_USER     || 'sa',
  password: process.env.MSSQL_PASSWORD || '',
  port:     parseInt(process.env.MSSQL_PORT || '1433'),
  // Conectar al master primero para poder crear la base si no existe
  database: 'master',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
};

async function main() {
  console.log('\n🔌  Conectando a SQL Server...');
  const pool = await sql.connect(config);
  console.log('✅  Conectado a', process.env.MSSQL_SERVER || '192.168.1.68');

  const schemaPath = path.join(__dirname, 'init-sqlserver.sql');
  const fullSql = fs.readFileSync(schemaPath, 'utf8');

  // Separar por GO (delimitador de lotes T-SQL)
  const batches = fullSql
    .split(/^\s*GO\s*$/im)
    .map(b => b.trim())
    .filter(b => b.length > 0);

  console.log(`\n📦  Ejecutando ${batches.length} lotes de SQL...\n`);

  for (const batch of batches) {
    try {
      await pool.request().query(batch);
    } catch (err) {
      // Ignorar errores de "ya existe" (objetos duplicados)
      if (err.number === 2714 || err.number === 1801 || err.message.includes('already exists')) {
        console.warn('  ⚠️  Ya existe (omitido):', err.message.split('\n')[0]);
      } else {
        console.error('  ❌  Error:', err.message);
        throw err;
      }
    }
  }

  // Verificar tablas creadas
  const tables = await pool.request().query(`
    USE lacasita_admin;
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_NAME
  `);

  console.log('\n📋  Tablas en lacasita_admin:');
  tables.recordset.forEach(r => console.log(`    ✓ ${r.TABLE_NAME}`));

  console.log('\n🎉  Base de datos lista.');
  console.log('    Ahora puedes iniciar la API con pm2 start ecosystem.config.js\n');

  await pool.close();
}

main().catch(err => {
  console.error('\n❌  Error fatal:', err.message);
  process.exit(1);
});
