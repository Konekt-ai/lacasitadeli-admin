// Servidor estático para la PWA del Zebra TC52 (puerto 3003)
// Sin dependencias externas — usa sólo Node.js built-in
const http = require('http')
const fs   = require('fs')
const path = require('path')

const DIST = path.join(__dirname, '..', '..', 'lacasitadeli-almacen', 'pwa-bodega', 'dist')
const PORT = 3003

const MIME = {
  '.html':        'text/html; charset=utf-8',
  '.js':          'application/javascript; charset=utf-8',
  '.css':         'text/css; charset=utf-8',
  '.json':        'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png':         'image/png',
  '.jpg':         'image/jpeg',
  '.webp':        'image/webp',
  '.svg':         'image/svg+xml',
  '.ico':         'image/x-icon',
  '.woff2':       'font/woff2',
  '.woff':        'font/woff',
  '.gz':          'application/gzip',
}

if (!fs.existsSync(DIST)) {
  console.error('[pwa-server] ERROR: no existe la carpeta dist en:', DIST)
  console.error('[pwa-server] Ejecuta configurar-inicio.bat para compilar la PWA.')
  process.exit(1)
}

http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0]
  let filePath = path.normalize(path.join(DIST, urlPath === '/' ? 'index.html' : urlPath))

  // Seguridad: bloquear rutas fuera de DIST
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403); res.end(); return
  }

  // Fallback SPA: si el archivo no existe sirve index.html
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html')
  }

  const ext  = path.extname(filePath).toLowerCase()
  const mime = MIME[ext] || 'application/octet-stream'

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return }
    res.writeHead(200, { 'Content-Type': mime })
    res.end(data)
  })
}).listen(PORT, '0.0.0.0', () => {
  console.log(`[lacasita-pwa] Bodega TC52 en http://0.0.0.0:${PORT}`)
})
