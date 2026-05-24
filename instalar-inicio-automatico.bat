@echo off
title Instalar Inicio Automatico - La Casita Deli
color 0A
cd /d "%~dp0"

set "VBS_ORIGEN=%~dp0iniciar-silencioso.vbs"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

echo.
echo  ====================================================
echo    LA CASITA DELI  -  Instalador de Inicio Automatico
echo  ====================================================
echo.

if not exist "%VBS_ORIGEN%" (
    color 0C
    echo  [ERROR] No se encontro iniciar-silencioso.vbs
    echo          Corre este bat desde la carpeta del proyecto.
    echo.
    pause
    exit /b 1
)

echo  Instalando en la carpeta Inicio de Windows...
copy /Y "%VBS_ORIGEN%" "%STARTUP%\lacasitadeli-inicio.vbs" >nul

if %errorlevel% equ 0 (
    color 0A
    echo.
    echo  [OK] Instalado correctamente!
    echo.
    echo  La proxima vez que abras sesion en este equipo, se iniciara:
    echo    - SQL Server 2014
    echo    - Tailscale (VPN)
    echo    - API        ^(http://localhost:3002^)
    echo    - Panel web  ^(http://localhost:3001^)
    echo.
    echo  Los logs quedan en:  %~dp0logs\
    echo.
    echo  Para desinstalar corre:  desinstalar-inicio-automatico.bat
) else (
    color 0C
    echo.
    echo  [ERROR] No se pudo instalar.
    echo          Intenta correr este archivo como Administrador.
)

echo.
pause
