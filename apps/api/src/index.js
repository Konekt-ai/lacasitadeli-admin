require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

app.use('/api',          require('./modules/auth'));
app.use('/api/products', require('./modules/products'));
app.use('/api/sales',    require('./modules/sales'));
app.use('/api/novacaja', require('./modules/novacaja'));

app.get('/api/health', async (req, res) => {
  const db = require('./db');
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'PostgreSQL conectado', time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', db: err.message });
  }
});

app.get('/api/dashboard', async (req, res) => {
  const db   = require('./db');
  const hoy  = new Date().toISOString().split('T')[0];
  try {
    const [ventasHoy, productos, stockBajo] = await Promise.all([
      db.query(`
        SELECT COUNT(*)::int AS total_ventas,
               COALESCE(SUM(total),0)::float AS total_ingresos,
               COALESCE(AVG(total),0)::float AS ticket_promedio
        FROM ventas WHERE estado='completada' AND DATE(created_at)=$1`, [hoy]),
      db.query(`SELECT COUNT(*)::int AS total FROM productos WHERE activo=TRUE`),
      db.query(`SELECT COUNT(*)::int AS total FROM productos WHERE activo=TRUE AND stock_actual<=stock_minimo`),
    ]);
    res.json({
      ventas_hoy:      ventasHoy.rows[0],
      total_productos: productos.rows[0].total,
      stock_bajo:      stockBajo.rows[0].total,
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

app.get('/api/inventory/movements', async (req, res) => {
  const db = require('./db');
  const { productId, limit = 50 } = req.query;
  try {
    let sql = `
      SELECT m.id, m.tipo, m.cantidad, m.stock_antes, m.stock_despues,
             m.motivo, m.created_at AS "createdAt",
             p.nombre AS product, u.nombre AS usuario
      FROM movimientos_inventario m
      LEFT JOIN productos p ON p.id = m.producto_id
      LEFT JOIN usuarios  u ON u.id = m.usuario_id
    `;
    const params = [];
    if (productId) { params.push(productId); sql += ` WHERE m.producto_id = $${params.length}`; }
    params.push(parseInt(limit));
    sql += ` ORDER BY m.created_at DESC LIMIT $${params.length}`;
    const result = await db.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🏪 La Casita Admin — API en http://localhost:${PORT}`);
  console.log(`🗄️  PostgreSQL: ${process.env.DATABASE_URL?.split('@')[1] || 'localhost:5432/lacasita_db'}`);
});
