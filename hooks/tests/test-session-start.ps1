# Hook Test: session-start.ps1
# Verifica l'iniezione del contesto

$inputJson = @{
    hook_event_name = "SessionStart"
    cwd = "C:\Users\albie\Desktop\Programmi\Linkedin"
} | ConvertTo-Json -Compress

$result = $inputJson | powershell -File "C:\Users\albie\.claude\hooks\session-start.ps1"
if ($result -notmatch "additionalContext") { exit 1 }
exit 0
