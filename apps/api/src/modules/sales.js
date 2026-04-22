const express = require('express');
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// POST /api/sales  — registrar venta usando la función registrar_venta() del schema
router.post('/', async (req, res) => {
  const { items, paymentMethod, notes, userId, canal } = req.body;

  if (!items || !items.length) {
    return res.status(400).json({ error: 'La venta debe tener al menos un producto' });
  }

  // Generar folio automático
  let folio;
  try {
    const lastRes = await db.query(
      `SELECT folio FROM ventas WHERE canal = $1 ORDER BY created_at DESC LIMIT 1`,
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

  try {
    // Usar la función atómica del schema
    const itemsJson = JSON.stringify(
      items.map(i => ({
        producto_id: i.productId,
        cantidad: i.quantity,
        precio_unitario: i.unitPrice,
      }))
    );

    const result = await db.query(
      `SELECT registrar_venta($1, $2, $3, $4, $5::jsonb) AS venta_id`,
      [folio, canal || 'caja', userId || null, paymentMethod || 'efectivo', itemsJson]
    );

    const ventaId = result.rows[0].venta_id;

    // Agregar notas si hay
    if (notes) {
      await db.query(`UPDATE ventas SET notas = $1 WHERE id = $2`, [notes, ventaId]);
    }

    // Obtener total de la venta
    const ventaRes = await db.query(`SELECT total::float, folio FROM ventas WHERE id = $1`, [ventaId]);
    const venta = ventaRes.rows[0];

    res.json({
      success: true,
      ventaId,
      folio: venta.folio,
      total: venta.total,
    });
  } catch (err) {
    console.error('Error al procesar venta:', err.message);
    res.status(400).json({ error: err.message || 'Error al procesar la venta' });
  }
});

// GET /api/sales/report  — reporte diario usando vista_ventas_diarias
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

    // Resumen general
    const summaryRes = await db.query(`
      SELECT
        COUNT(*)::int                                                   AS "totalVentas",
        COALESCE(SUM(v.total), 0)::float                               AS "totalIngresos",
        COALESCE(AVG(v.total), 0)::float                               AS "ticketPromedio",
        COALESCE(SUM(CASE WHEN v.metodo_pago = 'efectivo'      THEN v.total ELSE 0 END), 0)::float AS "totalEfectivo",
        COALESCE(SUM(CASE WHEN v.metodo_pago = 'tarjeta'       THEN v.total ELSE 0 END), 0)::float AS "totalTarjeta",
        COALESCE(SUM(CASE WHEN v.metodo_pago = 'transferencia' THEN v.total ELSE 0 END), 0)::float AS "totalTransferencia",
        COALESCE(SUM(v.total) - SUM(COALESCE((
          SELECT SUM(dv.cantidad * p.precio_compra)
          FROM detalle_venta dv
          JOIN productos p ON p.id = dv.producto_id
          WHERE dv.venta_id = v.id
        ), 0)), 0)::float AS "gananciaEstimada"
      FROM ventas v
      WHERE v.estado = 'completada'
        AND v.created_at BETWEEN $1 AND $2
        ${canalFilter}
    `, params);

    // Top productos
    const topProductsRes = await db.query(`
      SELECT
        dv.nombre_producto       AS name,
        SUM(dv.cantidad)::float  AS "unidadesVendidas",
        SUM(dv.subtotal)::float  AS ingresos
      FROM detalle_venta dv
      JOIN ventas v ON v.id = dv.venta_id
      WHERE v.estado = 'completada'
        AND v.created_at BETWEEN $1 AND $2
        ${canalFilter}
      GROUP BY dv.nombre_producto
      ORDER BY "unidadesVendidas" DESC
      LIMIT 10
    `, params);

    // Detalle de ventas
    const ventasRes = await db.query(`
      SELECT
        v.id,
        v.folio           AS "invoiceNumber",
        v.total::float,
        v.metodo_pago     AS "paymentMethod",
        v.canal,
        v.estado,
        v.created_at      AS "createdAt",
        u.nombre          AS cajero,
        (SELECT COUNT(*) FROM detalle_venta dv WHERE dv.venta_id = v.id)::int AS "numProductos"
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

// GET /api/sales/:id  — detalle de una venta
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

// PATCH /api/sales/:id/cancel  — cancelar venta
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