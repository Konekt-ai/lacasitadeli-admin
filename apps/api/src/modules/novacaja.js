const express = require('express');
const mssql   = require('../db/mssql');  // novacaja22
const adminDb = require('../db');        // lacasita_admin
const router  = express.Router();

// GET /api/novacaja/status — prueba de conexión
router.get('/status', async (req, res) => {
  try {
    await mssql.getPool();
    res.json({ status: 'ok', server: process.env.MSSQL_SERVER || '192.168.1.68', database: process.env.MSSQL_DATABASE || 'novacaja22' });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

// GET /api/novacaja/tables — lista todas las tablas (para explorar el esquema)
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
    console.error('Error al listar tablas:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/novacaja/tables/:table/columns — columnas de una tabla específica
router.get('/tables/:table/columns', async (req, res) => {
  const { table } = req.params;
  // Solo letras, números y guiones bajos — evitar inyección SQL en nombre de tabla
  if (!/^[A-Za-z0-9_]+$/.test(table)) {
    return res.status(400).json({ error: 'Nombre de tabla inválido' });
  }
  try {
    const result = await mssql.query(`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = '${table}'
      ORDER BY ORDINAL_POSITION
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error al listar columnas:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/novacaja/tables/:table/preview — primeras 20 filas de cualquier tabla
router.get('/tables/:table/preview', async (req, res) => {
  const { table } = req.params;
  if (!/^[A-Za-z0-9_]+$/.test(table)) {
    return res.status(400).json({ error: 'Nombre de tabla inválido' });
  }
  try {
    const result = await mssql.query(`SELECT TOP 20 * FROM [${table}]`);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error al previsualizar tabla:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/novacaja/sync — sincroniza productos desde novacaja22 a PostgreSQL
// Requiere que primero configures la query correcta según las columnas reales
router.post('/sync', async (req, res) => {
  const { productTable, mapping } = req.body;
  // mapping ejemplo: { barcode: "codigo", name: "descripcion", salePrice: "precio1", stock: "existencia" }
  if (!productTable || !mapping) {
    return res.status(400).json({
      error: 'Se requieren productTable y mapping',
      ejemplo: {
        productTable: 'Articulos',
        mapping: { barcode: 'codigo', name: 'descripcion', salePrice: 'precio1', stock: 'existencia' },
      },
    });
  }
  if (!/^[A-Za-z0-9_]+$/.test(productTable)) {
    return res.status(400).json({ error: 'Nombre de tabla inválido' });
  }

  try {
    const cols = Object.values(mapping).filter(c => /^[A-Za-z0-9_]+$/.test(c));
    if (cols.length !== Object.keys(mapping).length) {
      return res.status(400).json({ error: 'Nombres de columnas inválidos en mapping' });
    }

    const result = await mssql.query(`SELECT ${cols.join(', ')} FROM [${productTable}]`);
    const rows = result.recordset;

    let inserted = 0, updated = 0, errors = 0;

    for (const row of rows) {
      const barcode   = String(row[mapping.barcode]   || '').trim() || null;
      const name      = String(row[mapping.name]      || '').trim();
      const salePrice = parseFloat(row[mapping.salePrice]) || 0;
      const stock     = parseInt(row[mapping.stock])  || 0;

      if (!name) continue;

      try {
        const existing = barcode
          ? await adminDb.query('SELECT id FROM productos WHERE codigo_barras = $1', [barcode])
          : await adminDb.query('SELECT id FROM productos WHERE nombre = $1', [name]);

        if (existing.rows.length) {
          await adminDb.query(
            `UPDATE productos SET precio_venta = $1, stock_actual = $2 WHERE id = $3`,
            [salePrice, stock, existing.rows[0].id]
          );
          updated++;
        } else {
          await adminDb.query(
            `INSERT INTO productos (codigo_barras, nombre, precio_venta, stock_actual)
             VALUES ($1, $2, $3, $4)`,
            [barcode, name, salePrice, stock]
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

module.exports = router;
