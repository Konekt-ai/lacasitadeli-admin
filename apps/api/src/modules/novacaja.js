const express  = require('express');
const mssql    = require('../db/mssql');
const adminDb  = require('../db');
const { buildProductsQuery } = require('../config/novacaja-mapping');
const router   = express.Router();

// GET /api/novacaja/status
router.get('/status', async (req, res) => {
  try {
    await mssql.getPool();
    res.json({ status: 'ok', server: process.env.MSSQL_SERVER || 'localhost', database: process.env.MSSQL_DATABASE || 'novacaja22' });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

// GET /api/novacaja/products — lista artículos con precio y existencia
router.get('/products', async (req, res) => {
  const { q, limit } = req.query;
  try {
    const sql    = buildProductsQuery({ search: q || '', limit: parseInt(limit) || 500 });
    const result = await mssql.query(sql);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error al obtener productos de novacaja:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/novacaja/sync — sincroniza artículos de novacaja22 → PostgreSQL admin
router.post('/sync', async (req, res) => {
  try {
    const result = await mssql.query(buildProductsQuery({ limit: 99999 }));
    const rows   = result.recordset;

    let inserted = 0, updated = 0, errors = 0;

    for (const row of rows) {
      const barcode   = row.barcode ? String(row.barcode).trim() : null;
      const name      = String(row.name || '').trim();
      const salePrice = parseFloat(row.salePrice) || 0;
      const costPrice = parseFloat(row.costPrice) || 0;
      const stock     = parseFloat(row.stock)     || 0;

      if (!name) continue;

      try {
        const existing = barcode
          ? await adminDb.query('SELECT id FROM productos WHERE codigo_barras = $1', [barcode])
          : await adminDb.query('SELECT id FROM productos WHERE nombre = $1',        [name]);

        if (existing.rows.length) {
          await adminDb.query(
            `UPDATE productos SET precio_venta=$1, precio_costo=$2, stock_actual=$3 WHERE id=$4`,
            [salePrice, costPrice, stock, existing.rows[0].id]
          );
          updated++;
        } else {
          await adminDb.query(
            `INSERT INTO productos (codigo_barras, nombre, precio_venta, precio_costo, stock_actual)
             VALUES ($1, $2, $3, $4, $5)`,
            [barcode, name, salePrice, costPrice, stock]
          );
          inserted++;
        }
      } catch (rowErr) {
        console.error('Error en fila:', name, rowErr.message);
        errors++;
      }
    }

    res.json({ message: 'Sincronización completada', total: rows.length, inserted, updated, errors });
  } catch (err) {
    console.error('Error en sincronización:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/novacaja/tables — exploración del schema (debug)
router.get('/tables', async (req, res) => {
  try {
    const result = await mssql.query(`
      SELECT TABLE_NAME, TABLE_TYPE
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/novacaja/tables/:table/columns — columnas de una tabla (debug)
router.get('/tables/:table/columns', async (req, res) => {
  const { table } = req.params;
  if (!/^[A-Za-z0-9_]+$/.test(table)) return res.status(400).json({ error: 'Nombre de tabla inválido' });
  try {
    const result = await mssql.query(`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = '${table}'
      ORDER BY ORDINAL_POSITION
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/novacaja/tables/:table/preview — primeras 20 filas (debug)
router.get('/tables/:table/preview', async (req, res) => {
  const { table } = req.params;
  if (!/^[A-Za-z0-9_]+$/.test(table)) return res.status(400).json({ error: 'Nombre de tabla inválido' });
  try {
    const result = await mssql.query(`SELECT TOP 20 * FROM [${table}]`);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
