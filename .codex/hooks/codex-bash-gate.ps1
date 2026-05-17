$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$stdin = [Console]::In.ReadToEnd()
$commandText = $stdin

if ($commandText -match "git\s+(commit|push)") {
    @{
        permissionDecision = "deny"
        permissionDecisionReason = "Codex git commit/push richiede prima audit:git-automation e conferma dei gate del repo."
    } | ConvertTo-Json -Depth 5
    exit 0
}

@{
    hookSpecificOutput = @{
        additionalContext = "Prima di shell/edit: verifica fonte, blast radius, file indiretti, L1 e rischi cross-domain proporzionati."
    }
} | ConvertTo-Json -Depth 5
