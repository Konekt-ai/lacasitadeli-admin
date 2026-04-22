const express = require('express');
const db = require('../db');
const router = express.Router();

// ─── CATEGORIAS ────────────────────────────────────────────────────────────────

// GET /api/products/categories
router.get('/categories', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, nombre AS name, descripcion AS description, activo AS active
       FROM categorias
       WHERE activo = TRUE
       ORDER BY nombre`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener categorías:', err.message);
    res.status(500).json({ error: 'Error al obtener categorías' });
  }
});

// POST /api/products/categories
router.post('/categories', async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
  try {
    const result = await db.query(
      `INSERT INTO categorias (nombre, descripcion)
       VALUES ($1, $2)
       RETURNING id, nombre AS name, descripcion AS description`,
      [name, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al crear categoría:', err.message);
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    res.status(500).json({ error: 'Error al crear categoría' });
  }
});

// PUT /api/products/categories/:id
router.put('/categories/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, active } = req.body;
  try {
    await db.query(
      `UPDATE categorias
       SET nombre      = COALESCE($1, nombre),
           descripcion = COALESCE($2, descripcion),
           activo      = COALESCE($3, activo)
       WHERE id = $4`,
      [name || null, description || null, active ?? null, id]
    );
    res.json({ message: 'Categoría actualizada' });
  } catch (err) {
    console.error('Error al actualizar categoría:', err.message);
    res.status(500).json({ error: 'Error al actualizar categoría' });
  }
});

// ─── PRODUCTOS ─────────────────────────────────────────────────────────────────

// GET /api/products  — búsqueda con filtros opcionales
router.get('/', async (req, res) => {
  const { q, categoryId, lowStock } = req.query;

  let sql = `
    SELECT
      p.id,
      p.codigo_barras  AS barcode,
      p.nombre         AS name,
      p.descripcion    AS description,
      p.precio_compra  AS "costPrice",
      p.precio_venta   AS "salePrice",
      p.stock_actual   AS stock,
      p.stock_minimo   AS "minStock",
      p.imagen_url     AS image,
      p.activo         AS active,
      p.visible_web    AS "visibleWeb",
      p.created_at     AS "createdAt",
      p.updated_at     AS "updatedAt",
      c.nombre         AS category,
      c.id             AS "categoryId"
    FROM productos p
    LEFT JOIN categorias c ON c.id = p.categoria_id
    WHERE p.activo = TRUE
  `;
  const params = [];

  if (q) {
    params.push(`%${q}%`);
    sql += ` AND (p.nombre ILIKE $${params.length} OR p.codigo_barras ILIKE $${params.length})`;
  }
  if (categoryId) {
    params.push(Number(categoryId));
    sql += ` AND p.categoria_id = $${params.length}`;
  }
  if (lowStock === 'true') {
    sql += ` AND p.stock_actual <= p.stock_minimo`;
  }

  sql += ` ORDER BY p.nombre ASC`;

  try {
    const result = await db.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener productos:', err.message);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT
        p.id,
        p.codigo_barras  AS barcode,
        p.nombre         AS name,
        p.descripcion    AS description,
        p.precio_compra  AS "costPrice",
        p.precio_venta   AS "salePrice",
        p.stock_actual   AS stock,
        p.stock_minimo   AS "minStock",
        p.imagen_url     AS image,
        p.activo         AS active,
        p.visible_web    AS "visibleWeb",
        p.created_at     AS "createdAt",
        p.updated_at     AS "updatedAt",
        c.nombre         AS category,
        c.id             AS "categoryId"
       FROM productos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
       WHERE p.id = $1`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al obtener producto:', err.message);
    res.status(500).json({ error: 'Error al obtener producto' });
  }
});

// POST /api/products  — crear nuevo producto
router.post('/', async (req, res) => {
  const {
    barcode, name, description, salePrice, costPrice,
    stock, minStock, categoryId, image, visibleWeb,
  } = req.body;

  if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
  if (!salePrice) return res.status(400).json({ error: 'El precio de venta es requerido' });

  try {
    const result = await db.query(
      `INSERT INTO productos
         (codigo_barras, nombre, descripcion, precio_venta, precio_compra,
          stock_actual, stock_minimo, categoria_id, imagen_url, visible_web)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, nombre AS name, precio_venta AS "salePrice", stock_actual AS stock`,
      [
        barcode || null,
        name,
        description || null,
        parseFloat(salePrice),
        parseFloat(costPrice) || 0,
        parseInt(stock) || 0,
        parseInt(minStock) || 5,
        categoryId ? parseInt(categoryId) : null,
        image || null,
        visibleWeb !== false,
      ]
    );
    res.status(201).json({ message: 'Producto creado exitosamente', ...result.rows[0] });
  } catch (err) {
    console.error('Error al crear producto:', err.message);
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un producto con ese código de barras' });
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

// PUT /api/products/:id  — actualizar producto
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    barcode, name, description, salePrice, costPrice,
    stock, minStock, categoryId, image, visibleWeb,
  } = req.body;

  try {
    await db.query(
      `UPDATE productos SET
        codigo_barras = COALESCE($1,  codigo_barras),
        nombre        = COALESCE($2,  nombre),
        descripcion   = COALESCE($3,  descripcion),
        precio_venta  = COALESCE($4,  precio_venta),
        precio_compra = COALESCE($5,  precio_compra),
        stock_actual  = COALESCE($6,  stock_actual),
        stock_minimo  = COALESCE($7,  stock_minimo),
        categoria_id  = COALESCE($8,  categoria_id),
        imagen_url    = COALESCE($9,  imagen_url),
        visible_web   = COALESCE($10, visible_web)
       WHERE id = $11`,
      [
        barcode   !== undefined ? (barcode || null)              : null,
        name      !== undefined ? name                           : null,
        description !== undefined ? (description || null)       : null,
        salePrice !== undefined ? parseFloat(salePrice)         : null,
        costPrice !== undefined ? parseFloat(costPrice)         : null,
        stock     !== undefined ? parseInt(stock)               : null,
        minStock  !== undefined ? parseInt(minStock)            : null,
        categoryId !== undefined ? (categoryId ? parseInt(categoryId) : null) : null,
        image     !== undefined ? (image || null)               : null,
        visibleWeb !== undefined ? visibleWeb                   : null,
        id,
      ]
    );
    res.json({ message: 'Producto actualizado exitosamente' });
  } catch (err) {
    console.error('Error al actualizar producto:', err.message);
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un producto con ese código de barras' });
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

// PATCH /api/products/:id/stock  — ajuste rápido de stock
router.patch('/:id/stock', async (req, res) => {
  const { id } = req.params;
  const { quantity, motivo } = req.body; // quantity puede ser positivo o negativo
  if (quantity === undefined) return res.status(400).json({ error: 'quantity es requerido' });

  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');

    const prev = await client.query(
      `SELECT stock_actual FROM productos WHERE id = $1 FOR UPDATE`, [id]
    );
    if (!prev.rows.length) throw new Error('Producto no encontrado');

    const stockAntes = parseInt(prev.rows[0].stock_actual);
    const stockDespues = stockAntes + parseInt(quantity);
    if (stockDespues < 0) throw new Error('Stock insuficiente');

    await client.query(
      `UPDATE productos SET stock_actual = $1 WHERE id = $2`, [stockDespues, id]
    );
    await client.query(
      `INSERT INTO movimientos_inventario
         (producto_id, tipo, cantidad, stock_antes, stock_despues, motivo)
       VALUES ($1, 'ajuste', $2, $3, $4, $5)`,
      [id, parseInt(quantity), stockAntes, stockDespues, motivo || 'Ajuste manual']
    );

    await client.query('COMMIT');
    res.json({ message: 'Stock actualizado', stockAntes, stockDespues });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al ajustar stock:', err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/products/:id  — soft delete
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `UPDATE productos SET activo = FALSE WHERE id = $1 RETURNING id`, [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ message: 'Producto eliminado' });
  } catch (err) {
    console.error('Error al eliminar producto:', err.message);
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// GET /api/products/stats/low-stock  — productos bajo mínimo
router.get('/stats/low-stock', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         id, nombre AS name, codigo_barras AS barcode,
         stock_actual AS stock, stock_minimo AS "minStock",
         (stock_minimo - stock_actual) AS faltantes,
         precio_venta AS "salePrice"
       FROM productos
       WHERE activo = TRUE AND stock_actual <= stock_minimo
       ORDER BY (stock_minimo - stock_actual) DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener bajo stock:', err.message);
    res.status(500).json({ error: 'Error al obtener bajo stock' });
  }
});

module.exports = router;