@echo off
title La Casita Deli - Actualizar Sistema
color 0B
cd /d "%~dp0"

:: Lanzador VISIBLE: ejecuta la actualizacion mostrando el progreso en pantalla
:: y deja la ventana abierta al terminar para leer el resumen.
:: (El modo silencioso para el Programador de Tareas es actualizar-silencioso.vbs)

call "%~dp0actualizar-sistema.bat"

echo.
echo  Presiona una tecla para cerrar esta ventana...
pause >nul
