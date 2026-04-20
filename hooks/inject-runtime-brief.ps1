param(
    [Parameter(Mandatory = $true)]
    [string]$HookEventName
)

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

. "$PSScriptRoot\_lib.ps1"

$hook = Read-HookInput
$cwd = Get-HookCwd -HookInput $hook
$runtimeBrief = Get-ProjectRuntimeBrief -Cwd $cwd -MaxLines 120 -MaxChars 4500

if (-not $runtimeBrief) { exit 0 }

$ctx = "### PROJECT_RUNTIME_BRIEF`n$runtimeBrief"

# PreCompact: segnale meccanico di degradazione contesto
if ($HookEventName -eq 'PreCompact') {
    $degradeWarning = @"

### CONTEXT_DEGRADATION_WARNING
Il contesto sta per essere compattato. Segnale meccanico di potenziale degradazione.
Prima del compact:
- Verificare se il task corrente ha ancora copertura completa del requirement ledger
- Se ci sono blocchi aperti o stato critico, valutare context-handoff prima di continuare
- Aggiornare memory e todos se contengono stato che potrebbe perdersi nel compact
"@
    $ctx = $ctx + "`n`n$degradeWarning"
}

# Iniettare rules digest in modo compatto (UserPromptSubmit + PreCompact)
# SessionStart inietta gia' il digest completo, qui basta reminder compatto
$digestReminder = @"

### AI_RULES_DIGEST [compact reminder]
Tu conosci LE REGOLE CANONICHE COMPLETE (caricate da SessionStart via AI_RULES_DIGEST.md).
Ogni modifica deve applicare i 9 livelli proporzionali al task:
- L1: typecheck+lint+test+madge=0 (BLOCKING)
- L2: caller/contratti/test impattati (audit)
- L3: runtime edges, null, leak, failure surface (audit)
- L4: doppia-esecuzione, partial-failure, rollback (audit)
- L5: reachability utente, alert, feedback (audit)
- L6: data-flow end-to-end, SSOT, observability (audit)
- L7: multi-dominio (sicurezza, arch, anti-ban, timing, compliance) — /verification-protocol
- L8: coerenza cross-file (contratti, tipi, docs) — /verification-protocol
- L9: loop finale DONE/BLOCKED — /verification-protocol
Quick-fix=L1-L4 | Bug=L1-L6 | Feature/refactor=L1-L9
Task grande → scomponi in parti, loop su ciascuna, verifica ogni pezzo. Meglio 3 verificate che 5 mezze+rotte.
Ogni file toccato → verificare TUTTI i domini, non solo il principale.
Anti-ban LinkedIn: varianza, sessioni credibili, hesitation non delay precisi, pending ratio, navigazione umana.
"@

$ctx = $ctx + "`n$digestReminder"

Write-HookAdditionalContext -HookEventName $HookEventName -AdditionalContext $ctx
