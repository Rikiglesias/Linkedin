param(
    [string]$EventName = "UserPromptSubmit"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$RuntimeBriefPath = Join-Path $RepoRoot "docs\AI_RUNTIME_BRIEF.md"
$ContractPath = Join-Path $RepoRoot "docs\tracking\AI_ORCHESTRATOR_CONTRACT.md"
$ContinuationPath = Join-Path $RepoRoot ".claude\CONTINUATION.md"
$ParityMatrixPath = Join-Path $RepoRoot "docs\PARITY_MATRIX.md"
$MemoryDir = Join-Path $env:USERPROFILE "memory"

# === SEZIONE 1: PRINCIPI COMPORTAMENTALI (P0 + DIPENDENTE + SPINGITI OLTRE) ===
$behavioralLines = @(
    "=== CODEX_BEHAVIOR [principi operativi] ===",
    "- MINDSET DIPENDENTE: lavora come dipendente pagato, proprietario del progetto al 100%.",
    "- SPINGITI OLTRE: non fermarti al letterale. Esplora Tutte le opzioni, capisci il potenziale,",
    "  aggiungi valore con cose in più non chieste ma utili. Lavora di testa tua, vedi ampio.",
    "- P0: intento reale > input letterale > esempi come pattern > decomposizione ricorsiva",
    "  > visione 360 > root cause > fonte/capability/verifica > continuità proattiva.",
    "- Decomposizione: argomento → albero → sottopunti → sotto-sottopunti; per ogni ramo rivaluta",
    "  fonte, web/MCP, skill, rischi, verifiche, done criteria. Non fermarti alla superficie.",
    "- Domanda guida: lo consegneresti cosi al capo che ti paga?"
)

# === SEZIONE 2: ROUTING DOMINIO (semplificato, senza JSON registry) ===
# Codex non ha skill-activation.ps1, quindi iniettiamo routing testuale
$domainLines = @(
    "=== CODEX_ROUTING [dominio + capacità] ===",
    "- Linkedin-touch (src/browser, src/risk, src/salesnav, proxy, fingerprint) → OBBLIGATORIO Claude Code.",
    "- Modifica codice: blast radius file diretti+indiretti, contratti, test, docs. L2-L9 proporzionati.",
    "- Cross-domain per ogni file: sicurezza, architettura, anti-ban, timing, compliance, observability.",
    "- WebSearch obbligatorio: librerie/API/best-practice esterne, anti-ban pattern, policy LinkedIn.",
    "- MCP disponibili (Codex): code-review-graph, symdex. Altri (Supabase, Playwright, Semgrep, n8n, Gmail, Calendar, Drive) solo in Claude Code."
)

# === SEZIONE 3: MODEL SUGGESTION (adattivo) ===
$modelLines = @()
$prompt = $null
try {
    $input = $host.UI.RawUI.ReadStreamBufferContents(4096)
    if ($input) { $prompt = [System.Text.Encoding]::UTF8.GetString($input) }
} catch {}

if ($prompt) {
    $promptLower = $prompt.ToLower()
    $suggestion = $null

    # Pattern task → modello
    if ($promptLower -match "linkedin|anti-?ban|proxy|stealth|account") {
        $suggestion = "Opus (ragionamento profondo su sicurezza + anti-ban)"
    }
    elseif ($promptLower -match "refactor|architett|pianific|strateg") {
        $suggestion = "Opus (ragionamento profondo per decisioni architetturali)"
    }
    elseif ($promptLower -match "bug|error|debug|fix") {
        $suggestion = "Sonnet (coding standard + investigation)"
    }
    elseif ($promptLower -match "bulk|migrazion|conversion|batch") {
        $suggestion = "Haiku (costo basso, compito ripetitivo)"
    }
    elseif ($promptLower -match "multimodal|image|screenshot|ocr") {
        $suggestion = "Sonnet (vision nativa) o Gemini via OpenRouter"
    }
    elseif ($promptLower -match "audit|review|analisi") {
        $suggestion = "Opus (ragionamento approfondito + cross-domain)"
    }

    if ($suggestion) {
        $modelLines = @(
            "=== CODEX_MODEL [suggerimento adattivo] ===",
            "- Task rilevato: modello suggerito = $suggestion",
            "- Conferma con utente se task ad alto rischio (anti-ban, sicurezza, produzione)."
        )
    }
}

# === SEZIONE 4: CARICAMENTO MEMORIA (chiusura GAP-1) ===
$memoryLines = @()
if (Test-Path $MemoryDir) {
    $memoryLines += "=== CODEX_MEMORY [caricamento memoria globale] ==="
    $memoryLines += "- MEMORIA GLOBALE PRESENTE: $MemoryDir"
    $memoryLines += "- Leggi PRIMA di agire: user.md, personality.md, preferences.md, decisions.md"
    $memoryLines += "- Aggiorna dopo decisioni importanti (salvare in: $MemoryDir/)"

    # Lista file memoria disponibili (top 10 per non esagerare)
    $memoryFiles = Get-ChildItem -Path $MemoryDir -Filter "*.md" -File | Select-Object -First 10 -ExpandProperty Name
    if ($memoryFiles) {
        $memoryLines += "- File disponibili: $($memoryFiles -join ', ')"
    }
} else {
    $memoryLines += "=== CODEX_MEMORY [AVVERTIMENTO] ==="
    $memoryLines += "- Memoria globale NON trovata in: $MemoryDir"
    $memoryLines += "- Codex parte senza contesto utente (profilo, decisioni, feedback)."
}

# === SEZIONE 5: PARITY MATRIX AWARENESS ===
$parityLines = @()
if (Test-Path $ParityMatrixPath) {
    $parityLines = @(
        "=== CODEX_PARITY [limiti ambiente] ===",
        "- PARITY MATRIX: $ParityMatrixPath",
        "- Codex GAP critici: PreToolUse Edit (0 hook), memoria non auto-caricata,",
        "  post-edit hygiene assente, sync Obsidian non configurato.",
        "- Per Linkedin-touch o task sensibili: MIGRA a Claude Code.",
        "- Audit portabili: usa 'npm run audit:*' che funzionano in Codex."
    )
}

# === SEZIONE 6: OBSIDIAN SYNC AWARENESS ===
$obsidianLines = @(
    "=== CODEX_OBSIDIAN [sincronizzazione vault] ===",
    "- Vault Obsidian: C:\Users\albie\Desktop\AI brain\ (PARA + Bases + 47 note)",
    "- START-HERE.md: leggi questo per ripartire completo",
    "- Sync memoria: manuale (Codex non ha hook Stop auto-sync)",
    "- Per aggiornare vault dopo modifiche importanti: esegui 'npm run sync:obsidian'"
)

# === ASSEMBLA TUTTO IL CONTESTO ===
$contextLines = @(
    "AI_ORCHESTRATOR_CONTEXT [$EventName]",
    ""
) + $behavioralLines + @(
    ""
) + $domainLines + @(
    ""
) + $modelLines + @(
    ""
) + $memoryLines + @(
    ""
) + $parityLines + @(
    ""
) + $obsidianLines + @(
    "",
    "=== CODEX_OPERATIVO [contratti + chiusura] ===",
    "- Applica docs/tracking/AI_ORCHESTRATOR_CONTRACT.md prima di pianificare o modificare.",
    "- Prima di dichiarare DONE: prove, audit/test, limiti residui, prossimo passo esatto.",
    "- Per modifiche: blast radius, file diretti/indiretti, L2-L9 proporzionati, cross-domain.",
    "- Interpreta intento reale, input come ipotesi, esempi come pattern, decomposizione ricorsiva."
)

# === AGGIUNGI PATH FILE PRESENTI (riferimenti) ===
if (Test-Path $RuntimeBriefPath) {
    $contextLines += "- Runtime brief: $RuntimeBriefPath"
}

if (Test-Path $ContractPath) {
    $contextLines += "- Contratto orchestrator: $ContractPath"
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
