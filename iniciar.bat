@echo off
title La Casita Admin
color 0A
cd /d "%~dp0"

echo.
echo  Iniciando La Casita Admin...
echo.

:: Verificar que el .env exista
if not exist "apps\api\.env" (
  color 0C
  echo  ERROR: No existe apps\api\.env
  echo  Ejecuta instalar.bat primero.
  pause & exit /b 1
)

:: Iniciar API en una ventana separada
start "La Casita - API" cmd /k "title La Casita API && cd /d "%~dp0apps\api" && npm run dev"

:: Esperar 2 segundos y luego iniciar el frontend
timeout /t 2 /nobreak >nul
start "La Casita - Web" cmd /k "title La Casita WEB && cd /d "%~dp0apps\web" && npm run dev"

:: Esperar que Next.js compile y abrir el navegador
timeout /t 6 /nobreak >nul
start http://localhost:3001

echo.
echo  Panel abierto en http://localhost:3001
echo  API corriendo en http://localhost:3002
echo.
echo  Cierra las ventanas de CMD para detener los servidores.
echo.
