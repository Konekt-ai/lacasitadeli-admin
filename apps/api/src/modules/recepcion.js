// ============================================================
// recepcion.js — Módulo de Recepción con conversión caja→pieza
// Coloca en: apps/api/src/modules/recepcion.js
//
// Requiere que crear_tablas_recepcion.sql ya se haya ejecutado
// en la base compucaja (las 4 tablas + sp + vistas).
// ============================================================

const { getPool, sql } = require('../db/mssql')
const { getDb } = require('../db')

const VISTA = '[compucaja].[dbo].[VArticulosUnificados]'

// Resuelve el nombre del producto casando por GTIN, código alterno, Art_Codigo o PLU.
// (subconsulta TOP 1 → evita multiplicar renglones al unir)
const nombreExpr = (col) =>
  `ISNULL((SELECT TOP 1 a2.Art_Descripcion FROM ${VISTA} a2
           WHERE a2.Art_GTIN = ${col} OR a2.CodAlt_Codigo = ${col}
              OR a2.Art_Codigo = ${col} OR a2.Art_PLU = ${col}), ${col})`

// ── Helpers ────────────────────────────────────────────────────────────────────
async function generarFolio(db) {
  // Folio tipo REC-20260101-0003
  const hoy = new Date()
  const fecha = hoy.toISOString().slice(0, 10).replace(/-/g, '')
  const r = await db.request().query(`
    SELECT COUNT(*) AS total FROM recepciones_esperadas
    WHERE CAST(creado AS DATE) = CAST(GETDATE() AS DATE)
  `)
  const n = (r.recordset[0]?.total ?? 0) + 1
  return `REC-${fecha}-${String(n).padStart(4, '0')}`
}

async function getNombreProducto(db, codigo) {
  const r = await db.request()
    .input('codigo', sql.NVarChar(50), codigo)
    .query(`SELECT TOP 1 Art_Descripcion AS nombre FROM ${VISTA}
            WHERE Art_GTIN=@codigo OR CodAlt_Codigo=@codigo OR Art_Codigo=@codigo OR Art_PLU=@codigo`)
  return r.recordset[0]?.nombre ?? null
}

// ── EQUIVALENCIAS (productos_compra) ───────────────────────────────────────────

async function getEquivalencias(req, res) {
  try {
    const db = await getPool()
    const { proveedor } = req.query
    let q = `
      SELECT pc.id, pc.proveedor, pc.sku_proveedor, pc.descripcion_proveedor,
             pc.unidad_compra, pc.piezas_por_caja, pc.codigo_barras, pc.activo,
             v.Art_Descripcion AS nombre_interno
      FROM productos_compra pc
      LEFT JOIN ${VISTA} v ON v.Art_GTIN = pc.codigo_barras
      WHERE pc.activo = 1
    `
    if (proveedor) q += ` AND pc.proveedor LIKE '%' + @proveedor + '%'`
    q += ' ORDER BY pc.proveedor, pc.sku_proveedor'
    const r = await db.request()
      .input('proveedor', sql.VarChar(100), proveedor || '')
      .query(q)
    res.json(r.recordset)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

async function crearEquivalencia(req, res) {
  const { proveedor, sku_proveedor, descripcion_proveedor, unidad_compra, piezas_por_caja, codigo_barras } = req.body
  if (!proveedor || !sku_proveedor || !codigo_barras || !piezas_por_caja)
    return res.status(400).json({ error: 'Campos requeridos: proveedor, sku_proveedor, codigo_barras, piezas_por_caja' })
  try {
    const db = await getPool()
    // Verificar que el código existe en catálogo
    const prod = await getNombreProducto(db, codigo_barras)
    if (!prod) return res.status(404).json({ error: `Código ${codigo_barras} no encontrado en el catálogo` })

    await db.request()
      .input('proveedor',             sql.VarChar(100), proveedor)
      .input('sku_proveedor',         sql.VarChar(50),  sku_proveedor)
      .input('descripcion_proveedor', sql.VarChar(200), descripcion_proveedor || null)
      .input('unidad_compra',         sql.VarChar(20),  unidad_compra || 'Caja')
      .input('piezas_por_caja',       sql.Int,          piezas_por_caja)
      .input('codigo_barras',         sql.VarChar(50),  codigo_barras)
      .query(`
        MERGE productos_compra AS t
        USING (SELECT @proveedor AS p, @sku_proveedor AS s) AS src
          ON t.proveedor = src.p AND t.sku_proveedor = src.s
        WHEN MATCHED THEN
          UPDATE SET descripcion_proveedor=@descripcion_proveedor,
                     unidad_compra=@unidad_compra,
                     piezas_por_caja=@piezas_por_caja,
                     codigo_barras=@codigo_barras,
                     activo=1
        WHEN NOT MATCHED THEN
          INSERT (proveedor,sku_proveedor,descripcion_proveedor,unidad_compra,piezas_por_caja,codigo_barras)
          VALUES (@proveedor,@sku_proveedor,@descripcion_proveedor,@unidad_compra,@piezas_por_caja,@codigo_barras);
      `)
    res.json({ ok: true, nombre_interno: prod })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

async function eliminarEquivalencia(req, res) {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' })
  try {
    const db = await getPool()
    await db.request().input('id', sql.Int, id)
      .query('UPDATE productos_compra SET activo=0 WHERE id=@id')
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

// Buscar equivalencia por código escaneado (útil en el TC52)
async function buscarEquivalencia(req, res) {
  const { codigo } = req.params
  try {
    const db = await getPool()
    // Buscar por sku_proveedor O por codigo_barras interno
    const r = await db.request()
      .input('codigo', sql.VarChar(50), codigo)
      .query(`
        SELECT pc.*, v.Art_Descripcion AS nombre_interno
        FROM productos_compra pc
        LEFT JOIN ${VISTA} v ON v.Art_GTIN = pc.codigo_barras
        WHERE (pc.sku_proveedor = @codigo OR pc.codigo_barras = @codigo)
          AND pc.activo = 1
        ORDER BY pc.proveedor
      `)
    res.json(r.recordset)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

// ── RECEPCIONES ESPERADAS (precaptura desde factura) ───────────────────────────

async function getRecepcionesEsperadas(req, res) {
  try {
    const db = await getPool()
    const { estado } = req.query  // Pendiente|Parcial|Recibida|Cancelada|activos
    let filtro = ''
    if (estado === 'activos') filtro = `WHERE re.estatus IN ('Pendiente','Parcial')`
    else if (estado) filtro = `WHERE re.estatus = @estado`

    const r = await db.request()
      .input('estado', sql.VarChar(20), estado || '')
      .query(`
        SELECT re.id, re.referencia, re.proveedor, re.fecha_esperada,
               re.destino_esperado, re.estatus, re.notas,
               CONVERT(VARCHAR(23), re.creado, 120) AS creado,
               COUNT(red.id) AS num_items,
               SUM(red.cajas_esperadas) AS total_cajas_esperadas,
               SUM(red.cajas_esperadas * red.piezas_por_caja) AS total_piezas_esperadas
        FROM recepciones_esperadas re
        LEFT JOIN recepciones_esperadas_detalle red ON red.recepcion_id = re.id
        ${filtro}
        GROUP BY re.id, re.referencia, re.proveedor, re.fecha_esperada,
                 re.destino_esperado, re.estatus, re.notas, re.creado
        ORDER BY re.creado DESC
      `)
    res.json(r.recordset)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

async function getRecepcionEsperadaDetalle(req, res) {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' })
  try {
    const db = await getPool()

    // Encabezado
    const cabR = await db.request().input('id', sql.Int, id)
      .query(`
        SELECT re.*, CONVERT(VARCHAR(23), re.creado, 120) AS creado_fmt
        FROM recepciones_esperadas re WHERE re.id = @id
      `)
    if (!cabR.recordset[0]) return res.status(404).json({ error: 'Recepción no encontrada' })

    // Detalle con nombre del producto
    const detR = await db.request().input('id', sql.Int, id)
      .query(`
        SELECT red.id, red.codigo_barras, red.sku_proveedor,
               red.cajas_esperadas, red.piezas_por_caja,
               red.cajas_esperadas * red.piezas_por_caja AS piezas_esperadas,
               red.notas,
               ${nombreExpr('red.codigo_barras')} AS nombre
        FROM recepciones_esperadas_detalle red
        WHERE red.recepcion_id = @id
        ORDER BY red.id
      `)

    // Recepción real asociada (si existe)
    const realR = await db.request().input('id', sql.Int, id)
      .query(`
        SELECT rr.id, rr.fecha_real, rr.recibido_por, rr.estatus, rr.confirmada,
               CONVERT(VARCHAR(23), rr.fecha_real, 120) AS fecha_real_fmt
        FROM recepciones_reales rr WHERE rr.recepcion_esperada_id = @id
      `)

    res.json({
      ...cabR.recordset[0],
      detalle: detR.recordset,
      recepciones_reales: realR.recordset,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

async function crearRecepcionEsperada(req, res) {
  const { proveedor, fecha_esperada, destino_esperado, notas, items } = req.body
  // items: [{ codigo_barras, sku_proveedor, cajas_esperadas, piezas_por_caja, notas }]
  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'Se requiere al menos un producto en items[]' })

  try {
    const db = await getPool()
    const folio = await generarFolio(db)
    const t = db.transaction()
    await t.begin()
    try {
      // Insertar encabezado
      const r = await t.request()
        .input('referencia',      sql.VarChar(60),  folio)
        .input('proveedor',       sql.VarChar(100), proveedor || null)
        .input('fecha_esperada',  sql.Date,         fecha_esperada || null)
        .input('destino_esperado',sql.VarChar(50),  destino_esperado || null)
        .input('notas',           sql.VarChar(300), notas || null)
        .query(`
          INSERT INTO recepciones_esperadas (referencia, proveedor, fecha_esperada, destino_esperado, notas)
          OUTPUT INSERTED.id
          VALUES (@referencia, @proveedor, @fecha_esperada, @destino_esperado, @notas)
        `)
      const recepcionId = r.recordset[0].id

      // Insertar detalle
      for (const item of items) {
        if (!item.codigo_barras || !item.cajas_esperadas) continue
        await t.request()
          .input('recepcion_id',   sql.Int,         recepcionId)
          .input('codigo_barras',  sql.VarChar(50), item.codigo_barras)
          .input('sku_proveedor',  sql.VarChar(50), item.sku_proveedor || null)
          .input('cajas_esperadas',sql.Int,         item.cajas_esperadas)
          .input('piezas_por_caja',sql.Int,         item.piezas_por_caja || 1)
          .input('notas',          sql.VarChar(200),item.notas || null)
          .query(`
            INSERT INTO recepciones_esperadas_detalle
              (recepcion_id, codigo_barras, sku_proveedor, cajas_esperadas, piezas_por_caja, notas)
            VALUES (@recepcion_id, @codigo_barras, @sku_proveedor, @cajas_esperadas, @piezas_por_caja, @notas)
          `)
      }

      await t.commit()
      res.json({ ok: true, id: recepcionId, folio })
    } catch (e) { await t.rollback(); throw e }
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

async function cancelarRecepcionEsperada(req, res) {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' })
  try {
    const db = await getPool()
    await db.request().input('id', sql.Int, id)
      .query(`UPDATE recepciones_esperadas SET estatus='Cancelada' WHERE id=@id AND estatus='Pendiente'`)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

// ── RECEPCIONES REALES (recepción física con cajas) ───────────────────────────

async function crearRecepcionReal(req, res) {
  const { recepcion_esperada_id, recibido_por, notas, items } = req.body
  // items: [{ codigo_barras, ubicacion, cajas_recibidas, piezas_por_caja, lote, caducidad, notas }]
  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'Se requiere al menos un item en items[]' })

  try {
    const db = await getPool()
    const t = db.transaction()
    await t.begin()
    try {
      const r = await t.request()
        .input('recepcion_esperada_id', sql.Int,         recepcion_esperada_id || null)
        .input('recibido_por',          sql.VarChar(60), recibido_por || null)
        .input('notas',                 sql.VarChar(300),notas || null)
        .query(`
          INSERT INTO recepciones_reales (recepcion_esperada_id, recibido_por, notas)
          OUTPUT INSERTED.id
          VALUES (@recepcion_esperada_id, @recibido_por, @notas)
        `)
      const recepcionRealId = r.recordset[0].id

      for (const item of items) {
        if (!item.codigo_barras || !item.cajas_recibidas) continue
        await t.request()
          .input('recepcion_real_id', sql.Int,         recepcionRealId)
          .input('codigo_barras',     sql.VarChar(50), item.codigo_barras)
          .input('ubicacion',         sql.VarChar(50), item.ubicacion || 'Bodega')
          .input('cajas_recibidas',   sql.Int,         item.cajas_recibidas)
          .input('piezas_por_caja',   sql.Int,         item.piezas_por_caja || 1)
          .input('lote',              sql.VarChar(50), item.lote || null)
          .input('caducidad',         sql.Date,        item.caducidad || null)
          .input('notas',             sql.VarChar(200),item.notas || null)
          .query(`
            INSERT INTO recepciones_reales_detalle
              (recepcion_real_id, codigo_barras, ubicacion, cajas_recibidas, piezas_por_caja, lote, caducidad, notas)
            VALUES (@recepcion_real_id, @codigo_barras, @ubicacion, @cajas_recibidas, @piezas_por_caja, @lote, @caducidad, @notas)
          `)
      }

      // Marcar la recepción esperada como Parcial si existe
      if (recepcion_esperada_id) {
        await t.request().input('id', sql.Int, recepcion_esperada_id)
          .query(`
            UPDATE recepciones_esperadas SET estatus='Parcial'
            WHERE id=@id AND estatus='Pendiente'
          `)
      }

      await t.commit()
      res.json({ ok: true, id: recepcionRealId })
    } catch (e) { await t.rollback(); throw e }
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

async function agregarItemRecepcionReal(req, res) {
  // Para cuando el TC52 escanea de a uno (sin crear toda la recepción de golpe)
  const id = parseInt(req.params.id, 10)
  const { codigo_barras, ubicacion, cajas_recibidas, piezas_por_caja, lote, caducidad, notas } = req.body
  if (isNaN(id) || !codigo_barras || !cajas_recibidas)
    return res.status(400).json({ error: 'Datos inválidos' })
  try {
    const db = await getPool()
    // Verificar que la recepción existe y no está confirmada
    const rec = await db.request().input('id', sql.Int, id)
      .query('SELECT confirmada FROM recepciones_reales WHERE id=@id')
    if (!rec.recordset[0]) return res.status(404).json({ error: 'Recepción no encontrada' })
    if (rec.recordset[0].confirmada) return res.status(400).json({ error: 'La recepción ya fue confirmada' })

    const nombre = await getNombreProducto(db, codigo_barras)
    if (!nombre) return res.status(404).json({ error: `Código ${codigo_barras} no encontrado en el catálogo` })

    // piezas_por_caja: 1) lo que mande el TC52  2) el snapshot de la ORDEN esperada ligada
    //                  3) equivalencias productos_compra  4) 1
    let ppc = piezas_por_caja || null
    if (!ppc) {
      const ord = await db.request()
        .input('rrid',   sql.Int,        id)
        .input('codigo', sql.VarChar(50), codigo_barras)
        .query(`
          SELECT TOP 1 red.piezas_por_caja
          FROM recepciones_reales rr
          JOIN recepciones_esperadas_detalle red
            ON red.recepcion_id = rr.recepcion_esperada_id
          WHERE rr.id = @rrid AND red.codigo_barras = @codigo
          ORDER BY red.id DESC
        `)
      if (ord.recordset[0]?.piezas_por_caja) ppc = ord.recordset[0].piezas_por_caja
    }
    if (!ppc) {
      const eq = await db.request().input('codigo', sql.VarChar(50), codigo_barras)
        .query('SELECT TOP 1 piezas_por_caja FROM productos_compra WHERE codigo_barras=@codigo AND activo=1')
      if (eq.recordset[0]) ppc = eq.recordset[0].piezas_por_caja
    }
    ppc = ppc || 1

    const r = await db.request()
      .input('recepcion_real_id', sql.Int,         id)
      .input('codigo_barras',     sql.VarChar(50), codigo_barras)
      .input('ubicacion',         sql.VarChar(50), ubicacion || 'Bodega')
      .input('cajas_recibidas',   sql.Int,         cajas_recibidas)
      .input('piezas_por_caja',   sql.Int,         ppc)
      .input('lote',              sql.VarChar(50), lote || null)
      .input('caducidad',         sql.Date,        caducidad || null)
      .input('notas',             sql.VarChar(200),notas || null)
      .query(`
        INSERT INTO recepciones_reales_detalle
          (recepcion_real_id, codigo_barras, ubicacion, cajas_recibidas, piezas_por_caja, lote, caducidad, notas)
        OUTPUT INSERTED.id, INSERTED.piezas_resultantes
        VALUES (@recepcion_real_id, @codigo_barras, @ubicacion, @cajas_recibidas, @piezas_por_caja, @lote, @caducidad, @notas)
      `)
    res.json({
      ok: true,
      id: r.recordset[0].id,
      piezas_resultantes: r.recordset[0].piezas_resultantes,
      nombre,
      piezas_por_caja: ppc,
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

async function getRecepcionReal(req, res) {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' })
  try {
    const db = await getPool()
    const cabR = await db.request().input('id', sql.Int, id)
      .query(`
        SELECT rr.*, CONVERT(VARCHAR(23), rr.fecha_real, 120) AS fecha_real_fmt,
               CONVERT(VARCHAR(23), rr.creado, 120) AS creado_fmt
        FROM recepciones_reales rr WHERE rr.id = @id
      `)
    if (!cabR.recordset[0]) return res.status(404).json({ error: 'Recepción real no encontrada' })

    const detR = await db.request().input('id', sql.Int, id)
      .query(`
        SELECT rrd.id, rrd.codigo_barras, rrd.ubicacion,
               rrd.cajas_recibidas, rrd.piezas_por_caja, rrd.piezas_resultantes,
               CONVERT(VARCHAR(10), rrd.caducidad, 23) AS caducidad,
               rrd.lote, rrd.notas,
               ${nombreExpr('rrd.codigo_barras')} AS nombre
        FROM recepciones_reales_detalle rrd
        WHERE rrd.recepcion_real_id = @id
        ORDER BY rrd.id
      `)
    res.json({ ...cabR.recordset[0], detalle: detR.recordset })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

// ── CONFIRMAR RECEPCIÓN (convierte cajas→piezas, escribe inventario+movimientos) ─

async function confirmarRecepcion(req, res) {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' })
  try {
    const db = await getPool()

    // ¿Existe?
    const rec = await db.request().input('id', sql.Int, id)
      .query('SELECT id, confirmada, recepcion_esperada_id FROM recepciones_reales WHERE id=@id')
    if (!rec.recordset[0]) return res.status(404).json({ error: `No existe la recepción real ${id}` })

    // Candado anti-doble-aplicación: reclama la confirmación de forma atómica.
    const claim = await db.request().input('id', sql.Int, id)
      .query(`UPDATE recepciones_reales SET confirmada=1, estatus='Confirmada'
              WHERE id=@id AND confirmada=0`)
    if (!claim.rowsAffected[0])
      return res.status(400).json({ error: `La recepción ${id} ya fue confirmada; no se vuelve a aplicar.` })

    // Renglones recibidos (ya convertidos caja→pieza vía piezas_resultantes)
    const det = await db.request().input('id', sql.Int, id)
      .query(`SELECT codigo_barras, ubicacion, piezas_resultantes, lote,
                     CONVERT(VARCHAR(10), caducidad, 23) AS caducidad
              FROM recepciones_reales_detalle
              WHERE recepcion_real_id=@id AND piezas_resultantes > 0`)

    const sqlite = getDb()
    let totalPiezas = 0

    for (const row of det.recordset) {
      const piezas = Number(row.piezas_resultantes) || 0
      if (piezas <= 0) continue

      // Resolver Art_Codigo (clave real de ArticulosAlmacen) desde el código recibido
      const prod = await db.request().input('c', sql.VarChar(50), row.codigo_barras)
        .query(`SELECT TOP 1 Art_Codigo AS codigo, Art_Descripcion AS nombre
                FROM ${VISTA}
                WHERE Art_GTIN=@c OR CodAlt_Codigo=@c OR Art_Codigo=@c OR Art_PLU=@c`)
      const artCodigo = prod.recordset[0]?.codigo || row.codigo_barras
      const nombre    = prod.recordset[0]?.nombre || null
      const area      = String(row.ubicacion || 'Bodega').toLowerCase()

      // Stock real ANTES (suma de todos los almacenes — igual que /entrada)
      const stRes = await db.request().input('c', sql.VarChar(50), artCodigo)
        .query(`SELECT ISNULL(SUM(AA_ExistenciaActualU),0) AS stock
                FROM [compucaja].[dbo].[ArticulosAlmacen] WHERE Art_Codigo=@c`)
      const antes   = Number(stRes.recordset[0]?.stock) || 0
      const despues = antes + piezas

      // 1) Sumar al STOCK REAL en UNA sola tienda (la principal, Tda 1) para que el
      //    total no se infle en productos multi-tienda. Si no hay fila de Tda 1,
      //    cae a cualquier fila única del producto.
      const upd = await db.request()
        .input('c', sql.VarChar(50), artCodigo)
        .input('q', sql.Int,         piezas)
        .query(`UPDATE TOP (1) [compucaja].[dbo].[ArticulosAlmacen]
                SET AA_ExistenciaActualU = AA_ExistenciaActualU + @q,
                    AA_FechaUltimaEntrada = GETDATE()
                WHERE Art_Codigo=@c AND Tda_Codigo='1'`)
      if (!upd.rowsAffected[0]) {
        await db.request()
          .input('c', sql.VarChar(50), artCodigo)
          .input('q', sql.Int,         piezas)
          .query(`UPDATE TOP (1) [compucaja].[dbo].[ArticulosAlmacen]
                  SET AA_ExistenciaActualU = AA_ExistenciaActualU + @q,
                      AA_FechaUltimaEntrada = GETDATE()
                  WHERE Art_Codigo=@c`)
      }

      // 2) Historial unificado (SQLite, mismo ledger que entrada/salida del TC52)
      sqlite.prepare(`
        INSERT INTO almacen_movimientos
          (art_codigo, nombre, tipo, cantidad, stock_antes, stock_despues, area, usuario)
        VALUES (?, ?, 'entrada', ?, ?, ?, ?, 'Recepcion')
      `).run(artCodigo, nombre, piezas, antes, despues, area)

      // 3) Stock por ubicación (fuente unificada: MSSQL inventario_bodega).
      //    Convención igual que /traslado: codigo_barras = Art_Codigo, ubicacion = nombre del área.
      const ubicNombre = row.ubicacion || 'Bodega';
      await db.request()
        .input('cb', sql.VarChar(50), artCodigo)
        .input('ub', sql.VarChar(50), ubicNombre)
        .input('q',  sql.Int,         piezas)
        .query(`
          MERGE [compucaja].[dbo].[inventario_bodega] AS t
          USING (SELECT @cb AS cb, @ub AS ub) AS s
            ON t.codigo_barras = s.cb AND t.ubicacion = s.ub
          WHEN MATCHED THEN UPDATE SET cantidad = t.cantidad + @q, ultima_entrada = GETDATE()
          WHEN NOT MATCHED THEN INSERT (codigo_barras, ubicacion, cantidad, ultima_entrada, creado)
            VALUES (@cb, @ub, @q, GETDATE(), GETDATE());
        `)

      totalPiezas += piezas
    }

    // Marcar la orden esperada como Recibida (si está ligada)
    if (rec.recordset[0].recepcion_esperada_id) {
      await db.request().input('eid', sql.Int, rec.recordset[0].recepcion_esperada_id)
        .query(`UPDATE recepciones_esperadas SET estatus='Recibida'
                WHERE id=@eid AND estatus <> 'Recibida'`)
    }

    res.json({ ok: true, mensaje: `Recepción ${id} confirmada. +${totalPiezas} piezas al stock.`, piezas: totalPiezas })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

// ── DISCREPANCIAS (vista: esperado vs recibido) ────────────────────────────────

async function getDiscrepancias(req, res) {
  const id = req.params.id ? parseInt(req.params.id, 10) : null
  try {
    const db = await getPool()
    let q = `
      SELECT d.recepcion_esperada_id, d.referencia, d.proveedor, d.codigo_barras,
             ${nombreExpr('d.codigo_barras')} AS nombre,
             d.cajas_esperadas, d.cajas_recibidas, d.diferencia_cajas,
             d.cajas_esperadas * ISNULL(NULLIF(red.piezas_por_caja,0), 1) AS piezas_esperadas,
             d.cajas_recibidas  * ISNULL(NULLIF(red.piezas_por_caja,0), 1) AS piezas_recibidas
      FROM v_recepcion_discrepancias d
      LEFT JOIN recepciones_esperadas_detalle red
        ON red.recepcion_id = d.recepcion_esperada_id AND red.codigo_barras = d.codigo_barras
    `
    if (id) q += ' WHERE d.recepcion_esperada_id = @id'
    q += ' ORDER BY d.referencia, d.codigo_barras'
    const r = await db.request().input('id', sql.Int, id || 0).query(q)
    res.json(r.recordset)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

// ── CADUCIDADES (productos con fecha de vencimiento registrada) ────────────────

async function getCaducidades(req, res) {
  // Devuelve todos los items con caducidad del historial de recepciones,
  // agrupados por código + ubicación + lote + caducidad.
  try {
    const db = await getPool()
    const { dias } = req.query   // días de alerta anticipada (default 30)
    const diasAlerta = parseInt(dias, 10) || 30
    const r = await db.request()
      .input('diasAlerta', sql.Int, diasAlerta)
      .query(`
        SELECT
          rrd.codigo_barras,
          ${nombreExpr('rrd.codigo_barras')} AS nombre,
          rrd.ubicacion,
          rrd.lote,
          CONVERT(VARCHAR(10), rrd.caducidad, 23) AS caducidad,
          SUM(rrd.piezas_resultantes) AS piezas_totales,
          DATEDIFF(DAY, GETDATE(), rrd.caducidad) AS dias_para_vencer,
          CASE
            WHEN rrd.caducidad < GETDATE() THEN 'VENCIDO'
            WHEN DATEDIFF(DAY, GETDATE(), rrd.caducidad) <= 7  THEN 'CRITICO'
            WHEN DATEDIFF(DAY, GETDATE(), rrd.caducidad) <= @diasAlerta THEN 'AVISO'
            ELSE 'OK'
          END AS semaforo,
          rr.id AS recepcion_real_id,
          re.referencia AS folio_recepcion,
          CONVERT(VARCHAR(10), rr.fecha_real, 23) AS fecha_recepcion
        FROM recepciones_reales_detalle rrd
        JOIN recepciones_reales rr ON rr.id = rrd.recepcion_real_id AND rr.confirmada = 1
        LEFT JOIN recepciones_esperadas re ON re.id = rr.recepcion_esperada_id
        WHERE rrd.caducidad IS NOT NULL
          AND rrd.piezas_resultantes > 0
        GROUP BY rrd.codigo_barras, rrd.ubicacion,
                 rrd.lote, rrd.caducidad, rr.id, re.referencia, rr.fecha_real
        ORDER BY rrd.caducidad ASC
      `)
    res.json(r.recordset)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

async function getProximosVencer(req, res) {
  // Shortcut: solo los que vencen en X días (para alertas)
  const dias = parseInt(req.query.dias, 10) || 7
  try {
    const db = await getPool()
    const r = await db.request()
      .input('dias', sql.Int, dias)
      .query(`
        SELECT rrd.codigo_barras,
               ${nombreExpr('rrd.codigo_barras')} AS nombre,
               rrd.ubicacion, rrd.lote,
               CONVERT(VARCHAR(10), rrd.caducidad, 23) AS caducidad,
               SUM(rrd.piezas_resultantes) AS piezas_totales,
               DATEDIFF(DAY, GETDATE(), rrd.caducidad) AS dias_para_vencer
        FROM recepciones_reales_detalle rrd
        JOIN recepciones_reales rr ON rr.id = rrd.recepcion_real_id AND rr.confirmada = 1
        WHERE rrd.caducidad IS NOT NULL
          AND rrd.piezas_resultantes > 0
          AND DATEDIFF(DAY, GETDATE(), rrd.caducidad) <= @dias
        GROUP BY rrd.codigo_barras, rrd.ubicacion, rrd.lote, rrd.caducidad
        ORDER BY rrd.caducidad ASC
      `)
    res.json(r.recordset)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

// ── INICIO RÁPIDO DESDE TC52 (escanear → crear/continuar recepción real) ───────
// El TC52 necesita poder:
//  1. Obtener pedidos abiertos (ya existe en bodega.js → /api/almacen/pedidos)
//  2. Crear una recepción real abierta ligada (o no) a un pedido
//  3. Ir escaneando cajas una a una
//  4. El admin confirma desde el panel

async function abrirRecepcionRealParaPedido(req, res) {
  // Si ya existe una recepción real Abierta para ese pedido, la devuelve.
  // Si no, crea una nueva.
  const { recepcion_esperada_id, recibido_por } = req.body
  try {
    const db = await getPool()
    if (recepcion_esperada_id) {
      const existente = await db.request()
        .input('id', sql.Int, recepcion_esperada_id)
        .query(`SELECT TOP 1 id FROM recepciones_reales
                WHERE recepcion_esperada_id=@id AND estatus='Abierta' AND confirmada=0
                ORDER BY creado DESC`)
      if (existente.recordset[0]) {
        return res.json({ ok: true, id: existente.recordset[0].id, nueva: false })
      }
    }
    // Crear nueva
    const r = await db.request()
      .input('recepcion_esperada_id', sql.Int,         recepcion_esperada_id || null)
      .input('recibido_por',          sql.VarChar(60), recibido_por || 'TC52')
      .query(`
        INSERT INTO recepciones_reales (recepcion_esperada_id, recibido_por)
        OUTPUT INSERTED.id
        VALUES (@recepcion_esperada_id, @recibido_por)
      `)
    const recepcionRealId = r.recordset[0].id

    // Marcar pedido como en_recepcion (tabla recepciones_esperadas usa Parcial)
    if (recepcion_esperada_id) {
      await db.request().input('id', sql.Int, recepcion_esperada_id)
        .query(`UPDATE recepciones_esperadas SET estatus='Parcial'
                WHERE id=@id AND estatus='Pendiente'`)
    }

    res.json({ ok: true, id: recepcionRealId, nueva: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}

// ── REGISTRO DE RUTAS ─────────────────────────────────────────────────────────
// Llama a setupRecepcionRoutes(app) desde tu index.js

function setupRecepcionRoutes(app) {
  // Equivalencias
  app.get('/api/recepcion/equivalencias',                getEquivalencias)
  app.post('/api/recepcion/equivalencias',               crearEquivalencia)
  app.delete('/api/recepcion/equivalencias/:id',         eliminarEquivalencia)
  app.get('/api/recepcion/equivalencias/buscar/:codigo', buscarEquivalencia)

  // Recepciones esperadas (precaptura)
  app.get('/api/recepcion/esperadas',          getRecepcionesEsperadas)
  app.get('/api/recepcion/esperadas/:id',      getRecepcionEsperadaDetalle)
  app.post('/api/recepcion/esperadas',         crearRecepcionEsperada)
  app.patch('/api/recepcion/esperadas/:id/cancelar', cancelarRecepcionEsperada)

  // Recepciones reales (recepción física)
  app.post('/api/recepcion/reales',                          crearRecepcionReal)
  app.post('/api/recepcion/reales/abrir',                    abrirRecepcionRealParaPedido)
  app.get('/api/recepcion/reales/:id',                       getRecepcionReal)
  app.post('/api/recepcion/reales/:id/items',                agregarItemRecepcionReal)
  app.post('/api/recepcion/reales/:id/confirmar',            confirmarRecepcion)

  // Discrepancias
  app.get('/api/recepcion/discrepancias',      getDiscrepancias)
  app.get('/api/recepcion/discrepancias/:id',  getDiscrepancias)

  // Caducidades
  app.get('/api/recepcion/caducidades',        getCaducidades)
  app.get('/api/recepcion/caducidades/alerta', getProximosVencer)

  console.log(' Rutas de recepción registradas (/api/recepcion/*)')
}

module.exports = {
  getEquivalencias,
  crearEquivalencia,
  eliminarEquivalencia,
  buscarEquivalencia,
  getRecepcionesEsperadas,
  getRecepcionEsperadaDetalle,
  crearRecepcionEsperada,
  cancelarRecepcionEsperada,
  crearRecepcionReal,
  agregarItemRecepcionReal,
  getRecepcionReal,
  confirmarRecepcion,
  getDiscrepancias,
  getCaducidades,
  getProximosVencer,
  abrirRecepcionRealParaPedido,
  setupRecepcionRoutes,
};
