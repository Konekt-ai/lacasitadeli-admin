@echo off
setlocal EnableDelayedExpansion
title La Casita Deli - Preparar acceso por red / Tailscale
color 0B
cd /d "%~dp0"

:: ── Auto-elevar a administrador (la regla de firewall lo requiere) ────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  Solicitando permisos de administrador...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo.
echo  ============================================================
echo    PREPARAR ACCESO POR RED / TAILSCALE
echo  ============================================================
echo.
echo  Esto hace que el panel (3001), la API (3002) y el TC52 (3003)
echo  sean accesibles por la red local y por Tailscale, y que el
echo  sistema arranque solo cuando se prende la PC.
echo.

:: ── 1. Regla de Firewall: permitir entrante TCP 3001-3003 ─────────────────────
echo  [1/2] Configurando Firewall de Windows (puertos 3001-3003)...
netsh advfirewall firewall delete rule name="La Casita Deli (3001-3003)" >nul 2>&1
netsh advfirewall firewall add rule name="La Casita Deli (3001-3003)" dir=in action=allow protocol=TCP localport=3001-3003 profile=any >nul
if errorlevel 1 (
    echo        ERROR al crear la regla de firewall.
) else (
    echo        OK - entrante TCP 3001-3003 permitido.
)

:: ── 2. Arranque automatico al iniciar sesion (acceso directo en Startup) ──────
echo  [2/2] Configurando arranque automatico al prender la PC...
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LNK=%STARTUP%\LaCasitaDeli.lnk"
set "VBS=%~dp0iniciar-silencioso.vbs"
if not exist "%VBS%" (
    echo        ERROR: no se encontro iniciar-silencioso.vbs
    goto :Fin
)
powershell -NoProfile -Command "$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut('%LNK%'); $s.TargetPath='wscript.exe'; $s.Arguments=('\"' + '%VBS%' + '\"'); $s.WorkingDirectory='%~dp0'; $s.Save()"
if exist "%LNK%" (
    echo        OK - el sistema arrancara solo al iniciar sesion.
) else (
    echo        ERROR al crear el acceso directo de arranque.
)

:Fin
echo.
echo  ------------------------------------------------------------
echo    RESUMEN
echo      Firewall          : entrante TCP 3001-3003 permitido
echo      Arranque automatico: %LNK%
echo  ------------------------------------------------------------
echo.
echo  NOTA: para que arranque sin que nadie inicie sesion, la PC de
echo  tienda debe tener INICIO DE SESION AUTOMATICO del usuario.
echo.
echo  Presiona una tecla para cerrar...
pause >nul
