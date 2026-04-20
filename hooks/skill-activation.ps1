param()

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

. "$PSScriptRoot\_lib.ps1"

function Read-JsonFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try {
        return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 -ErrorAction Stop) | ConvertFrom-Json -ErrorAction Stop
    } catch {
        return $null
    }
}

function Normalize-Text {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return '' }
    return $Text.ToLowerInvariant()
}

function Get-UniqueStrings {
    param([string[]]$Values)
    $seen = @{}
    $output = New-Object System.Collections.Generic.List[string]
    foreach ($value in $Values) {
        if ([string]::IsNullOrWhiteSpace($value)) { continue }
        if (-not $seen.ContainsKey($value)) {
            $seen[$value] = $true
            $output.Add($value) | Out-Null
        }
    }
    return @($output)
}

function Get-PatternScore {
    param(
        [string]$Prompt,
        [object[]]$Patterns
    )
    $score = 0
    foreach ($pattern in $Patterns) {
        $patternText = [string]$pattern
        if ([string]::IsNullOrWhiteSpace($patternText)) { continue }
        try {
            if ($Prompt -match $patternText) {
                $score++
            }
        } catch {}
    }
    return $score
}

function Get-TaskClass {
    param([string]$Prompt)
    if ($Prompt -match 'quick[\s-]?fix|piccolo fix|one[\s-]?liner|one liner|typo|rename|docs[\s-]?only|solo docs|hotfix piccolo') {
        return 'quick-fix'
    }
    if ($Prompt -match '\bbug\b|errore|crash|broken|fix\b|stack trace|traceback|failure|fail|regression|rott') {
        return 'bug'
    }
    return 'feature/refactor'
}

function Get-WebPolicy {
    param([object[]]$Domains)
    if ($Domains | Where-Object { $_.webPolicy -eq 'required' }) { return 'required' }
    if ($Domains | Where-Object { $_.webPolicy -eq 'conditional' }) { return 'conditional' }
    return 'not-needed'
}

function Get-PreferredEnvironment {
    param([object[]]$Domains)
    if (-not $Domains -or $Domains.Count -eq 0) { return 'either' }
    $first = [string]$Domains[0].preferredEnvironment
    $allSame = $true
    foreach ($domain in $Domains) {
        if ([string]$domain.preferredEnvironment -ne $first) {
            $allSame = $false
            break
        }
    }
    if ($allSame) { return $first }
    return $first
}

function Get-AvoidCapabilities {
    param(
        [object[]]$Domains,
        [string]$WebPolicy
    )
    $avoid = New-Object System.Collections.Generic.List[string]
    if ($WebPolicy -eq 'not-needed') {
        $avoid.Add('ricerca web non necessaria') | Out-Null
    }
    foreach ($domain in $Domains) {
        switch ([string]$domain.domainId) {
            'external-live-state' {
                $avoid.Add('repo come fonte di stato live') | Out-Null
                $avoid.Add('web come sostituto dello stato reale') | Out-Null
            }
            'n8n-orchestration' {
                $avoid.Add('json n8n del repo come prova di stato live') | Out-Null
            }
            'recent-library-provider' {
                $avoid.Add('knowledge cutoff senza docs ufficiali') | Out-Null
            }
        }
    }
    $unique = Get-UniqueStrings -Values $avoid.ToArray()
    if ($unique.Count -eq 0) { return @() }
    return @($unique | Select-Object -First 3)
}

function Join-First {
    param(
        [string[]]$Values,
        [int]$Max = 3
    )
    $unique = Get-UniqueStrings -Values $Values
    if ($unique.Count -eq 0) { return '' }
    return (($unique | Select-Object -First $Max) -join ', ')
}

$hook = Read-HookInput
if (-not $hook) { exit 0 }

$prompt = ''
if ($hook.prompt) {
    $prompt = Normalize-Text -Text ([string]$hook.prompt)
}
if ([string]::IsNullOrWhiteSpace($prompt)) { exit 0 }

# Rilevamento segnali di chiusura task (per reminder L7-L9)
$closingKeywords = @('fatto', 'completato', 'finito', 'chiudi', 'done', 'chiuso', 'fine', 'concludi', 'merge', 'commit', 'chiudiamo', 'possiamo chiudere')
$isClosingSignal = $false
foreach ($kw in $closingKeywords) {
    if ($prompt -match "\b$([regex]::Escape($kw))\b") {
        $isClosingSignal = $true
        break
    }
}

$cwd = Get-HookCwd -HookInput $hook
if ([string]::IsNullOrWhiteSpace($cwd)) { exit 0 }

$routingPath = Join-Path $cwd 'docs\tracking\AI_CAPABILITY_ROUTING.json'
$levelPath = Join-Path $cwd 'docs\tracking\AI_LEVEL_ENFORCEMENT.json'

$routingRegistry = Read-JsonFile -Path $routingPath
$levelRegistry = Read-JsonFile -Path $levelPath
if (-not $routingRegistry -or -not $levelRegistry) { exit 0 }

$taskClass = Get-TaskClass -Prompt $prompt
$matches = New-Object System.Collections.Generic.List[object]
$index = 0
foreach ($domain in $routingRegistry.domains) {
    $score = Get-PatternScore -Prompt $prompt -Patterns $domain.intentPatterns
    if ($score -ge 2) {
        $matches.Add([pscustomobject]@{
            Index = $index
            Score = $score
            Domain = $domain
        }) | Out-Null
    }
    $index++
}

$matched = @($matches | Sort-Object @{Expression = 'Score'; Descending = $true }, @{Expression = 'Index'; Descending = $false } | Select-Object -First 3)
$matchedDomains = @($matched | ForEach-Object { $_.Domain })
$webPolicy = Get-WebPolicy -Domains $matchedDomains
$preferredEnvironment = Get-PreferredEnvironment -Domains $matchedDomains
$focusLevels = @($levelRegistry.levels | Where-Object { $_.appliesTo -contains $taskClass })
$capabilityById = @{}
foreach ($capability in $routingRegistry.capabilities) {
    $capabilityById[[string]$capability.id] = [string]$capability.label
}

$sourceOfTruth = @($matchedDomains | ForEach-Object { [string]$_.sourceOfTruth })
$useCapabilities = @($matchedDomains | ForEach-Object { $_.primaryCapabilities } | ForEach-Object { [string]$_ })
$avoidCapabilities = Get-AvoidCapabilities -Domains $matchedDomains -WebPolicy $webPolicy
$focusSummary = @($focusLevels | ForEach-Object { "{0} {1}" -f $_.level, ($_.advisoryPrompt -replace '^L\d:\s*', '') })
$avoidSummary = Join-First -Values @($avoidCapabilities) -Max 3
if ([string]::IsNullOrWhiteSpace($avoidSummary)) {
    $avoidSummary = 'nessuna esclusione forte'
}

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('### PROJECT_ROUTING_DECISION') | Out-Null
$lines.Add("Task class: $taskClass") | Out-Null

if ($matchedDomains.Count -eq 0) {
    $lines.Add('Capability gap: routing non affidabile, non proporre capability inventate') | Out-Null
    $lines.Add("L2-L9 focus: $(Join-First -Values $focusSummary -Max 9)") | Out-Null
    Write-HookAdditionalContext -HookEventName 'UserPromptSubmit' -AdditionalContext ($lines -join "`n")
}

$lines.Add("Domains: $(Join-First -Values @($matchedDomains | ForEach-Object { [string]$_.domainId }))") | Out-Null
$lines.Add("Source of truth: $(Join-First -Values @($sourceOfTruth) -Max 3)") | Out-Null
$lines.Add("Web/docs: $webPolicy") | Out-Null
$lines.Add("Capabilities da usare: $(Join-First -Values @($useCapabilities | ForEach-Object { if ($capabilityById.ContainsKey($_)) { $capabilityById[$_] } else { $_ } }) -Max 3)") | Out-Null
$lines.Add("Capabilities da non usare: $avoidSummary") | Out-Null
$lines.Add("Preferred environment: $preferredEnvironment") | Out-Null
$lines.Add("L2-L9 focus: $(Join-First -Values $focusSummary -Max 9)") | Out-Null

if ($isClosingSignal -and $taskClass -ne 'quick-fix') {
    $lines.Add("⚠️ TASK IN CHIUSURA: invocare /verification-protocol (L7-L9) prima di dichiarare DONE.") | Out-Null
}

Write-HookAdditionalContext -HookEventName 'UserPromptSubmit' -AdditionalContext ($lines -join "`n")
