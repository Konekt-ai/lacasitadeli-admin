' actualizar-silencioso.vbs
' Ejecuta actualizar-sistema.bat de forma invisible.
' Este es el archivo que va en el Programador de Tareas de Windows.
' Asi el cliente no ve ventanas negras cuando se actualiza el sistema.

Dim oShell, fso, DIR_APP
Set oShell = CreateObject("WScript.Shell")
Set fso    = CreateObject("Scripting.FileSystemObject")
DIR_APP    = fso.GetParentFolderName(WScript.ScriptFullName)

' 0 = sin ventana | True = esperar a que termine
oShell.Run """" & DIR_APP & "\actualizar-sistema.bat""", 0, True

Set fso    = Nothing
Set oShell = Nothing
