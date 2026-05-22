@echo off
setlocal EnableDelayedExpansion
title La Casita Admin - Instalador
color 0A
cd /d "%~dp0"

echo.
echo ================================================================
echo   LA CASITA ADMIN — INSTALADOR
echo   Panel de administracion para novacaja22 (SQL Server)
echo ================================================================
echo.

:: ── 1. Verificar/instalar Node.js ─────────────────────────────
echo [1/6] Verificando Node.js...
node --version >nul 2>&1
if errorlevel 1 (
  echo  Node.js no encontrado. Instalando via winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
  if errorlevel 1 (
    color 0E
    echo.
    echo  No se pudo instalar automaticamente.
    echo  Descarga Node.js LTS de: https://nodejs.org
    echo  Instala y vuelve a ejecutar este archivo.
    pause & exit /b 1
  )
  :: Refrescar PATH sin reiniciar
  for /f "tokens=*" %%i in ('where node 2^>nul') do set "NODE_PATH=%%i"
  if "!NODE_PATH!"=="" (
    echo  Node.js instalado. REINICIA el equipo y vuelve a ejecutar instalar.bat
    pause & exit /b 0
  )
)
for /f "tokens=*" %%v in ('node --version') do echo  Node.js %%v - OK
echo.

:: ── 2. Configurar .env ────────────────────────────────────────
echo [2/6] Configurando conexion a SQL Server...
if exist "apps\api\.env" (
  echo  .env ya existe — se mantiene sin cambios.
) else (
  echo.
  echo  Se necesitan los datos del SQL Server del cliente:
  echo.
  set /p "MSRV=  Servidor o IP (ej: 192.168.1.68 o localhost): "
  set /p "MSDB=  Base de datos [novacaja22]: "
  if "!MSDB!"=="" set "MSDB=novacaja22"
  set /p "MSUS=  Usuario      [sa]: "
  if "!MSUS!"=="" set "MSUS=sa"
  set /p "MSPW=  Contrasena sa: "
  set /p "MSPT=  Puerto       [1433]: "
  if "!MSPT!"=="" set "MSPT=1433"
  (
    echo MSSQL_SERVER=!MSRV!
    echo MSSQL_DATABASE=!MSDB!
    echo MSSQL_USER=!MSUS!
    echo MSSQL_PASSWORD=!MSPW!
    echo MSSQL_PORT=!MSPT!
  ) > "apps\api\.env"
  echo.
  echo  .env creado - OK
)
echo.

:: ── 3. Instalar dependencias API ──────────────────────────────
echo [3/6] Instalando dependencias de la API...
cd apps\api
call npm install --omit=dev --silent
if errorlevel 1 (
  color 0C & echo  ERROR instalando dependencias API. & pause & cd ..\.. & exit /b 1
)
cd ..\..
echo  Dependencias API - OK
echo.

:: ── 4. Construir frontend ──────────────────────────────────────
echo [4/6] Instalando y construyendo el panel (2-3 minutos)...
cd apps\web
call npm install --silent
if errorlevel 1 (
  color 0C & echo  ERROR instalando dependencias Web. & pause & cd ..\.. & exit /b 1
)
set API_URL=http://localhost:3002
call npm run build
if errorlevel 1 (
  color 0C & echo  ERROR en el build del panel. & pause & cd ..\.. & exit /b 1
)
cd ..\..
echo  Panel construido - OK
echo.

:: ── 5. Instalar PM2 y registrar servicio ──────────────────────
echo [5/6] Configurando inicio automatico (PM2)...
call npm install -g pm2 --silent
call npm install -g pm2-windows-startup --silent
call pm2 start ecosystem.config.js --env production
call pm2 save
call pm2-startup install >nul 2>&1
echo  Autostart configurado - OK
echo.

:: ── 6. Abrir puertos en Firewall ──────────────────────────────
echo [6/6] Configurando firewall...
netsh advfirewall firewall delete rule name="LaCasita Web" >nul 2>&1
netsh advfirewall firewall delete rule name="LaCasita API" >nul 2>&1
netsh advfirewall firewall add rule name="LaCasita Web" dir=in action=allow protocol=TCP localport=3001 >nul 2>&1
netsh advfirewall firewall add rule name="LaCasita API" dir=in action=allow protocol=TCP localport=3002 >nul 2>&1
echo  Firewall - OK
echo.

color 0A
echo ================================================================
echo   INSTALACION COMPLETADA
echo ================================================================
echo.
echo  Panel Admin : http://localhost:3001
echo  API Health  : http://localhost:3002/api/health
echo.
echo  El panel inicia automaticamente con Windows.
echo  Para acceso externo desde otra maquina: ejecuta tunel.bat
echo.
echo  Para iniciar manualmente en modo desarrollo: iniciar.bat
echo.
pause
