# ---------------------------------------------------------------------------
# Hook: codex-edit-gate.ps1
# Evento: PreToolUse — matcher: Edit|Write|MultiEdit (Codex)
#
# Combina 3 gate che esistono separatamente in Claude Code ma mancano in Codex:
#   1. ANTI-BAN (block): blocca edit su file sensibili LinkedIn
#   2. SECRETS (block): blocca edit su file di credenziali/key material
#   3. BEST-PRACTICE (advisory): inietta reminder best practice + PATH CRITICO
#
# Strategia: 1 hook x 3 gate invece di 3 hook separati (zero-I: meno duplicazione).
# Riutilizza funzioni di ~/.claude/hooks/_lib.ps1 per coerenza logica con Claude Code.
# ---------------------------------------------------------------------------

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

# Importa single-source of truth da ~/.claude (Test-AntibanFile, Write-HookLog, Write-HookDecision)
$claudeLib = Join-Path $env:USERPROFILE '.claude\hooks\_lib.ps1'
if (Test-Path -LiteralPath $claudeLib) {
    . $claudeLib
    Initialize-HookStrictMode
} else {
    # Fallback: hook deve comunque continuare anche se lib non disponibile
    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'
}

$LOG_DIR = 'C:\Users\albie\memory'

# ---------------------------------------------------------------------------
# 1. PARSE INPUT JSON
# ---------------------------------------------------------------------------
try {
    $stdin = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($stdin)) { exit 0 }
    $payload = $stdin | ConvertFrom-Json -ErrorAction Stop
} catch {
    # JSON non valido: skip silenzioso (l'edit passa)
    exit 0
}

if (-not $payload) { exit 0 }

# ---------------------------------------------------------------------------
# 2. COLLETTA FILE PATH DA MODIFICARE (Edit singolo + MultiEdit + Write)
# ---------------------------------------------------------------------------
$filePaths = @()
if ($payload.tool_input.file_path) {
    $filePaths += [string]$payload.tool_input.file_path
}
if ($payload.tool_input.path) {
    $filePaths += [string]$payload.tool_input.path
}
if ($payload.tool_input.edits) {
    foreach ($edit in $payload.tool_input.edits) {
        if ($edit.file_path) { $filePaths += [string]$edit.file_path }
    }
}

if ($filePaths.Count -eq 0) { exit 0 }

# ---------------------------------------------------------------------------
# 3. GATE BLOCKING: ANTI-BAN + SECRETS
# ---------------------------------------------------------------------------
$SECRET_PATTERN = '(\.env(\.|$)|\.env\..+|secrets?\.json$|credentials?\.json$|service-account.*\.json$|\.pem$|\.key$|\.p12$|\.pfx$|id_rsa|id_ed25519|gcp-key.*\.json$|aws-credentials)'
$antibanLog = Join-Path $LOG_DIR 'antiban-hook-log.txt'
$secretsLog = Join-Path $LOG_DIR 'secrets-hook-log.txt'

foreach ($file in $filePaths) {
    if ([string]::IsNullOrWhiteSpace($file)) { continue }
    $name = [System.IO.Path]::GetFileName($file)

    # 3a. ANTI-BAN HARD-BLOCK (per file LinkedIn sensibili)
    # Nota: Test-AntibanFile è definita in _lib.ps1, se disponinile la usiamo;
    # altrimenti usiamo una regex inline equivalente.
    $isAntiban = $false
    if (Get-Command -Name Test-AntibanFile -ErrorAction SilentlyContinue) {
        $isAntiban = Test-AntibanFile $file
    } else {
        # Fallback inline: whitelist hook dir + esclude docs + pattern LinkedIn
        $whitelistDir = Join-Path $env:USERPROFILE '.claude\hooks\'
        if (-not ($file.StartsWith($whitelistDir, [System.StringComparison]::OrdinalIgnoreCase))) {
            $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
            if ($ext -notin @('.md', '.txt', '.log', '.csv')) {
                $isAntiban = ($file -match 'humanBehavior|antiban|stealth|fingerprint|browser|playwright|timing|delay|session|humanDelay|inputBlock|clickLocator|inviteWorker|inboxWorker|organicContent|syncSearch|syncList|sendInvites|sendMessages|proxy|cookie')
            }
        }
    }

    if ($isAntiban) {
        Write-HookLog -File $antibanLog -Message "ANTIBAN HARD-BLOCK (codex): $file"
        Write-HookDecision -Decision 'deny' -Reason "ANTIBAN [Codex]: file sensibile LinkedIn ($name). Usa Claude Code (ha hook /antiban-review integrato) o dichiara esplicitamente SICURO prima di riprovare."
    }

    # 3b. SECRETS HARD-BLOCK (per .env, key material, credenziali)
    if (($file -match $SECRET_PATTERN) -or ($name -match $SECRET_PATTERN)) {
        # Allow: .example, .sample, test/fixtures
        if ($file -match '\.example$|\.sample$|\\test\\|\\tests\\|\\fixtures\\|/test/|/tests/|/fixtures/') {
            continue
        }
        Write-HookLog -File $secretsLog -Message "SECRETS HARD-BLOCK (codex): $file"
        Write-HookDecision -Decision 'deny' -Reason "SECRETS [Codex]: file di credenziali ($name). Bloccato. Usa l'interfaccia di gestione segreti del provider (Vercel env, Supabase secrets, ecc.), non il file diretto."
    }
}

# ---------------------------------------------------------------------------
# 4. GATE ADVISORY: BEST-PRACTICE + PATH CRITICO
# ---------------------------------------------------------------------------
# Prendi solo il PRIMO file per il reminder (Codex di solito modifica 1 file per edit)
$primaryFile = $filePaths[0]
if ([string]::IsNullOrWhiteSpace($primaryFile)) { exit 0 }

$ext = [System.IO.Path]::GetExtension($primaryFile).ToLowerInvariant()
$categories = @{
    '.ts'         = @{ Cat = 'TypeScript';     Web = 'required';    Notes = 'tipi, async, null safety, tsconfig, breaking changes librerie' }
    '.tsx'        = @{ Cat = 'React/TSX';      Web = 'required';    Notes = 'hooks, rendering, props, a11y, breaking changes React/Next' }
    '.js'         = @{ Cat = 'JavaScript';     Web = 'conditional'; Notes = 'async, module system, compatibilita browser/node' }
    '.mjs'        = @{ Cat = 'ESM';            Web = 'conditional'; Notes = 'import/export, top-level await, compatibilita' }
    '.py'         = @{ Cat = 'Python';         Web = 'required';    Notes = 'typing, async, deps, breaking changes librerie' }
    '.ps1'        = @{ Cat = 'PowerShell';     Web = 'conditional'; Notes = 'encoding, error handling, param binding, execution policy' }
    '.sql'        = @{ Cat = 'SQL/DB';         Web = 'conditional'; Notes = 'indici, transazioni, idempotenza migration, lock' }
    '.json'       = @{ Cat = 'Config/JSON';    Web = 'not-needed';  Notes = 'schema valido, non introdurre campi sconosciuti' }
    '.yaml'       = @{ Cat = 'YAML';           Web = 'conditional'; Notes = 'indentazione, tipi, anchors, compatibilita tool' }
    '.yml'        = @{ Cat = 'YAML';           Web = 'conditional'; Notes = 'indentazione, tipi, anchors, compatibilita tool' }
    '.md'         = @{ Cat = 'Markdown/Doc';   Web = 'not-needed';  Notes = 'un tema per file, summary, no duplicazioni' }
    '.sh'         = @{ Cat = 'Bash/Shell';     Web = 'conditional'; Notes = 'portabilita, quoting, exit code, set -e' }
    '.dockerfile' = @{ Cat = 'Docker';         Web = 'required';    Notes = 'layer cache, security, non-root user, best practice immagine' }
}

$info = $categories[$ext]
if (-not $info) { exit 0 }

# PATH CRITICO: file dove la BP aggiornata è cruciale (anti-ban + security)
$securityPattern = 'auth|security|secret|credential|password|crypto|jwt|oauth|migration|risk'
$isAntiban = $false
if (Get-Command -Name Test-AntibanFile -ErrorAction SilentlyContinue) {
    $isAntiban = Test-AntibanFile $primaryFile
}
$isSecurity = ($primaryFile -match $securityPattern) -and ($ext -notin @('.md', '.txt', '.log', '.csv', '.json'))
$isCritical = $isAntiban -or $isSecurity

$effectiveWeb = $info.Web
if ($isCritical -and $info.Web -ne 'not-needed') { $effectiveWeb = 'required-critical' }

$webLabel = switch ($effectiveWeb) {
    'required-critical' { 'OBBLIGATORIA -- path critico: dichiara ricerca web/docs PRIMA dell''edit' }
    'required'          { 'OBBLIGATORIA' }
    'conditional'       { 'consigliata se la libreria/versione potrebbe essere cambiata' }
    'not-needed'        { 'non necessaria' }
    default             { 'valutare' }
}

$critFlag = if ($isCritical) { if ($isAntiban) { 'anti-ban' } else { 'security' } } else { '' }

$bpLines = @()
$bpLines += "### BEST_PRACTICE_CHECK [Codex] [$($info.Cat)]"
$bpLines += "File: $([System.IO.Path]::GetFileName($primaryFile))"
if ($isCritical) {
    $bpLines += "PATH CRITICO ($critFlag): modifica area ad alto rischio."
}
$bpLines += "Prima di modificare, dichiarare in 1-2 righe:"
$bpLines += "1. Best practice $($info.Cat) applicate: $($info.Notes)"
$bpLines += "2. WebSearch: $webLabel"
$bpLines += "3. Blast radius: file diretti + indiretti (caller, test, docs, registry)"
$bpLines += "Dichiarazione PRIMA del codice. Se gia' dichiarata in questo turno, non ripetere."

$bpLog = Join-Path $LOG_DIR 'best-practice-log.txt'
$logMsg = "BestPractice check (codex): $ext -> $($info.Cat) | web=$effectiveWeb | critical=$isCritical"
Write-HookLog -File $bpLog -Message $logMsg

# Output advisory (non blocca)
$output = [ordered]@{
    hookSpecificOutput = [ordered]@{
        hookEventName     = 'PreToolUse'
        additionalContext = ($bpLines -join "`n")
    }
} | ConvertTo-Json -Compress -Depth 5

Write-Output $output
exit 0
