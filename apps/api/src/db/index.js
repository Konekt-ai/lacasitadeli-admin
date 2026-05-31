const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'lacasita.db');

let _db;
function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('cache_size = -32000');   // 32 MB page cache
  _db.pragma('synchronous = NORMAL'); // safe with WAL, faster than FULL
  _db.pragma('temp_store = MEMORY');  // temp tables in memory
  _db.pragma('mmap_size = 268435456'); // 256 MB memory-mapped I/O
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
    CREATE TABLE IF NOT EXISTS sync_sessions (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      periodo_inicio          TEXT NOT NULL,
      periodo_fin             TEXT NOT NULL,
      productos_actualizados  INTEGER DEFAULT 0,
      total_unidades          REAL DEFAULT 0,
      estado                  TEXT DEFAULT 'completado',
      notas                   TEXT,
      created_at              TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sync_deductions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id       INTEGER NOT NULL,
      art_codigo       TEXT NOT NULL,
      nombre           TEXT,
      cantidad_vendida REAL NOT NULL,
      stock_antes      REAL DEFAULT 0,
      stock_despues    REAL DEFAULT 0,
      created_at       TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS almacen_movimientos (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      art_codigo    TEXT NOT NULL,
      nombre        TEXT,
      tipo          TEXT NOT NULL CHECK(tipo IN ('entrada','salida')),
      cantidad      REAL NOT NULL,
      stock_antes   REAL DEFAULT 0,
      stock_despues REAL DEFAULT 0,
      usuario       TEXT DEFAULT 'TC52',
      notas         TEXT,
      area          TEXT DEFAULT 'bodega',
      pedido_id     INTEGER,
      created_at    TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS merma_registros (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      art_codigo   TEXT NOT NULL,
      nombre       TEXT,
      motivo       TEXT NOT NULL,
      area         TEXT DEFAULT 'bodega',
      cantidad     REAL NOT NULL,
      stock_antes  REAL DEFAULT 0,
      stock_despues REAL DEFAULT 0,
      notas        TEXT,
      usuario      TEXT DEFAULT 'TC52',
      created_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS stock_ubicaciones (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      art_codigo  TEXT NOT NULL,
      nombre      TEXT,
      area        TEXT NOT NULL,
      cantidad    REAL DEFAULT 0,
      updated_at  TEXT DEFAULT (datetime('now')),
      UNIQUE(art_codigo, area)
    );
    CREATE TABLE IF NOT EXISTS alertas_descartadas (
      art_codigo  TEXT    NOT NULL,
      tipo        TEXT    NOT NULL CHECK(tipo IN ('stagnant','noSales','expiry')),
      notas       TEXT,
      created_at  TEXT    DEFAULT (datetime('now')),
      PRIMARY KEY (art_codigo, tipo)
    );
    CREATE TABLE IF NOT EXISTS ubicaciones_config (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      clave       TEXT    NOT NULL UNIQUE,
      nombre      TEXT    NOT NULL,
      icono       TEXT    DEFAULT 'category',
      color_bg    TEXT    DEFAULT 'bg-stone-100',
      color_text  TEXT    DEFAULT 'text-stone-600',
      activo      INTEGER DEFAULT 1,
      orden       INTEGER DEFAULT 0,
      created_at  TEXT    DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS email_report_log (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo                 TEXT    NOT NULL DEFAULT 'monthly',
      productos_detectados INTEGER DEFAULT 0,
      noSales              INTEGER DEFAULT 0,
      stagnant             INTEGER DEFAULT 0,
      expiry               INTEGER DEFAULT 0,
      enviado_a            TEXT,
      created_at           TEXT    DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pedidos_recepcion (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      folio          TEXT    NOT NULL UNIQUE,
      proveedor      TEXT,
      fecha_esperada TEXT,
      estado         TEXT    NOT NULL DEFAULT 'pendiente'
                              CHECK(estado IN ('pendiente','en_recepcion','cerrado','cancelado')),
      notas          TEXT,
      cerrado_at     TEXT,
      created_at     TEXT    DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pedidos_recepcion_detalle (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      pedido_id         INTEGER NOT NULL REFERENCES pedidos_recepcion(id) ON DELETE CASCADE,
      art_codigo        TEXT    NOT NULL,
      nombre            TEXT,
      cantidad_esperada REAL    NOT NULL,
      created_at        TEXT    DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS consumo_area (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      art_codigo  TEXT NOT NULL,
      nombre      TEXT,
      area        TEXT NOT NULL,
      cantidad    REAL NOT NULL,
      notas       TEXT,
      usuario     TEXT DEFAULT 'admin',
      created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS facturas_compra (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      folio            TEXT    NOT NULL UNIQUE,
      proveedor        TEXT    NOT NULL,
      numero_factura   TEXT,
      fecha_emision    TEXT,
      fecha_esperada   TEXT,
      estado           TEXT    NOT NULL DEFAULT 'en_camino'
                                CHECK(estado IN ('en_camino','en_almacen','cancelada')),
      total_calculado  REAL    DEFAULT 0,
      notas            TEXT,
      pedido_id        INTEGER REFERENCES pedidos_recepcion(id),
      entregado_at     TEXT,
      created_at       TEXT    DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS facturas_compra_detalle (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      factura_id       INTEGER NOT NULL REFERENCES facturas_compra(id) ON DELETE CASCADE,
      art_codigo       TEXT    NOT NULL,
      nombre           TEXT,
      cantidad         REAL    NOT NULL,
      precio_unitario  REAL    NOT NULL,
      subtotal         REAL    NOT NULL,
      created_at       TEXT    DEFAULT (datetime('now'))
    );
  `);

  // Migraciones de columnas — deben ir ANTES de los índices que las referencian
  try { _db.exec(`ALTER TABLE almacen_movimientos ADD COLUMN area TEXT DEFAULT 'bodega'`); } catch (_) {}
  try { _db.exec(`ALTER TABLE almacen_movimientos ADD COLUMN pedido_id INTEGER`); } catch (_) {}

  // Indexes — created once, skipped if already exist
  _db.exec(`
    CREATE INDEX IF NOT EXISTS idx_expiry_fecha     ON product_expiry(fecha_caducidad);
    CREATE INDEX IF NOT EXISTS idx_expiry_alerta    ON product_expiry(alerta_enviada);
    CREATE INDEX IF NOT EXISTS idx_mov_art          ON almacen_movimientos(art_codigo);
    CREATE INDEX IF NOT EXISTS idx_mov_created      ON almacen_movimientos(created_at);
    CREATE INDEX IF NOT EXISTS idx_mov_pedido       ON almacen_movimientos(pedido_id);
    CREATE INDEX IF NOT EXISTS idx_merma_art        ON merma_registros(art_codigo);
    CREATE INDEX IF NOT EXISTS idx_merma_created    ON merma_registros(created_at);
    CREATE INDEX IF NOT EXISTS idx_ubicaciones_area ON stock_ubicaciones(area);
    CREATE INDEX IF NOT EXISTS idx_surtido_semana   ON surtido_transfers(semana);
    CREATE INDEX IF NOT EXISTS idx_surtido_auth     ON surtido_transfers(autorizado);
    CREATE INDEX IF NOT EXISTS idx_pedidos_estado   ON pedidos_recepcion(estado);
    CREATE INDEX IF NOT EXISTS idx_peddet_pedido    ON pedidos_recepcion_detalle(pedido_id);
    CREATE INDEX IF NOT EXISTS idx_facturas_estado  ON facturas_compra(estado);
    CREATE INDEX IF NOT EXISTS idx_factdet_factura  ON facturas_compra_detalle(factura_id);
    CREATE INDEX IF NOT EXISTS idx_consumo_area     ON consumo_area(area);
    CREATE INDEX IF NOT EXISTS idx_consumo_created  ON consumo_area(created_at);
    CREATE INDEX IF NOT EXISTS idx_recuentos_created ON recuentos(created_at);
    CREATE INDEX IF NOT EXISTS idx_alertas_tipo     ON alertas_descartadas(tipo);
  `);

  // Migración de nombres de áreas para coincidir con ubicaciones del TC52
  try { _db.exec(`UPDATE ubicaciones_config SET clave='casita_1', nombre='Casita 1', color_bg='bg-blue-50', color_text='text-blue-700', icono='storefront', orden=1 WHERE clave='tienda'`); } catch (_) {}
  try { _db.exec(`UPDATE ubicaciones_config SET clave='usa', nombre='USA', color_bg='bg-amber-50', color_text='text-amber-700', icono='flight', orden=3 WHERE clave='otro'`); } catch (_) {}
  try { _db.exec(`INSERT OR IGNORE INTO ubicaciones_config (clave, nombre, icono, color_bg, color_text, orden) VALUES ('casita_2','Casita 2','store','bg-purple-50','text-purple-700',2)`); } catch (_) {}
  try { _db.exec(`UPDATE ubicaciones_config SET color_bg='bg-emerald-50', color_text='text-emerald-700' WHERE clave='bodega'`); } catch (_) {}
  try { _db.exec(`UPDATE ubicaciones_config SET color_bg='bg-orange-50', color_text='text-orange-700', orden=4 WHERE clave='cocina'`); } catch (_) {}
  try { _db.exec(`UPDATE ubicaciones_config SET orden=5 WHERE clave='refrigerador'`); } catch (_) {}
  // Actualizar registros de datos con los nuevos claves de área
  try { _db.exec(`UPDATE stock_ubicaciones SET area='casita_1' WHERE area='tienda'`); } catch (_) {}
  try { _db.exec(`UPDATE stock_ubicaciones SET area='usa' WHERE area='otro'`); } catch (_) {}
  try { _db.exec(`UPDATE almacen_movimientos SET area='casita_1' WHERE area='tienda'`); } catch (_) {}
  try { _db.exec(`UPDATE almacen_movimientos SET area='usa' WHERE area='otro'`); } catch (_) {}
  try { _db.exec(`UPDATE merma_registros SET area='casita_1' WHERE area='tienda'`); } catch (_) {}
  try { _db.exec(`UPDATE merma_registros SET area='usa' WHERE area='otro'`); } catch (_) {}
  try { _db.exec(`UPDATE surtido_transfers SET de_area='casita_1' WHERE de_area='tienda'`); } catch (_) {}
  try { _db.exec(`UPDATE surtido_transfers SET a_area='casita_1' WHERE a_area='tienda'`); } catch (_) {}
  try { _db.exec(`UPDATE surtido_transfers SET de_area='usa' WHERE de_area='otro'`); } catch (_) {}
  try { _db.exec(`UPDATE surtido_transfers SET a_area='usa' WHERE a_area='otro'`); } catch (_) {}

  // Seed áreas por defecto si la tabla está vacía
  const areaCount = _db.prepare(`SELECT COUNT(*) AS n FROM ubicaciones_config`).get()?.n ?? 0;
  if (areaCount === 0) {
    const ins = _db.prepare(`
      INSERT OR IGNORE INTO ubicaciones_config (clave, nombre, icono, color_bg, color_text, orden)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    [
      ['bodega',       'Bodega',       'warehouse',  'bg-emerald-50', 'text-emerald-700', 0],
      ['casita_1',     'Casita 1',     'storefront', 'bg-blue-50',    'text-blue-700',    1],
      ['casita_2',     'Casita 2',     'store',      'bg-purple-50',  'text-purple-700',  2],
      ['usa',          'USA',          'flight',     'bg-amber-50',   'text-amber-700',   3],
      ['cocina',       'Cocina',       'restaurant', 'bg-orange-50',  'text-orange-700',  4],
      ['refrigerador', 'Refrigerador', 'ac_unit',    'bg-cyan-50',    'text-cyan-700',    5],
    ].forEach(a => ins.run(...a));
  }

  return _db;
}

module.exports = { getDb };
