const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'lacasita.db');

let _db;
function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS product_overrides (
      art_codigo   TEXT PRIMARY KEY,
      image_url    TEXT,
      min_stock    INTEGER,
      updated_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS categorias (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre      TEXT NOT NULL UNIQUE,
      descripcion TEXT,
      activo      INTEGER DEFAULT 1,
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ventas (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      folio       TEXT NOT NULL UNIQUE,
      canal       TEXT DEFAULT 'caja',
      cajero      TEXT DEFAULT 'Sistema',
      metodo_pago TEXT DEFAULT 'efectivo',
      total       REAL DEFAULT 0,
      estado      TEXT DEFAULT 'completada',
      notas       TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS detalle_venta (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      venta_id        INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
      novacaja_id     TEXT,
      nombre_producto TEXT,
      cantidad        REAL NOT NULL,
      precio_unitario REAL NOT NULL,
      subtotal        REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS product_locations (
      art_codigo   TEXT PRIMARY KEY,
      area         TEXT NOT NULL DEFAULT 'bodega',
      notas        TEXT,
      updated_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS product_expiry (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      art_codigo      TEXT NOT NULL,
      nombre          TEXT,
      fecha_caducidad TEXT NOT NULL,
      cantidad        REAL DEFAULT 0,
      area            TEXT DEFAULT 'bodega',
      notas           TEXT,
      alerta_enviada  INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS surtido_transfers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      art_codigo   TEXT NOT NULL,
      nombre       TEXT,
      de_area      TEXT NOT NULL DEFAULT 'bodega',
      a_area       TEXT NOT NULL,
      cantidad     REAL NOT NULL,
      autorizado   INTEGER DEFAULT 0,
      semana       TEXT,
      notas        TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS recuentos (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      art_codigo     TEXT NOT NULL,
      nombre         TEXT,
      stock_sistema  REAL DEFAULT 0,
      stock_conteo   REAL DEFAULT 0,
      area           TEXT DEFAULT 'bodega',
      notas          TEXT,
      created_at     TEXT DEFAULT (datetime('now'))
    );
  `);
  return _db;
}

module.exports = { getDb };
