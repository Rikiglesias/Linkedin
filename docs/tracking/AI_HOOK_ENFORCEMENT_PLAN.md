# AI Hook Enforcement Plan

> Aggiornato: 2026-06-02.
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

| Evento                                   | Hook                              | Tipo                | Stato                         | Motivo                                                                                                                                                                                                  |
| ---------------------------------------- | --------------------------------- | ------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionStart`                           | `ensure-claude-model-router.ps1`  | sync context        | condizionale (unified router) | Mantiene disponibile il router modello/provider; aggiunto solo quando `ANTHROPIC_BASE_URL=http://127.0.0.1:4319`. In modalita' Anthropic nativo viene filtrato via da `applyManagedClaudeCodeSettings`. |
| `SessionStart`                           | `merge-canonical-settings.mjs`    | sync config         | attivo                        | Riallinea settings canonici prima della sessione.                                                                                                                                                       |
| `SessionStart`                           | `session-start.ps1`               | sync context        | attivo                        | Carica memoria, todos, runtime brief e contesto progetto.                                                                                                                                               |
| `SessionStart`                           | `session-start-continuation.ps1`  | sync context        | attivo                        | Reinietta continuita' della sessione precedente se presente.                                                                                                                                            |
| `UserPromptSubmit`                       | `ensure-claude-model-router.ps1`  | sync config         | condizionale (unified router) | Mantiene coerente provider/modello a ogni prompt; attivo solo in unified router mode, filtrato in modalita' Anthropic nativo.                                                                           |
| `UserPromptSubmit`                       | `inject-runtime-brief.ps1`        | sync context        | attivo                        | Reinietta gerarchia P0 e regole critiche prima di ogni prompt.                                                                                                                                          |
| `UserPromptSubmit`                       | `skill-activation.ps1`            | sync advisory       | attivo                        | Propone gerarchia P0 compatta, decomposizione ricorsiva, chiusura proattiva, fonte di verita', skill/MCP/web/loop e livelli L2-L9.                                                                      |
| `UserPromptSubmit`                       | `multi-file-recap-check.ps1`      | sync advisory       | attivo                        | Ricorda recap per task multi-file o complessi.                                                                                                                                                          |
| `UserPromptSubmit`                       | `user-prompt-session-advisor.ps1` | sync advisory       | attivo                        | Dichiara modello attivo + ideale per il task, e se conviene chat nuova usando transcript + token/crediti Codex.                                                                                          |
| `UserPromptSubmit`                       | `turn-governor-hook.ps1`          | sync advisory       | attivo                        | Inietta `Ho capito`, prompt optimizer, automatico-vs-chiedi, hygiene, recap mid-chat, fine turno e `TOKEN_COST_CHAT_SWITCH`.                                                                             |
| `UserPromptSubmit`                       | `token-cost-context.ps1`          | sync advisory       | attivo                        | Inietta obbligo `Costo:` e ultimo stato costo/crediti da ledger Claude + token_count Codex, senza prompt o segreti.                                                                                      |
| `UserPromptSubmit`                       | `pre-edit-verify-intent.ps1`      | sync advisory       | attivo                        | Impone verifica del codice reale prima di fix/correzioni.                                                                                                                                               |
| `UserPromptSubmit`                       | `user-prompt-commit-gate.ps1`     | sync advisory       | attivo                        | Re-inietta pending dirty/commit gate dalla sessione precedente.                                                                                                                                         |
| `PreToolUse Edit/Write/MultiEdit`        | `pre-edit-antiban.ps1`            | blocking            | attivo                        | Blocca file LinkedIn sensibili senza review anti-ban.                                                                                                                                                   |
| `PreToolUse Edit/Write/MultiEdit`        | `pre-edit-secrets.ps1`            | blocking            | attivo                        | Blocca scrittura di segreti o file sensibili.                                                                                                                                                           |
| `PreToolUse Edit/Write/MultiEdit`        | `pre-edit-best-practice.ps1`      | blocking/advisory   | attivo                        | Impone check minimo prima di edit rischiosi.                                                                                                                                                            |
| `PreToolUse Bash`                        | `pre-bash-l1-gate.ps1`            | blocking            | attivo                        | Blocca commit senza quality gate recente.                                                                                                                                                               |
| `PreToolUse Bash`                        | `pre-bash-git-gate.ps1`           | blocking            | attivo                        | Blocca commit/push con stato git non coerente.                                                                                                                                                          |
| `PreToolUse mcp__.*`                     | `pre-mcp-guard.ps1`               | blocking/advisory   | attivo                        | Evita uso MCP fuori contesto o con rischio non valutato.                                                                                                                                                |
| `PostToolUse Bash`                       | `post-bash-quality-log.ps1`       | async log           | attivo                        | Traccia comandi di qualita'.                                                                                                                                                                            |
| `PostToolUse Bash`                       | `post-bash-git-audit.ps1`         | async audit         | attivo                        | Traccia readiness git dopo gate/commit/push.                                                                                                                                                            |
| `PostToolUse WebSearch`                  | `post-websearch-log.ps1`          | async log           | attivo                        | Traccia uso web quando richiesto da policy.                                                                                                                                                             |
| `PostToolUse Edit/Write/MultiEdit`       | `file-size-check.ps1`             | async audit         | attivo                        | Segnala file troppo lunghi da splittare.                                                                                                                                                                |
| `PostToolUse Edit/Write/MultiEdit`       | `post-edit-antiban-audit.ps1`     | async audit         | attivo                        | Traccia possibili miss anti-ban.                                                                                                                                                                        |
| `PostToolUse Edit/Write/MultiEdit`       | `post-edit-request-action.ps1`    | async gated action  | attivo                        | Esegue commit/push solo su trigger esplicito e dopo gate.                                                                                                                                               |
| `PostToolUse Edit/Write/MultiEdit`       | `post-edit-verify-checklist.ps1`  | sync advisory       | attivo                        | Richiede check L2-L6 dichiarativo dopo edit codice.                                                                                                                                                     |
| `PostToolUse Edit/Write/MultiEdit`       | `post-edit-codebase-hygiene.ps1`  | sync advisory       | attivo                        | Richiede valutazione pulizia codebase su file diretti/indiretti dopo ogni edit.                                                                                                                         |
| `PreCompact`                             | `inject-runtime-brief.ps1`        | sync context        | attivo                        | Ricorda regole critiche prima del compact.                                                                                                                                                              |
| `PreCompact`                             | `pre-compact-handoff.ps1`         | blocking/context    | attivo                        | Forza compilazione di `.claude/CONTINUATION.md` quando il contesto sta degradando; Obsidian pubblica la vista `Resources/continuita/`.                                                                  |
| `Stop`                                   | `stop-session.ps1`                | async audit         | attivo                        | Log sessione, memory/worklog warnings.                                                                                                                                                                  |
| `Stop`                                   | `pre-stop-commit-gate.ps1`        | sync advisory/block | attivo                        | Evita chiusura silenziosa con blocco tecnico lasciato aperto.                                                                                                                                           |
| `Stop`                                   | `stop-proactive-next-step.ps1`    | sync advisory       | attivo                        | Reinietta obbligo di prossimo passo concreto, blocco reale o domanda specifica alla chiusura.                                                                                                           |
| `SubagentStop`                           | `subagent-stop.ps1`               | async log           | attivo                        | Traccia output subagent.                                                                                                                                                                                |
| `TaskCreated/TaskCompleted/TeammateIdle` | `teammate-event.ps1`              | async log           | attivo                        | Traccia agent teams.                                                                                                                                                                                    |

Totale operativo: il conteggio **non va hardcodato** in questo documento — va derivato dal canonico `MANAGED_ROUTER_HOOKS` in `~/.claude/scripts/model-router-config.mjs` (`applyManagedClaudeCodeSettings` lo materializza in `~/.claude/settings.json`). Allo stato attuale (2026-06-05) il canonico definisce **45 script hook unici** (incluso `ensure-claude-model-router.ps1`, il solo condizionale: presente in unified router mode, filtrato in Anthropic nativo) e `settings.json` materializza **47 voci hook** distribuite sugli eventi Claude Code (alcuni script sono registrati su più eventi: `inject-runtime-brief.ps1` su `UserPromptSubmit`+`PreCompact`, `teammate-event.ps1` su `TeammateIdle`+`TaskCreated`+`TaskCompleted`). La tabella sopra è un sottoinsieme storico (32 voci) e NON è più la fonte del conteggio. Non aumentare gli hook senza miss ricorrenti misurati o senza un advisory ad alto valore che renda visibile un miss sistemico. Verifica del numero reale: `npm run audit:hooks` (allineato al canonico, non a questa tabella).

### Hook live non ancora documentati nella tabella sopra

Hook presenti in `settings.json` (via `MANAGED_ROUTER_HOOKS`) ma assenti dall'inventory storico:

- `SessionStart`: `session-start-sync-check.ps1`
- `UserPromptSubmit`: `user-prompt-router-switch.ps1` (sostituisce il vecchio `ensure-claude-model-router.ps1` come switch router su prompt), `zero-rules-enforcer.ps1`
- `PostToolUse Bash`: `post-bash-package-change.ps1`, `post-bash-handoff-invalidate.ps1`
- `PostToolUse Edit/Write/MultiEdit`: `post-edit-auto-commit.ps1`
- `PreCompact`: `block-auto-compact.ps1`
- `Stop`: `stop-completeness-check.ps1`, `stop-auto-track.ps1`, `stop-todolist-goal-reminder.ps1`, `stop-decide-dont-ask.ps1`, `stop-selfcorrection-rule.ps1`, `stop-sync-obsidian.ps1`

## Codex parity

Codex deve avere parity minima per il control plane AI, anche se non espone tutte le stesse primitive di Claude Code.

| Evento Codex       | Hook repo                                 | Stato  | Nota                                                                      |
| ------------------ | ----------------------------------------- | ------ | ------------------------------------------------------------------------- |
| `SessionStart`     | `.codex/hooks/codex-runtime-context.ps1`  | attivo | Reinietta runtime brief e contratto orchestrator.                         |
| `UserPromptSubmit` | `.codex/hooks/codex-runtime-context.ps1`  | attivo | Reinietta intent, capability routing, L2-L9 e truthful completion.        |
| `PreToolUse`       | `.codex/hooks/codex-bash-gate.ps1`        | attivo | Gate minimo su shell/git e reminder blast radius.                         |
| `PostToolUse`      | `.codex/hooks/codex-post-tool-review.ps1` | attivo | Log e reminder post-tool su file diretti/indiretti.                       |
| `Stop`             | `.codex/hooks/codex-stop-check.ps1`       | attivo | Stop gate leggero su false completion, continuation e working tree dirty. |

Gap noto: `PreCompact` non ha equivalente diretto in Codex al 2026-05-17. La mitigazione corrente e' `Stop` + continuation/Obsidian audit. Verifica: `npm run audit:codex-hook-parity`.

Parita' globale fuori repo: `C:\Users\albie\.codex\hooks.json` deve avere `UserPromptSubmit` con `C:\Users\albie\.claude\scripts\turn-governor-hook.ps1` e `C:\Users\albie\.codex\hooks\token-cost-context.ps1`. Questo copre messaggi Codex senza progetto e rende il cambio chat basato anche su token/crediti. Verifica: `npm run audit:codex-hook-parity`.

## Regole che devono restare hook

- Anti-ban su file browser/timing/stealth/sessione/LinkedIn.
- Segreti e file sensibili.
- Git commit/push readiness.
- Quality gate prima di commit.
- Runtime brief su prompt e compact.
- Turn governor su prompt densi, prompt optimizer, confine automatico-vs-chiedi e costo/contesto.
- Token/costo per risposta e cambio chat cost-aware.
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
- `context-handoff` mancante in `~/.claude/skills`, anche se citata come skill critica. Oggi resta supporto/fallback legacy: la procedura primaria e' `CONTINUATION.md` + Obsidian.
- Routing registry non accettava capability `agent`/`cli` e fonte `session-state`.
- Routing registry referenziava `context-handoff` e `session-prompt` senza capability corrispondente; ora il routing deve privilegiare memoria/continuita' Obsidian e trattare quelle skill come fallback legacy.

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

`audit:hooks` ora controlla tutti i command hook attivi derivati dal canonico `MANAGED_ROUTER_HOOKS`, non solo il vecchio sottoinsieme da 14.

---

## Mappatura inversa: regola canonica → hook coverage

> Audit 2026-05-16: per ogni regola canonica, quale hook la rende automatica.
> Obiettivo: identificare regole "orfane" (solo testo, nessun hook). Non promuovere a hook se i miss veri sono sotto soglia (regola activations vs miss veri).

| Regola                                                                                               | Fonte canonica                                         | Hook che la enforced                                                      | Tipo                   | Stato                 | Orfana?                      |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------- | --------------------- | ---------------------------- |
| P0 cognitivo (intento, fonte, vista 360, decomposizione, root cause, verifica, continuità, truthful) | `~/.claude/CLAUDE.md` + runtime brief                  | `inject-runtime-brief.ps1` (UserPromptSubmit + SessionStart + PreCompact) | sync inject            | attivo                | No                           |
| L1 deterministico (typecheck/lint/test/madge/coverage/size/build)                                    | `~/.claude/CLAUDE.md` L1                               | `pre-bash-l1-gate.ps1` blocca commit senza quality gate                   | blocking               | attivo                | No                           |
| L2-L6 advisory (caller, edges, scenari, UX, E2E)                                                     | `~/.claude/CLAUDE.md` L2-L6                            | `post-edit-verify-checklist.ps1` richiede dichiarazione applicabile       | sync advisory          | attivo                | No                           |
| L7 cross-domain per file                                                                             | `~/.claude/CLAUDE.md` L7                               | `post-edit-codebase-hygiene.ps1` advisory (parziale)                      | sync advisory          | attivo                | Parziale                     |
| L8 coerenza cross-file                                                                               | `~/.claude/CLAUDE.md` L8                               | nessuno specifico (delegato a `/verification-protocol`)                   | —                      | inattivo              | **Sì**                       |
| L9 truthful completion                                                                               | `~/.claude/CLAUDE.md` L9                               | `stop-proactive-next-step.ps1` advisory parziale                          | sync advisory          | attivo                | Parziale                     |
| Anti-ban LinkedIn (5 domande + principi)                                                             | AGENTS.md `Priorita' assoluta`                         | `pre-edit-antiban.ps1` blocking + `post-edit-antiban-audit.ps1`           | blocking + async       | attivo                | No                           |
| Memoria continuous update                                                                            | `~/.claude/CLAUDE.md` `Memoria — Secondo Cervello`     | `session-start.ps1` carica + `stop-session.ps1` warning                   | sync load + async warn | attivo                | Parziale (no enforce update) |
| Codebase hygiene file diretto/indiretto                                                              | AGENTS.md `Cross-domain` + runtime brief               | `post-edit-codebase-hygiene.ps1` richiede dichiarazione                   | sync advisory          | attivo                | No                           |
| Auto-commit by default                                                                               | AGENTS.md `Commit e push`                              | `pre-bash-git-gate.ps1` blocking + `post-edit-request-action.ps1`         | blocking + sync gated  | attivo                | No                           |
| Auto-push post-commit                                                                                | AGENTS.md `Auto-push post-commit`                      | `audit:git-automation:strict:push` + `post-bash-git-audit.ps1`            | blocking + async       | attivo                | No                           |
| Selezione modello per task                                                                           | AGENTS.md `Selezione modello AI`                       | `user-prompt-session-advisor.ps1` + `ensure-claude-model-router.ps1`      | sync advisory + config | attivo (condizionale) | No                           |
| Prompt densi / richiesta vocale multi-punto                                                          | runtime brief + preferences.md                         | `turn-governor-hook.ps1`                                                  | sync advisory          | attivo                | No                           |
| Cambio chat basato su contesto, token, crediti e costo                                                | runtime brief + preferences.md                         | `turn-governor-hook.ps1` + `token-cost-context.ps1`                       | sync advisory          | attivo                | No                           |
| Intento non letterale                                                                                | AGENTS.md `Intento non letterale`                      | `pre-edit-verify-intent.ps1` + brief inject                               | sync advisory          | attivo                | No                           |
| Fallback context degradation                                                                         | AGENTS.md `Fallback context degradation`               | `pre-compact-handoff.ps1` blocking                                        | blocking               | attivo                | No                           |
| Pazienza vs fretta                                                                                   | AGENTS.md `Pazienza vs fretta`                         | nessuno specifico (parte regola in brief)                                 | —                      | inattivo              | **Sì**                       |
| Anti-compiacenza                                                                                     | AGENTS.md `Anti-compiacenza`                           | nessuno                                                                   | —                      | inattivo              | **Sì**                       |
| Posizione ferma con evidenza                                                                         | feedback memory `feedback_hold_position`               | nessuno                                                                   | —                      | inattivo              | **Sì**                       |
| Verifica 100% (NUOVA)                                                                                | feedback memory + L9.7 espanso                         | nessuno specifico (entra in L9 via post-edit-verify-checklist)            | —                      | inattivo              | **Sì**                       |
| Concetti come check operativi (NUOVA)                                                                | feedback memory                                        | nessuno                                                                   | —                      | inattivo              | **Sì**                       |
| Task multi-categoria proattività                                                                     | AGENTS.md `Task multi-categoria`                       | nessuno (richiede stato cross-turn)                                       | —                      | inattivo              | Sì (low priority)            |
| Classificazione temporale                                                                            | AGENTS.md `Classificazione temporale`                  | nessuno                                                                   | —                      | inattivo              | Sì (low priority)            |
| Workflow autonomi /goal /loop                                                                        | AGENTS.md `Workflow autonomi continui`                 | nessuno (slash command nativo)                                            | —                      | n/a                   | n/a                          |
| Skill ricerca pre-creazione                                                                          | `~/.claude/CLAUDE.md` `Regola zero-A`                  | `skill-activation.ps1` advisory                                           | sync advisory          | attivo                | No                           |
| Activations vs miss veri                                                                             | feedback memory `feedback_metrics_activations_vs_miss` | meta-regola per audit hook stessi                                         | —                      | n/a                   | n/a                          |
| Agire su messaggi hook                                                                               | feedback memory `feedback_hook_messages`               | `user-prompt-commit-gate.ps1` + `pre-stop-commit-gate.ps1` parziale       | sync advisory          | attivo                | Parziale                     |
| File size >300 righe                                                                                 | `~/.claude/CLAUDE.md` `Organizzazione` + L1.6/L7.7     | `file-size-check.ps1` PostToolUse                                         | async log              | attivo                | No                           |
| Secret/credenziali in commit                                                                         | AGENTS.md + `.githooks/pre-commit`                     | `pre-edit-secrets.ps1` blocking + native git hook                         | blocking               | attivo                | No                           |
| Web search per librerie/API                                                                          | AGENTS.md `Protocollo pre-task`                        | `post-websearch-log.ps1` async + `pre-edit-best-practice.ps1` advisory    | async + advisory       | attivo                | Parziale                     |
| MCP guard                                                                                            | AGENTS.md uso MCP                                      | `pre-mcp-guard.ps1` blocking/advisory                                     | blocking               | attivo                | No                           |
| Subagent traceability                                                                                | AGENTS.md Agent Teams                                  | `subagent-stop.ps1` + `teammate-event.ps1`                                | async log              | attivo                | No                           |

### Regole orfane critiche (priorità di promozione)

Solo se i miss veri sono misurabili sopra soglia (regola activations vs miss):

1. **L8 coerenza cross-file** — promuovere a script audit (`src/scripts/crossFileCoherenceAudit.ts`) che verifica: contratti caller/callee, tipi duplicati, MEMORY.md/registry allineati a file modificati. Trigger: PostToolUse Edit/Write con scope multi-file.
2. **Pazienza vs fretta** — promuovere a check del `stop-proactive-next-step.ps1`: se la risposta cita >5 affermazioni "fatto", richiedere dichiarazione esplicita "verificate al 100%: X/Y".
3. **Anti-compiacenza** — promuovere a sub-check del `pre-edit-best-practice.ps1`: se l'utente richiede azione che contraddice canonici/decisions.md/anti-ban, hook restituisce warning bloccante "contraddizione rilevata, dichiarare prima di procedere".
4. **Verifica 100%** — promuovere a sub-check del `post-edit-verify-checklist.ps1`: aggiungere domanda "ogni claim 'verificato' supportato da check reale eseguito in questo turno?".
5. **Concetti come check operativi** — non promuovibile a hook generico (richiede analisi semantica). Lasciare in feedback memory + L9.7.
6. **Posizione ferma con evidenza** — non promuovibile a hook (richiede analisi dialogica). Lasciare in feedback memory.

### Regole orfane low-priority

- Task multi-categoria proattività: richiede stato cross-turn non disponibile via hook stateless attuali.
- Classificazione temporale: utile in advisory ma rumore probabile. Lasciare in canonico.

### Logica generale

Hook bloccante = controllo deterministico facile (regex pattern, file size, git status).
Hook advisory = inietta contesto/checklist che il modello deve leggere e dichiarare.
Hook NON adatto = controllo semantico ambiguo, analisi dialogica multi-turn, ragionamento aperto.

Il valore degli hook advisory dipende dal modello che legge il messaggio e agisce (vedi `feedback_hook_messages.md`). Se il modello ignora gli advisory ricorrentemente, va promosso il check a bloccante o trasformato in script verificabile.

---

## Pre/post-conditions nelle skill e MCP critici

| Skill / MCP                     | Pre-conditions                                                          | Post-conditions                                                 |
| ------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| `antiban-review`                | File sensibile LinkedIn, azione browser, cambio volume                  | Verdetto SICURO/ATTENZIONE/BLOCCO con azione successiva         |
| `loop-codex`                    | L1 pulito, task con criteri misurabili, scope no-antiban                | Auto-commit se DONE, update ENGINEERING_WORKLOG                 |
| `context-handoff` / continuita' | Git status pulito o documentato, memoria aggiornata, active.md coerente | `.claude/CONTINUATION.md` compilato, Obsidian `Resources/continuita/START-NEXT-CHAT.md` sincronizzato; `SESSION_HANDOFF.md` solo fallback legacy |
| `debugging-wizard`              | Errore riproducibile o log disponibile, primo tentativo di debug        | Root cause identificata o escalation a `systematic-debugging`   |
| `verification-protocol` (L7-L9) | Implementazione completata, L1-L6 gia' verificati                       | Esito DONE o BLOCKED con causa esplicita                        |
| `typescript-pro`                | Task TS con logica non banale, codebase TS presente                     | Codice conforme a pattern progetto, typecheck pulito            |
| `code-review`                   | PR creata o diff locale significativo, area core/sicurezza/DB           | Commenti con severity, no falsi positivi su stile               |
| `audit-rules`                   | Sospetto violazione regole operative o audit periodico                  | Report gap con azione correttiva                                |
| MCP Supabase                    | Query o migrazione DB necessaria, credenziali configurate               | Risultato query o migration applicata, tipi aggiornati se serve |
| MCP Playwright                  | Bug UI non riproducibile da log, pagina accessibile                     | Screenshot o DOM snapshot, diagnosi visiva                      |

## Hook n8n (da implementare, non ancora attivo)

- Pre-hook ingresso: validare context minimo (account attivo, proxy ok, no quarantena) prima di eseguire workflow LinkedIn
- Post-hook uscita: verificare stato finale, loggare su Telegram se WARN/CRITICAL, aggiornare `automation_commands`
