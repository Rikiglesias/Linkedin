$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$ContinuationPath = Join-Path $RepoRoot ".claude\CONTINUATION.md"
$messages = New-Object System.Collections.Generic.List[string]

if ((Test-Path $ContinuationPath) -and ((Get-Content $ContinuationPath -Raw) -match "TODO: \[AI:")) {
    $messages.Add("CONTINUATION contiene placeholder AI: aggiornarlo prima di trattare il handoff come affidabile.")
}

$gitStatus = & git -C $RepoRoot status --short 2>$null
if ($LASTEXITCODE -eq 0 -and $gitStatus) {
    $messages.Add("Working tree non pulito: non dichiarare DONE senza spiegare file modificati, verifiche e stato commit.")
}

if ($messages.Count -eq 0) {
    $messages.Add("Stop gate: dichiarare DONE solo con prove; altrimenti PARTIAL/BLOCKED con prossimo passo esatto.")
}

@{
    continue = $true
    systemMessage = ($messages -join " ")
} | ConvertTo-Json -Depth 5
