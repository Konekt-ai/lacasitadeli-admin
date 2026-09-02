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

// Las áreas que cuentan para la web las manda shopify-sync (config editable).
const { getAreas } = require('./shopify-sync');
const CACHE_MIN = Math.max(1, parseInt(process.env.SHOPIFY_WEB_CACHE_MIN || '10'));
const FOTOS_HORAS = Math.max(1, parseInt(process.env.SHOPIFY_FOTOS_HORAS || '12'));

// ── Caché del catálogo Shopify ────────────────────────────────────────────────
let catalogo = null;      // [{id, title, handle, status, image, price, barcode, variantId, inventoryItemId, qtyShopify, variantes}]
let barcodesShopify = new Set(); // TODOS los barcodes (incluidas variantes 2+), para no crear duplicados
let fotoPorBarcode = new Map();  // barcode -> foto del producto (sirve para TODAS sus variantes)
let sinFotoEnPagina = 0;         // variantes con código pero cuyo producto no tiene foto
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
      const fotos = new Map();
      let sinFoto = 0;
      catalogo = crudos.map(p => {
        const v = (p.variants || [])[0] || {};
        const foto = p.image ? p.image.src : null;
        for (const vv of p.variants || []) {
          const b = (vv.barcode || '').trim();
          if (!b) continue;
          bcs.add(b);
          if (foto) fotos.set(b, foto); else sinFoto++;
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
      fotoPorBarcode = fotos;
      sinFotoEnPagina = sinFoto;
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
  const areas = await getAreas();
  const enList = areas.map(a => `'${a.replace(/'/g, "''")}'`).join(',');
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
    // REGLA DE ORO de estos números: cada tarjeta debe dar EXACTAMENTE el mismo
    // total que la lista al hacerle clic (mismo predicado que el filtro de
    // /productos). Los archivados no cuentan en los pendientes (son producto
    // retirado a propósito, no "trabajo por hacer").
    const noArchivados = cat.filter(p => p.status !== 'archived');
    let faltaPagina = 0;
    for (const [codigo, s] of stock) if (s.qty > 0 && !barcodesShopify.has(codigo)) faltaPagina++;
    res.json({
      total: cat.length,
      activos: cat.filter(p => p.status === 'active').length,
      borradores: cat.filter(p => p.status === 'draft').length,
      archivados: cat.filter(p => p.status === 'archived').length,
      sin_foto: noArchivados.filter(p => !p.image).length,
      sin_precio: noArchivados.filter(p => !p.price).length,
      sin_codigo: noArchivados.filter(p => !p.barcode).length,
      con_stock_bodega: noArchivados.filter(p => {
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
      // Mismos predicados que las tarjetas del resumen (tarjeta = lista)
      if (filtro === 'completos') lista = lista.filter(p => p.status === 'active' && !p.faltantes.length);
      else if (filtro === 'publicado') lista = lista.filter(p => p.status === 'active');
      else if (filtro === 'archivado') lista = lista.filter(p => p.status === 'archived');
      else if (filtro === 'con_stock') lista = lista.filter(p => p.status !== 'archived' && (p.stock_bodega || 0) > 0);
      else if (filtro) lista = lista.filter(p => p.status !== 'archived' && p.faltantes.includes(filtro));
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

// ============================================================================
// FOTOS: las imágenes que ya están en la página se copian al Inventario del
// panel (product_overrides.image_url por art_codigo), para no volver a
// capturarlas. La foto vive en el CDN de Shopify; aquí solo se guarda la liga.
// Respeta las fotos puestas a mano: solo pisa las vacías o las que ya venían
// del propio Shopify.
// ============================================================================
function migrarFotos() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS fotos_sync_estado (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      ultima_sync TEXT, resumen TEXT, pegadas INTEGER DEFAULT 0
    );
    INSERT OR IGNORE INTO fotos_sync_estado (id) VALUES (1);
  `);
}

// barcode -> Art_Codigo real del catálogo (los overrides van por Art_Codigo).
// OJO: la tabla temporal lleva COLLATE DATABASE_DEFAULT porque tempdb usa otra
// colación (SQL_Latin1) que la base (Modern_Spanish) y el JOIN truena sin eso.
// En esta instalación el barcode ES el Art_Codigo casi siempre; para los demás
// se resuelve por GTIN/código alterno con una tabla temporal (rápido y liviano).
// DOS FASES a propósito: el OR sobre GTIN/CodAlt/PLU recorre la vista de 59 mil
// artículos y tarda MINUTOS (le pega duro a la caja). En esta tienda el código de
// barras ES el Art_Codigo en casi todos, así que primero se resuelve con un JOIN
// directo (búsqueda por índice, segundos) y el OR se corre SOLO con los pocos que
// sobran. Pasó de ~250 s a unos cuantos.
// Se resuelve TODO en UN solo batch (una conexión, una pasada por la vista). Antes
// iba en lotes y cada lote volvía a evaluar los 59 mil artículos: 94 s. Y lo ya
// resuelto se guarda en memoria, así las corridas siguientes casi no tocan la caja.
const artCache = new Map(); // barcode -> Art_Codigo (o el mismo código si no está en NovaCaja)
async function resolverArtCodigos(codigos) {
  const mapa = new Map();
  const faltan = [];
  for (const c of codigos) {
    const cache = artCache.get(c);
    if (cache !== undefined) { if (cache) mapa.set(c, cache); }
    else faltan.push(c);
  }
  if (!faltan.length) return mapa;

  // INSERT ... VALUES admite máximo 1000 renglones: se parte en varios INSERT,
  // pero el JOIN corre UNA sola vez (chunkear el JOIN costaba 20 s por lote).
  const insertsDe = lista => {
    const out = [];
    for (let i = 0; i < lista.length; i += 900) {
      out.push(`INSERT INTO #cods (codigo) VALUES ${lista.slice(i, i + 900).map(c => `('${String(c).replace(/'/g, "''")}')`).join(',')};`);
    }
    return out.join('\n    ');
  };
  // El OR sobre GTIN/alterno recorre los 59 mil artículos y se pasa del minuto:
  // por eso el batch lleva su propio timeout amplio.
  const correr = async (lista, joinOn) => {
    const pool = await mssql.getPool();
    const req = pool.request();
    req.timeout = 240000;
    const r = await req.batch(`
      SET NOCOUNT ON;
      IF OBJECT_ID('tempdb..#cods') IS NOT NULL DROP TABLE #cods;
      CREATE TABLE #cods (codigo VARCHAR(50) COLLATE DATABASE_DEFAULT PRIMARY KEY);
      ${insertsDe(lista)}
      SELECT c.codigo, MIN(a.Art_Codigo) AS art
      FROM #cods c
      JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK) ON ${joinOn}
      GROUP BY c.codigo
      OPTION (MAXDOP 1);
      DROP TABLE #cods;`);
    const rows = (r.recordsets && r.recordsets.length ? r.recordsets[r.recordsets.length - 1] : r.recordset) || [];
    const vistos = new Set();
    for (const row of rows) {
      if (!row.art) continue;
      const c = String(row.codigo).trim(), art = String(row.art).trim();
      mapa.set(c, art); artCache.set(c, art); vistos.add(c);
    }
    return lista.filter(c => !vistos.has(c));
  };

  // Fase 1: por Art_Codigo (búsqueda por índice). Aquí cae casi todo.
  const sobran = await correr(faltan, 'a.Art_Codigo = c.codigo');
  // Fase 2: solo los que sobraron, por código alterno/GTIN (caro, pero son pocos)
  if (sobran.length && sobran.length <= 1500) {
    console.log(`[shopify-web] Fotos: ${sobran.length} códigos se buscan por código alterno`);
    const nada = await correr(sobran, '(a.Art_GTIN = c.codigo OR a.CodAlt_Codigo = c.codigo)');
    for (const c of nada) artCache.set(c, null); // no existe en NovaCaja: no volver a buscarlo
  } else if (sobran.length) {
    console.log(`[shopify-web] Fotos: ${sobran.length} códigos sin match directo (se omite la búsqueda alterna por ser demasiados)`);
  }
  return mapa;
}

let fotosCorriendo = false;
async function sincronizarFotos() {
  if (fotosCorriendo) return { skip: 'ya hay una sincronización de fotos corriendo' };
  fotosCorriendo = true;
  const inicio = Date.now();
  try {
    migrarFotos();
    // Reusa el catálogo que el panel ya tiene en memoria (getCatalogo arma el mapa
    // barcode -> foto al cargarlo). Así esto NO vuelve a descargar 6 mil productos
    // ni gasta llamadas al API: con el caché caliente tarda segundos.
    await getCatalogo();
    const porCodigo = new Map(fotoPorBarcode); // barcode -> url de la foto
    const sinFoto = sinFotoEnPagina;
    // barcode -> Art_Codigo (para los que no son idénticos)
    const artPorCodigo = await resolverArtCodigos([...porCodigo.keys()]);

    const db = getDb();
    const previos = new Map(db.prepare(`SELECT art_codigo, image_url FROM product_overrides`).all()
      .map(r => [String(r.art_codigo).trim(), r.image_url || '']));
    const upsert = db.prepare(`
      INSERT INTO product_overrides (art_codigo, image_url, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(art_codigo) DO UPDATE SET image_url = excluded.image_url, updated_at = datetime('now')
    `);
    let pegadas = 0, respetadas = 0, igual = 0;
    const escribir = db.transaction((filas) => {
      for (const [codigo, url] of filas) {
        const previo = previos.get(codigo);
        if (previo === url) { igual++; continue; }
        // No se pisa una foto puesta a mano (la que NO viene del CDN de Shopify)
        if (previo && !/cdn\.shopify\.com|shopify/i.test(previo)) { respetadas++; continue; }
        upsert.run(codigo, url);
        pegadas++;
      }
    });
    const filas = [];
    for (const [bc, url] of porCodigo) filas.push([artPorCodigo.get(bc) || bc, url]);
    escribir(filas);
    if (pegadas) invalidateProductsCache();

    const resumen = `${pegadas} fotos nuevas · ${igual} ya estaban · ${respetadas} respetadas (puestas a mano) · ${porCodigo.size} códigos con foto en la página · ${Math.round((Date.now() - inicio) / 1000)}s`;
    db.prepare(`UPDATE fotos_sync_estado SET ultima_sync = datetime('now'), resumen = ?, pegadas = ? WHERE id = 1`).run(resumen, pegadas);
    console.log(`[shopify-web] Fotos: ${resumen}`);
    return { ok: true, pegadas, igual, respetadas, sin_foto: sinFoto, con_foto: porCodigo.size, resumen };
  } finally {
    fotosCorriendo = false;
  }
}

router.get('/fotos/estado', async (req, res) => {
  try {
    migrarFotos();
    const db = getDb();
    const st = db.prepare(`SELECT ultima_sync, resumen, pegadas FROM fotos_sync_estado WHERE id = 1`).get() || {};
    const con = db.prepare(`SELECT COUNT(*) AS n FROM product_overrides WHERE image_url IS NOT NULL AND image_url <> ''`).get();
    res.json({
      con_foto: con ? con.n : 0,
      ultima_sync: st.ultima_sync || null,
      ultimo_resumen: st.resumen || null,
      corriendo: fotosCorriendo,
      cada_horas: FOTOS_HORAS,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/fotos/sincronizar', async (req, res) => {
  try { res.json(await sincronizarFotos()); }
  catch (e) { console.error('[shopify-web] fotos:', e.message); res.status(500).json({ error: e.message }); }
});

// Cada FOTOS_HORAS (y una vez al arrancar) se copian las fotos nuevas.
function startFotosScheduler() {
  if (!configurado()) return;
  const correr = () => sincronizarFotos().catch(e => console.error('[shopify-web] fotos:', e.message));
  setTimeout(correr, 3 * 60 * 1000);                 // 3 min tras arrancar (deja que la caja respire)
  setInterval(correr, FOTOS_HORAS * 3600 * 1000);
  console.log(`[shopify-web] Sincronización de fotos lista (cada ${FOTOS_HORAS} h).`);
}

// ============================================================================
// "¿Por qué tiene stock en la web y no aquí?" — diagnóstico de un producto.
// ============================================================================
router.get('/producto/:id/diagnostico', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const cat = await getCatalogo();
    const p = cat.find(x => x.id === id);
    if (!p) return res.status(404).json({ error: 'Ese producto no está en el catálogo' });
    const areas = await getAreas();
    const barcode = (p.barcode || '').trim();

    if (!barcode) {
      return res.json({
        causa: 'sin_codigo', barcode: null, areas_web: areas, ubicaciones: [], en_novacaja: null,
        titulo: 'Sin código de barras',
        texto: 'Este producto no tiene código de barras en la página, y el código es lo único que lo liga con tu inventario. Por eso no muestra existencia de la tienda y su stock nunca se sincroniza: lo que ves en la web es un número escrito a mano en Shopify.',
        accion: 'ligar', accion_texto: 'Búscalo en tu inventario y lígalo: el código se guarda en la página y a partir de ahí el stock se sincroniza solo.',
      });
    }

    const r = await mssql.query(`
      SELECT ib.ubicacion, ib.cantidad
      FROM [compucaja].[dbo].[inventario_bodega] ib WITH (NOLOCK)
      WHERE ib.codigo_barras = @c AND ib.cantidad <> 0
      ORDER BY ib.cantidad DESC
      OPTION (MAXDOP 1)`, { c: barcode });
    const ubicaciones = r.recordset || [];
    const nova = await mssql.query(`
      SELECT TOP 1 Art_Codigo, Art_Descripcion FROM [compucaja].[dbo].[VArticulosUnificados] WITH (NOLOCK)
      WHERE Art_Codigo = @c OR Art_GTIN = @c OR CodAlt_Codigo = @c OPTION (MAXDOP 1)`, { c: barcode });
    const enNova = (nova.recordset || [])[0] || null;
    const bloq = await mssql.query(`
      SELECT TOP 1 motivo_bloqueo FROM [compucaja].[dbo].[shopify_sync_estado] WITH (NOLOCK)
      WHERE codigo_barras = @c AND bloqueado_hasta IS NOT NULL AND bloqueado_hasta > GETDATE()`, { c: barcode })
      .catch(() => ({ recordset: [] }));
    const sinSeguimiento = (bloq.recordset || [])[0] || null;

    const enAreasWeb = ubicaciones.filter(u => areas.includes(u.ubicacion));
    const fuera = ubicaciones.filter(u => !areas.includes(u.ubicacion));
    const base = { barcode, areas_web: areas, ubicaciones, en_novacaja: enNova ? { codigo: enNova.Art_Codigo, nombre: enNova.Art_Descripcion } : null };

    if (sinSeguimiento) return res.json({ ...base, causa: 'sin_seguimiento',
      titulo: 'Sin control de inventario en la página',
      texto: `Shopify rechaza el stock de este producto: su variante tiene apagado el control de inventario ("Track quantity"). Mientras siga así, la página lo vende sin descontar y el sistema no puede corregir el número.`,
      accion: 'shopify', accion_texto: 'En Shopify, edita el producto y activa "Track quantity" en su inventario.' });

    if (!ubicaciones.length) return res.json({ ...base, causa: 'no_contado',
      titulo: 'Nunca se ha contado aquí',
      texto: enNova
        ? `El producto sí existe en NovaCaja (${enNova.Art_Descripcion || enNova.Art_Codigo}), pero no tiene ni una pieza registrada en bodega. El stock del sistema sale de lo que se cuenta con la TC52; si nadie lo ha contado, aquí sale vacío aunque la página diga que hay.`
        : 'Este código no está contado en bodega ni existe en NovaCaja. El número de la página se escribió a mano en Shopify.',
      accion: 'contar', accion_texto: 'Cuéntalo con la TC52 (Recepción o Entrada) en el área donde esté. A los pocos minutos la página mostrará esa misma cantidad.' });

    if (!enAreasWeb.length && fuera.length) return res.json({ ...base, causa: 'area_no_incluida',
      titulo: 'Está guardado en un área que no cuenta para la página',
      texto: `Sí hay existencia (${fuera.map(u => `${u.cantidad} en ${u.ubicacion}`).join(', ')}), pero la página solo toma en cuenta ${areas.join(' + ')}. Por eso aquí aparece sin stock para la web y su número en línea no se actualiza.`,
      accion: 'areas', accion_texto: `Si ese producto se vende en línea, agrega ${fuera.map(u => u.ubicacion).join(' / ')} a las áreas de la página; si no, mueve la mercancía al área que sí cuenta.` });

    const total = enAreasWeb.reduce((s, u) => s + u.cantidad, 0);
    return res.json({ ...base, causa: 'ok',
      titulo: 'Todo en orden',
      texto: `Hay ${total} pza(s) en ${enAreasWeb.map(u => u.ubicacion).join(' + ')} y la página se sincroniza cada pocos minutos. Si el número de la web no coincide, puede haber un apartado de un pedido en línea o el sync no ha corrido todavía.`,
      accion: null, accion_texto: null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Ligar un producto de la página con un código del inventario ───────────────
// Escribe el código de barras en la variante de Shopify: a partir de ahí el
// producto queda emparejado y su stock se sincroniza solo.
router.post('/producto/:id/ligar', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const codigo = String((req.body || {}).codigo || '').trim();
    if (!codigo) return res.status(400).json({ error: 'Falta el código' });
    const cat = await getCatalogo();
    const p = cat.find(x => x.id === id);
    if (!p) return res.status(404).json({ error: 'Ese producto no está en el catálogo' });
    if (p.barcode) return res.status(409).json({ error: `Ese producto ya tiene el código ${p.barcode}` });
    if (!p.variantId) return res.status(400).json({ error: 'El producto no tiene variante que actualizar' });
    if (barcodesShopify.has(codigo) || await shopify.existeBarcode(codigo)) {
      return res.status(409).json({ error: 'Ese código ya lo usa otro producto de la página' });
    }
    const r = await shopifyFetch(apiUrl(`variants/${p.variantId}.json`), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant: { id: p.variantId, barcode: codigo } }),
    });
    if (!r.ok) return res.status(r.status).json({ error: `Shopify contestó ${r.status}` });
    barcodesShopify.add(codigo);
    parcharCache(id, { barcode: codigo });
    stockMemo = { fecha: 0, mapa: null };

    // Empuja de una vez el stock real para que la página deje de mentir
    const stock = await getStockBodega();
    const s = stock.get(codigo);
    if (p.inventoryItemId && s) {
      await shopifyFetch(apiUrl('inventory_levels/set.json'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id: parseInt(LOCATION_ID), inventory_item_id: p.inventoryItemId, available: s.qty }),
      }).catch(() => {});
    }
    // Y la foto de la página pasa al inventario
    try {
      if (p.image) {
        getDb().prepare(`
          INSERT INTO product_overrides (art_codigo, image_url, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(art_codigo) DO UPDATE SET image_url = excluded.image_url, updated_at = datetime('now')
        `).run(codigo, p.image);
        invalidateProductsCache();
      }
    } catch (e) { console.error('[shopify-web] foto al ligar:', e.message); }
    res.json({ ok: true, codigo, stock: s ? s.qty : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, sincronizarFotos, startFotosScheduler };
