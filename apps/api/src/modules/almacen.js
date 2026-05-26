const express = require('express');
const { getDb } = require('../db');
const mssql    = require('../db/mssql');

const router = express.Router();

function esc(s) { return String(s || '').replace(/'/g, "''"); }

// GET /api/almacen/producto/:codigo — busca por GTIN, CodAlt, PLU o Art_Codigo
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

// POST /api/almacen/entrada — suma cantidad al inventario MSSQL y registra en SQLite
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

// POST /api/almacen/salida — resta cantidad del inventario MSSQL y registra en SQLite
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

// GET /api/almacen/movimientos — movimientos de hoy (para historial del TC52)
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

// GET /api/almacen/movimientos/historial — historial con filtros para el admin
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

module.exports = router;
