// ── Mapeo real de compucaja — vistas y tablas confirmadas
const LOW_STOCK_THRESHOLD = parseInt(process.env.LOW_STOCK_THRESHOLD || '5');

// Limita nuestras consultas pesadas a 1 núcleo de CPU para NO acaparar el
// servidor que también usa NovaCaja (POS). Va al final de cada SELECT.
const MAXDOP1 = '\n    OPTION (MAXDOP 1)';

function buildProductsQuery({ search = '', category = '', offset = 0, pageSize = 200, lowStockThreshold = null } = {}) {
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
  const whereCategory   = category ? `AND a.Org_Descripcion = '${esc(category)}'` : '';
  // Stock EFECTIVO (para mostrar) = lo que cuenta el TC52 en inventario_bodega; si
  // el producto no está ahí, cae al de NovaCaja. Es una SUBCONSULTA escalar: solo
  // se evalúa para los renglones de la página (rápido), sin unir todo el catálogo.
  const stockExpr = `ISNULL((SELECT SUM(ibx.cantidad) FROM [compucaja].[dbo].[inventario_bodega] ibx WITH (NOLOCK) WHERE ibx.codigo_barras IN (a.Art_Codigo, a.Art_GTIN, a.CodAlt_Codigo)), ISNULL(SUM(aa.AA_ExistenciaActualU), 0))`;
  // El filtro de "stock bajo" usa el de NovaCaja (barato sobre todo el catálogo).
  const havingLowStock  = lowStockThreshold !== null
    ? `HAVING ISNULL(SUM(aa.AA_ExistenciaActualU), 0) <= ${parseInt(lowStockThreshold)}`
    : '';

  return `
    SELECT
      a.Art_Codigo                                      AS id,
      ISNULL(a.Art_GTIN, a.CodAlt_Codigo)               AS barcode,
      a.Art_Descripcion                                 AS name,
      a.Art_Alias                                       AS alias,
      ISNULL(COALESCE(NULLIF(cpf.precio_compra,0), NULLIF(a.Art_UltimoCosto,0), NULLIF(a.Art_CostoReposicion,0)), 0) AS costPrice,
      ISNULL(p.LPA_PrecioVentaImp, 0)                   AS salePrice,
      ${stockExpr}                                      AS stock,
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
    LEFT JOIN [compucaja].[dbo].[costos_producto] cpf WITH (NOLOCK)
      ON cpf.codigo_barras = a.Art_Codigo AND cpf.fuente = 'factura'
    LEFT JOIN [compucaja].[dbo].[ArticulosAlmacen] aa WITH (NOLOCK)
      ON aa.Art_Codigo = a.Art_Codigo
    WHERE a.Art_Descripcion <> ''
      AND a.Art_Descripcion IS NOT NULL
      ${whereSearch}
      ${whereCategory}
    GROUP BY
      a.Art_Codigo, a.Art_GTIN, a.CodAlt_Codigo,
      a.Art_Descripcion, a.Art_Alias, a.Art_UltimoCosto, a.Art_CostoReposicion, cpf.precio_compra,
      p.LPA_PrecioVentaImp, a.Mar_Nombre, a.Org_Descripcion,
      a.UM_Codigo, a.Art_SKU, a.Art_CodProv,
      a.Art_FechaUltimaCompra, a.Art_FechaUltimaVenta
    ${havingLowStock}
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

// Filtro de fecha en TIEMPO REAL (tabla Tickets, ancla GETDATE — el día de hoy
// real, no el último día de pólizas que va con retraso).
function _ticketDateFilter(period, col = 'T_Fecha') {
  if (period === 'week')  return `${col} >= DATEADD(DAY, -7,  GETDATE())`;
  if (period === 'month') return `${col} >= DATEADD(DAY, -30, GETDATE())`;
  return `CAST(${col} AS DATE) = CAST(GETDATE() AS DATE)`;
}

// ── COSTO EXACTO ─────────────────────────────────────────────────────────────
// Costo por pieza = nuestro precio de compra real (costos_producto, de las
// facturas) y, si aún no se capturó, el último costo de NovaCaja (Art_UltimoCosto).
// Reemplaza al Costo de las pólizas (incompleto/inconsistente). Las consultas que
// lo usen deben incluir el alias `v` (VBasePolizaVentas) y los JOINs `cp` y `a`.
const COSTO_PZA   = `COALESCE(NULLIF(cp.precio_compra, 0), NULLIF(a.Art_UltimoCosto, 0), NULLIF(a.Art_CostoReposicion, 0), 0)`;
const COSTO_LINEA = `(v.cantidad * ${COSTO_PZA})`;                       // costo de un renglón
const JOIN_CP     = `LEFT JOIN [compucaja].[dbo].[costos_producto] cp WITH (NOLOCK) ON cp.codigo_barras = v.producto`;
const JOIN_CP_A   = `${JOIN_CP}
    LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK) ON a.Art_Codigo = v.producto`;

// Costo + unidades desde PÓLIZAS para semana/mes (rápido; el escaneo de TicketsPS
// a 30 días truena por tamaño). Tope por renglón: el costo no excede la venta.
function buildDashboardCostPolizaQuery({ period = 'month' } = {}) {
  // MISMA ventana que las ventas (Tickets, ancla GETDATE) para que el margen
  // sea coherente. Las pólizas pueden faltar el último día o dos (se postean con
  // retraso), impacto mínimo en periodos de semana/mes.
  return `
    SELECT
      ISNULL(SUM(v.cantidad), 0) AS unidadesVendidas,
      ISNULL(SUM(${COSTO_LINEA}), 0) AS totalCosto
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    ${JOIN_CP_A}
    WHERE ${_ticketDateFilter(period, 'v.Fecha')}
  `;
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
      ${COSTO_LINEA}    AS costo,
      v.FolTda_Codigo   AS tiendaCodigo
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    ${JOIN_CP_A}
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
      SUM(${COSTO_LINEA})          AS totalCosto
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    ${JOIN_CP_A}
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
      SUM(${COSTO_LINEA})                                           AS totalCosto
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    ${JOIN_CP}
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
  // COSTO EXACTO por pieza: nuestro precio de compra real (costos_producto, de
  // las facturas) y, si aún no se ha capturado, el último costo de NovaCaja
  // (Art_UltimoCosto). Así el margen deja de depender del Costo de las pólizas,
  // que viene incompleto/inconsistente. ticketPromedio se calcula en el handler
  // como ventas/tickets (exacto).
  // GANANCIA = ventas - costos (costo real por pieza, SIN tope). Lo que se vendió
  // menos lo que costó comprarlo.
  const costoReal = `SUM(${COSTO_LINEA})`;
  return `
    SELECT
      COUNT(DISTINCT v.ticket)                  AS totalTickets,
      SUM(v.importe)                            AS totalVentas,
      ${costoReal}                              AS totalCosto,
      SUM(v.importe) - ${costoReal}             AS ganancia,
      SUM(v.cantidad)                           AS unidadesVendidas
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    ${JOIN_CP_A}
    WHERE ${outerFilter}
  `;
}

// Costo + unidades en TIEMPO REAL desde los renglones de los tickets (TicketsPS),
// MISMA fuente y fecha que las ventas (tabla Tickets). Costo por pieza:
// factura -> Art_UltimoCosto -> reposicion. GANANCIA = ventas - costos reales
// (sin tope), igual que en Analisis.
function buildDashboardCostQuery({ period = 'day' } = {}) {
  return `
    SELECT
      ISNULL(SUM(x.cantidad), 0) AS unidadesVendidas,
      ISNULL(SUM(x.costoLinea), 0) AS totalCosto
    FROM (
      SELECT
        ps.[Cantidad] AS cantidad,
        ps.[Cantidad] * COALESCE(NULLIF(cp.precio_compra,0), NULLIF(a.Art_UltimoCosto,0), NULLIF(a.Art_CostoReposicion,0), 0) AS costoLinea,
        (ps.[Importe] + ISNULL(ps.[MontoIva],0) + ISNULL(ps.[MontoIeps],0)) AS ventaLinea
      FROM [compucaja].[dbo].[Tickets] t WITH (NOLOCK)
      JOIN [compucaja].[dbo].[TicketsPS] ps WITH (NOLOCK)
        ON ps.FolTda_Codigo = t.FolTda_Codigo AND ps.FolEst_Codigo = t.FolEst_Codigo
       AND ps.FolDoc_Codigo = t.FolDoc_Codigo AND ps.FolConsecutivo = t.FolConsecutivo
      LEFT JOIN [compucaja].[dbo].[costos_producto] cp WITH (NOLOCK) ON cp.codigo_barras = ps.[Codigo]
      LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK) ON a.Art_Codigo = ps.[Codigo]
      WHERE ${_ticketDateFilter(period, 't.T_Fecha')}
        AND ${_ticketDateFilter(period, 'ps.[FechaHora]')}
    ) x
  `;
}

// Top productos en TIEMPO REAL (TicketsPS), misma fecha que las ventas.
function buildTopProductsRealtimeQuery({ period = 'day', limit = 10 } = {}) {
  return `
    SELECT TOP ${limit}
      ps.[Codigo]                              AS productCode,
      MAX(ISNULL(a.Art_Descripcion, ps.[Concepto])) AS name,
      MAX(ISNULL(a.Mar_Nombre, ''))            AS brand,
      MAX(ISNULL(a.Org_Descripcion, ''))       AS category,
      SUM(ps.[Cantidad])                       AS unidadesVendidas,
      SUM(ps.[Importe] + ISNULL(ps.[MontoIva],0) + ISNULL(ps.[MontoIeps],0)) AS ingresos
    FROM [compucaja].[dbo].[Tickets] t WITH (NOLOCK)
    JOIN [compucaja].[dbo].[TicketsPS] ps WITH (NOLOCK)
      ON ps.FolTda_Codigo = t.FolTda_Codigo AND ps.FolEst_Codigo = t.FolEst_Codigo
     AND ps.FolDoc_Codigo = t.FolDoc_Codigo AND ps.FolConsecutivo = t.FolConsecutivo
    LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK) ON a.Art_Codigo = ps.[Codigo]
    WHERE ${_ticketDateFilter(period, 't.T_Fecha')}
      AND ${_ticketDateFilter(period, 'ps.[FechaHora]')}
      AND ps.[Codigo] IS NOT NULL AND ps.[Codigo] <> ''
    GROUP BY ps.[Codigo]
    ORDER BY SUM(ps.[Cantidad]) DESC
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
      SUM(${COSTO_LINEA})                    AS costo
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    ${JOIN_CP}
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
      SUM(${COSTO_LINEA})          AS totalCosto
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    ${JOIN_CP_A}
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
      SUM(${COSTO_LINEA})          AS totalCosto
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    ${JOIN_CP_A}
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
      SUM(v.importe)                         AS ingresos
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
      ON a.Art_Codigo = v.producto
    WHERE v.Fecha >= DATEADD(MONTH, -${months}, '${maxDate}')
      AND v.producto IS NOT NULL AND v.producto <> '' AND v.producto <> '0'
    GROUP BY v.producto, a.Art_Descripcion, YEAR(v.Fecha), MONTH(v.Fecha)
    ORDER BY SUM(v.cantidad) DESC
  `;
}

// ── VENTAS por DÍA DE LA SEMANA ──────────────────────────────────────────────
// DATEDIFF(DAY, 0, fecha) % 7  →  0=Lunes … 6=Domingo (independiente de DATEFIRST)
function buildSalesByWeekdayQuery({ months = 3, maxDate } = {}) {
  return `
    SELECT
      (DATEDIFF(DAY, 0, v.Fecha) % 7)  AS diaSemana,
      COUNT(DISTINCT v.ticket)         AS numTickets,
      SUM(v.cantidad)                  AS unidadesVendidas,
      SUM(v.importe)                   AS totalVentas,
      SUM(${COSTO_LINEA})              AS totalCosto
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    ${JOIN_CP_A}
    WHERE v.Fecha >= DATEADD(MONTH, -${months}, '${maxDate}')
    GROUP BY (DATEDIFF(DAY, 0, v.Fecha) % 7)
    ORDER BY (DATEDIFF(DAY, 0, v.Fecha) % 7) ASC
  `;
}

// ── VENTAS por CATEGORÍA ─────────────────────────────────────────────────────
function buildSalesByCategoryQuery({ months = 3, limit = 12, maxDate } = {}) {
  return `
    SELECT TOP ${limit}
      ISNULL(NULLIF(LTRIM(RTRIM(a.Org_Descripcion)), ''), 'Sin categoría') AS categoria,
      COUNT(DISTINCT v.ticket)                                             AS numTickets,
      SUM(v.cantidad)                                                      AS unidadesVendidas,
      SUM(v.importe)                                                       AS totalVentas,
      SUM(${COSTO_LINEA})                                                  AS totalCosto
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    ${JOIN_CP}
    LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
      ON a.Art_Codigo = v.producto
    WHERE v.Fecha >= DATEADD(MONTH, -${months}, '${maxDate}')
    GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(a.Org_Descripcion)), ''), 'Sin categoría')
    ORDER BY SUM(v.importe) DESC
  `;
}

// ── TOP PRODUCTOS del periodo (ranking por ingresos / ganancia) ──────────────
function buildTopProductsPeriodQuery({ months = 3, limit = 30, maxDate } = {}) {
  return `
    SELECT TOP ${limit}
      ISNULL(a.Art_Descripcion, v.producto)  AS nombre,
      ISNULL(a.Org_Descripcion, '')          AS categoria,
      SUM(v.cantidad)                        AS unidades,
      SUM(v.importe)                         AS ingresos,
      SUM(${COSTO_LINEA})                    AS costo,
      SUM(v.importe) - SUM(${COSTO_LINEA})   AS ganancia
    FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
    ${JOIN_CP}
    LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
      ON a.Art_Codigo = v.producto
    WHERE v.Fecha >= DATEADD(MONTH, -${months}, '${maxDate}')
      AND v.producto IS NOT NULL AND v.producto <> '' AND v.producto <> '0'
    GROUP BY v.producto, a.Art_Descripcion, a.Org_Descripcion
    ORDER BY SUM(v.importe) DESC
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

function buildTicketKPIsQuery({ period = 'day', maxDate = null } = {}) {
  let whereClause;
  // Usar maxDate como ancla si está disponible (consistente con VBasePolizaVentas)
  // Si no hay maxDate (endpoint independiente), usar GETDATE()
  const anchor = maxDate ? `'${maxDate}'` : 'GETDATE()';
  if (period === 'week')       whereClause = `WHERE T_Fecha >= DATEADD(DAY, -7, ${anchor})`;
  else if (period === 'month') whereClause = `WHERE T_Fecha >= DATEADD(DAY, -30, ${anchor})`;
  else                         whereClause = `WHERE CAST(T_Fecha AS DATE) = CAST(${anchor} AS DATE)`;

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
  buildSalesByWeekdayQuery,
  buildSalesByCategoryQuery,
  buildTopProductsPeriodQuery,
  buildRecentTicketsQuery,
  buildTicketKPIsQuery,
  buildDashboardCostQuery,
  buildDashboardCostPolizaQuery,
  buildTopProductsRealtimeQuery,
  // Helpers de costo exacto (para consultas inline en otros módulos)
  COSTO_PZA,
  COSTO_LINEA,
  JOIN_CP,
  JOIN_CP_A,
};
