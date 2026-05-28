// PM2 — Configuración de procesos La Casita Deli
const path = require('path')

const ROOT    = __dirname
const API_DIR = path.join(ROOT, 'apps', 'api')
const WEB_DIR = path.join(ROOT, 'apps', 'web')

module.exports = {
  apps: [
    // ── API Express (puerto 3002) ─────────────────────────────────────────────
    {
      name: 'lacasita-api',
      script: path.join(API_DIR, 'src', 'index.js'),
      cwd: API_DIR,
      autorestart: true,
      watch: false,
      max_restarts: 20,
      min_uptime: '10s',
      out_file:   path.join(ROOT, 'logs', 'api.log'),
      error_file: path.join(ROOT, 'logs', 'api-error.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: { NODE_ENV: 'production' },
    },

    // ── Panel Web Next.js (puerto 3001) ───────────────────────────────────────
    {
      name: 'lacasita-web',
      script: path.join(WEB_DIR, 'node_modules', 'next', 'dist', 'bin', 'next'),
      args: 'start -p 3001',
      cwd: WEB_DIR,
      autorestart: true,
      watch: false,
      max_restarts: 20,
      min_uptime: '30s',
      out_file:   path.join(ROOT, 'logs', 'web.log'),
      error_file: path.join(ROOT, 'logs', 'web-error.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      env: { NODE_ENV: 'production', PORT: '3001' },
    },

    // ── PWA Zebra TC52 (puerto 3003) ──────────────────────────────────────────
    {
      name: 'lacasita-pwa',
      script: path.join(ROOT, 'apps', 'pwa-server.js'),
      autorestart: true,
      watch: false,
      max_restarts: 20,
      min_uptime: '5s',
      out_file:   path.join(ROOT, 'logs', 'pwa.log'),
      error_file: path.join(ROOT, 'logs', 'pwa-error.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
}
