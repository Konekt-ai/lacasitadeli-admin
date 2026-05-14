@echo off
title La Casita Admin - Instalador
color 0A
cd /d "%~dp0"

echo.
echo ================================================================
echo   LA CASITA ADMIN - INSTALACION EN SERVIDOR
echo ================================================================
echo.

:: ── 1. Verificar Node.js ─────────────────────────────────────────
echo [1/7] Verificando Node.js...
node --version >nul 2>&1
if errorlevel 1 (
  color 0C
  echo  ERROR: Node.js no esta instalado.
  echo  Descargalo de: https://nodejs.org  (version LTS)
  pause & exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo  Node.js %%v - OK
echo.

:: ── 2. Verificar .env ────────────────────────────────────────────
echo [2/7] Verificando configuracion .env...
if not exist "apps\api\.env" (
  color 0C
  echo  ERROR: No se encontro apps\api\.env
  echo  Debe contener: DATABASE_URL=postgresql://postgres:Casita2026@localhost:5432/lacasita_db
  pause & exit /b 1
)
echo  .env encontrado - OK
echo.

:: ── 3. Instalar PM2 ──────────────────────────────────────────────
echo [3/7] Instalando PM2...
call npm install -g pm2 >nul 2>&1
call npm install -g pm2-windows-startup >nul 2>&1
pm2 --version >nul 2>&1
if errorlevel 1 (
  color 0C
  echo  ERROR: No se pudo instalar PM2. Ejecuta como Administrador.
  pause & exit /b 1
)
for /f "tokens=*" %%v in ('pm2 --version') do echo  PM2 v%%v - OK
echo.

:: ── 4. Instalar dependencias API ─────────────────────────────────
echo [4/7] Instalando dependencias de la API...
cd apps\api
call npm install --omit=dev >nul 2>&1
cd ..\..
echo  Dependencias API - OK
echo.

:: ── 5. Inicializar base de datos PostgreSQL ───────────────────────
echo [5/7] Creando tablas en lacasita_db...
cd infra
call node init-local.js
if errorlevel 1 (
  color 0C
  echo.
  echo  ERROR: No se pudo inicializar la base de datos.
  echo  Verifica que PostgreSQL este corriendo y que la contrasena sea correcta.
  pause
  cd ..
  exit /b 1
)
cd ..
echo.

:: ── 6. Instalar y construir Web ───────────────────────────────────
echo [6/7] Construyendo interfaz (1-2 minutos)...
cd apps\web
call npm install >nul 2>&1
set API_URL=http://localhost:3002
call npm run build
if errorlevel 1 (
  color 0C & echo  ERROR en el build. & pause & cd ..\.. & exit /b 1
)
cd ..\..
echo  Build completado - OK
echo.

:: ── 7. Abrir puertos en Firewall de Windows ─────────────────────
echo [7/7] Configurando firewall (puerto 3000)...
netsh advfirewall firewall add rule name="LaCasita Admin Web" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
echo  Firewall configurado - OK
echo.

:: ── 8. Registrar PM2 como servicio de Windows ────────────────────
echo [8/7] Registrando inicio automatico con Windows...
call pm2-startup install >nul 2>&1
call pm2 start ecosystem.config.js
call pm2 save
echo  Inicio automatico registrado - OK
echo.

color 0A
echo.
echo ================================================================
echo   INSTALACION COMPLETADA
echo ================================================================
echo.
echo  Panel Admin : http://localhost:3000
echo  API Health  : http://localhost:3002/api/health
echo.
echo  Para acceso externo: ejecuta tunel.bat
echo.
pause
