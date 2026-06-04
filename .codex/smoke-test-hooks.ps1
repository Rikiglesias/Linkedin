# ---------------------------------------------------------------------------
# smoke-test-hooks.ps1 - Smoke test riproducibile degli hook Codex
#
# Verifica DA FARE del backlog AI punto 8 (parita' ambienti): "smoke task
# comparativi in almeno due ambienti". Questo script esercita OGNI hook Codex
# con input simulato e verifica la DECISIONE reale (deny/advisory), senza
# bisogno di una sessione Codex viva.
#
# Cosa prova: gli hook scattano e decidono correttamente (anti-ban/secrets/git
# block + advisory). Cosa NON prova: che l'app Codex li invochi davvero ad ogni
# evento (quello richiede una sessione Codex reale - vedi PARITY_MATRIX.md).
#
# Note implementative (best practice PowerShell):
# - ASCII-only: e' eseguito da powershell.exe (5.1) che legge i file senza BOM
#   come ANSI; caratteri non-ASCII romperebbero il parser.
# - stdin via Start-Process -RedirectStandardInput da file temp: in Windows
#   PowerShell 5.1 il pipe stringa->child e' inaffidabile per ConvertFrom-Json.
#   Il redirect da file replica l'OS-level pipe usato dall'app Codex in reale.
#
# Uso: npm run audit:codex-hook-smoke
# Exit code: 0 se tutti i casi passano, 1 se almeno uno fallisce (CI/gate).
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'

$hooksDir = Join-Path $PSScriptRoot 'hooks'
$ps = (Get-Command powershell.exe).Source

$script:pass = 0
$script:fail = 0

function Invoke-Hook {
    param(
        [string]$HookFile,
        [string]$StdinText = $null,
        [string[]]$ScriptArgs = @()
    )
    $path = Join-Path $hooksDir $HookFile
    $argLine = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $path) + $ScriptArgs

    $outFile = [System.IO.Path]::GetTempFileName()
    $errFile = [System.IO.Path]::GetTempFileName()
    $inFile = $null

    $sp = @{
        FilePath               = $ps
        ArgumentList           = $argLine
        NoNewWindow            = $true
        Wait                   = $true
        RedirectStandardOutput = $outFile
        RedirectStandardError  = $errFile
    }
    if ($null -ne $StdinText) {
        $inFile = [System.IO.Path]::GetTempFileName()
        Set-Content -LiteralPath $inFile -Value $StdinText -Encoding ascii -NoNewline
        $sp.RedirectStandardInput = $inFile
    }

    try {
        Start-Process @sp | Out-Null
        $result = Get-Content -LiteralPath $outFile -Raw
    } finally {
        Remove-Item -LiteralPath $outFile, $errFile -ErrorAction SilentlyContinue
        if ($inFile) { Remove-Item -LiteralPath $inFile -ErrorAction SilentlyContinue }
    }
    if ($null -eq $result) { return '' }
    return $result
}

function Assert-Contains {
    param([string]$Case, [string]$Output, [string]$Needle)
    # Whitespace-tolerant: bash-gate usa JSON pretty (spazi), edit-gate compresso.
    $normOut = ($Output -replace '\s', '')
    $normNeedle = ($Needle -replace '\s', '')
    if ($normOut.Contains($normNeedle)) {
        Write-Host "[OK]   $Case"
        $script:pass++
    } else {
        Write-Host "[FAIL] $Case -- atteso '$Needle' non trovato"
        Write-Host "       output: $($Output.Trim())"
        $script:fail++
    }
}

function New-EditInput {
    param([string]$FilePath)
    return (@{ tool_input = @{ file_path = $FilePath } } | ConvertTo-Json -Compress)
}

Write-Host ''
Write-Host '=== Codex Hook Smoke Test ==='
Write-Host ''

# --- 1. codex-edit-gate: ANTI-BAN hard block su file LinkedIn sensibile ---
$out = Invoke-Hook 'codex-edit-gate.ps1' (New-EditInput 'C:\repo\src\browser\humanBehavior.ts')
Assert-Contains 'edit-gate / anti-ban -> deny' $out '"permissionDecision":"deny"'
Assert-Contains 'edit-gate / anti-ban -> motivo ANTIBAN' $out 'ANTIBAN'

# --- 2. codex-edit-gate: SECRETS hard block su file credenziali ---
$out = Invoke-Hook 'codex-edit-gate.ps1' (New-EditInput 'C:\repo\.env')
Assert-Contains 'edit-gate / secrets -> deny' $out '"permissionDecision":"deny"'
Assert-Contains 'edit-gate / secrets -> motivo SECRETS' $out 'SECRETS'

# --- 3. codex-edit-gate: ADVISORY best-practice su file neutro ---
$out = Invoke-Hook 'codex-edit-gate.ps1' (New-EditInput 'C:\repo\src\utils\formatDate.ts')
Assert-Contains 'edit-gate / file neutro -> advisory best-practice' $out 'BEST_PRACTICE_CHECK'

# --- 4. codex-bash-gate: BLOCK su git commit/push ---
$out = Invoke-Hook 'codex-bash-gate.ps1' 'git commit -m "test"'
Assert-Contains 'bash-gate / git commit -> deny' $out '"permissionDecision":"deny"'

# --- 5. codex-bash-gate: ADVISORY su comando non-git ---
$out = Invoke-Hook 'codex-bash-gate.ps1' 'npm run build'
Assert-Contains 'bash-gate / comando neutro -> advisory blast radius' $out 'blast radius'

# --- 6. codex-post-edit: hygiene + verify checklist ---
$out = Invoke-Hook 'codex-post-edit.ps1' (New-EditInput 'C:\repo\src\utils\formatDate.ts')
Assert-Contains 'post-edit / hygiene checklist' $out 'CODEBASE_HIGIENE'

# --- 7. codex-runtime-context: principi comportamentali + parity awareness ---
$out = Invoke-Hook 'codex-runtime-context.ps1' -ScriptArgs @('SessionStart')
Assert-Contains 'runtime-context / mindset' $out 'MINDSET DIPENDENTE'
Assert-Contains 'runtime-context / parity awareness' $out 'CODEX_PARITY'
Assert-Contains 'runtime-context / memoria globale' $out 'CODEX_MEMORY'

# --- 8. codex-stop-check: proactive next step gate ---
$out = Invoke-Hook 'codex-stop-check.ps1'
Assert-Contains 'stop-check / proactive next step' $out 'PROACTIVE_NEXT_STEP'

# --- 9. codex-post-tool-review: review post-shell ---
$out = Invoke-Hook 'codex-post-tool-review.ps1' 'noop'
Assert-Contains 'post-tool-review / continuita review' $out 'PostToolUse Codex'

Write-Host ''
Write-Host "$($script:pass) pass, $($script:fail) fail."
Write-Host ''
if ($script:fail -gt 0) { exit 1 }
exit 0
