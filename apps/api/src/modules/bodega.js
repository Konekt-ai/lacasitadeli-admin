const express = require('express');
const { getDb } = require('../db');
const mssql    = require('../db/mssql');

const router = express.Router();

const VALID_AREAS = ['bodega', 'cocina', 'tienda', 'refrigerador', 'otro'];

function getWeekNumber(d) {
  const date   = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function esc(s) { return String(s || '').replace(/'/g, "''"); }

// ── GET /api/bodega/area-counts ───────────────────────────────────────────────
router.get('/area-counts', (req, res) => {
  try {
    const db   = getDb();
    const rows = db.prepare(`
      SELECT area, COUNT(*) as total FROM product_locations GROUP BY area
    `).all();
    const map = Object.fromEntries(rows.map(r => [r.area, r.total]));
    res.json(VALID_AREAS.map(a => ({ area: a, total: map[a] || 0 })));
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
  if (!VALID_AREAS.includes(area)) return res.status(400).json({ error: 'Área inválida' });

  try {
    const db = getDb();
    const searchClause = search
      ? `AND (a.Art_Descripcion1 LIKE '%${esc(search)}%' OR a.Art_Codigo LIKE '%${esc(search)}%')`
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
          a.Art_Codigo          AS id,
          a.Art_Descripcion1    AS name,
          aa.AA_ExistenciaActualU AS stock,
          a.Org_Descripcion     AS category
        FROM [compucaja].[dbo].[Articulos] a WITH (NOLOCK)
        JOIN [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
          ON aa.Art_Codigo = a.Art_Codigo
        WHERE a.Art_Estatus = 'A'
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
        a.Art_Descripcion1      AS name,
        aa.AA_ExistenciaActualU AS stock,
        a.Org_Descripcion       AS category
      FROM [compucaja].[dbo].[Articulos] a WITH (NOLOCK)
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
router.put('/products/:id/location', (req, res) => {
  const { area, notas } = req.body;
  const artCodigo       = req.params.id;

  if (!VALID_AREAS.includes(area)) return res.status(400).json({ error: 'Área inválida' });

  try {
    getDb().prepare(`
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

  if (!transfer)         return res.status(404).json({ error: 'Transferencia no encontrada' });
  if (transfer.autorizado) return res.status(400).json({ error: 'Ya está autorizada' });

  try {
    if (transfer.de_area === 'bodega') {
      await mssql.query(`
        UPDATE [compucaja].[dbo].[ArticulosAlmacen]
        SET AA_ExistenciaActualU = AA_ExistenciaActualU - ${parseFloat(transfer.cantidad)}
        WHERE Art_Codigo = '${esc(transfer.art_codigo)}'
      `);
    }
    db.prepare('UPDATE surtido_transfers SET autorizado = 1 WHERE id = ?').run(req.params.id);
    res.json({ message: 'Autorizada y descontada del inventario' });
  } catch (err) {
    console.error('Error autorizar surtido:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/bodega/discrepancias ────────────────────────────────────────────
// Productos con stock > 0 pero sin ventas en 30 días (posible estancamiento)
router.get('/discrepancias', async (req, res) => {
  try {
    const stagnantRes = await mssql.query(`
      SELECT TOP 50
        a.Art_Codigo          AS id,
        a.Art_Descripcion1    AS name,
        aa.AA_ExistenciaActualU AS stock,
        a.Org_Descripcion     AS category,
        MAX(v.Fecha)          AS ultima_venta
      FROM [compucaja].[dbo].[Articulos] a WITH (NOLOCK)
      JOIN [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
        ON aa.Art_Codigo = a.Art_Codigo
      LEFT JOIN [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
        ON v.Art_Codigo = a.Art_Codigo
      WHERE aa.AA_ExistenciaActualU > 5 AND a.Art_Estatus = 'A'
      GROUP BY a.Art_Codigo, a.Art_Descripcion1, aa.AA_ExistenciaActualU, a.Org_Descripcion
      HAVING MAX(v.Fecha) < DATEADD(day, -30, GETDATE()) OR MAX(v.Fecha) IS NULL
      ORDER BY aa.AA_ExistenciaActualU DESC
    `);

    const db        = getDb();
    const recuentos = db.prepare(
      `SELECT * FROM recuentos ORDER BY created_at DESC LIMIT 100`
    ).all();

    res.json({
      stagnant:  stagnantRes.recordset || [],
      recuentos,
    });
  } catch (err) {
    console.error('Error discrepancias:', err.message);
    res.status(500).json({ error: err.message });
  }
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
    const db    = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const in30  = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

    const expirySoon = db.prepare(
      `SELECT * FROM product_expiry WHERE fecha_caducidad BETWEEN ? AND ? ORDER BY fecha_caducidad ASC`
    ).all(today, in30);

    const expired = db.prepare(
      `SELECT * FROM product_expiry WHERE fecha_caducidad < ? ORDER BY fecha_caducidad DESC`
    ).all(today);

    let stagnant = [], noSales = [];
    try {
      const [sRes, nRes] = await Promise.all([
        mssql.query(`
          SELECT TOP 20
            a.Art_Codigo          AS id,
            a.Art_Descripcion1    AS name,
            aa.AA_ExistenciaActualU AS stock,
            a.Org_Descripcion     AS category,
            MAX(v.Fecha)          AS ultima_venta
          FROM [compucaja].[dbo].[Articulos] a WITH (NOLOCK)
          JOIN [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
            ON aa.Art_Codigo = a.Art_Codigo
          LEFT JOIN [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
            ON v.Art_Codigo = a.Art_Codigo
          WHERE aa.AA_ExistenciaActualU > 0 AND a.Art_Estatus = 'A'
          GROUP BY a.Art_Codigo, a.Art_Descripcion1, aa.AA_ExistenciaActualU, a.Org_Descripcion
          HAVING MAX(v.Fecha) < DATEADD(day, -30, GETDATE()) OR MAX(v.Fecha) IS NULL
          ORDER BY aa.AA_ExistenciaActualU DESC
        `),
        mssql.query(`
          SELECT TOP 20
            a.Art_Codigo          AS id,
            a.Art_Descripcion1    AS name,
            aa.AA_ExistenciaActualU AS stock,
            a.Org_Descripcion     AS category
          FROM [compucaja].[dbo].[Articulos] a WITH (NOLOCK)
          JOIN [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
            ON aa.Art_Codigo = a.Art_Codigo
          WHERE aa.AA_ExistenciaActualU > 0 AND a.Art_Estatus = 'A'
            AND a.Art_Codigo NOT IN (
              SELECT DISTINCT Art_Codigo
              FROM [compucaja].[dbo].[VBasePolizaVentas] WITH (NOLOCK)
              WHERE Fecha >= DATEADD(month, -1, GETDATE())
            )
          ORDER BY aa.AA_ExistenciaActualU DESC
        `),
      ]);
      stagnant = sRes.recordset || [];
      noSales  = nRes.recordset || [];
    } catch (e) {
      console.error('MSSQL alert fetch error:', e.message);
    }

    res.json({
      expirySoon,
      expired,
      stagnant,
      noSales,
      totals: {
        expirySoon: expirySoon.length,
        expired:    expired.length,
        stagnant:   stagnant.length,
        noSales:    noSales.length,
      },
    });
  } catch (err) {
    console.error('Error alerts:', err.message);
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

module.exports = router;
