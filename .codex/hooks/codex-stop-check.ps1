# ---------------------------------------------------------------------------
# Hook: codex-stop-check.ps1 (Stop, Codex)
# Estende il gate di chiusura con 3 controlli (parità Claude Code):
#   1. CONTINUATION placeholder check + working tree check (originale)
#   2. SYNC OBSIDIAN: ~/memory/ -> vault (best-effort, riusa lo script Node)
#   3. PROACTIVE NEXT STEP: gate di continuità operativa
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$ContinuationPath = Join-Path $RepoRoot ".claude\CONTINUATION.md"
$messages = New-Object System.Collections.Generic.List[string]

# === 1. CONTINUATION + working tree (originale) ===
if ((Test-Path $ContinuationPath) -and ((Get-Content $ContinuationPath -Raw) -match "TODO: \[AI:")) {
    $messages.Add("CONTINUATION contiene placeholder AI: aggiornarlo prima di trattare il handoff come affidabile.")
}

$gitStatus = & git -C $RepoRoot status --short 2>$null
if ($LASTEXITCODE -eq 0 -and $gitStatus) {
    $messages.Add("Working tree non pulito: non dichiarare DONE senza spiegare file modificati, verifiche e stato commit.")
}

# === 2. SYNC OBSIDIAN (best-effort, skip silenzioso se Obsidian chiuso) ===
$syncScript = Join-Path $env:USERPROFILE ".claude\scripts\sync-memory-to-obsidian.mjs"
$obsidianLog = Join-Path $env:USERPROFILE "memory\obsidian-sync-log.txt"
if (Test-Path -LiteralPath $syncScript) {
    try {
        $syncOut = & node $syncScript --verbose 2>&1 | Out-String
        $syncLine = ($syncOut -split "`n" | Where-Object { $_ -match 'sync-obsidian:' } | Select-Object -Last 1)
        if ($syncLine) {
            $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
            try { Add-Content -Path $obsidianLog -Value "$ts - [codex] $($syncLine.Trim())" -ErrorAction SilentlyContinue } catch {}
            $messages.Add("Vault Obsidian sincronizzato: $($syncLine.Trim())")
        }
    } catch {
        # Obsidian chiuso o errore: skip silenzioso, non blocca lo stop
    }
}

# === 3. PROACTIVE NEXT STEP ===
$messages.Add("PROACTIVE_NEXT_STEP: chiudi con prossimi passi concreti, blocco (causa+azione) o domanda specifica. No 'dimmi tu'/'fammi sapere'.")

if ($messages.Count -eq 0) {
    $messages.Add("Stop gate: dichiarare DONE solo con prove; altrimenti PARTIAL/BLOCKED con prossimo passo esatto.")
}

@{
    continue = $true
    systemMessage = ($messages -join " ")
} | ConvertTo-Json -Depth 5
