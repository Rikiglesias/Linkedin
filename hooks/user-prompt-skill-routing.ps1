param()

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

. "$PSScriptRoot\_lib.ps1"

# ---------------------------------------------------------------------------
# Hook: user-prompt-skill-routing.ps1 (UserPromptSubmit)
# Forza il routing skill/MCP dal registro AI_CAPABILITY_ROUTING.json
# Codifica la regola "controllare skill esistenti prima di scrivere tooling"
# come automatismo non dimenticabile.
# ---------------------------------------------------------------------------

$LOG = 'C:\Users\albie\memory\routing-log.txt'

$payload = Read-HookInput
if (-not $payload) { exit 0 }

$prompt = ''
try { $prompt = [string]$payload.prompt } catch {}
if ([string]::IsNullOrWhiteSpace($prompt)) { exit 0 }

$cwd = Get-HookCwd -HookInput $payload
$routingPath = Join-Path $cwd 'docs\tracking\AI_CAPABILITY_ROUTING.json'
if (-not (Test-Path -LiteralPath $routingPath)) { exit 0 }

try {
    $routing = Get-Content -LiteralPath $routingPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    exit 0
}

$promptLower = $prompt.ToLowerInvariant()
$matches = New-Object System.Collections.Generic.List[object]

foreach ($domain in $routing.domains) {
    $matched = $false
    foreach ($pattern in $domain.intentPatterns) {
        if ($promptLower -match [regex]::Escape($pattern.ToLowerInvariant())) {
            $matched = $true
            break
        }
    }
    if ($matched) {
        $caps = ($domain.primaryCapabilities -join ', ')
        $matches.Add([PSCustomObject]@{
            Domain  = $domain.domainId
            Caps    = $caps
            Notes   = $domain.notes
        }) | Out-Null
    }
}

if ($matches.Count -eq 0) { exit 0 }

# Costruisci messaggio forzato
$lines = @()
$lines += '### ROUTING_FORCED [hook automatico - NON IGNORARE]'
$lines += 'Il prompt corrente matcha questi domini del routing AI. PRIMA di scrivere codice o tooling custom, valutare le capability gia' + "'" + ' disponibili:'
foreach ($m in $matches) {
    $lines += ('- **' + $m.Domain + '** -> ' + $m.Caps)
    if ($m.Notes) { $lines += ('  ' + $m.Notes) }
}
$lines += ''
$lines += 'Se le capability primarie coprono il task, USARLE invece di reinventare. Se non bastano, dichiarare ESPLICITAMENTE perche' + "'" + ' (non solo "non ho controllato"). Riferimento: docs/tracking/AI_CAPABILITY_ROUTING.json + AGENTS.md "Selezione strumenti".'

$ctx = $lines -join "`n"

Write-HookLog -File $LOG -Message ("Match domains: " + (($matches | ForEach-Object { $_.Domain }) -join ','))

$output = [ordered]@{
    hookSpecificOutput = [ordered]@{
        hookEventName    = 'UserPromptSubmit'
        additionalContext = $ctx
    }
} | ConvertTo-Json -Compress -Depth 5

Write-Output $output
exit 0
