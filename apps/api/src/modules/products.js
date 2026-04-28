const express = require('express');
const db  = require('../db');
const map = require('../config/novacaja-mapping').products;
const router = express.Router();

// Construye un SELECT seguro basado en el mapping configurable
function buildSelect() {
  const cols = [
    `[${map.id}]        AS id`,
    `[${map.name}]      AS name`,
    `[${map.salePrice}] AS salePrice`,
  ];
  if (map.barcode)   cols.push(`[${map.barcode}]   AS barcode`);
  if (map.costPrice) cols.push(`[${map.costPrice}] AS costPrice`);
  if (map.stock)     cols.push(`[${map.stock}]     AS stock`);
  if (map.minStock)  cols.push(`[${map.minStock}]  AS minStock`);
  if (map.category)  cols.push(`[${map.category}]  AS category`);
  return cols.join(',\n      ');
}

function buildActiveFilter(hasWhere) {
  if (!map.active) return '';
  return `${hasWhere ? 'AND' : 'WHERE'} [${map.active}] = 1`;
}

// GET /api/products
router.get('/', async (req, res) => {
  const { q, lowStock } = req.query;
  try {
    let sql    = `SELECT ${buildSelect()} FROM [${map.table}]`;
    const params = [];
    const conditions = [];

    if (map.active) conditions.push(`[${map.active}] = 1`);

    if (q) {
      params.push(`%${q}%`);
      const n = params.length;
      conditions.push(`([${map.name}] LIKE @p${n} OR [${map.barcode || map.id}] LIKE @p${n})`);
    }

    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');

    if (lowStock === 'true' && map.stock && map.minStock) {
      sql += (conditions.length ? ' AND' : ' WHERE') + ` [${map.stock}] <= [${map.minStock}]`;
    }

    sql += ` ORDER BY [${map.name}] ASC`;

    const result = await db.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener productos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/stats/low-stock
router.get('/stats/low-stock', async (req, res) => {
  if (!map.stock || !map.minStock) {
    return res.json([]);
  }
  try {
    const result = await db.query(`
      SELECT ${buildSelect()}
      FROM [${map.table}]
      ${map.active ? `WHERE [${map.active}] = 1 AND` : 'WHERE'} [${map.stock}] <= [${map.minStock}]
      ORDER BY ([${map.minStock}] - [${map.stock}]) DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener bajo stock:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  // Solo números permitidos como ID
  if (!/^\d+$/.test(id) && !/^[A-Za-z0-9_-]+$/.test(id)) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const result = await db.query(
      `SELECT ${buildSelect()} FROM [${map.table}] WHERE [${map.id}] = $1`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al obtener producto:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/categories  — categorías únicas desde la columna de categoría
router.get('/categories', async (req, res) => {
  if (!map.category) return res.json([]);
  try {
    const result = await db.query(`
      SELECT DISTINCT [${map.category}] AS name
      FROM [${map.table}]
      WHERE [${map.category}] IS NOT NULL
        AND [${map.category}] <> ''
      ORDER BY [${map.category}] ASC
    `);
    res.json(result.rows.map((r, i) => ({ id: i + 1, name: r.name })));
  } catch (err) {
    console.error('Error al obtener categorías:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
