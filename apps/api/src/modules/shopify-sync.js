// ============================================================================
// shopify-sync.js — Empuja el inventario de bodega (Casita 1 + Casita 2 + Bodega)
// a la tienda en línea de Shopify, emparejando por CÓDIGO DE BARRAS.
//
// Cómo funciona:
//  - Cada SHOPIFY_SYNC_INTERVAL_MIN minutos suma inventario_bodega por código
//    (solo las áreas de SHOPIFY_SYNC_AREAS) y empuja a Shopify los que CAMBIARON
//    desde el último empuje (delta contra shopify_sync_estado). Negativos van
//    como 0. Productos SIN registro en bodega NO se tocan (no inventamos ceros).
//  - El mapa barcode -> inventory_item_id se baja del API y se refresca cada
//    SHOPIFY_SYNC_REFRESH_HORAS; en cada refresh también RECONCILIA (si alguien
//    movió el número en Shopify a mano, se vuelve a imponer el de bodega).
//  - Token por client_credentials (dura 24 h): se renueva solo al acercarse a
//    vencer o si el API contesta 401.
//  - Prende/apaga con shopify_sync_config.activo (tabla, id=1) — igual que
//    ventas-sync. APAGADO por defecto al crearse.
// ============================================================================
const express = require('express');
const mssql   = require('../db/mssql');
const shopify = require('./shopify-api');

const router = express.Router();

const { LOCATION_ID, apiUrl, shopifyFetch, configurado } = shopify;
const INTERVAL_MIN  = Math.max(1, parseInt(process.env.SHOPIFY_SYNC_INTERVAL_MIN || '5'));
const REFRESH_HORAS = Math.max(1, parseInt(process.env.SHOPIFY_SYNC_REFRESH_HORAS || '6'));
const AREAS_ENV = (process.env.SHOPIFY_SYNC_AREAS || 'Casita 1,Casita 2,Bodega')
  .split(',').map(s => s.trim()).filter(Boolean);

// ── Migración ligera: tablas de config y estado ────────────────────────────────
async function migrar() {
  await mssql.query(`
    IF OBJECT_ID('[compucaja].[dbo].[shopify_sync_config]') IS NULL BEGIN
      CREATE TABLE [compucaja].[dbo].[shopify_sync_config] (
        id INT PRIMARY KEY, activo BIT NOT NULL DEFAULT 0,
        ultimo_run DATETIME NULL, ultimo_resumen VARCHAR(500) NULL
      );
      INSERT INTO [compucaja].[dbo].[shopify_sync_config] (id, activo) VALUES (1, 0);
    END;
    IF OBJECT_ID('[compucaja].[dbo].[shopify_sync_estado]') IS NULL
      CREATE TABLE [compucaja].[dbo].[shopify_sync_estado] (
        codigo_barras VARCHAR(50) PRIMARY KEY,
        ultima_qty INT NOT NULL,
        actualizado DATETIME NOT NULL DEFAULT GETDATE()
      );
    -- Áreas que cuentan para la página web (antes solo se podían cambiar en el .env)
    IF COL_LENGTH('[compucaja].[dbo].[shopify_sync_config]', 'areas') IS NULL
      ALTER TABLE [compucaja].[dbo].[shopify_sync_config] ADD areas VARCHAR(300) NULL;
    -- Productos que Shopify RECHAZA (422 = esa variante no lleva control de
    -- inventario). Se marcan para no reintentar cada ciclo y poder avisarlo.
    IF COL_LENGTH('[compucaja].[dbo].[shopify_sync_estado]', 'bloqueado_hasta') IS NULL
      ALTER TABLE [compucaja].[dbo].[shopify_sync_estado] ADD bloqueado_hasta DATETIME NULL;
    IF COL_LENGTH('[compucaja].[dbo].[shopify_sync_estado]', 'motivo_bloqueo') IS NULL
      ALTER TABLE [compucaja].[dbo].[shopify_sync_estado] ADD motivo_bloqueo VARCHAR(200) NULL;
  `);
}

async function getConfig() {
  const r = await mssql.query(`SELECT TOP 1 * FROM [compucaja].[dbo].[shopify_sync_config] WHERE id = 1`);
  return r.recordset && r.recordset[0] ? r.recordset[0] : null;
}

// Áreas cuyo stock cuenta para la página web. Vive en la config (editable desde
// el panel); el .env es solo el valor inicial. Cache corto: lo consulta cada
// ciclo del sync y también el panel "Página web".
let areasCache = { fecha: 0, areas: AREAS_ENV };
async function getAreas() {
  if (Date.now() - areasCache.fecha < 60 * 1000) return areasCache.areas;
  let areas = AREAS_ENV;
  try {
    const cfg = await getConfig();
    if (cfg && cfg.areas) {
      const lista = String(cfg.areas).split(',').map(s => s.trim()).filter(Boolean);
      if (lista.length) areas = lista;
    }
  } catch { /* sin BD: se queda con el .env */ }
  areasCache = { fecha: Date.now(), areas };
  return areas;
}
const invalidarAreas = () => { areasCache.fecha = 0; };

// ── Mapa barcode -> { inventory_item_id, qty en Shopify } ─────────────────────
let mapa = null;          // Map(barcode -> {itemId, qty})
let porVariante = new Map(); // Map(variant_id -> barcode) — lo usa pedidos-web para las líneas de un pedido
let mapaFecha = 0;
async function cargarMapa(forzar = false) {
  if (!forzar && mapa && Date.now() - mapaFecha < REFRESH_HORAS * 3600 * 1000) return mapa;
  const m = new Map();
  const pv = new Map();
  for (const p of await shopify.listarProductos('id,variants')) {
    for (const v of p.variants || []) {
      const bc = (v.barcode || '').trim();
      if (bc) m.set(bc, { itemId: v.inventory_item_id, qty: v.inventory_quantity });
      if (v.id) pv.set(Number(v.id), bc || null);
    }
  }
  mapa = m;
  porVariante = pv;
  mapaFecha = Date.now();
  console.log(`[shopify-sync] Mapa refrescado: ${m.size} variantes con barcode`);
  return m;
}
// Código de barras de una variante (desde el mapa en memoria; null si no se conoce).
async function barcodeDeVariante(variantId) {
  if (!mapa) { try { await cargarMapa(); } catch { return null; } }
  return porVariante.get(Number(variantId)) || null;
}

// ── Stock objetivo desde bodega ────────────────────────────────────────────────
// Se empuja el DISPONIBLE = físico − apartado por pedidos web (reservas_bodega
// activas). Así la web nunca vuelve a vender lo que ya está apartado para un
// pedido en línea, y no "regresa" el stock cuando Shopify lo descuenta solo.
let hayReservas = false; // se vuelve true en cuanto exista la tabla (la crea pedidos-web)
async function stockBodega() {
  const areas = await getAreas();
  const enList = areas.map(a => `'${a.replace(/'/g, "''")}'`).join(',');
  if (!hayReservas) {
    // SQL Server enlaza TODAS las tablas al compilar: no sirve un CASE/WHERE con
    // OBJECT_ID. Se pregunta primero y se arma la consulta según exista o no.
    const t = await mssql.query(`SELECT OBJECT_ID('[compucaja].[dbo].[reservas_bodega]') AS oid`);
    hayReservas = !!(t.recordset && t.recordset[0] && t.recordset[0].oid);
  }
  const apartado = hayReservas ? `
           - ISNULL((
             SELECT SUM(rb.cantidad) FROM [compucaja].[dbo].[reservas_bodega] rb WITH (NOLOCK)
             WHERE rb.activa = 1 AND rb.codigo_barras = ib.codigo_barras AND rb.ubicacion IN (${enList})
           ), 0)` : '';
  const r = await mssql.query(`
    SELECT ib.codigo_barras AS codigo, SUM(ib.cantidad)${apartado} AS qty
    FROM [compucaja].[dbo].[inventario_bodega] ib WITH (NOLOCK)
    WHERE ib.ubicacion IN (${enList})
    GROUP BY ib.codigo_barras
    OPTION (MAXDOP 1)
  `);
  const m = new Map();
  for (const row of r.recordset || []) {
    const c = String(row.codigo || '').trim();
    if (c) m.set(c, Math.max(0, row.qty || 0)); // nunca empujar negativos
  }
  return m;
}

// ── Ciclo de sync ──────────────────────────────────────────────────────────────
let corriendo = false;
let ultimoResultado = null;

async function correrSync({ reconciliar = false } = {}) {
  if (corriendo) return { skip: 'ya hay un sync corriendo' };
  corriendo = true;
  const inicio = Date.now();
  try {
    const forzarMapa = reconciliar || !mapa || Date.now() - mapaFecha >= REFRESH_HORAS * 3600 * 1000;
    const esRefresh = forzarMapa; // en refresh comparamos contra la qty REAL de Shopify (reconcilia)
    const [vMapa, objetivo] = [await cargarMapa(forzarMapa), await stockBodega()];

    const estadoR = await mssql.query(`
      SELECT codigo_barras, ultima_qty,
             CASE WHEN bloqueado_hasta IS NOT NULL AND bloqueado_hasta > GETDATE() THEN 1 ELSE 0 END AS bloqueado
      FROM [compucaja].[dbo].[shopify_sync_estado]`);
    const estado = new Map();
    const bloqueados = new Set();
    for (const r of estadoR.recordset || []) {
      const c = r.codigo_barras.trim();
      estado.set(c, r.ultima_qty);
      if (r.bloqueado) bloqueados.add(c);
    }

    // Qué empujar: variantes de Shopify cuyo barcode tiene registro en bodega y cambió
    const pendientes = [];
    let saltados = 0;
    for (const [bc, target] of objetivo) {
      const v = vMapa.get(bc);
      if (!v) continue; // ese código no existe (aún) en Shopify
      if (bloqueados.has(bc)) { saltados++; continue; } // Shopify lo rechaza: se reintenta cada 24 h
      const referencia = esRefresh ? v.qty : (estado.has(bc) ? estado.get(bc) : null);
      if (referencia === null || referencia !== target) pendientes.push({ bc, itemId: v.itemId, target });
    }

    let ok = 0, fallos = 0, nuevosBloqueos = 0;
    for (const p of pendientes) {
      const res = await shopifyFetch(apiUrl('inventory_levels/set.json'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id: parseInt(LOCATION_ID), inventory_item_id: p.itemId, available: p.target }),
      });
      if (res.ok) {
        ok++;
        await mssql.query(`
          MERGE [compucaja].[dbo].[shopify_sync_estado] AS e
          USING (SELECT @codigo AS codigo) AS s ON e.codigo_barras = s.codigo
          WHEN MATCHED THEN UPDATE SET ultima_qty = @qty, actualizado = GETDATE(), bloqueado_hasta = NULL, motivo_bloqueo = NULL
          WHEN NOT MATCHED THEN INSERT (codigo_barras, ultima_qty) VALUES (@codigo, @qty);
        `, { codigo: p.bc, qty: p.target });
      } else {
        fallos++;
        // 422 = la variante NO lleva control de inventario en Shopify ("Track
        // quantity" apagado): por más que se reintente, nunca va a aceptar el
        // número. Se marca 24 h para no gastar llamadas ni ensuciar el log, y el
        // panel lo reporta como "sin seguimiento en la página".
        if (res.status === 422) {
          nuevosBloqueos++;
          await mssql.query(`
            MERGE [compucaja].[dbo].[shopify_sync_estado] AS e
            USING (SELECT @codigo AS codigo) AS s ON e.codigo_barras = s.codigo
            WHEN MATCHED THEN UPDATE SET bloqueado_hasta = DATEADD(HOUR, 24, GETDATE()), motivo_bloqueo = @motivo, actualizado = GETDATE()
            WHEN NOT MATCHED THEN INSERT (codigo_barras, ultima_qty, bloqueado_hasta, motivo_bloqueo)
              VALUES (@codigo, -1, DATEADD(HOUR, 24, GETDATE()), @motivo);
          `, { codigo: p.bc, motivo: 'La variante no lleva control de inventario en Shopify (Track quantity apagado)' });
        } else if (fallos <= 3) console.error(`[shopify-sync] Falló ${p.bc} -> ${p.target}: HTTP ${res.status}`);
      }
      await new Promise(r => setTimeout(r, 550)); // < 2 req/s
    }

    const resumen = `${pendientes.length} cambios (${ok} ok, ${fallos} fallos) | bodega: ${objetivo.size} códigos${saltados ? ` | ${saltados} sin seguimiento` : ''}${nuevosBloqueos ? ` | ${nuevosBloqueos} nuevos sin seguimiento` : ''} | ${Math.round((Date.now() - inicio) / 1000)}s${esRefresh ? ' | reconciliado' : ''}`;
    await mssql.query(
      `UPDATE [compucaja].[dbo].[shopify_sync_config] SET ultimo_run = GETDATE(), ultimo_resumen = @resumen WHERE id = 1`,
      { resumen }
    );
    ultimoResultado = { fecha: new Date().toISOString(), pendientes: pendientes.length, ok, fallos, saltados, nuevosBloqueos, resumen };
    if (pendientes.length) console.log(`[shopify-sync] ${resumen}`);
    return ultimoResultado;
  } finally {
    corriendo = false;
  }
}

// ── Scheduler ──────────────────────────────────────────────────────────────────
function startScheduler() {
  if (!configurado()) {
    console.log('[shopify-sync] Sin credenciales en .env — sync deshabilitado.');
    return;
  }
  migrar().catch(e => console.error('[shopify-sync] Migración falló:', e.message));
  setInterval(async () => {
    try {
      const cfg = await getConfig();
      if (!cfg || !cfg.activo) return;
      await correrSync();
    } catch (e) {
      console.error('[shopify-sync] Error en ciclo:', e.message);
    }
  }, INTERVAL_MIN * 60 * 1000);
  console.log(`[shopify-sync] Scheduler listo (cada ${INTERVAL_MIN} min, áreas: ${AREAS.join(' + ')}).`);
}

// ── Endpoints ──────────────────────────────────────────────────────────────────
router.get('/estado', async (req, res) => {
  try {
    const cfg = configurado() ? await getConfig() : null;
    let sinSeguimiento = [];
    if (configurado()) {
      try {
        const r = await mssql.query(`
          SELECT TOP 100 codigo_barras, motivo_bloqueo, bloqueado_hasta
          FROM [compucaja].[dbo].[shopify_sync_estado] WITH (NOLOCK)
          WHERE bloqueado_hasta IS NOT NULL AND bloqueado_hasta > GETDATE()
          ORDER BY actualizado DESC`);
        sinSeguimiento = r.recordset || [];
      } catch { /* aún sin migrar */ }
    }
    res.json({
      configurado: configurado(),
      activo: !!(cfg && cfg.activo),
      intervalo_min: INTERVAL_MIN,
      areas: await getAreas(),
      areas_env: AREAS_ENV,
      sin_seguimiento: sinSeguimiento.length,
      sin_seguimiento_lista: sinSeguimiento,
      ultimo_run: cfg ? cfg.ultimo_run : null,
      ultimo_resumen: cfg ? cfg.ultimo_resumen : null,
      ultimo_resultado: ultimoResultado,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/activar', async (req, res) => {
  try {
    const activo = req.body && req.body.activo ? 1 : 0;
    await migrar();
    await mssql.query(`UPDATE [compucaja].[dbo].[shopify_sync_config] SET activo = @activo WHERE id = 1`, { activo });
    res.json({ ok: true, activo: !!activo });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Áreas cuyo stock cuenta para la página web (Casita 1, Casita 2, Bodega...).
// Cambiarlas hace que productos guardados en Refrigerador/Cocina/USA empiecen
// (o dejen) de ofrecerse en línea, así que se reconcilia en la siguiente corrida.
router.put('/config', async (req, res) => {
  try {
    const b = req.body || {};
    if (!Array.isArray(b.areas) || !b.areas.length) return res.status(400).json({ error: 'Manda "areas" como lista con al menos un área' });
    const validas = await mssql.query(`SELECT nombre FROM [compucaja].[dbo].[ubicaciones_bodega] WHERE activa = 1`);
    const nombres = new Set((validas.recordset || []).map(r => String(r.nombre).trim()));
    const areas = b.areas.map(a => String(a).trim()).filter(a => nombres.has(a));
    if (!areas.length) return res.status(400).json({ error: 'Ninguna de esas áreas existe' });
    await migrar();
    await mssql.query(`UPDATE [compucaja].[dbo].[shopify_sync_config] SET areas = @areas WHERE id = 1`, { areas: areas.join(',') });
    invalidarAreas();
    res.json({ ok: true, areas });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/correr', async (req, res) => {
  try {
    if (!configurado()) return res.status(400).json({ error: 'Faltan credenciales de Shopify en .env' });
    const reconciliar = !!(req.body && req.body.reconciliar);
    const r = await correrSync({ reconciliar });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Corre un ciclo solo si el sync está activado (lo llama pedidos-web cuando
// cambia el disponible: apartado, liberación o salida de un pedido).
async function correrSiActivo() {
  if (!configurado()) return { skip: 'sin credenciales' };
  const cfg = await getConfig();
  if (!cfg || !cfg.activo) return { skip: 'sync apagado' };
  return correrSync();
}

module.exports = { router, startScheduler, correrSync, correrSiActivo, barcodeDeVariante, getAreas, invalidarAreas };
