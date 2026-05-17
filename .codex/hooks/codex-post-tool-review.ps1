$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$logDir = Join-Path $env:USERPROFILE "memory"
$logPath = Join-Path $logDir "codex-hook-log.txt"

if (!(Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
Add-Content -Path $logPath -Value "$timestamp Codex PostToolUse: riesaminare effetti diretti/indiretti e aggiornare tracking se necessario."

@{
    hookSpecificOutput = @{
        additionalContext = "PostToolUse Codex: se hai modificato file, controlla codebase hygiene, caller indiretti, docs/registry/test collegati e completion veritiera."
    }
} | ConvertTo-Json -Depth 5
