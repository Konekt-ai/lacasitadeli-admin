/**
 * Mapeo de tablas y columnas de novacaja22 al panel admin.
 *
 * COMO CONFIGURAR:
 * 1. Inicia la API y llama: GET http://localhost:3002/api/novacaja/tables
 *    para ver todas las tablas disponibles en novacaja22.
 * 2. Luego llama: GET http://localhost:3002/api/novacaja/tables/NombreTabla/columns
 *    para ver las columnas de la tabla de productos.
 * 3. Actualiza los valores abajo según los nombres reales.
 */

module.exports = {
  products: {
    table:    process.env.NOVACAJA_TABLE_PRODUCTOS  || 'Articulos',
    id:       process.env.NOVACAJA_COL_ID           || 'Clave',
    barcode:  process.env.NOVACAJA_COL_BARCODE      || 'CodigoBarras',
    name:     process.env.NOVACAJA_COL_NAME         || 'Descripcion',
    salePrice: process.env.NOVACAJA_COL_PRICE       || 'Precio1',
    costPrice: process.env.NOVACAJA_COL_COST        || 'PrecioCosto',
    stock:    process.env.NOVACAJA_COL_STOCK        || 'Existencia',
    minStock: process.env.NOVACAJA_COL_MIN_STOCK    || null,
    category: process.env.NOVACAJA_COL_CATEGORY     || 'Departamento',
    active:   process.env.NOVACAJA_COL_ACTIVE       || null, // null = sin filtro activo
  },
};
