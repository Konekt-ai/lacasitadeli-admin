const express = require('express');
const { getDb } = require('../db');
const mssql    = require('../db/mssql');

const router = express.Router();

// Cache TTL simple (las alertas son consultas pesadas y se consultan seguido)
const _cache = new Map();
const _cacheGet = (k) => { const e = _cache.get(k); return e && Date.now() < e.exp ? e.v : null; };
const _cacheSet = (k, v, ttlMs) => _cache.set(k, { v, exp: Date.now() + ttlMs });
let _sinPrecioRunning = false; // evita disparar la consulta pesada en paralelo
// Consulta pesada limitada a 1 núcleo (no acapara la CPU que usa NovaCaja).
const heavy = (sql) => mssql.query(sql + '\n    OPTION (MAXDOP 1)');

function getValidAreas(db) {
  return db.prepare(
    `SELECT clave FROM ubicaciones_config WHERE activo = 1 ORDER BY orden`
  ).all().map(r => r.clave);
}

function getWeekNumber(d) {
  const date   = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function esc(s) { return String(s || '').replace(/'/g, "''"); }

// ── Áreas unificadas (fuente de verdad: MSSQL ubicaciones_bodega) ──
function areaClave(nombre) {
  return String(nombre || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '_') || 'area';
}
async function getAreaList() {
  const r = await mssql.query(
    `SELECT nombre FROM [compucaja].[dbo].[ubicaciones_bodega] WHERE activa=1 ORDER BY orden, nombre`
  );
  return (r.recordset || []).map(u => ({ clave: areaClave(u.nombre), nombre: u.nombre }));
}
async function getAreaClaves() {
  return (await getAreaList()).map(a => a.clave);
}

// ── GET /api/bodega/area-counts ───────────────────────────────────────────────
router.get('/area-counts', async (req, res) => {
  try {
    const db     = getDb();
    const areas  = await getAreaList();  // lista unificada desde MSSQL
    const counts = db.prepare(`SELECT area, COUNT(*) AS total FROM product_locations GROUP BY area`).all();
    const map    = Object.fromEntries(counts.map(r => [r.area, r.total]));
    res.json(areas.map(a => ({ area: a.clave, nombre: a.nombre, total: map[a.clave] || 0 })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/bodega/products-by-area — all location assignments (for badge display) ──
router.get('/products-by-area', (req, res) => {
  try {
    const rows = getDb().prepare(
      `SELECT art_codigo, area, notas, updated_at FROM product_locations`
    ).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/bodega/areas/:area/products ─────────────────────────────────────
// Products in a given area. For 'bodega': everything not assigned elsewhere.
router.get('/areas/:area/products', async (req, res) => {
  const { area } = req.params;
  const search   = (req.query.search || '').trim();
  try {
    const db         = getDb();
    const validAreas = await getAreaClaves();
    if (!validAreas.includes(area)) return res.status(400).json({ error: 'Área inválida' });
    const searchClause = search
      ? `AND (a.Art_Descripcion LIKE '%${esc(search)}%' OR a.Art_Codigo LIKE '%${esc(search)}%')`
      : '';

    if (area === 'bodega') {
      const assignedElsewhere = db.prepare(
        `SELECT art_codigo FROM product_locations WHERE area != 'bodega'`
      ).all().map(r => r.art_codigo);

      const excludeClause = assignedElsewhere.length > 0
        ? `AND a.Art_Codigo NOT IN (${assignedElsewhere.map(c => `'${esc(c)}'`).join(',')})`
        : '';

      const result = await mssql.query(`
        SELECT TOP 200
          a.Art_Codigo            AS id,
          a.Art_Descripcion       AS name,
          aa.AA_ExistenciaActualU AS stock,
          a.Org_Descripcion       AS category
        FROM [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
        JOIN [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
          ON aa.Art_Codigo = a.Art_Codigo
        WHERE a.Art_Descripcion IS NOT NULL AND a.Art_Descripcion <> ''
          ${excludeClause}
          ${searchClause}
        ORDER BY aa.AA_ExistenciaActualU DESC
      `);
      return res.json(result.recordset || []);
    }

    // Other areas: only explicitly assigned products
    const assigned = db.prepare(
      `SELECT art_codigo, notas FROM product_locations WHERE area = ?`
    ).all(area);

    if (assigned.length === 0) return res.json([]);

    const codes    = assigned.map(r => `'${esc(r.art_codigo)}'`).join(',');
    const notesMap = new Map(assigned.map(r => [r.art_codigo, r.notas]));

    const result = await mssql.query(`
      SELECT
        a.Art_Codigo            AS id,
        a.Art_Descripcion       AS name,
        aa.AA_ExistenciaActualU AS stock,
        a.Org_Descripcion       AS category
      FROM [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
      JOIN [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
        ON aa.Art_Codigo = a.Art_Codigo
      WHERE a.Art_Codigo IN (${codes}) ${searchClause}
      ORDER BY aa.AA_ExistenciaActualU DESC
    `);

    const rows = (result.recordset || []).map(r => ({
      ...r,
      notas: notesMap.get(r.id) || null,
    }));
    res.json(rows);
  } catch (err) {
    console.error('Error products-by-area:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/bodega/products/:id/location ────────────────────────────────────
router.put('/products/:id/location', async (req, res) => {
  const { area, notas } = req.body;
  const artCodigo       = req.params.id;

  const db = getDb();
  if (!(await getAreaClaves()).includes(area)) return res.status(400).json({ error: 'Área inválida' });

  try {
    db.prepare(`
      INSERT INTO product_locations (art_codigo, area, notas, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(art_codigo) DO UPDATE
        SET area = excluded.area, notas = excluded.notas, updated_at = excluded.updated_at
    `).run(artCodigo, area, notas || null);
    res.json({ message: 'Ubicación actualizada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/bodega/expiry ───────────────────────────────────────────────────
router.get('/expiry', (req, res) => {
  try {
    const rows = getDb().prepare(
      `SELECT * FROM product_expiry ORDER BY fecha_caducidad ASC`
    ).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/bodega/expiry ──────────────────────────────────────────────────
router.post('/expiry', (req, res) => {
  const { art_codigo, nombre, fecha_caducidad, cantidad, area, notas } = req.body;
  if (!art_codigo || !fecha_caducidad)
    return res.status(400).json({ error: 'Código y fecha son requeridos' });

  try {
    const r = getDb().prepare(`
      INSERT INTO product_expiry (art_codigo, nombre, fecha_caducidad, cantidad, area, notas)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(art_codigo, nombre || null, fecha_caducidad, cantidad || 0, area || 'bodega', notas || null);
    res.json({ id: r.lastInsertRowid, message: 'Caducidad registrada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/bodega/expiry/:id ────────────────────────────────────────────
router.delete('/expiry/:id', (req, res) => {
  try {
    getDb().prepare('DELETE FROM product_expiry WHERE id = ?').run(req.params.id);
    res.json({ message: 'Registro eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/bodega/surtido ──────────────────────────────────────────────────
router.get('/surtido', (req, res) => {
  try {
    const rows = getDb().prepare(
      `SELECT * FROM surtido_transfers ORDER BY created_at DESC LIMIT 200`
    ).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/bodega/surtido ─────────────────────────────────────────────────
router.post('/surtido', (req, res) => {
  const { art_codigo, nombre, de_area, a_area, cantidad, notas } = req.body;
  if (!art_codigo || !cantidad || !de_area || !a_area)
    return res.status(400).json({ error: 'Datos incompletos' });

  const now    = new Date();
  const week   = getWeekNumber(now);
  const semana = `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;

  try {
    const r = getDb().prepare(`
      INSERT INTO surtido_transfers (art_codigo, nombre, de_area, a_area, cantidad, semana, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(art_codigo, nombre || null, de_area, a_area, parseFloat(cantidad), semana, notas || null);
    res.json({ id: r.lastInsertRowid, message: 'Transferencia registrada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/bodega/surtido/:id/autorizar ────────────────────────────────────
router.put('/surtido/:id/autorizar', async (req, res) => {
  const db       = getDb();
  const transfer = db.prepare('SELECT * FROM surtido_transfers WHERE id = ?').get(req.params.id);

  if (!transfer)           return res.status(404).json({ error: 'Transferencia no encontrada' });
  if (transfer.autorizado) return res.status(400).json({ error: 'Ya está autorizada' });

  const qty = parseFloat(transfer.cantidad);

  try {
    if (transfer.de_area === 'bodega') {
      await mssql.query(`
        UPDATE [compucaja].[dbo].[ArticulosAlmacen]
        SET AA_ExistenciaActualU = AA_ExistenciaActualU - ${qty}
        WHERE Art_Codigo = '${esc(transfer.art_codigo)}'
      `);
    }
    db.prepare('UPDATE surtido_transfers SET autorizado = 1 WHERE id = ?').run(req.params.id);

    // Actualizar stock por ubicación: descontar origen, sumar destino
    const upsert = db.prepare(`
      INSERT INTO stock_ubicaciones (art_codigo, nombre, area, cantidad)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(art_codigo, area) DO UPDATE SET
        nombre     = COALESCE(excluded.nombre, nombre),
        cantidad   = MAX(0, cantidad + excluded.cantidad),
        updated_at = datetime('now')
    `);
    upsert.run(transfer.art_codigo, transfer.nombre || null, transfer.de_area, -qty);
    upsert.run(transfer.art_codigo, transfer.nombre || null, transfer.a_area,  +qty);

    res.json({ message: 'Autorizada y descontada del inventario' });
  } catch (err) {
    console.error('Error autorizar surtido:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/bodega/stock-ubicaciones ────────────────────────────────────────
router.get('/stock-ubicaciones', (req, res) => {
  const { area } = req.query;
  try {
    const db = getDb();
    const rows = area
      ? db.prepare(`SELECT art_codigo, nombre, area, cantidad, updated_at FROM stock_ubicaciones WHERE area = ? AND cantidad > 0 ORDER BY nombre ASC`).all(area)
      : db.prepare(`SELECT art_codigo, nombre, area, cantidad, updated_at FROM stock_ubicaciones WHERE cantidad > 0 ORDER BY area, nombre ASC`).all();
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/bodega/consumo-area ─────────────────────────────────────────────
router.post('/consumo-area', (req, res) => {
  const { art_codigo, nombre, area, cantidad, notas } = req.body;
  if (!art_codigo || !area || !cantidad)
    return res.status(400).json({ error: 'art_codigo, area y cantidad son requeridos' });
  const qty = parseFloat(cantidad);
  if (qty <= 0) return res.status(400).json({ error: 'Cantidad debe ser mayor a 0' });

  const db = getDb();
  try {
    const current = db.prepare(`SELECT cantidad FROM stock_ubicaciones WHERE art_codigo = ? AND area = ?`).get(art_codigo, area);
    const stockAntes = current?.cantidad ?? 0;

    db.prepare(`INSERT INTO consumo_area (art_codigo, nombre, area, cantidad, notas) VALUES (?, ?, ?, ?, ?)`)
      .run(art_codigo, nombre || null, area, qty, notas || null);

    db.prepare(`
      INSERT INTO stock_ubicaciones (art_codigo, nombre, area, cantidad)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(art_codigo, area) DO UPDATE SET
        cantidad   = MAX(0, cantidad - excluded.cantidad),
        updated_at = datetime('now')
    `).run(art_codigo, nombre || null, area, qty);

    res.json({ ok: true, message: 'Consumo registrado', stockAntes, stockDespues: Math.max(0, stockAntes - qty) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/bodega/consumo-area ──────────────────────────────────────────────
router.get('/consumo-area', (req, res) => {
  const { area, fecha } = req.query;
  const db = getDb();
  try {
    let sql = `SELECT * FROM consumo_area WHERE 1=1`;
    const params = [];
    if (area)  { sql += ` AND area = ?`;           params.push(area); }
    if (fecha) { sql += ` AND date(created_at) = ?`; params.push(fecha); }
    sql += ` ORDER BY created_at DESC LIMIT 200`;
    res.json(db.prepare(sql).all(...params));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/bodega/discrepancias ────────────────────────────────────────────
router.get('/discrepancias', async (req, res) => {
  const db = getDb();
  const dismissed = new Set(
    db.prepare(`SELECT art_codigo FROM alertas_descartadas WHERE tipo = 'stagnant'`).all().map(r => r.art_codigo)
  );
  const dismissedNoSales = new Set(
    db.prepare(`SELECT art_codigo FROM alertas_descartadas WHERE tipo = 'noSales'`).all().map(r => r.art_codigo)
  );

  let stagnant = [], noSales = [];
  try {
    const [sRes, nRes] = await Promise.all([
      mssql.query(`
        SELECT TOP 100
          a.Art_Codigo              AS id,
          a.Art_Descripcion         AS name,
          ISNULL(aa.AA_ExistenciaActualU, 0) AS stock,
          a.Art_VECategoria         AS category,
          a.Art_FechaUltimaVenta    AS ultima_venta
        FROM [compucaja].[dbo].[Articulos] a WITH (NOLOCK)
        JOIN [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
          ON aa.Art_Codigo = a.Art_Codigo
        WHERE aa.AA_ExistenciaActualU > 0
          AND a.Art_Bloqueado = 0
          AND (a.Art_FechaUltimaVenta < DATEADD(day, -30, GETDATE()) OR a.Art_FechaUltimaVenta IS NULL)
        ORDER BY aa.AA_ExistenciaActualU DESC
      `),
      mssql.query(`
        SELECT TOP 100
          a.Art_Codigo              AS id,
          a.Art_Descripcion         AS name,
          ISNULL(aa.AA_ExistenciaActualU, 0) AS stock,
          a.Art_VECategoria         AS category,
          a.Art_FechaUltimaVenta    AS ultima_venta
        FROM [compucaja].[dbo].[Articulos] a WITH (NOLOCK)
        JOIN [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
          ON aa.Art_Codigo = a.Art_Codigo
        WHERE aa.AA_ExistenciaActualU > 0
          AND a.Art_Bloqueado = 0
          AND (
            a.Art_FechaUltimaVenta < DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
            OR a.Art_FechaUltimaVenta IS NULL
          )
        ORDER BY aa.AA_ExistenciaActualU DESC
      `),
    ]);
    stagnant = (sRes.recordset || []).filter(r => !dismissed.has(r.id));
    noSales  = (nRes.recordset || []).filter(r => !dismissedNoSales.has(r.id));
  } catch (e) {
    console.error('MSSQL discrepancias error:', e.message);
  }

  const recuentos = db.prepare(`SELECT * FROM recuentos ORDER BY created_at DESC LIMIT 100`).all();

  res.json({ stagnant, noSales, recuentos });
});

// ── POST /api/bodega/recuento ─────────────────────────────────────────────────
router.post('/recuento', (req, res) => {
  const { art_codigo, nombre, stock_sistema, stock_conteo, area, notas } = req.body;
  if (!art_codigo) return res.status(400).json({ error: 'Código requerido' });

  try {
    const r = getDb().prepare(`
      INSERT INTO recuentos (art_codigo, nombre, stock_sistema, stock_conteo, area, notas)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      art_codigo,
      nombre || null,
      parseFloat(stock_sistema) || 0,
      parseFloat(stock_conteo)  || 0,
      area  || 'bodega',
      notas || null,
    );
    res.json({ id: r.lastInsertRowid, message: 'Recuento registrado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/bodega/alerts ───────────────────────────────────────────────────
router.get('/alerts', async (req, res) => {
  try {
    const cached = _cacheGet('alerts');
    if (cached) return res.json(cached);

    const db    = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const in30  = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

    const expirySoon = db.prepare(
      `SELECT * FROM product_expiry WHERE fecha_caducidad BETWEEN ? AND ? ORDER BY fecha_caducidad ASC`
    ).all(today, in30);

    const expired = db.prepare(
      `SELECT * FROM product_expiry WHERE fecha_caducidad < ? ORDER BY fecha_caducidad DESC`
    ).all(today);

    const dismissed         = new Set(db.prepare(`SELECT art_codigo FROM alertas_descartadas WHERE tipo = 'stagnant'`).all().map(r => r.art_codigo));
    const dismissedNoSales  = new Set(db.prepare(`SELECT art_codigo FROM alertas_descartadas WHERE tipo = 'noSales'`).all().map(r => r.art_codigo));
    const dismissedSinPrecio = new Set(db.prepare(`SELECT art_codigo FROM alertas_descartadas WHERE tipo = 'sinPrecio'`).all().map(r => r.art_codigo));

    // Productos con PRECIO de venta pero con COSTO en $0 (sin factura y
    // Art_UltimoCosto=0 → lo que el panel muestra como "Costo: $0.00"). Estos
    // distorsionan la ganancia; el cliente debe capturar el costo real. Consulta
    // de catálogo (algo pesada) → corre en SEGUNDO PLANO con cache de 2 h: nunca
    // bloquea el panel. No inventamos costos.
    let sinPrecioRaw = _cacheGet('sinPrecioRaw');
    if (!sinPrecioRaw) {
      sinPrecioRaw = []; // aún no calculado; se llena en segundo plano para la próxima
      if (!_sinPrecioRunning) {
        _sinPrecioRunning = true;
        heavy(`
          SELECT TOP 200
            a.Art_Codigo                              AS id,
            a.Art_Descripcion                         AS name,
            (SELECT ISNULL(SUM(aa.AA_ExistenciaActualU),0) FROM [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK) WHERE aa.Art_Codigo = a.Art_Codigo) AS stock,
            ISNULL(a.Art_UltimoCosto, 0)              AS costoNovacaja,
            ISNULL(lp.LPA_PrecioVentaImp, 0)          AS precioLista,
            1                                         AS faltaCosto,
            CASE WHEN ISNULL(lp.LPA_PrecioVentaImp,0) = 0 THEN 1 ELSE 0 END AS faltaPrecio
          FROM [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
          LEFT JOIN [compucaja].[dbo].[costos_producto] cpf WITH (NOLOCK) ON cpf.codigo_barras = a.Art_Codigo AND cpf.fuente = 'factura'
          LEFT JOIN [compucaja].[dbo].[ListaPreciosArt] lp WITH (NOLOCK) ON lp.Art_Codigo = a.Art_Codigo AND lp.LP_Codigo = 1
          WHERE a.Art_Descripcion IS NOT NULL AND a.Art_Descripcion <> ''
            AND ISNULL(lp.LPA_PrecioVentaImp,0) > 0
            AND COALESCE(NULLIF(cpf.precio_compra,0), NULLIF(a.Art_UltimoCosto,0), NULLIF(a.Art_CostoReposicion,0)) IS NULL
          ORDER BY lp.LPA_PrecioVentaImp DESC
        `)
          .then(r => _cacheSet('sinPrecioRaw', r.recordset || [], 7200_000)) // 2 h
          .catch(e => console.error('MSSQL sinPrecio fetch error:', e.message))
          .finally(() => { _sinPrecioRunning = false; });
      }
    }
    const sinPrecio = (sinPrecioRaw || []).filter(r => !dismissedSinPrecio.has(r.id));

    let stagnant = [], noSales = [];
    try {
      const [sRes, nRes] = await Promise.all([
        heavy(`
          SELECT TOP 100
            a.Art_Codigo              AS id,
            a.Art_Descripcion         AS name,
            ISNULL(aa.AA_ExistenciaActualU, 0) AS stock,
            a.Art_VECategoria         AS category,
            a.Art_FechaUltimaVenta    AS ultima_venta
          FROM [compucaja].[dbo].[Articulos] a WITH (NOLOCK)
          JOIN [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
            ON aa.Art_Codigo = a.Art_Codigo
          WHERE aa.AA_ExistenciaActualU > 0
            AND a.Art_Bloqueado = 0
            AND (a.Art_FechaUltimaVenta < DATEADD(day, -30, GETDATE()) OR a.Art_FechaUltimaVenta IS NULL)
          ORDER BY aa.AA_ExistenciaActualU DESC
        `),
        heavy(`
          SELECT TOP 100
            a.Art_Codigo              AS id,
            a.Art_Descripcion         AS name,
            ISNULL(aa.AA_ExistenciaActualU, 0) AS stock,
            a.Art_VECategoria         AS category,
            a.Art_FechaUltimaVenta    AS ultima_venta
          FROM [compucaja].[dbo].[Articulos] a WITH (NOLOCK)
          JOIN [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
            ON aa.Art_Codigo = a.Art_Codigo
          WHERE aa.AA_ExistenciaActualU > 0
            AND a.Art_Bloqueado = 0
            AND (
              a.Art_FechaUltimaVenta < DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
              OR a.Art_FechaUltimaVenta IS NULL
            )
          ORDER BY aa.AA_ExistenciaActualU DESC
        `),
      ]);
      stagnant = (sRes.recordset || []).filter(r => !dismissed.has(r.id));
      noSales  = (nRes.recordset || []).filter(r => !dismissedNoSales.has(r.id));
    } catch (e) {
      console.error('MSSQL alert fetch error:', e.message);
    }

    const payload = {
      expirySoon,
      expired,
      stagnant,
      noSales,
      sinPrecio,
      totals: {
        expirySoon: expirySoon.length,
        expired:    expired.length,
        stagnant:   stagnant.length,
        noSales:    noSales.length,
        sinPrecio:  sinPrecio.length,
      },
    };
    _cacheSet('alerts', payload, 180_000); // 3 min
    res.json(payload);
  } catch (err) {
    console.error('Error alerts:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/bodega/alerts/descartar ────────────────────────────────────────
router.post('/alerts/descartar', (req, res) => {
  const { art_codigo, tipo, notas } = req.body;
  if (!art_codigo || !['stagnant', 'noSales', 'expiry', 'sinPrecio'].includes(tipo))
    return res.status(400).json({ error: 'art_codigo y tipo válido requeridos' });
  try {
    getDb().prepare(`
      INSERT OR REPLACE INTO alertas_descartadas (art_codigo, tipo, notas)
      VALUES (?, ?, ?)
    `).run(art_codigo, tipo, notas || null);
    _cache.delete('alerts');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/bodega/alerts/descartar/:codigo/:tipo ─────────────────────────
router.delete('/alerts/descartar/:codigo/:tipo', (req, res) => {
  try {
    getDb().prepare(`DELETE FROM alertas_descartadas WHERE art_codigo = ? AND tipo = ?`)
      .run(req.params.codigo, req.params.tipo);
    _cache.delete('alerts');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/bodega/alerts/send-email ───────────────────────────────────────
router.post('/alerts/send-email', async (req, res) => {
  const { type, items = [] } = req.body;
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return res.status(500).json({ error: 'Configura EMAIL_USER y EMAIL_PASS en el .env para enviar correos' });
  }

  try {
    const nodemailer  = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    const isExpiry  = type === 'expiry';
    const subject   = isExpiry
      ? '⚠️ Alerta: Productos próximos a vencer — La Casita Deli'
      : '⚠️ Alerta: Inventario estancado — La Casita Deli';
    const colHeader = isExpiry ? 'Caducidad' : 'Última Venta';

    const rows = items.map(item => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee">${item.nombre || item.name || '—'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${item.fecha_caducidad || item.ultima_venta || 'Sin registro'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${item.cantidad ?? item.stock ?? 0}</td>
      </tr>`).join('');

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#6D4C41">⚠️ Alerta de Inventario — La Casita Deli</h2>
        <p>${isExpiry ? 'Los siguientes productos están próximos a vencer:' : 'Los siguientes productos tienen inventario estancado sin ventas recientes:'}</p>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#f5f5f5">
              <th style="padding:8px;text-align:left">Producto</th>
              <th style="padding:8px;text-align:left">${colHeader}</th>
              <th style="padding:8px;text-align:left">Cantidad</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="color:#999;font-size:12px;margin-top:20px">Sistema de Administración — La Casita Deli</p>
      </div>`;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to:   'lacasitadeli2000@gmail.com',
      subject,
      html,
    });

    if (isExpiry && items.length) {
      const ids = items.map(i => i.id).filter(Boolean);
      if (ids.length) {
        getDb().prepare(
          `UPDATE product_expiry SET alerta_enviada = 1 WHERE id IN (${ids.map(() => '?').join(',')})`
        ).run(...ids);
      }
    }

    res.json({ message: 'Alerta enviada a lacasitadeli2000@gmail.com' });
  } catch (err) {
    console.error('Email error:', err.message);
    res.status(500).json({ error: 'Error al enviar correo: ' + err.message });
  }
});

// ── GET /api/bodega/conteo/preview ────────────────────────────────────────────
// Lee TicketsPS para el periodo y muestra cuánto se vendió por producto
router.get('/conteo/preview', async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate)
    return res.status(400).json({ error: 'startDate y endDate requeridos (YYYY-MM-DD)' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate))
    return res.status(400).json({ error: 'Formato de fecha inválido (esperado YYYY-MM-DD)' });

  try {
    const result = await mssql.query(`
      SELECT TOP 2000
        CAST(t.Codigo AS NVARCHAR(50))           AS art_codigo,
        MAX(ISNULL(
          CAST(a.Art_Descripcion AS NVARCHAR(500)),
          CAST(t.Concepto       AS NVARCHAR(500))
        ))                                        AS nombre,
        SUM(t.Cantidad)                           AS total_vendido,
        ISNULL((
          SELECT SUM(aa2.AA_ExistenciaActualU)
          FROM [compucaja].[dbo].[ArticulosAlmacen] aa2 WITH (NOLOCK)
          WHERE aa2.Art_Codigo = CAST(t.Codigo AS NVARCHAR(50))
        ), 0)                                     AS stock_actual,
        COUNT(DISTINCT t.FolConsecutivo)          AS num_tickets
      FROM [compucaja].[dbo].[TicketsPS] t WITH (NOLOCK)
      LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
        ON a.Art_Codigo = CAST(t.Codigo AS NVARCHAR(50))
      WHERE CAST(t.FechaHora AS DATE) BETWEEN '${esc(startDate)}' AND '${esc(endDate)}'
        AND t.Codigo IS NOT NULL
        AND LEN(CAST(t.Codigo AS NVARCHAR(50))) > 0
        AND CAST(t.Codigo AS NVARCHAR(50)) != '0'
      GROUP BY t.Codigo
      ORDER BY SUM(t.Cantidad) DESC
    `);
    res.json(result.recordset || []);
  } catch (err) {
    console.error('Error conteo preview:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/bodega/conteo/sync ──────────────────────────────────────────────
// Descuenta cantidades vendidas del inventario ArticulosAlmacen y registra la sesión
router.post('/conteo/sync', async (req, res) => {
  const { startDate, endDate } = req.body;
  if (!startDate || !endDate)
    return res.status(400).json({ error: 'startDate y endDate requeridos' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate))
    return res.status(400).json({ error: 'Formato de fecha inválido' });

  try {
    // 1. Obtener productos + cantidades + stock actual para el audit trail
    const previewRes = await mssql.query(`
      SELECT TOP 2000
        CAST(t.Codigo AS NVARCHAR(50))                AS art_codigo,
        MAX(ISNULL(
          CAST(a.Art_Descripcion AS NVARCHAR(500)),
          CAST(t.Concepto       AS NVARCHAR(500))
        ))                                             AS nombre,
        SUM(t.Cantidad)                                AS total_vendido,
        ISNULL((
          SELECT SUM(aa2.AA_ExistenciaActualU)
          FROM [compucaja].[dbo].[ArticulosAlmacen] aa2 WITH (NOLOCK)
          WHERE aa2.Art_Codigo = CAST(t.Codigo AS NVARCHAR(50))
        ), 0)                                          AS stock_antes
      FROM [compucaja].[dbo].[TicketsPS] t WITH (NOLOCK)
      LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
        ON a.Art_Codigo = CAST(t.Codigo AS NVARCHAR(50))
      WHERE CAST(t.FechaHora AS DATE) BETWEEN '${esc(startDate)}' AND '${esc(endDate)}'
        AND t.Codigo IS NOT NULL
        AND LEN(CAST(t.Codigo AS NVARCHAR(50))) > 0
        AND CAST(t.Codigo AS NVARCHAR(50)) != '0'
      GROUP BY t.Codigo
    `);

    const products = previewRes.recordset || [];
    if (products.length === 0)
      return res.status(400).json({ error: 'Sin productos en el periodo seleccionado' });

    // 2. Batch UPDATE en MSSQL
    await mssql.query(`
      UPDATE aa
      SET    aa.AA_ExistenciaActualU = aa.AA_ExistenciaActualU - sales.total_sold
      FROM   [compucaja].[dbo].[ArticulosAlmacen] aa
      INNER JOIN (
        SELECT CAST(t.Codigo AS NVARCHAR(50)) AS art_codigo,
               SUM(t.Cantidad)               AS total_sold
        FROM   [compucaja].[dbo].[TicketsPS] t WITH (NOLOCK)
        WHERE  CAST(t.FechaHora AS DATE) BETWEEN '${esc(startDate)}' AND '${esc(endDate)}'
          AND  t.Codigo IS NOT NULL
          AND  LEN(CAST(t.Codigo AS NVARCHAR(50))) > 0
          AND  CAST(t.Codigo AS NVARCHAR(50)) != '0'
        GROUP BY t.Codigo
      ) sales ON aa.Art_Codigo = sales.art_codigo
    `);

    // 3. Registrar sesión y detalle en SQLite
    const db            = getDb();
    const totalUnidades = products.reduce((s, p) => s + (parseFloat(p.total_vendido) || 0), 0);

    const sessionRow = db.prepare(`
      INSERT INTO sync_sessions (periodo_inicio, periodo_fin, productos_actualizados, total_unidades, estado)
      VALUES (?, ?, ?, ?, 'completado')
    `).run(startDate, endDate, products.length, totalUnidades);

    const sessionId  = sessionRow.lastInsertRowid;
    const insertDed  = db.prepare(`
      INSERT INTO sync_deductions (session_id, art_codigo, nombre, cantidad_vendida, stock_antes, stock_despues)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    db.transaction((prods) => {
      for (const p of prods) {
        const antes    = parseFloat(p.stock_antes)    || 0;
        const vendido  = parseFloat(p.total_vendido)  || 0;
        insertDed.run(sessionId, p.art_codigo, p.nombre || null, vendido, antes, Math.max(0, antes - vendido));
      }
    })(products);

    res.json({
      message:   `${products.length} productos actualizados · ${totalUnidades.toLocaleString('es')} unidades descontadas`,
      sessionId,
      productos: products.length,
      unidades:  totalUnidades,
    });
  } catch (err) {
    console.error('Error conteo sync:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/bodega/conteo/historial ─────────────────────────────────────────
router.get('/conteo/historial', (req, res) => {
  try {
    res.json(getDb().prepare(
      `SELECT * FROM sync_sessions ORDER BY created_at DESC LIMIT 20`
    ).all());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/bodega/conteo/historial/:id ──────────────────────────────────────
router.get('/conteo/historial/:id', (req, res) => {
  try {
    res.json(getDb().prepare(
      `SELECT * FROM sync_deductions WHERE session_id = ? ORDER BY cantidad_vendida DESC`
    ).all(req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/bodega/alerts/send-report — manual trigger full report ──────────
router.post('/alerts/send-report', async (req, res) => {
  try {
    const result = await require('./emailService').sendMonthlyReport();
    res.json({ ...result, message: `Reporte enviado a ${result.to}` });
  } catch (err) {
    console.error('send-report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/bodega/alerts/report-log — last sends ───────────────────────────
router.get('/alerts/report-log', (req, res) => {
  try {
    const rows = getDb().prepare(
      `SELECT * FROM email_report_log ORDER BY created_at DESC LIMIT 10`
    ).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
