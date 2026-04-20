# Claude Code Hook Library - _lib.ps1
# Fonte: docs.anthropic.com/en/docs/claude-code/hooks (2026)
#
# API CONTRACT (verificato dalla doc ufficiale):
#   INPUT:  stdin JSON con campi session_id, cwd, hook_event_name, tool_name, tool_input, ...
#   OUTPUT: stdout JSON con hookSpecificOutput su exit 0  ->  hook attivo
#           oppure exit 2 con stderr message              →  block immediato
#   EXIT 0 + JSON deny  -> block con reason strutturata (approccio preferito)
#   EXIT 2 + stderr     -> block immediato, JSON stdout ignorato
#   EXIT 0 senza JSON   -> allow implicito
#
# SCHEMA DENY (PreToolUse):
# {
#   "hookSpecificOutput": {
#     "hookEventName": "PreToolUse",
#     "permissionDecision": "deny",
#     "permissionDecisionReason": "..."
#   }
# }
#
# SCHEMA SessionStart:
# {
#   "hookSpecificOutput": {
#     "hookEventName": "SessionStart",
#     "additionalContext": "..."
#   }
# }

# ---------------------------------------------------------------------------
# ANTIBAN_PATTERN - single source of truth per i file sensibili LinkedIn
# Importato da: pre-edit-antiban.ps1, post-edit-antiban-audit.ps1
# ---------------------------------------------------------------------------
$ANTIBAN_PATTERN = 'humanBehavior|antiban|stealth|fingerprint|browser|playwright|timing|delay|session|humanDelay|inputBlock|clickLocator|inviteWorker|inboxWorker|organicContent|syncSearch|syncList|sendInvites|sendMessages|proxy|cookie'

# Whitelist: directory escluse dal pattern antiban (infrastruttura Claude, non file LinkedIn)
$ANTIBAN_WHITELIST_DIRS = @(
    'C:\Users\albie\.claude\hooks\'
)

function Test-AntibanFile {
    param([string]$FilePath)
    foreach ($dir in $ANTIBAN_WHITELIST_DIRS) {
        if ($FilePath.StartsWith($dir, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $false
        }
    }
    return ($FilePath -match $ANTIBAN_PATTERN)
}

# ---------------------------------------------------------------------------
# Read-HookInput - legge JSON da stdin, restituisce PSCustomObject o $null
# ---------------------------------------------------------------------------
function Read-HookInput {
    try {
        $json = [Console]::In.ReadToEnd()
        if ([string]::IsNullOrWhiteSpace($json)) { return $null }
        return $json | ConvertFrom-Json -ErrorAction Stop
    } catch {
        return $null
    }
}

# ---------------------------------------------------------------------------
# Write-HookDecision - emette JSON PreToolUse su stdout e termina con exit 0
# Parametri:
#   -Decision  allow|deny|ask  (default: deny)
#   -Reason    stringa mostrata a Claude come motivo
# ---------------------------------------------------------------------------
function Write-HookDecision {
    param(
        [ValidateSet('allow', 'deny', 'ask')]
        [string]$Decision = 'deny',
        [string]$Reason = ''
    )
    $output = [ordered]@{
        hookSpecificOutput = [ordered]@{
            hookEventName          = 'PreToolUse'
            permissionDecision     = $Decision
            permissionDecisionReason = $Reason
        }
    } | ConvertTo-Json -Compress -Depth 5
    Write-Output $output
    exit 0
}

# ---------------------------------------------------------------------------
# Write-HookLog - scrive timestamp ISO reale + messaggio a un file di log
# MAI usare %DATE% o %TIME% (rompono in PowerShell)
# ---------------------------------------------------------------------------
function Write-HookLog {
    param(
        [string]$File,
        [string]$Message
    )
    try {
        $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        $dir = Split-Path -Parent $File
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Add-Content -Path $File -Value "$ts - $Message" -ErrorAction Stop
    } catch {}
}

# ---------------------------------------------------------------------------
# Get-HookCwd - ricava la cwd dal payload hook o dall'ambiente Claude
# ---------------------------------------------------------------------------
function Get-HookCwd {
    param(
        [Parameter(ValueFromPipeline = $true)]
        $HookInput
    )
    try {
        if ($HookInput -and $HookInput.cwd) {
            return [string]$HookInput.cwd
        }
    } catch {}
    if ($env:CLAUDE_PROJECT_DIR) {
        return [string]$env:CLAUDE_PROJECT_DIR
    }
    try {
        return (Get-Location).Path
    } catch {
        return ''
    }
}

# ---------------------------------------------------------------------------
# Get-ProjectRuntimeBrief - legge il brief runtime compatto del progetto
# ---------------------------------------------------------------------------
function Get-ProjectRuntimeBrief {
    param(
        [string]$Cwd,
        [int]$MaxLines = 120,
        [int]$MaxChars = 6000
    )
    if ([string]::IsNullOrWhiteSpace($Cwd)) { return '' }

    $candidates = @(
        (Join-Path $Cwd 'docs\AI_RUNTIME_BRIEF.md'),
        (Join-Path $Cwd 'AI_RUNTIME_BRIEF.md')
    )

    foreach ($path in $candidates) {
        if (-not (Test-Path -LiteralPath $path)) { continue }
        try {
            $text = (Get-Content -LiteralPath $path -Encoding UTF8 -ErrorAction Stop | Select-Object -First $MaxLines) -join "`n"
            if ($text.Length -gt $MaxChars) {
                $text = $text.Substring(0, $MaxChars) + "`n`n[TRUNCATED - consultare il file completo se serve dettaglio]"
            }
            return $text
        } catch {
            return ''
        }
    }

    return ''
}

# ---------------------------------------------------------------------------
# Write-HookAdditionalContext - emette JSON con additionalContext
# ---------------------------------------------------------------------------
function Write-HookAdditionalContext {
    param(
        [string]$HookEventName,
        [string]$AdditionalContext
    )
    if ([string]::IsNullOrWhiteSpace($HookEventName) -or [string]::IsNullOrWhiteSpace($AdditionalContext)) {
        exit 0
    }

    $output = [ordered]@{
        hookSpecificOutput = [ordered]@{
            hookEventName    = $HookEventName
            additionalContext = $AdditionalContext
        }
    } | ConvertTo-Json -Compress -Depth 5

    Write-Output $output
    exit 0
}

# ---------------------------------------------------------------------------
# Get-ProjectRulesDigest - legge il digest compatto delle regole AI
# ---------------------------------------------------------------------------
function Get-ProjectRulesDigest {
    param(
        [string]$Cwd,
        [int]$MaxChars = 4000
    )
    if ([string]::IsNullOrWhiteSpace($Cwd)) { return '' }

    $candidates = @(
        (Join-Path $Cwd 'docs\AI_RULES_DIGEST.md'),
        (Join-Path $Cwd 'AI_RULES_DIGEST.md')
    )

    foreach ($path in $candidates) {
        if (-not (Test-Path -LiteralPath $path)) { continue }
        try {
            $text = (Get-Content -LiteralPath $path -Raw -Encoding UTF8 -ErrorAction Stop)
            if ($text.Length -gt $MaxChars) {
                $text = '### AI_RULES_DIGEST.md [TRUNCATED - size troppo grande per contesto. Vedere file completo.]'
            }
            return $text
        } catch {
            return ''
        }
    }

    return ''
}
