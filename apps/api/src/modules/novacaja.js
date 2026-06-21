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
  buildDashboardCostQuery,
  buildDashboardCostPolizaQuery,
  buildTopProductsRealtimeQuery,
  COSTO_LINEA,
  JOIN_CP,
  JOIN_CP_A,
} = require('../config/novacaja-mapping');

const router = express.Router();

// ── In-memory TTL cache ───────────────────────────────────────────────────────
const _cache = new Map();
const _get = (k) => { const e = _cache.get(k); return e && Date.now() < e.exp ? e.v : null; };
const _set = (k, v, ttlMs) => _cache.set(k, { v, exp: Date.now() + ttlMs });

// Consulta PESADA: la limitamos a 1 núcleo (MAXDOP 1) para no acaparar la CPU del
// servidor que comparte NovaCaja (POS). Tarda un poco más, pero no lo ahoga.
const heavy = (sql) => mssql.query(sql + '\n    OPTION (MAXDOP 1)');

// Devuelve el valor cacheado o lo calcula con fn() (que resuelve al valor FINAL,
// ya extraído) y lo guarda. Evita re-escanear en cada visita.
async function getCached(key, fn, ttlMs) {
  const c = _get(key);
  if (c !== null) return c;
  const v = await fn();
  _set(key, v, ttlMs);
  return v;
}

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
      heavy(buildSalesByHourQuery({ months: m, maxDate })),
      heavy(buildSalesByMonthQuery({ months: m, maxDate })),
      heavy(buildSalesByWeekdayQuery({ months: m, maxDate })),
      heavy(buildSalesByCategoryQuery({ months: m, limit: 12, maxDate })),
      heavy(buildTopProductsPeriodQuery({ months: m, limit: 30, maxDate })),
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

// ── GET /api/novacaja/sin-costo — productos con costo en $0 (reporte) ─────────
// "Costo 0" = sin costo de factura y Art_UltimoCosto=0 (lo que el panel muestra
// como "Costo: $0.00"). Devuelve la lista + conteo por categoría (para gráfica).
router.get('/sin-costo', async (req, res) => {
  const cached = _get('sin_costo');
  if (cached) return res.json(cached);
  const SIN_COSTO = `COALESCE(NULLIF(cpf.precio_compra,0), NULLIF(a.Art_UltimoCosto,0), NULLIF(a.Art_CostoReposicion,0)) IS NULL`;
  const JOINS = `
    LEFT JOIN [compucaja].[dbo].[costos_producto] cpf WITH (NOLOCK) ON cpf.codigo_barras = a.Art_Codigo AND cpf.fuente = 'factura'
    LEFT JOIN [compucaja].[dbo].[ListaPreciosArt] lp WITH (NOLOCK) ON lp.Art_Codigo = a.Art_Codigo AND lp.LP_Codigo = 1`;
  try {
    const [itemsRes, catRes] = await Promise.all([
      heavy(`
        SELECT TOP 500
          a.Art_Codigo                                AS codigo,
          a.Art_Descripcion                           AS nombre,
          ISNULL(NULLIF(a.Org_Descripcion,''),'Sin categoría') AS categoria,
          ISNULL(lp.LPA_PrecioVentaImp, 0)            AS precio,
          ISNULL(a.Art_CostoReposicion, 0)            AS costoReposicion,
          (SELECT ISNULL(SUM(aa.AA_ExistenciaActualU),0) FROM [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK) WHERE aa.Art_Codigo = a.Art_Codigo) AS stock
        FROM [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
        ${JOINS}
        WHERE a.Art_Descripcion IS NOT NULL AND a.Art_Descripcion <> '' AND ${SIN_COSTO}
        ORDER BY ISNULL(lp.LPA_PrecioVentaImp,0) DESC
      `),
      heavy(`
        SELECT ISNULL(NULLIF(a.Org_Descripcion,''),'Sin categoría') AS categoria, COUNT(*) AS n
        FROM [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
        LEFT JOIN [compucaja].[dbo].[costos_producto] cpf WITH (NOLOCK) ON cpf.codigo_barras = a.Art_Codigo AND cpf.fuente = 'factura'
        WHERE a.Art_Descripcion IS NOT NULL AND a.Art_Descripcion <> '' AND ${SIN_COSTO}
        GROUP BY ISNULL(NULLIF(a.Org_Descripcion,''),'Sin categoría')
        ORDER BY COUNT(*) DESC
      `),
    ]);
    const porCategoria = catRes.recordset || [];
    const result = {
      total:       porCategoria.reduce((s, c) => s + (Number(c.n) || 0), 0),
      items:       itemsRes.recordset || [],
      porCategoria: porCategoria.slice(0, 12),
    };
    _set('sin_costo', result, 600_000); // 10 min
    res.json(result);
  } catch (err) {
    console.error('Error sin-costo:', err.message);
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

    // "Día": TIEMPO REAL → ventas/tickets de la tabla Tickets (igual que el feed)
    //   y costo/unidades de los renglones reales (TicketsPS). Las pólizas se
    //   postean con retraso, por eso el día no puede salir de ahí.
    // "Semana/Mes": TODO de PÓLIZAS (mismo origen que Análisis → las cifras
    //   coinciden). El escaneo de TicketsPS a 30 días truena por tamaño.
    const esDia     = period === 'day';
    const kpiQuery  = esDia ? buildTicketKPIsQuery({ period }) : buildDashboardKPIsQuery({ period, maxDate });
    const topQuery  = esDia ? buildTopProductsRealtimeQuery({ period, limit: 10 }) : buildTopProductsQuery({ period, limit: 10, maxDate });

    // Tendencia 30 días, por proveedor y los conteos cambian lento y son PESADOS
    // (escanean pólizas/catálogo). Se leen de cache largo (los pre-calcula el
    // scheduler en segundo plano) → no se escanean en cada visita al dashboard.
    const [kpiRes, costRes, topRes, byDayData, bySupplierData, totalProducts, lowStockAlerts] = await Promise.all([
      heavy(kpiQuery),
      esDia ? heavy(buildDashboardCostQuery({ period })) : Promise.resolve({ recordset: [{}] }),
      heavy(topQuery),
      getCached('dash:byDay',                  () => heavy(buildSalesByDayQuery({ days: 30, maxDate })).then(r => r.recordset || []),        600_000),
      getCached(`dash:bySupplier:${period}`,   () => heavy(buildSalesBySupplierQuery({ period, maxDate })).then(r => r.recordset || []),     600_000),
      getCached('dash:prodCount', () => mssql.query(buildDashboardProductsCountQuery()).then(r => r.recordset[0]?.totalProducts  || 0), 1800_000),
      getCached('dash:lowStock',  () => mssql.query(buildDashboardLowStockCountQuery()).then(r => r.recordset[0]?.lowStockAlerts || 0),  600_000),
    ]);

    const kpi  = kpiRes.recordset[0]  || {};
    const cost = costRes.recordset[0] || {};

    // Todo reconcilia: ganancia = ventas - costo; ticketPromedio = ventas/tickets.
    const totalVentasN  = Number(kpi.totalVentas)  || 0;
    const totalTicketsN = Number(kpi.totalTickets) || 0;
    const totalCostoN   = Number(esDia ? cost.totalCosto       : kpi.totalCosto)       || 0;
    const unidadesN     = Number(esDia ? cost.unidadesVendidas : kpi.unidadesVendidas) || 0;
    const kpisFull = {
      totalTickets:     totalTicketsN,
      ticketPromedio:   totalTicketsN > 0 ? totalVentasN / totalTicketsN : 0,
      totalVentas:      totalVentasN,
      totalCosto:       totalCostoN,
      unidadesVendidas: unidadesN,
      ganancia:         totalVentasN - totalCostoN,
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
      topProducts:  topRes.recordset || [],
      byDay:        byDayData,
      bySupplier:   bySupplierData,
    };

    // Día: cache 45 s (suficiente; el panel refresca cada 2 min). Semana/mes: 5 min.
    _set(cacheKey, result, esDia ? 45_000 : 300_000);
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
      heavy(`
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
          ISNULL(SUM(${COSTO_LINEA}), 0)                            AS totalCosto,
          ISNULL(SUM(v.importe) - SUM(${COSTO_LINEA}), 0)           AS ganancia,
          ISNULL(COUNT(DISTINCT v.ticket), 0)                       AS totalTickets,
          ISNULL(SUM(v.cantidad), 0)                                AS unidadesVendidas
        FROM [compucaja].[dbo].[Proveedores] p WITH (NOLOCK)
        LEFT JOIN [compucaja].[dbo].[ProveedoresArticulo] pa WITH (NOLOCK)
          ON pa.Pro_Codigo = p.Pro_Codigo
        LEFT JOIN [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
          ON v.producto = pa.Art_Codigo
          AND ${joinFilter}
        ${JOIN_CP_A}
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
        ISNULL(SUM(${COSTO_LINEA}), 0)                 AS costo
      FROM [compucaja].[dbo].[ProveedoresArticulo] pa WITH (NOLOCK)
      LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
        ON a.Art_Codigo = pa.Art_Codigo
      LEFT JOIN [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
        ON v.producto = pa.Art_Codigo AND ${joinFilter}
      ${JOIN_CP}
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

// ── GET /api/novacaja/poliza-diag — SOLO LECTURA: por qué difiere el costo ─────
// Compara Costo vs CostoImp (las 2 columnas de costo de la póliza) en tickets CON
// factura vs SIN factura, para ver por qué el desglose de los de factura sale mal.
router.get('/poliza-diag', async (req, res) => {
  const out = { resumen: [], muestraFactura: [], errores: {} };
  try {
    const r = await mssql.query(`
      SELECT
        CASE WHEN factura IS NOT NULL AND LTRIM(RTRIM(CONVERT(varchar(50),factura))) <> '' THEN 'CON_FACTURA' ELSE 'SIN_FACTURA' END AS tipo,
        COUNT(DISTINCT ticket)  AS tickets,
        COUNT(*)                AS renglones,
        SUM(importe)            AS importe,
        SUM(Costo)              AS costo,
        SUM(CostoImp)           AS costoImp
      FROM [compucaja].[dbo].[VBasePolizaVentas] WITH (NOLOCK)
      WHERE Fecha >= DATEADD(DAY, -3, GETDATE())
      GROUP BY CASE WHEN factura IS NOT NULL AND LTRIM(RTRIM(CONVERT(varchar(50),factura))) <> '' THEN 'CON_FACTURA' ELSE 'SIN_FACTURA' END
      OPTION (MAXDOP 1)
    `);
    out.resumen = r.recordset || [];
  } catch (e) { out.errores.resumen = e.message; }

  try {
    const r = await mssql.query(`
      SELECT TOP 25 ticket, CONVERT(varchar(50),factura) AS factura, producto, importe, Costo, CostoImp,
             CONVERT(varchar(19), Fecha, 120) AS fecha
      FROM [compucaja].[dbo].[VBasePolizaVentas] WITH (NOLOCK)
      WHERE factura IS NOT NULL AND LTRIM(RTRIM(CONVERT(varchar(50),factura))) <> ''
        AND Fecha >= DATEADD(DAY, -4, GETDATE())
      ORDER BY Fecha DESC
      OPTION (MAXDOP 1)
    `);
    out.muestraFactura = r.recordset || [];
  } catch (e) { out.errores.muestraFactura = e.message; }

  res.json(out);
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

// ── GET /api/novacaja/tickets/recent — cache 30 s (varios clientes/refrescos) ──
router.get('/tickets/recent', async (req, res) => {
  const limit    = Math.min(parseInt(req.query.limit) || 50, 100);
  const cacheKey = `recent:${limit}`;
  const cached   = _get(cacheKey);
  if (cached) return res.json(cached);
  try {
    const result = await mssql.query(buildRecentTicketsQuery({ limit }));
    const data   = result.recordset || [];
    _set(cacheKey, data, 30_000); // 30 s — el feed no necesita ser al segundo
    res.json(data);
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

// ── Pre-cálculo en segundo plano ──────────────────────────────────────────────
// Cada 5 min refresca en cache las consultas PESADAS y de cambio lento (tendencia
// 30 días, por proveedor, conteos y Análisis), corriéndolas de forma SECUENCIAL y
// con MAXDOP 1. Así el panel se sirve de cache (instantáneo) y NO se escanean las
// tablas grandes de compucaja en cada visita ni se acapara la CPU del POS.
async function prewarm() {
  try {
    const maxDate = await getMaxDateString();
    await heavy(buildSalesByDayQuery({ days: 30, maxDate })).then(r => _set('dash:byDay', r.recordset || [], 600_000));
    for (const period of ['day', 'week', 'month']) {
      await heavy(buildSalesBySupplierQuery({ period, maxDate })).then(r => _set(`dash:bySupplier:${period}`, r.recordset || [], 600_000));
    }
    await mssql.query(buildDashboardProductsCountQuery()).then(r => _set('dash:prodCount', r.recordset[0]?.totalProducts  || 0, 1800_000));
    await mssql.query(buildDashboardLowStockCountQuery()).then(r => _set('dash:lowStock',  r.recordset[0]?.lowStockAlerts || 0,  600_000));

    // Análisis (3 meses) — la vista por defecto. Secuencial para no acaparar CPU.
    const m = 3;
    const byHour     = (await heavy(buildSalesByHourQuery({ months: m, maxDate }))).recordset || [];
    const byMonth    = (await heavy(buildSalesByMonthQuery({ months: m, maxDate }))).recordset || [];
    const byWeekday  = (await heavy(buildSalesByWeekdayQuery({ months: m, maxDate }))).recordset || [];
    const byCategory = (await heavy(buildSalesByCategoryQuery({ months: m, limit: 12, maxDate }))).recordset || [];
    const topProds   = (await heavy(buildTopProductsPeriodQuery({ months: m, limit: 30, maxDate }))).recordset || [];
    _set(`analytics:${m}`, { byHour, byMonth, byWeekday, byCategory, topProducts: topProds }, 600_000);
  } catch (e) {
    console.error('prewarm:', e.message);
  }
}
// Arranca 20 s después (deja calentar la conexión) y luego cada 8 min (los caches
// duran 10 min, así siempre se sirven calientes sin escaneo en vivo).
setTimeout(prewarm, 20_000);
setInterval(prewarm, 480_000);

module.exports = router;