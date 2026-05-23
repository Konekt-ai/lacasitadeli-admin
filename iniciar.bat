@echo off
title La Casita Admin
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

:: ── Detener proceso previo en el puerto 3002 (API) ───────────────────────────
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3002 " ^| findstr "LISTENING"') do (
  taskkill /F /PID %%p >nul 2>&1
)

:: ── Iniciar API en fondo (sin ventana extra) ─────────────────────────────────
echo  [1/2] Iniciando API...
start /B cmd /c "cd /d "%~dp0apps\api" && node src\index.js >> "%~dp0logs\api.log" 2>&1"
timeout /t 2 /nobreak >nul
echo         API lista en  http://localhost:3002
echo         Log en        logs\api.log
echo.

:: ── Abrir navegador automaticamente despues de que Next.js este listo ────────
start /B cmd /c "timeout /t 18 /nobreak >nul && start http://localhost:3001"

:: ── Iniciar Next.js en esta misma ventana ───────────────────────────────────
echo  [2/2] Iniciando panel web — espera ~20 seg...
echo         Se abrira en   http://localhost:3001
echo.
echo  --------------------------------------------------------
echo   Deja esta ventana abierta mientras uses el panel.
echo   Cierra la ventana para detener todo.
echo  --------------------------------------------------------
echo.

cd /d "%~dp0apps\web"
call npm run dev
