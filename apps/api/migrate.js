// ============================================================
// migrate.js — Migración idempotente de la base (tablas de recepción).
// La ejecuta actualizar-sistema.bat en cada actualización: es SEGURO repetirla
// porque crear_tablas_recepcion.sql usa IF NOT EXISTS / DROP-CREATE.
//
// Manual:  cd apps/api && node migrate.js
// Reutiliza la MISMA conexión MSSQL que el API (apps/api/.env + src/db/mssql).
// ============================================================

const path = require('path');
// Fijar el .env por ruta ANTES de requerir el módulo de conexión (db/mssql usa el cwd).
require('dotenv').config({ path: path.join(__dirname, '.env') });

const fs = require('fs');
const { getPool } = require('./src/db/mssql');

// El .sql vive en la raíz del repo admin (apps/api -> .. -> ..)
const SQL_FILE = path.resolve(__dirname, '..', '..', 'crear_tablas_recepcion.sql');

async function main() {
  if (!fs.existsSync(SQL_FILE)) {
    console.warn('[migrate] No se encontró', SQL_FILE, '— se omite.');
    return process.exit(0);
  }

  const text = fs.readFileSync(SQL_FILE, 'utf8');
  // Separar en lotes por líneas "GO" (el driver mssql no entiende GO).
  // NO filtrar bloques que empiezan con comentario: muchos CREATE van precedidos de "-- ...".
  const batches = text
    .split(/^\s*GO\s*$/gim)
    .map(b => b.trim())
    .filter(b => b.length > 0);

  let pool;
  try {
    pool = await getPool();
  } catch (e) {
    // No bloquear la actualización si la base no está accesible en este momento.
    console.error('[migrate] No se pudo conectar a MSSQL:', e.message);
    return process.exit(0);
  }

  let ok = 0, avisos = 0;
  for (let i = 0; i < batches.length; i++) {
    try {
      await pool.request().batch(batches[i]);  // .batch() permite CREATE PROCEDURE/VIEW
      ok++;
    } catch (e) {
      avisos++;
      console.warn(`[migrate] Bloque ${i + 1}/${batches.length}: ${e.message.slice(0, 140)}`);
    }
  }

  console.log(`[migrate] Recepción: ${ok} OK, ${avisos} avisos de ${batches.length} bloques.`);
  await pool.close().catch(() => {});
  process.exit(0);
}

main().catch(e => {
  console.error('[migrate] Falló:', e.message);
  process.exit(0); // best-effort: nunca bloquear la actualización
});
