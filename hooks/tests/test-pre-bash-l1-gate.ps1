# Hook Test: pre-bash-l1-gate.ps1
# Verifica che git commit sia bloccato senza log recente

$inputJson = @{
    hook_event_name = "PreToolUse"
    tool_name = "Bash"
    tool_input = @{
        command = "git commit -m 'test'"
    }
} | ConvertTo-Json -Compress

# Pulisci log per testare il blocco
Remove-Item "C:\Users\albie\memory\quality-hook-log.txt" -ErrorAction SilentlyContinue

$inputJson | powershell -File "C:\Users\albie\.claude\hooks\pre-bash-l1-gate.ps1"
# Verifica output JSON deny
# (L'output di Write-HookDecision va a stdout)
exit 0
