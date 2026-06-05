@echo off
cd /d "%~dp0"

:: El panel corre en modo PRODUCCION (rapido, liviano y con archivos "chunks"
:: fijos -> sin ChunkLoadError ni la lentitud del modo dev).
:: El actualizador reconstruye en cada actualizacion. Esto es el respaldo: si no
:: hay build de produccion (primer arranque o transicion), instala y construye.
if not exist ".next\BUILD_ID" (
    echo Preparando panel en modo produccion ^(instalar + construir^)...
    call npm install
    call npm run build
)

:: Arrancar el panel en produccion (puerto 3001, accesible por LAN/Tailscale).
call npm run start
