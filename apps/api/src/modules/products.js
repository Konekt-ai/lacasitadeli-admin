const express  = require('express');
const { getDb } = require('../db');
const router   = express.Router();

// GET /api/products/categories
router.get('/categories', (req, res) => {
  try {
    const rows = getDb().prepare(`SELECT id, nombre AS name, descripcion AS description FROM categorias WHERE activo=1 ORDER BY nombre`).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products/categories
router.post('/categories', (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
  try {
    const info = getDb().prepare(`INSERT INTO categorias (nombre, descripcion) VALUES (?,?)`).run(name, description || null);
    res.status(201).json({ id: info.lastInsertRowid, name, description: description || null });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe esa categoría' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/products/categories/:id
router.put('/categories/:id', (req, res) => {
  const { name, description } = req.body;
  try {
    getDb().prepare(`UPDATE categorias SET nombre=COALESCE(?,nombre), descripcion=COALESCE(?,descripcion) WHERE id=?`)
      .run(name || null, description || null, req.params.id);
    res.json({ message: 'Categoría actualizada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products — lee directo de novacaja22 (fuente de verdad del POS)
router.get('/', async (req, res) => {
  const { q, lowStock } = req.query;
  const mssql = require('../db/mssql');
  const { buildProductsQuery } = require('../config/novacaja-mapping');
  try {
    const sql    = buildProductsQuery({ search: q || '', limit: 500, lowStock: lowStock === 'true' });
    const result = await mssql.query(sql);
    const rows   = result.recordset.map((r, i) => ({
      id:          i + 1,
      barcode:     r.barcode ? String(r.barcode).trim() : null,
      name:        String(r.name || '').trim(),
      description: null,
      costPrice:   parseFloat(r.costPrice) || 0,
      salePrice:   parseFloat(r.salePrice) || 0,
      stock:       parseFloat(r.stock)     || 0,
      minStock:    5,
      image:       null,
      active:      true,
      visibleWeb:  true,
      category:    null,
      categoryId:  null,
      createdAt:   new Date().toISOString(),
      _novacajaId: String(r.id),
    }));
    res.json(rows);
  } catch (err) {
    console.error('Error al obtener productos de novacaja:', err.message);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
