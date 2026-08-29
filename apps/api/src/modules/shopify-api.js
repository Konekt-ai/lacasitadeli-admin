// ============================================================================
// shopify-api.js — Cliente compartido del Admin API de Shopify.
// Token por client_credentials (app "Inventario Casita" del Dev Dashboard,
// dura 24 h): se renueva solo al acercarse a vencer o si contesta 401.
// Lo usan shopify-sync (inventario) y shopify-web (panel "Página web").
// ============================================================================
const SHOP        = process.env.SHOPIFY_SHOP || '';
const CLIENT_ID   = process.env.SHOPIFY_CLIENT_ID || '';
const CLIENT_SEC  = process.env.SHOPIFY_CLIENT_SECRET || '';
const LOCATION_ID = process.env.SHOPIFY_LOCATION_ID || '';
const API_VER     = process.env.SHOPIFY_API_VERSION || '2026-07';

const configurado = () => !!(SHOP && CLIENT_ID && CLIENT_SEC && LOCATION_ID);
const apiUrl = (ruta) => `https://${SHOP}.myshopify.com/admin/api/${API_VER}/${ruta}`;

let tokenCache = { token: null, expira: 0 };
async function getToken(forzar = false) {
  const ahora = Date.now();
  if (!forzar && tokenCache.token && ahora < tokenCache.expira - 60 * 60 * 1000) return tokenCache.token;
  const res = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SEC }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`Token Shopify falló (${res.status}): ${JSON.stringify(body).slice(0, 200)}`);
  tokenCache = { token: body.access_token, expira: ahora + (body.expires_in || 86399) * 1000 };
  return tokenCache.token;
}

// fetch con token; reintenta en 401 (token viejo) y 429 (rate limit, respeta
// Retry-After). Timeout de 30 s para que un Shopify colgado no cuelgue la UI.
async function shopifyFetch(url, opts = {}, intento = 0) {
  const token = await getToken();
  const res = await fetch(url, {
    ...opts,
    signal: opts.signal || AbortSignal.timeout(30_000),
    headers: { ...(opts.headers || {}), 'X-Shopify-Access-Token': token },
  });
  if (res.status === 401 && intento === 0) { await getToken(true); return shopifyFetch(url, opts, 1); }
  if (res.status === 429 && intento < 5) {
    const espera = parseFloat(res.headers.get('retry-after') || '2') * 1000;
    await new Promise(r => setTimeout(r, espera));
    return shopifyFetch(url, opts, intento + 1);
  }
  return res;
}

// Recorre TODAS las páginas de products.json y entrega los productos crudos.
// fields: lista de campos a pedir (menos datos = más rápido y menos RAM).
async function listarProductos(fields) {
  const productos = [];
  let url = apiUrl(`products.json?limit=250${fields ? `&fields=${fields}` : ''}`);
  while (url) {
    const res = await shopifyFetch(url);
    if (!res.ok) throw new Error(`products.json falló (${res.status})`);
    const body = await res.json();
    productos.push(...(body.products || []));
    const link = res.headers.get('link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
    // 500 ms: deja aire en el bucket de 2 req/s para el sync que corre en paralelo
    await new Promise(r => setTimeout(r, 500));
  }
  return productos;
}

// Consulta EXACTA por código de barras vía GraphQL (para validar duplicados en
// vivo, sin depender del caché). Devuelve true si ya existe una variante así.
async function existeBarcode(codigo) {
  const res = await shopifyFetch(apiUrl('graphql.json'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `{ productVariants(first: 1, query: "barcode:${String(codigo).replace(/["\\]/g, '')}") { edges { node { id } } } }`,
    }),
  });
  if (!res.ok) throw new Error(`graphql falló (${res.status})`);
  const body = await res.json();
  const edges = body && body.data && body.data.productVariants ? body.data.productVariants.edges : [];
  return edges.length > 0;
}

module.exports = { SHOP, LOCATION_ID, API_VER, configurado, apiUrl, getToken, shopifyFetch, listarProductos, existeBarcode };
