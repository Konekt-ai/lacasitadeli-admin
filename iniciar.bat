@echo off
title La Casita Deli — Prueba (cierra para detener)
color 0A
cd /d "%~dp0"

echo.
echo  ============================================================
echo    LA CASITA DELI — MODO PRUEBA
echo    Para uso diario usa  iniciar-silencioso.vbs
echo  ============================================================
echo.

:: Verificar .env
if not exist "apps\api\.env" (
  color 0C
  echo  ERROR: No existe apps\api\.env
  echo  Ejecuta configurar.bat para crearlo.
  echo.
  pause & exit /b 1
)

:: Carpeta de logs
if not exist "logs" mkdir logs

:: Liberar puertos si ya estaban ocupados
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3001 " ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3002 " ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3003 " ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1

:: [1/3] API
echo  [1/3] API (puerto 3002)...
start "La Casita — API" cmd /k "cd /d "%~dp0apps\api" && node src\index.js"
timeout /t 3 /nobreak >nul
echo         OK — http://localhost:3002/api/health
echo.

:: [2/3] Bodega PWA para TC52
set "BODEGA=%~dp0..\lacasitadeli-almacen\pwa-bodega"
if exist "%BODEGA%\server.js" (
    echo  [2/3] TC52 Bodega (puerto 3003)...
    start "La Casita — TC52 Bodega" cmd /k "cd /d "%BODEGA%" && node server.js"
    timeout /t 2 /nobreak >nul
    echo         OK — usa la IP local de esta PC en el TC52
) else (
    echo  [2/3] TC52 Bodega — no encontrado, omitiendo
)
echo.

:: Abrir navegador cuando compile (~25 seg)
start /B cmd /c "timeout /t 25 /nobreak >nul && start http://localhost:3001"

:: [3/3] Next.js en ESTA ventana — cerrar aqui = detiene todo
echo  [3/3] Panel web (puerto 3001) — espera 20-30 seg hasta "Ready"...
echo.
echo  ─────────────────────────────────────────────────────────
echo   Panel admin :  http://localhost:3001
echo   API         :  http://localhost:3002/api/health
echo   TC52 Bodega :  http://[IP-de-esta-PC]:3003
echo.
echo   Cierra ESTA ventana para detener el sistema.
echo  ─────────────────────────────────────────────────────────
echo.

cd /d "%~dp0apps\web"
call npm run dev
