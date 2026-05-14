const express = require('express');
const db = require('../db');
const router = express.Router();

// POST /api/login
router.post('/login', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  try {
    const result = await db.query(
      `SELECT id, nombre AS name, email, rol AS role
       FROM usuarios
       WHERE email = $1 AND activo = TRUE`,
      [email]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });

    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('Error de autenticación:', err.message);
    res.status(500).json({ error: 'Error de autenticación' });
  }
});

// GET /api/users
router.get('/users', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, nombre AS name, email, rol AS role, activo AS active, created_at AS "createdAt"
       FROM usuarios ORDER BY nombre`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// POST /api/users
router.post('/users', async (req, res) => {
  const { name, email, role } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Nombre y email son requeridos' });

  try {
    const result = await db.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol)
       VALUES ($1, $2, $3, $4)
       RETURNING id, nombre AS name, email, rol AS role`,
      [name, email, `$2b$10$placeholder_${Date.now()}`, role || 'cajero']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un usuario con ese email' });
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

module.exports = router;
