const express  = require('express');
const { getDb } = require('../db');
const mssql    = require('../db/mssql');
const { buildProductsQuery, buildProductsCountQuery } = require('../config/novacaja-mapping');

const router = express.Router();

// ── GET /api/products/categories ─────────────────────────────────────────────
router.get('/categories', (req, res) => {
  try {
    const rows = getDb()
      .prepare(`SELECT id, nombre AS name, descripcion AS description FROM categorias WHERE activo=1 ORDER BY nombre`)
      .all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/products/categories ────────────────────────────────────────────
router.post('/categories', (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
  try {
    const info = getDb()
      .prepare(`INSERT INTO categorias (nombre, descripcion) VALUES (?,?)`)
      .run(name, description || null);
    res.status(201).json({ id: info.lastInsertRowid, name, description: description || null });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe esa categoría' });
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/products/categories/:id ─────────────────────────────────────────
router.put('/categories/:id', (req, res) => {
  const { name, description } = req.body;
  try {
    getDb()
      .prepare(`UPDATE categorias SET nombre=COALESCE(?,nombre), descripcion=COALESCE(?,descripcion) WHERE id=?`)
      .run(name || null, description || null, req.params.id);
    res.json({ message: 'Categoría actualizada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/products ─────────────────────────────────────────────────────────
// Soporta ?q=busqueda&page=1&pageSize=200&lowStock=true
// Devuelve { data: [...], total, page, pageSize, pages }
router.get('/', async (req, res) => {
  const { q = '', page = 1, pageSize = 200, lowStock } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(pageSize);

  try {
    const [dataRes, countRes] = await Promise.all([
      mssql.query(buildProductsQuery({ search: q, offset, pageSize: parseInt(pageSize) })),
      mssql.query(buildProductsCountQuery({ search: q })),
    ]);

    let rows = dataRes.recordset.map(r => ({
      id:              String(r.id),
      barcode:         r.barcode   ? String(r.barcode).trim() : null,
      name:            String(r.name || '').trim(),
      alias:           r.alias     ? String(r.alias).trim()   : null,
      description:     null,
      costPrice:       parseFloat(r.costPrice)  || 0,
      salePrice:       parseFloat(r.salePrice)  || 0,
      stock:           parseFloat(r.stock)      || 0,
      minStock:        5,
      brand:           r.brand     || null,
      category:        r.category  || null,
      categoryId:      null,
      unit:            r.unit      || null,
      sku:             r.sku       || null,
      supplierCode:    r.supplierCode || null,
      lastPurchase:    r.lastPurchase || null,
      lastSale:        r.lastSale     || null,
      image:           null,
      active:          true,
      visibleWeb:      true,
      createdAt:       new Date().toISOString(),
    }));

    if (lowStock === 'true') {
      rows = rows.filter(r => r.stock <= r.minStock);
    }

    const total = countRes.recordset[0]?.total || 0;

    res.json({
      data:     rows,
      total,
      page:     parseInt(page),
      pageSize: parseInt(pageSize),
      pages:    Math.ceil(total / parseInt(pageSize)),
    });
  } catch (err) {
    console.error('Error productos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;