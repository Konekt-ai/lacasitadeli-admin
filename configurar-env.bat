@echo off
setlocal EnableDelayedExpansion
title Configurar Conexion SQL Server
color 0B
cd /d "%~dp0"

echo.
echo  ====================================================
echo    CONFIGURAR CONEXION  -  SQL Server
echo  ====================================================
echo.

:: ── Mostrar configuracion existente ──────────────────────────────────────────
if exist "apps\api\.env" (
  echo  Configuracion actual:
  echo  --------------------------------------------------------
  for /f "tokens=1,* delims==" %%A in ('type "apps\api\.env"') do (
    if "%%A"=="MSSQL_PASSWORD" (
      echo    %%A = ********
    ) else (
      echo    %%A = %%B
    )
  )
  echo  --------------------------------------------------------
  echo.
  set /p "RESP=  Sobreescribir? (S para si, cualquier tecla para cancelar): "
  if /I "!RESP!" NEQ "S" (
    echo.
    echo  Sin cambios. Configuracion mantenida.
    echo.
    pause & exit /b 0
  )
  echo.
)

:: ── Pedir datos ───────────────────────────────────────────────────────────────
echo  Ingresa los datos de conexion al SQL Server:
echo  (Presiona Enter para usar el valor entre corchetes)
echo.

set /p "MSRV=  Servidor o IP  (ej: 192.168.1.68 o localhost): "
if "!MSRV!"=="" (
  echo  ERROR: El servidor es obligatorio.
  echo.
  pause & exit /b 1
)

set /p "MSDB=  Base de datos  [compucaja]: "
if "!MSDB!"=="" set "MSDB=compucaja"

set /p "MSUS=  Usuario        [sa]: "
if "!MSUS!"=="" set "MSUS=sa"

echo  Contrasena (se mostrara al escribir):
set /p "MSPW=  Contrasena: "

set /p "MSPT=  Puerto         [1433]: "
if "!MSPT!"=="" set "MSPT=1433"

:: ── Guardar .env ─────────────────────────────────────────────────────────────
echo.
echo  Guardando configuracion...

if not exist "apps\api" mkdir "apps\api"
(
  echo MSSQL_SERVER=!MSRV!
  echo MSSQL_DATABASE=!MSDB!
  echo MSSQL_USER=!MSUS!
  echo MSSQL_PASSWORD=!MSPW!
  echo MSSQL_PORT=!MSPT!
) > "apps\api\.env"

:: ── Confirmacion ─────────────────────────────────────────────────────────────
color 0A
echo.
echo  ====================================================
echo    CONFIGURACION GUARDADA
echo  ====================================================
echo.
echo    Servidor  : !MSRV!
echo    Base      : !MSDB!
echo    Usuario   : !MSUS!
echo    Contrasena: ********
echo    Puerto    : !MSPT!
echo.
echo  Archivo guardado en: apps\api\.env
echo.
echo  Ahora puedes ejecutar iniciar.bat
echo.
pause
exit /b 0
