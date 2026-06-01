@echo off
setlocal EnableDelayedExpansion
title La Casita Deli — Configuracion
color 0B
cd /d "%~dp0"

:MENU
cls
echo.
echo  ============================================================
echo    LA CASITA DELI — CONFIGURACION DEL SISTEMA
echo  ============================================================
echo.

:: ── Direcciones IP ────────────────────────────────────────────────────────────
echo  Direcciones IP de esta computadora:
echo  ─────────────────────────────────────────────
set "FOUND_IP=0"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr "IPv4"') do (
    set "ip=%%a"
    set "ip=!ip: =!"
    if not "!ip:~0,3!"=="127" if not "!ip:~0,3!"=="169" (
        set "FOUND_IP=1"
        if "!ip:~0,4!"=="100." (
            echo    !ip!   ^<-- Tailscale / VPN  (usa esta para el TC52 por VPN^)
        ) else (
            echo    !ip!   ^<-- Red Local WiFi/LAN  (usa esta para el TC52 en la misma red^)
        )
    )
)
if "!FOUND_IP!"=="0" echo    No se encontraron IPs. ^(Computadora sin red conectada^)
echo.

:: ── Configuracion actual ──────────────────────────────────────────────────────
echo  Configuracion actual  (apps\api\.env):
echo  ─────────────────────────────────────────────
if exist "apps\api\.env" (
    for /f "tokens=1,* delims==" %%A in ('type "apps\api\.env"') do (
        if "%%A"=="MSSQL_PASSWORD" (
            echo    %%A  =  ****
        ) else (
            echo    %%A  =  %%B
        )
    )
) else (
    color 0E
    echo    El archivo .env no existe todavia.
    echo    El sistema no podra conectarse a SQL Server hasta crearlo.
    color 0B
)
echo.

:: ── Puertos en uso ────────────────────────────────────────────────────────────
echo  Puertos del sistema:
echo  ─────────────────────────────────────────────
for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3001 " ^| findstr "LISTENING"') do (
    echo    Puerto 3001  [Panel Admin]   ACTIVO
    goto :p3001ok
)
echo    Puerto 3001  [Panel Admin]   detenido
:p3001ok

for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3002 " ^| findstr "LISTENING"') do (
    echo    Puerto 3002  [API]           ACTIVO
    goto :p3002ok
)
echo    Puerto 3002  [API]           detenido
:p3002ok

for /f "tokens=5" %%p in ('netstat -aon 2^>nul ^| findstr ":3003 " ^| findstr "LISTENING"') do (
    echo    Puerto 3003  [TC52 Bodega]  ACTIVO
    goto :p3003ok
)
echo    Puerto 3003  [TC52 Bodega]  detenido
:p3003ok

echo.
echo  ─────────────────────────────────────────────
echo   1.  Crear o editar conexion SQL  (.env)
echo   2.  Abrir .env en Notepad
echo   3.  Preparar acceso por red / Tailscale  (firewall + arranque automatico)
echo   4.  Salir
echo  ─────────────────────────────────────────────
echo.
set /p "op=  Opcion: "
if "!op!"=="1" goto :CREAR_ENV
if "!op!"=="2" goto :ABRIR_ENV
if "!op!"=="3" goto :PREPARAR_RED
if "!op!"=="4" exit /b 0
goto :MENU


:PREPARAR_RED
call "%~dp0preparar-red.bat"
goto :MENU


:CREAR_ENV
cls
echo.
echo  ============================================================
echo    CONFIGURAR CONEXION A SQL SERVER
echo  ============================================================
echo.
echo  Presiona Enter para mantener el valor actual.
echo.

:: Leer valores actuales del .env
set "MSRV=localhost"
set "MSDB=compucaja"
set "MSUS=sa"
set "MSPW="
set "MSPT=1433"
if exist "apps\api\.env" (
    for /f "tokens=1,* delims==" %%A in ('type "apps\api\.env"') do (
        if "%%A"=="MSSQL_SERVER"   set "MSRV=%%B"
        if "%%A"=="MSSQL_DATABASE" set "MSDB=%%B"
        if "%%A"=="MSSQL_USER"     set "MSUS=%%B"
        if "%%A"=="MSSQL_PORT"     set "MSPT=%%B"
    )
)

set /p "NUEVO_MSRV=  Servidor o IP SQL Server [!MSRV!]: "
if not "!NUEVO_MSRV!"=="" set "MSRV=!NUEVO_MSRV!"

set /p "NUEVO_MSDB=  Base de datos [!MSDB!]: "
if not "!NUEVO_MSDB!"=="" set "MSDB=!NUEVO_MSDB!"

set /p "NUEVO_MSUS=  Usuario SQL [!MSUS!]: "
if not "!NUEVO_MSUS!"=="" set "MSUS=!NUEVO_MSUS!"

set /p "MSPW=  Contrasena SQL Server (se escribe en texto): "

set /p "NUEVO_MSPT=  Puerto [!MSPT!]: "
if not "!NUEVO_MSPT!"=="" set "MSPT=!NUEVO_MSPT!"

if not exist "apps\api" mkdir "apps\api"
(
    echo MSSQL_SERVER=!MSRV!
    echo MSSQL_DATABASE=!MSDB!
    echo MSSQL_USER=!MSUS!
    echo MSSQL_PASSWORD=!MSPW!
    echo MSSQL_PORT=!MSPT!
) > "apps\api\.env"

color 0A
echo.
echo  ============================================================
echo    GUARDADO CORRECTAMENTE
echo  ============================================================
echo.
echo    Servidor  :  !MSRV!
echo    Base      :  !MSDB!
echo    Usuario   :  !MSUS!
echo    Contrasena:  ****
echo    Puerto    :  !MSPT!
echo.
echo    Archivo guardado en: apps\api\.env
echo.
color 0B
pause
goto :MENU


:ABRIR_ENV
if not exist "apps\api" mkdir "apps\api"
if not exist "apps\api\.env" (
    (
        echo MSSQL_SERVER=localhost
        echo MSSQL_DATABASE=compucaja
        echo MSSQL_USER=sa
        echo MSSQL_PASSWORD=
        echo MSSQL_PORT=1433
    ) > "apps\api\.env"
    echo  Archivo .env creado con valores de ejemplo. Editalo con tus datos.
)
start notepad.exe "apps\api\.env"
echo.
echo  Cuando termines de editar y guardar, vuelve aqui.
pause
goto :MENU
