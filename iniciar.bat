@echo off
title La Casita Deli - Prueba
color 0A
cd /d "%~dp0"

echo.
echo  ============================================================
echo    LA CASITA DELI - MODO PRUEBA
echo    Para uso diario usa  iniciar-silencioso.vbs
echo  ============================================================
echo.

:: Verificar .env
if not exist "apps\api\.env" goto :NoEnv
goto :EnvOk
:NoEnv
color 0C
echo  ERROR: No existe apps\api\.env
echo  Ejecuta configurar.bat para crearlo.
echo.
pause
exit /b 1
:EnvOk

:: Carpeta de logs
if not exist "logs" mkdir logs

:: Liberar puertos si ya estaban ocupados
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3001 " ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3002 " ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3003 " ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1

:: [1/3] API
echo  [1/3] API (puerto 3002)...
start /D "%~dp0apps\api" "La Casita - API" cmd /k "node src\index.js"
timeout /t 3 /nobreak >nul
echo         OK - http://localhost:3002/api/health
echo.

:: [2/3] Bodega PWA para TC52
set "BODEGA=%~dp0..\lacasitadeli-almacen\pwa-bodega"
if not exist "%BODEGA%\server.js" goto :NoBodega
echo  [2/3] TC52 Bodega (puerto 3003)...
start /D "%BODEGA%" "La Casita - TC52 Bodega" cmd /k "node server.js"
timeout /t 2 /nobreak >nul
echo         OK - usa la IP local de esta PC en el TC52
goto :FinBodega
:NoBodega
echo  [2/3] TC52 Bodega - no encontrado, omitiendo
:FinBodega
echo.

:: NO se abre el navegador automaticamente (evita llenar el navegador de pestanas
:: y sobrecargar la PC). Abre el panel desde el icono de la bandeja del sistema
:: (iconos ocultos -> doble clic) o entra a la direccion de abajo.

:: [3/3] Next.js en ESTA ventana - cerrar aqui detiene todo
echo  [3/3] Panel web (puerto 3001) - espera 20-30 seg hasta "Ready"...
echo.
echo  Panel admin :  http://localhost:3001  (abrelo desde el icono de la bandeja)
echo  API         :  http://localhost:3002/api/health
echo  TC52 Bodega :  http://[IP-de-esta-PC]:3003
echo.
echo  Cierra ESTA ventana para detener el sistema.
echo.

cd /d "%~dp0apps\web"
call npm run dev
