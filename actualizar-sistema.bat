@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
if not exist "logs" mkdir logs
set LOG=%~dp0logs\actualizaciones.log

set ADMIN_EST=sin cambios
set BODEGA_EST=sin cambios
set ADMIN_VER=?
set BODEGA_VER=?

echo.
echo  ============================================================
echo    LA CASITA DELI - ACTUALIZADOR DE SISTEMA
echo  ============================================================
echo.
>>"%LOG%" echo [%date% %time%] ===============================
>>"%LOG%" echo [%date% %time%] Iniciando actualizacion...

call :say "Cerrando procesos anteriores..."
taskkill /F /IM node.exe    >> "%LOG%" 2>&1
taskkill /F /IM pythonw.exe >> "%LOG%" 2>&1
timeout /t 3 /nobreak >nul

where git >nul 2>&1
if errorlevel 1 (
    call :say "ERROR: Git no esta instalado."
    goto :Fin
)

:: ── ADMIN (panel + API) ──────────────────────────────────────────────────────
echo.
call :say "[ADMIN] Panel y API"
git fetch origin main >> "%LOG%" 2>&1
if errorlevel 1 (
    call :say "  ERROR: No se pudo conectar a GitHub (admin)."
    goto :Fin
)
for /f "tokens=*" %%i in ('git rev-parse HEAD') do set LOCAL_HASH=%%i
for /f "tokens=*" %%i in ('git rev-parse origin/main') do set REMOTE_HASH=%%i
if "!LOCAL_HASH!"=="!REMOTE_HASH!" (
    call :say "  Ya esta en la ultima version."
    goto :AdminVer
)
call :say "  Cambios detectados. Sincronizando..."
git reset --hard origin/main >> "%LOG%" 2>&1
git clean -fd --exclude=logs/ --exclude=apps/api/.env --exclude=apps/api/lacasita.db --exclude=apps/api/lacasita.db-wal --exclude=apps/api/lacasita.db-shm >> "%LOG%" 2>&1
if errorlevel 1 (
    call :say "  ERROR: Fallo al sincronizar admin."
    goto :Fin
)
call :say "  Instalando dependencias API..."
cd /d "%~dp0apps\api"
call npm install --omit=dev >> "%LOG%" 2>&1
call :say "  Instalando y construyendo Web (modo produccion)..."
cd /d "%~dp0apps\web"
call npm install >> "%LOG%" 2>&1
rmdir /s /q ".next" >nul 2>&1
call npm run build >> "%LOG%" 2>&1
cd /d "%~dp0"
set ADMIN_EST=ACTUALIZADO
call :say "  Admin actualizado."
:AdminVer
for /f %%i in ('git rev-parse --short HEAD') do set ADMIN_VER=%%i

:: ── MIGRACION DE BASE DE DATOS (idempotente) ─────────────────────────────────
call :say "Ejecutando migracion de BD (recepcion)..."
node "%~dp0apps\api\migrate.js" >> "%LOG%" 2>&1

:: ── BODEGA (repo almacen + PWA del TC52) ──────────────────────────────────────
echo.
call :say "[BODEGA] Almacen y PWA del TC52"
set ALMACEN=%~dp0..\lacasitadeli-almacen
if not exist "%ALMACEN%\.git" goto :ClonAlmacen

cd /d "%ALMACEN%"
git fetch origin main >> "%LOG%" 2>&1
if errorlevel 1 (
    call :say "  AVISO: No se pudo conectar a GitHub (bodega)."
    cd /d "%~dp0"
    goto :FinBodega
)
for /f "tokens=*" %%i in ('git rev-parse HEAD') do set ALM_LOCAL=%%i
for /f "tokens=*" %%i in ('git rev-parse origin/main') do set ALM_REMOTE=%%i
if "!ALM_LOCAL!"=="!ALM_REMOTE!" (
    call :say "  Ya esta en la ultima version."
    cd /d "%~dp0"
    goto :Bodega
)
call :say "  Cambios detectados. Sincronizando..."
git reset --hard origin/main >> "%LOG%" 2>&1
git clean -fd >> "%LOG%" 2>&1
set BODEGA_EST=ACTUALIZADO
call :say "  Bodega sincronizada."
cd /d "%~dp0"
goto :Bodega

:ClonAlmacen
call :say "  Clonando repo de almacen..."
cd /d "%~dp0.."
git clone https://github.com/Konekt-ai/lacasitadeli-almacen >> "%LOG%" 2>&1
set BODEGA_EST=CLONADO
cd /d "%~dp0"

:Bodega
set BODEGA=%~dp0..\lacasitadeli-almacen\pwa-bodega
if not exist "%BODEGA%\package.json" goto :FinBodega
for /f %%i in ('git -C "%ALMACEN%" rev-parse --short HEAD') do set BODEGA_VER=%%i
call :say "  Reconstruyendo PWA del TC52..."
cd /d "%BODEGA%"
call npm install --omit=dev >> "%LOG%" 2>&1
call npm run build >> "%LOG%" 2>&1
cd /d "%~dp0"
call :say "  PWA del TC52 reconstruida."
:FinBodega

:: ── REINICIAR ────────────────────────────────────────────────────────────────
echo.
call :say "Reiniciando servicios..."
taskkill /F /IM node.exe    >> "%LOG%" 2>&1
taskkill /F /IM pythonw.exe >> "%LOG%" 2>&1
timeout /t 2 /nobreak >nul
wscript.exe "%~dp0iniciar-silencioso.vbs"

:: Limpiar iconos "fantasma" de la bandeja (deja la bandeja limpia tras cada update)
call :say "Limpiando iconos de la bandeja..."
timeout /t 6 /nobreak >nul
call "%~dp0limpiar-iconos.bat" >> "%LOG%" 2>&1

:: ── RESUMEN ──────────────────────────────────────────────────────────────────
echo.
echo  ------------------------------------------------------------
echo    RESUMEN DE LA ACTUALIZACION
echo      Admin  (panel / API) : !ADMIN_EST!  -  version !ADMIN_VER!
echo      Bodega (TC52 / PWA)  : !BODEGA_EST!  -  version !BODEGA_VER!
echo  ------------------------------------------------------------
echo.
>>"%LOG%" echo [%date% %time%] Resumen: Admin=!ADMIN_EST! (!ADMIN_VER!)  Bodega=!BODEGA_EST! (!BODEGA_VER!)
>>"%LOG%" echo [%date% %time%] Actualizacion completada.
>>"%LOG%" echo [%date% %time%] ===============================
goto :EOF

:: ── Helper: imprime en pantalla y en el log ───────────────────────────────────
:say
echo  %~1
>>"%LOG%" echo [%date% %time%] %~1
exit /b

:Fin
echo.
echo  La actualizacion se detuvo. Revisa logs\actualizaciones.log
>>"%LOG%" echo [%date% %time%] Actualizacion abortada.
exit /b 1
