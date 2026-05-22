const express = require('express');
const { getDb } = require('../db');
const router = express.Router();

// POST /api/sales
router.post('/', (req, res) => {
  const { items, paymentMethod, notes, cajero, canal } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'La venta debe tener al menos un producto' });

  const db    = getDb();
  const canal_ = canal || 'caja';

  const last  = db.prepare(`SELECT folio FROM ventas WHERE canal = ? ORDER BY id DESC LIMIT 1`).get(canal_);
  let folio;
  if (last) {
    const num = parseInt((last.folio.match(/\d+$/) || ['0'])[0]) + 1;
    folio = `${canal_.toUpperCase()}-${String(num).padStart(6, '0')}`;
  } else {
    folio = `${canal_.toUpperCase()}-000001`;
  }

  const procesarVenta = db.transaction((items) => {
    const ventaId = db.prepare(
      `INSERT INTO ventas (folio, canal, cajero, metodo_pago, total)
       VALUES (?, ?, ?, ?, 0)`
    ).run(folio, canal_, cajero || 'Sistema', paymentMethod || 'efectivo').lastInsertRowid;

    let total = 0;
    for (const item of items) {
      const cantidad = parseFloat(item.quantity);
      const precio   = parseFloat(item.unitPrice);
      const subtotal = cantidad * precio;
      total += subtotal;
      db.prepare(
        `INSERT INTO detalle_venta (venta_id, novacaja_id, nombre_producto, cantidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(ventaId, String(item.productId), item.name || '', cantidad, precio, subtotal);
    }

    db.prepare(`UPDATE ventas SET total = ?, notas = ? WHERE id = ?`)
      .run(total, notes || null, ventaId);

    return { folio, total };
  });

  try {
    const result = procesarVenta(items);
    res.json({ success: true, folio: result.folio, total: result.total });
  } catch (err) {
    console.error('Error al procesar venta:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// GET /api/sales/report
router.get('/report', (req, res) => {
  const { date, canal } = req.query;
  const db    = getDb();
  const today = date || new Date().toISOString().split('T')[0];
  const start = `${today} 00:00:00`;
  const end   = `${today} 23:59:59`;

  const canalWhere = canal ? `AND v.canal = '${canal.replace(/'/g, "''")}'` : '';

  try {
    const summary = db.prepare(`
      SELECT
        COUNT(*)                                                                       AS totalVentas,
        COALESCE(SUM(total), 0)                                                       AS totalIngresos,
        COALESCE(AVG(total), 0)                                                       AS ticketPromedio,
        COALESCE(SUM(CASE WHEN metodo_pago='efectivo'      THEN total ELSE 0 END), 0) AS totalEfectivo,
        COALESCE(SUM(CASE WHEN metodo_pago='tarjeta'       THEN total ELSE 0 END), 0) AS totalTarjeta,
        COALESCE(SUM(CASE WHEN metodo_pago='transferencia' THEN total ELSE 0 END), 0) AS totalTransferencia,
        0 AS gananciaEstimada
      FROM ventas v
      WHERE estado = 'completada' AND created_at BETWEEN ? AND ? ${canalWhere}
    `).get(start, end);

    const topProducts = db.prepare(`
      SELECT dv.nombre_producto AS name,
             SUM(dv.cantidad)   AS unidadesVendidas,
             SUM(dv.subtotal)   AS ingresos
      FROM detalle_venta dv
      JOIN ventas v ON v.id = dv.venta_id
      WHERE v.estado = 'completada' AND v.created_at BETWEEN ? AND ? ${canalWhere}
      GROUP BY dv.nombre_producto
      ORDER BY SUM(dv.cantidad) DESC
      LIMIT 10
    `).all(start, end);

    const ventas = db.prepare(`
      SELECT v.id,
             v.folio       AS invoiceNumber,
             v.total,
             v.metodo_pago AS paymentMethod,
             v.canal,
             v.estado,
             v.created_at  AS createdAt,
             v.cajero,
             COUNT(dv.id)  AS numProductos
      FROM ventas v
      LEFT JOIN detalle_venta dv ON dv.venta_id = v.id
      WHERE v.estado = 'completada' AND v.created_at BETWEEN ? AND ? ${canalWhere}
      GROUP BY v.id
      ORDER BY v.created_at DESC
    `).all(start, end);

    res.json({ summary, topProducts, ventas });
  } catch (err) {
    console.error('Error reporte:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
