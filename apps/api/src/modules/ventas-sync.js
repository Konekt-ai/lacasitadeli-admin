// ============================================================================
// ventas-sync.js — Liga las ventas de NovaCaja (tickets) al inventario de bodega.
//
// Al vender un producto en caja (Tda configurada), descuenta esa cantidad de
// inventario_bodega en el AREA configurada (ej. 'Casita 1'). Lo que no esté en
// esa área, se ignora. Idempotente: cada ticket se procesa UNA sola vez
// (tabla ventas_procesadas). APAGADO por defecto: no descuenta hasta activarlo.
//
// Decisiones del cliente: descontar de 'Casita 1', solo Tda '1', desde ahora,
// ignorar lo no contado.
// ============================================================================
const express = require('express');
const mssql   = require('../db/mssql');

const router = express.Router();
const esc = s => String(s == null ? '' : s).replace(/'/g, "''");

// ── Config ────────────────────────────────────────────────────────────────────
async function getConfig() {
  const r = await mssql.query(`SELECT TOP 1 * FROM [compucaja].[dbo].[ventas_sync_config] WHERE id = 1`);
  return r.recordset && r.recordset[0] ? r.recordset[0] : null;
}

// ── Preview (SOLO LECTURA): qué se descontaría en la próxima corrida ───────────
// No escribe nada. Muestra por producto: vendido (tickets nuevos), stock actual
// en el área y cómo quedaría. Solo productos que SÍ están en el área.
async function preview() {
  const cfg = await getConfig();
  if (!cfg) return { error: 'Config no encontrada (corre la migración).' };
  const area = esc(cfg.area || 'Casita 1');
  const tda  = esc(String(cfg.tda || '1'));

  const detalle = await mssql.query(`
    SELECT
      ps.Codigo                                          AS codigo,
      MAX(ISNULL(NULLIF(a.Art_Descripcion,''), ib.nombre)) AS nombre,
      SUM(ps.Cantidad)                                   AS vendido,
      ib.cantidad                                        AS stockActual,
      CASE WHEN ib.cantidad - SUM(ps.Cantidad) < 0 THEN 0 ELSE ib.cantidad - SUM(ps.Cantidad) END AS stockNuevo
    FROM [compucaja].[dbo].[TicketsPS] ps WITH (NOLOCK)
    JOIN [compucaja].[dbo].[Tickets] t WITH (NOLOCK)
      ON ps.FolTda_Codigo = t.FolTda_Codigo AND ps.FolEst_Codigo = t.FolEst_Codigo
     AND ps.FolDoc_Codigo = t.FolDoc_Codigo AND ps.FolConsecutivo = t.FolConsecutivo
    JOIN [compucaja].[dbo].[inventario_bodega] ib WITH (NOLOCK)
      ON ib.codigo_barras = ps.Codigo AND ib.ubicacion = '${area}'
    LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK) ON a.Art_Codigo = ps.Codigo
    WHERE t.FolTda_Codigo = '${tda}'
      AND t.T_Fecha >= DATEADD(MINUTE, -5, (SELECT ISNULL(ultima_fecha, fecha_inicio) FROM [compucaja].[dbo].[ventas_sync_config] WHERE id = 1))
      AND t.T_Fecha <= DATEADD(SECOND, -30, GETDATE())
      AND NOT EXISTS (
        SELECT 1 FROM [compucaja].[dbo].[ventas_procesadas] vp
        WHERE vp.FolTda_Codigo = t.FolTda_Codigo AND vp.FolEst_Codigo = t.FolEst_Codigo
          AND vp.FolDoc_Codigo = t.FolDoc_Codigo AND vp.FolConsecutivo = t.FolConsecutivo)
    GROUP BY ps.Codigo, ib.cantidad, ib.nombre
    ORDER BY SUM(ps.Cantidad) DESC
    OPTION (MAXDOP 1)
  `);

  return {
    config: { activo: !!cfg.activo, area: cfg.area, tda: cfg.tda, fecha_inicio: cfg.fecha_inicio, ultima_fecha: cfg.ultima_fecha, ultimo_run: cfg.ultimo_run },
    productos: detalle.recordset || [],
  };
}

// ── Procesar (REAL): descuenta y marca, de forma transaccional e idempotente ───
async function procesarVentas() {
  const cfg = await getConfig();
  if (!cfg) return { error: 'Config no encontrada.' };
  if (!cfg.fecha_inicio) return { error: 'Falta definir desde cuándo (fecha_inicio).' };
  const area = esc(cfg.area || 'Casita 1');
  const tda  = esc(String(cfg.tda || '1'));

  const { getPool } = require('../db/mssql');
  const pool = await getPool();
  const sql = `
    SET NOCOUNT ON;
    BEGIN TRY
      BEGIN TRAN;

      -- Tickets NUEVOS (no procesados) de la Tda, en la ventana
      SELECT t.FolTda_Codigo ft, t.FolEst_Codigo fe, t.FolDoc_Codigo fd, t.FolConsecutivo fc, t.T_Fecha tf
      INTO #nuevos
      FROM [compucaja].[dbo].[Tickets] t WITH (NOLOCK)
      WHERE t.FolTda_Codigo = '${tda}'
        AND t.T_Fecha >= DATEADD(MINUTE, -5, (SELECT ISNULL(ultima_fecha, fecha_inicio) FROM [compucaja].[dbo].[ventas_sync_config] WHERE id = 1))
        AND t.T_Fecha <= DATEADD(SECOND, -30, GETDATE())
        AND NOT EXISTS (
          SELECT 1 FROM [compucaja].[dbo].[ventas_procesadas] vp
          WHERE vp.FolTda_Codigo = t.FolTda_Codigo AND vp.FolEst_Codigo = t.FolEst_Codigo
            AND vp.FolDoc_Codigo = t.FolDoc_Codigo AND vp.FolConsecutivo = t.FolConsecutivo);

      -- Vendido por producto (de esos tickets)
      SELECT ps.Codigo AS codigo, SUM(ps.Cantidad) AS vendido
      INTO #vend
      FROM [compucaja].[dbo].[TicketsPS] ps WITH (NOLOCK)
      JOIN #nuevos n ON ps.FolTda_Codigo = n.ft AND ps.FolEst_Codigo = n.fe
        AND ps.FolDoc_Codigo = n.fd AND ps.FolConsecutivo = n.fc
      GROUP BY ps.Codigo;

      -- Registrar el movimiento (salida por venta) de los que SÍ están en el área
      INSERT INTO [compucaja].[dbo].[movimientos_bodega]
        (codigo_barras, tipo, cantidad, ubicacion, stock_antes, stock_despues, motivo, fecha)
      SELECT ib.codigo_barras, 'salida', v.vendido, ib.ubicacion, ib.cantidad,
             CASE WHEN ib.cantidad - v.vendido < 0 THEN 0 ELSE ib.cantidad - v.vendido END,
             'venta', GETDATE()
      FROM [compucaja].[dbo].[inventario_bodega] ib
      JOIN #vend v ON v.codigo = ib.codigo_barras
      WHERE ib.ubicacion = '${area}';

      -- Descontar del inventario (nunca por debajo de 0)
      UPDATE ib
        SET ib.cantidad = CASE WHEN ib.cantidad - v.vendido < 0 THEN 0 ELSE ib.cantidad - v.vendido END,
            ib.ultima_salida = GETDATE()
      FROM [compucaja].[dbo].[inventario_bodega] ib
      JOIN #vend v ON v.codigo = ib.codigo_barras
      WHERE ib.ubicacion = '${area}';

      -- Marcar los tickets como procesados (idempotencia)
      INSERT INTO [compucaja].[dbo].[ventas_procesadas]
        (FolTda_Codigo, FolEst_Codigo, FolDoc_Codigo, FolConsecutivo, fecha)
      SELECT ft, fe, fd, fc, tf FROM #nuevos;

      -- Avanzar la marca
      UPDATE [compucaja].[dbo].[ventas_sync_config]
        SET ultima_fecha = (SELECT MAX(tf) FROM #nuevos), ultimo_run = GETDATE()
      WHERE id = 1 AND EXISTS (SELECT 1 FROM #nuevos);

      SELECT
        (SELECT COUNT(*) FROM #nuevos) AS tickets,
        (SELECT COUNT(*) FROM #vend v JOIN [compucaja].[dbo].[inventario_bodega] ib
            ON ib.codigo_barras = v.codigo AND ib.ubicacion = '${area}') AS productosDescontados,
        (SELECT ISNULL(SUM(v.vendido),0) FROM #vend v JOIN [compucaja].[dbo].[inventario_bodega] ib
            ON ib.codigo_barras = v.codigo AND ib.ubicacion = '${area}') AS unidadesDescontadas;

      DROP TABLE #nuevos; DROP TABLE #vend;
      COMMIT;
    END TRY
    BEGIN CATCH
      IF @@TRANCOUNT > 0 ROLLBACK;
      THROW;
    END CATCH
  `;
  const res = await pool.request().batch(sql);
  const row = (res.recordset && res.recordset[0]) || {};
  return {
    tickets: Number(row.tickets) || 0,
    productosDescontados: Number(row.productosDescontados) || 0,
    unidadesDescontadas: Number(row.unidadesDescontadas) || 0,
  };
}

// ── Scheduler en segundo plano (solo si activo) ───────────────────────────────
let _running = false;
async function tick() {
  if (_running) return;
  _running = true;
  try {
    const cfg = await getConfig();
    if (cfg && cfg.activo) {
      const r = await procesarVentas();
      if (r && r.tickets) console.log(`[ventas-sync] ${r.tickets} tickets, ${r.unidadesDescontadas} uds descontadas de ${cfg.area}`);
    }
  } catch (e) {
    console.error('[ventas-sync] tick:', e.message);
  } finally {
    _running = false;
  }
}
function startScheduler() {
  // Cada 3 min. Solo hace algo si la config está activa.
  setInterval(tick, 180_000);
}

// ── Rutas ─────────────────────────────────────────────────────────────────────
router.get('/config', async (req, res) => {
  try { res.json(await getConfig()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/config', async (req, res) => {
  try {
    const { activo, area, tda, fecha_inicio } = req.body || {};
    const sets = [];
    if (activo !== undefined)       sets.push(`activo = ${activo ? 1 : 0}`);
    if (area !== undefined)         sets.push(`area = '${esc(area)}'`);
    if (tda !== undefined)          sets.push(`tda = '${esc(String(tda))}'`);
    if (fecha_inicio === 'ahora')   sets.push(`fecha_inicio = GETDATE(), ultima_fecha = NULL`);
    else if (fecha_inicio !== undefined) sets.push(`fecha_inicio = '${esc(fecha_inicio)}', ultima_fecha = NULL`);
    if (sets.length) await mssql.query(`UPDATE [compucaja].[dbo].[ventas_sync_config] SET ${sets.join(', ')} WHERE id = 1`);
    res.json(await getConfig());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/preview', async (req, res) => {
  try { res.json(await preview()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/run', async (req, res) => {
  try { res.json(await procesarVentas()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, startScheduler };
