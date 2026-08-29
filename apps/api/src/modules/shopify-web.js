// ============================================================================
// shopify-web.js — Backend del panel "Página web": qué productos del inventario
// están (o faltan) en la tienda en línea de Shopify, y edición directa desde el
// panel: subir foto, corregir título/descripción/precio y publicar.
//
//  - El catálogo de Shopify se cachea en memoria (TTL corto) para no pegarle al
//    API en cada carga; cualquier edición invalida el caché.
//  - El stock mostrado = suma de inventario_bodega en las áreas del sync
//    (Casita 1 + Casita 2 + Bodega), igual que lo que empuja shopify-sync.
//  - "Falta en la página" = códigos con stock en bodega que NO existen como
//    barcode en Shopify; se pueden CREAR como borrador con datos de NovaCaja.
// ============================================================================
const express = require('express');
const mssql   = require('../db/mssql');
const { getDb } = require('../db');
const shopify = require('./shopify-api');
const { invalidateProductsCache } = require('./products');

const router = express.Router();
const { LOCATION_ID, apiUrl, shopifyFetch, configurado } = shopify;

const AREAS = (process.env.SHOPIFY_SYNC_AREAS || 'Casita 1,Casita 2,Bodega')
  .split(',').map(s => s.trim()).filter(Boolean);
const CACHE_MIN = Math.max(1, parseInt(process.env.SHOPIFY_WEB_CACHE_MIN || '10'));

// ── Caché del catálogo Shopify ────────────────────────────────────────────────
let catalogo = null;      // [{id, title, handle, status, image, price, barcode, variantId, inventoryItemId, qtyShopify, variantes}]
let barcodesShopify = new Set(); // TODOS los barcodes (incluidas variantes 2+), para no crear duplicados
let catalogoFecha = 0;
let cargando = null;      // promesa en vuelo para no duplicar descargas

async function getCatalogo(forzar = false) {
  if (!forzar && catalogo && Date.now() - catalogoFecha < CACHE_MIN * 60 * 1000) return catalogo;
  if (cargando) return cargando;
  cargando = (async () => {
    // finally: si la descarga FALLA, la promesa rechazada NO se queda cacheada
    // (sin esto, un fallo de red dejaba el panel muerto hasta reiniciar el API)
    try {
      const crudos = await shopify.listarProductos('id,title,handle,status,image,variants');
      const bcs = new Set();
      catalogo = crudos.map(p => {
        const v = (p.variants || [])[0] || {};
        for (const vv of p.variants || []) {
          const b = (vv.barcode || '').trim();
          if (b) bcs.add(b);
        }
        return {
          id: p.id,
          title: p.title,
          handle: p.handle,
          status: p.status,
          image: p.image ? p.image.src : null,
          price: v.price != null ? parseFloat(v.price) : null,
          barcode: (v.barcode || '').trim() || null,
          variantId: v.id || null,
          inventoryItemId: v.inventory_item_id || null,
          qtyShopify: v.inventory_quantity != null ? v.inventory_quantity : null,
          variantes: (p.variants || []).length,
        };
      });
      barcodesShopify = bcs;
      catalogoFecha = Date.now();
      return catalogo;
    } finally {
      cargando = null;
    }
  })();
  return cargando;
}
const invalidarCache = () => { catalogoFecha = 0; };

// Tras una edición NO tiramos el caché completo (re-descargar 6 mil productos
// tarda ~15 s y compite con el sync): parchamos el registro en memoria.
function parcharCache(id, cambios) {
  if (!catalogo) return;
  const p = catalogo.find(x => x.id === Number(id));
  if (p) Object.assign(p, cambios);
}

// ── Stock de bodega (memo de 60 s) ────────────────────────────────────────────
let stockMemo = { fecha: 0, mapa: null };
async function getStockBodega() {
  if (stockMemo.mapa && Date.now() - stockMemo.fecha < 60 * 1000) return stockMemo.mapa;
  const enList = AREAS.map(a => `'${a.replace(/'/g, "''")}'`).join(',');
  const r = await mssql.query(`
    SELECT codigo_barras AS codigo, MAX(nombre) AS nombre, SUM(cantidad) AS qty
    FROM [compucaja].[dbo].[inventario_bodega] WITH (NOLOCK)
    WHERE ubicacion IN (${enList})
    GROUP BY codigo_barras
    OPTION (MAXDOP 1)
  `);
  const m = new Map();
  for (const row of r.recordset || []) {
    const c = String(row.codigo || '').trim();
    if (c) m.set(c, { qty: Math.max(0, row.qty || 0), nombre: row.nombre || '' });
  }
  stockMemo = { fecha: Date.now(), mapa: m };
  return m;
}

function faltantesDe(p, stock) {
  const f = [];
  if (!p.image) f.push('sin_foto');
  if (!p.price) f.push('sin_precio');
  if (!p.barcode) f.push('sin_codigo');
  if (p.status === 'draft') f.push('borrador');
  if (p.status === 'archived') f.push('archivado');
  if (p.barcode && stock && !stock.has(p.barcode)) f.push('sin_conteo_bodega');
  return f;
}

// Todas las rutas requieren credenciales configuradas (mensaje claro en vez de
// un error críptico de DNS con el .env incompleto)
router.use((req, res, next) => {
  if (!configurado()) return res.status(400).json({ error: 'Faltan credenciales de Shopify en .env' });
  next();
});

// ── Resumen (tarjetas KPI del panel) ──────────────────────────────────────────
router.get('/resumen', async (req, res) => {
  try {
    const [cat, stock] = [await getCatalogo(), await getStockBodega()];
    const activos = cat.filter(p => p.status === 'active');
    let faltaPagina = 0;
    for (const [codigo, s] of stock) if (s.qty > 0 && !barcodesShopify.has(codigo)) faltaPagina++;
    res.json({
      total: cat.length,
      activos: activos.length,
      borradores: cat.filter(p => p.status === 'draft').length,
      archivados: cat.filter(p => p.status === 'archived').length,
      sin_foto: activos.filter(p => !p.image).length,
      sin_precio: activos.filter(p => !p.price).length,
      sin_codigo: cat.filter(p => !p.barcode).length,
      con_stock_bodega: cat.filter(p => {
        const s = p.barcode ? stock.get(p.barcode) : null;
        return s && s.qty > 0;
      }).length,
      falta_pagina: faltaPagina,
      cache_min: CACHE_MIN,
      actualizado: new Date(catalogoFecha).toISOString(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Lista principal ───────────────────────────────────────────────────────────
// vista=en_pagina (default): productos de Shopify + stock bodega + qué les falta
// vista=falta_pagina: códigos con stock en bodega que no existen en Shopify
// filtro: sin_foto | sin_precio | borrador | archivado | sin_codigo | completos
router.get('/productos', async (req, res) => {
  try {
    const vista   = req.query.vista || 'en_pagina';
    const buscar  = (req.query.buscar || '').toLowerCase().trim();
    const filtro  = req.query.filtro || '';
    const pagina  = Math.max(1, parseInt(req.query.pagina) || 1);
    const porPag  = Math.min(100, Math.max(10, parseInt(req.query.porPagina) || 50));
    const [cat, stock] = [await getCatalogo(), await getStockBodega()];

    let lista;
    if (vista === 'falta_pagina') {
      lista = [];
      for (const [codigo, s] of stock) {
        if (s.qty <= 0 || barcodesShopify.has(codigo)) continue;
        lista.push({ codigo, nombre: s.nombre, stock: s.qty });
      }
      lista.sort((a, b) => b.stock - a.stock);
      if (buscar) lista = lista.filter(x => x.nombre.toLowerCase().includes(buscar) || x.codigo.includes(buscar));
      // precios de venta de NovaCaja SOLO para la página que se va a mostrar
      // (después de ordenar/filtrar: consulta chiquita y siempre correcta)
      const visibles = lista.slice((pagina - 1) * porPag, pagina * porPag);
      if (visibles.length) {
        const codes = visibles.map(x => `'${x.codigo.replace(/'/g, "''")}'`).join(',');
        const precios = await mssql.query(`
          SELECT Art_Codigo AS codigo, LPA_PrecioVentaImp AS precio
          FROM [compucaja].[dbo].[ListaPreciosArt] WITH (NOLOCK)
          WHERE LP_Codigo = 1 AND Art_Codigo IN (${codes})
          OPTION (MAXDOP 1)
        `);
        const pm = new Map((precios.recordset || []).map(r => [String(r.codigo).trim(), r.precio]));
        for (const x of visibles) x.precio = pm.get(x.codigo) || null;
      }
    } else {
      lista = cat.map(p => {
        const s = p.barcode ? stock.get(p.barcode) : null;
        return { ...p, stock_bodega: s ? s.qty : null, faltantes: faltantesDe(p, stock) };
      });
      if (buscar) lista = lista.filter(p => p.title.toLowerCase().includes(buscar) || (p.barcode || '').includes(buscar));
      if (filtro === 'completos') lista = lista.filter(p => p.status === 'active' && !p.faltantes.length);
      else if (filtro) lista = lista.filter(p => p.faltantes.includes(filtro));
      // primero los que más venden sentido tienen arreglar: activos con faltantes y stock
      lista.sort((a, b) => (b.stock_bodega || 0) - (a.stock_bodega || 0));
    }

    const total = lista.length;
    res.json({ total, pagina, porPagina: porPag, productos: lista.slice((pagina - 1) * porPag, pagina * porPag) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Detalle de un producto (con descripción e imágenes completas) ─────────────
router.get('/producto/:id', async (req, res) => {
  try {
    const r = await shopifyFetch(apiUrl(`products/${parseInt(req.params.id)}.json`));
    if (!r.ok) return res.status(r.status).json({ error: `Shopify contestó ${r.status}` });
    const { product } = await r.json();
    res.json({
      id: product.id, title: product.title, status: product.status, handle: product.handle,
      descripcion: product.body_html || '',
      imagenes: (product.images || []).map(i => ({ id: i.id, src: i.src })),
      variantes: (product.variants || []).map(v => ({ id: v.id, option1: v.option1, price: v.price, barcode: v.barcode, qty: v.inventory_quantity })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Subir foto ────────────────────────────────────────────────────────────────
// El panel manda el ARCHIVO directo como body (express.raw, patrón de
// facturas.js /leer-pdf) — sin base64 en JSON para no pelear con el límite
// global de 100kb. Nombre del archivo va en ?filename=.
router.post('/producto/:id/foto',
  express.raw({ type: ['image/*', 'application/octet-stream'], limit: '15mb' }),
  async (req, res) => {
  try {
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'Manda la imagen como body (Content-Type: image/*)' });
    const image = {
      attachment: req.body.toString('base64'), // req.body ya es Buffer (express.raw)
      filename: String(req.query.filename || 'foto.jpg'),
    };
    const r = await shopifyFetch(apiUrl(`products/${parseInt(req.params.id)}/images.json`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: `Shopify contestó ${r.status}`, detalle: JSON.stringify(body.errors || body).slice(0, 300) });
    if (body.image && body.image.src) parcharCache(req.params.id, { image: body.image.src });
    // Refleja la misma foto en el panel de Inventario (product_overrides por
    // art_codigo = barcode) para no capturarla dos veces.
    try {
      const barcode = String(req.query.barcode || '').trim();
      if (barcode && body.image && body.image.src) {
        getDb().prepare(`
          INSERT INTO product_overrides (art_codigo, image_url, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(art_codigo) DO UPDATE SET image_url = excluded.image_url, updated_at = datetime('now')
        `).run(barcode, body.image.src);
        invalidateProductsCache();
      }
    } catch (e) { console.error('[shopify-web] override imagen falló:', e.message); }
    res.json({ ok: true, imagen: body.image ? { id: body.image.id, src: body.image.src } : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Borrar una foto ───────────────────────────────────────────────────────────
router.delete('/producto/:id/foto/:imageId', async (req, res) => {
  try {
    const r = await shopifyFetch(apiUrl(`products/${parseInt(req.params.id)}/images/${parseInt(req.params.imageId)}.json`), { method: 'DELETE' });
    if (!r.ok) return res.status(r.status).json({ error: `Shopify contestó ${r.status}` });
    invalidarCache();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Editar producto: título, descripción, status (publicar/borrador), precio ──
router.put('/producto/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { title, descripcion, status, precio, variantId } = req.body || {};
    const product = { id };
    if (title != null) product.title = String(title);
    if (descripcion != null) product.body_html = String(descripcion);
    if (status != null) {
      if (!['active', 'draft', 'archived'].includes(status)) return res.status(400).json({ error: 'status inválido' });
      product.status = status;
    }
    if (Object.keys(product).length > 1) {
      const r = await shopifyFetch(apiUrl(`products/${id}.json`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product }),
      });
      if (!r.ok) return res.status(r.status).json({ error: `Shopify contestó ${r.status}` });
    }
    if (precio != null && variantId) {
      const r = await shopifyFetch(apiUrl(`variants/${parseInt(variantId)}.json`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant: { id: parseInt(variantId), price: String(precio) } }),
      });
      if (!r.ok) return res.status(r.status).json({ error: `Precio: Shopify contestó ${r.status}` });
    }
    const cambios = {};
    if (title != null) cambios.title = String(title);
    if (status != null) cambios.status = status;
    if (precio != null) cambios.price = parseFloat(precio) || 0;
    parcharCache(id, cambios);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Crear en Shopify (BORRADOR) un producto que existe en el inventario ───────
router.post('/crear', async (req, res) => {
  try {
    const codigo = String((req.body || {}).codigo || '').trim();
    if (!codigo) return res.status(400).json({ error: 'Falta "codigo"' });
    await getCatalogo();
    if (barcodesShopify.has(codigo)) return res.status(409).json({ error: 'Ese código ya existe en Shopify' });
    // Doble candado EN VIVO (el caché puede tener hasta 10 min): pregunta a
    // Shopify por ese barcode exacto antes de crear, para no duplicar productos.
    if (await shopify.existeBarcode(codigo)) {
      barcodesShopify.add(codigo);
      return res.status(409).json({ error: 'Ese código ya existe en Shopify (verificado en vivo)' });
    }

    // Datos de NovaCaja: nombre y precio de venta
    const info = await mssql.query(`
      SELECT TOP 1 a.Art_Descripcion AS nombre, p.LPA_PrecioVentaImp AS precio
      FROM [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK)
      LEFT JOIN [compucaja].[dbo].[ListaPreciosArt] p WITH (NOLOCK)
        ON p.Art_Codigo = a.Art_Codigo AND p.LP_Codigo = 1
      WHERE a.Art_Codigo = @codigo
      OPTION (MAXDOP 1)
    `, { codigo });
    const row = (info.recordset || [])[0];
    const stock = await getStockBodega();
    const s = stock.get(codigo);
    const nombreCrudo = (row && row.nombre) || (s && s.nombre) || codigo;
    // MAYÚSCULAS de NovaCaja -> Título Legible (el cliente lo pule en el panel)
    const titulo = nombreCrudo.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()).trim();

    const r = await shopifyFetch(apiUrl('products.json'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: {
          title: titulo,
          status: 'draft',
          variants: [{
            barcode: codigo,
            price: row && row.precio ? String(row.precio) : '0.00',
            inventory_management: 'shopify',
          }],
        },
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: `Shopify contestó ${r.status}`, detalle: JSON.stringify(body.errors || body).slice(0, 300) });

    // Empuja el stock actual de bodega al nuevo producto
    const item = body.product && body.product.variants && body.product.variants[0];
    if (item && item.inventory_item_id && s) {
      await shopifyFetch(apiUrl('inventory_levels/set.json'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id: parseInt(LOCATION_ID), inventory_item_id: item.inventory_item_id, available: s.qty }),
      }).catch(() => {});
    }
    // Agrega el producto nuevo al caché en memoria (sin re-descargar todo)
    barcodesShopify.add(codigo);
    if (catalogo) catalogo.push({
      id: body.product.id, title: body.product.title, handle: body.product.handle,
      status: body.product.status, image: null,
      price: item && item.price != null ? parseFloat(item.price) : null,
      barcode: codigo, variantId: item ? item.id : null,
      inventoryItemId: item ? item.inventory_item_id : null,
      qtyShopify: s ? s.qty : 0, variantes: 1,
    });
    res.json({ ok: true, id: body.product.id, title: body.product.title, status: body.product.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Refrescar caché a mano ────────────────────────────────────────────────────
router.post('/refrescar', async (req, res) => {
  try {
    invalidarCache();
    const cat = await getCatalogo(true);
    res.json({ ok: true, productos: cat.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router };
