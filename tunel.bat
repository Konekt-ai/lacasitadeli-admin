@echo off
title La Casita Admin - Tunel de Acceso Externo
color 0B
cd /d "%~dp0"

echo.
echo ================================================================
echo   LA CASITA ADMIN - ACCESO DESDE CUALQUIER LUGAR
echo ================================================================
echo.

:: ── Descargar cloudflared si no existe ───────────────────────────
if not exist "cloudflared.exe" (
  echo  Descargando cloudflared...
  echo  (Necesitas conexion a internet para este paso)
  echo.
  powershell -Command "& {Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'}" 2>nul
  if not exist "cloudflared.exe" (
    color 0C
    echo  ERROR: No se pudo descargar cloudflared.exe
    echo.
    echo  Descargalo manualmente de:
    echo  https://github.com/cloudflare/cloudflared/releases/latest
    echo  Guarda el archivo como cloudflared.exe en esta carpeta.
    echo.
    pause
    exit /b 1
  )
  echo  cloudflared descargado - OK
  echo.
)

:: ── Verificar que la web este corriendo ──────────────────────────
echo  Verificando que el panel este activo...
powershell -Command "try { Invoke-WebRequest -Uri 'http://localhost:3000' -TimeoutSec 3 -UseBasicParsing | Out-Null; Write-Host ' Panel activo - OK' } catch { Write-Host ' AVISO: El panel no responde. Inicia los servicios primero con ejecutar.bat' }"
echo.

:: ── Iniciar tunel ────────────────────────────────────────────────
echo ================================================================
echo   TUNEL ACTIVO - COPIA LA URL QUE APARECE ABAJO
echo   Busca una linea como:
echo   https://xxxxxx-xxxx-xxxx.trycloudflare.com
echo ================================================================
echo.
echo  IMPORTANTE: Esta URL cambia cada vez que reinicias el tunel.
echo  Para una URL fija, crea una cuenta en cloudflare.com
echo  y configura un tunel permanente con tu dominio.
echo.
echo  Presiona Ctrl+C para cerrar el tunel cuando termines.
echo.

cloudflared tunnel --url http://localhost:3000

echo.
echo  Tunel cerrado.
pause
