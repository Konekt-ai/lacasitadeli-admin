#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  La Casita POS — Script de inicio rápido (con Neon PostgreSQL)
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo "  🏪  La Casita — Sistema de Punto de Venta"
echo "  ──────────────────────────────────────────"
echo ""

# Verificar Node.js
if ! command -v node &> /dev/null; then
  echo "  ❌ Node.js no encontrado. Instálalo desde https://nodejs.org"
  exit 1
fi

# Verificar .env
if [ ! -f "apps/api/.env" ]; then
  echo "  ❌ No se encontró apps/api/.env"
  echo "     Crea el archivo con tu DATABASE_URL de Neon."
  exit 1
fi

# Inicializar schema en Neon (solo si se pasa --init)
if [ "$1" == "--init" ]; then
  echo "  🗄️  Inicializando schema en Neon PostgreSQL..."
  cd infra && node init-neon.js && cd ..
  echo ""
fi

# Matar procesos previos
echo "  🛑 Deteniendo procesos anteriores en puertos 3001 y 3002..."
kill $(lsof -t -i :3001) $(lsof -t -i :3002) 2>/dev/null || true
sleep 1

echo "  🚀 Iniciando API Backend (puerto 3002)..."
cd apps/api
npm install -s
PORT=3002 node src/index.js > api.log 2>&1 &
API_PID=$!
cd ../..

echo "  🚀 Iniciando Frontend Next.js (puerto 3001)..."
cd apps/web
npm install -s
npm run dev -- -p 3001 > web.log 2>&1 &
WEB_PID=$!
cd ../..

echo ""
echo "  ✅ Sistema listo."
echo "  👉 Panel admin: http://localhost:3001"
echo "  👉 API health:  http://localhost:3002/api/health"
echo ""
echo "  Tip: usa './iniciar.sh --init' para crear las tablas en Neon la primera vez."
echo ""

# Esperar y mostrar logs
trap "kill $API_PID $WEB_PID 2>/dev/null; exit" SIGINT SIGTERM
tail -f apps/api/api.log apps/web/web.log