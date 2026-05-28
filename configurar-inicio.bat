@echo off
title Configurar inicio automatico — La Casita Deli
color 0A
cd /d "%~dp0"

echo.
echo  ===========================================================
echo    LA CASITA DELI  —  Configurar inicio automatico
echo  ===========================================================
echo.
echo  Esto compilara el sistema y lo configurara para que
echo  inicie solo cada vez que enciendas la computadora.
echo.
echo  Duracion aprox.: 3-5 minutos. No cierres esta ventana.
echo.
pause

:: ── Crear carpeta de logs ─────────────────────────────────────────────────────
if not exist "logs" mkdir logs

:: ── Detectar IPs ──────────────────────────────────────────────────────────────
echo.
echo  Detectando IP de red...
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
echo  IP local: %LOCAL_IP%

:: ── Rutas ─────────────────────────────────────────────────────────────────────
set "PWA_DIR=%~dp0..\lacasitadeli-almacen\pwa-bodega"
set "WEB_DIR=%~dp0apps\web"

:: ── Escribir .env del PWA con la IP detectada ─────────────────────────────────
if not exist "%PWA_DIR%\package.json" goto :skip_pwa_env
echo VITE_API_URL=http://%LOCAL_IP%:3002> "%PWA_DIR%\.env"
echo  URL del TC52 configurada: http://%LOCAL_IP%:3002
:skip_pwa_env

echo.
echo  ─────────────────────────────────────────────────────────
echo  [1/5] Instalando PM2 (gestor de procesos en segundo plano)
echo  ─────────────────────────────────────────────────────────
call npm install -g pm2 >nul 2>&1
echo         OK

echo.
echo  ─────────────────────────────────────────────────────────
echo  [2/5] Compilando aplicacion del Zebra TC52...
echo  ─────────────────────────────────────────────────────────
if not exist "%PWA_DIR%\package.json" goto :skip_pwa_build
if exist "%PWA_DIR%\node_modules" goto :pwa_ready
cd /d "%PWA_DIR%"
call npm install >nul 2>&1
cd /d "%~dp0"
:pwa_ready
cd /d "%PWA_DIR%"
call npm run build
cd /d "%~dp0"
:skip_pwa_build
echo         OK

echo.
echo  ─────────────────────────────────────────────────────────
echo  [3/5] Compilando panel web (puede tardar 2-3 min)...
echo  ─────────────────────────────────────────────────────────
cd /d "%WEB_DIR%"
call npm run build
cd /d "%~dp0"
echo         OK

echo.
echo  ─────────────────────────────────────────────────────────
echo  [4/5] Iniciando servicios con PM2...
echo  ─────────────────────────────────────────────────────────
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3001 " ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3002 " ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3003 " ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1
pm2 stop all >nul 2>&1
pm2 delete all >nul 2>&1
pm2 start ecosystem.config.js
pm2 save
echo         OK

echo.
echo  ─────────────────────────────────────────────────────────
echo  [5/5] Registrando inicio automatico en Windows...
echo  ─────────────────────────────────────────────────────────
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
copy /Y "%~dp0arrancar.vbs" "%STARTUP%\LaCasitaDeli.vbs" >nul 2>&1
echo         OK  (se copio en carpeta Startup de Windows)

:: ── Resultado ─────────────────────────────────────────────────────────────────
echo.
color 0B
echo  ===========================================================
echo.
echo    SISTEMA CONFIGURADO CORRECTAMENTE
echo.
echo    Servicios corriendo ahora:
echo.
echo      Panel admin  ->  http://localhost:3001
echo      API          ->  http://localhost:3002
echo      Zebra TC52   ->  http://%LOCAL_IP%:3003
if not "%TAILSCALE_IP%"=="" echo      VPN (TC52)   ->  http://%TAILSCALE_IP%:3003
echo.
echo    La proxima vez que enciendas la PC, el sistema
echo    arrancara solo (aprox. 30 seg despues de login).
echo.
echo    Comandos utiles en terminal:
echo      pm2 status        ver si todo corre
echo      pm2 logs          ver registros en vivo
echo      pm2 restart all   reiniciar servicios
echo.
echo    Si cambias de IP de red, vuelve a ejecutar
echo    configurar-inicio.bat para recompilar la PWA.
echo.
echo  ===========================================================
echo.
pause
