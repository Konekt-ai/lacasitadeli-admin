@echo off
:: ── Limpiar iconos "fantasma" de la bandeja del sistema ──────────────────────
:: Borra la cache de iconos de la bandeja de Windows y reinicia el Explorador
:: para que la redibuje limpia: solo quedan los iconos de procesos VIVOS.
:: Se llama al final de cada actualizacion; tambien puedes ejecutarlo a mano
:: (doble clic) cuando la bandeja se vea llena de puntitos verdes muertos.

:: 1) Borrar la cache de iconos (Windows 11 + version anterior)
reg delete "HKCU\Control Panel\NotifyIconSettings" /f >nul 2>&1
reg delete "HKCU\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\TrayNotify" /v IconStreams /f >nul 2>&1
reg delete "HKCU\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\TrayNotify" /v PastIconsStream /f >nul 2>&1

:: 2) Reiniciar el Explorador para redibujar la bandeja (los procesos vivos
::    vuelven a poner su icono solos; los muertos ya no aparecen)
taskkill /F /IM explorer.exe >nul 2>&1
timeout /t 2 /nobreak >nul
start "" explorer.exe
