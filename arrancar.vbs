' La Casita Deli — Arranque automatico de servicios
' Se ejecuta al iniciar sesion en Windows (sin ventana visible)
Dim WshShell, appData, pm2
Set WshShell = CreateObject("WScript.Shell")
appData = WshShell.ExpandEnvironmentStrings("%APPDATA%")
pm2 = appData & "\npm\pm2.cmd"
WshShell.Run "cmd /c """ & pm2 & """ resurrect", 0, False
Set WshShell = Nothing
