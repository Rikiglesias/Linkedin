Option Explicit

Dim bundle
If WScript.Arguments.Count <> 1 Then
    WScript.Echo "Usage: run-audit-hidden.vbs <daily|weekly|biweekly|monthly|quarterly>"
    WScript.Quit 64
End If

bundle = LCase(WScript.Arguments(0))
Select Case bundle
    Case "daily", "weekly", "biweekly", "monthly", "quarterly"
    Case Else
        WScript.Echo "Invalid audit bundle: " & bundle
        WScript.Quit 64
End Select

Dim shell, repoDir, quote, cmd, exitCode
Set shell = CreateObject("WScript.Shell")

repoDir = "C:\Users\albie\Desktop\Programmi\Linkedin"
quote = Chr(34)

shell.CurrentDirectory = repoDir
cmd = quote & shell.ExpandEnvironmentStrings("%ComSpec%") & quote & _
    " /d /c call scripts\run-audit-task.cmd " & bundle

exitCode = shell.Run(cmd, 0, True)
WScript.Quit exitCode
