const express = require('express');
const { getDb } = require('../db');
const mssql    = require('../db/mssql');

const router = express.Router();

function esc(s) { return String(s || '').replace(/'/g, "''"); }

// Color conversion: Tailwind text class → hex (for TC52 which uses hex colors)
const TAILWIND_HEX = {
  'text-blue-700':    '#1d4ed8',
  'text-amber-700':   '#b45309',
  'text-green-700':   '#15803d',
  'text-cyan-700':    '#0e7490',
  'text-purple-700':  '#7e22ce',
  'text-rose-700':    '#be123c',
  'text-stone-600':   '#57534e',
  'text-orange-700':  '#c2410c',
  'text-teal-700':    '#0f766e',
  'text-indigo-700':  '#4338ca',
  'text-pink-700':    '#be185d',
  'text-emerald-700': '#047857',
};

// Hex → Tailwind (for areas created from the TC52)
const HEX_TO_TAILWIND = {
  '#1d4ed8': { bg: 'bg-blue-50',    text: 'text-blue-700' },
  '#b45309': { bg: 'bg-amber-50',   text: 'text-amber-700' },
  '#15803d': { bg: 'bg-green-50',   text: 'text-green-700' },
  '#0e7490': { bg: 'bg-cyan-50',    text: 'text-cyan-700' },
  '#7e22ce': { bg: 'bg-purple-50',  text: 'text-purple-700' },
  '#be123c': { bg: 'bg-rose-50',    text: 'text-rose-700' },
  '#57534e': { bg: 'bg-stone-100',  text: 'text-stone-600' },
  '#c2410c': { bg: 'bg-orange-50',  text: 'text-orange-700' },
  '#0f766e': { bg: 'bg-teal-50',    text: 'text-teal-700' },
  '#4338ca': { bg: 'bg-indigo-50',  text: 'text-indigo-700' },
  '#be185d': { bg: 'bg-pink-50',    text: 'text-pink-700' },
  '#047857': { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  // TC52 palette colors
  '#1D9E75': { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  '#1d9e75': { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  '#3B82F6': { bg: 'bg-blue-50',    text: 'text-blue-700' },
  '#3b82f6': { bg: 'bg-blue-50',    text: 'text-blue-700' },
  '#8B5CF6': { bg: 'bg-purple-50',  text: 'text-purple-700' },
  '#8b5cf6': { bg: 'bg-purple-50',  text: 'text-purple-700' },
  '#E07B39': { bg: 'bg-orange-50',  text: 'text-orange-700' },
  '#e07b39': { bg: 'bg-orange-50',  text: 'text-orange-700' },
  '#EF4444': { bg: 'bg-rose-50',    text: 'text-rose-700' },
  '#ef4444': { bg: 'bg-rose-50',    text: 'text-rose-700' },
  '#06B6D4': { bg: 'bg-cyan-50',    text: 'text-cyan-700' },
  '#06b6d4': { bg: 'bg-cyan-50',    text: 'text-cyan-700' },
  '#F59E0B': { bg: 'bg-amber-50',   text: 'text-amber-700' },
  '#f59e0b': { bg: 'bg-amber-50',   text: 'text-amber-700' },
  '#EC4899': { bg: 'bg-pink-50',    text: 'text-pink-700' },
  '#ec4899': { bg: 'bg-pink-50',    text: 'text-pink-700' },
  '#6B7280': { bg: 'bg-stone-100',  text: 'text-stone-600' },
  '#6b7280': { bg: 'bg-stone-100',  text: 'text-stone-600' },
  '#1F2937': { bg: 'bg-stone-100',  text: 'text-stone-600' },
  '#1f2937': { bg: 'bg-stone-100',  text: 'text-stone-600' },
};

function configToTc52(r) {
  return { id: r.id, nombre: r.nombre, color: TAILWIND_HEX[r.color_text] || '#3B82F6', clave: r.clave };
}

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

    const loc = getDb().prepare(`SELECT area FROM product_locations WHERE art_codigo=?`).get(row.codigo);
    res.json({ codigo: row.codigo, nombre: row.nombre, stock: Number(row.stock) || 0, ubicacion: loc?.area ?? null });
  } catch (err) {
    console.error('Error producto lookup:', err.message);
    res.status(500).json({ mensaje: 'Error del servidor' });
  }
});

// ── POST /api/almacen/entrada ─────────────────────────────────────────────────
router.post('/entrada', async (req, res) => {
  const { codigo, cantidad, nombre, area = 'bodega', pedido_id = null } = req.body;
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
      INSERT INTO almacen_movimientos (art_codigo, nombre, tipo, cantidad, stock_antes, stock_despues, area, usuario, pedido_id)
      VALUES (?, ?, 'entrada', ?, ?, ?, ?, 'TC52', ?)
    `).run(codigo, nombre || null, qty, stockAntes, stockDespues, area, pedido_id || null);

    // Si viene vinculado a un pedido, actualizar estado a en_recepcion
    if (pedido_id) {
      db.prepare(`
        UPDATE pedidos_recepcion SET estado = 'en_recepcion'
        WHERE id = ? AND estado = 'pendiente'
      `).run(pedido_id);
    }

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

// ── GET /api/almacen/merma/stats — estadísticas por período ──────────────────
router.get('/merma/stats', (req, res) => {
  const periodo = (req.query.mes || new Date().toISOString().slice(0, 7));
  try {
    const db = getDb();

    const totales = db.prepare(`
      SELECT COUNT(*) AS num_registros, COALESCE(SUM(cantidad),0) AS total_unidades
      FROM merma_registros WHERE strftime('%Y-%m', created_at) = ?
    `).get(periodo);

    const porMotivo = db.prepare(`
      SELECT motivo, COUNT(*) AS num_registros, COALESCE(SUM(cantidad),0) AS total_unidades
      FROM merma_registros WHERE strftime('%Y-%m', created_at) = ?
      GROUP BY motivo ORDER BY total_unidades DESC
    `).all(periodo);

    const topProductos = db.prepare(`
      SELECT art_codigo AS codigo, COALESCE(nombre, art_codigo) AS nombre,
             COUNT(*) AS num_registros, COALESCE(SUM(cantidad),0) AS total_unidades
      FROM merma_registros WHERE strftime('%Y-%m', created_at) = ?
      GROUP BY art_codigo ORDER BY total_unidades DESC LIMIT 10
    `).all(periodo);

    const porArea = db.prepare(`
      SELECT area, COUNT(*) AS num_registros, COALESCE(SUM(cantidad),0) AS total_unidades
      FROM merma_registros WHERE strftime('%Y-%m', created_at) = ?
      GROUP BY area ORDER BY total_unidades DESC
    `).all(periodo);

    const tendencia = db.prepare(`
      SELECT strftime('%Y-%m', created_at) AS mes,
             COUNT(*) AS num_registros, COALESCE(SUM(cantidad),0) AS total_unidades
      FROM merma_registros WHERE created_at >= date('now','-5 months','start of month')
      GROUP BY strftime('%Y-%m', created_at) ORDER BY mes ASC
    `).all();

    res.json({ periodo, totales, porMotivo, topProductos, porArea, tendencia });
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

// ── Pedidos de recepción ──────────────────────────────────────────────────────

function genFolio() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `REC-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${Date.now().toString().slice(-4)}`;
}

// GET /api/almacen/pedidos — lista (?estado=activos|pendiente|en_recepcion|cerrado|cancelado)
router.get('/pedidos', (req, res) => {
  const { estado } = req.query;
  try {
    const db  = getDb();
    let rows;
    if (estado === 'activos') {
      rows = db.prepare(
        `SELECT * FROM pedidos_recepcion WHERE estado IN ('pendiente','en_recepcion') ORDER BY created_at DESC LIMIT 100`
      ).all();
    } else if (estado) {
      rows = db.prepare(
        `SELECT * FROM pedidos_recepcion WHERE estado = ? ORDER BY created_at DESC LIMIT 100`
      ).all(estado);
    } else {
      rows = db.prepare(`SELECT * FROM pedidos_recepcion ORDER BY created_at DESC LIMIT 100`).all();
    }

    // Enrich with item count and received count
    const detail = db.prepare(`
      SELECT pedido_id, COUNT(*) AS num_items, SUM(cantidad_esperada) AS total_esperado
      FROM pedidos_recepcion_detalle GROUP BY pedido_id
    `).all();
    const detailMap = Object.fromEntries(detail.map(d => [d.pedido_id, d]));

    const received = db.prepare(`
      SELECT pedido_id, COUNT(DISTINCT art_codigo) AS num_recibidos, SUM(cantidad) AS total_recibido
      FROM almacen_movimientos WHERE pedido_id IS NOT NULL AND tipo = 'entrada'
      GROUP BY pedido_id
    `).all();
    const recMap = Object.fromEntries(received.map(r => [r.pedido_id, r]));

    res.json(rows.map(r => ({
      ...r,
      num_items:      detailMap[r.id]?.num_items      ?? 0,
      total_esperado: detailMap[r.id]?.total_esperado ?? 0,
      total_recibido: recMap[r.id]?.total_recibido    ?? 0,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/almacen/pedidos — crear pedido con items
router.post('/pedidos', (req, res) => {
  const { proveedor, fecha_esperada, notas, items = [] } = req.body;
  if (!items.length) return res.status(400).json({ error: 'Se requiere al menos un producto' });

  const db    = getDb();
  const folio = genFolio();
  try {
    const r = db.prepare(`
      INSERT INTO pedidos_recepcion (folio, proveedor, fecha_esperada, notas)
      VALUES (?, ?, ?, ?)
    `).run(folio, proveedor?.trim() || null, fecha_esperada || null, notas?.trim() || null);

    const pedidoId = r.lastInsertRowid;
    const ins = db.prepare(`
      INSERT INTO pedidos_recepcion_detalle (pedido_id, art_codigo, nombre, cantidad_esperada)
      VALUES (?, ?, ?, ?)
    `);
    for (const item of items) {
      ins.run(pedidoId, item.art_codigo, item.nombre || null, parseFloat(item.cantidad_esperada) || 0);
    }
    res.status(201).json({ id: pedidoId, folio, message: 'Pedido creado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/almacen/pedidos/:id — detalle con discrepancias calculadas
router.get('/pedidos/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();
  try {
    const pedido = db.prepare(`SELECT * FROM pedidos_recepcion WHERE id = ?`).get(id);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    const items = db.prepare(`SELECT * FROM pedidos_recepcion_detalle WHERE pedido_id = ?`).all(id);

    // Sumar lo recibido en almacen_movimientos vinculado a este pedido
    const recibidos = db.prepare(`
      SELECT art_codigo, SUM(cantidad) AS recibido
      FROM almacen_movimientos
      WHERE pedido_id = ? AND tipo = 'entrada'
      GROUP BY art_codigo
    `).all(id);
    const recMap = Object.fromEntries(recibidos.map(r => [r.art_codigo, r.recibido]));

    const detalle = items.map(item => {
      const recibido   = recMap[item.art_codigo] ?? 0;
      const diferencia = recibido - item.cantidad_esperada;
      return { ...item, cantidad_recibida: recibido, diferencia };
    });

    res.json({ ...pedido, detalle });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/almacen/pedidos/:id/estado — cambiar estado
router.put('/pedidos/:id/estado', (req, res) => {
  const id     = parseInt(req.params.id, 10);
  const { estado } = req.body;
  const valid  = ['pendiente', 'en_recepcion', 'cerrado', 'cancelado'];
  if (!valid.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
  try {
    const cerrado_at = estado === 'cerrado' ? new Date().toISOString() : null;
    getDb().prepare(`
      UPDATE pedidos_recepcion SET estado = ?, cerrado_at = ? WHERE id = ?
    `).run(estado, cerrado_at, id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/almacen/pedidos/:id — cancelar (soft: cambia estado)
router.delete('/pedidos/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    getDb().prepare(`UPDATE pedidos_recepcion SET estado = 'cancelado' WHERE id = ?`).run(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/almacen/ubicaciones/areas — TC52 compatible ─────────────────────
router.get('/ubicaciones/areas', (req, res) => {
  try {
    const rows = getDb().prepare(
      `SELECT * FROM ubicaciones_config WHERE activo=1 ORDER BY orden ASC, id ASC`
    ).all();
    res.json(rows.map(configToTc52));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/almacen/ubicaciones/areas — TC52 crea área ─────────────────────
router.post('/ubicaciones/areas', (req, res) => {
  const { nombre, color = '#3B82F6' } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });

  const db = getDb();
  const tw = HEX_TO_TAILWIND[color] || HEX_TO_TAILWIND[color.toLowerCase()] || { bg: 'bg-stone-100', text: 'text-stone-600' };

  let clave = nombre.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '_') || 'area';
  if (db.prepare(`SELECT id FROM ubicaciones_config WHERE clave=?`).get(clave))
    clave = `${clave}_${Date.now().toString().slice(-4)}`;

  try {
    const maxOrden = db.prepare(`SELECT COALESCE(MAX(orden),-1) AS m FROM ubicaciones_config WHERE activo=1`).get()?.m ?? -1;
    db.prepare(`INSERT INTO ubicaciones_config (clave,nombre,icono,color_bg,color_text,orden) VALUES (?,?,?,?,?,?)`)
      .run(clave, nombre.trim(), 'category', tw.bg, tw.text, maxOrden + 1);
    const rows = db.prepare(`SELECT * FROM ubicaciones_config WHERE activo=1 ORDER BY orden ASC, id ASC`).all();
    res.status(201).json(rows.map(configToTc52));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/almacen/ubicaciones/areas/:id — TC52 soft-delete área ─────────
router.delete('/ubicaciones/areas/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();
  try {
    db.prepare(`UPDATE ubicaciones_config SET activo=0 WHERE id=?`).run(id);
    const rows = db.prepare(`SELECT * FROM ubicaciones_config WHERE activo=1 ORDER BY orden ASC, id ASC`).all();
    res.json(rows.map(configToTc52));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/almacen/producto-ubicacion — TC52 asigna área a producto ────────
router.post('/producto-ubicacion', (req, res) => {
  const { codigo, ubicacion } = req.body;
  if (!codigo) return res.status(400).json({ error: 'Código requerido' });
  const db = getDb();
  try {
    if (!ubicacion) {
      db.prepare(`DELETE FROM product_locations WHERE art_codigo=?`).run(codigo);
    } else {
      db.prepare(`
        INSERT INTO product_locations (art_codigo, area)
        VALUES (?, ?)
        ON CONFLICT(art_codigo) DO UPDATE SET area=excluded.area, updated_at=datetime('now')
      `).run(codigo, ubicacion);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
