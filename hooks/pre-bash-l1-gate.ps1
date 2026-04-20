# Hook: pre-bash-l1-gate.ps1
# Evento: PreToolUse - matcher: Bash
# Blocca git commit se non c'è un quality check recente (<60 min) in quality-hook-log.txt
# Bypass: impostare env var CLAUDE_SKIP_L1=1 per commit docs-only (logga warning)

. "$PSScriptRoot\_lib.ps1"

$hook = Read-HookInput
if (-not $hook) { exit 0 }

$cmd = $hook.tool_input.command
if (-not ($cmd -match 'git\s+commit')) { exit 0 }

$LOG_QUALITY = 'C:\Users\albie\memory\quality-hook-log.txt'
$LOG_VIOLATIONS = 'C:\Users\albie\memory\rule-violations-log.txt'

# Bypass con CLAUDE_SKIP_L1=1
if ($env:CLAUDE_SKIP_L1 -eq '1') {
    Write-HookLog -File $LOG_VIOLATIONS -Message "L1 BYPASS con CLAUDE_SKIP_L1=1: $cmd"
    exit 0
}

# Verifica che esista un quality check recente (< 60 min) con exit OK
$passed = $false
if (Test-Path $LOG_QUALITY) {
    $lines = Get-Content $LOG_QUALITY -ErrorAction SilentlyContinue | Select-Object -Last 50
    foreach ($line in ($lines | Sort-Object -Descending)) {
        # Formato atteso: "2026-04-09 16:30:00 - POST-BASH: npm run conta-problemi (exit 0)"
        if ($line -match '^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) - POST-BASH:.*?(npm run|npx tsc|npx madge|vitest)') {
            try {
                $ts = [datetime]::ParseExact($Matches[1], 'yyyy-MM-dd HH:mm:ss', $null)
                $age = ([datetime]::Now - $ts).TotalMinutes
                if ($age -le 60) {
                    $passed = $true
                    break
                }
            } catch {}
        }
    }
}

if (-not $passed) {
    Write-HookLog -File $LOG_VIOLATIONS -Message "L1 GATE BLOCK: git commit senza quality check recente"
    Write-HookDecision -Decision deny -Reason "L1 GATE: nessun quality check nelle ultime 60 min. Eseguire: npm run conta-problemi"
}

exit 0
