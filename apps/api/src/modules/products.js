const express  = require('express');
const { getDb } = require('../db');
const mssql    = require('../db/mssql');
const {
  buildProductsQuery,
  buildProductsCountQuery,
  buildProductsConStockQuery,
  buildProductsConStockCountQuery,
} = require('../config/novacaja-mapping');

const DEFAULT_MIN_STOCK = parseInt(process.env.LOW_STOCK_THRESHOLD || '5');

// Colapsa filas repetidas del MISMO Art_Codigo. La vista VArticulosUnificados
// devuelve una fila por GTIN/código alterno, así que un producto con varios códigos
// sale repetido. Nos quedamos con la de mayor stock para no subreportar.
// OJO: NO toca "mismo nombre con código distinto" (eso es catálogo duplicado en
// NovaCaja, no un duplicado de esta consulta).
function dedupById(rows) {
  const m = new Map();
  for (const r of rows) {
    const prev = m.get(r.id);
    if (!prev || (r.stock || 0) > (prev.stock || 0)) m.set(r.id, r);
  }
  return Array.from(m.values());
}

const router = express.Router();

// ── In-memory TTL cache ───────────────────────────────────────────────────────
const _cache = new Map();
const _get = (k) => { const e = _cache.get(k); return e && Date.now() < e.exp ? e.v : null; };
const _set = (k, v, ttlMs) => _cache.set(k, { v, exp: Date.now() + ttlMs });
// Borra toda la caché de productos. Lo usa el PUT de aquí y también el alta de
// productos nuevos (almacen.js) para que el recién dado de alta aparezca ya.
function invalidateProductsCache() {
  for (const k of _cache.keys()) if (k.startsWith('products:')) _cache.delete(k);
}

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
  const { q = '', category = '', page = 1, pageSize = 50, lowStock, sinPrecio, conStock } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(pageSize);
  const soloSinPrecio = sinPrecio === 'true';
  // Modo "con stock" (default del panel, igual que la Bodega TC52): solo productos
  // con stock contado en inventario_bodega, ordenados de mayor a menor. Una BÚSQUEDA
  // o el filtro "sin precio" lo desactivan para poder encontrar/corregir CUALQUIER
  // producto (incluidos los de stock 0).
  const useConStock = conStock === 'true' && !q && !soloSinPrecio && lowStock !== 'true';

  // Cache only the fully unfiltered default page (distinta por modo con-stock/todos)
  const isDefaultPage = !q && !category && lowStock !== 'true' && !soloSinPrecio && parseInt(page) === 1 && parseInt(pageSize) <= 50;
  const cacheKey = isDefaultPage ? `products:default:${useConStock ? 'cs' : 'all'}` : null;
  if (cacheKey) {
    const cached = _get(cacheKey);
    if (cached) return res.json(cached);
  }

  try {
    const overrides = getDb().prepare('SELECT art_codigo, image_url, min_stock, categoria, tipo FROM product_overrides').all();
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
        category:     ov.categoria || r.category || null,   // categoría propia (Excel) sobre la de NovaCaja
        tipo:         ov.tipo || null,                       // tipo propio (cocina/tienda), columna aparte
        unit:         r.unit       || null,
        sku:          r.sku        || null,
        supplierCode: r.supplierCode || null,
        lastPurchase: r.lastPurchase || null,
        lastSale:     r.lastSale     || null,
        image:        ov.image_url   || null,
      };
    };

    // Filtro por categoría/tipo PROPIOS (asignados por Excel): los códigos viven en
    // SQLite; traemos hasta 2000 (sin paginar, como el modo lowStock) desde MSSQL.
    const catLocal  = String(req.query.catLocal  || '').trim();
    const tipoLocal = String(req.query.tipoLocal || '').trim();
    if (catLocal || tipoLocal) {
      let sq = 'SELECT art_codigo FROM product_overrides WHERE 1=1';
      const args = [];
      if (catLocal)  { sq += ' AND categoria = ?'; args.push(catLocal); }
      if (tipoLocal) { sq += ' AND tipo = ?';      args.push(tipoLocal); }
      const codes = getDb().prepare(sq).all(...args).map(x => String(x.art_codigo)).slice(0, 2000);
      if (!codes.length) return res.json({ data: [], total: 0, page: 1, pageSize: 2000, pages: 1 });
      const dataRes = await mssql.query(buildProductsQuery({ search: q, codes, offset: 0, pageSize: 2000 }) + '\n    OPTION (MAXDOP 1)');
      const rowsCat = dedupById(dataRes.recordset.map(toRow));
      return res.json({ data: rowsCat, total: rowsCat.length, page: 1, pageSize: rowsCat.length, pages: 1 });
    }

    let rows, total;

    if (lowStock === 'true') {
      // Se pide en CADA carga del panel (dashboard). Sin filtros la cacheamos 90 s
      // y la corremos con MAXDOP 1 para no acaparar la CPU compartida con NovaCaja.
      const lowKey = (!q && !category) ? 'products:lowstock' : null;
      if (lowKey) {
        const cachedLow = _get(lowKey);
        if (cachedLow) return res.json(cachedLow);
      }
      // Filtrado directo en SQL para no traer 10k productos al servidor
      const dataRes = await mssql.query(
        buildProductsQuery({ search: q, category, offset: 0, pageSize: 2000, lowStockThreshold: DEFAULT_MIN_STOCK }) +
        '\n    OPTION (MAXDOP 1)'
      );
      rows  = dedupById(dataRes.recordset.map(toRow));
      total = rows.length;
      if (lowKey) {
        const lowResult = { data: rows, total, page: 1, pageSize: 2000, pages: 1 };
        _set(lowKey, lowResult, 90_000); // 90 s
        return res.json(lowResult);
      }
    } else if (useConStock) {
      // Solo productos con stock (inventario_bodega), ordenados por stock DESC.
      // Estrategia 2 fases con tabla temporal (~2.8s) para NO tronar como el
      // "ORDER BY stock" sobre los 59k. MAXDOP 1 ya viene dentro de la consulta.
      const [dataRes, countRes] = await Promise.all([
        mssql.query(buildProductsConStockQuery({ search: q, category, offset, pageSize: parseInt(pageSize) })),
        mssql.query(buildProductsConStockCountQuery({ search: q, category })),
      ]);
      rows  = dedupById(dataRes.recordset.map(toRow));
      total = countRes.recordset[0]?.total || 0;
    } else {
      const [dataRes, countRes] = await Promise.all([
        mssql.query(buildProductsQuery({ search: q, category, offset, pageSize: parseInt(pageSize), sinPrecio: soloSinPrecio })),
        mssql.query(buildProductsCountQuery({ search: q, category, sinPrecio: soloSinPrecio })),
      ]);
      rows  = dedupById(dataRes.recordset.map(toRow));
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
  const { stock, salePrice, image, categoria, tipo } = req.body;

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

    if (categoria !== undefined) {
      getDb().prepare(`
        INSERT INTO product_overrides (art_codigo, categoria, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(art_codigo) DO UPDATE SET categoria = excluded.categoria, updated_at = excluded.updated_at
      `).run(String(req.params.id), String(categoria || '').trim() || null);
      updated.push('categoría');
    }

    if (tipo !== undefined) {
      getDb().prepare(`
        INSERT INTO product_overrides (art_codigo, tipo, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(art_codigo) DO UPDATE SET tipo = excluded.tipo, updated_at = excluded.updated_at
      `).run(String(req.params.id), String(tipo || '').trim() || null);
      updated.push('tipo');
    }

    if (updated.length === 0) {
      return res.status(400).json({ error: 'No se enviaron campos para actualizar' });
    }

    // Invalidate product cache so next fetch reflects the change
    invalidateProductsCache();

    res.json({ message: `Actualizado: ${updated.join(', ')}` });
  } catch (err) {
    console.error('Error actualizando producto:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/products/export — TODOS los productos para el Excel de categorías ──
// 1 fila por código: código, nombre, categoría de NovaCaja y la categoría ya asignada
// localmente. El frontend arma el Excel; ella llena/edita "Categoría" y reimporta.
router.get('/export', async (req, res) => {
  try {
    const overrides = getDb().prepare("SELECT art_codigo, categoria, tipo FROM product_overrides").all();
    const ovMap = new Map(overrides.map(o => [String(o.art_codigo), o]));
    const result = await mssql.query(`
      SELECT a.Art_Codigo AS codigo, MAX(a.Art_Descripcion) AS nombre, MAX(a.Org_Descripcion) AS categoria_novacaja
      FROM [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
      WHERE a.Art_Descripcion <> '' AND a.Art_Descripcion IS NOT NULL
      GROUP BY a.Art_Codigo
      ORDER BY MAX(a.Art_Descripcion)
      OPTION (MAXDOP 1)
    `);
    const rows = (result.recordset || []).map(r => {
      const ov = ovMap.get(String(r.codigo)) || {};
      return {
        codigo:             String(r.codigo),
        nombre:             r.nombre,
        categoria_novacaja: r.categoria_novacaja || '',
        categoria:          ov.categoria || '',
        tipo:               ov.tipo || '',
      };
    });
    res.json({ total: rows.length, data: rows });
  } catch (err) {
    console.error('Error export productos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/products/categorias-import — carga masiva de categorías desde Excel ──
// Body: { items: [{ codigo, categoria }] }. Upsert en product_overrides.categoria.
// Categoría vacía = se limpia (el producto vuelve a usar la de NovaCaja).
router.post('/categorias-import', async (req, res) => {
  const items = Array.isArray(req.body && req.body.items) ? req.body.items : null;
  if (!items) return res.status(400).json({ error: 'Se requiere items[]' });
  try {
    const db = getDb();
    const up = db.prepare(`
      INSERT INTO product_overrides (art_codigo, categoria, tipo, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(art_codigo) DO UPDATE SET categoria = excluded.categoria, tipo = excluded.tipo, updated_at = excluded.updated_at
    `);
    let n = 0;
    const tx = db.transaction((list) => {
      for (const it of list) {
        const codigo = String((it && it.codigo) || '').trim();
        if (!codigo) continue;
        const cat = String((it && it.categoria) || '').trim() || null;
        const tp  = String((it && it.tipo) || '').trim() || null;
        up.run(codigo, cat, tp);
        n++;
      }
    });
    tx(items);
    invalidateProductsCache();
    try { require('./novacaja').invalidateAnalyticsCache(); } catch { /* refresca la mezcla por categoría al instante */ }
    res.json({ ok: true, actualizados: n });
  } catch (err) {
    console.error('Error import categorías:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/products/categorias-asignadas — categorías y tipos propios (dropdowns) ──
router.get('/categorias-asignadas', (req, res) => {
  try {
    const cats  = getDb().prepare("SELECT DISTINCT categoria FROM product_overrides WHERE categoria IS NOT NULL AND categoria <> '' ORDER BY categoria").all().map(r => r.categoria);
    const tipos = getDb().prepare("SELECT DISTINCT tipo FROM product_overrides WHERE tipo IS NOT NULL AND tipo <> '' ORDER BY tipo").all().map(r => r.tipo);
    res.json({ categorias: cats, tipos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.invalidateProductsCache = invalidateProductsCache;
