#!/usr/bin/env node
/**
 * init-neon.js  —  Inicializa el schema de La Casita en Neon PostgreSQL
 * 
 * Uso:
 *   cd infra
 *   node init-neon.js
 *
 * Requiere que DATABASE_URL esté en apps/api/.env
 */

const { Client } = require('pg');
const fs   = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../apps/api/.env') });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL no encontrada. Verifica apps/api/.env');
  process.exit(1);
}

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  console.log('🔌  Conectando a Neon PostgreSQL...');
  await client.connect();
  console.log('✅  Conectado\n');

  // Leer el schema
  const schemaPath = path.join(__dirname, '../tienda_abarrotes_schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.error(`❌  No se encontró el schema en: ${schemaPath}`);
    await client.end();
    process.exit(1);
  }

  const sql = fs.readFileSync(schemaPath, 'utf8');

  console.log('📦  Ejecutando schema...');
  try {
    await client.query(sql);
    console.log('✅  Schema creado exitosamente\n');
  } catch (err) {
    // Si las tablas ya existen, solo advertir
    if (err.code === '42P07') {
      console.warn('⚠️   Algunas tablas ya existen — se omitieron.');
    } else {
      console.error('❌  Error ejecutando schema:', err.message);
      await client.end();
      process.exit(1);
    }
  }

  // Verificar tablas creadas
  const tables = await client.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  console.log('📋  Tablas en la base de datos:');
  tables.rows.forEach(r => console.log(`    ✓ ${r.tablename}`));

  // Verificar datos de ejemplo
  const productos = await client.query('SELECT COUNT(*) FROM productos');
  const categorias = await client.query('SELECT COUNT(*) FROM categorias');
  console.log(`\n📊  Datos iniciales:`);
  console.log(`    Categorías: ${categorias.rows[0].count}`);
  console.log(`    Productos:  ${productos.rows[0].count}`);

  console.log('\n🎉  Base de datos lista. Puedes iniciar la API con:');
  console.log('    cd apps/api && npm run dev\n');

  await client.end();
}

main().catch(err => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});