Option Explicit

' =============================================================================
'  LA CASITA DELI — Inicio Automatico Silencioso
'  Este script arranca todo sin mostrar ventanas negras.
'  Instalalo con "instalar-inicio-automatico.bat"
' =============================================================================

Dim oShell
Set oShell = CreateObject("WScript.Shell")

' ── CONFIGURACION (ajusta si mueves el proyecto) ──────────────────────────────
Const DIR_APP      = "C:\Users\DiegoB)\Desktop\lacasitadeli-admin"
' Nombre del servicio SQL Server. Default instance = MSSQLSERVER
' Si usas instancia con nombre (ej. SQLEXPRESS) cambia a: MSSQL$SQLEXPRESS
Const SERVICIO_SQL = "MSSQLSERVER"

' ── Carpeta de logs ───────────────────────────────────────────────────────────
oShell.Run "cmd /c if not exist """ & DIR_APP & "\logs"" mkdir """ & DIR_APP & "\logs""", 0, True

' ── 1. SQL Server 2014 ────────────────────────────────────────────────────────
'  Si ya esta corriendo, "net start" solo devuelve un aviso y continua.
oShell.Run "cmd /c net start " & SERVICIO_SQL & " >> """ & DIR_APP & "\logs\startup.log"" 2>&1", 0, True
WScript.Sleep 3000

' ── 2. Tailscale (conectar VPN) ───────────────────────────────────────────────
oShell.Run "cmd /c tailscale up >> """ & DIR_APP & "\logs\startup.log"" 2>&1", 0, False
WScript.Sleep 1500

' ── 3. API Node.js (puerto 3002) ──────────────────────────────────────────────
oShell.Run "cmd /c cd /d """ & DIR_APP & "\apps\api"" && node src\index.js >> """ & DIR_APP & "\logs\api.log"" 2>&1", 0, False
WScript.Sleep 3000

' ── 4. Frontend Next.js (puerto 3001) ─────────────────────────────────────────
oShell.Run "cmd /c cd /d """ & DIR_APP & "\apps\web"" && npm run dev >> """ & DIR_APP & "\logs\web.log"" 2>&1", 0, False

' ── 5. Abrir navegador al terminar de compilar (~30 seg) ──────────────────────
WScript.Sleep 30000
oShell.Run "http://localhost:3001"

Set oShell = Nothing
