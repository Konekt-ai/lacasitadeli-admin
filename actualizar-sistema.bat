@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
if not exist "logs" mkdir logs
set LOG=%~dp0logs\actualizaciones.log

echo [%date% %time%] =============================== >> "%LOG%"
echo [%date% %time%] Iniciando actualizacion... >> "%LOG%"

:: 0. Cerrar procesos anteriores antes de tocar archivos
echo [%date% %time%] Cerrando procesos anteriores... >> "%LOG%"
taskkill /F /IM node.exe    >> "%LOG%" 2>&1
taskkill /F /IM pythonw.exe >> "%LOG%" 2>&1
timeout /t 3 /nobreak >nul

:: Verificar git
where git >nul 2>&1
if errorlevel 1 (
    echo [%date% %time%] ERROR: Git no esta instalado. >> "%LOG%"
    exit /b 1
)

:: ── REPO ADMIN ───────────────────────────────────────────────────────────────

:: 1. Traer cambios de GitHub
git fetch origin main >> "%LOG%" 2>&1
if errorlevel 1 (
    echo [%date% %time%] ERROR: No se pudo conectar a GitHub. >> "%LOG%"
    exit /b 1
)

:: 2. Comparar hashes
for /f "tokens=*" %%i in ('git rev-parse HEAD') do set LOCAL_HASH=%%i
for /f "tokens=*" %%i in ('git rev-parse origin/main') do set REMOTE_HASH=%%i

if "!LOCAL_HASH!"=="!REMOTE_HASH!" (
    echo [%date% %time%] Admin: ya en la ultima version. >> "%LOG%"
    goto :SaltarInstallAdmin
)

echo [%date% %time%] Admin: cambios detectados. Sincronizando... >> "%LOG%"

:: 3. Sincronizar exacto con GitHub (descarta cambios locales sin preguntar)
git reset --hard origin/main >> "%LOG%" 2>&1
git clean -fd --exclude=logs/ --exclude=apps/api/.env --exclude=apps/api/lacasita.db --exclude=apps/api/lacasita.db-wal --exclude=apps/api/lacasita.db-shm >> "%LOG%" 2>&1
if errorlevel 1 (
    echo [%date% %time%] ERROR: Fallo al sincronizar admin. >> "%LOG%"
    exit /b 1
)
echo [%date% %time%] Admin: sincronizado correctamente. >> "%LOG%"

:: 4. Reinstalar dependencias
echo [%date% %time%] Instalando dependencias API... >> "%LOG%"
cd /d "%~dp0apps\api"
call npm install --omit=dev >> "%LOG%" 2>&1
cd /d "%~dp0"

echo [%date% %time%] Instalando dependencias Web... >> "%LOG%"
cd /d "%~dp0apps\web"
call npm install --omit=dev >> "%LOG%" 2>&1
cd /d "%~dp0"

:SaltarInstallAdmin

:: ── MIGRACION DE BASE DE DATOS (idempotente) ─────────────────────────────────
:: Crea/actualiza las tablas de recepcion en MSSQL si faltan. Seguro repetir.
echo [%date% %time%] Ejecutando migracion de BD (recepcion)... >> "%LOG%"
node "%~dp0apps\api\migrate.js" >> "%LOG%" 2>&1

:: ── REPO ALMACEN ─────────────────────────────────────────────────────────────

set ALMACEN=%~dp0..\lacasitadeli-almacen
if not exist "%ALMACEN%\.git" goto :ClonAlmacen

echo [%date% %time%] Almacen: revisando actualizaciones... >> "%LOG%"
cd /d "%ALMACEN%"
git fetch origin main >> "%LOG%" 2>&1
if errorlevel 1 (
    echo [%date% %time%] AVISO: No se pudo conectar a GitHub para almacen. >> "%LOG%"
    cd /d "%~dp0"
    goto :FinAlmacen
)
for /f "tokens=*" %%i in ('git rev-parse HEAD') do set ALMACEN_LOCAL=%%i
for /f "tokens=*" %%i in ('git rev-parse origin/main') do set ALMACEN_REMOTE=%%i
if "!ALMACEN_LOCAL!"=="!ALMACEN_REMOTE!" (
    echo [%date% %time%] Almacen: ya en la ultima version. >> "%LOG%"
    cd /d "%~dp0"
    goto :FinAlmacen
)
echo [%date% %time%] Almacen: sincronizando... >> "%LOG%"
git reset --hard origin/main >> "%LOG%" 2>&1
git clean -fd >> "%LOG%" 2>&1
echo [%date% %time%] Almacen: actualizado. >> "%LOG%"
cd /d "%~dp0"
goto :FinAlmacen

:ClonAlmacen
echo [%date% %time%] Almacen: clonando repo... >> "%LOG%"
cd /d "%~dp0.."
git clone https://github.com/Konekt-ai/lacasitadeli-almacen >> "%LOG%" 2>&1
cd /d "%~dp0"
:FinAlmacen

:: ── BODEGA PWA ───────────────────────────────────────────────────────────────

set BODEGA=%~dp0..\lacasitadeli-almacen\pwa-bodega
if not exist "%BODEGA%\package.json" goto :FinBodega
echo [%date% %time%] Bodega: reconstruyendo PWA TC52... >> "%LOG%"
cd /d "%BODEGA%"
call npm install --omit=dev >> "%LOG%" 2>&1
call npm run build >> "%LOG%" 2>&1
cd /d "%~dp0"
echo [%date% %time%] Bodega: reconstruida. >> "%LOG%"
:FinBodega

:: ── REINICIAR ────────────────────────────────────────────────────────────────

echo [%date% %time%] Reiniciando servicios... >> "%LOG%"
taskkill /F /IM node.exe    >> "%LOG%" 2>&1
taskkill /F /IM pythonw.exe >> "%LOG%" 2>&1
timeout /t 2 /nobreak >nul

wscript.exe "%~dp0iniciar-silencioso.vbs"

echo [%date% %time%] Actualizacion completada. >> "%LOG%"
echo [%date% %time%] =============================== >> "%LOG%"
