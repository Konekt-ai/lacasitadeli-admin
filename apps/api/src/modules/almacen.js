const express = require('express');
const { getDb } = require('../db');
const mssql    = require('../db/mssql');

const router = express.Router();

function esc(s) { return String(s || '').replace(/'/g, "''"); }


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

// ── Unificación de áreas/ubicaciones (fuente de verdad: MSSQL ubicaciones_bodega) ──
// Deriva la "clave" estable a partir del nombre, igual que las claves del front
// (p.ej. "Casita 1" -> "casita_1", "Bodega" -> "bodega").
function areaClave(nombre) {
  return String(nombre || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, '_') || 'area';
}
const ICON_BY_CLAVE = {
  bodega: 'warehouse', casita_1: 'storefront', casita_2: 'store',
  usa: 'flight', cocina: 'restaurant', refrigerador: 'ac_unit',
};
// Lista de áreas en el shape que espera el panel (AreaConfig), desde MSSQL.
async function fetchAreasBodega() {
  const r = await mssql.query(
    `SELECT id, nombre, color, orden FROM [compucaja].[dbo].[ubicaciones_bodega] WHERE activa=1 ORDER BY orden, nombre`
  );
  return (r.recordset || []).map(u => {
    const clave = areaClave(u.nombre);
    const tw = HEX_TO_TAILWIND[u.color] || HEX_TO_TAILWIND[(u.color || '').toLowerCase()] || { bg: 'bg-stone-100', text: 'text-stone-600' };
    return { id: u.id, clave, nombre: u.nombre, icono: ICON_BY_CLAVE[clave] || 'category', color_bg: tw.bg, color_text: tw.text, orden: u.orden, activo: 1 };
  });
}
// Mapa nombre(ubicacion) -> clave, para traducir inventario_bodega.ubicacion
async function mapaUbicacionAClave() {
  const areas = await fetchAreasBodega();
  const m = {};
  for (const a of areas) m[a.nombre] = a.clave;
  return m;
}
// Mapa clave -> nombre (p.ej. 'bodega' -> 'Bodega') para escribir inventario_bodega
async function mapaClaveANombre() {
  const areas = await fetchAreasBodega();
  const m = {};
  for (const a of areas) m[a.clave] = a.nombre;
  return m;
}
// Upsert de stock por ubicación en MSSQL (misma convención que /traslado:
// codigo_barras = Art_Codigo, ubicacion = nombre del área). delta>0 entra, delta<0 sale.
async function setStockInventarioBodega(codigo, ubicacionNombre, delta) {
  const cb = esc(codigo), ub = esc(ubicacionNombre);
  if (delta >= 0) {
    await mssql.query(`
      MERGE [compucaja].[dbo].[inventario_bodega] AS t
      USING (SELECT '${cb}' AS cb, '${ub}' AS ub) AS s
        ON t.codigo_barras=s.cb AND t.ubicacion=s.ub
      WHEN MATCHED THEN UPDATE SET cantidad=t.cantidad+${delta}, ultima_entrada=GETDATE()
      WHEN NOT MATCHED THEN INSERT (codigo_barras,ubicacion,cantidad,ultima_entrada,creado)
        VALUES ('${cb}','${ub}',${delta},GETDATE(),GETDATE());`);
  } else {
    await mssql.query(`
      UPDATE [compucaja].[dbo].[inventario_bodega]
      SET cantidad = CASE WHEN cantidad + (${delta}) < 0 THEN 0 ELSE cantidad + (${delta}) END,
          ultima_salida = GETDATE()
      WHERE codigo_barras='${cb}' AND ubicacion='${ub}';`);
  }
}

// ── GET /api/almacen/ubicaciones/areas-bodega — lista unificada (MSSQL) ───────
router.get('/ubicaciones/areas-bodega', async (_req, res) => {
  try {
    res.json(await fetchAreasBodega());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

    // Stock por ubicación (fuente unificada: MSSQL inventario_bodega)
    const ubicNombre = (await mapaClaveANombre())[area] || 'Bodega';
    await setStockInventarioBodega(codigo, ubicNombre, qty);

    res.json({ ok: true, stockActual: stockDespues, mensaje: `Entrada registrada: +${qty} pzas en ${ubicNombre}` });
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

    // Stock por ubicación (fuente unificada: MSSQL inventario_bodega)
    const ubicNombre = (await mapaClaveANombre())[area] || 'Bodega';
    await setStockInventarioBodega(codigo, ubicNombre, -qty);

    res.json({ ok: true, stockActual: stockDespues, mensaje: `Salida registrada: -${qty} pzas de ${ubicNombre}` });
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
router.get('/movimientos/todos', async (req, res) => {
  const { tipo, area, limit = 300 } = req.query;
  try {
    const hoy = new Date().toISOString().slice(0, 10);
    // Rango de fechas: ?fecha= (un día), ?desde=&hasta=, o por defecto últimos 7 días.
    let desde, hasta;
    if (req.query.fecha)                         { desde = hasta = req.query.fecha; }
    else if (req.query.desde || req.query.hasta) { desde = req.query.desde || '2000-01-01'; hasta = req.query.hasta || hoy; }
    else { const d = new Date(); d.setDate(d.getDate() - 6); desde = d.toISOString().slice(0, 10); hasta = hoy; }
    const cap = Math.min(parseInt(limit) || 300, 500);

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
      WHERE m.tipo = 'entrada' AND DATE(m.created_at) BETWEEN ? AND ?

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
      WHERE m.tipo = 'salida' AND DATE(m.created_at) BETWEEN ? AND ?

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
      WHERE DATE(mr.created_at) BETWEEN ? AND ?

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
      WHERE st.autorizado = 1 AND DATE(st.created_at) BETWEEN ? AND ?

      ORDER BY fecha DESC
      LIMIT ${cap}
    `).all(desde, hasta, desde, hasta, desde, hasta, desde, hasta);

    // ── Movimientos del TC52 (MSSQL movimientos_bodega) — lo que escanea la zebra
    let tc52Rows = [];
    try {
      const r = await mssql.query(`
        SELECT
          CONCAT('tc52-', m.id)                    AS uid,
          LOWER(LTRIM(RTRIM(m.tipo)))              AS tipo,
          m.codigo_barras                          AS codigo,
          ISNULL(NULLIF(a.Art_Descripcion, ''), '') AS nombre,
          m.cantidad                               AS cantidad,
          m.ubicacion                              AS ubicacion,
          m.stock_antes                            AS stock_antes,
          m.stock_despues                          AS stock_despues,
          m.motivo                                 AS motivo,
          m.notas                                  AS notas,
          CONVERT(varchar(19), m.fecha, 120)       AS fecha
        FROM [compucaja].[dbo].[movimientos_bodega] m WITH (NOLOCK)
        LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK) ON a.Art_Codigo = m.codigo_barras
        WHERE CAST(m.fecha AS DATE) BETWEEN '${esc(desde)}' AND '${esc(hasta)}'
        ORDER BY m.fecha DESC
        OPTION (MAXDOP 1)
      `);
      tc52Rows = (r.recordset || []).map(m => {
        const areaKey = String(m.ubicacion || 'Bodega').toLowerCase().replace(/\s+/g, '_');
        const esEntrada = m.tipo === 'entrada';
        return {
          uid: m.uid, tipo: m.tipo, codigo: m.codigo, nombre: m.nombre || null,
          cantidad: m.cantidad,
          area_origen:  esEntrada ? null : areaKey,
          area_destino: esEntrada ? areaKey : null,
          stock_antes: m.stock_antes, stock_despues: m.stock_despues,
          motivo: m.motivo || null, notas: m.notas || null, usuario: 'TC52',
          fecha: m.fecha,
        };
      });
    } catch (e) { console.error('movimientos TC52:', e.message); }

    // Unir TC52 (MSSQL) + admin (SQLite), ordenar y limitar
    let resultado = [...tc52Rows, ...rows]
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
      .slice(0, cap);
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

// Lee mermas UNIFICADAS de las DOS fuentes y las normaliza:
//  · TC52 → MSSQL movimientos_bodega (tipo='merma') — donde la PWA registra de verdad.
//  · Panel admin → SQLite merma_registros (POST /merma).
// Antes /merma/stats e /historial SOLO leían SQLite (vacío), por eso "no salía nada"
// aunque en Movimientos TC52 sí aparecían. Fechas en formato YYYY-MM-DD.
async function fetchMermaRows({ desde, hasta, motivo = null, area = null } = {}) {
  const out = [];

  // TC52 (MSSQL movimientos_bodega)
  try {
    const r = await mssql.query(`
      SELECT
        m.id, m.codigo_barras AS codigo,
        ISNULL(NULLIF(a.Art_Descripcion, ''), m.codigo_barras) AS nombre,
        LOWER(LTRIM(RTRIM(ISNULL(m.motivo, 'otro')))) AS motivo,
        m.ubicacion, m.cantidad, m.stock_antes, m.stock_despues, m.notas,
        CONVERT(varchar(19), m.fecha, 120) AS fecha
      FROM [compucaja].[dbo].[movimientos_bodega] m WITH (NOLOCK)
      LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK) ON a.Art_Codigo = m.codigo_barras
      WHERE LOWER(LTRIM(RTRIM(m.tipo))) = 'merma'
        AND CAST(m.fecha AS DATE) BETWEEN '${esc(desde)}' AND '${esc(hasta)}'
      OPTION (MAXDOP 1)
    `);
    for (const m of (r.recordset || [])) {
      out.push({
        id:           `tc52-${m.id}`,
        codigo:       m.codigo,
        nombre:       m.nombre || null,
        motivo:       m.motivo,
        area:         String(m.ubicacion || 'bodega').toLowerCase().replace(/\s+/g, '_'),
        cantidad:     Math.abs(Number(m.cantidad) || 0),
        stock_antes:  m.stock_antes,
        stock_despues: m.stock_despues,
        notas:        m.notas || null,
        usuario:      'TC52',
        fecha:        m.fecha,
      });
    }
  } catch (e) { console.error('merma MSSQL:', e.message); }

  // Panel admin (SQLite merma_registros)
  try {
    const rows = getDb().prepare(`
      SELECT id, art_codigo AS codigo, nombre, motivo, area, cantidad,
             stock_antes, stock_despues, notas, usuario, created_at AS fecha
      FROM merma_registros
      WHERE DATE(created_at) BETWEEN ? AND ?
    `).all(desde, hasta);
    for (const m of rows) {
      out.push({ ...m, id: `adm-${m.id}`, cantidad: Math.abs(Number(m.cantidad) || 0) });
    }
  } catch (e) { console.error('merma SQLite:', e.message); }

  let res = out;
  if (motivo && MOTIVOS_VALIDOS.includes(motivo)) res = res.filter(r => r.motivo === motivo);
  if (area) res = res.filter(r => r.area === area);
  res.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  return res;
}

// Agrupa filas de merma por una clave y suma registros/unidades.
function _agruparMerma(rows, keyFn, extraFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, { num_registros: 0, total_unidades: 0, ...(extraFn ? extraFn(r) : {}) });
    const g = map.get(k);
    g.num_registros  += 1;
    g.total_unidades += Number(r.cantidad) || 0;
  }
  return [...map.values()].sort((a, b) => b.total_unidades - a.total_unidades);
}

// ── GET /api/almacen/merma/stats — estadísticas por período ──────────────────
router.get('/merma/stats', async (req, res) => {
  const periodo = (req.query.mes || new Date().toISOString().slice(0, 7));
  try {
    const [y, mo] = periodo.split('-').map(Number);
    if (!y || !mo) return res.status(400).json({ error: 'mes inválido (YYYY-MM)' });
    const lastDay = new Date(y, mo, 0).getDate();                 // último día del mes
    const desde   = `${periodo}-01`;
    const hasta   = `${periodo}-${String(lastDay).padStart(2, '0')}`;
    // Rango ampliado (5 meses incl. el actual) para la tendencia
    const d5     = new Date(y, mo - 1 - 4, 1);
    const desde5 = `${d5.getFullYear()}-${String(d5.getMonth() + 1).padStart(2, '0')}-01`;

    const todas   = await fetchMermaRows({ desde: desde5, hasta });
    const mesRows = todas.filter(r => String(r.fecha).slice(0, 7) === periodo);

    const totales = {
      num_registros:  mesRows.length,
      total_unidades: mesRows.reduce((s, r) => s + (Number(r.cantidad) || 0), 0),
    };
    const porMotivo    = _agruparMerma(mesRows, r => r.motivo, r => ({ motivo: r.motivo }));
    const porArea      = _agruparMerma(mesRows, r => r.area,   r => ({ area: r.area }));
    const topProductos = _agruparMerma(mesRows, r => r.codigo, r => ({ codigo: r.codigo, nombre: r.nombre || r.codigo })).slice(0, 10);
    const tendencia    = _agruparMerma(todas, r => String(r.fecha).slice(0, 7), r => ({ mes: String(r.fecha).slice(0, 7) }))
      .sort((a, b) => a.mes.localeCompare(b.mes));

    res.json({ periodo, totales, porMotivo, topProductos, porArea, tendencia });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/merma/historial', async (req, res) => {
  const { fecha, motivo, area, limit = 300 } = req.query;
  try {
    const dia = fecha || new Date().toISOString().slice(0, 10);
    const cap = Math.min(parseInt(limit) || 300, 500);
    const rows = await fetchMermaRows({ desde: dia, hasta: dia, motivo, area });
    res.json(rows.slice(0, cap));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/almacen/ubicaciones — stock actual por producto y área ───────────
router.get('/ubicaciones', async (req, res) => {
  const { area, q } = req.query;
  try {
    const result = await mssql.query(`
      SELECT
        i.codigo_barras                            AS art_codigo,
        ISNULL(v.Art_Descripcion, i.codigo_barras) AS nombre,
        i.ubicacion,
        i.cantidad,
        CONVERT(VARCHAR(23), ISNULL(i.ultima_entrada, i.creado), 120) AS updated_at
      FROM [compucaja].[dbo].[inventario_bodega] i
      OUTER APPLY (
        SELECT TOP 1 Art_Descripcion FROM [compucaja].[dbo].[VArticulosUnificados]
        WHERE Art_GTIN = i.codigo_barras OR CodAlt_Codigo = i.codigo_barras OR Art_Codigo = i.codigo_barras
      ) v
      WHERE i.cantidad > 0
    `);
    const mapa = await mapaUbicacionAClave();
    let rows = (result.recordset || []).map(r => ({
      art_codigo: r.art_codigo,
      nombre:     r.nombre,
      area:       mapa[r.ubicacion] || areaClave(r.ubicacion),
      cantidad:   r.cantidad,
      updated_at: r.updated_at,
    }));
    if (area) rows = rows.filter(r => r.area === area);
    if (q) { const ql = String(q).toLowerCase(); rows = rows.filter(r => (r.nombre || r.art_codigo).toLowerCase().includes(ql)); }
    rows.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es') || a.area.localeCompare(b.area));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/almacen/ubicaciones/resumen — totales por área ──────────────────
router.get('/ubicaciones/resumen', async (req, res) => {
  try {
    const result = await mssql.query(`
      SELECT i.ubicacion,
             COUNT(DISTINCT i.codigo_barras) AS productos,
             SUM(i.cantidad)                 AS unidades
      FROM [compucaja].[dbo].[inventario_bodega] i
      WHERE i.cantidad > 0
      GROUP BY i.ubicacion
    `);
    const mapa = await mapaUbicacionAClave();
    const agg = {};
    for (const r of (result.recordset || [])) {
      const clave = mapa[r.ubicacion] || areaClave(r.ubicacion);
      if (!agg[clave]) agg[clave] = { area: clave, productos: 0, unidades: 0 };
      agg[clave].productos += Number(r.productos) || 0;
      agg[clave].unidades  += Number(r.unidades)  || 0;
    }
    res.json(Object.values(agg).sort((a, b) => a.area.localeCompare(b.area)));
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

// ── GET /api/almacen/buscar-coincidencias?desc=... ───────────────────────────
// Auto-sugerencias por NOMBRE: tokeniza la descripción del proveedor y casa por
// varias palabras (AND). Degrada (3→2→1 palabras) si no encuentra, para no
// quedarse vacío. Usado por el lector de facturas para enlazar rápido.
const STOPWORDS = new Set(['PK','CT','OZ','LB','ML','GR','PACK','THE','AND','CON','PARA','DEL','LOS','LAS','SIN','POR']);
function tokensDeDescripcion(desc) {
  const limpio = String(desc || '').toUpperCase().replace(/[-/.,()&]/g, ' ');
  const toks = limpio.split(/\s+/).filter(t =>
    t.length >= 3 && !/^\d/.test(t) && !STOPWORDS.has(t) && !/^\d+(CT|OZ|LB|ML|PK|G)$/.test(t)
  );
  return [...new Set(toks)].slice(0, 4);
}
async function coincidenciasPorTokens(tokens) {
  for (let n = Math.min(tokens.length, 3); n >= 1; n--) {
    const sub   = tokens.slice(0, n);
    const where = sub.map(t => `a.Art_Descripcion LIKE '%${esc(t)}%'`).join(' AND ');
    const r = await mssql.query(`
      SELECT TOP 8
        a.Art_Codigo                            AS codigo,
        a.Art_Descripcion                       AS nombre,
        ISNULL(SUM(aa.AA_ExistenciaActualU), 0) AS stock
      FROM [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
      LEFT JOIN [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK) ON aa.Art_Codigo = a.Art_Codigo
      WHERE (${where}) AND a.Art_Descripcion <> '' AND a.Art_Descripcion IS NOT NULL
      GROUP BY a.Art_Codigo, a.Art_Descripcion
      ORDER BY stock DESC`);
    if ((r.recordset || []).length) return { palabras: sub, items: r.recordset };
  }
  return { palabras: [], items: [] };
}
router.get('/buscar-coincidencias', async (req, res) => {
  const desc = (req.query.desc || '').trim();
  if (desc.length < 3) return res.json({ palabras: [], items: [] });
  try {
    res.json(await coincidenciasPorTokens(tokensDeDescripcion(desc)));
  } catch (err) {
    console.error('buscar-coincidencias:', err.message);
    res.status(500).json({ palabras: [], items: [], error: err.message });
  }
});

// ── PRODUCTOS PENDIENTES (staging local — NO toca NovaCaja) ───────────────────
// Productos nuevos detectados (en factura PDF o TC52) que aún no existen en el
// catálogo de NovaCaja. Se registran aquí y se les asigna su código de barras
// real al llegar a bodega (TC52 o panel). No se escribe en compucaja hasta resolver.

// POST /api/almacen/productos-pendientes — registrar un producto nuevo
router.post('/productos-pendientes', (req, res) => {
  const b = req.body || {};
  const desc = String(b.descripcion_proveedor || '').trim();
  if (!desc) return res.status(400).json({ error: 'descripcion_proveedor es requerida' });
  const db = getDb();
  try {
    // Evita duplicados: mismo proveedor + sku que siga pendiente
    if (b.sku_proveedor) {
      const ya = db.prepare(
        `SELECT * FROM productos_pendientes WHERE IFNULL(proveedor,'') = IFNULL(?, '') AND sku_proveedor = ? AND estado='pendiente'`
      ).get(b.proveedor || null, String(b.sku_proveedor));
      if (ya) return res.json({ ok: true, id: ya.id, yaExistia: true, pendiente: ya });
    }
    const info = db.prepare(`
      INSERT INTO productos_pendientes
        (proveedor, sku_proveedor, descripcion_proveedor, unidad, piezas_por_caja, cajas, precio_unitario, origen, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.proveedor || null,
      b.sku_proveedor ? String(b.sku_proveedor) : null,
      desc,
      b.unidad || null,
      parseInt(b.piezas_por_caja) || 1,
      parseInt(b.cajas) || 0,
      b.precio_unitario != null ? parseFloat(b.precio_unitario) : null,
      b.origen || 'pdf',
      b.notas || null
    );
    const pendiente = db.prepare(`SELECT * FROM productos_pendientes WHERE id=?`).get(info.lastInsertRowid);
    res.status(201).json({ ok: true, id: info.lastInsertRowid, pendiente });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/almacen/productos-pendientes?estado=pendiente — listar
router.get('/productos-pendientes', (req, res) => {
  const estado = (req.query.estado || 'pendiente').trim();
  const db = getDb();
  try {
    let sql = `SELECT * FROM productos_pendientes`;
    const params = [];
    if (estado && estado !== 'todos') { sql += ` WHERE estado = ?`; params.push(estado); }
    sql += ` ORDER BY created_at DESC`;
    res.json(db.prepare(sql).all(...params));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/almacen/productos-pendientes/buscar?q=... — para TC52/panel
router.get('/productos-pendientes/buscar', (req, res) => {
  const q = (req.query.q || '').trim();
  const db = getDb();
  try {
    if (!q) return res.json(db.prepare(`SELECT * FROM productos_pendientes WHERE estado='pendiente' ORDER BY created_at DESC`).all());
    const like = `%${q}%`;
    res.json(db.prepare(
      `SELECT * FROM productos_pendientes WHERE estado='pendiente' AND (descripcion_proveedor LIKE ? OR sku_proveedor LIKE ?) ORDER BY created_at DESC`
    ).all(like, like));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/almacen/productos-pendientes/:id/resolver — asignar código de barras real
// Marca el pendiente como resuelto y (best-effort) crea la equivalencia en
// productos_compra para que la próxima factura del proveedor lo enlace solo.
// NO crea el producto en NovaCaja (eso lo hace el cliente en su POS).
router.post('/productos-pendientes/:id/resolver', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const b = req.body || {};
  const codigo_barras = String(b.codigo_barras || '').trim();
  if (!codigo_barras) return res.status(400).json({ error: 'codigo_barras es requerido' });
  const db = getDb();
  try {
    const p = db.prepare(`SELECT * FROM productos_pendientes WHERE id=?`).get(id);
    if (!p) return res.status(404).json({ error: 'Pendiente no encontrado' });

    const ppc = parseInt(b.piezas_por_caja) || p.piezas_por_caja || 1;
    db.prepare(`
      UPDATE productos_pendientes
      SET estado='resuelto', codigo_barras=?, art_codigo=?, piezas_por_caja=?, resolved_at=datetime('now')
      WHERE id=?
    `).run(codigo_barras, b.art_codigo || codigo_barras, ppc, id);

    // Best-effort: equivalencia para auto-mapear futuras facturas (no bloquea la resolución)
    let equivalencia = false;
    if (p.proveedor && p.sku_proveedor) {
      try {
        await mssql.query(`
          MERGE productos_compra AS t
          USING (SELECT '${esc(p.proveedor)}' AS p, '${esc(p.sku_proveedor)}' AS s) AS src
            ON t.proveedor = src.p AND t.sku_proveedor = src.s
          WHEN MATCHED THEN UPDATE SET codigo_barras='${esc(codigo_barras)}', piezas_por_caja=${ppc}, activo=1
          WHEN NOT MATCHED THEN
            INSERT (proveedor, sku_proveedor, descripcion_proveedor, unidad_compra, piezas_por_caja, codigo_barras)
            VALUES ('${esc(p.proveedor)}', '${esc(p.sku_proveedor)}', '${esc(p.descripcion_proveedor)}', '${esc(p.unidad || 'Caja')}', ${ppc}, '${esc(codigo_barras)}');
        `);
        equivalencia = true;
      } catch (e) { console.error('resolver equivalencia:', e.message); }
    }
    res.json({ ok: true, id, codigo_barras, equivalencia });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/almacen/productos-pendientes/:id/precio — ponerle el precio
// El empleado ya registró el producto y su stock en la bodega; aquí el admin
// solo le asigna el precio de venta. NO toca NovaCaja (el alta en el POS es manual).
router.post('/productos-pendientes/:id/precio', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const precio = parseFloat(req.body?.precio_unitario);
  if (!(precio >= 0)) return res.status(400).json({ error: 'precio_unitario inválido' });
  const db = getDb();
  try {
    const p = db.prepare(`SELECT id FROM productos_pendientes WHERE id=?`).get(id);
    if (!p) return res.status(404).json({ error: 'Pendiente no encontrado' });
    db.prepare(`UPDATE productos_pendientes SET precio_unitario=? WHERE id=?`).run(precio, id);
    res.json({ ok: true, id, precio_unitario: precio });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/almacen/productos-pendientes/:id — descartar (soft)
router.delete('/productos-pendientes/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const db = getDb();
  try {
    const p = db.prepare(`SELECT id FROM productos_pendientes WHERE id=?`).get(id);
    if (!p) return res.status(404).json({ error: 'Pendiente no encontrado' });
    db.prepare(`UPDATE productos_pendientes SET estado='descartado' WHERE id=?`).run(id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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

  const folio = genFolio();
  try {
    const db = getDb();
    const r  = db.prepare(`
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
    const db         = getDb();
    const cerrado_at = estado === 'cerrado' ? new Date().toISOString() : null;
    db.prepare(`UPDATE pedidos_recepcion SET estado = ?, cerrado_at = ? WHERE id = ?`).run(estado, cerrado_at, id);

    // Si se cierra el pedido, actualiza la factura vinculada a "en_almacen"
    if (estado === 'cerrado') {
      db.prepare(`
        UPDATE facturas_compra
        SET estado = 'en_almacen', entregado_at = datetime('now')
        WHERE pedido_id = ? AND estado = 'en_camino'
      `).run(id);
    }

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

// ── GET /api/almacen/ubicaciones/areas — lista para TC52 (MSSQL ubicaciones_bodega) ──
async function areasTc52() {
  const r = await mssql.query(
    `SELECT id, nombre, color FROM [compucaja].[dbo].[ubicaciones_bodega] WHERE activa=1 ORDER BY orden, nombre`
  );
  return (r.recordset || []).map(u => ({ id: u.id, nombre: u.nombre, color: u.color || '#3B82F6', clave: areaClave(u.nombre) }));
}
router.get('/ubicaciones/areas', async (req, res) => {
  try { res.json(await areasTc52()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/almacen/ubicaciones/areas — TC52 crea área (MSSQL) ─────────────
router.post('/ubicaciones/areas', async (req, res) => {
  const { nombre, color = '#3B82F6' } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const mo    = await mssql.query(`SELECT ISNULL(MAX(orden),0) AS m FROM [compucaja].[dbo].[ubicaciones_bodega]`);
    const orden = (Number(mo.recordset[0]?.m) || 0) + 1;
    await mssql.query(`INSERT INTO [compucaja].[dbo].[ubicaciones_bodega] (nombre,color,orden,activa) VALUES ('${esc(nombre.trim())}','${esc(color)}',${orden},1)`);
    res.status(201).json(await areasTc52());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/almacen/ubicaciones/areas/:id — TC52 soft-delete área (MSSQL) ─
router.delete('/ubicaciones/areas/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  try {
    await mssql.query(`UPDATE [compucaja].[dbo].[ubicaciones_bodega] SET activa=0 WHERE id=${id}`);
    res.json(await areasTc52());
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

// ── "Configurar Áreas" (CRUD) — fuente unificada: MSSQL ubicaciones_bodega ────
// GET devuelve shape AreaConfig (clave/icono/colores derivados); ubicaciones_bodega
// solo guarda nombre+color(hex)+orden+activa (sin tocar su esquema).

// ── GET /api/almacen/ubicaciones/config ───────────────────────────────────────
router.get('/ubicaciones/config', async (req, res) => {
  try { res.json(await fetchAreasBodega()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/almacen/ubicaciones/config — crear área ─────────────────────────
router.post('/ubicaciones/config', async (req, res) => {
  const { nombre, color_text = 'text-stone-600' } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  const hex = TAILWIND_HEX[color_text] || '#3B82F6';
  try {
    const mo    = await mssql.query(`SELECT ISNULL(MAX(orden),0) AS m FROM [compucaja].[dbo].[ubicaciones_bodega]`);
    const orden = (Number(mo.recordset[0]?.m) || 0) + 1;
    await mssql.query(`INSERT INTO [compucaja].[dbo].[ubicaciones_bodega] (nombre,color,orden,activa) VALUES ('${esc(nombre.trim())}','${esc(hex)}',${orden},1)`);
    res.status(201).json({ ok: true, message: 'Área creada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/almacen/ubicaciones/config/:id — editar área ─────────────────────
router.put('/ubicaciones/config/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const { nombre, color_text } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  const hex = TAILWIND_HEX[color_text] || '#3B82F6';
  try {
    await mssql.query(`UPDATE [compucaja].[dbo].[ubicaciones_bodega] SET nombre='${esc(nombre.trim())}', color='${esc(hex)}' WHERE id=${id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/almacen/ubicaciones/config/:id — soft delete (activa=0) ───────
router.delete('/ubicaciones/config/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  try {
    await mssql.query(`UPDATE [compucaja].[dbo].[ubicaciones_bodega] SET activa=0 WHERE id=${id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/almacen/ubicaciones/config/:id/orden — reordenar (swap) ──────────
router.put('/ubicaciones/config/:id/orden', async (req, res) => {
  const id  = parseInt(req.params.id, 10) || 0;
  const dir = req.body.direction; // 'up' | 'down'
  try {
    const cur  = await mssql.query(`SELECT id, orden FROM [compucaja].[dbo].[ubicaciones_bodega] WHERE id=${id} AND activa=1`);
    const curr = cur.recordset[0];
    if (!curr) return res.status(404).json({ error: 'No encontrado' });

    const nb = dir === 'up'
      ? await mssql.query(`SELECT TOP 1 id, orden FROM [compucaja].[dbo].[ubicaciones_bodega] WHERE activa=1 AND orden < ${curr.orden} ORDER BY orden DESC`)
      : await mssql.query(`SELECT TOP 1 id, orden FROM [compucaja].[dbo].[ubicaciones_bodega] WHERE activa=1 AND orden > ${curr.orden} ORDER BY orden ASC`);
    const neighbor = nb.recordset[0];
    if (!neighbor) return res.json({ ok: true });

    await mssql.query(`UPDATE [compucaja].[dbo].[ubicaciones_bodega] SET orden=${neighbor.orden} WHERE id=${curr.id}`);
    await mssql.query(`UPDATE [compucaja].[dbo].[ubicaciones_bodega] SET orden=${curr.orden} WHERE id=${neighbor.id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// (Rutas /ubicaciones/areas duplicadas eliminadas: quedaron unificadas arriba
//  contra MSSQL ubicaciones_bodega — ver areasTc52.)

// ── POST /api/almacen/traslado — mover piezas entre ubicaciones ────────────────
router.post('/traslado', async (req, res) => {
  const { codigo, cantidad, de_ubicacion, a_ubicacion } = req.body;
  const qty = parseInt(cantidad);
  if (!codigo || !qty || qty <= 0 || !de_ubicacion || !a_ubicacion)
    return res.status(400).json({ mensaje: 'Datos inválidos' });
  if (de_ubicacion === a_ubicacion)
    return res.status(400).json({ mensaje: 'El origen y destino deben ser diferentes' });
  const esc = s => String(s||'').replace(/'/g,"''");
  try {
    // Verificar stock en origen
    const chk = await mssql.query(`
      SELECT ISNULL(SUM(cantidad),0) AS stock FROM [compucaja].[dbo].[inventario_bodega]
      WHERE codigo_barras='${esc(codigo)}'
        AND (ubicacion='${esc(de_ubicacion)}' OR (ubicacion IS NULL AND '${esc(de_ubicacion)}'='Bodega'))`);
    const stockOrigen = Number(chk.recordset[0]?.stock) || 0;
    if (stockOrigen < qty)
      return res.status(400).json({ mensaje: `Stock insuficiente en ${de_ubicacion}. Disponible: ${stockOrigen} pzas` });

    // Restar del origen
    await mssql.query(`
      UPDATE [compucaja].[dbo].[inventario_bodega]
      SET cantidad=cantidad-${qty}, ultima_salida=GETDATE()
      WHERE codigo_barras='${esc(codigo)}'
        AND (ubicacion='${esc(de_ubicacion)}' OR (ubicacion IS NULL AND '${esc(de_ubicacion)}'='Bodega'))`);

    // Sumar al destino (MERGE)
    await mssql.query(`
      MERGE [compucaja].[dbo].[inventario_bodega] AS target
      USING (SELECT '${esc(codigo)}' AS cb, '${esc(a_ubicacion)}' AS ub) AS src
        ON target.codigo_barras=src.cb AND target.ubicacion=src.ub
      WHEN MATCHED THEN UPDATE SET cantidad=target.cantidad+${qty}, ultima_entrada=GETDATE()
      WHEN NOT MATCHED THEN INSERT (codigo_barras,ubicacion,cantidad,ultima_entrada)
        VALUES ('${esc(codigo)}','${esc(a_ubicacion)}',${qty},GETDATE());`);

    // Registrar movimiento
    await mssql.query(`
      INSERT INTO [compucaja].[dbo].[movimientos_bodega](codigo_barras,tipo,cantidad,ubicacion,area,fecha)
      VALUES('${esc(codigo)}','traslado',${qty},'${esc(a_ubicacion)}','${esc(de_ubicacion)}',GETDATE())`);

    res.json({ ok:true, stockActual: stockOrigen - qty, mensaje: `Traslado: ${qty} pzas de ${de_ubicacion} → ${a_ubicacion}` });
  } catch (err) {
    console.error('traslado:', err.message);
    res.status(500).json({ mensaje: err.message });
  }
});

// ── GET /api/almacen/inventario — todo el stock registrado en TC52 ─────────────
router.get('/inventario', async (_req, res) => {
  const esc = s => String(s||'').replace(/'/g,"''");
  try {
    const result = await mssql.query(`
      SELECT
        i.codigo_barras                                        AS codigo,
        ISNULL(v.Art_Descripcion, i.codigo_barras)             AS nombre,
        ISNULL(i.ubicacion,'Bodega')                           AS ubicacion,
        i.cantidad,
        ISNULL(u.color,'#6B7280')                              AS color
      FROM [compucaja].[dbo].[inventario_bodega] i
      OUTER APPLY (
        SELECT TOP 1 Art_Descripcion FROM [compucaja].[dbo].[VArticulosUnificados]
        WHERE Art_GTIN=i.codigo_barras OR CodAlt_Codigo=i.codigo_barras
      ) v
      LEFT JOIN [compucaja].[dbo].[ubicaciones_bodega] u
        ON u.nombre=ISNULL(i.ubicacion,'Bodega') AND u.activa=1
      WHERE i.cantidad > 0
      ORDER BY nombre, i.ubicacion`);
    res.json(result.recordset || []);
  } catch (err) {
    console.error('inventario:', err.message);
    res.status(500).json({ mensaje: err.message });
  }
});

// ── POST /api/almacen/producto-ubicacion (stub) ───────────────────────────────
router.post('/producto-ubicacion', (_req, res) => res.json({ ok: true }));

// ── GET /api/almacen/tc52/pedidos — órdenes activas para seleccionar en TC52 ───
router.get('/tc52/pedidos', (req, res) => {
  try {
    const db     = getDb();
    const pedidos = db.prepare(`
      SELECT pr.id, pr.folio, pr.proveedor, pr.fecha_esperada, pr.estado, pr.notas, pr.created_at,
             COUNT(pd.id)              AS num_items,
             SUM(pd.cantidad_esperada) AS total_esperado
      FROM pedidos_recepcion pr
      LEFT JOIN pedidos_recepcion_detalle pd ON pd.pedido_id = pr.id
      WHERE pr.estado IN ('pendiente', 'en_recepcion')
      GROUP BY pr.id
      ORDER BY pr.created_at DESC
    `).all();
    res.json(pedidos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/almacen/tc52/pedidos/:id — detalle del pedido para el TC52 ────────
router.get('/tc52/pedidos/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const db     = getDb();
    const pedido = db.prepare(`SELECT * FROM pedidos_recepcion WHERE id = ?`).get(id);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    const items = db.prepare(`
      SELECT pd.*,
             COALESCE(
               (SELECT SUM(am.cantidad) FROM almacen_movimientos am
                WHERE am.pedido_id = pd.pedido_id AND am.art_codigo = pd.art_codigo AND am.tipo = 'entrada'), 0
             ) AS cantidad_recibida
      FROM pedidos_recepcion_detalle pd
      WHERE pd.pedido_id = ?
    `).all(id);

    res.json({ ...pedido, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/almacen/tc52/stock — inventario del TC52 por ubicación ────────────
router.get('/tc52/stock', async (req, res) => {
  try {
    const result = await mssql.query(`
      SELECT
        i.codigo_barras                                                   AS art_codigo,
        COALESCE(NULLIF(v.Art_Descripcion, ''), NULLIF(i.nombre, ''), i.codigo_barras) AS nombre,
        i.ubicacion,
        i.cantidad,
        CONVERT(VARCHAR(23), ISNULL(i.ultima_entrada, i.creado), 120) AS updated_at
      FROM [compucaja].[dbo].[inventario_bodega] i
      OUTER APPLY (
        SELECT TOP 1 Art_Descripcion
        FROM [compucaja].[dbo].[VArticulosUnificados]
        WHERE Art_Codigo = i.codigo_barras
           OR Art_GTIN = i.codigo_barras
           OR CodAlt_Codigo = i.codigo_barras
      ) v
      WHERE i.cantidad > 0
      ORDER BY nombre, i.ubicacion
    `);
    res.json(result.recordset || []);
  } catch (err) {
    console.error('Error tc52/stock:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/almacen/tc52/ubicaciones — ubicaciones configuradas en TC52 ───────
router.get('/tc52/ubicaciones', async (req, res) => {
  try {
    const result = await mssql.query(`
      SELECT nombre, color, orden
      FROM [compucaja].[dbo].[ubicaciones_bodega]
      WHERE activa = 1
      ORDER BY orden, nombre
    `);
    res.json(result.recordset || []);
  } catch (err) {
    console.error('Error tc52/ubicaciones:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/almacen/ventas-sync/diagnostico — SOLO LECTURA ───────────────────
// Muestra los datos de producción para ligar ventas (tickets NovaCaja) al
// inventario de bodega: qué tiendas (Tda) venden y si los códigos vendidos casan
// con inventario_bodega. NO escribe nada. Es el paso 1 antes del motor real.
router.get('/ventas-sync/diagnostico', async (req, res) => {
  const out = { tiendas: [], tiendasTabla: null, ventasMuestra: [], resumen: {}, errores: {} };

  // 1) Tiendas que venden (últimos 7 días) — usa FolTda_Codigo de Tickets
  try {
    const r = await mssql.query(`
      SELECT FolTda_Codigo AS tda, COUNT(*) AS tickets, CONVERT(varchar(19), MAX(T_Fecha), 120) AS ultima
      FROM [compucaja].[dbo].[Tickets] WITH (NOLOCK)
      WHERE T_Fecha >= DATEADD(DAY, -7, GETDATE())
      GROUP BY FolTda_Codigo
      ORDER BY COUNT(*) DESC
      OPTION (MAXDOP 1)
    `);
    out.tiendas = r.recordset || [];
  } catch (e) { out.errores.tiendas = e.message; }

  // 2) Tabla Tiendas (best-effort: para ver columnas y nombres reales)
  try {
    const r = await mssql.query(`SELECT TOP 50 * FROM [compucaja].[dbo].[Tiendas] WITH (NOLOCK)`);
    out.tiendasTabla = r.recordset || [];
  } catch (e) { out.errores.tiendasTabla = e.message; }

  // 3) Muestra de productos vendidos (últimas líneas) cruzado con inventario_bodega
  try {
    const r = await mssql.query(`
      SELECT TOP 40
        ps.FolTda_Codigo AS tda,
        ps.Codigo        AS codigo,
        ps.Concepto      AS concepto,
        ps.Cantidad      AS cantidad,
        CONVERT(varchar(19), ps.FechaHora, 120) AS fecha,
        (SELECT TOP 1 ib.ubicacion FROM [compucaja].[dbo].[inventario_bodega] ib WHERE ib.codigo_barras = ps.Codigo) AS areaBodega,
        (SELECT SUM(ib.cantidad) FROM [compucaja].[dbo].[inventario_bodega] ib WHERE ib.codigo_barras = ps.Codigo) AS stockBodega
      FROM [compucaja].[dbo].[TicketsPS] ps WITH (NOLOCK)
      WHERE ps.FechaHora >= DATEADD(DAY, -2, GETDATE())
      ORDER BY ps.FechaHora DESC
      OPTION (MAXDOP 1)
    `);
    out.ventasMuestra = r.recordset || [];
    const enBodega = out.ventasMuestra.filter(v => v.stockBodega != null).length;
    out.resumen = { lineasMuestra: out.ventasMuestra.length, enBodega, sinBodega: out.ventasMuestra.length - enBodega };
  } catch (e) { out.errores.ventasMuestra = e.message; }

  res.json(out);
});

// ── GET /api/almacen/ventas-sync/tickets-info — SOLO LECTURA (exploración) ─────
// Muestra TODOS los campos de los tickets + descubre las tablas de estaciones/
// cajeros, para ver si la ubicación de la venta se puede sacar de la caja/cajero.
router.get('/ventas-sync/tickets-info', async (req, res) => {
  const out = { tablasRelevantes: [], ticketEjemplo: [], ticketPSEjemplo: [], estaciones: null, estacionesEnTickets: [], errores: {} };

  // 1) Descubrir tablas relacionadas (estacion / caja / cajero / empleado / usuario / terminal / vendedor)
  try {
    const r = await mssql.query(`
      SELECT name FROM sys.tables
      WHERE name LIKE '%stacion%' OR name LIKE '%aja%' OR name LIKE '%ajero%'
         OR name LIKE '%mplead%'  OR name LIKE '%suario%' OR name LIKE '%erminal%'
         OR name LIKE '%endedor%' OR name LIKE '%Pdv%' OR name LIKE '%POS%'
      ORDER BY name
    `);
    out.tablasRelevantes = (r.recordset || []).map(x => x.name);
  } catch (e) { out.errores.tablasRelevantes = e.message; }

  // 2) Ticket completo (TODOS los campos) — para ver si hay caja/cajero/estacion
  try {
    const r = await mssql.query(`SELECT TOP 3 * FROM [compucaja].[dbo].[Tickets] WITH (NOLOCK) ORDER BY T_Fecha DESC`);
    out.ticketEjemplo = r.recordset || [];
  } catch (e) { out.errores.ticketEjemplo = e.message; }

  // 3) Linea de ticket completa (TicketsPS)
  try {
    const r = await mssql.query(`SELECT TOP 2 * FROM [compucaja].[dbo].[TicketsPS] WITH (NOLOCK) ORDER BY FechaHora DESC`);
    out.ticketPSEjemplo = r.recordset || [];
  } catch (e) { out.errores.ticketPSEjemplo = e.message; }

  // 4) Tabla Estaciones (best-effort)
  try {
    const r = await mssql.query(`SELECT TOP 50 * FROM [compucaja].[dbo].[Estaciones] WITH (NOLOCK)`);
    out.estaciones = r.recordset || [];
  } catch (e) { out.errores.estaciones = e.message; }

  // 5) Estaciones que aparecen en tickets recientes (por tienda) + volumen
  try {
    const r = await mssql.query(`
      SELECT FolTda_Codigo AS tda, FolEst_Codigo AS est, COUNT(*) AS tickets,
             CONVERT(varchar(19), MAX(T_Fecha), 120) AS ultima
      FROM [compucaja].[dbo].[Tickets] WITH (NOLOCK)
      WHERE T_Fecha >= DATEADD(DAY, -7, GETDATE())
      GROUP BY FolTda_Codigo, FolEst_Codigo
      ORDER BY COUNT(*) DESC
      OPTION (MAXDOP 1)
    `);
    out.estacionesEnTickets = r.recordset || [];
  } catch (e) { out.errores.estacionesEnTickets = e.message; }

  res.json(out);
});

// ── GET /api/almacen/ventas-sync/estaciones-cajeros — SOLO LECTURA (enfocado) ──
// Lista chica: qué cajas (estaciones) y cajeros están vendiendo, con sus nombres,
// para mapear caja/cajero -> área de bodega. (El dump completo era demasiado.)
router.get('/ventas-sync/estaciones-cajeros', async (req, res) => {
  const out = { estaciones: [], cajeros: [], estacionCajero: [], errores: {} };

  try {
    const r = await mssql.query(`
      SELECT t.FolEst_Codigo AS est, MAX(e.Est_Nombre) AS nombre, COUNT(*) AS tickets,
             CONVERT(varchar(19), MAX(t.T_Fecha), 120) AS ultima
      FROM [compucaja].[dbo].[Tickets] t WITH (NOLOCK)
      LEFT JOIN [compucaja].[dbo].[Estaciones] e WITH (NOLOCK) ON e.Est_Codigo = t.FolEst_Codigo
      WHERE t.T_Fecha >= DATEADD(DAY, -7, GETDATE())
      GROUP BY t.FolEst_Codigo
      ORDER BY COUNT(*) DESC
      OPTION (MAXDOP 1)
    `);
    out.estaciones = r.recordset || [];
  } catch (e) { out.errores.estaciones = e.message; }

  try {
    const r = await mssql.query(`
      SELECT t.T_Cajero AS cajero, COUNT(*) AS tickets,
             CONVERT(varchar(19), MAX(t.T_Fecha), 120) AS ultima
      FROM [compucaja].[dbo].[Tickets] t WITH (NOLOCK)
      WHERE t.T_Fecha >= DATEADD(DAY, -7, GETDATE())
      GROUP BY t.T_Cajero
      ORDER BY COUNT(*) DESC
      OPTION (MAXDOP 1)
    `);
    out.cajeros = r.recordset || [];
  } catch (e) { out.errores.cajeros = e.message; }

  try {
    const r = await mssql.query(`
      SELECT t.FolEst_Codigo AS est, t.T_Cajero AS cajero, COUNT(*) AS tickets
      FROM [compucaja].[dbo].[Tickets] t WITH (NOLOCK)
      WHERE t.T_Fecha >= DATEADD(DAY, -7, GETDATE())
      GROUP BY t.FolEst_Codigo, t.T_Cajero
      ORDER BY COUNT(*) DESC
      OPTION (MAXDOP 1)
    `);
    out.estacionCajero = r.recordset || [];
  } catch (e) { out.errores.estacionCajero = e.message; }

  res.json(out);
});

// ── Auto-rellenar nombres desde go-upc.com ───────────────────────────────────
// Para productos que la zebra metió pero no existen en NovaCaja (sin nombre),
// busca el nombre en go-upc.com por su código de barras y lo guarda en
// inventario_bodega.nombre. Así dejan de salir en blanco.
const GOUPC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

function _decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .trim();
}

async function buscarNombreGoUpc(codigo) {
  try {
    if (typeof fetch !== 'function') return null;
    const r = await fetch(`https://go-upc.com/search?q=${encodeURIComponent(codigo)}`, {
      headers: { 'User-Agent': GOUPC_UA },
      redirect: 'follow',
    });
    if (!r.ok) return null;
    const html = await r.text();
    const m = html.match(/<h1 class="product-name">([^<]+)<\/h1>/i);
    if (!m) return null;
    const nombre = _decodeEntities(m[1]);
    return nombre && nombre.length > 1 ? nombre.slice(0, 200) : null;
  } catch {
    return null;
  }
}

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

// GET: cuántos productos sin nombre hay (para mostrar el botón con el número)
router.get('/nombres-faltantes/contar', async (req, res) => {
  try {
    const r = await mssql.query(`
      SELECT COUNT(DISTINCT ib.codigo_barras) AS total
      FROM [compucaja].[dbo].[inventario_bodega] ib WITH (NOLOCK)
      LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK) ON a.Art_Codigo = ib.codigo_barras
      WHERE (ib.nombre IS NULL OR LTRIM(RTRIM(ib.nombre)) = '')
        AND (a.Art_Descripcion IS NULL OR LTRIM(RTRIM(a.Art_Descripcion)) = '')
        AND ib.cantidad <> 0
    `);
    res.json({ total: r.recordset[0]?.total || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: busca en go-upc y rellena los nombres faltantes (lote, con pausa entre cada uno)
let _rellenoEnCurso = false;
router.post('/nombres-faltantes/rellenar', async (req, res) => {
  if (_rellenoEnCurso) return res.status(409).json({ error: 'Ya hay un proceso de relleno en curso' });
  _rellenoEnCurso = true;
  try {
    const max = Math.min(parseInt(req.body?.max || req.query?.max || 20) || 20, 60);
    const r = await mssql.query(`
      SELECT DISTINCT ib.codigo_barras AS codigo
      FROM [compucaja].[dbo].[inventario_bodega] ib WITH (NOLOCK)
      LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK) ON a.Art_Codigo = ib.codigo_barras
      WHERE (ib.nombre IS NULL OR LTRIM(RTRIM(ib.nombre)) = '')
        AND (a.Art_Descripcion IS NULL OR LTRIM(RTRIM(a.Art_Descripcion)) = '')
        AND ib.cantidad <> 0
    `);
    const codigos = (r.recordset || []).map(x => x.codigo).slice(0, max);
    const results = [];
    for (const codigo of codigos) {
      const nombre = await buscarNombreGoUpc(codigo);
      if (nombre) {
        await mssql.query(`UPDATE [compucaja].[dbo].[inventario_bodega] SET nombre = '${esc(nombre)}' WHERE codigo_barras = '${esc(codigo)}'`);
        results.push({ codigo, nombre, ok: true });
      } else {
        results.push({ codigo, nombre: null, ok: false });
      }
      await _sleep(900); // pausa para no saturar go-upc
    }
    res.json({
      revisados: codigos.length,
      rellenados: results.filter(x => x.ok).length,
      sinResultado: results.filter(x => !x.ok).length,
      results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    _rellenoEnCurso = false;
  }
});

module.exports = router;
