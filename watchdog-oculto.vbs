' watchdog-oculto.vbs
' Revisa si la API (puerto 3002) esta escuchando. Si NO, reinicia todo el
' sistema (iniciar-silencioso.vbs). Pensado para correr cada pocos minutos
' desde el Programador de Tareas, de forma invisible. Asi un reinicio o una
' actualizacion fallida se auto-recupera sin necesidad de SSH.

Dim sh, fso, dir, exec, salida
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)

' ¿Esta escuchando el puerto 3002 (API)?
Set exec = sh.Exec("cmd /c netstat -ano ^| findstr "":3002 "" ^| findstr LISTENING")
salida = exec.StdOut.ReadAll()

If Len(Trim(salida)) = 0 Then
    ' API caida -> levantar el sistema completo (oculto)
    sh.Run "wscript.exe """ & dir & "\iniciar-silencioso.vbs""", 0, False
End If

Set fso = Nothing
Set sh  = Nothing
