@echo off
setlocal enabledelayedexpansion

:: Configuración
title La Casita - Instalador y Reparador
color 0D
cd /d "%~dp0"

echo.
echo ============================================================
echo     LA CASITA - INSTALACION Y REPARACION INTEGRAL
echo ============================================================
echo.
echo Este script realizara una limpieza profunda y reinstalara
echo todo el sistema desde cero.
echo.

:: ---------------------------------------------------------
:: PASO 1: VERIFICAR NODE.JS
:: ---------------------------------------------------------
echo [1/5] Verificando entorno (Node.js)...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERROR CRITICO: No se detecto Node.js.
    echo.
    echo Por favor:
    echo   1. Ve a https://nodejs.org/
    echo   2. Descarga la version "LTS".
    echo   3. Instalalo marcando "Add to PATH".
    echo.
    pause
    exit /b
)
for /f "tokens=*" %%i in ('node -v') do echo  Version de Node: %%i
echo.

:: ---------------------------------------------------------
:: PASO 2: DETENER PROCESOS (Limpieza)
:: ---------------------------------------------------------
echo [2/5] Deteniendo procesos residuales de Node...
taskkill /F /IM node.exe >nul 2>&1
echo  Procesos detenidos.
echo.

:: ---------------------------------------------------------
:: PASO 3: BORRAR CARPETAS VIEJAS (Reparacion)
:: ---------------------------------------------------------
echo [3/5] Borrando instalaciones anteriores (node_modules y cache)...
if exist "apps\api\node_modules" (
    echo     - Borrando node_modules de la API...
    rd /s /q "apps\api\node_modules"
)
if exist "apps\web\node_modules" (
    echo     - Borrando node_modules de la Web...
    rd /s /q "apps\web\node_modules"
)
if exist "apps\web\.next" (
    echo     - Borrando cache de Next.js...
    rd /s /q "apps\web\.next"
)

:: Limpiar cache de NPM
echo     - Limpiando cache global de NPM...
call npm cache clean --force >nul 2>&1
echo  Limpieza completada.
echo.

:: ---------------------------------------------------------
:: PASO 4: INSTALAR API
:: ---------------------------------------------------------
echo [4/5] Instalando Backend (API) desde cero...
echo     (Esto puede tardar unos minutos la primera vez...)
cd apps\api
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ⚠ ERROR: Hubo un problema instalando la API.
    echo Revisa tu conexion a internet.
    cd ..\..
    pause
    exit /b
)
cd ..\..
echo  API Instalada correctamente.
echo.

:: ---------------------------------------------------------
:: PASO 5: INSTALAR WEB
:: ---------------------------------------------------------
echo [5/5] Instalando Frontend (Web) desde cero...
echo     (Descargando Next.js y dependencias...)
cd apps\web
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ⚠ ERROR CRITICO: Hubo un problema instalando la Web.
    echo.
    echo POSIBLE CAUSA:
    echo Tu Antivirus puede estar bloqueando la descarga.
    echo.
    echo SOLUCION:
    echo Desactiva temporalmente el Antivirus y ejecuta este script de nuevo.
    echo.
    cd ..\..
    pause
    exit /b
)
cd ..\..
echo  Web Instalada correctamente.
echo.

:: ---------------------------------------------------------
:: FINAL
:: ---------------------------------------------------------
echo.
echo ============================================================
echo    SISTEMA LISTO PARA USAR
echo ============================================================
echo.
echo El proyecto ha sido reparado e instalado exitosamente.
echo.
echo Para abrir la aplicacion, ejecuta el archivo:
echo    >> ejecutar.bat <<
echo.
pause