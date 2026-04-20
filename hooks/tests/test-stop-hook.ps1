# Hook Test: stop-session.ps1
# Verifica log timestamp reale

powershell -File "C:\Users\albie\.claude\hooks\stop-session.ps1"
$log = Get-Content "C:\Users\albie\memory\session-log.txt" -Tail 1
if ($log -match "%DATE%") { exit 1 }
exit 0
