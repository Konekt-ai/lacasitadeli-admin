const express = require('express');
const { getDb } = require('../db');
const mssql    = require('../db/mssql');

const router = express.Router();

function esc(s) { return String(s || '').replace(/'/g, "''"); }

// Mantiene stock_ubicaciones actualizado después de cada movimiento
function upsertUbicacion(db, codigo, nombre, area, delta) {
  db.prepare(`
    INSERT INTO stock_ubicaciones (art_codigo, nombre, area, cantidad)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(art_codigo, area) DO UPDATE SET
      nombre     = COALESCE(excluded.nombre, nombre),
      cantidad   = MAX(0, cantidad + excluded.cantidad),
      updated_at = datetime('now')
  `).run(codigo, nombre || null, area || 'bodega', delta);
}

// ── GET /api/almacen/producto/:codigo ─────────────────────────────────────────
router.get('/producto/:codigo', async (req, res) => {
  const codigo = req.params.codigo.trim();
  if (!codigo) return res.status(400).json({ mensaje: 'Código requerido' });

  try {
    const result = await mssql.query(`
      SELECT TOP 1
        a.Art_Codigo                            AS codigo,
        a.Art_Descripcion                       AS nombre,
        ISNULL(SUM(aa.AA_ExistenciaActualU), 0) AS stock
      FROM [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
      LEFT JOIN [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
        ON aa.Art_Codigo = a.Art_Codigo
      WHERE (
        a.Art_GTIN        = '${esc(codigo)}'
        OR a.CodAlt_Codigo = '${esc(codigo)}'
        OR a.Art_Codigo    = '${esc(codigo)}'
        OR a.Art_PLU       = '${esc(codigo)}'
      )
      AND a.Art_Descripcion <> '' AND a.Art_Descripcion IS NOT NULL
      GROUP BY a.Art_Codigo, a.Art_Descripcion
    `);

    const row = result.recordset[0];
    if (!row) return res.status(404).json({ mensaje: 'Producto no encontrado' });

    res.json({ codigo: row.codigo, nombre: row.nombre, stock: Number(row.stock) || 0 });
  } catch (err) {
    console.error('Error producto lookup:', err.message);
    res.status(500).json({ mensaje: 'Error del servidor' });
  }
});

// ── POST /api/almacen/entrada ─────────────────────────────────────────────────
router.post('/entrada', async (req, res) => {
  const { codigo, cantidad, nombre, area = 'bodega' } = req.body;
  const qty = parseFloat(cantidad);
  if (!codigo || !qty || qty <= 0)
    return res.status(400).json({ ok: false, mensaje: 'Código y cantidad válida requeridos' });

  try {
    const stockRes = await mssql.query(`
      SELECT ISNULL(SUM(aa.AA_ExistenciaActualU), 0) AS stock
      FROM [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
      WHERE aa.Art_Codigo = '${esc(codigo)}'
    `);
    const stockAntes = Number(stockRes.recordset[0]?.stock) || 0;

    await mssql.query(`
      UPDATE [compucaja].[dbo].[ArticulosAlmacen]
      SET AA_ExistenciaActualU = AA_ExistenciaActualU + ${qty}
      WHERE Art_Codigo = '${esc(codigo)}'
    `);

    const stockDespues = stockAntes + qty;
    const db = getDb();

    db.prepare(`
      INSERT INTO almacen_movimientos (art_codigo, nombre, tipo, cantidad, stock_antes, stock_despues, area, usuario)
      VALUES (?, ?, 'entrada', ?, ?, ?, ?, 'TC52')
    `).run(codigo, nombre || null, qty, stockAntes, stockDespues, area);

    upsertUbicacion(db, codigo, nombre, area, qty);

    res.json({ ok: true, stockActual: stockDespues, mensaje: `Entrada registrada: +${qty} pzas en ${area}` });
  } catch (err) {
    console.error('Error entrada:', err.message);
    res.status(500).json({ ok: false, mensaje: 'Error del servidor' });
  }
});

// ── POST /api/almacen/salida ──────────────────────────────────────────────────
router.post('/salida', async (req, res) => {
  const { codigo, cantidad, nombre, area = 'bodega' } = req.body;
  const qty = parseFloat(cantidad);
  if (!codigo || !qty || qty <= 0)
    return res.status(400).json({ ok: false, mensaje: 'Código y cantidad válida requeridos' });

  try {
    const stockRes = await mssql.query(`
      SELECT ISNULL(SUM(aa.AA_ExistenciaActualU), 0) AS stock
      FROM [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
      WHERE aa.Art_Codigo = '${esc(codigo)}'
    `);
    const stockAntes = Number(stockRes.recordset[0]?.stock) || 0;

    if (stockAntes < qty)
      return res.status(400).json({ ok: false, mensaje: `Stock insuficiente. Disponible: ${stockAntes} pzas` });

    await mssql.query(`
      UPDATE [compucaja].[dbo].[ArticulosAlmacen]
      SET AA_ExistenciaActualU = AA_ExistenciaActualU - ${qty}
      WHERE Art_Codigo = '${esc(codigo)}'
    `);

    const stockDespues = stockAntes - qty;
    const db = getDb();

    db.prepare(`
      INSERT INTO almacen_movimientos (art_codigo, nombre, tipo, cantidad, stock_antes, stock_despues, area, usuario)
      VALUES (?, ?, 'salida', ?, ?, ?, ?, 'TC52')
    `).run(codigo, nombre || null, qty, stockAntes, stockDespues, area);

    upsertUbicacion(db, codigo, nombre, area, -qty);

    res.json({ ok: true, stockActual: stockDespues, mensaje: `Salida registrada: -${qty} pzas de ${area}` });
  } catch (err) {
    console.error('Error salida:', err.message);
    res.status(500).json({ ok: false, mensaje: 'Error del servidor' });
  }
});

// ── GET /api/almacen/movimientos ──────────────────────────────────────────────
router.get('/movimientos', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const rows  = getDb().prepare(`
      SELECT id, art_codigo AS codigo, nombre, tipo, cantidad,
             stock_antes, stock_despues, COALESCE(area,'bodega') AS area, usuario,
             created_at AS fecha
      FROM almacen_movimientos
      WHERE DATE(created_at) = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(today);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/almacen/movimientos/historial ────────────────────────────────────
router.get('/movimientos/historial', (req, res) => {
  const { fecha, tipo, area, limit = 300 } = req.query;
  try {
    const conditions = [];
    const params     = [];

    if (fecha) { conditions.push('DATE(created_at) = ?'); params.push(fecha); }
    if (tipo === 'entrada' || tipo === 'salida') { conditions.push('tipo = ?'); params.push(tipo); }
    if (area) { conditions.push("COALESCE(area,'bodega') = ?"); params.push(area); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const cap   = Math.min(parseInt(limit) || 300, 500);

    const rows = getDb().prepare(`
      SELECT id, art_codigo AS codigo, nombre, tipo, cantidad,
             stock_antes, stock_despues, COALESCE(area,'bodega') AS area, usuario,
             created_at AS fecha
      FROM almacen_movimientos
      ${where}
      ORDER BY created_at DESC
      LIMIT ${cap}
    `).all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/almacen/movimientos/todos — vista unificada ──────────────────────
router.get('/movimientos/todos', (req, res) => {
  const { fecha, tipo, area, limit = 300 } = req.query;
  try {
    const today = fecha || new Date().toISOString().slice(0, 10);
    const cap   = Math.min(parseInt(limit) || 300, 500);

    const rows = getDb().prepare(`
      SELECT
        'entrada-' || m.id       AS uid,
        'entrada'                AS tipo,
        m.art_codigo             AS codigo,
        m.nombre,
        m.cantidad,
        NULL                     AS area_origen,
        COALESCE(m.area,'bodega')AS area_destino,
        m.stock_antes,
        m.stock_despues,
        NULL                     AS motivo,
        m.notas,
        m.usuario,
        m.created_at             AS fecha
      FROM almacen_movimientos m
      WHERE m.tipo = 'entrada' AND DATE(m.created_at) = ?

      UNION ALL

      SELECT
        'salida-' || m.id,
        'salida',
        m.art_codigo,
        m.nombre,
        m.cantidad,
        COALESCE(m.area,'bodega'),
        NULL,
        m.stock_antes,
        m.stock_despues,
        NULL,
        m.notas,
        m.usuario,
        m.created_at
      FROM almacen_movimientos m
      WHERE m.tipo = 'salida' AND DATE(m.created_at) = ?

      UNION ALL

      SELECT
        'merma-' || mr.id,
        'merma',
        mr.art_codigo,
        mr.nombre,
        mr.cantidad,
        mr.area,
        NULL,
        mr.stock_antes,
        mr.stock_despues,
        mr.motivo,
        mr.notas,
        mr.usuario,
        mr.created_at
      FROM merma_registros mr
      WHERE DATE(mr.created_at) = ?

      UNION ALL

      SELECT
        'transferencia-' || st.id,
        'transferencia',
        st.art_codigo,
        st.nombre,
        st.cantidad,
        st.de_area,
        st.a_area,
        NULL,
        NULL,
        NULL,
        st.notas,
        'Bodega',
        st.created_at
      FROM surtido_transfers st
      WHERE st.autorizado = 1 AND DATE(st.created_at) = ?

      ORDER BY fecha DESC
      LIMIT ${cap}
    `).all(today, today, today, today);

    // Filtros opcionales en JS (tipo y area)
    let resultado = rows;
    if (tipo && tipo !== 'todos') resultado = resultado.filter(r => r.tipo === tipo);
    if (area) resultado = resultado.filter(r => r.area_origen === area || r.area_destino === area);

    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST para EDITAR HISTORIAL Y CORREGIR INVENTARIO ─────────────────────────
router.post('/movimientos/:id/editar', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { nuevaCantidad } = req.body;
  const qty = parseFloat(nuevaCantidad);

  if (isNaN(id) || isNaN(qty) || qty <= 0) {
    return res.status(400).json({ ok: false, mensaje: 'Cantidad inválida' });
  }

  try {
    const db  = getDb();
    const mov = db.prepare('SELECT * FROM almacen_movimientos WHERE id = ?').get(id);
    if (!mov) return res.status(404).json({ ok: false, mensaje: 'Movimiento no encontrado' });

    const diferencia   = qty - mov.cantidad;
    if (diferencia === 0) return res.json({ ok: true, mensaje: 'Sin cambios' });

    const ajusteStock  = mov.tipo === 'entrada' ? diferencia : -diferencia;
    const areaMovimiento = mov.area || 'bodega';

    const stockRes = await mssql.query(`
      SELECT ISNULL(SUM(aa.AA_ExistenciaActualU), 0) AS stock
      FROM [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
      WHERE aa.Art_Codigo = '${esc(mov.art_codigo)}'
    `);
    const stockActual = Number(stockRes.recordset[0]?.stock) || 0;

    if (stockActual + ajusteStock < 0) {
      return res.status(400).json({ ok: false, mensaje: `Ajuste inválido. Stock quedaría negativo (${stockActual + ajusteStock}).` });
    }

    await mssql.query(`
      UPDATE [compucaja].[dbo].[ArticulosAlmacen]
      SET AA_ExistenciaActualU = AA_ExistenciaActualU + (${ajusteStock})
      WHERE Art_Codigo = '${esc(mov.art_codigo)}'
    `);

    db.prepare(`
      UPDATE almacen_movimientos
      SET cantidad = ?, stock_despues = stock_despues + ?
      WHERE id = ?
    `).run(qty, ajusteStock, id);

    upsertUbicacion(db, mov.art_codigo, mov.nombre, areaMovimiento, ajusteStock);

    res.json({ ok: true, mensaje: 'Movimiento corregido en el sistema' });
  } catch (err) {
    console.error('Error editar movimiento:', err.message);
    res.status(500).json({ ok: false, mensaje: 'Error de BD: ' + err.message });
  }
});

// ── MERMA ──────────────────────────────────────────────────────────────────────
const MOTIVOS_VALIDOS = ['vencimiento', 'dano', 'cocina', 'robo', 'otro'];

router.post('/merma', async (req, res) => {
  const { codigo, cantidad, motivo, area = 'bodega', nombre, notas } = req.body;
  const qty = parseFloat(cantidad);

  if (!codigo || !qty || qty <= 0)
    return res.status(400).json({ ok: false, mensaje: 'Código y cantidad válida requeridos' });
  if (!MOTIVOS_VALIDOS.includes(motivo))
    return res.status(400).json({ ok: false, mensaje: 'Motivo inválido' });

  try {
    const stockRes = await mssql.query(`
      SELECT ISNULL(SUM(aa.AA_ExistenciaActualU), 0) AS stock
      FROM [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
      WHERE aa.Art_Codigo = '${esc(codigo)}'
    `);
    const stockAntes = Number(stockRes.recordset[0]?.stock) || 0;

    await mssql.query(`
      UPDATE [compucaja].[dbo].[ArticulosAlmacen]
      SET AA_ExistenciaActualU = AA_ExistenciaActualU - ${qty}
      WHERE Art_Codigo = '${esc(codigo)}'
    `);

    const stockDespues = stockAntes - qty;
    const db = getDb();

    db.prepare(`
      INSERT INTO merma_registros (art_codigo, nombre, motivo, area, cantidad, stock_antes, stock_despues, notas, usuario)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'TC52')
    `).run(codigo, nombre || null, motivo, area, qty, stockAntes, stockDespues, notas || null);

    upsertUbicacion(db, codigo, nombre, area, -qty);

    res.json({ ok: true, stockActual: stockDespues, mensaje: `Merma registrada: -${qty} pzas (${motivo})` });
  } catch (err) {
    console.error('Error merma:', err.message);
    res.status(500).json({ ok: false, mensaje: 'Error del servidor' });
  }
});

router.get('/merma', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const rows  = getDb().prepare(`
      SELECT id, art_codigo AS codigo, nombre, motivo, area, cantidad,
             stock_antes, stock_despues, notas, usuario, created_at AS fecha
      FROM merma_registros
      WHERE DATE(created_at) = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(today);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/merma/historial', (req, res) => {
  const { fecha, motivo, area, limit = 300 } = req.query;
  try {
    const conditions = [];
    const params     = [];

    if (fecha)  { conditions.push('DATE(created_at) = ?'); params.push(fecha); }
    if (motivo && MOTIVOS_VALIDOS.includes(motivo)) { conditions.push('motivo = ?'); params.push(motivo); }
    if (area)   { conditions.push('area = ?'); params.push(area); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const cap   = Math.min(parseInt(limit) || 300, 500);

    const rows = getDb().prepare(`
      SELECT id, art_codigo AS codigo, nombre, motivo, area, cantidad,
             stock_antes, stock_despues, notas, usuario, created_at AS fecha
      FROM merma_registros
      ${where}
      ORDER BY created_at DESC
      LIMIT ${cap}
    `).all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/almacen/ubicaciones — stock actual por producto y área ───────────
router.get('/ubicaciones', (req, res) => {
  const { area, q } = req.query;
  try {
    const conditions = ['cantidad > 0'];
    const params     = [];

    if (area) { conditions.push('area = ?'); params.push(area); }
    if (q)    { conditions.push("LOWER(COALESCE(nombre, art_codigo)) LIKE ?"); params.push(`%${q.toLowerCase()}%`); }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const rows = getDb().prepare(`
      SELECT art_codigo, nombre, area, cantidad, updated_at
      FROM stock_ubicaciones
      ${where}
      ORDER BY nombre, area
    `).all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/almacen/ubicaciones/resumen — totales por área ──────────────────
router.get('/ubicaciones/resumen', (req, res) => {
  try {
    const rows = getDb().prepare(`
      SELECT
        area,
        COUNT(DISTINCT art_codigo) AS productos,
        SUM(cantidad)              AS unidades
      FROM stock_ubicaciones
      WHERE cantidad > 0
      GROUP BY area
      ORDER BY area
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/almacen/buscar?q=... ─────────────────────────────────────────────
router.get('/buscar', async (req, res) => {
  const q = req.query.q?.trim() || '';
  if (q.length < 2) return res.json([]);

  try {
    const result = await mssql.query(`
      SELECT TOP 50
        a.Art_Codigo                            AS codigo,
        a.Art_Descripcion                       AS nombre,
        ISNULL(SUM(aa.AA_ExistenciaActualU), 0) AS stock
      FROM [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
      LEFT JOIN [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
        ON aa.Art_Codigo = a.Art_Codigo
      WHERE (
        a.Art_Descripcion LIKE '%${esc(q)}%'
        OR a.Art_Codigo LIKE '%${esc(q)}%'
        OR a.Art_GTIN = '${esc(q)}'
      )
      AND a.Art_Descripcion <> '' AND a.Art_Descripcion IS NOT NULL
      GROUP BY a.Art_Codigo, a.Art_Descripcion
      ORDER BY stock DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error buscar:', err.message);
    res.status(500).json({ mensaje: 'Error del servidor al buscar' });
  }
});

// ── GET /api/almacen/ubicaciones/config ───────────────────────────────────────
router.get('/ubicaciones/config', (req, res) => {
  try {
    const rows = getDb().prepare(
      `SELECT * FROM ubicaciones_config WHERE activo = 1 ORDER BY orden ASC, id ASC`
    ).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/almacen/ubicaciones/config ──────────────────────────────────────
router.post('/ubicaciones/config', (req, res) => {
  const { nombre, icono = 'category', color_bg = 'bg-stone-100', color_text = 'text-stone-600' } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });

  const db = getDb();
  let clave = nombre.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '_');
  if (!clave) clave = 'area';
  const exists = db.prepare(`SELECT id FROM ubicaciones_config WHERE clave = ?`).get(clave);
  if (exists) clave = `${clave}_${Date.now().toString().slice(-4)}`;

  try {
    const maxOrden = db.prepare(`SELECT COALESCE(MAX(orden), -1) AS m FROM ubicaciones_config WHERE activo = 1`).get()?.m ?? -1;
    const r = db.prepare(`
      INSERT INTO ubicaciones_config (clave, nombre, icono, color_bg, color_text, orden)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(clave, nombre.trim(), icono, color_bg, color_text, maxOrden + 1);
    res.status(201).json({ id: r.lastInsertRowid, clave, message: 'Área creada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/almacen/ubicaciones/config/:id ───────────────────────────────────
router.put('/ubicaciones/config/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { nombre, icono, color_bg, color_text } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    getDb().prepare(`
      UPDATE ubicaciones_config SET nombre = ?, icono = ?, color_bg = ?, color_text = ?
      WHERE id = ?
    `).run(nombre.trim(), icono || 'category', color_bg || 'bg-stone-100', color_text || 'text-stone-600', id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/almacen/ubicaciones/config/:id — soft delete ──────────────────
router.delete('/ubicaciones/config/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    getDb().prepare(`UPDATE ubicaciones_config SET activo = 0 WHERE id = ?`).run(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/almacen/ubicaciones/config/:id/orden — swap order ────────────────
router.put('/ubicaciones/config/:id/orden', (req, res) => {
  const id  = parseInt(req.params.id, 10);
  const dir = req.body.direction; // 'up' | 'down'
  try {
    const db   = getDb();
    const curr = db.prepare(`SELECT * FROM ubicaciones_config WHERE id = ? AND activo = 1`).get(id);
    if (!curr) return res.status(404).json({ error: 'No encontrado' });

    const neighbor = dir === 'up'
      ? db.prepare(`SELECT * FROM ubicaciones_config WHERE activo=1 AND orden < ? ORDER BY orden DESC LIMIT 1`).get(curr.orden)
      : db.prepare(`SELECT * FROM ubicaciones_config WHERE activo=1 AND orden > ? ORDER BY orden ASC  LIMIT 1`).get(curr.orden);

    if (!neighbor) return res.json({ ok: true });
    db.prepare(`UPDATE ubicaciones_config SET orden = ? WHERE id = ?`).run(neighbor.orden, id);
    db.prepare(`UPDATE ubicaciones_config SET orden = ? WHERE id = ?`).run(curr.orden, neighbor.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
