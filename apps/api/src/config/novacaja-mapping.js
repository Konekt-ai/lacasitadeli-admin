// Mapeo real de novacaja22 — descubierto explorando el schema el 2026-05-19
// Tablas: Articulos + ListaPreciosArt (LP_Codigo=1) + ArticulosAlmacen

function buildProductsQuery({ search = '', limit = 500, lowStock = false } = {}) {
  const whereSearch = search
    ? `AND (a.Art_Descripcion LIKE '%${search.replace(/'/g, "''")}%'
           OR a.Art_GTIN      LIKE '%${search.replace(/'/g, "''")}%'
           OR a.Art_PLU       LIKE '%${search.replace(/'/g, "''")}%')`
    : '';

  const havingLowStock = lowStock
    ? `HAVING SUM(aa.AA_ExistenciaActualU) <= 5`
    : '';

  return `
    SELECT TOP ${limit}
      a.Art_Codigo                  AS id,
      ISNULL(a.Art_GTIN, a.Art_PLU) AS barcode,
      a.Art_Descripcion             AS name,
      a.Art_UltimoCosto             AS costPrice,
      p.LPA_PrecioVentaImp          AS salePrice,
      SUM(aa.AA_ExistenciaActualU)  AS stock
    FROM Articulos a
    LEFT JOIN ListaPreciosArt  p  ON p.Art_Codigo = a.Art_Codigo AND p.LP_Codigo = 1
    LEFT JOIN ArticulosAlmacen aa ON aa.Art_Codigo = a.Art_Codigo
    WHERE a.Art_Bloqueado = 0
      AND a.Art_Descripcion <> ''
      ${whereSearch}
    GROUP BY
      a.Art_Codigo, a.Art_GTIN, a.Art_PLU,
      a.Art_Descripcion, a.Art_UltimoCosto,
      p.LPA_PrecioVentaImp
    ${havingLowStock}
    ORDER BY a.Art_Descripcion
  `;
}

module.exports = { buildProductsQuery };
