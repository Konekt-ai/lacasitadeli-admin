@echo off
title La Casita Admin - Control del Sistema
color 0A
cd /d "%~dp0"

echo.
echo ================================================================
echo   LA CASITA ADMIN - CONTROL DEL SISTEMA
echo ================================================================
echo.
echo   [1] Iniciar servicios
echo   [2] Detener servicios
echo   [3] Reiniciar servicios
echo   [4] Ver estado
echo   [5] Ver logs en tiempo real
echo   [6] Abrir panel en navegador
echo   [0] Salir
echo.
set /p opcion="  Elige una opcion: "

if "%opcion%"=="1" goto iniciar
if "%opcion%"=="2" goto detener
if "%opcion%"=="3" goto reiniciar
if "%opcion%"=="4" goto estado
if "%opcion%"=="5" goto logs
if "%opcion%"=="6" goto navegador
if "%opcion%"=="0" exit /b 0
goto menu

:iniciar
echo.
echo  Iniciando servicios...
pm2 start ecosystem.config.js
pm2 save
echo.
echo  Panel disponible en: http://localhost:3000
echo.
timeout /t 3 >nul
start http://localhost:3000
goto fin

:detener
echo.
echo  Deteniendo servicios...
pm2 stop all
echo  Servicios detenidos.
echo.
goto fin

:reiniciar
echo.
echo  Reiniciando servicios...
pm2 restart all
echo.
echo  Panel disponible en: http://localhost:3000
echo.
goto fin

:estado
echo.
pm2 status
echo.
goto fin

:logs
echo.
echo  Mostrando logs (Ctrl+C para salir)...
echo.
pm2 logs
goto fin

:navegador
start http://localhost:3000
goto fin

:fin
echo.
pause
