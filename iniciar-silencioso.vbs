Option Explicit

' =============================================================================
'  LA CASITA DELI — Inicio Automatico Silencioso
'  Arranca todo sin mostrar ventanas.
'  El icono en la bandeja del sistema muestra el estado de cada servicio.
'  Para que arranque con Windows: copia este .vbs en la carpeta Startup
'  (Win+R → shell:startup)
' =============================================================================

Dim oShell, fso, DIR_APP, DESKTOP, DIR_BODEGA
Set oShell = CreateObject("WScript.Shell")
Set fso    = CreateObject("Scripting.FileSystemObject")

' Rutas dinamicas — funciona en cualquier PC sin importar el usuario
DIR_APP    = fso.GetParentFolderName(WScript.ScriptFullName)
DESKTOP    = fso.GetParentFolderName(DIR_APP)
DIR_BODEGA = DESKTOP & "\lacasitadeli-almacen"

Const SQL_SVC = "MSSQLSERVER"

' ── Carpeta de logs ───────────────────────────────────────────────────────────
oShell.Run "cmd /c if not exist """ & DIR_APP & "\logs"" mkdir """ & DIR_APP & "\logs""", 0, True

' ── 0. Cerrar procesos previos (evita conflictos de puertos) ──────────────────
oShell.Run "cmd /c taskkill /F /IM node.exe >nul 2>&1", 0, True
oShell.Run "cmd /c taskkill /F /IM pythonw.exe >nul 2>&1", 0, True
WScript.Sleep 1500

' ── 1. SQL Server ─────────────────────────────────────────────────────────────
oShell.Run "cmd /c net start " & SQL_SVC & " >> """ & DIR_APP & "\logs\startup.log"" 2>&1", 0, True
WScript.Sleep 3000

' ── 2. Tailscale (VPN para TC52 remoto) ───────────────────────────────────────
oShell.Run "cmd /c tailscale up >> """ & DIR_APP & "\logs\startup.log"" 2>&1", 0, False
WScript.Sleep 1500

' ── 3. API Node.js (puerto 3002) ──────────────────────────────────────────────
oShell.Run """" & DIR_APP & "\apps\api\start.bat""", 0, False
WScript.Sleep 3000

' ── 4. Bodega PWA — TC52 (puerto 3003) ────────────────────────────────────────
oShell.Run "wscript.exe """ & DIR_BODEGA & "\arranque-oculto.vbs""", 0, False
WScript.Sleep 2000

' ── 5. Icono en la bandeja del sistema (Python) ──────────────────────────────
oShell.Run "pythonw.exe """ & DIR_APP & "\tray-monitor.py""", 0, False

' ── 6. Frontend Next.js (puerto 3001) ─────────────────────────────────────────
oShell.Run """" & DIR_APP & "\apps\web\start.bat""", 0, False

' NO se abre el navegador automaticamente. Cada arranque/actualizacion abria una
' pestana de localhost:3001 y, con el watchdog reintentando, se llenaba el
' navegador y sobrecargaba la PC (cajas lentas). El panel queda corriendo en
' http://localhost:3001 y el usuario lo abre cuando lo necesita (icono de la
' bandeja del sistema / "iconos ocultos").

Set fso    = Nothing
Set oShell = Nothing
