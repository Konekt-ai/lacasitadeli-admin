' watchdog-oculto.vbs
' Revisa si la API (puerto 3002) esta escuchando. Si NO lo esta en DOS revisiones
' seguidas (con 20s de diferencia), reinicia todo el sistema (iniciar-silencioso).
' La doble-verificacion evita reiniciar por un bache momentaneo (p.ej. durante una
' actualizacion o un instante de carga), que tumbaba el panel sin necesidad.
' Pensado para correr cada pocos minutos desde el Programador de Tareas, invisible.

Dim sh, fso, dir
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)

Function ApiCaida()
    Dim e, s
    Set e = sh.Exec("cmd /c netstat -ano ^| findstr "":3002 "" ^| findstr LISTENING")
    s = e.StdOut.ReadAll()
    ApiCaida = (Len(Trim(s)) = 0)
End Function

If ApiCaida() Then
    ' Espera y vuelve a checar: si fue solo un bache, ya estara arriba.
    WScript.Sleep 20000
    If ApiCaida() Then
        ' Sigue caida -> levantar el sistema completo (oculto)
        sh.Run "wscript.exe """ & dir & "\iniciar-silencioso.vbs""", 0, False
    End If
End If

Set fso = Nothing
Set sh  = Nothing
