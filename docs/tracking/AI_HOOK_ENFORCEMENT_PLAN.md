# AI Hook Enforcement Plan

> Aggiornato: 2026-05-09.
> Scopo: decidere quanti hook servono davvero, quali regole devono diventare hook e quali devono restare skill/audit/documentazione.

## Principio

Non ogni regola deve diventare hook. Un hook serve quando il controllo e' deterministico, ha un trigger chiaro e puo' prevenire o registrare un errore reale.

Regola pratica:
- **blocking hook**: azione ad alto rischio prima che accada
- **sync advisory hook**: contesto che il modello deve vedere prima di ragionare
- **async hook**: log, audit, metriche e segnali post-azione
- **script/audit**: controllo deterministico eseguibile a comando o in CI
- **skill**: workflow cognitivo non deterministico che richiede ragionamento
- **n8n/workflow**: automazione durevole con stato, schedule o integrazione esterna

## Hook minimi necessari oggi

| Evento | Hook | Tipo | Stato | Motivo |
|---|---|---|---|---|
| `SessionStart` | `ensure-claude-model-router.ps1` | sync context | attivo | Mantiene disponibile il router modello/provider. |
| `SessionStart` | `merge-canonical-settings.mjs` | sync config | attivo | Riallinea settings canonici prima della sessione. |
| `SessionStart` | `session-start.ps1` | sync context | attivo | Carica memoria, todos, runtime brief e contesto progetto. |
| `SessionStart` | `session-start-continuation.ps1` | sync context | attivo | Reinietta continuita' della sessione precedente se presente. |
| `UserPromptSubmit` | `ensure-claude-model-router.ps1` | sync config | attivo | Mantiene coerente provider/modello a ogni prompt. |
| `UserPromptSubmit` | `inject-runtime-brief.ps1` | sync context | attivo | Reinietta gerarchia P0 e regole critiche prima di ogni prompt. |
| `UserPromptSubmit` | `skill-activation.ps1` | sync advisory | attivo | Propone gerarchia P0 compatta, decomposizione ricorsiva, chiusura proattiva, fonte di verita', skill/MCP/web/loop e livelli L2-L9. |
| `UserPromptSubmit` | `multi-file-recap-check.ps1` | sync advisory | attivo | Ricorda recap per task multi-file o complessi. |
| `UserPromptSubmit` | `user-prompt-model-suggestion.ps1` | sync advisory | attivo | Suggerisce modello/ambiente adatto al task. |
| `UserPromptSubmit` | `pre-edit-verify-intent.ps1` | sync advisory | attivo | Impone verifica del codice reale prima di fix/correzioni. |
| `UserPromptSubmit` | `user-prompt-commit-gate.ps1` | sync advisory | attivo | Re-inietta pending dirty/commit gate dalla sessione precedente. |
| `PreToolUse Edit/Write/MultiEdit` | `pre-edit-antiban.ps1` | blocking | attivo | Blocca file LinkedIn sensibili senza review anti-ban. |
| `PreToolUse Edit/Write/MultiEdit` | `pre-edit-secrets.ps1` | blocking | attivo | Blocca scrittura di segreti o file sensibili. |
| `PreToolUse Edit/Write/MultiEdit` | `pre-edit-best-practice.ps1` | blocking/advisory | attivo | Impone check minimo prima di edit rischiosi. |
| `PreToolUse Bash` | `pre-bash-l1-gate.ps1` | blocking | attivo | Blocca commit senza quality gate recente. |
| `PreToolUse Bash` | `pre-bash-git-gate.ps1` | blocking | attivo | Blocca commit/push con stato git non coerente. |
| `PreToolUse mcp__.*` | `pre-mcp-guard.ps1` | blocking/advisory | attivo | Evita uso MCP fuori contesto o con rischio non valutato. |
| `PostToolUse Bash` | `post-bash-quality-log.ps1` | async log | attivo | Traccia comandi di qualita'. |
| `PostToolUse Bash` | `post-bash-git-audit.ps1` | async audit | attivo | Traccia readiness git dopo gate/commit/push. |
| `PostToolUse WebSearch` | `post-websearch-log.ps1` | async log | attivo | Traccia uso web quando richiesto da policy. |
| `PostToolUse Edit/Write/MultiEdit` | `file-size-check.ps1` | async audit | attivo | Segnala file troppo lunghi da splittare. |
| `PostToolUse Edit/Write/MultiEdit` | `post-edit-antiban-audit.ps1` | async audit | attivo | Traccia possibili miss anti-ban. |
| `PostToolUse Edit/Write/MultiEdit` | `post-edit-request-action.ps1` | async gated action | attivo | Esegue commit/push solo su trigger esplicito e dopo gate. |
| `PostToolUse Edit/Write/MultiEdit` | `post-edit-verify-checklist.ps1` | sync advisory | attivo | Richiede check L2-L6 dichiarativo dopo edit codice. |
| `PostToolUse Edit/Write/MultiEdit` | `post-edit-codebase-hygiene.ps1` | sync advisory | attivo | Richiede valutazione pulizia codebase su file diretti/indiretti dopo ogni edit. |
| `PreCompact` | `inject-runtime-brief.ps1` | sync context | attivo | Ricorda regole critiche prima del compact. |
| `PreCompact` | `pre-compact-handoff.ps1` | blocking/context | attivo | Forza handoff quando il contesto sta degradando. |
| `Stop` | `stop-session.ps1` | async audit | attivo | Log sessione, memory/worklog warnings. |
| `Stop` | `pre-stop-commit-gate.ps1` | sync advisory/block | attivo | Evita chiusura silenziosa con blocco tecnico lasciato aperto. |
| `Stop` | `stop-proactive-next-step.ps1` | sync advisory | attivo | Reinietta obbligo di prossimo passo concreto, blocco reale o domanda specifica alla chiusura. |
| `SubagentStop` | `subagent-stop.ps1` | async log | attivo | Traccia output subagent. |
| `TaskCreated/TaskCompleted/TeammateIdle` | `teammate-event.ps1` | async log | attivo | Traccia agent teams. |

Totale operativo attuale: **34 command hook configurati** distribuiti su eventi Claude Code. Non vanno aumentati senza miss ricorrenti misurati o senza un advisory ad alto valore che renda visibile un miss sistemico.

## Regole che devono restare hook

- Anti-ban su file browser/timing/stealth/sessione/LinkedIn.
- Segreti e file sensibili.
- Git commit/push readiness.
- Quality gate prima di commit.
- Runtime brief su prompt e compact.
- Context degradation prima del compact.
- Logging qualita', git, web search, file size, agent teams.

## Regole che NON devono diventare hook blocking

- "Ragiona meglio" in generale: non e' deterministico. La parte stabile vive nella gerarchia P0 del runtime brief, non in un deny hook.
- "Usa best practice" senza dominio: va in runtime brief + routing + skill.
- "Capisci esempi come pattern": va in runtime brief + ledger + reminder `skill-activation.ps1`, non in deny hook.
- "Apri l'argomento in sottopunti": va in runtime brief + ledger + reminder `skill-activation.ps1`; diventa auditabile tramite coverage del ledger, non tramite deny hook semantico.
- "Dare sempre continuita'": va in runtime brief + checklist finale + reminder `skill-activation.ps1` + `Stop` hook `stop-proactive-next-step.ps1`; diventa blocking solo se emerge un pattern verificabile di false completion.
- "Usa loop quando serve": va in routing advisory + skill `loop-codex`, non in blocking hook generico.
- "Fai blast radius completo": va in L2-L6 audit-assisted, code search e review; blocking solo se emerge un pattern verificabile.

## Errori/gap emersi il 2026-05-07

- Audit hook troppo rigidi: cercavano solo `-HookEventName`, mentre il comando reale usa argomento posizionale valido.
- `AI_RUNTIME_BRIEF.md` troppo corto: mancavano ledger, esempi come pattern, web policy, capability gap, no hallucination e chiusura.
- `context-handoff` mancante in `~/.claude/skills`, anche se citata come skill critica.
- Routing registry non accettava capability `agent`/`cli` e fonte `session-state`.
- Routing registry referenziava `context-handoff` e `session-prompt` senza capability corrispondente.

## Prossima promozione possibile

Promuovere da advisory a blocking solo se i log mostrano miss ricorrenti:
- L2-L6 ignorati su modifiche multi-file.
- Web/docs saltati su API/provider/best practice aggiornabili.
- Skill/MCP evidente non proposta dal routing advisory.
- False completion dopo edit senza test o senza ledger coverage.

Fonte di misura: `audit:violations`, `audit:rule-enforcement`, `audit:hooks`, `audit:ai-control-plane`, `audit:ledger`, `audit:routing`, log in `~/memory/`.

## Correzione sicurezza auto-commit del 2026-05-07

`post-edit-request-action.ps1` e' stato corretto per non bypassare i gate:

- non usa piu' `git add .`
- non usa piu' `--no-verify`
- richiede `npm run post-modifiche`
- richiede `npm run audit:git-automation:strict:commit`
- richiede `npm run audit:git-automation:strict:push` prima del push

`audit:hooks` ora controlla tutti i 34 command hook attivi, non solo il vecchio sottoinsieme da 14.
