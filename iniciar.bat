@echo off
title La Casita Admin + Bodega TC52
color 0A
cd /d "%~dp0"

echo.
echo  ====================================================
echo    LA CASITA DELI  -  Panel Administrativo
echo  ====================================================
echo.

:: ── Verificar .env ───────────────────────────────────────────────────────────
if not exist "apps\api\.env" (
  color 0E
  echo  No existe configuracion de base de datos.
  echo  Abriendo configurar-env.bat...
  echo.
  call "%~dp0configurar-env.bat"
  if errorlevel 1 exit /b 1
  cls
  color 0A
  echo.
  echo  ====================================================
  echo    LA CASITA DELI  -  Panel Administrativo
  echo  ====================================================
  echo.
)

:: ── Crear carpeta de logs ────────────────────────────────────────────────────
if not exist "logs" mkdir logs

:: ── Detectar IPs (subroutine para evitar conflicto con ) en rutas) ─────────
set "LOCAL_IP=localhost"
set "TAILSCALE_IP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr "IPv4"') do call :check_ip "%%a"
goto :ips_done

:check_ip
  set "ip=%~1"
  set "ip=%ip: =%"
  if "%ip:~0,3%"=="127" goto :eof
  if "%ip:~0,3%"=="169" goto :eof
  if "%ip:~0,4%"=="100." set "TAILSCALE_IP=%ip%" & goto :eof
  if "%LOCAL_IP%"=="localhost" set "LOCAL_IP=%ip%"
goto :eof

:ips_done

:: ── Ruta al PWA ──────────────────────────────────────────────────────────────
set "PWA_DIR=%~dp0..\lacasitadeli-almacen\pwa-bodega"

:: ── Actualizar .env del PWA con la IP local ──────────────────────────────────
if not exist "%PWA_DIR%\package.json" goto :skip_env
echo VITE_API_URL=http://%LOCAL_IP%:3002> "%PWA_DIR%\.env"
:skip_env

:: ── Detener procesos previos en 3001, 3002 y 3003 ───────────────────────────
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3001 " ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3002 " ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3003 " ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1

:: ── [1/3] API ─────────────────────────────────────────────────────────────────
echo  [1/3] Iniciando API (puerto 3002)...
start /B cmd /c "cd /d "%~dp0apps\api" && node src\index.js >> "%~dp0logs\api.log" 2>&1"
timeout /t 2 /nobreak >nul
echo         OK   http://localhost:3002
echo         Log  logs\api.log
echo.

:: ── [2/3] PWA Zebra TC52 ─────────────────────────────────────────────────────
if not exist "%PWA_DIR%\package.json" goto :no_pwa

if exist "%PWA_DIR%\node_modules" goto :pwa_run
echo  Instalando dependencias del PWA por primera vez...
cd /d "%PWA_DIR%"
call npm install >nul 2>&1
cd /d "%~dp0"
echo         Listo.
echo.

:pwa_run
echo  [2/3] Iniciando PWA Zebra TC52 (puerto 3003)...
start /B cmd /c "cd /d "%PWA_DIR%" && npm run dev >> "%~dp0logs\pwa.log" 2>&1"
timeout /t 2 /nobreak >nul
echo         OK   http://%LOCAL_IP%:3003
echo         Log  logs\pwa.log
goto :pwa_done

:no_pwa
echo  [2/3] PWA no encontrado — omitiendo Zebra TC52

:pwa_done
echo.
echo  ============================================================
echo.
echo    ZEBRA TC52  —  Abrir Chrome en:
echo.
echo      WiFi  :  http://%LOCAL_IP%:3003
if not "%TAILSCALE_IP%"=="" echo      VPN   :  http://%TAILSCALE_IP%:3003
echo.
echo  ============================================================
echo.

:: ── Abrir navegador del panel admin ──────────────────────────────────────────
start /B cmd /c "timeout /t 18 /nobreak >nul && start http://localhost:3001"

:: ── [3/3] Next.js en esta ventana ────────────────────────────────────────────
echo  [3/3] Iniciando panel web — espera ~20 seg...
echo         Se abrira en  http://localhost:3001
echo.
echo  --------------------------------------------------------
echo   Deja esta ventana abierta mientras uses el panel.
echo   Cierra la ventana para detener todo.
echo  --------------------------------------------------------
echo.

cd /d "%~dp0apps\web"
call npm run dev
