const express  = require('express');
const mssql    = require('../db/mssql');
const {
  buildProductsQuery,
  buildProductsCountQuery,
  buildDashboardProductsCountQuery,
  buildDashboardLowStockCountQuery,
  buildSalesQuery,
  buildSalesByDayQuery,
  buildSalesBySupplierQuery,
  buildDashboardKPIsQuery,
  buildTopProductsQuery,
} = require('../config/novacaja-mapping');

const router = express.Router();

// ── GET /api/novacaja/status ──────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    await mssql.getPool();
    res.json({
      status:   'ok',
      server:   process.env.MSSQL_SERVER   || 'localhost',
      database: process.env.MSSQL_DATABASE || 'compucaja',
    });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

// ── GET /api/novacaja/products ────────────────────────────────────────────────
router.get('/products', async (req, res) => {
  const { q = '', page = 1, pageSize = 200 } = req.query;
  const offset   = (parseInt(page) - 1) * parseInt(pageSize);

  try {
    const [dataRes, countRes] = await Promise.all([
      mssql.query(buildProductsQuery({ search: q, offset, pageSize: parseInt(pageSize) })),
      mssql.query(buildProductsCountQuery({ search: q })),
    ]);

    res.json({
      data:      dataRes.recordset,
      total:     countRes.recordset[0]?.total || 0,
      page:      parseInt(page),
      pageSize:  parseInt(pageSize),
      pages:     Math.ceil((countRes.recordset[0]?.total || 0) / parseInt(pageSize)),
    });
  } catch (err) {
    console.error('Error productos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/novacaja/sales ───────────────────────────────────────────────────
router.get('/sales', async (req, res) => {
  const { period = 'day', limit } = req.query;
  try {
    const result = await mssql.query(buildSalesQuery({ period, limit: parseInt(limit) || 5000 }));
    res.json(result.recordset);
  } catch (err) {
    console.error('Error ventas:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/novacaja/sales/by-day ───────────────────────────────────────────
router.get('/sales/by-day', async (req, res) => {
  const { days = 30 } = req.query;
  try {
    const result = await mssql.query(buildSalesByDayQuery({ days: parseInt(days) }));
    res.json(result.recordset);
  } catch (err) {
    console.error('Error ventas por día:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/novacaja/sales/by-supplier ──────────────────────────────────────
router.get('/sales/by-supplier', async (req, res) => {
  const { period = 'month' } = req.query;
  try {
    const result = await mssql.query(buildSalesBySupplierQuery({ period }));
    res.json(result.recordset);
  } catch (err) {
    console.error('Error ventas por proveedor:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/novacaja/dashboard ───────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  const { period = 'day' } = req.query;
  const days = period === 'day' ? 1 : period === 'week' ? 7 : 30;

  try {
    const [kpiRes, topRes, byDayRes, bySupplierRes, prodCountRes, lowStockRes] = await Promise.all([
      mssql.query(buildDashboardKPIsQuery({ period })),
      mssql.query(buildTopProductsQuery({ period, limit: 10 })),
      mssql.query(buildSalesByDayQuery({ days })),
      mssql.query(buildSalesBySupplierQuery({ period })),
      mssql.query(buildDashboardProductsCountQuery()),
      mssql.query(buildDashboardLowStockCountQuery())
    ]);

    const totalProducts = prodCountRes.recordset[0]?.totalProducts || 0;
    const lowStockAlerts = lowStockRes.recordset[0]?.lowStockAlerts || 0;

    // Se construye el objeto KPI inyectando los datos de inventario calculados
    const kpisFull = {
      ...(kpiRes.recordset[0] || {}),
      totalProducts,
      lowStockAlerts,
      alerts: lowStockAlerts,
      productos: totalProducts,
      alertas: lowStockAlerts
    };

    res.json({
      kpis:         kpisFull,
      totalProducts,
      lowStockAlerts,
      alerts:       lowStockAlerts,
      productos:    totalProducts,
      alertas:      lowStockAlerts,
      topProducts:  topRes.recordset        || [],
      byDay:        byDayRes.recordset      || [],
      bySupplier:   bySupplierRes.recordset || [],
    });
  } catch (err) {
    console.error('Error dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/novacaja/suppliers ───────────────────────────────────────────────
router.get('/suppliers', async (req, res) => {
  try {
    const result = await mssql.query(`
      SELECT
        Pro_Codigo              AS id,
        Pro_Nombre              AS nombre,
        Pro_ComprasAcumuladas   AS comprasAcumuladas,
        Pro_ServAcumuladas      AS serviciosAcumulados
      FROM [compucaja].[dbo].[Proveedores]
      WHERE Pro_Bloqueado = 0
        AND Pro_Nombre IS NOT NULL
        AND Pro_Nombre <> ''
      ORDER BY Pro_Nombre
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Error proveedores:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Debug endpoints ───────────────────────────────────────────────────────────
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

router.get('/tables/:table/columns', async (req, res) => {
  const { table } = req.params;
  if (!/^[A-Za-z0-9_]+$/.test(table)) return res.status(400).json({ error: 'Nombre inválido' });
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

router.get('/tables/:table/preview', async (req, res) => {
  const { table } = req.params;
  if (!/^[A-Za-z0-9_]+$/.test(table)) return res.status(400).json({ error: 'Nombre inválido' });
  try {
    const result = await mssql.query(`SELECT TOP 20 * FROM [${table}]`);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;