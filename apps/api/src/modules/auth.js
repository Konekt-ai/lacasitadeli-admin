const express = require('express');
const router  = express.Router();

// Stub simple — la app no tiene pantalla de login todavía
router.post('/login', (req, res) => {
  res.json({ user: { id: 1, name: 'Administrador', role: 'admin' } });
});

module.exports = router;
