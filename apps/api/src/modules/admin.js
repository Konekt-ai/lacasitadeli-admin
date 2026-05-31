const express   = require('express');
const { exec, execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const router = express.Router();
const ROOT   = path.resolve(__dirname, '..', '..', '..', '..');

function tryExec(cmd) {
  try { return execSync(cmd, { cwd: ROOT, timeout: 5000 }).toString().trim(); }
  catch { return ''; }
}

// ── GET /api/admin/sistema/info ───────────────────────────────────────────────
router.get('/sistema/info', (_req, res) => {
  const hash     = tryExec('git rev-parse --short HEAD');
  const branch   = tryExec('git branch --show-current');
  const lastMsg  = tryExec('git log -1 --format=%s');
  const lastDate = tryExec('git log -1 --format=%ci');
  const hasGit   = !!hash;
  res.json({ hasGit, hash, branch, lastMsg, lastDate });
});

// ── GET /api/admin/sistema/log ────────────────────────────────────────────────
router.get('/sistema/log', (_req, res) => {
  const logPath = path.join(ROOT, 'logs', 'actualizaciones.log');
  if (!fs.existsSync(logPath)) return res.json({ log: '' });
  const raw = fs.readFileSync(logPath, 'utf8');
  res.json({ log: raw.slice(-6000) });
});

// ── POST /api/admin/sistema/actualizar — solo git pull + npm install ───────────
router.post('/sistema/actualizar', (req, res) => {
  const batPath = path.join(ROOT, 'actualizar-sistema.bat');
  if (!fs.existsSync(batPath))
    return res.status(404).json({ ok: false, error: 'No se encontró actualizar-sistema.bat' });

  // Usamos un bat simplificado que NO reinicia (solo pull + install)
  const cmd = [
    `cd /d "${ROOT}"`,
    `git fetch origin main`,
    `git pull origin main`,
    `cd apps\\api && npm install --omit=dev && cd /d "${ROOT}"`,
    `cd apps\\web && npm install --omit=dev && cd /d "${ROOT}"`,
  ].join(' && ');

  exec(`cmd /c ${cmd}`, { cwd: ROOT, timeout: 180000 }, (err, stdout, stderr) => {
    const logPath = path.join(ROOT, 'logs', 'actualizaciones.log');
    const log     = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').slice(-5000) : '';
    const output  = [stdout, stderr].filter(Boolean).join('\n').slice(-2000);
    res.json({ ok: !err, output, log });
  });
});

// ── POST /api/admin/sistema/lanzar-actualizacion — lanza el VBS silencioso ─────
router.post('/sistema/lanzar-actualizacion', (_req, res) => {
  const vbsPath = path.join(ROOT, 'actualizar-silencioso.vbs');
  if (!fs.existsSync(vbsPath))
    return res.status(404).json({ ok: false, error: 'No se encontró actualizar-silencioso.vbs' });
  exec(`wscript.exe "${vbsPath}"`, { cwd: ROOT });
  res.json({ ok: true, mensaje: 'Script lanzado en segundo plano.' });
});

// ── POST /api/admin/sistema/reiniciar — responde rápido y se autokill ──────────
router.post('/sistema/reiniciar', (_req, res) => {
  const vbsPath = path.join(ROOT, 'iniciar-silencioso.vbs');
  res.json({ ok: true, mensaje: 'Reiniciando en 2 segundos...' });
  setTimeout(() => {
    exec(`wscript.exe "${vbsPath}"`, { cwd: ROOT });
    setTimeout(() => process.exit(0), 500);
  }, 1500);
});

// ── GET /api/admin/git ────────────────────────────────────────────────────────
router.get('/git', (_req, res) => {
  const name   = tryExec('git config user.name');
  const email  = tryExec('git config user.email');
  const remote = tryExec('git remote get-url origin');
  res.json({ name, email, remote });
});

// ── POST /api/admin/git ───────────────────────────────────────────────────────
router.post('/git', (req, res) => {
  const { name, email, remote } = req.body;
  const esc = s => String(s || '').replace(/"/g, '\\"');
  try {
    if (name)   execSync(`git config user.name "${esc(name)}"`,           { cwd: ROOT });
    if (email)  execSync(`git config user.email "${esc(email)}"`,          { cwd: ROOT });
    if (remote) execSync(`git remote set-url origin "${esc(remote)}"`,     { cwd: ROOT });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
