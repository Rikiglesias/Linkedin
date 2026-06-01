# ---------------------------------------------------------------------------
# Hook: codex-post-edit.ps1
# Evento: PostToolUse — matcher: Edit|Write|MultiEdit (Codex)
#
# Combina 3 hook PostToolUse di Claude Code in 1 per Codex (zero-I: meno duplicazione):
#   1. FILE-SIZE CHECK: verifica file modificato < 300 righe (L1.6)
#   2. CODEBASE HIGIENE: advisory checklist 5 punti
#   3. VERIFY CHECKLIST: forza dichiarazione esplicita L2-L7
#
# Output combinato in un unico additionalContext (piu' token-efficient di 3 hook separati).
# Non blocca mai: advisory puro.
# ---------------------------------------------------------------------------

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

# Importa _lib.ps1 da ~/.claude (Read-HookInput, Write-HookLog)
$claudeLib = Join-Path $env:USERPROFILE '.claude\hooks\_lib.ps1'
if (Test-Path -LiteralPath $claudeLib) {
    . $claudeLib
    Initialize-HookStrictMode
} else {
    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'
}

$LOG_DIR = 'C:\Users\albie\memory'

# ---------------------------------------------------------------------------
# 1. PARSE INPUT
# ---------------------------------------------------------------------------
$payload = $null
if (Get-Command -Name Read-HookInput -ErrorAction SilentlyContinue) {
    $payload = Read-HookInput
} else {
    # Fallback inline
    try {
        $stdin = [Console]::In.ReadToEnd()
        if (-not [string]::IsNullOrWhiteSpace($stdin)) {
            $payload = $stdin | ConvertFrom-Json -ErrorAction Stop
        }
    } catch {
        exit 0
    }
}

if (-not $payload) { exit 0 }

# ---------------------------------------------------------------------------
# 2. ESTRAI FILE PATH
# ---------------------------------------------------------------------------
$filePath = ''
try {
    $filePath = [string]$payload.tool_input.file_path
    if ([string]::IsNullOrWhiteSpace($filePath)) {
        $filePath = [string]$payload.tool_input.path
    }
} catch {}
if ([string]::IsNullOrWhiteSpace($filePath)) { exit 0 }

$fileName = [System.IO.Path]::GetFileName($filePath)
$ext = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()

# ---------------------------------------------------------------------------
# 3. GATE 1: FILE-SIZE CHECK (L1.6, < 300 righe)
# ---------------------------------------------------------------------------
$sizeWarning = ''
if ($filePath -match '\.(ts|tsx|js|jsx|mjs|cjs|py|ps1|sh)$' -and (Test-Path -LiteralPath $filePath)) {
    $lineCount = (Get-Content -LiteralPath $filePath -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
    if ($lineCount -gt 300) {
        $sizeWarning = "⚠️  FILE-SIZE VIOLATION: $fileName ha $lineCount righe (soglia 300, L1.6). Valutare split SRP."
        $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        $msg = "$ts - FILE-SIZE VIOLATION (codex): $filePath ha $lineCount righe"
        try { Add-Content -Path (Join-Path $LOG_DIR 'quality-hook-log.txt') -Value $msg -ErrorAction SilentlyContinue } catch {}
    }
}

# ---------------------------------------------------------------------------
# 4. GATE 2: CODEBASE HIGIENE (sempre per ogni edit)
# ---------------------------------------------------------------------------
$hygieneLines = @(
    "### CODEBASE_HIGIENE [Codex] [$fileName]",
    "Prima del prossimo tool call o della chiusura, valutare e dichiarare in modo proporzionato:",
    "1. file diretto: era il posto giusto da modificare o esisteva un file piu' corretto?",
    "2. file indiretti: import, caller, test, docs, config, indici, registry restano coerenti?",
    "3. Pulizia: la modifica rende obsoleti parti, file, duplicati, wrapper, TODO?",
    "4. Struttura: il file resta SRP, leggibile, sotto soglia; se cresce troppo, valutare split."
)

# ---------------------------------------------------------------------------
# 5. GATE 3: VERIFY CHECKLIST L2-L7 (solo per file code, non doc)
# ---------------------------------------------------------------------------
$verifyLines = @()
$skipExts = @('.md', '.txt', '.log', '.json', '.yml', '.yaml', '.toml', '.env', '.gitignore', '.lock')
$isTestFile = $fileName.ToLowerInvariant() -match '\.test\.|\.spec\.|\.vitest\.|\.jest\.'

if ($skipExts -notcontains $ext -and -not $isTestFile) {
    $levelMap = @{
        '.ts'  = @('L2', 'L3', 'L4', 'L7')
        '.tsx' = @('L2', 'L3', 'L4', 'L5', 'L7')
        '.js'  = @('L2', 'L3', 'L4', 'L7')
        '.mjs' = @('L2', 'L3', 'L4', 'L7')
        '.py'  = @('L2', 'L3', 'L4', 'L7')
        '.ps1' = @('L2', 'L3', 'L7')
        '.sql' = @('L2', 'L3', 'L4', 'L6', 'L7')
        '.sh'  = @('L2', 'L3', 'L7')
    }

    $levels = $levelMap[$ext]
    if ($levels -and $levels.Count -gt 0) {
        # LinkedIn-touch → L7 include anti-ban obbligatorio
        $isLinkedinTouch = $filePath -match 'Linkedin|linkedin-bot|linkedin_bot|src\\browser|src\\risk|src\\salesnav'

        $levelDescriptions = @{
            'L2' = 'caller check: tutti i caller aggiornati, parametri nuovi opzionali con default, contratto rispettato'
            'L3' = "null/undefined, memory leak, listener cleanup, timeout I/O esplicito, race condition, transazione DB rollback"
            'L4' = "e se null/undefined? e se fallisce a meta'? e se chiamato 2 volte concorrentemente? rollback testato?"
            'L5' = 'UI raggiungibile (link/menu/route), stato loading visibile, error con messaggio attivabile, <200ms feedback, a11y'
            'L6' = 'dato E2E (migration->repo->API->UI), env vars validati al boot, SSOT, migration DB idempotente + rollback'
            'L7' = if ($isLinkedinTouch) {
                'cross-domain: sicurezza + ANTI-BAN (timing, fingerprint, pending ratio, navigation umana) + architettura SRP + performance + observability + igiene (file<300 righe) + test coverage'
            } else {
                'cross-domain: sicurezza + architettura SRP + performance hot-path + compliance + observability + igiene (file<300 righe, no dead code) + test coverage'
            }
        }

        $verifyLines += ""
        $verifyLines += "### POST_EDIT_VERIFY [Codex] [$fileName]"
        $verifyLines += "Dichiarare in 1-2 righe quali di questi livelli si applicano e sono stati verificati:"
        foreach ($lv in $levels) {
            if ($levelDescriptions.ContainsKey($lv)) {
                $verifyLines += "- $lv : $($levelDescriptions[$lv])"
            }
        }
        $verifyLines += "Se un livello NON si applica, dirlo esplicitamente. PRIMA del prossimo tool call."
    }
}

# ---------------------------------------------------------------------------
# 6. ASSEMBLA OUTPUT COMBINATO
# ---------------------------------------------------------------------------
$allLines = @()
if ($sizeWarning) {
    $allLines += $sizeWarning
    $allLines += ""
}
$allLines += $hygieneLines
if ($verifyLines.Count -gt 0) {
    $allLines += $verifyLines
}

# Log
$hygieneLog = Join-Path $LOG_DIR 'codebase-hygiene-log.txt'
try {
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $hygieneLog -Value "$ts - Codebase hygiene advisory (codex): $filePath" -ErrorAction SilentlyContinue
} catch {}

# Output advisory
$output = [ordered]@{
    hookSpecificOutput = [ordered]@{
        hookEventName     = 'PostToolUse'
        additionalContext = ($allLines -join "`n")
    }
} | ConvertTo-Json -Compress -Depth 5

Write-Output $output
exit 0
