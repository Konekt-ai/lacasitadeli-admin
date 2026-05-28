const express = require('express');
const { getDb } = require('../db');
const mssql    = require('../db/mssql');

const router = express.Router();

function esc(s) { return String(s || '').replace(/'/g, "''"); }

// GET /api/almacen/producto/:codigo
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

// POST /api/almacen/entrada
router.post('/entrada', async (req, res) => {
  const { codigo, cantidad, nombre } = req.body;
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

    getDb().prepare(`
      INSERT INTO almacen_movimientos (art_codigo, nombre, tipo, cantidad, stock_antes, stock_despues, usuario)
      VALUES (?, ?, 'entrada', ?, ?, ?, 'TC52')
    `).run(codigo, nombre || null, qty, stockAntes, stockDespues);

    res.json({ ok: true, stockActual: stockDespues, mensaje: `Entrada registrada: +${qty} pzas` });
  } catch (err) {
    console.error('Error entrada:', err.message);
    res.status(500).json({ ok: false, mensaje: 'Error del servidor' });
  }
});

// POST /api/almacen/salida
router.post('/salida', async (req, res) => {
  const { codigo, cantidad, nombre } = req.body;
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

    getDb().prepare(`
      INSERT INTO almacen_movimientos (art_codigo, nombre, tipo, cantidad, stock_antes, stock_despues, usuario)
      VALUES (?, ?, 'salida', ?, ?, ?, 'TC52')
    `).run(codigo, nombre || null, qty, stockAntes, stockDespues);

    res.json({ ok: true, stockActual: stockDespues, mensaje: `Salida registrada: -${qty} pzas` });
  } catch (err) {
    console.error('Error salida:', err.message);
    res.status(500).json({ ok: false, mensaje: 'Error del servidor' });
  }
});

// GET /api/almacen/movimientos
router.get('/movimientos', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const rows  = getDb().prepare(`
      SELECT id, art_codigo AS codigo, nombre, tipo, cantidad,
             stock_antes, stock_despues, usuario,
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

// GET /api/almacen/movimientos/historial
router.get('/movimientos/historial', (req, res) => {
  const { fecha, tipo, limit = 300 } = req.query;
  try {
    const conditions = [];
    const params     = [];

    if (fecha) { conditions.push('DATE(created_at) = ?'); params.push(fecha); }
    if (tipo === 'entrada' || tipo === 'salida') { conditions.push('tipo = ?'); params.push(tipo); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const cap   = Math.min(parseInt(limit) || 300, 500);

    const rows = getDb().prepare(`
      SELECT id, art_codigo AS codigo, nombre, tipo, cantidad,
             stock_antes, stock_despues, usuario,
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

// ── POST para EDITAR HISTORIAL Y CORREGIR INVENTARIO ──────────────────────────
router.post('/movimientos/:id/editar', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { nuevaCantidad } = req.body;
  const qty = parseFloat(nuevaCantidad);

  if (isNaN(id) || isNaN(qty) || qty <= 0) {
    return res.status(400).json({ ok: false, mensaje: 'Cantidad inválida' });
  }

  try {
    const db = getDb();
    
    // 1. Obtener el registro de la base de datos local (SQLite)
    const mov = db.prepare('SELECT * FROM almacen_movimientos WHERE id = ?').get(id);
    if (!mov) return res.status(404).json({ ok: false, mensaje: 'Movimiento no encontrado' });

    const diferencia = qty - mov.cantidad;
    if (diferencia === 0) return res.json({ ok: true, mensaje: 'Sin cambios' });

    // 2. Calcular el ajuste. Si es entrada, un número mayor suma stock. Si es salida, resta.
    const ajusteStock = mov.tipo === 'entrada' ? diferencia : -diferencia;

    // 3. Revisar en SQL Server si el inventario aguanta el ajuste
    const stockRes = await mssql.query(`
      SELECT ISNULL(SUM(aa.AA_ExistenciaActualU), 0) AS stock
      FROM [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
      WHERE aa.Art_Codigo = '${esc(mov.art_codigo)}'
    `);
    const stockActual = Number(stockRes.recordset[0]?.stock) || 0;

    if (stockActual + ajusteStock < 0) {
      return res.status(400).json({ ok: false, mensaje: `Ajuste inválido. El stock en tienda quedaría negativo (${stockActual + ajusteStock}).` });
    }

    // 4. Aplicar el cambio real en SQL Server
    await mssql.query(`
      UPDATE [compucaja].[dbo].[ArticulosAlmacen]
      SET AA_ExistenciaActualU = AA_ExistenciaActualU + (${ajusteStock})
      WHERE Art_Codigo = '${esc(mov.art_codigo)}'
    `);

    // 5. Corregir el historial en SQLite para que el usuario vea el cambio
    db.prepare(`
      UPDATE almacen_movimientos
      SET cantidad = ?, stock_despues = stock_despues + ?
      WHERE id = ?
    `).run(qty, ajusteStock, id);

    res.json({ ok: true, mensaje: 'Movimiento corregido en el sistema' });
  } catch (err) {
    console.error('Error editar movimiento:', err.message);
    res.status(500).json({ ok: false, mensaje: 'Error de BD: ' + err.message });
  }
});

// ── MERMA ─────────────────────────────────────────────────────────────────────

const MOTIVOS_VALIDOS = ['vencimiento', 'dano', 'cocina', 'robo', 'otro'];

// POST /api/almacen/merma — descuenta stock y registra la baja
router.post('/merma', async (req, res) => {
  const { codigo, cantidad, motivo, area, nombre, notas } = req.body;
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

    getDb().prepare(`
      INSERT INTO merma_registros (art_codigo, nombre, motivo, area, cantidad, stock_antes, stock_despues, notas, usuario)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'TC52')
    `).run(codigo, nombre || null, motivo, area || 'bodega', qty, stockAntes, stockDespues, notas || null);

    res.json({ ok: true, stockActual: stockDespues, mensaje: `Merma registrada: -${qty} pzas (${motivo})` });
  } catch (err) {
    console.error('Error merma:', err.message);
    res.status(500).json({ ok: false, mensaje: 'Error del servidor' });
  }
});

// GET /api/almacen/merma — mermas de hoy para el TC52
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

// GET /api/almacen/merma/historial — historial filtrado para el admin
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

// GET /api/almacen/buscar?q=...
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



module.exports = router;