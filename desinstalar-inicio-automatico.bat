@echo off
title Desinstalar Inicio Automatico - La Casita Deli
color 0E

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

echo.
echo  Eliminando inicio automatico de La Casita Deli...
del /F /Q "%STARTUP%\lacasitadeli-inicio.vbs" >nul 2>&1

if %errorlevel% equ 0 (
    color 0A
    echo  [OK] Eliminado. Ya no iniciara automaticamente.
) else (
    color 07
    echo  [INFO] No se encontro el archivo, quizas ya fue eliminado.
)

echo.
pause
