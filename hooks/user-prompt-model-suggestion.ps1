param()

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

. "$PSScriptRoot\_lib.ps1"

# ---------------------------------------------------------------------------
# Hook: user-prompt-model-suggestion.ps1 (UserPromptSubmit)
# Classifica il task e forza una raccomandazione modello in base alla
# matrice AGENTS.md "Selezione modello AI per task". Non dimenticabile.
# ---------------------------------------------------------------------------

$LOG = 'C:\Users\albie\memory\model-suggestion-log.txt'

$payload = Read-HookInput
if (-not $payload) { exit 0 }

$prompt = ''
try { $prompt = [string]$payload.prompt } catch {}
if ([string]::IsNullOrWhiteSpace($prompt)) { exit 0 }

# Stato modello attivo
$activeModel = ''
try {
    $statePath = 'C:\Users\albie\.claude\model-router-state.json'
    if (Test-Path -LiteralPath $statePath) {
        $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
        $activeModel = [string]$state.liveModel
        if ([string]::IsNullOrWhiteSpace($activeModel)) { $activeModel = [string]$state.persistedDefaultModel }
    }
} catch {}
if ([string]::IsNullOrWhiteSpace($activeModel)) { $activeModel = 'opusplan' }

$p = $prompt.ToLowerInvariant()

# Classificazione task → modello consigliato (specchio della matrice AGENTS.md)
$rules = @(
    @{ Pattern = 'plan mode|architettura|architectur|refactor cross|design|blast radius'; Recommended = 'opus o opusplan'; Reason = 'reasoning profondo, decisione architetturale' },
    @{ Pattern = 'anti.?ban|stealth|fingerprint|migration db|sicurezza|security|auth|payment|production'; Recommended = 'opus o sonnet (Anthropic)'; Reason = 'area ad alto rischio — provider tracciabile' },
    @{ Pattern = 'bulk|batch|conversione|migrazione boilerplate|ripetitivo|massa'; Recommended = 'glm o qwen (OpenRouter)'; Reason = 'task ripetitivo a basso costo' },
    @{ Pattern = 'screenshot|immagine|visione|playwright debug|ocr|multimodale'; Recommended = 'gemini (OpenRouter) o sonnet'; Reason = 'task multimodale' },
    @{ Pattern = 'lookup|cerca|trova rapidamente|comando shell|risposta secca|veloce'; Recommended = 'haiku (Anthropic) o kimi/glm'; Reason = 'latenza/costo minimi' },
    @{ Pattern = 'loop|polling|babysitting|overnight|autonomo'; Recommended = 'haiku o glm/kimi (OpenRouter)'; Reason = 'costo per iterazione basso' },
    @{ Pattern = 'documenta|prosa|traduzione|regola canonica|scrivi docs'; Recommended = 'sonnet (Anthropic)'; Reason = 'coerenza linguistica' },
    @{ Pattern = 'feature|bug|fix|implement|coding'; Recommended = 'sonnet (Anthropic)'; Reason = 'default coding bilanciato' }
)

$match = $null
foreach ($r in $rules) {
    if ($p -match $r.Pattern) { $match = $r; break }
}

if (-not $match) { exit 0 }

# Verifica se modello attivo gia' coerente — niente raccomandazione rumorosa
$activeLower = $activeModel.ToLowerInvariant()
$recLower = $match.Recommended.ToLowerInvariant()

# Se gia' allineato non emettere nulla
if ($recLower -match $activeLower -or $activeLower -match 'opusplan' -and $recLower -match 'opus|sonnet') {
    Write-HookLog -File $LOG -Message ("Skip suggestion: active=$activeModel coerente con rec=$($match.Recommended)")
    exit 0
}

$lines = @()
$lines += '### MODEL_SUGGESTION [hook automatico - valutare prima di iniziare]'
$lines += ('- Modello attivo: **' + $activeModel + '**')
$lines += ('- Raccomandato per questo task: **' + $match.Recommended + '**')
$lines += ('- Motivo: ' + $match.Reason)
$lines += "Se il modello attivo non e' adeguato, suggerire all'utente lo switch via /model <alias> e dichiarare il trade-off. Riferimento: AGENTS.md sezione 'Selezione modello AI per task'."

$ctx = $lines -join "`n"

Write-HookLog -File $LOG -Message ("Suggested $($match.Recommended) for active=$activeModel; pattern=$($match.Pattern)")

$output = [ordered]@{
    hookSpecificOutput = [ordered]@{
        hookEventName    = 'UserPromptSubmit'
        additionalContext = $ctx
    }
} | ConvertTo-Json -Compress -Depth 5

Write-Output $output
exit 0
