require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3002;

// ── Middlewares ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api',          require('./modules/auth'));
app.use('/api/products', require('./modules/products'));
app.use('/api/sales',    require('./modules/sales'));
app.use('/api/novacaja', require('./modules/novacaja'));

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  const db = require('./db');
  try {
    await db.query('SELECT 1 AS ok');
    res.json({
      status:   'ok',
      db:       'SQL Server conectado',
      database: process.env.MSSQL_DATABASE || 'lacasita_admin',
      time:     new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: 'error', db: err.message });
  }
});

// ── Dashboard stats ──────────────────────────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
  const db  = require('./db');
  const hoy = new Date().toISOString().split('T')[0];

  try {
    const [ventasHoy, productos, stockBajo] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*)                      AS total_ventas,
          COALESCE(SUM(total), 0)       AS total_ingresos,
          COALESCE(AVG(total), 0)       AS ticket_promedio
        FROM ventas
        WHERE estado = 'completada'
          AND CAST(created_at AS DATE) = $1
      `, [hoy]),

      db.query(`
        SELECT COUNT(*) AS total FROM productos WHERE activo = 1
      `),

      db.query(`
        SELECT COUNT(*) AS total
        FROM productos
        WHERE activo = 1 AND stock_actual <= stock_minimo
      `),
    ]);

    res.json({
      ventas_hoy:      ventasHoy.rows[0],
      total_productos: productos.rows[0].total,
      stock_bajo:      stockBajo.rows[0].total,
    });
  } catch (err) {
    console.error('Error en dashboard:', err.message);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// ── Inventory movements (shortcut) ───────────────────────────────────────────
app.get('/api/inventory/movements', async (req, res) => {
  const db = require('./db');
  const { productId, limit = 50 } = req.query;
  try {
    let sql = `
      SELECT m.id, m.tipo, m.cantidad, m.stock_antes, m.stock_despues,
             m.motivo, m.created_at AS createdAt,
             p.nombre AS product, u.nombre AS usuario
      FROM movimientos_inventario m
      LEFT JOIN productos p ON p.id = m.producto_id
      LEFT JOIN usuarios  u ON u.id = m.usuario_id
    `;
    const params = [];
    if (productId) {
      params.push(productId);
      sql += ` WHERE m.producto_id = $${params.length}`;
    }
    params.push(parseInt(limit));
    sql += ` ORDER BY m.created_at DESC LIMIT $${params.length}`;
    const result = await db.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🏪 La Casita Admin — API corriendo en http://localhost:${PORT}`);
  console.log(`🗄️  Base de datos: SQL Server ${process.env.MSSQL_SERVER} / ${process.env.MSSQL_DATABASE || 'lacasita_admin'}`);
});
