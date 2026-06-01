// ============================================================
// _seed_demo.js — Datos de prueba para la demo de recepción por cajas.
// NO destructivo: solo inserta/actualiza filas DEMO. Idempotente.
//   1. Equivalencias en productos_compra (SKU proveedor -> producto, caja->pieza)
//   2. Una recepción esperada "trailer" (DEMO-FACTURA-001) con cajas + piezas/caja
// Usa productos REALES del catálogo (casa por Art_Codigo).
// ============================================================
const { getPool, sql } = require('./src/db/mssql');

const PROVEEDOR  = 'DEMO TRAILER';
const REFERENCIA = 'DEMO-FACTURA-001';

// Productos candidatos (código real = Art_Codigo). Solo se siembran los que existan.
const CANDIDATOS = [
  { codigo: '019836200218', sku: 'BOING-DUR', desc: 'BOING DURAZNO 500ML',          ppc: 24, cajas: 5 },
  { codigo: '019836103069', sku: 'BOING-UVA', desc: 'BOING UVA 500ML',              ppc: 24, cajas: 3 },
  { codigo: '019836103052', sku: 'BOING-MZN', desc: 'BOING MANZANA 500ML',          ppc: 24, cajas: 2 },
  { codigo: '021136010534', sku: 'TOPO-340',  desc: 'AGUA MINERAL TOPO CHICO 340ML', ppc: 24, cajas: 4 },
  { codigo: '019900003332', sku: 'CLABBER',   desc: 'POLVO HORNEAR CLABBER GIRL 624GR', ppc: 12, cajas: 2 },
  { codigo: '40235972',     sku: 'DEDOS-NOV', desc: 'DEDOS DE NOVIA GRANDE',         ppc: 12, cajas: 3 },
];

(async () => {
  try {
    const db = await getPool();

    // 0. Verificar que inventario_bodega existe (lo escribe la confirmación)
    const invT = await db.request().query(
      `SELECT COUNT(*) AS n FROM sys.tables WHERE name='inventario_bodega'`);
    console.log('inventario_bodega existe:', invT.recordset[0].n > 0);

    // 1. Filtrar candidatos a los que REALMENTE existen en el catálogo
    const items = [];
    for (const c of CANDIDATOS) {
      const r = await db.request().input('c', sql.VarChar(50), c.codigo)
        .query(`SELECT TOP 1 Art_Codigo AS codigo, Art_Descripcion AS nombre
                FROM [compucaja].[dbo].[VArticulosUnificados]
                WHERE Art_GTIN=@c OR Art_Codigo=@c OR CodAlt_Codigo=@c OR Art_PLU=@c`);
      if (r.recordset[0]) {
        items.push({ ...c, nombreReal: r.recordset[0].nombre });
      } else {
        console.log('  (omitido, no existe en catálogo):', c.codigo, c.desc);
      }
    }
    if (!items.length) { console.log('No hay productos válidos para sembrar.'); process.exit(0); }

    // 2. Equivalencias productos_compra (MERGE idempotente por proveedor+sku)
    for (const it of items) {
      await db.request()
        .input('prov', sql.VarChar(100), PROVEEDOR)
        .input('sku',  sql.VarChar(50),  it.sku)
        .input('desc', sql.VarChar(200), it.desc)
        .input('ppc',  sql.Int,          it.ppc)
        .input('cb',   sql.VarChar(50),  it.codigo)
        .query(`
          MERGE productos_compra AS t
          USING (SELECT @prov AS p, @sku AS s) AS src ON t.proveedor=src.p AND t.sku_proveedor=src.s
          WHEN MATCHED THEN UPDATE SET descripcion_proveedor=@desc, unidad_compra='Caja',
                                       piezas_por_caja=@ppc, codigo_barras=@cb, activo=1
          WHEN NOT MATCHED THEN
            INSERT (proveedor, sku_proveedor, descripcion_proveedor, unidad_compra, piezas_por_caja, codigo_barras)
            VALUES (@prov, @sku, @desc, 'Caja', @ppc, @cb);
        `);
    }
    console.log(`Equivalencias sembradas: ${items.length}`);

    // 3. Recepción esperada DEMO (reusar si ya existe y sigue abierta)
    let recId;
    const ya = await db.request().input('ref', sql.VarChar(60), REFERENCIA)
      .query(`SELECT TOP 1 id, estatus FROM recepciones_esperadas WHERE referencia=@ref ORDER BY id DESC`);
    if (ya.recordset[0] && ya.recordset[0].estatus !== 'Recibida' && ya.recordset[0].estatus !== 'Cancelada') {
      recId = ya.recordset[0].id;
      // Limpia el detalle DEMO previo para no duplicar (solo de ESTA orden DEMO)
      await db.request().input('id', sql.Int, recId)
        .query(`DELETE FROM recepciones_esperadas_detalle WHERE recepcion_id=@id`);
      console.log('Reusando recepción esperada DEMO id =', recId);
    } else {
      const ins = await db.request()
        .input('ref',  sql.VarChar(60),  REFERENCIA)
        .input('prov', sql.VarChar(100), PROVEEDOR)
        .input('dest', sql.VarChar(50),  'Bodega')
        .input('notas', sql.VarChar(300),'Orden de prueba para demo de recepción por cajas (TC52)')
        .query(`
          INSERT INTO recepciones_esperadas (referencia, proveedor, fecha_esperada, destino_esperado, estatus, notas)
          OUTPUT INSERTED.id
          VALUES (@ref, @prov, CAST(GETDATE() AS DATE), @dest, 'Pendiente', @notas)`);
      recId = ins.recordset[0].id;
      console.log('Recepción esperada DEMO creada id =', recId);
    }

    // 4. Detalle (cajas + piezas_por_caja)
    for (const it of items) {
      await db.request()
        .input('id',  sql.Int,         recId)
        .input('cb',  sql.VarChar(50), it.codigo)
        .input('sku', sql.VarChar(50), it.sku)
        .input('cj',  sql.Int,         it.cajas)
        .input('ppc', sql.Int,         it.ppc)
        .query(`
          INSERT INTO recepciones_esperadas_detalle (recepcion_id, codigo_barras, sku_proveedor, cajas_esperadas, piezas_por_caja)
          VALUES (@id, @cb, @sku, @cj, @ppc)`);
    }

    // 5. Resumen para el guion de la demo
    console.log('\n=== ORDEN DE PRUEBA LISTA ===');
    console.log(`Proveedor: ${PROVEEDOR}  |  Referencia: ${REFERENCIA}  |  id esperada: ${recId}`);
    let totPz = 0;
    for (const it of items) {
      const pz = it.cajas * it.ppc; totPz += pz;
      console.log(`  ${it.codigo}  ${it.cajas} cajas x ${it.ppc} pz = ${pz}  · ${it.nombreReal}`);
    }
    console.log(`  TOTAL esperado: ${items.reduce((s,i)=>s+i.cajas,0)} cajas = ${totPz} piezas`);
  } catch (e) {
    console.error('SEED_ERROR:', e.message);
  }
  process.exit(0);
})();
