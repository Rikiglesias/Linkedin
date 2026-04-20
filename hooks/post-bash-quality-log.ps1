# Hook: post-bash-quality-log.ps1
# Evento: PostToolUse — matcher: Bash
# Logga comandi quality (npm run, tsc, madge, vitest) con timestamp ISO reale

. "$PSScriptRoot\_lib.ps1"

$hook = Read-HookInput
if (-not $hook) { exit 0 }

$cmd = $hook.tool_input.command
if (-not $cmd) { exit 0 }

$LOG = 'C:\Users\albie\memory\quality-hook-log.txt'

if ($cmd -match '(npm run|npx tsc|npx madge|vitest)') {
    # Determina exit code dal risultato se disponibile (PostToolUse può avere tool_result)
    $exitInfo = ''
    if ($hook.tool_result -and $hook.tool_result.exit_code -ne $null) {
        $exitInfo = " (exit $($hook.tool_result.exit_code))"
    }
    Write-HookLog -File $LOG -Message "POST-BASH: $cmd$exitInfo"
}

exit 0
