const express = require('express');
const router  = express.Router();

// POST /api/login — credenciales desde .env (sin tabla de usuarios)
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }

  const adminEmail = process.env.ADMIN_EMAIL    || 'admin@lacasita.com';
  const adminPass  = process.env.ADMIN_PASSWORD || 'lacasita2025';

  if (email.toLowerCase() === adminEmail.toLowerCase() && password === adminPass) {
    return res.json({
      user: { id: '1', name: 'Administrador', email: adminEmail, role: 'admin' }
    });
  }

  res.status(401).json({ error: 'Credenciales incorrectas' });
});

module.exports = router;
