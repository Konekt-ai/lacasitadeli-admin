const express  = require('express');
const { getDb } = require('../db');
const mssql    = require('../db/mssql');
const { buildProductsQuery, buildProductsCountQuery } = require('../config/novacaja-mapping');

const DEFAULT_MIN_STOCK = parseInt(process.env.LOW_STOCK_THRESHOLD || '5');

const router = express.Router();

// ── In-memory TTL cache ───────────────────────────────────────────────────────
const _cache = new Map();
const _get = (k) => { const e = _cache.get(k); return e && Date.now() < e.exp ? e.v : null; };
const _set = (k, v, ttlMs) => _cache.set(k, { v, exp: Date.now() + ttlMs });

// ── GET /api/products/categories — cached 5 min ───────────────────────────────
router.get('/categories', async (req, res) => {
  const cached = _get('categories');
  if (cached) return res.json(cached);
  try {
    const result = await mssql.query(`
      SELECT DISTINCT [Org_Descripcion] AS name
      FROM [compucaja].[dbo].[VArticulosUnificados] WITH (NOLOCK)
      WHERE [Org_Descripcion] IS NOT NULL AND [Org_Descripcion] <> ''
      ORDER BY [Org_Descripcion] ASC
    `);
    const data = result.recordset.map(r => ({ id: r.name, name: r.name }));
    _set('categories', data, 300_000); // 5 min
    res.json(data);
  } catch (err) {
    console.error('Error categorías:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/products — cached 2 min for full list, no cache for search ───────
router.get('/', async (req, res) => {
  const { q = '', category = '', page = 1, pageSize = 50, lowStock } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(pageSize);

  // Cache only the fully unfiltered default page
  const isDefaultPage = !q && !category && lowStock !== 'true' && parseInt(page) === 1 && parseInt(pageSize) <= 50;
  const cacheKey = isDefaultPage ? `products:default` : null;
  if (cacheKey) {
    const cached = _get(cacheKey);
    if (cached) return res.json(cached);
  }

  try {
    const overrides = getDb().prepare('SELECT art_codigo, image_url, min_stock FROM product_overrides').all();
    const overMap   = new Map(overrides.map(o => [String(o.art_codigo), o]));

    const toRow = r => {
      const ov = overMap.get(String(r.id)) || {};
      return {
        id:           String(r.id),
        barcode:      r.barcode    ? String(r.barcode).trim() : null,
        name:         String(r.name || '').trim(),
        alias:        r.alias      ? String(r.alias).trim()   : null,
        costPrice:    parseFloat(r.costPrice)  || 0,
        salePrice:    parseFloat(r.salePrice)  || 0,
        stock:        parseFloat(r.stock)      || 0,
        minStock:     ov.min_stock != null ? ov.min_stock : DEFAULT_MIN_STOCK,
        brand:        r.brand      || null,
        category:     r.category   || null,
        unit:         r.unit       || null,
        sku:          r.sku        || null,
        supplierCode: r.supplierCode || null,
        lastPurchase: r.lastPurchase || null,
        lastSale:     r.lastSale     || null,
        image:        ov.image_url   || null,
      };
    };

    let rows, total;

    if (lowStock === 'true') {
      // Filtrado directo en SQL para no traer 10k productos al servidor
      const dataRes = await mssql.query(
        buildProductsQuery({ search: q, category, offset: 0, pageSize: 2000, lowStockThreshold: DEFAULT_MIN_STOCK })
      );
      rows  = dataRes.recordset.map(toRow);
      total = rows.length;
    } else {
      const [dataRes, countRes] = await Promise.all([
        mssql.query(buildProductsQuery({ search: q, category, offset, pageSize: parseInt(pageSize) })),
        mssql.query(buildProductsCountQuery({ search: q, category })),
      ]);
      rows  = dataRes.recordset.map(toRow);
      total = countRes.recordset[0]?.total || 0;
    }

    const result = {
      data:     rows,
      total,
      page:     parseInt(page),
      pageSize: parseInt(pageSize),
      pages:    Math.ceil(total / parseInt(pageSize)),
    };

    if (cacheKey) _set(cacheKey, result, 120_000); // 2 min — solo primera página sin filtros
    res.json(result);
  } catch (err) {
    console.error('Error productos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/products/:id — updates MSSQL + SQLite, invalidates cache ─────────
router.put('/:id', async (req, res) => {
  const artCodigo = String(req.params.id).replace(/'/g, "''");
  const { stock, salePrice, image } = req.body;

  const updated = [];

  try {
    if (stock !== undefined && stock !== null && !isNaN(parseFloat(stock))) {
      await mssql.query(`
        UPDATE [compucaja].[dbo].[ArticulosAlmacen]
        SET AA_ExistenciaActualU = ${parseFloat(stock)}
        WHERE Art_Codigo = '${artCodigo}'
      `);
      updated.push('stock');
    }

    if (salePrice !== undefined && salePrice !== null && !isNaN(parseFloat(salePrice))) {
      await mssql.query(`
        UPDATE [compucaja].[dbo].[ListaPreciosArt]
        SET LPA_PrecioVentaImp = ${parseFloat(salePrice)}
        WHERE Art_Codigo = '${artCodigo}' AND LP_Codigo = 1
      `);
      updated.push('precio');
    }

    if (image !== undefined) {
      getDb().prepare(`
        INSERT INTO product_overrides (art_codigo, image_url, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(art_codigo) DO UPDATE SET image_url = excluded.image_url, updated_at = excluded.updated_at
      `).run(String(req.params.id), image || null);
      updated.push('imagen');
    }

    if (updated.length === 0) {
      return res.status(400).json({ error: 'No se enviaron campos para actualizar' });
    }

    // Invalidate product cache so next fetch reflects the change
    for (const k of _cache.keys()) {
      if (k.startsWith('products:')) _cache.delete(k);
    }

    res.json({ message: `Actualizado: ${updated.join(', ')}` });
  } catch (err) {
    console.error('Error actualizando producto:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
