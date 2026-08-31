// ============================================================================
// pedidos-web.js — Pedidos de la tienda en línea (Shopify) dentro del sistema.
//
// Modelo de stock (un solo inventario central = inventario_bodega):
//   físico     = inventario_bodega.cantidad            (por código + ubicación)
//   apartado   = SUM(reservas_bodega.cantidad activas)  (por código + ubicación)
//   disponible = físico - apartado  (es lo que shopify-sync empuja a la web)
//
// Ciclo de un pedido:
//   1. Cada N min se bajan los pedidos de Shopify (solo creados desde config.desde).
//   2. Al llegar (pago aprobado, o pendiente si reservar_sin_pago=1) se APARTA el
//      stock: NO baja el físico, baja el disponible. Nada se vende dos veces.
//   3. En la tienda se prepara (la TC52 escanea para validar piezas: NO toca stock).
//   4. Al ENTREGAR / ENVIAR se hace la SALIDA FÍSICA real: baja inventario_bodega y
//      queda un movimiento 'salida' motivo 'venta_web' con stock antes/después y el
//      número de pedido. La reserva se libera.
//   5. Si se cancela antes de entregar, la reserva se libera y el disponible regresa.
//      Si el pago falla (voided/refunded) no se aparta nada.
//
// Tablas nuevas (compucaja.dbo): pedidos_web, pedidos_web_lineas, pedidos_web_eventos,
// reservas_bodega, pedidos_web_config y la vista v_stock_disponible. No se toca NovaCaja.
// Permisos Shopify: read_orders (obligatorio); write_merchant_managed_fulfillment_orders
// (opcional: marcar como preparado/enviado en Shopify desde aquí).
// ============================================================================
const express = require('express');
const mssql   = require('../db/mssql');
const shopify = require('./shopify-api');

const { sql } = mssql;
const { apiUrl, shopifyFetch, configurado } = shopify;
const router = express.Router();

const T = {
  pedidos:  '[compucaja].[dbo].[pedidos_web]',
  lineas:   '[compucaja].[dbo].[pedidos_web_lineas]',
  eventos:  '[compucaja].[dbo].[pedidos_web_eventos]',
  reservas: '[compucaja].[dbo].[reservas_bodega]',
  config:   '[compucaja].[dbo].[pedidos_web_config]',
  vista:    '[compucaja].[dbo].[v_stock_disponible]',
  inv:      '[compucaja].[dbo].[inventario_bodega]',
  mov:      '[compucaja].[dbo].[movimientos_bodega]',
  cod:      '[compucaja].[dbo].[codigos_producto]',
  art:      '[compucaja].[dbo].[VArticulosUnificados]',
};

const ESTADOS   = ['nuevo', 'preparando', 'listo', 'entregado', 'enviado', 'cancelado'];
const FINALES   = new Set(['entregado', 'enviado', 'cancelado']);
const PAGO_OK   = new Set(['paid', 'partially_paid', 'authorized', 'partially_refunded']);
const PAGO_MALO = new Set(['voided', 'refunded']);
const TIPOS_ENTREGA = ['recoger', 'envio', 'local'];
const FIELDS = 'id,name,order_number,created_at,updated_at,cancelled_at,cancel_reason,closed_at,'
  + 'financial_status,fulfillment_status,currency,total_price,subtotal_price,total_tax,total_discounts,'
  + 'total_shipping_price_set,payment_gateway_names,gateway,line_items,customer,email,phone,'
  + 'shipping_lines,shipping_address,note,tags,source_name,refunds';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s == null ? '' : s).replace(/'/g, "''");
const recorta = (s, n) => (s == null ? null : String(s).slice(0, n));
const num = v => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));

// ── Fechas: la BD guarda DATETIME "naive" en hora CDMX (GETDATE() ya es CDMX).
// El driver mssql entrega/recibe esos valores como si fueran UTC, así que:
//  - para GUARDAR un instante ISO de Shopify: sacamos sus partes en CDMX y armamos
//    un Date con Date.UTC(partes) -> el driver escribe exactamente esas partes.
//  - para USAR un DATETIME leído: sus getUTC*() son las partes CDMX.
const fmtCDMX = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
function isoANaiveCDMX(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const p = {};
  for (const { type, value } of fmtCDMX.formatToParts(d)) p[type] = value;
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second));
}
function naiveAIso(d) {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  const pad = n => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}T${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}:${pad(x.getUTCSeconds())}-06:00`;
}

// ── Helper de query con tipos explícitos ({ type, value }) ─────────────────────
function bind(req, params) {
  for (const [k, v] of Object.entries(params || {})) {
    if (v && typeof v === 'object' && !(v instanceof Date) && 'type' in v) req.input(k, v.type, v.value);
    else req.input(k, v);
  }
  return req;
}
async function q(texto, params, tx) {
  const req = tx ? new sql.Request(tx) : (await mssql.getPool()).request();
  const r = await bind(req, params).query(texto);
  return r.recordset || [];
}
const big = v => ({ type: sql.BigInt, value: v == null ? null : Number(v) });
const dec = v => ({ type: sql.Decimal(18, 2), value: v });
const str = (v, n) => ({ type: sql.VarChar(n), value: recorta(v, n) });

// ── Candado por pedido (sync + panel + TC52 pueden llegar al mismo tiempo) ─────
const locks = new Map();
async function conCandado(clave, fn) {
  const previo = locks.get(clave) || Promise.resolve();
  let libera;
  const mio = new Promise(r => { libera = r; });
  locks.set(clave, previo.then(() => mio));
  try { await previo; return await fn(); }
  finally { libera(); if (locks.get(clave) === mio) locks.delete(clave); }
}

// ── Migración ligera (idempotente, SQL Server 2014) ────────────────────────────
let migrado = false;
async function migrar() {
  if (migrado) return;
  await mssql.query(`
    IF OBJECT_ID('${T.config}') IS NULL BEGIN
      CREATE TABLE ${T.config} (
        id INT PRIMARY KEY,
        activo BIT NOT NULL DEFAULT 1,
        intervalo_min INT NOT NULL DEFAULT 2,
        ubicacion_default VARCHAR(50) NOT NULL DEFAULT 'Casita 1',
        ubicaciones_orden VARCHAR(200) NOT NULL DEFAULT 'Casita 1,Casita 2,Bodega',
        reservar_sin_pago BIT NOT NULL DEFAULT 1,
        salida_por_fulfillment BIT NOT NULL DEFAULT 1,
        fulfill_en_shopify BIT NOT NULL DEFAULT 1,
        desde DATETIME NOT NULL DEFAULT GETDATE(),
        ultima_sync DATETIME NULL,
        ultimo_resumen VARCHAR(500) NULL,
        ultimo_error VARCHAR(500) NULL
      );
      INSERT INTO ${T.config} (id) VALUES (1);
    END;
    IF OBJECT_ID('${T.pedidos}') IS NULL BEGIN
      CREATE TABLE ${T.pedidos} (
        id INT IDENTITY(1,1) PRIMARY KEY,
        shopify_order_id BIGINT NOT NULL,
        numero VARCHAR(20) NOT NULL,
        order_number INT NULL,
        fecha_pedido DATETIME NOT NULL,
        fecha_shopify_actualizado DATETIME NULL,
        cliente_nombre VARCHAR(150) NULL,
        cliente_email VARCHAR(150) NULL,
        cliente_telefono VARCHAR(50) NULL,
        direccion VARCHAR(400) NULL,
        tipo_entrega VARCHAR(20) NOT NULL DEFAULT 'envio',
        entrega_detalle VARCHAR(150) NULL,
        metodo_pago VARCHAR(150) NULL,
        estado_pago VARCHAR(30) NULL,
        estado_envio_shopify VARCHAR(30) NULL,
        moneda VARCHAR(5) NULL,
        subtotal DECIMAL(18,2) NULL,
        envio DECIMAL(18,2) NULL,
        impuestos DECIMAL(18,2) NULL,
        descuentos DECIMAL(18,2) NULL,
        total DECIMAL(18,2) NOT NULL DEFAULT 0,
        estado VARCHAR(20) NOT NULL DEFAULT 'nuevo',
        ubicacion VARCHAR(50) NULL,
        reservado BIT NOT NULL DEFAULT 0,
        surtido BIT NOT NULL DEFAULT 0,
        fecha_surtido DATETIME NULL,
        fecha_cancelado DATETIME NULL,
        motivo_cancelacion VARCHAR(200) NULL,
        notas_cliente VARCHAR(500) NULL,
        notas_internas VARCHAR(500) NULL,
        tags VARCHAR(200) NULL,
        origen VARCHAR(30) NULL,
        shopify_cancelado_en DATETIME NULL,
        shopify_fulfillment_ok BIT NULL,
        creado DATETIME NOT NULL DEFAULT GETDATE(),
        actualizado DATETIME NOT NULL DEFAULT GETDATE()
      );
      CREATE UNIQUE INDEX UQ_pedidos_web_shopify ON ${T.pedidos}(shopify_order_id);
      CREATE INDEX IX_pedidos_web_estado ON ${T.pedidos}(estado, fecha_pedido);
    END;
    IF OBJECT_ID('${T.lineas}') IS NULL BEGIN
      CREATE TABLE ${T.lineas} (
        id INT IDENTITY(1,1) PRIMARY KEY,
        pedido_id INT NOT NULL,
        shopify_line_id BIGINT NULL,
        variant_id BIGINT NULL,
        product_id BIGINT NULL,
        codigo_barras VARCHAR(50) NULL,
        sku VARCHAR(80) NULL,
        titulo VARCHAR(200) NOT NULL,
        variante VARCHAR(120) NULL,
        cantidad INT NOT NULL,
        cantidad_original INT NOT NULL DEFAULT 0,
        precio DECIMAL(18,2) NULL,
        descuento DECIMAL(18,2) NULL,
        total DECIMAL(18,2) NULL,
        ubicacion VARCHAR(50) NULL,
        ubicacion_fija BIT NOT NULL DEFAULT 0,
        stock_al_reservar INT NULL,
        faltante INT NOT NULL DEFAULT 0,
        escaneado INT NOT NULL DEFAULT 0,
        surtido_qty INT NULL,
        sin_conteo BIT NOT NULL DEFAULT 0
      );
      CREATE INDEX IX_pedidos_web_lineas_pedido ON ${T.lineas}(pedido_id);
      CREATE INDEX IX_pedidos_web_lineas_codigo ON ${T.lineas}(codigo_barras);
    END;
    IF OBJECT_ID('${T.eventos}') IS NULL BEGIN
      CREATE TABLE ${T.eventos} (
        id INT IDENTITY(1,1) PRIMARY KEY,
        pedido_id INT NOT NULL,
        fecha DATETIME NOT NULL DEFAULT GETDATE(),
        tipo VARCHAR(30) NOT NULL,
        de VARCHAR(20) NULL,
        a VARCHAR(20) NULL,
        usuario VARCHAR(60) NULL,
        detalle VARCHAR(400) NULL
      );
      CREATE INDEX IX_pedidos_web_eventos_pedido ON ${T.eventos}(pedido_id, fecha);
    END;
    IF OBJECT_ID('${T.reservas}') IS NULL BEGIN
      CREATE TABLE ${T.reservas} (
        id INT IDENTITY(1,1) PRIMARY KEY,
        codigo_barras VARCHAR(50) NOT NULL,
        ubicacion VARCHAR(50) NOT NULL,
        cantidad INT NOT NULL,
        pedido_id INT NOT NULL,
        linea_id INT NULL,
        activa BIT NOT NULL DEFAULT 1,
        creado DATETIME NOT NULL DEFAULT GETDATE(),
        liberado DATETIME NULL,
        motivo_liberacion VARCHAR(30) NULL
      );
      CREATE INDEX IX_reservas_bodega_activa ON ${T.reservas}(codigo_barras, ubicacion) INCLUDE (cantidad) WHERE activa = 1;
      CREATE INDEX IX_reservas_bodega_pedido ON ${T.reservas}(pedido_id);
    END;
    IF OBJECT_ID('${T.vista}') IS NULL
      EXEC('CREATE VIEW [dbo].[v_stock_disponible] AS
        SELECT ib.codigo_barras, ib.ubicacion, ib.cantidad AS fisico,
               ISNULL(r.apartado, 0) AS apartado,
               CASE WHEN ib.cantidad - ISNULL(r.apartado, 0) < 0 THEN 0 ELSE ib.cantidad - ISNULL(r.apartado, 0) END AS disponible
        FROM [dbo].[inventario_bodega] ib
        LEFT JOIN (
          SELECT codigo_barras, ubicacion, SUM(cantidad) AS apartado
          FROM [dbo].[reservas_bodega] WHERE activa = 1
          GROUP BY codigo_barras, ubicacion
        ) r ON r.codigo_barras = ib.codigo_barras AND r.ubicacion = ib.ubicacion');
  `);
  migrado = true;
}

async function getConfig() {
  await migrar();
  const r = await q(`SELECT TOP 1 * FROM ${T.config} WHERE id = 1`);
  const c = r[0] || {};
  c.orden = String(c.ubicaciones_orden || '').split(',').map(s => s.trim()).filter(Boolean);
  if (c.ubicacion_default && !c.orden.includes(c.ubicacion_default)) c.orden.unshift(c.ubicacion_default);
  return c;
}

// ── Permisos de la app en Shopify (cache 10 min) ───────────────────────────────
let permisosCache = { fecha: 0, scopes: [], read_orders: false, fulfillment: false, error: null };
async function permisos(forzar = false) {
  if (!configurado()) return { ...permisosCache, error: 'Faltan credenciales de Shopify en .env' };
  if (!forzar && Date.now() - permisosCache.fecha < 10 * 60 * 1000) return permisosCache;
  try {
    // Los permisos van PEGADOS al token (dura 24 h). Si acaban de aprobarse en la
    // tienda, el token viejo sigue trayendo los de antes: al re-checar a propósito
    // ("Volver a checar") se pide un token nuevo para ver los permisos de verdad.
    if (forzar) await shopify.getToken(true);
    const res = await shopifyFetch(`https://${shopify.SHOP}.myshopify.com/admin/oauth/access_scopes.json`);
    const body = await res.json().catch(() => ({}));
    const scopes = (body.access_scopes || []).map(s => s.handle);
    permisosCache = {
      fecha: Date.now(), scopes, error: res.ok ? null : `HTTP ${res.status}`,
      read_orders: scopes.includes('read_orders') || scopes.includes('write_orders'),
      fulfillment: scopes.includes('write_merchant_managed_fulfillment_orders'),
    };
  } catch (e) {
    permisosCache = { ...permisosCache, fecha: Date.now(), error: e.message };
  }
  return permisosCache;
}

// ── Eventos ────────────────────────────────────────────────────────────────────
async function evento(pedidoId, tipo, { de = null, a = null, usuario = null, detalle = null } = {}, tx) {
  await q(`INSERT INTO ${T.eventos} (pedido_id, tipo, de, a, usuario, detalle) VALUES (@p, @t, @de, @a, @u, @d)`,
    { p: pedidoId, t: str(tipo, 30), de: str(de, 20), a: str(a, 20), u: str(usuario, 60), d: str(detalle, 400) }, tx);
}

// ── Mapeo de un pedido de Shopify a nuestras columnas ──────────────────────────
function tipoEntregaDe(o) {
  const lineas = (o.shipping_lines || []).map(s => `${s.code || ''} ${s.title || ''}`.toLowerCase()).join(' | ');
  if (/pick ?up|recoger|recolec|tienda|sucursal|en local/.test(lineas)) return 'recoger';
  if (/local delivery|entrega local|reparto/.test(lineas)) return 'local';
  if (!(o.shipping_lines || []).length && !o.shipping_address) return 'recoger';
  return 'envio';
}
function nombreCliente(o) {
  const c = o.customer || {};
  const n = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  if (n) return n;
  const s = o.shipping_address || {};
  const sn = s.name || [s.first_name, s.last_name].filter(Boolean).join(' ').trim();
  if (sn) return sn;
  return o.email || o.phone || null;
}
function direccionDe(o) {
  const s = o.shipping_address;
  if (!s) return null;
  return [s.address1, s.address2, s.city, s.province, s.zip, s.country].filter(Boolean).join(', ');
}
function mapOrder(o) {
  const envioSet = o.total_shipping_price_set && o.total_shipping_price_set.shop_money;
  const gateways = Array.isArray(o.payment_gateway_names) && o.payment_gateway_names.length
    ? o.payment_gateway_names.join(', ') : (o.gateway || null);
  return {
    shopify_order_id: o.id,
    numero: o.name || `#${o.order_number}`,
    order_number: o.order_number || null,
    fecha_pedido: isoANaiveCDMX(o.created_at) || isoANaiveCDMX(new Date().toISOString()),
    fecha_shopify_actualizado: isoANaiveCDMX(o.updated_at),
    cliente_nombre: nombreCliente(o),
    cliente_email: o.email || (o.customer && o.customer.email) || null,
    cliente_telefono: o.phone || (o.shipping_address && o.shipping_address.phone) || (o.customer && o.customer.phone) || null,
    direccion: direccionDe(o),
    tipo_entrega: tipoEntregaDe(o),
    entrega_detalle: (o.shipping_lines || []).map(s => s.title).filter(Boolean).join(', ') || null,
    metodo_pago: gateways,
    estado_pago: o.financial_status || null,
    estado_envio_shopify: o.fulfillment_status || null,
    moneda: o.currency || null,
    subtotal: num(o.subtotal_price),
    envio: envioSet ? num(envioSet.amount) : null,
    impuestos: num(o.total_tax),
    descuentos: num(o.total_discounts),
    total: num(o.total_price) || 0,
    notas_cliente: o.note || null,
    tags: o.tags || null,
    origen: o.source_name || null,
    shopify_cancelado_en: isoANaiveCDMX(o.cancelled_at),
    cancel_reason: o.cancel_reason || null,
  };
}
// Cantidad reembolsada por línea (líneas quitadas del pedido tras un reembolso parcial)
function reembolsosPorLinea(o) {
  const m = new Map();
  for (const r of o.refunds || []) for (const li of r.refund_line_items || []) {
    m.set(li.line_item_id, (m.get(li.line_item_id) || 0) + (li.quantity || 0));
  }
  return m;
}

// ── variant_id -> código de barras (cache del sync + consulta directa) ─────────
const variantCache = new Map();
async function barcodeDeVariante(variantId) {
  if (!variantId) return null;
  if (variantCache.has(variantId)) return variantCache.get(variantId);
  try {
    const sync = require('./shopify-sync');
    if (typeof sync.barcodeDeVariante === 'function') {
      const bc = await sync.barcodeDeVariante(variantId);
      if (bc) { variantCache.set(variantId, bc); return bc; }
    }
  } catch { /* sin mapa aún */ }
  try {
    const res = await shopifyFetch(apiUrl(`variants/${variantId}.json?fields=id,barcode,sku`));
    if (res.ok) {
      const body = await res.json();
      const bc = body.variant && body.variant.barcode ? String(body.variant.barcode).trim() : null;
      variantCache.set(variantId, bc || null);
      return bc || null;
    }
  } catch { /* red */ }
  return null;
}
// ¿Existe ese código en bodega (o como código alterno de caja/pieza)?
async function codigoBase(codigo) {
  const c = String(codigo || '').trim();
  if (!c) return { base: null, unidades: 1 };
  const r = await q(`SELECT TOP 1 codigo_base, unidades FROM ${T.cod} WHERE codigo = @c`, { c: str(c, 50) }).catch(() => []);
  if (r[0] && r[0].codigo_base) return { base: String(r[0].codigo_base).trim(), unidades: Math.max(1, r[0].unidades || 1) };
  return { base: c, unidades: 1 };
}

// ── Ingesta (idempotente) de un pedido de Shopify ──────────────────────────────
async function ingerirOrder(o, cfg, stats) {
  const d = mapOrder(o);
  const canceladoEnShopify = !!o.cancelled_at || PAGO_MALO.has(o.financial_status);
  const pagoOk = PAGO_OK.has(o.financial_status);

  return conCandado(`shopify:${o.id}`, async () => {
    let p = (await q(`SELECT * FROM ${T.pedidos} WHERE shopify_order_id = @id`, { id: big(o.id) }))[0];
    let nuevo = false;
    if (!p) {
      nuevo = true;
      const ins = await q(`
        INSERT INTO ${T.pedidos} (shopify_order_id, numero, order_number, fecha_pedido, fecha_shopify_actualizado,
          cliente_nombre, cliente_email, cliente_telefono, direccion, tipo_entrega, entrega_detalle, metodo_pago,
          estado_pago, estado_envio_shopify, moneda, subtotal, envio, impuestos, descuentos, total, estado, ubicacion,
          notas_cliente, tags, origen, shopify_cancelado_en, fecha_cancelado, motivo_cancelacion)
        OUTPUT inserted.id
        VALUES (@sid, @numero, @onum, @fp, @fsa, @cn, @ce, @ct, @dir, @te, @ed, @mp, @ep, @ees, @mon, @sub, @env, @imp,
          @desc, @tot, @estado, @ubi, @nc, @tags, @orig, @sce, CASE WHEN @fcan = 1 THEN GETDATE() ELSE NULL END, @mcan)`, {
        sid: big(d.shopify_order_id), numero: str(d.numero, 20), onum: d.order_number, fp: d.fecha_pedido,
        fsa: d.fecha_shopify_actualizado, cn: str(d.cliente_nombre, 150), ce: str(d.cliente_email, 150),
        ct: str(d.cliente_telefono, 50), dir: str(d.direccion, 400), te: str(d.tipo_entrega, 20),
        ed: str(d.entrega_detalle, 150), mp: str(d.metodo_pago, 150), ep: str(d.estado_pago, 30),
        ees: str(d.estado_envio_shopify, 30), mon: str(d.moneda, 5), sub: dec(d.subtotal), env: dec(d.envio),
        imp: dec(d.impuestos), desc: dec(d.descuentos), tot: dec(d.total),
        estado: str(canceladoEnShopify ? 'cancelado' : 'nuevo', 20), ubi: str(cfg.ubicacion_default, 50),
        nc: str(d.notas_cliente, 500), tags: str(d.tags, 200), orig: str(d.origen, 30), sce: d.shopify_cancelado_en,
        fcan: canceladoEnShopify ? 1 : 0, // "ahora" siempre con GETDATE() (el driver escribiría UTC)
        mcan: str(canceladoEnShopify ? `Cancelado en Shopify (${d.cancel_reason || d.estado_pago})` : null, 200),
      });
      p = (await q(`SELECT * FROM ${T.pedidos} WHERE id = @id`, { id: ins[0].id }))[0];
      await evento(p.id, 'importado', { usuario: 'shopify', detalle: `Pedido ${d.numero} · ${d.cliente_nombre || 'sin nombre'} · $${d.total} · pago: ${d.estado_pago} · entrega: ${d.tipo_entrega}` });
      stats.nuevos++;
    } else {
      // Solo se actualiza lo que viene de Shopify; estado/ubicación/notas internas son nuestras.
      await q(`
        UPDATE ${T.pedidos} SET numero = @numero, order_number = @onum, fecha_shopify_actualizado = @fsa,
          cliente_nombre = ISNULL(@cn, cliente_nombre), cliente_email = ISNULL(@ce, cliente_email),
          cliente_telefono = ISNULL(@ct, cliente_telefono), direccion = ISNULL(@dir, direccion),
          entrega_detalle = ISNULL(@ed, entrega_detalle), metodo_pago = ISNULL(@mp, metodo_pago),
          estado_pago = @ep, estado_envio_shopify = @ees, moneda = ISNULL(@mon, moneda),
          subtotal = @sub, envio = @env, impuestos = @imp, descuentos = @desc, total = @tot,
          notas_cliente = @nc, tags = @tags, shopify_cancelado_en = @sce, actualizado = GETDATE()
        WHERE id = @id`, {
        id: p.id, numero: str(d.numero, 20), onum: d.order_number, fsa: d.fecha_shopify_actualizado,
        cn: str(d.cliente_nombre, 150), ce: str(d.cliente_email, 150), ct: str(d.cliente_telefono, 50),
        dir: str(d.direccion, 400), ed: str(d.entrega_detalle, 150), mp: str(d.metodo_pago, 150),
        ep: str(d.estado_pago, 30), ees: str(d.estado_envio_shopify, 30), mon: str(d.moneda, 5),
        sub: dec(d.subtotal), env: dec(d.envio), imp: dec(d.impuestos), desc: dec(d.descuentos), tot: dec(d.total),
        nc: str(d.notas_cliente, 500), tags: str(d.tags, 200), sce: d.shopify_cancelado_en,
      });
      if (p.estado_pago !== d.estado_pago) {
        await evento(p.id, 'pago', { de: p.estado_pago, a: d.estado_pago, usuario: 'shopify', detalle: `Pago: ${p.estado_pago || '-'} -> ${d.estado_pago}` });
      }
      stats.actualizados++;
    }

    // ── Líneas (por shopify_line_id). Cantidad efectiva = pedida - reembolsada.
    const reembolsos = reembolsosPorLinea(o);
    const existentes = await q(`SELECT * FROM ${T.lineas} WHERE pedido_id = @p`, { p: p.id });
    const porShopify = new Map(existentes.filter(l => l.shopify_line_id != null).map(l => [String(l.shopify_line_id), l]));
    let cambioLineas = false;
    for (const li of o.line_items || []) {
      const qty = Math.max(0, (li.quantity || 0) - (reembolsos.get(li.id) || 0));
      const precio = num(li.price);
      const descuento = num(li.total_discount) || 0;
      const total = precio == null ? null : Math.max(0, precio * qty - descuento);
      const ex = porShopify.get(String(li.id));
      if (!ex) {
        let bc = await barcodeDeVariante(li.variant_id);
        if (!bc && li.sku) {
          const { base } = await codigoBase(li.sku);
          const hay = await q(`SELECT TOP 1 1 AS x FROM ${T.inv} WITH (NOLOCK) WHERE codigo_barras = @c`, { c: str(base, 50) });
          if (hay.length) bc = base;
        }
        await q(`INSERT INTO ${T.lineas} (pedido_id, shopify_line_id, variant_id, product_id, codigo_barras, sku, titulo,
            variante, cantidad, cantidad_original, precio, descuento, total)
          VALUES (@p, @lid, @vid, @pid, @bc, @sku, @tit, @var, @qty, @qo, @pre, @des, @tot)`, {
          p: p.id, lid: big(li.id), vid: big(li.variant_id), pid: big(li.product_id), bc: str(bc, 50),
          sku: str(li.sku, 80), tit: str(li.title || li.name || 'Producto', 200), var: str(li.variant_title, 120),
          qty, qo: li.quantity || 0, pre: dec(precio), des: dec(descuento), tot: dec(total),
        });
        if (!nuevo) cambioLineas = true;
      } else if (ex.cantidad !== qty || Number(ex.precio) !== precio) {
        await q(`UPDATE ${T.lineas} SET cantidad = @qty, precio = @pre, descuento = @des, total = @tot,
            escaneado = CASE WHEN escaneado > @qty THEN @qty ELSE escaneado END WHERE id = @id`,
          { id: ex.id, qty, pre: dec(precio), des: dec(descuento), tot: dec(total) });
        if (ex.cantidad !== qty) {
          cambioLineas = true;
          await evento(p.id, 'linea', { usuario: 'shopify', detalle: `${ex.titulo}: cantidad ${ex.cantidad} -> ${qty}` });
        }
      }
    }

    // ── Decidir apartado / cancelación / salida según lo que dice Shopify
    p = (await q(`SELECT * FROM ${T.pedidos} WHERE id = @id`, { id: p.id }))[0];
    if (canceladoEnShopify) {
      if (p.estado !== 'cancelado') {
        await cancelarPedido(p.id, { motivo: `Cancelado en Shopify (${d.cancel_reason || d.estado_pago})`, usuario: 'shopify' });
        stats.cancelados++;
      }
      return;
    }
    if (p.estado === 'cancelado' || p.surtido) return;

    const debeReservar = pagoOk || !!cfg.reservar_sin_pago;
    if (debeReservar && (!p.reservado || cambioLineas)) {
      // Mismo candado que usan las acciones del panel/TC52 sobre este pedido.
      await conCandado(`pedido:${p.id}`, () => reservarPedido(p.id, { usuario: 'shopify', motivo: cambioLineas ? 'reasignado' : null }));
      stats.reservados++;
    }
    if (cfg.salida_por_fulfillment && o.fulfillment_status === 'fulfilled') {
      const estadoFinal = p.tipo_entrega === 'recoger' ? 'entregado' : 'enviado';
      await surtirPedido(p.id, { estado: estadoFinal, usuario: 'shopify', forzar: true, nota: 'Marcado como preparado/enviado en Shopify' });
      stats.surtidos++;
    }
  });
}

// ── Apartar stock (transaccional). Re-apartar = liberar lo del pedido y volver a calcular.
async function reservarPedido(pedidoId, { usuario = 'panel', motivo = null } = {}) {
  const cfg = await getConfig();
  const pool = await mssql.getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const p = (await q(`SELECT * FROM ${T.pedidos} WHERE id = @id`, { id: pedidoId }, tx))[0];
    if (!p) throw new Error('Pedido no encontrado');
    if (p.surtido) { await tx.rollback(); return { ok: false, motivo: 'Ya está surtido' }; }
    if (p.estado === 'cancelado') { await tx.rollback(); return { ok: false, motivo: 'Está cancelado' }; }

    await q(`UPDATE ${T.reservas} SET activa = 0, liberado = GETDATE(), motivo_liberacion = @m WHERE pedido_id = @p AND activa = 1`,
      { p: pedidoId, m: str(motivo || 'reasignado', 30) }, tx);

    const lineas = await q(`SELECT * FROM ${T.lineas} WHERE pedido_id = @p ORDER BY id`, { p: pedidoId }, tx);
    const codigos = [...new Set(lineas.map(l => l.codigo_barras).filter(Boolean))];
    const disp = new Map(); // `${codigo}|${ubic}` -> disponible
    if (codigos.length) {
      const lista = codigos.map(c => `'${esc(c)}'`).join(',');
      const rows = await q(`SELECT codigo_barras, ubicacion, disponible FROM ${T.vista} WHERE codigo_barras IN (${lista})`, {}, tx);
      for (const r of rows) disp.set(`${String(r.codigo_barras).trim()}|${r.ubicacion}`, r.disponible);
    }
    const preferidas = [p.ubicacion || cfg.ubicacion_default, ...cfg.orden].filter((v, i, a) => v && a.indexOf(v) === i);
    let apartadas = 0, faltantes = 0, sinCodigo = 0;
    const detalle = [];
    for (const l of lineas) {
      const qty = l.cantidad || 0;
      if (qty <= 0) { await q(`UPDATE ${T.lineas} SET faltante = 0 WHERE id = @id`, { id: l.id }, tx); continue; }
      if (!l.codigo_barras) {
        sinCodigo++;
        await q(`UPDATE ${T.lineas} SET faltante = @f, ubicacion = ISNULL(ubicacion, @u), stock_al_reservar = NULL WHERE id = @id`,
          { id: l.id, f: qty, u: str(preferidas[0], 50) }, tx);
        continue;
      }
      const candidatas = l.ubicacion_fija && l.ubicacion ? [l.ubicacion] : (l.ubicacion && !preferidas.includes(l.ubicacion) ? [l.ubicacion, ...preferidas] : preferidas);
      const dispDe = u => disp.get(`${l.codigo_barras}|${u}`) || 0;
      let elegida = candidatas.find(u => dispDe(u) >= qty);
      if (!elegida) elegida = candidatas.slice().sort((a, b) => dispDe(b) - dispDe(a))[0] || preferidas[0];
      const disponible = dispDe(elegida);
      const reservar = Math.min(qty, disponible);
      const faltante = qty - reservar;
      if (reservar > 0) {
        await q(`INSERT INTO ${T.reservas} (codigo_barras, ubicacion, cantidad, pedido_id, linea_id) VALUES (@c, @u, @n, @p, @l)`,
          { c: str(l.codigo_barras, 50), u: str(elegida, 50), n: reservar, p: pedidoId, l: l.id }, tx);
        disp.set(`${l.codigo_barras}|${elegida}`, disponible - reservar);
        apartadas++;
      }
      if (faltante > 0) faltantes++;
      await q(`UPDATE ${T.lineas} SET ubicacion = @u, faltante = @f, stock_al_reservar = @s WHERE id = @id`,
        { id: l.id, u: str(elegida, 50), f: faltante, s: disponible }, tx);
      detalle.push(`${l.titulo} ×${qty} -> ${elegida}${faltante ? ` (faltan ${faltante})` : ''}`);
    }
    await q(`UPDATE ${T.pedidos} SET reservado = 1, actualizado = GETDATE() WHERE id = @id`, { id: pedidoId }, tx);
    const resumen = `${apartadas} línea(s) apartadas${faltantes ? `, ${faltantes} sin stock suficiente` : ''}${sinCodigo ? `, ${sinCodigo} sin código` : ''}`;
    await evento(pedidoId, motivo ? 'reapartado' : 'apartado', { usuario, detalle: recorta(`${resumen}. ${detalle.join(' · ')}`, 400) }, tx);
    await tx.commit();
    avisarSync();
    return { ok: true, apartadas, faltantes, sinCodigo, resumen };
  } catch (e) {
    try { await tx.rollback(); } catch { /* ya cerrada */ }
    throw e;
  }
}

// ── Salida física (transaccional). Idempotente: si ya está surtido no vuelve a descontar.
async function surtirPedido(pedidoId, { estado = 'entregado', usuario = 'panel', forzar = false, nota = null } = {}) {
  if (!['entregado', 'enviado'].includes(estado)) throw new Error('Estado final inválido');
  return conCandado(`pedido:${pedidoId}`, async () => {
    const cfg = await getConfig();
    const p = (await q(`SELECT * FROM ${T.pedidos} WHERE id = @id`, { id: pedidoId }))[0];
    if (!p) throw new Error('Pedido no encontrado');
    if (p.estado === 'cancelado') return { ok: false, error: 'El pedido está cancelado' };
    if (p.surtido) {
      if (p.estado !== estado) {
        await q(`UPDATE ${T.pedidos} SET estado = @e, actualizado = GETDATE() WHERE id = @id`, { id: pedidoId, e: str(estado, 20) });
        await evento(pedidoId, 'estado', { de: p.estado, a: estado, usuario });
      }
      return { ok: true, yaSurtido: true };
    }
    if (!PAGO_OK.has(p.estado_pago) && !forzar) {
      return { ok: false, requiereForzar: true, error: `El pago está "${p.estado_pago || 'pendiente'}" en Shopify. Confirma que ya se cobró para entregar.` };
    }
    const pool = await mssql.getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    let descontadas = 0, sinConteo = 0, unidades = 0;
    try {
      const lineas = await q(`SELECT * FROM ${T.lineas} WHERE pedido_id = @p AND cantidad > 0 ORDER BY id`, { p: pedidoId }, tx);
      const ref = `Pedido web ${p.numero} | shopify:${p.shopify_order_id}`;
      for (const l of lineas) {
        const ubic = l.ubicacion || p.ubicacion || cfg.ubicacion_default;
        if (!l.codigo_barras) { sinConteo++; await q(`UPDATE ${T.lineas} SET sin_conteo = 1, surtido_qty = 0 WHERE id = @id`, { id: l.id }, tx); continue; }
        const r = await q(`
          UPDATE ${T.inv}
            SET cantidad = CASE WHEN cantidad - @n < 0 THEN 0 ELSE cantidad - @n END, ultima_salida = GETDATE()
          OUTPUT deleted.cantidad AS antes, inserted.cantidad AS despues
          WHERE codigo_barras = @c AND ubicacion = @u`, { n: l.cantidad, c: str(l.codigo_barras, 50), u: str(ubic, 50) }, tx);
        if (!r.length) {
          sinConteo++;
          await q(`UPDATE ${T.lineas} SET sin_conteo = 1, surtido_qty = 0, ubicacion = @u WHERE id = @id`, { id: l.id, u: str(ubic, 50) }, tx);
          continue;
        }
        await q(`INSERT INTO ${T.mov} (codigo_barras, tipo, cantidad, ubicacion, stock_antes, stock_despues, motivo, notas, fecha)
                 VALUES (@c, 'salida', @n, @u, @antes, @despues, 'venta_web', @notas, GETDATE())`,
          { c: str(l.codigo_barras, 50), n: l.cantidad, u: str(ubic, 50), antes: r[0].antes, despues: r[0].despues, notas: str(ref, 200) }, tx);
        await q(`UPDATE ${T.lineas} SET sin_conteo = 0, surtido_qty = @n, ubicacion = @u WHERE id = @id`, { id: l.id, n: l.cantidad, u: str(ubic, 50) }, tx);
        descontadas++; unidades += l.cantidad;
      }
      await q(`UPDATE ${T.reservas} SET activa = 0, liberado = GETDATE(), motivo_liberacion = 'salida' WHERE pedido_id = @p AND activa = 1`, { p: pedidoId }, tx);
      await q(`UPDATE ${T.pedidos} SET estado = @e, surtido = 1, fecha_surtido = GETDATE(), actualizado = GETDATE() WHERE id = @id`,
        { id: pedidoId, e: str(estado, 20) }, tx);
      await evento(pedidoId, 'salida', { de: p.estado, a: estado, usuario,
        detalle: recorta(`${unidades} pza(s) en ${descontadas} línea(s) descontadas de bodega${sinConteo ? `; ${sinConteo} línea(s) sin conteo en su área (no se descontó)` : ''}${nota ? `. ${nota}` : ''}`, 400) }, tx);
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch { /* ya cerrada */ }
      throw e;
    }
    // Fuera de la transacción: avisar a Shopify (best-effort) y al sync.
    let shopifyOk = null;
    if (cfg.fulfill_en_shopify && p.estado_envio_shopify !== 'fulfilled') {
      shopifyOk = await fulfillEnShopify(p, usuario).catch(e => { console.error('[pedidos-web] fulfill falló:', e.message); return false; });
    }
    avisarSync();
    return { ok: true, descontadas, sinConteo, unidades, shopifyOk };
  });
}

async function fulfillEnShopify(p, usuario) {
  const perm = await permisos();
  if (!perm.fulfillment) {
    await evento(p.id, 'shopify', { usuario, detalle: 'No se marcó como preparado en Shopify: la app no tiene el permiso write_merchant_managed_fulfillment_orders' });
    return false;
  }
  const fo = await shopifyFetch(apiUrl(`orders/${p.shopify_order_id}/fulfillment_orders.json`));
  if (!fo.ok) { await evento(p.id, 'shopify', { usuario, detalle: `fulfillment_orders falló (HTTP ${fo.status})` }); return false; }
  const body = await fo.json();
  const abiertos = (body.fulfillment_orders || []).filter(f => ['open', 'in_progress', 'scheduled'].includes(f.status));
  if (!abiertos.length) { await evento(p.id, 'shopify', { usuario, detalle: 'Shopify ya lo tenía como preparado/enviado' }); return true; }
  const res = await shopifyFetch(apiUrl('fulfillments.json'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fulfillment: { line_items_by_fulfillment_order: abiertos.map(f => ({ fulfillment_order_id: f.id })), notify_customer: true } }),
  });
  const ok = res.ok;
  const txt = ok ? '' : (await res.text().catch(() => '')).slice(0, 200);
  await q(`UPDATE ${T.pedidos} SET shopify_fulfillment_ok = @ok, estado_envio_shopify = CASE WHEN @ok = 1 THEN 'fulfilled' ELSE estado_envio_shopify END WHERE id = @id`, { id: p.id, ok: ok ? 1 : 0 });
  await evento(p.id, 'shopify', { usuario, detalle: ok ? 'Marcado como preparado/enviado en Shopify (se notificó al cliente)' : `No se pudo marcar en Shopify (HTTP ${res.status}) ${txt}` });
  return ok;
}

// ── Cancelar (libera el apartado; si ya salió físicamente NO regresa stock solo).
async function cancelarPedido(pedidoId, { motivo = null, usuario = 'panel' } = {}) {
  return conCandado(`pedido:${pedidoId}`, async () => {
    const p = (await q(`SELECT * FROM ${T.pedidos} WHERE id = @id`, { id: pedidoId }))[0];
    if (!p) throw new Error('Pedido no encontrado');
    if (p.estado === 'cancelado') return { ok: true, yaCancelado: true };
    const pool = await mssql.getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const lib = await q(`UPDATE ${T.reservas} SET activa = 0, liberado = GETDATE(), motivo_liberacion = 'cancelado'
        OUTPUT deleted.codigo_barras, deleted.ubicacion, deleted.cantidad WHERE pedido_id = @p AND activa = 1`, { p: pedidoId }, tx);
      await q(`UPDATE ${T.pedidos} SET estado = 'cancelado', fecha_cancelado = GETDATE(), motivo_cancelacion = @m, actualizado = GETDATE() WHERE id = @id`,
        { id: pedidoId, m: str(motivo, 200) }, tx);
      const liberadas = lib.reduce((s, r) => s + (r.cantidad || 0), 0);
      const det = p.surtido
        ? `Ya se había entregado/enviado: la mercancía NO regresa sola a bodega. Si el cliente la devuelve, registra una ENTRADA con la TC52.`
        : `Se liberaron ${liberadas} pza(s) apartadas; vuelven a estar disponibles.`;
      await evento(pedidoId, 'cancelado', { de: p.estado, a: 'cancelado', usuario, detalle: recorta(`${motivo ? motivo + '. ' : ''}${det}`, 400) }, tx);
      await tx.commit();
      avisarSync();
      return { ok: true, liberadas, yaSurtido: !!p.surtido };
    } catch (e) {
      try { await tx.rollback(); } catch { /* ya cerrada */ }
      throw e;
    }
  });
}

// ── Cambio de estado genérico ──────────────────────────────────────────────────
async function cambiarEstado(pedidoId, { estado, usuario = 'panel', forzar = false, nota = null, motivo = null }) {
  if (!ESTADOS.includes(estado)) throw new Error(`Estado inválido: ${estado}`);
  if (estado === 'cancelado') return cancelarPedido(pedidoId, { motivo: motivo || nota, usuario });
  if (estado === 'entregado' || estado === 'enviado') return surtirPedido(pedidoId, { estado, usuario, forzar, nota });
  return conCandado(`pedido:${pedidoId}`, async () => {
    const p = (await q(`SELECT * FROM ${T.pedidos} WHERE id = @id`, { id: pedidoId }))[0];
    if (!p) throw new Error('Pedido no encontrado');
    if (p.estado === estado) return { ok: true };
    if (FINALES.has(p.estado)) return { ok: false, error: `El pedido ya está ${p.estado}; no se puede regresar a ${estado}` };
    await q(`UPDATE ${T.pedidos} SET estado = @e, actualizado = GETDATE() WHERE id = @id`, { id: pedidoId, e: str(estado, 20) });
    await evento(pedidoId, 'estado', { de: p.estado, a: estado, usuario, detalle: nota });
    return { ok: true };
  });
}

// ── Escaneo TC52: valida piezas, NO toca inventario ────────────────────────────
async function escanear(pedidoId, { codigo, cantidad = 1, usuario = 'TC52' }) {
  const n0 = Math.max(1, parseInt(cantidad) || 1);
  return conCandado(`pedido:${pedidoId}`, async () => {
    const p = (await q(`SELECT * FROM ${T.pedidos} WHERE id = @id`, { id: pedidoId }))[0];
    if (!p) return { ok: false, status: 404, error: 'Pedido no encontrado' };
    if (FINALES.has(p.estado)) return { ok: false, status: 409, error: `El pedido ya está ${p.estado}` };
    const { base, unidades } = await codigoBase(codigo);
    const n = n0 * unidades;
    const lineas = await q(`SELECT * FROM ${T.lineas} WHERE pedido_id = @p ORDER BY id`, { p: pedidoId });
    const cod = String(codigo || '').trim();
    const linea = lineas.find(l => l.codigo_barras && (l.codigo_barras.trim() === base || l.codigo_barras.trim() === cod))
      || lineas.find(l => l.sku && (l.sku.trim() === cod || l.sku.trim() === base));
    if (!linea) return { ok: false, status: 404, error: `Este producto (${cod}) no está en el pedido ${p.numero}`, codigo: cod };
    if (linea.escaneado >= linea.cantidad) return { ok: false, status: 409, error: `Ya escaneaste las ${linea.cantidad} pza(s) de ${linea.titulo}`, linea_id: linea.id };
    const nuevo = Math.min(linea.cantidad, linea.escaneado + n);
    await q(`UPDATE ${T.lineas} SET escaneado = @e WHERE id = @id`, { id: linea.id, e: nuevo });
    if (p.estado === 'nuevo') {
      await q(`UPDATE ${T.pedidos} SET estado = 'preparando', actualizado = GETDATE() WHERE id = @id`, { id: pedidoId });
      await evento(pedidoId, 'estado', { de: 'nuevo', a: 'preparando', usuario, detalle: 'Primer escaneo' });
    }
    const resto = lineas.map(l => (l.id === linea.id ? { ...l, escaneado: nuevo } : l));
    const completo = resto.every(l => l.cantidad <= 0 || l.escaneado >= l.cantidad);
    return { ok: true, linea: { id: linea.id, titulo: linea.titulo, cantidad: linea.cantidad, escaneado: nuevo, unidades }, completo,
      progreso: { escaneadas: resto.reduce((s, l) => s + Math.min(l.escaneado, l.cantidad), 0), total: resto.reduce((s, l) => s + l.cantidad, 0) } };
  });
}

// ── Lecturas ───────────────────────────────────────────────────────────────────
const SQL_LISTA_BASE = `
  SELECT p.*,
    (SELECT COUNT(*) FROM ${T.lineas} l WHERE l.pedido_id = p.id AND l.cantidad > 0) AS n_lineas,
    (SELECT ISNULL(SUM(l.cantidad), 0) FROM ${T.lineas} l WHERE l.pedido_id = p.id) AS unidades,
    (SELECT ISNULL(SUM(CASE WHEN l.escaneado > l.cantidad THEN l.cantidad ELSE l.escaneado END), 0) FROM ${T.lineas} l WHERE l.pedido_id = p.id) AS escaneadas,
    (SELECT ISNULL(SUM(l.faltante), 0) FROM ${T.lineas} l WHERE l.pedido_id = p.id) AS faltantes,
    (SELECT COUNT(*) FROM ${T.lineas} l WHERE l.pedido_id = p.id AND l.codigo_barras IS NULL AND l.cantidad > 0) AS sin_codigo
  FROM ${T.pedidos} p WITH (NOLOCK)`;

async function listarPedidos({ estado, q: texto, desde, hasta, limit = 100, offset = 0, activos } = {}) {
  const where = [];
  const params = {};
  if (estado && estado !== 'todos') {
    const lista = String(estado).split(',').map(s => s.trim()).filter(e => ESTADOS.includes(e));
    if (lista.length) where.push(`p.estado IN (${lista.map(e => `'${e}'`).join(',')})`);
  }
  if (activos) where.push(`p.estado IN ('nuevo','preparando','listo')`);
  if (texto) {
    params.txt = str(`%${texto}%`, 160);
    where.push(`(p.numero LIKE @txt OR p.cliente_nombre LIKE @txt OR p.cliente_email LIKE @txt OR p.cliente_telefono LIKE @txt
      OR EXISTS (SELECT 1 FROM ${T.lineas} l WHERE l.pedido_id = p.id AND (l.titulo LIKE @txt OR l.codigo_barras LIKE @txt)))`);
  }
  if (desde) { params.desde = str(desde, 10); where.push(`p.fecha_pedido >= CONVERT(DATETIME, @desde, 120)`); }
  if (hasta) { params.hasta = str(hasta, 10); where.push(`p.fecha_pedido < DATEADD(DAY, 1, CONVERT(DATETIME, @hasta, 120))`); }
  const lim = Math.min(500, Math.max(1, parseInt(limit) || 100));
  const off = Math.max(0, parseInt(offset) || 0);
  const sqlTxt = `${SQL_LISTA_BASE} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE p.estado WHEN 'nuevo' THEN 0 WHEN 'preparando' THEN 1 WHEN 'listo' THEN 2 ELSE 3 END, p.fecha_pedido DESC
    OFFSET ${off} ROWS FETCH NEXT ${lim} ROWS ONLY OPTION (MAXDOP 1)`;
  const rows = await q(sqlTxt, params);
  const total = (await q(`SELECT COUNT(*) AS n FROM ${T.pedidos} p WITH (NOLOCK) ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, params))[0].n;
  return { pedidos: rows, total, limit: lim, offset: off };
}

async function detallePedido(pedidoId) {
  const p = (await q(`${SQL_LISTA_BASE} WHERE p.id = @id`, { id: pedidoId }))[0];
  if (!p) return null;
  // OUTER APPLY TOP 1: VArticulosUnificados trae una fila por código alterno del
  // mismo artículo; un JOIN duplicaría líneas del pedido.
  const lineas = await q(`
    SELECT l.*, COALESCE(NULLIF(a.Art_Descripcion, ''), NULLIF(ib.nombre, '')) AS nombre_bodega
    FROM ${T.lineas} l
    LEFT JOIN ${T.inv} ib WITH (NOLOCK) ON ib.codigo_barras = l.codigo_barras AND ib.ubicacion = l.ubicacion
    OUTER APPLY (SELECT TOP 1 a2.Art_Descripcion FROM ${T.art} a2 WITH (NOLOCK) WHERE a2.Art_Codigo = l.codigo_barras) a
    WHERE l.pedido_id = @p ORDER BY l.id OPTION (MAXDOP 1)`, { p: pedidoId });
  const codigos = [...new Set(lineas.map(l => l.codigo_barras).filter(Boolean))];
  const stock = new Map();
  if (codigos.length) {
    const rows = await q(`SELECT codigo_barras, ubicacion, fisico, apartado, disponible FROM ${T.vista} WHERE codigo_barras IN (${codigos.map(c => `'${esc(c)}'`).join(',')})`);
    for (const r of rows) {
      const c = String(r.codigo_barras).trim();
      if (!stock.has(c)) stock.set(c, []);
      stock.get(c).push({ ubicacion: r.ubicacion, fisico: r.fisico, apartado: r.apartado, disponible: r.disponible });
    }
  }
  const reservas = await q(`SELECT * FROM ${T.reservas} WHERE pedido_id = @p ORDER BY id`, { p: pedidoId });
  const eventos = await q(`SELECT * FROM ${T.eventos} WHERE pedido_id = @p ORDER BY fecha DESC, id DESC`, { p: pedidoId });
  const activas = reservas.filter(r => r.activa);
  return {
    ...p,
    lineas: lineas.map(l => {
      const c = l.codigo_barras ? String(l.codigo_barras).trim() : null;
      const todas = c ? (stock.get(c) || []) : [];
      const enArea = todas.find(s => s.ubicacion === l.ubicacion) || null;
      const res = activas.filter(r => r.linea_id === l.id).reduce((s, r) => s + r.cantidad, 0);
      return { ...l, nombre_bodega: l.nombre_bodega || null, apartado_linea: res,
        stock_area: enArea, stock_otras: todas.filter(s => s.ubicacion !== l.ubicacion) };
    }),
    reservas, eventos,
    completo: lineas.every(l => l.cantidad <= 0 || l.escaneado >= l.cantidad),
    pago_ok: PAGO_OK.has(p.estado_pago),
  };
}

// Rango de fechas por periodo: EXACTAMENTE la misma semántica que el dashboard
// (novacaja-mapping._ticketDateFilter): day = hoy calendario, week/days30 = móviles
// desde ahora, month = mes calendario. GETDATE() ya es CDMX.
function rangoPeriodo(period) {
  switch (period) {
    case 'week':   return `p.fecha_pedido >= DATEADD(DAY, -7, GETDATE())`;
    case 'days30': return `p.fecha_pedido >= DATEADD(DAY, -30, GETDATE())`;
    case 'month':  return `p.fecha_pedido >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)`;
    case 'all':    return `1 = 1`;
    default:       return `CAST(p.fecha_pedido AS DATE) = CAST(GETDATE() AS DATE)`;
  }
}
async function ventas(period = 'day') {
  const rango = rangoPeriodo(period);
  const validas = `${rango} AND p.estado <> 'cancelado'`;
  const [tot] = await q(`
    SELECT COUNT(*) AS pedidos, ISNULL(SUM(p.total), 0) AS total, ISNULL(SUM(p.subtotal), 0) AS subtotal,
           ISNULL(SUM(p.envio), 0) AS envio, ISNULL(SUM(p.descuentos), 0) AS descuentos,
           ISNULL(SUM(CASE WHEN p.estado_pago IN ('paid','partially_paid','authorized','partially_refunded') THEN p.total ELSE 0 END), 0) AS total_pagado,
           SUM(CASE WHEN p.estado_pago IN ('paid','partially_paid','authorized','partially_refunded') THEN 0 ELSE 1 END) AS pendientes_pago,
           (SELECT ISNULL(SUM(l.cantidad), 0) FROM ${T.lineas} l JOIN ${T.pedidos} p2 ON p2.id = l.pedido_id WHERE ${validas.replace(/p\./g, 'p2.')}) AS unidades,
           (SELECT COUNT(*) FROM ${T.pedidos} p3 WITH (NOLOCK) WHERE ${rango.replace(/p\./g, 'p3.')} AND p3.estado = 'cancelado') AS cancelados,
           (SELECT ISNULL(SUM(p4.total), 0) FROM ${T.pedidos} p4 WITH (NOLOCK) WHERE ${rango.replace(/p\./g, 'p4.')} AND p4.estado = 'cancelado') AS total_cancelado
    FROM ${T.pedidos} p WITH (NOLOCK) WHERE ${validas} OPTION (MAXDOP 1)`);
  const porDia = await q(`
    SELECT CONVERT(VARCHAR(10), p.fecha_pedido, 120) AS fecha, COUNT(*) AS pedidos, ISNULL(SUM(p.total), 0) AS total
    FROM ${T.pedidos} p WITH (NOLOCK) WHERE ${validas}
    GROUP BY CONVERT(VARCHAR(10), p.fecha_pedido, 120) ORDER BY fecha OPTION (MAXDOP 1)`);
  const porEstado = await q(`SELECT p.estado, COUNT(*) AS n, ISNULL(SUM(p.total), 0) AS total FROM ${T.pedidos} p WITH (NOLOCK) WHERE ${rango} GROUP BY p.estado`);
  const porEntrega = await q(`SELECT p.tipo_entrega, COUNT(*) AS n, ISNULL(SUM(p.total), 0) AS total FROM ${T.pedidos} p WITH (NOLOCK) WHERE ${validas} GROUP BY p.tipo_entrega`);
  const top = await q(`
    SELECT TOP 15 ISNULL(l.codigo_barras, '') AS codigo, MIN(l.titulo) AS titulo, SUM(l.cantidad) AS unidades, ISNULL(SUM(l.total), 0) AS total, COUNT(DISTINCT l.pedido_id) AS pedidos
    FROM ${T.lineas} l JOIN ${T.pedidos} p WITH (NOLOCK) ON p.id = l.pedido_id
    WHERE ${validas} AND l.cantidad > 0
    GROUP BY ISNULL(l.codigo_barras, ''), l.titulo ORDER BY unidades DESC, total DESC OPTION (MAXDOP 1)`);
  return {
    period, ...tot,
    ticket_promedio: tot.pedidos ? Math.round((Number(tot.total) / tot.pedidos) * 100) / 100 : 0,
    por_dia: porDia, por_estado: porEstado, por_entrega: porEntrega, top_productos: top,
  };
}

async function contadores() {
  const [c] = await q(`
    SELECT
      ISNULL(SUM(CASE WHEN estado = 'nuevo' THEN 1 ELSE 0 END), 0) AS nuevos,
      ISNULL(SUM(CASE WHEN estado = 'preparando' THEN 1 ELSE 0 END), 0) AS preparando,
      ISNULL(SUM(CASE WHEN estado = 'listo' THEN 1 ELSE 0 END), 0) AS listos,
      ISNULL(SUM(CASE WHEN estado IN ('entregado','enviado') AND fecha_surtido >= CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END), 0) AS surtidos_hoy,
      ISNULL(SUM(CASE WHEN estado IN ('nuevo','preparando','listo') AND ISNULL(estado_pago, '') NOT IN ('paid','partially_paid','authorized','partially_refunded') THEN 1 ELSE 0 END), 0) AS pago_pendiente,
      ISNULL(SUM(CASE WHEN fecha_pedido >= CAST(GETDATE() AS DATE) AND estado <> 'cancelado' THEN 1 ELSE 0 END), 0) AS pedidos_hoy,
      ISNULL(SUM(CASE WHEN fecha_pedido >= CAST(GETDATE() AS DATE) AND estado <> 'cancelado' THEN total ELSE 0 END), 0) AS ventas_hoy
    FROM ${T.pedidos} WITH (NOLOCK)`);
  const [f] = await q(`SELECT COUNT(DISTINCT l.pedido_id) AS con_faltantes FROM ${T.lineas} l JOIN ${T.pedidos} p ON p.id = l.pedido_id
    WHERE p.estado IN ('nuevo','preparando','listo') AND (l.faltante > 0 OR (l.codigo_barras IS NULL AND l.cantidad > 0))`);
  const [r] = await q(`SELECT COUNT(*) AS reservas, ISNULL(SUM(cantidad), 0) AS apartadas FROM ${T.reservas} WITH (NOLOCK) WHERE activa = 1`);
  return { ...c, con_faltantes: f.con_faltantes, reservas_activas: r.reservas, unidades_apartadas: r.apartadas };
}

// ── Sincronización con Shopify ─────────────────────────────────────────────────
let sincronizando = false;
let ultimoResultado = null;
let reintentoToken403 = 0;
async function listarOrders(params) {
  const out = [];
  let url = apiUrl(`orders.json?limit=250&fields=${FIELDS}&${params}`);
  while (url) {
    let res = await shopifyFetch(url);
    // 403 = el token no trae read_orders. Como los permisos van pegados al token
    // (dura 24 h), si acaban de aprobarse en la tienda hay que pedir uno nuevo:
    // se reintenta con token fresco, a lo más una vez cada 5 min.
    if (res.status === 403 && Date.now() - reintentoToken403 > 5 * 60 * 1000) {
      reintentoToken403 = Date.now();
      await shopify.getToken(true);
      permisosCache = { ...permisosCache, fecha: 0 };
      res = await shopifyFetch(url);
    }
    if (res.status === 403) {
      const err = new Error('La app de Shopify no tiene el permiso read_orders (falta aprobarlo en la tienda)');
      err.code = 'SIN_PERMISO';
      throw err;
    }
    if (!res.ok) throw new Error(`orders.json falló (HTTP ${res.status})`);
    const body = await res.json();
    out.push(...(body.orders || []));
    const link = res.headers.get('link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
    await sleep(400);
  }
  return out;
}

async function sincronizar({ manual = false } = {}) {
  if (!configurado()) return { error: 'Faltan credenciales de Shopify en .env' };
  if (sincronizando) return { skip: 'ya hay una sincronización corriendo' };
  sincronizando = true;
  const inicio = Date.now();
  const stats = { vistos: 0, nuevos: 0, actualizados: 0, reservados: 0, cancelados: 0, surtidos: 0, errores: 0 };
  try {
    const cfg = await getConfig();
    const desdeIso = naiveAIso(cfg.desde);
    const ventana = cfg.ultima_sync ? naiveAIso(new Date(cfg.ultima_sync.getTime() - 15 * 60 * 1000)) : desdeIso;
    // 1) todos los pedidos ABIERTOS desde `desde` (fuente de verdad de lo activo)
    // 2) lo que CAMBIÓ recientemente, de cualquier estado (cancelaciones, pagos, cierres)
    const abiertos = await listarOrders(`status=open&created_at_min=${encodeURIComponent(desdeIso)}`);
    const cambiados = await listarOrders(`status=any&created_at_min=${encodeURIComponent(desdeIso)}&updated_at_min=${encodeURIComponent(ventana)}`);
    const porId = new Map();
    for (const o of [...abiertos, ...cambiados]) porId.set(o.id, o);
    for (const o of porId.values()) {
      stats.vistos++;
      try { await ingerirOrder(o, cfg, stats); }
      catch (e) { stats.errores++; console.error(`[pedidos-web] Pedido ${o.name}:`, e.message); }
    }
    const resumen = `${stats.vistos} pedido(s) revisados: ${stats.nuevos} nuevos, ${stats.reservados} apartados, ${stats.surtidos} surtidos, ${stats.cancelados} cancelados${stats.errores ? `, ${stats.errores} errores` : ''} | ${Math.round((Date.now() - inicio) / 1000)}s`;
    await q(`UPDATE ${T.config} SET ultima_sync = GETDATE(), ultimo_resumen = @r, ultimo_error = NULL WHERE id = 1`, { r: str(resumen, 500) });
    ultimoResultado = { fecha: new Date().toISOString(), ...stats, resumen, manual };
    if (stats.nuevos || stats.reservados || stats.surtidos || stats.cancelados || manual) console.log(`[pedidos-web] ${resumen}`);
    return ultimoResultado;
  } catch (e) {
    const msg = e.code === 'SIN_PERMISO' ? e.message : `Sync falló: ${e.message}`;
    await q(`UPDATE ${T.config} SET ultimo_error = @e WHERE id = 1`, { e: str(msg, 500) }).catch(() => {});
    ultimoResultado = { fecha: new Date().toISOString(), error: msg, ...stats, manual };
    if (e.code !== 'SIN_PERMISO' || manual) console.error(`[pedidos-web] ${msg}`);
    return ultimoResultado;
  } finally {
    sincronizando = false;
  }
}

// Empujón al sync de inventario (best-effort): el disponible acaba de cambiar.
let avisoPendiente = null;
function avisarSync() {
  if (avisoPendiente) return;
  avisoPendiente = setTimeout(async () => {
    avisoPendiente = null;
    try {
      const sync = require('./shopify-sync');
      if (typeof sync.correrSiActivo === 'function') await sync.correrSiActivo();
    } catch (e) { console.error('[pedidos-web] aviso a shopify-sync falló:', e.message); }
  }, 3000);
}

let ultimoIntentoSinPermiso = 0;
function startScheduler() {
  if (!configurado()) { console.log('[pedidos-web] Sin credenciales de Shopify en .env — pedidos web deshabilitados.'); return; }
  migrar().then(() => console.log('[pedidos-web] Tablas listas.')).catch(e => console.error('[pedidos-web] Migración falló:', e.message));
  setInterval(async () => {
    try {
      const cfg = await getConfig();
      if (!cfg.activo) return;
      const cada = Math.max(1, cfg.intervalo_min || 2) * 60 * 1000;
      const ultima = cfg.ultima_sync ? cfg.ultima_sync.getTime() + 6 * 3600 * 1000 : 0; // naive CDMX -> instante real
      if (Date.now() - ultima < cada) return;
      if (cfg.ultimo_error && /read_orders/.test(cfg.ultimo_error) && Date.now() - ultimoIntentoSinPermiso < 10 * 60 * 1000) return;
      ultimoIntentoSinPermiso = Date.now();
      await sincronizar();
    } catch (e) { console.error('[pedidos-web] Error en ciclo:', e.message); }
  }, 30 * 1000);
  console.log('[pedidos-web] Scheduler listo (revisa cada 30 s; sincroniza según intervalo_min).');
}

// ── Endpoints ──────────────────────────────────────────────────────────────────
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error('[pedidos-web]', e.message); res.status(500).json({ error: e.message }); });
const usuarioDe = req => recorta((req.body && req.body.usuario) || req.query.usuario || req.get('x-usuario') || 'panel', 60);

router.get('/estado', wrap(async (req, res) => {
  if (!configurado()) return res.json({ configurado: false, activo: false, permisos: { read_orders: false, fulfillment: false }, contadores: null });
  const cfg = await getConfig();
  const perm = await permisos(req.query.refrescar === '1');
  let cont = null;
  try { cont = await contadores(); } catch { /* tablas nuevas */ }
  res.json({
    configurado: true, activo: !!cfg.activo, intervalo_min: cfg.intervalo_min, desde: cfg.desde,
    ultima_sync: cfg.ultima_sync, ultimo_resumen: cfg.ultimo_resumen, ultimo_error: cfg.ultimo_error,
    ultimo_resultado: ultimoResultado, sincronizando,
    permisos: { read_orders: perm.read_orders, fulfillment: perm.fulfillment, scopes: perm.scopes, error: perm.error },
    config: {
      ubicacion_default: cfg.ubicacion_default, ubicaciones_orden: cfg.orden, reservar_sin_pago: !!cfg.reservar_sin_pago,
      salida_por_fulfillment: !!cfg.salida_por_fulfillment, fulfill_en_shopify: !!cfg.fulfill_en_shopify,
    },
    contadores: cont,
    tienda: shopify.SHOP ? `https://admin.shopify.com/store/${shopify.SHOP}` : null,
  });
}));

router.put('/config', wrap(async (req, res) => {
  const b = req.body || {};
  const sets = []; const params = {};
  if (b.activo != null) { sets.push('activo = @activo'); params.activo = b.activo ? 1 : 0; }
  if (b.intervalo_min != null) { sets.push('intervalo_min = @im'); params.im = Math.min(60, Math.max(1, parseInt(b.intervalo_min) || 2)); }
  if (b.ubicacion_default) { sets.push('ubicacion_default = @ud'); params.ud = str(b.ubicacion_default, 50); }
  if (Array.isArray(b.ubicaciones_orden)) { sets.push('ubicaciones_orden = @uo'); params.uo = str(b.ubicaciones_orden.join(','), 200); }
  if (b.reservar_sin_pago != null) { sets.push('reservar_sin_pago = @rsp'); params.rsp = b.reservar_sin_pago ? 1 : 0; }
  if (b.salida_por_fulfillment != null) { sets.push('salida_por_fulfillment = @spf'); params.spf = b.salida_por_fulfillment ? 1 : 0; }
  if (b.fulfill_en_shopify != null) { sets.push('fulfill_en_shopify = @fes'); params.fes = b.fulfill_en_shopify ? 1 : 0; }
  if (b.desde) { sets.push('desde = CONVERT(DATETIME, @desde, 120)'); params.desde = str(b.desde, 19); }
  await migrar();
  if (sets.length) await q(`UPDATE ${T.config} SET ${sets.join(', ')} WHERE id = 1`, params);
  const cfg = await getConfig();
  res.json({ ok: true, config: cfg });
}));

router.post('/sincronizar', wrap(async (req, res) => {
  if (!configurado()) return res.status(400).json({ error: 'Faltan credenciales de Shopify en .env' });
  await migrar();
  res.json(await sincronizar({ manual: true }));
}));

router.get('/pedidos', wrap(async (req, res) => {
  await migrar();
  res.json(await listarPedidos({ estado: req.query.estado, q: req.query.q, desde: req.query.desde, hasta: req.query.hasta,
    limit: req.query.limit, offset: req.query.offset, activos: req.query.activos === '1' }));
}));

router.get('/pedidos/:id', wrap(async (req, res) => {
  const p = await detallePedido(parseInt(req.params.id));
  if (!p) return res.status(404).json({ error: 'Pedido no encontrado' });
  res.json(p);
}));

router.post('/pedidos/:id/estado', wrap(async (req, res) => {
  const b = req.body || {};
  const r = await cambiarEstado(parseInt(req.params.id), { estado: b.estado, usuario: usuarioDe(req), forzar: !!b.forzar, nota: b.nota || null, motivo: b.motivo || null });
  if (r && r.ok === false) return res.status(r.requiereForzar ? 402 : 409).json(r);
  res.json({ ...r, pedido: await detallePedido(parseInt(req.params.id)) });
}));

router.post('/pedidos/:id/escanear', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.codigo) return res.status(400).json({ error: 'Falta el código' });
  const r = await escanear(parseInt(req.params.id), { codigo: b.codigo, cantidad: b.cantidad, usuario: usuarioDe(req) });
  if (!r.ok) return res.status(r.status || 400).json(r);
  res.json(r);
}));

router.post('/pedidos/:id/lineas/:lid/escaneado', wrap(async (req, res) => {
  const id = parseInt(req.params.id), lid = parseInt(req.params.lid);
  const b = req.body || {};
  const l = (await q(`SELECT * FROM ${T.lineas} WHERE id = @l AND pedido_id = @p`, { l: lid, p: id }))[0];
  if (!l) return res.status(404).json({ error: 'Línea no encontrada' });
  const e = Math.max(0, Math.min(l.cantidad, parseInt(b.escaneado) || 0));
  await q(`UPDATE ${T.lineas} SET escaneado = @e WHERE id = @l`, { l: lid, e });
  const p = (await q(`SELECT estado FROM ${T.pedidos} WHERE id = @id`, { id }))[0];
  if (p && p.estado === 'nuevo' && e > 0) {
    await q(`UPDATE ${T.pedidos} SET estado = 'preparando', actualizado = GETDATE() WHERE id = @id`, { id });
    await evento(id, 'estado', { de: 'nuevo', a: 'preparando', usuario: usuarioDe(req), detalle: 'Conteo manual' });
  }
  res.json({ ok: true, pedido: await detallePedido(id) });
}));

router.post('/pedidos/:id/escaneo/reset', wrap(async (req, res) => {
  const id = parseInt(req.params.id);
  await q(`UPDATE ${T.lineas} SET escaneado = 0 WHERE pedido_id = @p`, { p: id });
  await evento(id, 'escaneo', { usuario: usuarioDe(req), detalle: 'Se reinició el escaneo' });
  res.json({ ok: true, pedido: await detallePedido(id) });
}));

router.post('/pedidos/:id/reservar', wrap(async (req, res) => {
  const id = parseInt(req.params.id);
  const r = await conCandado(`pedido:${id}`, () => reservarPedido(id, { usuario: usuarioDe(req), motivo: 'reasignado' }));
  res.json({ ...r, pedido: await detallePedido(id) });
}));

router.post('/pedidos/:id/ubicacion', wrap(async (req, res) => {
  const id = parseInt(req.params.id);
  const u = recorta((req.body || {}).ubicacion, 50);
  if (!u) return res.status(400).json({ error: 'Falta la ubicación' });
  const p = (await q(`SELECT * FROM ${T.pedidos} WHERE id = @id`, { id }))[0];
  if (!p) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (p.surtido) return res.status(409).json({ error: 'El pedido ya salió de bodega' });
  await q(`UPDATE ${T.pedidos} SET ubicacion = @u, actualizado = GETDATE() WHERE id = @id`, { id, u: str(u, 50) });
  await q(`UPDATE ${T.lineas} SET ubicacion = @u, ubicacion_fija = 0 WHERE pedido_id = @p`, { p: id, u: str(u, 50) });
  await evento(id, 'ubicacion', { de: p.ubicacion, a: u, usuario: usuarioDe(req), detalle: `Se surtirá desde ${u}` });
  const r = p.estado !== 'cancelado' ? await conCandado(`pedido:${id}`, () => reservarPedido(id, { usuario: usuarioDe(req), motivo: 'reasignado' })) : { ok: true };
  res.json({ ...r, pedido: await detallePedido(id) });
}));

router.put('/pedidos/:id/lineas/:lid', wrap(async (req, res) => {
  const id = parseInt(req.params.id), lid = parseInt(req.params.lid);
  const b = req.body || {};
  const l = (await q(`SELECT * FROM ${T.lineas} WHERE id = @l AND pedido_id = @p`, { l: lid, p: id }))[0];
  if (!l) return res.status(404).json({ error: 'Línea no encontrada' });
  const p = (await q(`SELECT * FROM ${T.pedidos} WHERE id = @id`, { id }))[0];
  if (p.surtido) return res.status(409).json({ error: 'El pedido ya salió de bodega' });
  const sets = []; const params = { l: lid };
  const cambios = [];
  if (b.codigo_barras !== undefined) {
    const { base } = await codigoBase(b.codigo_barras);
    sets.push('codigo_barras = @c'); params.c = str(base || null, 50);
    cambios.push(`código ${l.codigo_barras || '-'} -> ${base || '-'}`);
  }
  if (b.ubicacion !== undefined) {
    sets.push('ubicacion = @u, ubicacion_fija = @fija'); params.u = str(b.ubicacion || null, 50); params.fija = b.ubicacion ? 1 : 0;
    cambios.push(`ubicación ${l.ubicacion || '-'} -> ${b.ubicacion || '-'}`);
  }
  if (b.cantidad !== undefined) {
    const n = Math.max(0, parseInt(b.cantidad) || 0);
    sets.push('cantidad = @n, total = CASE WHEN precio IS NULL THEN total ELSE precio * @n - ISNULL(descuento, 0) END'); params.n = n;
    cambios.push(`cantidad ${l.cantidad} -> ${n}`);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada que cambiar' });
  await q(`UPDATE ${T.lineas} SET ${sets.join(', ')} WHERE id = @l`, params);
  await evento(id, 'linea', { usuario: usuarioDe(req), detalle: recorta(`${l.titulo}: ${cambios.join(', ')}`, 400) });
  const r = p.estado !== 'cancelado' ? await conCandado(`pedido:${id}`, () => reservarPedido(id, { usuario: usuarioDe(req), motivo: 'reasignado' })) : { ok: true };
  res.json({ ...r, pedido: await detallePedido(id) });
}));

router.post('/pedidos/:id/nota', wrap(async (req, res) => {
  const id = parseInt(req.params.id);
  const nota = recorta((req.body || {}).notas_internas, 500);
  await q(`UPDATE ${T.pedidos} SET notas_internas = @n, actualizado = GETDATE() WHERE id = @id`, { id, n: str(nota, 500) });
  res.json({ ok: true });
}));

router.post('/pedidos/:id/entrega', wrap(async (req, res) => {
  const id = parseInt(req.params.id);
  const t = (req.body || {}).tipo_entrega;
  if (!TIPOS_ENTREGA.includes(t)) return res.status(400).json({ error: 'Tipo de entrega inválido' });
  await q(`UPDATE ${T.pedidos} SET tipo_entrega = @t, actualizado = GETDATE() WHERE id = @id`, { id, t: str(t, 20) });
  await evento(id, 'entrega', { a: t, usuario: usuarioDe(req), detalle: `Tipo de entrega: ${t}` });
  res.json({ ok: true, pedido: await detallePedido(id) });
}));

router.get('/ventas', wrap(async (req, res) => { await migrar(); res.json(await ventas(req.query.period || 'day')); }));

router.get('/stock/:codigo', wrap(async (req, res) => {
  const { base } = await codigoBase(req.params.codigo);
  const rows = await q(`SELECT ubicacion, fisico, apartado, disponible FROM ${T.vista} WHERE codigo_barras = @c ORDER BY ubicacion`, { c: str(base, 50) });
  const reservas = await q(`SELECT r.ubicacion, r.cantidad, p.numero, p.id AS pedido_id, p.estado, p.cliente_nombre
    FROM ${T.reservas} r JOIN ${T.pedidos} p ON p.id = r.pedido_id WHERE r.activa = 1 AND r.codigo_barras = @c ORDER BY r.id`, { c: str(base, 50) });
  res.json({ codigo: base, ubicaciones: rows, reservas });
}));

router.get('/reservas', wrap(async (req, res) => {
  await migrar();
  const rows = await q(`
    SELECT r.id, r.codigo_barras, r.ubicacion, r.cantidad, r.creado, p.id AS pedido_id, p.numero, p.estado, p.cliente_nombre,
           COALESCE(NULLIF(ib.nombre, ''), NULLIF(a.Art_Descripcion, ''), l.titulo) AS nombre
    FROM ${T.reservas} r
    JOIN ${T.pedidos} p ON p.id = r.pedido_id
    LEFT JOIN ${T.lineas} l ON l.id = r.linea_id
    LEFT JOIN ${T.inv} ib WITH (NOLOCK) ON ib.codigo_barras = r.codigo_barras AND ib.ubicacion = r.ubicacion
    OUTER APPLY (SELECT TOP 1 a2.Art_Descripcion FROM ${T.art} a2 WITH (NOLOCK) WHERE a2.Art_Codigo = r.codigo_barras) a
    WHERE r.activa = 1 ORDER BY r.creado DESC OPTION (MAXDOP 1)`);
  res.json({ reservas: rows });
}));

// Movimientos "virtuales" de pedidos web para el feed de Movimientos del admin:
// apartados/liberaciones (no están en movimientos_bodega) + salidas venta_web (sí están).
router.get('/movimientos', wrap(async (req, res) => {
  await migrar();
  const dias = Math.min(90, Math.max(1, parseInt(req.query.dias) || 7));
  const rows = await q(`
    SELECT r.id, r.creado AS fecha, 'apartado' AS tipo, r.cantidad, r.ubicacion, r.codigo_barras, p.numero, p.id AS pedido_id, p.estado, p.cliente_nombre,
           COALESCE(NULLIF(ib.nombre, ''), NULLIF(a.Art_Descripcion, ''), l.titulo) AS nombre
    FROM ${T.reservas} r JOIN ${T.pedidos} p ON p.id = r.pedido_id
    LEFT JOIN ${T.lineas} l ON l.id = r.linea_id
    LEFT JOIN ${T.inv} ib WITH (NOLOCK) ON ib.codigo_barras = r.codigo_barras AND ib.ubicacion = r.ubicacion
    OUTER APPLY (SELECT TOP 1 a2.Art_Descripcion FROM ${T.art} a2 WITH (NOLOCK) WHERE a2.Art_Codigo = r.codigo_barras) a
    WHERE r.creado >= DATEADD(DAY, -@d, CAST(GETDATE() AS DATE))
    UNION ALL
    SELECT r.id, r.liberado, CASE WHEN r.motivo_liberacion = 'salida' THEN 'salida_web' ELSE 'liberado' END, r.cantidad, r.ubicacion, r.codigo_barras, p.numero, p.id, p.estado, p.cliente_nombre,
           COALESCE(NULLIF(ib.nombre, ''), NULLIF(a.Art_Descripcion, ''), l.titulo)
    FROM ${T.reservas} r JOIN ${T.pedidos} p ON p.id = r.pedido_id
    LEFT JOIN ${T.lineas} l ON l.id = r.linea_id
    LEFT JOIN ${T.inv} ib WITH (NOLOCK) ON ib.codigo_barras = r.codigo_barras AND ib.ubicacion = r.ubicacion
    OUTER APPLY (SELECT TOP 1 a2.Art_Descripcion FROM ${T.art} a2 WITH (NOLOCK) WHERE a2.Art_Codigo = r.codigo_barras) a
    WHERE r.activa = 0 AND r.liberado >= DATEADD(DAY, -@d, CAST(GETDATE() AS DATE)) AND r.motivo_liberacion IN ('cancelado', 'salida')
    ORDER BY fecha DESC OPTION (MAXDOP 1)`, { d: dias });
  res.json({ movimientos: rows });
}));

// Pedidos "vivos" para la TC52 (compacto)
router.get('/pendientes', wrap(async (req, res) => {
  await migrar();
  const r = await listarPedidos({ activos: true, limit: 200 });
  res.json(r.pedidos.map(p => ({ id: p.id, numero: p.numero, estado: p.estado, cliente_nombre: p.cliente_nombre, fecha_pedido: p.fecha_pedido,
    tipo_entrega: p.tipo_entrega, total: p.total, n_lineas: p.n_lineas, unidades: p.unidades, escaneadas: p.escaneadas, faltantes: p.faltantes,
    sin_codigo: p.sin_codigo, ubicacion: p.ubicacion, estado_pago: p.estado_pago, pago_ok: PAGO_OK.has(p.estado_pago), notas_cliente: p.notas_cliente })));
}));

module.exports = {
  router, startScheduler, migrar, sincronizar, ingerirOrder, reservarPedido, surtirPedido, cancelarPedido,
  cambiarEstado, escanear, detallePedido, listarPedidos, ventas, contadores, getConfig, permisos, PAGO_OK, ESTADOS,
};
