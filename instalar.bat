@echo off
setlocal EnableDelayedExpansion
title La Casita Admin - Instalador
color 0A
cd /d "%~dp0"

echo.
echo  ================================================================
echo    LA CASITA ADMIN  -  INSTALADOR
echo    Panel de administracion para SQL Server (compucaja)
echo  ================================================================
echo.

:: ── Verificar permisos de administrador ──────────────────────────────────────
net session >nul 2>&1
if errorlevel 1 (
  color 0E
  echo  AVISO: Ejecuta este archivo como Administrador para configurar
  echo  el firewall y el inicio automatico con Windows (PM2).
  echo.
  echo  Puedes continuar sin admin pero esas funciones no se activaran.
  echo.
  set /p "CONT=  Continuar de todas formas? (S/N): "
  if /I "!CONT!" NEQ "S" (
    echo  Cancelado. Clic derecho en instalar.bat → Ejecutar como administrador.
    pause & exit /b 1
  )
  set "ES_ADMIN=0"
) else (
  set "ES_ADMIN=1"
)
echo.

:: ── 1. Verificar Node.js ──────────────────────────────────────────────────────
echo  [1/6] Verificando Node.js...
node --version >nul 2>&1
if errorlevel 1 (
  echo  Node.js no encontrado. Instalando via winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
  if errorlevel 1 (
    color 0E
    echo.
    echo  No se pudo instalar automaticamente.
    echo  Descarga Node.js LTS desde: https://nodejs.org
    echo  Instala y vuelve a ejecutar este archivo.
    pause & exit /b 1
  )
  echo  Node.js instalado. REINICIA el equipo y vuelve a ejecutar instalar.bat
  pause & exit /b 0
)
for /f "tokens=*" %%v in ('node --version') do echo         Node.js %%v  OK
echo.

:: ── 2. Configurar .env ────────────────────────────────────────────────────────
echo  [2/6] Configurando conexion a SQL Server...
if exist "apps\api\.env" (
  echo         .env ya existe — se mantiene sin cambios.
  echo         (Ejecuta configurar-env.bat para modificarlo)
) else (
  call "%~dp0configurar-env.bat"
  if errorlevel 1 (
    color 0C & echo  ERROR configurando .env. & pause & exit /b 1
  )
)
echo.

:: ── 3. Dependencias de la API ─────────────────────────────────────────────────
echo  [3/6] Instalando dependencias de la API...
cd "%~dp0apps\api"
call npm install --silent
if errorlevel 1 (
  color 0C & echo  ERROR instalando dependencias de la API. & pause & cd "%~dp0" & exit /b 1
)
cd "%~dp0"
echo         Dependencias API  OK
echo.

:: ── 4. Instalar y construir el panel web ─────────────────────────────────────
echo  [4/6] Instalando y construyendo el panel web (2-5 minutos)...
cd "%~dp0apps\web"
call npm install --silent
if errorlevel 1 (
  color 0C & echo  ERROR instalando dependencias Web. & pause & cd "%~dp0" & exit /b 1
)
set API_URL=http://localhost:3002
call npm run build
if errorlevel 1 (
  color 0C & echo  ERROR construyendo el panel. & pause & cd "%~dp0" & exit /b 1
)
cd "%~dp0"
echo         Panel construido  OK
echo.

:: ── 5. Configurar PM2 (inicio automatico con Windows) ────────────────────────
echo  [5/6] Configurando inicio automatico (PM2)...
call npm install -g pm2 --silent >nul 2>&1
call npm install -g pm2-windows-startup --silent >nul 2>&1
call pm2 delete all >nul 2>&1
call pm2 start "%~dp0ecosystem.config.js" --env production
call pm2 save
if "!ES_ADMIN!"=="1" (
  call pm2-startup install >nul 2>&1
  echo         PM2 autostart configurado  OK
) else (
  echo         PM2 iniciado (autostart requiere admin)
)
echo.

:: ── 6. Abrir puertos en el Firewall ──────────────────────────────────────────
echo  [6/6] Configurando firewall...
if "!ES_ADMIN!"=="1" (
  netsh advfirewall firewall delete rule name="LaCasita Web" >nul 2>&1
  netsh advfirewall firewall delete rule name="LaCasita API" >nul 2>&1
  netsh advfirewall firewall add rule name="LaCasita Web" dir=in action=allow protocol=TCP localport=3001 >nul 2>&1
  netsh advfirewall firewall add rule name="LaCasita API" dir=in action=allow protocol=TCP localport=3002 >nul 2>&1
  echo         Firewall  OK
) else (
  echo         Omitido (requiere admin)
)
echo.

:: ── Crear carpeta de logs ─────────────────────────────────────────────────────
if not exist "%~dp0logs" mkdir "%~dp0logs"

:: ── Listo ─────────────────────────────────────────────────────────────────────
color 0A
echo  ================================================================
echo    INSTALACION COMPLETADA
echo  ================================================================
echo.
echo    Panel Admin : http://localhost:3001
echo    API         : http://localhost:3002/api/health
echo.
echo    Doble clic en iniciar.bat para arrancar en modo desarrollo.
echo    El panel tambien inicia automaticamente con Windows via PM2.
echo.
echo    Para cambiar la conexion SQL: configurar-env.bat
echo.
timeout /t 5 /nobreak >nul
start http://localhost:3001
pause
