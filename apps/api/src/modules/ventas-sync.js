// ============================================================================
// ventas-sync.js — Liga las ventas de NovaCaja (tickets) al inventario de bodega.
//
// Al vender en caja, descuenta esa cantidad de inventario_bodega en el AREA de la
// CAJA del ticket (mapeo estacion_area_map: caja 21 -> Casita 1, caja 7 -> Casita
// 2). Cajas no mapeadas y productos no contados en esa area se ignoran.
// Idempotente: cada ticket se procesa UNA sola vez. APAGADO por defecto.
// ============================================================================
const express = require('express');
const mssql   = require('../db/mssql');

const router = express.Router();
const esc = s => String(s == null ? '' : s).replace(/'/g, "''");

async function getConfig() {
  const r = await mssql.query(`SELECT TOP 1 * FROM [compucaja].[dbo].[ventas_sync_config] WHERE id = 1`);
  return r.recordset && r.recordset[0] ? r.recordset[0] : null;
}
async function getMapa() {
  const r = await mssql.query(`SELECT est_codigo, area FROM [compucaja].[dbo].[estacion_area_map] ORDER BY est_codigo`);
  return r.recordset || [];
}

// Ventana de tickets nuevos (no procesados), común a preview y proceso real.
const WHERE_NUEVOS = `
  t.T_Fecha >= DATEADD(MINUTE, -5, (SELECT ISNULL(ultima_fecha, fecha_inicio) FROM [compucaja].[dbo].[ventas_sync_config] WHERE id = 1))
  AND t.T_Fecha <= DATEADD(SECOND, -30, GETDATE())
  AND NOT EXISTS (
    SELECT 1 FROM [compucaja].[dbo].[ventas_procesadas] vp
    WHERE vp.FolTda_Codigo = t.FolTda_Codigo AND vp.FolEst_Codigo = t.FolEst_Codigo
      AND vp.FolDoc_Codigo = t.FolDoc_Codigo AND vp.FolConsecutivo = t.FolConsecutivo)`;

// ── Preview (SOLO LECTURA): qué se descontaría, por caja->área ─────────────────
async function preview() {
  const cfg = await getConfig();
  if (!cfg) return { error: 'Config no encontrada (corre la migración).' };
  const detalle = await mssql.query(`
    SELECT
      ps.Codigo                                          AS codigo,
      MAX(ISNULL(NULLIF(a.Art_Descripcion,''), ib.nombre)) AS nombre,
      m.area                                             AS area,
      SUM(ps.Cantidad)                                   AS vendido,
      ib.cantidad                                        AS stockActual,
      CASE WHEN ib.cantidad - SUM(ps.Cantidad) < 0 THEN 0 ELSE ib.cantidad - SUM(ps.Cantidad) END AS stockNuevo
    FROM [compucaja].[dbo].[TicketsPS] ps WITH (NOLOCK)
    JOIN [compucaja].[dbo].[Tickets] t WITH (NOLOCK)
      ON ps.FolTda_Codigo = t.FolTda_Codigo AND ps.FolEst_Codigo = t.FolEst_Codigo
     AND ps.FolDoc_Codigo = t.FolDoc_Codigo AND ps.FolConsecutivo = t.FolConsecutivo
    JOIN [compucaja].[dbo].[estacion_area_map] m ON m.est_codigo = t.FolEst_Codigo
    JOIN [compucaja].[dbo].[inventario_bodega] ib WITH (NOLOCK)
      ON ib.codigo_barras = ps.Codigo AND ib.ubicacion = m.area
    LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK) ON a.Art_Codigo = ps.Codigo
    WHERE ${WHERE_NUEVOS}
    GROUP BY ps.Codigo, m.area, ib.cantidad, ib.nombre
    ORDER BY SUM(ps.Cantidad) DESC
    OPTION (MAXDOP 1)
  `);
  return {
    config: { activo: !!cfg.activo, fecha_inicio: cfg.fecha_inicio, ultima_fecha: cfg.ultima_fecha, ultimo_run: cfg.ultimo_run },
    mapa: await getMapa(),
    productos: detalle.recordset || [],
  };
}

// ── Procesar (REAL): descuenta y marca, transaccional e idempotente ────────────
async function procesarVentas() {
  const cfg = await getConfig();
  if (!cfg) return { error: 'Config no encontrada.' };
  if (!cfg.fecha_inicio) return { error: 'Falta definir desde cuándo (fecha_inicio).' };

  const { getPool } = require('../db/mssql');
  const pool = await getPool();
  const sql = `
    SET NOCOUNT ON;
    BEGIN TRY
      BEGIN TRAN;

      SELECT t.FolTda_Codigo ft, t.FolEst_Codigo fe, t.FolDoc_Codigo fd, t.FolConsecutivo fc, t.T_Fecha tf
      INTO #nuevos
      FROM [compucaja].[dbo].[Tickets] t WITH (NOLOCK)
      WHERE ${WHERE_NUEVOS};

      -- UNA fila por (ticket, producto, area). NO se agrega entre tickets: así cada
      -- ticket deja su PROPIA salida, rastreable a su folio (antes se sumaban varios
      -- tickets del mismo producto en un solo -N y no se sabía de qué venta salía).
      SELECT n.ft, n.fe, n.fd, n.fc, n.tf,
             ps.Codigo AS codigo, m.area AS area, SUM(ps.Cantidad) AS vendido
      INTO #lineas
      FROM [compucaja].[dbo].[TicketsPS] ps WITH (NOLOCK)
      JOIN #nuevos n ON ps.FolTda_Codigo = n.ft AND ps.FolEst_Codigo = n.fe
        AND ps.FolDoc_Codigo = n.fd AND ps.FolConsecutivo = n.fc
      JOIN [compucaja].[dbo].[estacion_area_map] m ON m.est_codigo = n.fe
      GROUP BY n.ft, n.fe, n.fd, n.fc, n.tf, ps.Codigo, m.area;

      -- Solo líneas de productos SÍ contados en el área de su caja, con el stock
      -- actual y el ACUMULADO cronológico (para descontar en cascada por línea).
      SELECT l.ft, l.fe, l.fd, l.fc, l.tf, l.codigo, l.area, l.vendido,
             ib.cantidad AS stock_actual,
             SUM(l.vendido) OVER (PARTITION BY l.codigo, l.area
                 ORDER BY l.tf, l.fc ROWS UNBOUNDED PRECEDING) AS acum
      INTO #calc
      FROM #lineas l
      JOIN [compucaja].[dbo].[inventario_bodega] ib
        ON ib.codigo_barras = l.codigo AND ib.ubicacion = l.area;

      -- Una SALIDA por ticket, con el folio en notas (para abrir el ticket exacto).
      -- El stock por línea baja en cascada (nunca <0); la última línea = stock final.
      -- fecha = hora REAL del ticket (T_Fecha), no la del batch: así el movimiento
      -- coincide en tiempo con el ticket.
      INSERT INTO [compucaja].[dbo].[movimientos_bodega]
        (codigo_barras, tipo, cantidad, ubicacion, stock_antes, stock_despues, motivo, notas, fecha)
      SELECT c.codigo, 'salida', c.vendido, c.area,
             CASE WHEN c.stock_actual - (c.acum - c.vendido) < 0 THEN 0 ELSE c.stock_actual - (c.acum - c.vendido) END,
             CASE WHEN c.stock_actual - c.acum < 0 THEN 0 ELSE c.stock_actual - c.acum END,
             'venta',
             CONCAT('Ticket #', c.fc, ' | ', c.ft, '-', c.fe, '-', c.fd),
             c.tf
      FROM #calc c;

      -- Aplica el stock final por (producto, area): total vendido = SUM de sus líneas.
      UPDATE ib
        SET ib.cantidad = CASE WHEN ib.cantidad - tot.vendido < 0 THEN 0 ELSE ib.cantidad - tot.vendido END,
            ib.ultima_salida = GETDATE()
      FROM [compucaja].[dbo].[inventario_bodega] ib
      JOIN ( SELECT codigo, area, SUM(vendido) AS vendido FROM #lineas GROUP BY codigo, area ) tot
        ON tot.codigo = ib.codigo_barras AND tot.area = ib.ubicacion;

      -- Marca TODOS los tickets nuevos (mapeados o no) para no re-escanearlos
      INSERT INTO [compucaja].[dbo].[ventas_procesadas]
        (FolTda_Codigo, FolEst_Codigo, FolDoc_Codigo, FolConsecutivo, fecha)
      SELECT ft, fe, fd, fc, tf FROM #nuevos;

      UPDATE [compucaja].[dbo].[ventas_sync_config]
        SET ultima_fecha = (SELECT MAX(tf) FROM #nuevos), ultimo_run = GETDATE()
      WHERE id = 1 AND EXISTS (SELECT 1 FROM #nuevos);

      SELECT
        (SELECT COUNT(*) FROM #nuevos) AS tickets,
        (SELECT COUNT(*) FROM (SELECT DISTINCT codigo, area FROM #calc) x) AS productosDescontados,
        (SELECT ISNULL(SUM(vendido),0) FROM #calc) AS unidadesDescontadas,
        (SELECT COUNT(*) FROM #calc) AS movimientos;

      DROP TABLE #nuevos; DROP TABLE #lineas; DROP TABLE #calc;
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
    movimientos: Number(row.movimientos) || 0,
  };
}

// ── Scheduler ──────────────────────────────────────────────────────────────────
let _running = false;
async function tick() {
  if (_running) return;
  _running = true;
  try {
    const cfg = await getConfig();
    if (cfg && cfg.activo) {
      const r = await procesarVentas();
      if (r && r.tickets) console.log(`[ventas-sync] ${r.tickets} tickets, ${r.movimientos || 0} salidas, ${r.unidadesDescontadas} uds descontadas`);
    }
  } catch (e) {
    console.error('[ventas-sync] tick:', e.message);
  } finally {
    _running = false;
  }
}
function startScheduler() {
  // Automatico: corre solo. Arranca 30s despues de prender y luego cada 90s,
  // para que el descuento se refleje casi en tiempo real en el inventario.
  setTimeout(tick, 30_000);
  setInterval(tick, 90_000);
}

// ── Rutas ─────────────────────────────────────────────────────────────────────
router.get('/config', async (req, res) => {
  try { res.json({ config: await getConfig(), mapa: await getMapa() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/config', async (req, res) => {
  try {
    const { activo, fecha_inicio } = req.body || {};
    const sets = [];
    if (activo !== undefined)            sets.push(`activo = ${activo ? 1 : 0}`);
    if (fecha_inicio === 'ahora')        sets.push(`fecha_inicio = GETDATE(), ultima_fecha = NULL`);
    else if (fecha_inicio !== undefined) sets.push(`fecha_inicio = '${esc(fecha_inicio)}', ultima_fecha = NULL`);
    if (sets.length) await mssql.query(`UPDATE [compucaja].[dbo].[ventas_sync_config] SET ${sets.join(', ')} WHERE id = 1`);
    res.json({ config: await getConfig(), mapa: await getMapa() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mapeo caja -> área
router.get('/mapa', async (req, res) => {
  try { res.json(await getMapa()); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/mapa', async (req, res) => {
  try {
    const est  = esc(String(req.body?.est_codigo || '').trim());
    const area = esc(String(req.body?.area || '').trim());
    if (!est || !area) return res.status(400).json({ error: 'Falta caja o área' });
    await mssql.query(`
      MERGE [compucaja].[dbo].[estacion_area_map] AS t
      USING (SELECT '${est}' est, '${area}' area) s ON t.est_codigo = s.est
      WHEN MATCHED THEN UPDATE SET area = s.area
      WHEN NOT MATCHED THEN INSERT (est_codigo, area) VALUES (s.est, s.area);
    `);
    res.json(await getMapa());
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/mapa/:est', async (req, res) => {
  try {
    await mssql.query(`DELETE FROM [compucaja].[dbo].[estacion_area_map] WHERE est_codigo = '${esc(req.params.est)}'`);
    res.json(await getMapa());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/preview', async (req, res) => {
  try { res.json(await preview()); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/run', async (req, res) => {
  try { res.json(await procesarVentas()); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Productos vendidos que NO están contados en el área de su caja ─────────────
// Explica por qué "no se descuenta" un producto: se vendió en un local (según la
// caja del ticket) pero el TC52 no lo tiene contado en esa área, así que el sync
// no tiene de dónde restar. La solución es contarlo con el TC52 en esa área.
async function sinContar(dias) {
  const d = Math.min(Math.max(parseInt(dias) || 7, 1), 60);
  const r = await mssql.query(`
    SELECT m.area AS area, ps.Codigo AS codigo,
           MAX(ISNULL(NULLIF(a.Art_Descripcion, ''), ps.Codigo)) AS nombre,
           CAST(SUM(ps.Cantidad) AS int) AS vendido,
           CASE WHEN EXISTS (SELECT 1 FROM [compucaja].[dbo].[inventario_bodega] ib2
                             WHERE ib2.codigo_barras = ps.Codigo) THEN 1 ELSE 0 END AS enOtraArea
    FROM [compucaja].[dbo].[TicketsPS] ps WITH (NOLOCK)
    JOIN [compucaja].[dbo].[Tickets] t WITH (NOLOCK)
      ON ps.FolTda_Codigo = t.FolTda_Codigo AND ps.FolEst_Codigo = t.FolEst_Codigo
     AND ps.FolDoc_Codigo = t.FolDoc_Codigo AND ps.FolConsecutivo = t.FolConsecutivo
    JOIN [compucaja].[dbo].[estacion_area_map] m ON m.est_codigo = t.FolEst_Codigo
    LEFT JOIN [compucaja].[dbo].[inventario_bodega] ib
      ON ib.codigo_barras = ps.Codigo AND ib.ubicacion = m.area
    LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK) ON a.Art_Codigo = ps.Codigo
    WHERE t.T_Fecha >= DATEADD(DAY, -${d}, GETDATE())
      AND ib.codigo_barras IS NULL
      AND ps.Codigo IS NOT NULL AND LEN(ps.Codigo) > 0 AND ps.Codigo <> '0'
    GROUP BY m.area, ps.Codigo
    ORDER BY m.area, SUM(ps.Cantidad) DESC
    OPTION (MAXDOP 1)
  `);
  return (r.recordset || []).map(x => ({
    area: x.area, codigo: x.codigo, nombre: x.nombre,
    vendido: Number(x.vendido) || 0, enOtraArea: !!x.enOtraArea,
  }));
}
router.get('/sin-contar', async (req, res) => {
  try {
    res.json({
      dias: Math.min(Math.max(parseInt(req.query.dias) || 7, 1), 60),
      productos: await sinContar(req.query.dias),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { router, startScheduler };
