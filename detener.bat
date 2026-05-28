@echo off
title Detener La Casita Deli
color 04
echo.
echo  Deteniendo todos los servicios...
pm2 stop all >nul 2>&1
pm2 delete all >nul 2>&1
echo  OK — Sistema detenido.
echo.
echo  Para volver a iniciar, ejecuta:  iniciar.bat  o  pm2 resurrect
echo.
pause
