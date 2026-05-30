// ── Mapeo real de compucaja — vistas y tablas confirmadas
const LOW_STOCK_THRESHOLD = parseInt(process.env.LOW_STOCK_THRESHOLD || '5');

function buildProductsQuery({ search = '', category = '', offset = 0, pageSize = 200 } = {}) {
  const esc = s => String(s || '').replace(/'/g, "''");
  const whereSearch = search
    ? `AND (
        a.Art_Descripcion  LIKE '%${esc(search)}%'
        OR a.Art_GTIN      LIKE '%${esc(search)}%'
        OR a.Art_PLU       LIKE '%${esc(search)}%'
        OR a.Art_SKU       LIKE '%${esc(search)}%'
        OR a.CodAlt_Codigo LIKE '%${esc(search)}%'
      )`
    : '';
  const whereCategory = category ? `AND a.Org_Descripcion = '${esc(category)}'` : '';

  return `
    SELECT
      a.Art_Codigo                                      AS id,
      ISNULL(a.Art_GTIN, a.CodAlt_Codigo)               AS barcode,
      a.Art_Descripcion                                 AS name,
      a.Art_Alias                                       AS alias,
      ISNULL(a.Art_UltimoCosto, 0)                      AS costPrice,
      ISNULL(p.LPA_PrecioVentaImp, 0)                   AS salePrice,
      ISNULL(SUM(aa.AA_ExistenciaActualU), 0)           AS stock,
      a.Mar_Nombre                                      AS brand,
      a.Org_Descripcion                                 AS category,
      a.UM_Codigo                                       AS unit,
      a.Art_SKU                                         AS sku,
      a.Art_CodProv                                     AS supplierCode,
      a.Art_FechaUltimaCompra                           AS lastPurchase,
      a.Art_FechaUltimaVenta                            AS lastSale
    FROM [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
    LEFT JOIN [compucaja].[dbo].[ListaPreciosArt] p WITH (NOLOCK)
      ON p.Art_Codigo = a.Art_Codigo AND p.LP_Codigo = 1
    LEFT JOIN [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
      ON aa.Art_Codigo = a.Art_Codigo
    WHERE a.Art_Descripcion <> ''
      AND a.Art_Descripcion IS NOT NULL
      ${whereSearch}
      ${whereCategory}
    GROUP BY
      a.Art_Codigo, a.Art_GTIN, a.CodAlt_Codigo,
      a.Art_Descripcion, a.Art_Alias, a.Art_UltimoCosto,
      p.LPA_PrecioVentaImp, a.Mar_Nombre, a.Org_Descripcion,
      a.UM_Codigo, a.Art_SKU, a.Art_CodProv,
      a.Art_FechaUltimaCompra, a.Art_FechaUltimaVenta
    ORDER BY a.Art_Descripcion
    OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY
  `;
}

function buildProductsCountQuery({ search = '', category = '' } = {}) {
  const esc = s => String(s || '').replace(/'/g, "''");
  const whereSearch = search
    ? `AND (
        a.Art_Descripcion  LIKE '%${esc(search)}%'
        OR a.Art_GTIN      LIKE '%${esc(search)}%'
        OR a.Art_SKU       LIKE '%${esc(search)}%'
        OR a.CodAlt_Codigo LIKE '%${esc(search)}%'
      )`
    : '';
  const whereCategory = category ? `AND a.Org_Descripcion = '${esc(category)}'` : '';
  return `
    SELECT COUNT(*) AS total
    FROM [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
    WHERE a.Art_Descripcion <> ''
      AND a.Art_Descripcion IS NOT NULL
      ${whereSearch}
      ${whereCategory}
  `;
}

function buildDashboardProductsCountQuery() {
  return `
    SELECT COUNT(*) AS totalProducts
    FROM [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
    WHERE a.Art_Descripcion <> '' AND a.Art_Descripcion IS NOT NULL
  `;
}

function buildDashboardLowStockCountQuery() {
  return `
    SELECT COUNT(*) AS lowStockAlerts
    FROM (
      SELECT a.Art_Codigo
      FROM [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
      LEFT JOIN [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
        ON aa.Art_Codigo = a.Art_Codigo
      WHERE a.Art_Descripcion <> '' AND a.Art_Descripcion IS NOT NULL
      GROUP BY a.Art_Codigo
      HAVING ISNULL(SUM(aa.AA_ExistenciaActualU), 0) <= ${LOW_STOCK_THRESHOLD}
    ) AS sub
  `;
}

function _dateFilter(period, col, maxDate) {
  if (!maxDate) return '1=1';
  if (period === 'day')   return `CAST(${col} AS DATE) = CAST('${maxDate}' AS DATE)`;
  if (period === 'week')  return `${col} >= DATEADD(DAY, -7,  '${maxDate}')`;
  if (period === 'month') return `${col} >= DATEADD(DAY, -30, '${maxDate}')`;
  return `CAST(${col} AS DATE) = CAST('${maxDate}' AS DATE)`;
}

// ── VENTAS por periodo ────────────────────────────────────────────────────────
function buildSalesQuery({ period = 'day', limit = 5000, maxDate } = {}) {
  return `
    SELECT TOP ${limit}
      v.ticket          AS folio,
      v.Fecha           AS fecha,
      v.producto        AS productCode,
      v.cantidad        AS cantidad,
      v.pu              AS precioUnitario,
      v.importe         AS importe,
      v.importeSI       AS importeSinImp,
      v.Costo           AS costo,
      v.FolTda_Codigo   AS tiendaCodigo
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    WHERE ${_dateFilter(period, 'v.Fecha', maxDate)}
    ORDER BY v.Fecha DESC
  `;
}

function buildSalesByDayQuery({ days = 30, maxDate } = {}) {
  return `
    SELECT
      CAST(v.Fecha AS DATE)        AS fecha,
      COUNT(DISTINCT v.ticket)     AS numTickets,
      SUM(v.cantidad)              AS unidadesVendidas,
      SUM(v.importe)               AS totalVentas,
      SUM(v.Costo)                 AS totalCosto
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    WHERE v.Fecha >= DATEADD(DAY, -${days}, '${maxDate}')
    GROUP BY CAST(v.Fecha AS DATE)
    ORDER BY CAST(v.Fecha AS DATE) ASC
  `;
}

function buildSalesBySupplierQuery({ period = 'month', maxDate } = {}) {
  return `
    SELECT TOP 20
      ISNULL(CAST(p.Pro_Nombre AS NVARCHAR(500)), 'Sin Proveedor') AS proveedor,
      COUNT(DISTINCT v.ticket)                                      AS numTickets,
      SUM(v.cantidad)                                               AS unidadesVendidas,
      SUM(v.importe)                                                AS totalVentas,
      SUM(v.Costo)                                                  AS totalCosto
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
      ON a.Art_Codigo = v.producto
    LEFT JOIN [compucaja].[dbo].[Proveedores] p WITH (NOLOCK)
      ON p.Pro_Codigo = a.Art_CodProv
    WHERE ${_dateFilter(period, 'v.Fecha', maxDate)}
    GROUP BY CAST(p.Pro_Nombre AS NVARCHAR(500))
    ORDER BY SUM(v.importe) DESC
  `;
}

function buildDashboardKPIsQuery({ period = 'day', maxDate } = {}) {
  const outerFilter = _dateFilter(period, 'v.Fecha', maxDate);
  const innerFilter = _dateFilter(period, 'Fecha',   maxDate);
  return `
    SELECT
      COUNT(DISTINCT v.ticket)           AS totalTickets,
      SUM(v.importe)                     AS totalVentas,
      SUM(v.Costo)                       AS totalCosto,
      SUM(v.importe) - SUM(v.Costo)      AS ganancia,
      SUM(v.cantidad)                    AS unidadesVendidas,
      AVG(sub.ticketTotal)               AS ticketPromedio
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    JOIN (
      SELECT ticket, SUM(importe) AS ticketTotal
      FROM [compucaja].[dbo].[VBasePolizaVentas] WITH (NOLOCK)
      WHERE ${innerFilter}
      GROUP BY ticket
    ) sub ON sub.ticket = v.ticket
    WHERE ${outerFilter}
  `;
}

function buildTopProductsQuery({ period = 'day', limit = 10, maxDate } = {}) {
  return `
    SELECT TOP ${limit}
      v.producto                             AS productCode,
      ISNULL(a.Art_Descripcion, v.producto)  AS name,
      ISNULL(a.Mar_Nombre, '')               AS brand,
      ISNULL(a.Org_Descripcion, '')          AS category,
      SUM(v.cantidad)                        AS unidadesVendidas,
      SUM(v.importe)                         AS ingresos,
      SUM(v.Costo)                           AS costo
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
      ON a.Art_Codigo = v.producto
    WHERE ${_dateFilter(period, 'v.Fecha', maxDate)}
    GROUP BY v.producto, a.Art_Descripcion, a.Mar_Nombre, a.Org_Descripcion
    ORDER BY SUM(v.cantidad) DESC
  `;
}

// ── ANALYTICS — VOLUMEN POR HORA Y MES ───────────────────────────────────────

function buildSalesByHourQuery({ months = 3, maxDate } = {}) {
  return `
    SELECT
      DATEPART(HOUR, v.Fecha)      AS hora,
      COUNT(DISTINCT v.ticket)     AS numTickets,
      SUM(v.cantidad)              AS unidadesVendidas,
      SUM(v.importe)               AS totalVentas,
      SUM(v.Costo)                 AS totalCosto
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    WHERE v.Fecha >= DATEADD(MONTH, -${months}, '${maxDate}')
    GROUP BY DATEPART(HOUR, v.Fecha)
    ORDER BY DATEPART(HOUR, v.Fecha) ASC
  `;
}

function buildTopProductsByHourQuery({ months = 3, limit = 10, maxDate } = {}) {
  return `
    SELECT TOP ${limit}
      ISNULL(a.Art_Descripcion, v.producto) AS nombre,
      DATEPART(HOUR, v.Fecha)               AS hora,
      SUM(v.cantidad)                        AS unidades,
      SUM(v.importe)                         AS ingresos
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
      ON a.Art_Codigo = v.producto
    WHERE v.Fecha >= DATEADD(MONTH, -${months}, '${maxDate}')
      AND v.producto IS NOT NULL AND v.producto <> '' AND v.producto <> '0'
    GROUP BY v.producto, a.Art_Descripcion, DATEPART(HOUR, v.Fecha)
    ORDER BY SUM(v.cantidad) DESC
  `;
}

function buildSalesByMonthQuery({ months = 12, maxDate } = {}) {
  return `
    SELECT
      YEAR(v.Fecha)                AS anio,
      MONTH(v.Fecha)               AS mes,
      COUNT(DISTINCT v.ticket)     AS numTickets,
      SUM(v.cantidad)              AS unidadesVendidas,
      SUM(v.importe)               AS totalVentas,
      SUM(v.Costo)                 AS totalCosto
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    WHERE v.Fecha >= DATEADD(MONTH, -${months}, '${maxDate}')
    GROUP BY YEAR(v.Fecha), MONTH(v.Fecha)
    ORDER BY YEAR(v.Fecha) ASC, MONTH(v.Fecha) ASC
  `;
}

function buildTopProductsByMonthQuery({ months = 6, limit = 8, maxDate } = {}) {
  return `
    SELECT TOP ${limit}
      ISNULL(a.Art_Descripcion, v.producto)  AS nombre,
      YEAR(v.Fecha)                           AS anio,
      MONTH(v.Fecha)                          AS mes,
      SUM(v.cantidad)                         AS unidades,
      SUM(v.importe)                          AS ingresos
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
      ON a.Art_Codigo = v.producto
    WHERE v.Fecha >= DATEADD(MONTH, -${months}, '${maxDate}')
      AND v.producto IS NOT NULL AND v.producto <> '' AND v.producto <> '0'
    GROUP BY v.producto, a.Art_Descripcion, YEAR(v.Fecha), MONTH(v.Fecha)
    ORDER BY SUM(v.cantidad) DESC
  `;
}

// ── TICKETS — Ventas en tiempo real ──────────────────────────────────────────

function buildRecentTicketsQuery({ limit = 50 } = {}) {
  return `
    SELECT TOP ${limit}
      t.FolConsecutivo                        AS folio,
      CONVERT(varchar(19), t.T_Fecha, 120)    AS fecha,
      t.T_Cajero                              AS cajero,
      t.T_Vendedor                            AS vendedor,
      t.T_ImporteTotal                        AS importeTotal
    FROM [compucaja].[dbo].[Tickets] t WITH (NOLOCK)
    ORDER BY t.T_Fecha DESC
  `;
}

function buildTicketKPIsQuery({ period = 'day' } = {}) {
  let whereClause;
  if (period === 'week')       whereClause = `WHERE T_Fecha >= DATEADD(DAY, -7, GETDATE())`;
  else if (period === 'month') whereClause = `WHERE T_Fecha >= DATEADD(DAY, -30, GETDATE())`;
  else                         whereClause = `WHERE CAST(T_Fecha AS DATE) = CAST(GETDATE() AS DATE)`;

  return `
    SELECT
      COUNT(*)                        AS totalTickets,
      ISNULL(SUM(T_ImporteTotal), 0)  AS totalVentas,
      ISNULL(AVG(T_ImporteTotal), 0)  AS ticketPromedio
    FROM [compucaja].[dbo].[Tickets] WITH (NOLOCK)
    ${whereClause}
  `;
}

module.exports = {
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
  buildTopProductsByHourQuery,
  buildSalesByMonthQuery,
  buildTopProductsByMonthQuery,
  buildRecentTicketsQuery,
  buildTicketKPIsQuery,
};
