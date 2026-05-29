const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

function esc(s) { return String(s || '').replace(/'/g, "''"); }

function nextFolio(db) {
  const date = new Date();
  const ymd  = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const like = `FAC-${ymd}-%`;
  const last = db.prepare(`SELECT folio FROM facturas_compra WHERE folio LIKE ? ORDER BY folio DESC LIMIT 1`).get(like);
  let seq = 1;
  if (last) {
    const parts = last.folio.split('-');
    seq = parseInt(parts[parts.length - 1], 10) + 1;
  }
  return `FAC-${ymd}-${String(seq).padStart(4, '0')}`;
}

// ── GET /api/facturas ─────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { estado, q, limit = 100 } = req.query;
  const db = getDb();
  try {
    let sql    = `SELECT * FROM facturas_compra WHERE 1=1`;
    const params = [];
    if (estado && estado !== 'todos') { sql += ` AND estado = ?`; params.push(estado); }
    if (q) {
      sql += ` AND (proveedor LIKE ? OR numero_factura LIKE ? OR folio LIKE ?)`;
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(parseInt(limit));
    res.json(db.prepare(sql).all(...params));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/facturas/stats ───────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const db = getDb();
  try {
    const porEstado = db.prepare(`
      SELECT estado, COUNT(*) AS num, SUM(total_calculado) AS total
      FROM facturas_compra GROUP BY estado
    `).all();
    const topProveedores = db.prepare(`
      SELECT proveedor, COUNT(*) AS num_facturas, SUM(total_calculado) AS total
      FROM facturas_compra WHERE estado != 'cancelada'
      GROUP BY proveedor ORDER BY total DESC LIMIT 5
    `).all();
    const recientes = db.prepare(`
      SELECT * FROM facturas_compra ORDER BY created_at DESC LIMIT 5
    `).all();
    res.json({ porEstado, topProveedores, recientes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/facturas/:id ─────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const db = getDb();
  try {
    const factura = db.prepare(`SELECT * FROM facturas_compra WHERE id = ?`).get(req.params.id);
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });

    const detalle = db.prepare(`SELECT * FROM facturas_compra_detalle WHERE factura_id = ? ORDER BY id`).all(factura.id);

    // Adjunta info del pedido vinculado si existe
    let pedido = null;
    if (factura.pedido_id) {
      const p = db.prepare(`SELECT id, folio, estado, total_esperado, total_recibido, num_items FROM pedidos_recepcion WHERE id = ?`).get(factura.pedido_id);
      if (p) pedido = p;

      // Si el pedido está cerrado y la factura no, actualiza automáticamente
      if (p?.estado === 'cerrado' && factura.estado === 'en_camino') {
        db.prepare(`UPDATE facturas_compra SET estado = 'en_almacen', entregado_at = datetime('now') WHERE id = ?`).run(factura.id);
        factura.estado      = 'en_almacen';
        factura.entregado_at = new Date().toISOString();
      }
    }

    res.json({ ...factura, detalle, pedido });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/facturas ────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { proveedor, numero_factura, fecha_emision, fecha_esperada, notas, items = [] } = req.body;
  if (!proveedor) return res.status(400).json({ error: 'Proveedor es requerido' });
  if (!items.length) return res.status(400).json({ error: 'Agrega al menos un artículo' });

  const db    = getDb();
  const folio = nextFolio(db);
  const total = items.reduce((s, i) => s + (parseFloat(i.cantidad) * parseFloat(i.precio_unitario)), 0);

  try {
    const facturaId = db.prepare(`
      INSERT INTO facturas_compra (folio, proveedor, numero_factura, fecha_emision, fecha_esperada, total_calculado, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(folio, proveedor, numero_factura || null, fecha_emision || null, fecha_esperada || null, total, notas || null).lastInsertRowid;

    const insDetalle = db.prepare(`
      INSERT INTO facturas_compra_detalle (factura_id, art_codigo, nombre, cantidad, precio_unitario, subtotal)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      const qty  = parseFloat(item.cantidad);
      const pxu  = parseFloat(item.precio_unitario);
      insDetalle.run(facturaId, item.art_codigo, item.nombre || null, qty, pxu, qty * pxu);
    }

    // Auto-crear pedido de recepción vinculado
    const pedidoFolio = folio.replace('FAC-', 'REC-');
    const pedidoId = db.prepare(`
      INSERT INTO pedidos_recepcion (folio, proveedor, fecha_esperada, notas)
      VALUES (?, ?, ?, ?)
    `).run(pedidoFolio, proveedor, fecha_esperada || null, `Generado automáticamente desde factura ${folio}`).lastInsertRowid;

    const insDetallePedido = db.prepare(`
      INSERT INTO pedidos_recepcion_detalle (pedido_id, art_codigo, nombre, cantidad_esperada)
      VALUES (?, ?, ?, ?)
    `);
    for (const item of items) {
      insDetallePedido.run(pedidoId, item.art_codigo, item.nombre || null, parseFloat(item.cantidad));
    }

    // Vincula el pedido a la factura
    db.prepare(`UPDATE facturas_compra SET pedido_id = ? WHERE id = ?`).run(pedidoId, facturaId);

    res.status(201).json({ id: facturaId, folio, pedido_folio: pedidoFolio, total, message: 'Factura registrada' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/facturas/:id/estado ──────────────────────────────────────────────
router.put('/:id/estado', (req, res) => {
  const { estado } = req.body;
  const VALID = ['en_camino', 'en_almacen', 'cancelada'];
  if (!VALID.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });

  const db = getDb();
  try {
    const factura = db.prepare(`SELECT * FROM facturas_compra WHERE id = ?`).get(req.params.id);
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });

    const extra = estado === 'en_almacen' ? `, entregado_at = datetime('now')` : '';
    db.prepare(`UPDATE facturas_compra SET estado = ?${extra} WHERE id = ?`).run(estado, factura.id);

    // Si se cancela, también cancela el pedido vinculado si sigue pendiente
    if (estado === 'cancelada' && factura.pedido_id) {
      db.prepare(`UPDATE pedidos_recepcion SET estado = 'cancelado' WHERE id = ? AND estado IN ('pendiente','en_recepcion')`).run(factura.pedido_id);
    }

    res.json({ ok: true, message: `Factura actualizada a "${estado}"` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/facturas/:id ──────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const db = getDb();
  try {
    const factura = db.prepare(`SELECT * FROM facturas_compra WHERE id = ?`).get(req.params.id);
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });
    db.prepare(`UPDATE facturas_compra SET estado = 'cancelada' WHERE id = ?`).run(factura.id);
    if (factura.pedido_id) {
      db.prepare(`UPDATE pedidos_recepcion SET estado = 'cancelado' WHERE id = ? AND estado IN ('pendiente','en_recepcion')`).run(factura.pedido_id);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
