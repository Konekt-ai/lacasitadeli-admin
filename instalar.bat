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
echo [1/6] Verificando Node.js...
node --version >nul 2>&1
if errorlevel 1 (
  color 0C
  echo.
  echo  ERROR: Node.js no esta instalado.
  echo  Descargalo de: https://nodejs.org  (version LTS)
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo  Node.js %%v - OK
echo.

:: ── 2. Verificar .env ────────────────────────────────────────────
echo [2/6] Verificando configuracion .env...
if not exist "apps\api\.env" (
  color 0C
  echo.
  echo  ERROR: No se encontro apps\api\.env
  echo  Crea el archivo con:
  echo    MSSQL_SERVER=192.168.1.68
  echo    MSSQL_DATABASE=novacaja22
  echo    MSSQL_USER=sa
  echo    MSSQL_PASSWORD=TU_PASSWORD_AQUI
  echo    ADMIN_EMAIL=admin@lacasita.com
  echo    ADMIN_PASSWORD=lacasita2025
  echo.
  pause
  exit /b 1
)
echo  .env encontrado - OK
echo.

:: ── 3. Instalar PM2 ──────────────────────────────────────────────
echo [3/6] Instalando PM2 (gestor de procesos)...
call npm install -g pm2 >nul 2>&1
call npm install -g pm2-windows-startup >nul 2>&1
pm2 --version >nul 2>&1
if errorlevel 1 (
  color 0C
  echo  ERROR: No se pudo instalar PM2. Ejecuta como Administrador.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('pm2 --version') do echo  PM2 v%%v - OK
echo.

:: ── 4. Instalar dependencias API ─────────────────────────────────
echo [4/6] Instalando dependencias de la API...
cd apps\api
call npm install --omit=dev >nul 2>&1
cd ..\..
echo  Dependencias API - OK
echo.

:: ── 5. Instalar y construir Web ───────────────────────────────────
echo [5/6] Construyendo interfaz (1-2 minutos)...
cd apps\web
call npm install >nul 2>&1
set API_URL=http://localhost:3002
call npm run build
if errorlevel 1 (
  color 0C
  echo  ERROR: Fallo el build.
  pause
  cd ..\..
  exit /b 1
)
cd ..\..
echo  Build completado - OK
echo.

:: ── 6. Registrar PM2 como servicio de Windows ────────────────────
echo [6/6] Registrando inicio automatico con Windows...
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
echo  API         : http://localhost:3002/api/health
echo.
echo  Login: usa el email y password del .env
echo.
echo  PASO SIGUIENTE - Verificar columnas de novacaja22:
echo    Abre el navegador y ve a:
echo    http://localhost:3002/api/novacaja/tables
echo.
echo  Para acceso externo: ejecuta tunel.bat
echo.
pause
