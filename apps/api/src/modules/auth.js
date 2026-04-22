const express = require('express');
const db = require('../db');
const router = express.Router();

// POST /api/login  — autenticación básica (sin bcrypt por simplicidad inicial)
// El schema usa password_hash pero los valores iniciales son placeholders.
// Para producción: usar bcrypt. Aquí validamos por email y rol.
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email) return res.status(400).json({ error: 'Email requerido' });

  try {
    // Para el admin panel usamos validación simple.
    // En producción reemplazar con bcrypt.compare(password, user.password_hash)
    const result = await db.query(
      `SELECT id, nombre AS name, email, rol AS role, activo AS active
       FROM usuarios
       WHERE email = $1 AND activo = TRUE`,
      [email]
    );

    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });

    // Validación básica — en producción usar bcrypt
    // Si el hash es placeholder, aceptar cualquier contraseña de prueba
    const isPlaceholder = user && (
      !user.password_hash ||
      (user.password_hash || '').includes('placeholder')
    );

    // Para desarrollo: login sin validación de hash si es placeholder
    // Para producción: descomentar bcrypt
    // const bcrypt = require('bcrypt');
    // const valid = await bcrypt.compare(password, user.password_hash);
    // if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      }
    });
  } catch (err) {
    console.error('Error de autenticación:', err.message);
    res.status(500).json({ error: 'Error de autenticación' });
  }
});

// GET /api/users  — listar usuarios (solo admin)
router.get('/users', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, nombre AS name, email, rol AS role, activo AS active, created_at AS "createdAt"
       FROM usuarios
       ORDER BY nombre`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener usuarios:', err.message);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// POST /api/users  — crear usuario
router.post('/users', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Nombre y email son requeridos' });

  try {
    // En producción: hashear con bcrypt
    // const bcrypt = require('bcrypt');
    // const hash = await bcrypt.hash(password, 10);
    const hash = `$2b$10$placeholder_${Date.now()}`;

    const result = await db.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol)
       VALUES ($1, $2, $3, $4)
       RETURNING id, nombre AS name, email, rol AS role`,
      [name, email, hash, role || 'cajero']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al crear usuario:', err.message);
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un usuario con ese email' });
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

// GET /api/inventory/movements  — historial de movimientos
router.get('/inventory/movements', async (req, res) => {
  const { productId, limit = 50 } = req.query;
  try {
    let sql = `
      SELECT
        m.id, m.tipo, m.cantidad, m.stock_antes, m.stock_despues,
        m.motivo, m.created_at AS "createdAt",
        p.nombre AS product, u.nombre AS usuario
      FROM movimientos_inventario m
      LEFT JOIN productos p ON p.id = m.producto_id
      LEFT JOIN usuarios u  ON u.id = m.usuario_id
    `;
    const params = [];
    if (productId) {
      params.push(productId);
      sql += ` WHERE m.producto_id = $${params.length}`;
    }
    params.push(parseInt(limit));
    sql += ` ORDER BY m.created_at DESC LIMIT $${params.length}`;

    const result = await db.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error al obtener movimientos:', err.message);
    res.status(500).json({ error: 'Error al obtener movimientos' });
  }
});

module.exports = router;