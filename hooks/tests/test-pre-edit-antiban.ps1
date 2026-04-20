# Hook Test: pre-edit-antiban.ps1
# Simula l'input di un Edit su file sensibile e verifica il deny

$inputJson = @{
    hook_event_name = "PreToolUse"
    tool_name = "Edit"
    tool_input = @{
        file_path = "C:\Users\albie\Desktop\Programmi\Linkedin\src\worker\humanBehavior.ts"
    }
} | ConvertTo-Json -Compress

$inputJson | powershell -File "C:\Users\albie\.claude\hooks\pre-edit-antiban.ps1"
if ($LASTEXITCODE -ne 0) { exit 1 } # L'uscita 0 è prevista perché Write-HookDecision fa exit 0

# Verifica che l'output contenga "deny"
$output = Get-Content -Path "C:\Users\albie\memory\antiban-hook-log.txt" -Tail 1
if ($output -notmatch "ANTIBAN HARD-BLOCK") { exit 1 }
exit 0
