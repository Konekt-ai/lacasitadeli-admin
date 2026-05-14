#!/usr/bin/env node
// Inicializa el schema de La Casita en PostgreSQL local
// Uso: node infra/init-local.js

const { Client } = require('pg');
const fs   = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../apps/api/.env') });

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: false });

  console.log('\n Conectando a PostgreSQL...');
  await client.connect();
  console.log(' Conectado a', process.env.DATABASE_URL?.split('@')[1] || 'localhost');

  const sql = fs.readFileSync(path.join(__dirname, 'init-local.sql'), 'utf8');

  console.log('\n Ejecutando schema...');
  await client.query(sql);
  console.log(' Schema creado\n');

  const tables = await client.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' ORDER BY tablename
  `);
  console.log(' Tablas creadas:');
  tables.rows.forEach(r => console.log(`   - ${r.tablename}`));

  console.log('\n Base de datos lista.\n');
  await client.end();
}

main().catch(err => {
  console.error('\n Error:', err.message);
  process.exit(1);
});
