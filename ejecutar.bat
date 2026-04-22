@echo off
title La Casita - Servidor Unificado
color 0A
cd /d "%~dp0"

echo.
echo ============================================================
echo    INICIANDO LA CASITA (MODO admin local)
echo ============================================================
echo.
echo Los servidores se iniciaran en segundo plano 
echo 
echo.

:: 1. Limpiar puertos anteriores (por si acaso)
echo  Limpiando puertos antiguos...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3002') do taskkill /F /PID %%a >nul 2>&1

:: 2. Crear un script VBS temporal para ejecutar la API en modo oculto
echo  Iniciando API (Puerto 3002)...
echo Set WshShell = CreateObject("WScript.Shell") > _launch_api.vbs
echo WshShell.Run "cmd /c ""cd /d ""%~dp0apps\api"" && set PORT=3002 && node src/index.js > ""%~dp0api.log"" 2>&1""", 0, False >> _launch_api.vbs
cscript //nologo _launch_api.vbs
del _launch_api.vbs

:: 3. Crear un script VBS temporal para ejecutar la Web en modo oculto
echo  Iniciando Web (Puerto 3001)...
echo Set WshShell = CreateObject("WScript.Shell") > _launch_web.vbs
echo WshShell.Run "cmd /c ""cd /d ""%~dp0apps\web"" && npm run dev -- -p 3001 > ""%~dp0web.log"" 2>&1""", 0, False >> _launch_web.vbs
cscript //nologo _launch_web.vbs
del _launch_web.vbs

:: 4. Esperar y abrir navegador
echo.
echo  Esperando a que arranque el sistema...
timeout /t 6 /nobreak >nul
start http://localhost:3001

echo ============================================================
echo    SISTEMA ACTIVO
echo ============================================================
echo.
echo El servidor esta corriendo en segundo plano.
echo.
echo IMPORTANTE: Como los servidores estan ocultos, 
echo para APAGAR el sistema debes presionar una tecla aqui abajo
echo o simplemente cerrar esta ventana.
echo.
echo (Revisa api.log y web.log si hay errores).
echo.

:: 5. Mantener la ventana abierta hasta que el usuario quiera salir
pause

:: 6. Limpieza final al salir (Matar procesos)
echo.
echo Deteniendo servidores...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3002') do taskkill /F /PID %%a >nul 2>&1
echo Listo. Hasta luego!
timeout /t 2 >nul