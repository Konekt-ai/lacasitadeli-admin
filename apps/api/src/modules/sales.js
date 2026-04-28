const express = require('express');
const db = require('../db');
const router = express.Router();

// POST /api/sales  — registrar venta (transacción atómica en Node.js)
router.post('/', async (req, res) => {
  const { items, paymentMethod, notes, userId, canal } = req.body;

  if (!items || !items.length) {
    return res.status(400).json({ error: 'La venta debe tener al menos un producto' });
  }

  // Generar folio
  let folio;
  try {
    const lastRes = await db.query(
      `SELECT TOP 1 folio FROM ventas WHERE canal = $1 ORDER BY created_at DESC`,
      [canal || 'caja']
    );
    if (lastRes.rows.length) {
      const match = lastRes.rows[0].folio.match(/\d+$/);
      const num = match ? parseInt(match[0]) + 1 : 1;
      folio = `${(canal || 'CAJA').toUpperCase()}-${String(num).padStart(6, '0')}`;
    } else {
      folio = `${(canal || 'CAJA').toUpperCase()}-000001`;
    }
  } catch {
    folio = `${(canal || 'CAJA').toUpperCase()}-${Date.now()}`;
  }

  const pool = await db.getPool();
  const transaction = new db.sql.Transaction(pool);
  try {
    await transaction.begin();

    // Insertar venta con total=0 inicialmente
    const ventaResult = await new db.sql.Request(transaction)
      .input('folio',       folio)
      .input('canal',       canal || 'caja')
      .input('usuario_id',  userId || null)
      .input('metodo_pago', paymentMethod || 'efectivo')
      .query(`
        INSERT INTO ventas (folio, canal, usuario_id, metodo_pago, total)
        OUTPUT INSERTED.id
        VALUES (@folio, @canal, @usuario_id, @metodo_pago, 0)
      `);
    const ventaId = ventaResult.recordset[0].id;

    let total = 0;

    for (const item of items) {
      // Bloquear y leer producto
      const prodResult = await new db.sql.Request(transaction)
        .input('id', item.productId)
        .query(`
          SELECT nombre, stock_actual
          FROM productos WITH (UPDLOCK, ROWLOCK)
          WHERE id = @id
        `);

      if (!prodResult.recordset.length) {
        throw new Error(`Producto con ID ${item.productId} no encontrado`);
      }

      const prod       = prodResult.recordset[0];
      const stockAntes = parseFloat(prod.stock_actual);
      const cantidad   = parseFloat(item.quantity);
      const precio     = parseFloat(item.unitPrice);
      const subtotal   = cantidad * precio;
      total += subtotal;

      // Insertar detalle
      await new db.sql.Request(transaction)
        .input('venta_id',       ventaId)
        .input('producto_id',    item.productId)
        .input('nombre',         prod.nombre)
        .input('cantidad',       cantidad)
        .input('precio',         precio)
        .input('subtotal',       subtotal)
        .query(`
          INSERT INTO detalle_venta
            (venta_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal)
          VALUES (@venta_id, @producto_id, @nombre, @cantidad, @precio, @subtotal)
        `);

      // Actualizar stock
      await new db.sql.Request(transaction)
        .input('cantidad',    cantidad)
        .input('producto_id', item.productId)
        .query(`
          UPDATE productos
          SET stock_actual = stock_actual - @cantidad,
              updated_at   = GETDATE()
          WHERE id = @producto_id
        `);

      // Movimiento de inventario
      await new db.sql.Request(transaction)
        .input('producto_id',  item.productId)
        .input('cantidad',     -cantidad)
        .input('antes',        stockAntes)
        .input('despues',      stockAntes - cantidad)
        .input('motivo',       'Venta ' + folio)
        .input('usuario_id',   userId || null)
        .query(`
          INSERT INTO movimientos_inventario
            (producto_id, tipo, cantidad, stock_antes, stock_despues, motivo, usuario_id)
          VALUES (@producto_id, 'venta', @cantidad, @antes, @despues, @motivo, @usuario_id)
        `);
    }

    // Actualizar total de la venta
    await new db.sql.Request(transaction)
      .input('total',    total)
      .input('venta_id', ventaId)
      .query(`UPDATE ventas SET total = @total WHERE id = @venta_id`);

    if (notes) {
      await new db.sql.Request(transaction)
        .input('notas',    notes)
        .input('venta_id', ventaId)
        .query(`UPDATE ventas SET notas = @notas WHERE id = @venta_id`);
    }

    await transaction.commit();
    res.json({ success: true, ventaId, folio, total });

  } catch (err) {
    await transaction.rollback();
    console.error('Error al procesar venta:', err.message);
    res.status(400).json({ error: err.message || 'Error al procesar la venta' });
  }
});

// GET /api/sales/report
router.get('/report', async (req, res) => {
  const { date, canal } = req.query;

  let startTs, endTs;
  if (date) {
    startTs = `${date} 00:00:00`;
    endTs   = `${date} 23:59:59`;
  } else {
    const today = new Date().toISOString().split('T')[0];
    startTs = `${today} 00:00:00`;
    endTs   = `${today} 23:59:59`;
  }

  try {
    const params = [startTs, endTs];
    let canalFilter = '';
    if (canal) {
      params.push(canal);
      canalFilter = `AND v.canal = $${params.length}`;
    }

    const summaryRes = await db.query(`
      SELECT
        COUNT(*)                                                                     AS totalVentas,
        COALESCE(SUM(v.total), 0)                                                   AS totalIngresos,
        COALESCE(AVG(v.total), 0)                                                   AS ticketPromedio,
        COALESCE(SUM(CASE WHEN v.metodo_pago = 'efectivo'      THEN v.total ELSE 0 END), 0) AS totalEfectivo,
        COALESCE(SUM(CASE WHEN v.metodo_pago = 'tarjeta'       THEN v.total ELSE 0 END), 0) AS totalTarjeta,
        COALESCE(SUM(CASE WHEN v.metodo_pago = 'transferencia' THEN v.total ELSE 0 END), 0) AS totalTransferencia,
        COALESCE(SUM(v.total) - SUM(COALESCE((
          SELECT SUM(dv.cantidad * p.precio_compra)
          FROM detalle_venta dv
          JOIN productos p ON p.id = dv.producto_id
          WHERE dv.venta_id = v.id
        ), 0)), 0) AS gananciaEstimada
      FROM ventas v
      WHERE v.estado = 'completada'
        AND v.created_at BETWEEN $1 AND $2
        ${canalFilter}
    `, params);

    const topProductsRes = await db.query(`
      SELECT TOP 10
        dv.nombre_producto       AS name,
        SUM(dv.cantidad)         AS unidadesVendidas,
        SUM(dv.subtotal)         AS ingresos
      FROM detalle_venta dv
      JOIN ventas v ON v.id = dv.venta_id
      WHERE v.estado = 'completada'
        AND v.created_at BETWEEN $1 AND $2
        ${canalFilter}
      GROUP BY dv.nombre_producto
      ORDER BY SUM(dv.cantidad) DESC
    `, params);

    const ventasRes = await db.query(`
      SELECT
        v.id,
        v.folio           AS invoiceNumber,
        v.total,
        v.metodo_pago     AS paymentMethod,
        v.canal,
        v.estado,
        v.created_at      AS createdAt,
        u.nombre          AS cajero,
        (SELECT COUNT(*) FROM detalle_venta dv WHERE dv.venta_id = v.id) AS numProductos
      FROM ventas v
      LEFT JOIN usuarios u ON u.id = v.usuario_id
      WHERE v.estado = 'completada'
        AND v.created_at BETWEEN $1 AND $2
        ${canalFilter}
      ORDER BY v.created_at DESC
    `, params);

    res.json({
      summary:     summaryRes.rows[0],
      topProducts: topProductsRes.rows,
      ventas:      ventasRes.rows,
    });
  } catch (err) {
    console.error('Error al generar reporte:', err.message);
    res.status(500).json({ error: 'Error al generar reporte' });
  }
});

// GET /api/sales/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const ventaRes = await db.query(
      `SELECT v.*, u.nombre AS cajero
       FROM ventas v
       LEFT JOIN usuarios u ON u.id = v.usuario_id
       WHERE v.id = $1`, [id]
    );
    if (!ventaRes.rows.length) return res.status(404).json({ error: 'Venta no encontrada' });

    const detalleRes = await db.query(
      `SELECT * FROM detalle_venta WHERE venta_id = $1 ORDER BY id`, [id]
    );

    res.json({ venta: ventaRes.rows[0], detalle: detalleRes.rows });
  } catch (err) {
    console.error('Error al obtener venta:', err.message);
    res.status(500).json({ error: 'Error al obtener venta' });
  }
});

// PATCH /api/sales/:id/cancel
router.patch('/:id/cancel', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query(
      `UPDATE ventas SET estado = 'cancelada' WHERE id = $1`, [id]
    );
    res.json({ message: 'Venta cancelada' });
  } catch (err) {
    console.error('Error al cancelar venta:', err.message);
    res.status(500).json({ error: 'Error al cancelar venta' });
  }
});

module.exports = router;
