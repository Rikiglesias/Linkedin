param()

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

. "$PSScriptRoot\_lib.ps1"

# ---------------------------------------------------------------------------
# Hook: user-prompt-skill-precheck.ps1 (UserPromptSubmit)
# Forza dichiarazione esplicita delle skill considerate prima di rispondere.
# Differenza da user-prompt-skill-routing.ps1:
#   - skill-routing dice "valuta queste capability" (mappa dominio -> capability)
#   - skill-precheck dice "DEVI dichiarare quali skill hai letto e perche
#     usarle o no" (enforcement della trasparenza tool selection)
# ---------------------------------------------------------------------------

$LOG = 'C:\Users\albie\memory\skill-precheck-log.txt'

$payload = Read-HookInput
if (-not $payload) { exit 0 }

$prompt = ''
try { $prompt = [string]$payload.prompt } catch {}
if ([string]::IsNullOrWhiteSpace($prompt)) { exit 0 }

# Skip per prompt molto brevi (<25 char): chat triviale, no enforcement
if ($prompt.Trim().Length -lt 25) { exit 0 }

$promptLower = $prompt.ToLowerInvariant()

# Skip se il prompt e meta-conversazione (ringraziamento, conferma, status)
$metaPatterns = @('^(ok|grazie|perfetto|si|no|ciao|stop|continua|vai|procedi|bene|capito)\b', '^/[a-z-]+\s*$')
foreach ($mp in $metaPatterns) {
    if ($promptLower -match $mp) { exit 0 }
}

# Trigger semantici per task che RICHIEDONO skill check
$triggerPatterns = @(
    'implementa', 'aggiungi', 'crea', 'fix', 'bug', 'errore', 'risolvi',
    'refactor', 'modifica', 'cambia', 'aggiorna', 'review', 'audit',
    'verifica', 'controlla', 'analizza', 'debug', 'test', 'commit', 'push',
    'workflow', 'hook', 'skill', 'antiban', 'linkedin', 'database', 'query',
    'api', 'endpoint', 'integra', 'deploya', 'ottimizza'
)

$matched = $false
foreach ($t in $triggerPatterns) {
    if ($promptLower -match ('\b' + [regex]::Escape($t))) {
        $matched = $true
        break
    }
}

if (-not $matched) { exit 0 }

$lines = @()
$lines += '### SKILL_PRECHECK [hook automatico - L2 enforcement]'
$lines += 'Task non triviale. PRIMA di scrivere codice o lanciare comandi, dichiarare in modo esplicito (non implicito):'
$lines += '1. Skill considerate: quali nomi (es. /debugging-wizard, /typescript-pro, antiban-review, /verification-protocol)'
$lines += '2. Skill scelta + perche, oppure perche NESSUNA skill copre il task'
$lines += '3. MCP attivati (es. supabase, code-review-graph, lean-ctx, n8n) o motivo per cui non servono'
$lines += '4. Web/docs ufficiali letti se il task tocca librerie/API/provider/anti-ban'
$lines += ''
$lines += 'La dichiarazione va in 2-4 righe MAX a inizio risposta. Saltarla = violazione regola "Selezione strumenti" di AGENTS.md. Se l ultimo messaggio era una continuazione (vai/procedi/ok), riferirsi alla dichiarazione del turno precedente.'

$ctx = $lines -join "`n"

Write-HookLog -File $LOG -Message ("Trigger match in prompt: " + $prompt.Substring(0, [Math]::Min(60, $prompt.Length)))

$output = [ordered]@{
    hookSpecificOutput = [ordered]@{
        hookEventName    = 'UserPromptSubmit'
        additionalContext = $ctx
    }
} | ConvertTo-Json -Compress -Depth 5

Write-Output $output
exit 0
