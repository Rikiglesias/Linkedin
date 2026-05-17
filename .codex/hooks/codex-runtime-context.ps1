param(
    [string]$EventName = "UserPromptSubmit"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$RuntimeBriefPath = Join-Path $RepoRoot "docs\AI_RUNTIME_BRIEF.md"
$ContractPath = Join-Path $RepoRoot "docs\tracking\AI_ORCHESTRATOR_CONTRACT.md"
$ContinuationPath = Join-Path $RepoRoot ".claude\CONTINUATION.md"

$contextLines = @(
    "AI_ORCHESTRATOR_CONTEXT [$EventName]",
    "- Applica docs/tracking/AI_ORCHESTRATOR_CONTRACT.md prima di pianificare o modificare.",
    "- Interpreta intento reale, input come ipotesi, esempi come pattern e decomposizione ricorsiva.",
    "- Scegli automaticamente skill, MCP, plugin, script, audit, modello/ambiente e fonte di verita corretta.",
    "- Per modifiche: blast radius, file diretti/indiretti, L2-L9 proporzionati e cross-domain per ogni file.",
    "- Prima di dichiarare DONE: prove, audit/test, limiti residui e prossimo passo esatto."
)

if (Test-Path $RuntimeBriefPath) {
    $contextLines += "- Runtime brief presente: $RuntimeBriefPath"
}

if (Test-Path $ContractPath) {
    $contextLines += "- Contratto orchestrator presente: $ContractPath"
}

if ((Test-Path $ContinuationPath) -and ((Get-Content $ContinuationPath -Raw) -match "TODO: \[AI:")) {
    $contextLines += "- WARNING: .claude/CONTINUATION.md contiene placeholder; aggiornarlo prima di handoff o chiusura."
}

@{
    hookSpecificOutput = @{
        hookEventName = $EventName
        additionalContext = ($contextLines -join "`n")
    }
} | ConvertTo-Json -Depth 5
