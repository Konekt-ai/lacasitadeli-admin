@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
if not exist "logs" mkdir logs
:: BLINDAJE del log: un log de nombre FIJO puede quedar trabado por una corrida colgada,
:: y ahi los '>> log' fallan -> git/npm no corren -> reinicia la MISMA version (ese era el
:: "no me deja actualizar"). Por eso el log de trabajo lleva nombre UNICO por corrida
:: (nadie lo traba) y al final se copia al compartido para el boton "Ver log".
del "%~dp0logs\actualizaciones-run-*.log" >nul 2>&1
set LOG=%~dp0logs\actualizaciones-run-%RANDOM%%RANDOM%.log
set LOGSHARED=%~dp0logs\actualizaciones.log

:: git NUNCA debe colgarse esperando credenciales en ventana oculta (repo privado):
:: GIT_TERMINAL_PROMPT + GCM_INTERACTIVE=never -> falla rapido en vez de esperar un
:: dialogo que nunca aparece (sin escritorio), que era lo que trababa el log.
set GIT_TERMINAL_PROMPT=0
set GCM_INTERACTIVE=never

:: Candado anti-encimado: si ya hay una actualizacion corriendo, cancelar esta para
:: no encimar dos y trabar el log. El lock se borra al terminar y al arrancar el
:: sistema (iniciar-silencioso.vbs limpia locks colgados en cada boot/reinicio).
set LOCK=%~dp0logs\.update.lock
if exist "%LOCK%" (
    echo  Ya hay una actualizacion en curso. Se cancela esta para no encimar.
    exit /b 0
)
> "%LOCK%" echo %DATE% %TIME%

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
    call :say "  Sin conexion, reintentando (2/3)..."
    timeout /t 6 /nobreak >nul
    git fetch origin main >> "%LOG%" 2>&1
)
if errorlevel 1 (
    call :say "  Sin conexion, reintentando (3/3)..."
    timeout /t 10 /nobreak >nul
    git fetch origin main >> "%LOG%" 2>&1
)
if errorlevel 1 (
    call :say "  ERROR: No se pudo conectar a GitHub (admin) tras 3 intentos."
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
if errorlevel 1 ( timeout /t 6 /nobreak >nul & git fetch origin main >> "%LOG%" 2>&1 )
if errorlevel 1 ( timeout /t 10 /nobreak >nul & git fetch origin main >> "%LOG%" 2>&1 )
if errorlevel 1 (
    call :say "  AVISO: No se pudo conectar a GitHub (bodega) tras 3 intentos."
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
call npm install >> "%LOG%" 2>&1
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
del "%LOCK%" 2>nul
copy /y "%LOG%" "%LOGSHARED%" >nul 2>&1
goto :EOF

:: ── Helper: imprime en pantalla y en el log ───────────────────────────────────
:say
echo  %~1
>>"%LOG%" echo [%date% %time%] %~1
exit /b

:Fin
echo.
echo  La actualizacion se detuvo. Reiniciando servicios para NO dejar el sistema caido...
>>"%LOG%" echo [%date% %time%] Actualizacion abortada. Reiniciando servicios para recuperar.
del "%LOCK%" 2>nul
copy /y "%LOG%" "%LOGSHARED%" >nul 2>&1
wscript.exe "%~dp0iniciar-silencioso.vbs"
exit /b 1
