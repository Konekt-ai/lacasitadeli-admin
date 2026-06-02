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
  buildSalesByHourQuery,
  buildSalesByMonthQuery,
  buildSalesByWeekdayQuery,
  buildSalesByCategoryQuery,
  buildTopProductsPeriodQuery,
  buildRecentTicketsQuery,
  buildTicketKPIsQuery,
} = require('../config/novacaja-mapping');

const router = express.Router();

// ── In-memory TTL cache ───────────────────────────────────────────────────────
const _cache = new Map();
const _get = (k) => { const e = _cache.get(k); return e && Date.now() < e.exp ? e.v : null; };
const _set = (k, v, ttlMs) => _cache.set(k, { v, exp: Date.now() + ttlMs });

// ── getMaxDateString — cached 10 min (data is historical, never changes) ─────
let _maxDate = null;
let _maxDateExp = 0;
async function getMaxDateString() {
  if (_maxDate && Date.now() < _maxDateExp) return _maxDate;
  try {
    const res = await mssql.query(
      'SELECT MAX(Fecha) as mDate FROM [compucaja].[dbo].[VBasePolizaVentas] WITH (NOLOCK)'
    );
    const date = res.recordset[0]?.mDate || new Date();
    _maxDate    = date.toISOString().slice(0, 19).replace('T', ' ');
    _maxDateExp = Date.now() + 600_000; // 10 min
    return _maxDate;
  } catch {
    return _maxDate || new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
}

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
    const maxDate = await getMaxDateString();
    const result = await mssql.query(buildSalesQuery({ period, limit: parseInt(limit) || 5000, maxDate }));
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
    const maxDate = await getMaxDateString();
    const result = await mssql.query(buildSalesByDayQuery({ days: parseInt(days), maxDate }));
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
    const maxDate = await getMaxDateString();
    const result = await mssql.query(buildSalesBySupplierQuery({ period, maxDate }));
    res.json(result.recordset);
  } catch (err) {
    console.error('Error ventas por proveedor:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/novacaja/analytics — cached 5 min ────────────────────────────────
router.get('/analytics', async (req, res) => {
  const { months = 3 } = req.query;
  const m        = Math.min(parseInt(months) || 3, 12);
  const cacheKey = `analytics:${m}`;
  const cached   = _get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const maxDate = await getMaxDateString();

    const [byHour, byMonth, byWeekday, byCategory, topProducts] = await Promise.all([
      mssql.query(buildSalesByHourQuery({ months: m, maxDate })),
      mssql.query(buildSalesByMonthQuery({ months: m, maxDate })),
      mssql.query(buildSalesByWeekdayQuery({ months: m, maxDate })),
      mssql.query(buildSalesByCategoryQuery({ months: m, limit: 12, maxDate })),
      mssql.query(buildTopProductsPeriodQuery({ months: m, limit: 30, maxDate })),
    ]);

    const result = {
      byHour:      byHour.recordset      || [],
      byMonth:     byMonth.recordset     || [],
      byWeekday:   byWeekday.recordset   || [],
      byCategory:  byCategory.recordset  || [],
      topProducts: topProducts.recordset || [],
    };

    _set(cacheKey, result, 300_000); // 5 min
    res.json(result);
  } catch (err) {
    console.error('Error analytics:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/novacaja/dashboard — cached 45 s per period ─────────────────────
router.get('/dashboard', async (req, res) => {
  const { period = 'day' } = req.query;
  const cacheKey = `dashboard:${period}`;
  const cached   = _get(cacheKey);
  if (cached) return res.json(cached);

  const days = period === 'day' ? 1 : period === 'week' ? 7 : 30;

  try {
    const maxDate = await getMaxDateString();

    const [kpiRes, topRes, byDayRes, bySupplierRes, prodCountRes, lowStockRes] = await Promise.all([
      mssql.query(buildDashboardKPIsQuery({ period, maxDate })),
      mssql.query(buildTopProductsQuery({ period, limit: 10, maxDate })),
      mssql.query(buildSalesByDayQuery({ days, maxDate })),
      mssql.query(buildSalesBySupplierQuery({ period, maxDate })),
      mssql.query(buildDashboardProductsCountQuery()),
      mssql.query(buildDashboardLowStockCountQuery()),
    ]);

    const totalProducts  = prodCountRes.recordset[0]?.totalProducts  || 0;
    const lowStockAlerts = lowStockRes.recordset[0]?.lowStockAlerts  || 0;
    const polizaKPIs     = kpiRes.recordset[0]           || {};

    // TODOS los KPIs vienen de una sola fuente (VBasePolizaVentas) con la MISMA
    // fecha ancla (maxDate). Así reconcilian entre sí: ganancia = ventas - costo,
    // ticketPromedio = ventas / tickets, y las unidades cuadran con el top de
    // productos. Antes ventas/tickets venían de la tabla Tickets con GETDATE() y
    // costo/unidades de pólizas con maxDate → al ser días distintos, no cuadraban.
    const totalVentasN  = Number(polizaKPIs.totalVentas)  || 0;
    const totalTicketsN = Number(polizaKPIs.totalTickets) || 0;
    const kpisFull = {
      totalTickets:     totalTicketsN,
      // Promedio exacto = ventas / tickets (el AVG de la consulta queda sesgado por
      // el JOIN, que repite el total del ticket una vez por cada línea).
      ticketPromedio:   totalTicketsN > 0 ? totalVentasN / totalTicketsN : 0,
      totalVentas:      totalVentasN,
      totalCosto:       Number(polizaKPIs.totalCosto)       || 0,
      unidadesVendidas: Number(polizaKPIs.unidadesVendidas) || 0,
      ganancia:         Number(polizaKPIs.ganancia)         || 0,
      totalProducts,
      lowStockAlerts,
      alerts:    lowStockAlerts,
      productos: totalProducts,
      alertas:   lowStockAlerts,
    };

    const result = {
      kpis:         kpisFull,
      totalProducts,
      lowStockAlerts,
      alerts:       lowStockAlerts,
      productos:    totalProducts,
      alertas:      lowStockAlerts,
      topProducts:  topRes.recordset        || [],
      byDay:        byDayRes.recordset      || [],
      bySupplier:   bySupplierRes.recordset || [],
    };

    _set(cacheKey, result, 20_000); // 20 s
    res.json(result);
  } catch (err) {
    console.error('Error dashboard:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/novacaja/suppliers ───────────────────────────────────────────────
router.get('/suppliers', async (req, res) => {
  const cached = _get('suppliers');
  if (cached) return res.json(cached);
  try {
    const result = await mssql.query(`
      SELECT
        Pro_Codigo                                    AS id,
        ISNULL(CAST(Pro_Nombre AS NVARCHAR(500)), '') AS nombre,
        Pro_ComprasAcumuladas                         AS comprasAcumuladas
      FROM [compucaja].[dbo].[Proveedores] WITH (NOLOCK)
      WHERE Pro_Bloqueado = 0
        AND Pro_Nombre IS NOT NULL
        AND LEN(CAST(Pro_Nombre AS NVARCHAR(500))) > 0
      ORDER BY CAST(Pro_Nombre AS NVARCHAR(500))
    `);
    _set('suppliers', result.recordset, 300_000); // 5 min
    res.json(result.recordset);
  } catch (err) {
    console.error('Error proveedores:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/novacaja/proveedores — cached 60 s per period+limit ──────────────
router.get('/proveedores', async (req, res) => {
  const { period = 'day', limit = 50 } = req.query;
  const topLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 202);
  const cacheKey = `proveedores:${period}:${topLimit}`;
  const cached   = _get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const maxDate = await getMaxDateString();

    let joinFilter;
    if (period === 'week')       joinFilter = `v.Fecha >= DATEADD(DAY, -7,  '${maxDate}')`;
    else if (period === 'month') joinFilter = `v.Fecha >= DATEADD(DAY, -30, '${maxDate}')`;
    else                         joinFilter = `CAST(v.Fecha AS DATE) = CAST('${maxDate}' AS DATE)`;

    const [suppRes, totalRes] = await Promise.all([
      mssql.query(`
        SELECT TOP ${topLimit}
          p.Pro_Codigo                                               AS id,
          ISNULL(CAST(p.Pro_Nombre          AS NVARCHAR(500)), '')  AS nombre,
          ISNULL(CAST(p.Pro_ApellidoPaterno AS NVARCHAR(500)), '')  AS apellidoPaterno,
          ISNULL(CAST(p.Pro_ApellidoMaterno AS NVARCHAR(500)), '')  AS apellidoMaterno,
          ISNULL(CAST(p.Pro_RegistroTributario AS NVARCHAR(100)), '') AS rfc,
          ISNULL(CAST(p.Pro_SiglasRT        AS NVARCHAR(50)),  '')  AS siglasRT,
          ISNULL(CAST(p.Pro_Telefono1       AS NVARCHAR(50)),  '')  AS telefono1,
          ISNULL(CAST(p.Pro_Url             AS NVARCHAR(500)), '')  AS url,
          ISNULL(CAST(p.Pro_Domicilio       AS NVARCHAR(500)), '')  AS domicilio,
          ISNULL(CAST(p.Pro_Estado          AS NVARCHAR(100)), '')  AS estado,
          ISNULL(CAST(p.Pro_Municipio       AS NVARCHAR(100)), '')  AS municipio,
          ISNULL(CAST(p.Pro_Pais            AS NVARCHAR(50)),  '')  AS pais,
          ISNULL(CAST(p.Pro_CP              AS NVARCHAR(20)),  '')  AS cp,
          ISNULL(p.Pro_ComprasAcumuladas, 0)                        AS comprasAcumuladas,
          p.Pro_FechaUltimaCompra                                   AS fechaUltimaCompra,
          COUNT(DISTINCT pa.Art_Codigo)                             AS totalProductos,
          ISNULL(SUM(v.importe), 0)                                 AS totalVentas,
          ISNULL(SUM(v.Costo), 0)                                   AS totalCosto,
          ISNULL(SUM(v.importe) - SUM(v.Costo), 0)                  AS ganancia,
          ISNULL(COUNT(DISTINCT v.ticket), 0)                       AS totalTickets,
          ISNULL(SUM(v.cantidad), 0)                                AS unidadesVendidas
        FROM [compucaja].[dbo].[Proveedores] p WITH (NOLOCK)
        LEFT JOIN [compucaja].[dbo].[ProveedoresArticulo] pa WITH (NOLOCK)
          ON pa.Pro_Codigo = p.Pro_Codigo
        LEFT JOIN [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
          ON v.producto = pa.Art_Codigo
          AND ${joinFilter}
        WHERE p.Pro_Bloqueado = 0
          AND p.Pro_Nombre IS NOT NULL
          AND LEN(CAST(p.Pro_Nombre AS NVARCHAR(500))) > 0
        GROUP BY
          p.Pro_Codigo,
          CAST(p.Pro_Nombre          AS NVARCHAR(500)),
          CAST(p.Pro_ApellidoPaterno AS NVARCHAR(500)),
          CAST(p.Pro_ApellidoMaterno AS NVARCHAR(500)),
          CAST(p.Pro_RegistroTributario AS NVARCHAR(100)),
          CAST(p.Pro_SiglasRT        AS NVARCHAR(50)),
          CAST(p.Pro_Telefono1       AS NVARCHAR(50)),
          CAST(p.Pro_Url             AS NVARCHAR(500)),
          CAST(p.Pro_Domicilio       AS NVARCHAR(500)),
          CAST(p.Pro_Estado          AS NVARCHAR(100)),
          CAST(p.Pro_Municipio       AS NVARCHAR(100)),
          CAST(p.Pro_Pais            AS NVARCHAR(50)),
          CAST(p.Pro_CP              AS NVARCHAR(20)),
          p.Pro_ComprasAcumuladas,
          p.Pro_FechaUltimaCompra
        ORDER BY ISNULL(SUM(v.importe), 0) DESC
      `),
      mssql.query(`
        SELECT COUNT(*) AS total
        FROM [compucaja].[dbo].[Proveedores] WITH (NOLOCK)
        WHERE Pro_Bloqueado = 0
          AND Pro_Nombre IS NOT NULL
          AND LEN(CAST(Pro_Nombre AS NVARCHAR(500))) > 0
      `),
    ]);

    const result = {
      suppliers: suppRes.recordset || [],
      total:     totalRes.recordset[0]?.total || 0,
      period,
    };

    _set(cacheKey, result, 60_000); // 60 s
    res.json(result);
  } catch (err) {
    console.error('Error proveedores:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/novacaja/proveedores/:id/products ────────────────────────────────
router.get('/proveedores/:id/products', async (req, res) => {
  const id     = String(req.params.id).replace(/'/g, "''");
  const { period = 'day' } = req.query;
  const cacheKey = `proveedor_prods:${id}:${period}`;
  const cached   = _get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const maxDate = await getMaxDateString();

    let joinFilter;
    if (period === 'week')       joinFilter = `v.Fecha >= DATEADD(DAY, -7,  '${maxDate}')`;
    else if (period === 'month') joinFilter = `v.Fecha >= DATEADD(DAY, -30, '${maxDate}')`;
    else                         joinFilter = `CAST(v.Fecha AS DATE) = CAST('${maxDate}' AS DATE)`;

    const result = await mssql.query(`
      SELECT TOP 10
        pa.Art_Codigo                                  AS productCode,
        ISNULL(a.Art_Descripcion, pa.Art_Codigo)       AS name,
        ISNULL(SUM(v.cantidad), 0)                     AS unidadesVendidas,
        ISNULL(SUM(v.importe), 0)                      AS ingresos,
        ISNULL(SUM(v.Costo), 0)                        AS costo
      FROM [compucaja].[dbo].[ProveedoresArticulo] pa WITH (NOLOCK)
      LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
        ON a.Art_Codigo = pa.Art_Codigo
      LEFT JOIN [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
        ON v.producto = pa.Art_Codigo AND ${joinFilter}
      WHERE pa.Pro_Codigo = '${id}'
      GROUP BY pa.Art_Codigo, a.Art_Descripcion
      ORDER BY ISNULL(SUM(v.importe), 0) DESC
    `);

    const data = result.recordset || [];
    _set(cacheKey, data, 60_000); // 60 s
    res.json(data);
  } catch (err) {
    console.error('Error productos proveedor:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/novacaja/proveedores ────────────────────────────────────────────
router.post('/proveedores', async (req, res) => {
  const { nombre, rfc, telefono1, url, domicilio, estado, municipio, pais, cp } = req.body;
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es requerido' });

  const esc = s => s ? String(s).replace(/'/g, "''").trim() : '';

  try {
    const maxRes = await mssql.query(`
      SELECT ISNULL(MAX(TRY_CAST(Pro_Codigo AS BIGINT)), 1000) + 1 AS nextId
      FROM [compucaja].[dbo].[Proveedores]
    `);
    const nextId = maxRes.recordset[0]?.nextId || 9001;

    await mssql.query(`
      INSERT INTO [compucaja].[dbo].[Proveedores]
        (Pro_Codigo, Pro_Nombre, Pro_RegistroTributario, Pro_SiglasRT,
         Pro_Telefono1, Pro_Url, Pro_Domicilio, Pro_Estado,
         Pro_Municipio, Pro_CP, Pro_Pais, Pro_Bloqueado,
         Pro_FechaAlta, Pro_FechaActualizacion)
      VALUES
        ('${nextId}', '${esc(nombre)}', '${esc(rfc)}', 'RFC',
         '${esc(telefono1)}', '${esc(url)}', '${esc(domicilio)}', '${esc(estado)}',
         '${esc(municipio)}', '${esc(cp)}', '${esc(pais) || 'MEX'}', 0,
         GETDATE(), GETDATE())
    `);

    // Invalidate supplier caches
    for (const k of _cache.keys()) {
      if (k.startsWith('proveedores:') || k === 'suppliers') _cache.delete(k);
    }

    res.status(201).json({ id: String(nextId), message: 'Proveedor agregado correctamente' });
  } catch (err) {
    console.error('Error creando proveedor:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/novacaja/proveedores/:id ──────────────────────────────────────
router.delete('/proveedores/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'ID requerido' });

  try {
    const check = await mssql.query(`
      SELECT COUNT(*) AS cnt
      FROM [compucaja].[dbo].[Proveedores]
      WHERE Pro_Codigo = '${id.replace(/'/g, "''")}'
    `);
    if (!check.recordset[0]?.cnt) return res.status(404).json({ error: 'Proveedor no encontrado' });

    await mssql.query(`
      DELETE FROM [compucaja].[dbo].[Proveedores]
      WHERE Pro_Codigo = '${id.replace(/'/g, "''")}'
    `);

    for (const k of _cache.keys()) {
      if (k.startsWith('proveedores:') || k.startsWith('proveedor_prods:') || k === 'suppliers') _cache.delete(k);
    }

    res.json({ message: 'Proveedor eliminado correctamente' });
  } catch (err) {
    console.error('Error eliminando proveedor:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/novacaja/poliza-ventas — cached 30 s per period ──────────────────
router.get('/poliza-ventas', async (req, res) => {
  const { date, period = 'day' } = req.query;

  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Formato de fecha inválido (esperado YYYY-MM-DD)' });
  }

  const cacheKey = date ? `poliza:date:${date}` : `poliza:${period}`;
  const cached   = _get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const maxDate = await getMaxDateString();

    let whereClause, topLimit;

    if (date) {
      whereClause = `WHERE CAST(Fecha AS DATE) = '${date}'`;
      topLimit    = 2000;
    } else {
      switch (period) {
        case 'week':
          whereClause = `WHERE Fecha >= DATEADD(day, -7, '${maxDate}')`;
          topLimit    = 5000;
          break;
        case 'month':
          whereClause = `WHERE Fecha >= DATEADD(month, -1, '${maxDate}')`;
          topLimit    = 7000;
          break;
        default:
          whereClause = `WHERE CAST(Fecha AS DATE) = CAST('${maxDate}' AS DATE)`;
          topLimit    = 2000;
      }
    }

    const [dataRes, countRes] = await Promise.all([
      mssql.query(`
        SELECT TOP ${topLimit}
          ticket,
          MAX(Fecha)                AS fecha,
          MAX(factura)              AS factura,
          SUM(importe)              AS totalImporte,
          SUM(Costo)                AS totalCosto,
          SUM(importe) - SUM(Costo) AS ganancia,
          COUNT(*)                  AS numProductos
        FROM [compucaja].[dbo].[VBasePolizaVentas] WITH (NOLOCK)
        ${whereClause}
        GROUP BY ticket
        ORDER BY MAX(Fecha) DESC
      `),
      mssql.query(`
        SELECT COUNT(DISTINCT ticket) AS totalTickets
        FROM [compucaja].[dbo].[VBasePolizaVentas] WITH (NOLOCK)
        ${whereClause}
      `),
    ]);

    const rows         = dataRes.recordset || [];
    const totalTickets = countRes.recordset[0]?.totalTickets || 0;

    const summary = {
      totalImporte:  rows.reduce((s, r) => s + (Number(r.totalImporte) || 0), 0),
      totalCosto:    rows.reduce((s, r) => s + (Number(r.totalCosto)   || 0), 0),
      totalGanancia: rows.reduce((s, r) => s + (Number(r.ganancia)     || 0), 0),
      numTickets:    rows.length,
    };

    const result = { tickets: rows, summary, totalTickets, limit: topLimit };
    _set(cacheKey, result, 30_000); // 30 s
    res.json(result);
  } catch (err) {
    console.error('Error poliza ventas:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/novacaja/poliza-ventas/export ────────────────────────────────────
router.get('/poliza-ventas/export', async (req, res) => {
  const { period = 'day', startDate, endDate } = req.query;

  const dateRx = /^\d{4}-\d{2}-\d{2}$/;
  if (startDate && !dateRx.test(startDate)) return res.status(400).json({ error: 'startDate inválido' });
  if (endDate   && !dateRx.test(endDate))   return res.status(400).json({ error: 'endDate inválido' });

  try {
    const maxDate = await getMaxDateString();

    let whereClause;
    if (startDate && endDate) {
      whereClause = `WHERE CAST(Fecha AS DATE) BETWEEN '${startDate}' AND '${endDate}'`;
    } else if (startDate) {
      whereClause = `WHERE CAST(Fecha AS DATE) >= '${startDate}'`;
    } else {
      switch (period) {
        case 'week':  whereClause = `WHERE Fecha >= DATEADD(day, -7, '${maxDate}')`; break;
        case 'month': whereClause = `WHERE Fecha >= DATEADD(month, -1, '${maxDate}')`; break;
        default:      whereClause = `WHERE CAST(Fecha AS DATE) = CAST('${maxDate}' AS DATE)`;
      }
    }

    const result = await mssql.query(`
      SELECT TOP 50000
        ticket,
        CONVERT(varchar(19), MAX(Fecha), 120)  AS fecha,
        MAX(factura)                            AS factura,
        SUM(cantidad)                           AS totalArticulos,
        SUM(importe)                            AS totalImporte,
        SUM(Costo)                              AS totalCosto,
        SUM(importe) - SUM(Costo)               AS ganancia,
        COUNT(*)                                AS numLineas
      FROM [compucaja].[dbo].[VBasePolizaVentas] WITH (NOLOCK)
      ${whereClause}
      GROUP BY ticket
      ORDER BY MAX(Fecha) DESC
    `);

    res.json({ tickets: result.recordset || [], count: result.recordset?.length || 0 });
  } catch (err) {
    console.error('Error export poliza:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/novacaja/tickets/recent — no cache, real-time ───────────────────
router.get('/tickets/recent', async (req, res) => {
  const { limit = 50 } = req.query;
  try {
    const result = await mssql.query(
      buildRecentTicketsQuery({ limit: Math.min(parseInt(limit) || 50, 100) })
    );
    res.json(result.recordset || []);
  } catch (err) {
    console.error('Error tickets recientes:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/novacaja/tickets/kpis — cached 30 s per period ──────────────────
router.get('/tickets/kpis', async (req, res) => {
  const { period = 'day' } = req.query;
  const cacheKey = `ticket_kpis:${period}`;
  const cached   = _get(cacheKey);
  if (cached) return res.json(cached);
  try {
    const result = await mssql.query(buildTicketKPIsQuery({ period }));
    const data   = result.recordset[0] || { totalTickets: 0, totalVentas: 0, ticketPromedio: 0 };
    _set(cacheKey, data, 30_000);
    res.json(data);
  } catch (err) {
    console.error('Error ticket KPIs:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/novacaja/tickets/:folio/detalle — productos de un ticket ─────────
router.get('/tickets/:folio/detalle', async (req, res) => {
  const folio = parseInt(req.params.folio);
  if (!folio) return res.status(400).json({ error: 'Folio inválido' });
  try {
    // Paso 1: obtener el registro exacto de Tickets (igual que la lista: el más reciente)
    const ticketRes = await mssql.query(`
      SELECT TOP 1
        FolTda_Codigo,
        FolEst_Codigo,
        FolDoc_Codigo,
        FolConsecutivo,
        ISNULL(T_ImporteTotal, 0)          AS importeTotal,
        CONVERT(varchar(19), T_Fecha, 120) AS fecha,
        T_Cajero                           AS cajero
      FROM [compucaja].[dbo].[Tickets] WITH (NOLOCK)
      WHERE FolConsecutivo = ${folio}
      ORDER BY T_Fecha DESC
    `);

    const t = ticketRes.recordset[0];
    if (!t) return res.json({ lineas: [], importeTotal: 0, sumaPoliza: 0, fecha: null, cajero: null });

    // Paso 2: traer productos de TicketsPS usando los 4 campos exactos de ESE registro
    const lineasRes = await mssql.query(`
      SELECT
        [Codigo]                                          AS codigo,
        [Concepto]                                        AS concepto,
        SUM([Cantidad])                                   AS cantidad,
        [ValorUnitario]                                   AS valorUnitario,
        SUM([Importe] + ISNULL([MontoIva], 0) + ISNULL([MontoIeps], 0)) AS importe,
        MAX(ISNULL([TasaIvaLinea], 0))                                  AS tasaIva
      FROM [compucaja].[dbo].[TicketsPS] WITH (NOLOCK)
      WHERE FolTda_Codigo  = ${t.FolTda_Codigo}
        AND FolEst_Codigo  = ${t.FolEst_Codigo}
        AND FolDoc_Codigo  = ${t.FolDoc_Codigo}
        AND FolConsecutivo = ${t.FolConsecutivo}
      GROUP BY [Codigo], [Concepto], [ValorUnitario]
      ORDER BY SUM([Importe] + ISNULL([MontoIva], 0) + ISNULL([MontoIeps], 0)) DESC
    `);

    const lineas     = lineasRes.recordset || [];
    // Importe ya incluye MontoIva → suma = lo que realmente pagó el cliente
    const sumaLineas = lineas.reduce((s, l) => s + Number(l.importe || 0), 0);

    res.json({
      lineas,
      importeTotal: sumaLineas,
      sumaPoliza:   sumaLineas,
      fecha:        t.fecha  ?? null,
      cajero:       t.cajero ?? null,
    });
  } catch (err) {
    console.error('Error ticket detalle:', err.message);
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