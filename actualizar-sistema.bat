@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
if not exist "logs" mkdir logs
set LOG=%~dp0logs\actualizaciones.log

echo [%date% %time%] Revisando actualizaciones en GitHub... >> "%LOG%"

:: Verificar que git esta disponible
where git >nul 2>&1
if errorlevel 1 (
    echo [%date% %time%] ERROR: Git no esta instalado. >> "%LOG%"
    exit /b 1
)

:: 1. Traer info de GitHub sin aplicar todavia
git fetch origin main >> "%LOG%" 2>&1
if errorlevel 1 (
    echo [%date% %time%] ERROR: No se pudo conectar a GitHub. Sin conexion o sin credenciales. >> "%LOG%"
    exit /b 1
)

:: 2. Comparar hash local vs remoto
for /f "tokens=*" %%i in ('git rev-parse HEAD') do set LOCAL_HASH=%%i
for /f "tokens=*" %%i in ('git rev-parse origin/main') do set REMOTE_HASH=%%i

if "!LOCAL_HASH!"=="!REMOTE_HASH!" (
    echo [%date% %time%] Sistema ya esta en la ultima version. Sin cambios. >> "%LOG%"
    exit /b 0
)

echo [%date% %time%] Cambios detectados. Actualizando sistema... >> "%LOG%"

:: 3. Descargar los cambios
git pull origin main >> "%LOG%" 2>&1
if errorlevel 1 (
    echo [%date% %time%] ERROR: Fallo git pull. Abortando. >> "%LOG%"
    exit /b 1
)

:: 4. Reinstalar dependencias
echo [%date% %time%] Instalando dependencias de la API... >> "%LOG%"
cd /d "%~dp0apps\api"
call npm install --omit=dev >> "%LOG%" 2>&1
cd /d "%~dp0"

echo [%date% %time%] Instalando dependencias del panel web... >> "%LOG%"
cd /d "%~dp0apps\web"
call npm install --omit=dev >> "%LOG%" 2>&1
cd /d "%~dp0"

:: 5. Actualizar repo almacen (goto evita el problema del ) en la ruta de usuario)
set ALMACEN=%~dp0..\lacasitadeli-almacen
if not exist "%ALMACEN%\.git" goto :ClonAlmacen

echo [%date% %time%] Revisando actualizaciones en repo almacen... >> "%LOG%"
cd /d "%ALMACEN%"
git fetch origin main >> "%LOG%" 2>&1
if errorlevel 1 (
    echo [%date% %time%] AVISO: No se pudo conectar a GitHub para almacen. Continuando... >> "%LOG%"
    cd /d "%~dp0"
    goto :FinAlmacen
)
for /f "tokens=*" %%i in ('git rev-parse HEAD') do set ALMACEN_LOCAL=%%i
for /f "tokens=*" %%i in ('git rev-parse origin/main') do set ALMACEN_REMOTE=%%i
if "!ALMACEN_LOCAL!"=="!ALMACEN_REMOTE!" (
    echo [%date% %time%] Almacen ya esta en la ultima version. >> "%LOG%"
    cd /d "%~dp0"
    goto :FinAlmacen
)
echo [%date% %time%] Cambios detectados en almacen. Actualizando... >> "%LOG%"
git pull origin main >> "%LOG%" 2>&1
if errorlevel 1 (
    echo [%date% %time%] ERROR: Fallo git pull en almacen. >> "%LOG%"
) else (
    echo [%date% %time%] Almacen actualizado correctamente. >> "%LOG%"
)
cd /d "%~dp0"
goto :FinAlmacen

:ClonAlmacen
echo [%date% %time%] AVISO: No se encontro repo almacen. Clonando... >> "%LOG%"
cd /d "%~dp0.."
git clone https://github.com/Konekt-ai/lacasitadeli-almacen >> "%LOG%" 2>&1
cd /d "%~dp0"
:FinAlmacen

:: 6. Reconstruir bodega si existe (goto evita el problema del ) en la ruta)
set BODEGA=%~dp0..\lacasitadeli-almacen\pwa-bodega
if not exist "%BODEGA%\package.json" goto :FinBodega
echo [%date% %time%] Reconstruyendo sistema de bodega TC52... >> "%LOG%"
cd /d "%BODEGA%"
call npm install --omit=dev >> "%LOG%" 2>&1
call npm run build >> "%LOG%" 2>&1
cd /d "%~dp0"
echo [%date% %time%] Bodega reconstruida. >> "%LOG%"
:FinBodega

:: 7. Reiniciar servicios
echo [%date% %time%] Reiniciando servicios... >> "%LOG%"
taskkill /F /IM node.exe    >> "%LOG%" 2>&1
taskkill /F /IM pythonw.exe >> "%LOG%" 2>&1
timeout /t 2 /nobreak >nul

:: Relanzar todo con el VBS principal
wscript.exe "%~dp0iniciar-silencioso.vbs"

echo [%date% %time%] Actualizacion completada exitosamente. >> "%LOG%"
echo ---------------------------------------- >> "%LOG%"
