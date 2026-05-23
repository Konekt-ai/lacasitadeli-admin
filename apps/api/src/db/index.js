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
  `);
  return _db;
}

module.exports = { getDb };
