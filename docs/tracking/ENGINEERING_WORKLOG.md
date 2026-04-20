# Engineering Worklog

Questo file tiene traccia dei blocchi tecnici realmente analizzati, provati o verificati nel repo.

## 2026-04-19 — Blocco 2: routing operativo advisory + L2-L6 audit-assisted

### Obiettivo

Trasformare routing strumenti/modello/ambiente/fonte di verita' e livelli `L2-L6` da regole testuali a comportamento ripetibile, senza introdurre blocker semantici fragili Claude-only.

### Interventi completati

- Aggiunti i registri machine-readable del control plane:
  - `docs/tracking/AI_CAPABILITY_ROUTING.json`
  - `docs/tracking/AI_LEVEL_ENFORCEMENT.json`
- Aggiunto modulo condiviso `src/scripts/lib/aiControlPlaneRegistry.ts` con:
  - parsing e validazione dei registri
  - classificazione task (`quick-fix`, `bug`, `feature/refactor`)
  - routing multi-match per domini
  - focus `L2-L6` derivato dal task class
- Aggiunti gli audit dedicati:
  - `src/scripts/capabilityRoutingAudit.ts`
  - `src/scripts/levelEnforcementAudit.ts`
- `package.json` riallineato:
  - `audit:ai-control-plane` ora e' umbrella
  - introdotti `audit:ai-control-plane:docs`, `audit:routing`, `audit:l2-l6`
- Estesa `src/scripts/ruleEnforcementMatrix.ts` con:
  - nuovi tipi `advisory-hook` e `audit-script`
  - riclassificazione truthful di routing advisory e `L2-L6` audit-assisted
- Potenziato il hook globale `C:\Users\albie\.claude\hooks\skill-activation.ps1`:
  - legge i registri repo-local
  - produce `PROJECT_ROUTING_DECISION`
  - emette `Capability gap` se il routing non e' affidabile
  - propone focus `L2-L6` coerente col task class
- Riallineati i canonici minimi:
  - `docs/AI_RUNTIME_BRIEF.md`
  - `docs/AI_OPERATING_MODEL.md`
  - `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md`
  - `docs/AI_MASTER_IMPLEMENTATION_SINGLE_LIST.md`
  - `todos/active.md`
  - `docs/tracking/README.md`

### Verifica

- `npm run audit:ai-control-plane` → `21/21` ✅
- `npm run audit:routing` → registro valido + 5 smoke prompt ✅
- `npm run audit:l2-l6` → copertura `quick-fix` / `bug` / `feature-refactor` ✅
- `npm run audit:rule-enforcement` → `29/42`, `0` gap meccanizzabili ✅
- `npm run audit:hooks` → `14/14` ✅
- `npm run audit:skills` → `5/5` ✅
- smoke test reale del hook `skill-activation.ps1` su 5 prompt → output JSON corretto con `PROJECT_ROUTING_DECISION` ✅
- `npm run pre-modifiche` → verde (`137/137` file test, `1430/1430` test) ✅
  - Nota: nel sandbox locale Vitest continua a fallire con `spawn EPERM`; quality gate confermato fuori sandbox.

## 2026-04-19 — Blocco 1: riallineamento canonici, audit e modello a 9 livelli

### Obiettivo

Chiudere il drift tra documenti canonici, audit del control plane e stato reale del repo, senza riallargare `AGENTS.md`.

### Interventi completati

- Aggiornato `src/scripts/aiControlPlaneAudit.ts` per validare il modello documentale corrente:
  - `AGENTS.md` slim e operativo
  - backlog strutturato come fonte primaria del mancante
  - single list come vista derivata
  - narrativa coerente sul modello a 9 livelli
- Riallineati gli entrypoint documentali:
  - `README.md`
  - `CLAUDE.md`
  - `AGENTS.md`
  - `docs/README.md`
  - `docs/AI_RUNTIME_BRIEF.md`
  - `docs/AI_MASTER_SYSTEM_SPEC.md`
- Ripulite formulazioni stale sui livelli di controllo:
  - modello canonico = 9 livelli
  - enforcement meccanico attuale = `L1` + `L7-L9`
  - `L2-L6` ancora da promuovere
- Riallineato il backlog runtime del `2026-04-19` alle prove reali del codice:
  - propagati come chiusi lock cooperativo, graceful shutdown nei path critici, timeout PM2, health deep con runtime lock/zombie, recovery `automation_commands`, `workflowToJobTypes(...)=INTERACTION`
  - riaperti o lasciati aperti i punti non dimostrati completamente: stop/flush listener+checkpoint, `skipPreflight`, override account scoped, verita' runtime unica tra superfici, failure mode specifici verso `WorkflowExecutionResult`
- Rimossi o declassati numeri documentali falsamente autorevoli:
  - `24/29` -> snapshot attuale `24/37`
  - score statico di `360-checklist.md` rimosso

### Verifica

- `npm run audit:ai-control-plane` → `19/19` ✅
- `npm run audit:rule-enforcement` → `24/37`, `0` gap meccanizzabili ✅
- `npm run audit:hooks` → `13/13` ✅
- `npm run audit:ledger` → `14/14` ✅
- `npm run audit:skills` → `5/5` skill critiche ✅
- `npm run pre-modifiche` → verde (`136/136` file test, `1421/1421` test) ✅
  - Nota: nel sandbox locale Vitest/Vite falliva con `spawn EPERM`; quality gate rilanciato fuori sandbox per conferma reale.

## 2026-04-18 — Fase 2: items #13, #15, #17, #18, #19, #20

### Obiettivo

Implementare Fase 2 del control plane: contesto, memoria, documenti AI-readable.

### Interventi completati

- **#13**: session-start.ps1 ora inietta SESSION_HANDOFF.md se presente nella cwd
- **#15**: Creato docs/AI_DOC_STYLE_GUIDE.md con convenzioni documenti AI-readable
- **#17**: inject-runtime-brief.ps1 aggiunge CONTEXT_DEGRADATION_WARNING durante PreCompact
- **#18**: stop-session.ps1 controlla anche se todos/active.md e' stato aggiornato
- **#19**: Creato src/scripts/ledgerCoverageAudit.ts (audit:ledger) — 14/14 check
- **#20**: Creato src/scripts/skillActivationAudit.ts (audit:skills) — 5/5 critiche + inventario 172 skill

### Verifica

- `audit:ledger`: 14/14 ✅
- `audit:skills`: 5/5 critiche ✅
- `audit:rule-enforcement`: 24/29 enforced, 0 gap ✅
- `post-modifiche`: verde (136/136, 1421/1421) ✅

## 2026-04-18 — Items #1-3, #9, #10, #11: brief rafforzato + pre/post conditions + violation analysis

### Obiettivo

Chiudere i punti rimasti aperti nella Fase 1 del control plane cognitivo.

### Interventi completati

- **#1**: Aggiunto al runtime brief "dichiarare fonte, strumenti attivati e strumenti esclusi"
- **#2**: Aggiunto al runtime brief regola decisionale web search (obbligatoria/facoltativa/inutile)
- **#3**: Aggiunto al runtime brief "proporre modello e ambiente in base a qualita/costo/velocita/rischio"
- **#9**: Estesa tabella pre/post conditions in AGENTS.md: da 3 a 10 skill/MCP coperti
- **#10**: Coperto da `audit:rule-enforcement` (gia' implementato in blocco precedente)
- **#11**: Creato `src/scripts/violationLogAnalysis.ts` + `npm run audit:violations`
- Matrice enforcement aggiornata: 3 nuovi brief check (scelta-strumenti-esplicita, web-search-policy, modello-ambiente-scelta)

### Verifica

- `audit:rule-enforcement`: 24/29 enforced, 0 gap, 5 non-meccanizzabili ✅
- `audit:violations`: funzionante, 0 segnali critici ✅
- `post-modifiche`: verde (136/136, 1421/1421) ✅

## 2026-04-18 — Item #8: allineamento hook canonici ↔ audit ↔ matrice

### Obiettivo

Chiudere il disallineamento tra hook dichiarati in AGENTS.md, hook verificati dagli audit script, e regole mappate nella matrice di enforcement.

### Gap trovati e chiusi

- `file-size-check.ps1`: auditato da hooksConformityAudit ma NON dichiarato in AGENTS.md → aggiunto alla tabella hook
- `SessionStart/session-start.ps1`: dichiarato in AGENTS.md, verificato da aiControlPlaneAudit ma NON da hooksConformityAudit → aggiunto check
- `PostToolUse/post-edit-antiban-audit.ps1` (violations tracker): dichiarato in AGENTS.md, NON verificato da hooksConformityAudit → aggiunto check
- `TeammateIdle/TaskCreated/TaskCompleted`: dichiarati in AGENTS.md, NON verificati da nessun audit → aggiunto check
- 4 hook mancanti dalla matrice enforcement (`session-start`, `file-size-check`, `teammate-events`) → aggiunti

### Verifica

- `audit:rule-enforcement`: 21/26 enforced, 0 gap, 5 non-meccanizzabili ✅
- `audit:hooks`: 13/13 (era 10/10) ✅
- `audit:ai-control-plane`: 18/18 ✅
- `post-modifiche`: verde (136/136, 1421/1421) ✅

### Stato item lista

- Item #8 (allineare hook e regole canoniche): DONE — tutti i 14 hook dichiarati in AGENTS.md sono ora verificati da almeno un audit script e mappati nella matrice enforcement

## 2026-04-18 — Fix antiban false positive + completamento item #7 (copertura matrice)

### Obiettivo

Tre fix in sequenza:
- A: Antiban hook produceva falsi positivi su file `~/.claude/hooks/` (pattern "session" matchava `stop-session.ps1`)
- B: `audit:rule-enforcement` non era registrato in `aiControlPlaneAudit.ts`
- C: 2 regole da AGENTS.md/AI_MASTER_SYSTEM_SPEC non ancora mappate nella matrice

### Interventi completati

- Aggiunto `Test-AntibanFile` in `~/.claude/hooks/_lib.ps1` con whitelist `~/.claude/hooks/`
- Aggiornati `pre-edit-antiban.ps1` e `post-edit-antiban-audit.ps1` per usare `Test-AntibanFile`
- Aggiunto `'audit:rule-enforcement'` a `requiredScripts` in `aiControlPlaneAudit.ts`
- Aggiunti `capability-governance` e `auto-commit-policy` come `non-meccanizzabile` in `ruleEnforcementMatrix.ts`

### Verifica

- `Test-AntibanFile` su `stop-session.ps1` → `False` (non bloccato) ✅
- `Test-AntibanFile` su `sessionManager.ts` → `True` (bloccato) ✅
- `audit:rule-enforcement`: 18/23 enforced, 0 gap, 5 non-meccanizzabili by design ✅
- `audit:ai-control-plane`: 18/18 ✅
- `post-modifiche`: verde (136/136, 1421/1421) ✅

## 2026-04-18 — Rule Enforcement Matrix: matrice enforcement + chiusura GAP worklog-update

### Obiettivo

Implementare il punto #6 della lista AI_MASTER_IMPLEMENTATION_SINGLE_LIST.md:
produrre una matrice `regola → primitive di enforcement → verifica meccanica`.

### Interventi completati

- Creato `src/scripts/ruleEnforcementMatrix.ts` (22 regole, 4 categorie di enforcement)
- Aggiunto `audit:rule-enforcement` in `package.json`
- Identificato e chiuso GAP meccanizzabile: `stop-session.ps1` non verificava se ENGINEERING_WORKLOG.md era stato aggiornato
- Aggiornato `~/.claude/hooks/stop-session.ps1`: aggiunto controllo `git diff HEAD` con avviso Yellow a console

### Verifica

- `npm run audit:rule-enforcement`: `18/21 enforced, 0 gap meccanizzabili, 3 non-meccanizzabili (by design)`
- `npm run post-modifiche`: verde (136/136, 1421/1421)

### Nota operativa

Il hook `pre-edit-antiban.ps1` produce falso positivo su file in `~/.claude/hooks/` (pattern "session" matcha `stop-session.ps1`). Da fixare: escludere path `~/.claude/hooks/` dalla verifica antiban.

## 2026-04-18 — Rafforzata la logica dei quattro blocchi ancora troppo "ombrello"

### Obiettivo

Rendere piu' forti, espliciti e meno mescolati i quattro blocchi che coprivano gia' il perimetro giusto ma con logica ancora troppo aggregata:

- n8n, agenti verticali e automazioni durevoli
- parity ambienti
- orizzonti temporali e cadenze periodiche
- autonomia e sistema che migliora se stesso

L'obiettivo non era aggiungere dettaglio esecutivo, ma separare meglio responsabilita', criterio di chiusura, tipo di controllo e collegamento con il resto del sistema.

### Interventi completati

- Aggiornato [AI_MASTER_IMPLEMENTATION_BACKLOG.md](docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md)
  - i punti 4, 5, 10 e 13 ora distinguono meglio:
    - boundary tra primitive corrette
    - controllo reale vs presenza documentale
    - differenza tra stato operativo, fallback, ownership e metriche
    - criterio di done piu' logico e meno generico
- Aggiornato [AI_MASTER_IMPLEMENTATION_SINGLE_LIST.md](docs/AI_MASTER_IMPLEMENTATION_SINGLE_LIST.md)
  - riallineati gli item 21-28, 58-65, 71-76 e 88-93
  - i punti restano compatti ma sono meno "ombrello" e piu' chiari sulla funzione logica che devono coprire

### Verifica

- `npm run audit:ai-control-plane`
- `npm run post-modifiche`

### Esito

Verde.

- `npm run audit:ai-control-plane` passato (`18/18`)
- `npm run post-modifiche` passato
- typecheck, lint e suite Vitest verdi (`136/136` file test, `1421/1421` test)

## 2026-04-18 — Creato il backlog madre unico dei punti ancora da completare

### Obiettivo

Chiudere un gap documentale rimasto aperto dopo il consolidamento della spec AI:

- la lista completa del sistema desiderato esisteva gia' in [AI_MASTER_SYSTEM_SPEC.md](docs/AI_MASTER_SYSTEM_SPEC.md)
- lo stato e l'ordine di implementazione esistevano gia' in [AI_OPERATING_MODEL.md](docs/AI_OPERATING_MODEL.md)
- i backlog vivi esistevano gia' in [active.md](todos/active.md) e [workflow-architecture-hardening.md](todos/workflow-architecture-hardening.md)

Mancava ancora un file unico che rispondesse in modo esplicito a:

**"cosa manca ancora davvero, con sottopunti, primitive corrette e criterio di done?"**

### Interventi completati

- Creato [AI_MASTER_IMPLEMENTATION_BACKLOG.md](docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md)
  - backlog madre unico dei punti ancora aperti
  - separazione netta tra spec desiderata, roadmap/stato e backlog residuo
  - dettaglio esplicito dei blocchi ancora da chiudere con:
    - status
    - orizzonte temporale
    - primitive corrette
    - sottopunti aperti
    - criterio di done
- Aggiornato [AI_MASTER_SYSTEM_SPEC.md](docs/AI_MASTER_SYSTEM_SPEC.md)
  - aggiunto link al backlog madre di completamento
- Aggiornato [AI_OPERATING_MODEL.md](docs/AI_OPERATING_MODEL.md)
  - aggiunto link esplicito al backlog madre unico dei punti aperti
- Aggiornato [docs/README.md](docs/README.md)
  - classificato il nuovo file come documento canonico

### Verifica

- `npm run pre-modifiche`
- `npm run audit:ai-control-plane`
- `npm run post-modifiche`

### Esito

Verde.

- `npm run pre-modifiche` passato
- `npm run audit:ai-control-plane` passato (`18/18`)
- `npm run post-modifiche` passato
- typecheck, lint e suite Vitest verdi (`136/136` file test, `1421/1421` test)

## 2026-04-18 — Riallineati i gap residui del backlog madre contro la chat estesa

### Obiettivo

Verificare se, dopo la creazione del backlog madre unico, restavano ancora punti importanti emersi in chat ma non abbastanza espliciti nei canonici.

### Gap residui individuati

- la migrazione operativa progressiva verso Codex era presente come direzione, ma non ancora come item di backlog esplicito
- la governance degli agenti era ancora meno esplicita di quella delle skill
- la leggibilita' "AI-readable" dei documenti era presente come principio, ma non ancora come style guide esplicita da formalizzare
- i bug/blocchi reali di ambiente emersi su Cloud Code / OpenRouter / hook `SessionStart` non erano ancora tracciati come punto aperto nel backlog madre

### Interventi completati

- Aggiornato [AI_MASTER_IMPLEMENTATION_BACKLOG.md](docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md)
  - aggiunto audit esplicito su agenti e workflow decisionali deboli
  - aggiunta style guide esplicita per documenti AI-readable da formalizzare
  - aggiunto piano di migrazione progressiva del flusso tecnico principale verso Codex
  - aggiunta stabilizzazione dei problemi operativi di ambiente: `settings.json`, `SessionStart`, provider/model switching e visibilita' modelli OpenRouter

### Verifica

- `npm run audit:ai-control-plane`
- `npm run post-modifiche`

### Esito

Verde.

- `npm run audit:ai-control-plane` passato (`18/18`)
- `npm run post-modifiche` passato
- typecheck, lint e suite Vitest verdi (`136/136` file test, `1421/1421` test)

## 2026-04-18 — Creata anche la vista lineare unica del backlog aperto

### Obiettivo

Affiancare al backlog strutturato una vista lineare unica di tutti i punti ancora aperti, utile per:

- revisione rapida in una sola passata
- confronto diretto con la chat
- merge, pruning e miglioramento della lista

senza sostituire il backlog strutturato che resta la fonte primaria con area, primitive corrette e done criteria.

### Interventi completati

- Creato [AI_MASTER_IMPLEMENTATION_SINGLE_LIST.md](docs/AI_MASTER_IMPLEMENTATION_SINGLE_LIST.md)
  - lista lineare unica dei punti aperti
  - prima versione con 98 item atomici marcati con area e orizzonte
  - regola esplicita che la vista lineare e' derivata dal backlog strutturato, non fonte indipendente
- Aggiornato [AI_MASTER_IMPLEMENTATION_BACKLOG.md](docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md)
  - link alla vista lineare unica
- Aggiornato [docs/README.md](docs/README.md)
  - classificata la vista lineare come documento di supporto canonico alla revisione del backlog
- Rifinito [AI_MASTER_IMPLEMENTATION_SINGLE_LIST.md](docs/AI_MASTER_IMPLEMENTATION_SINGLE_LIST.md)
  - pruning della lista lineare
  - passaggio da ordine per area a ordine logico per dipendenze
  - riduzione degli item da 98 a 94
  - introduzione di 10 fasi di lavoro:
    - control plane cognitivo
    - contesto e memoria
    - parity ambienti
    - runtime reale
    - anti-ban/compliance
    - n8n/automazioni
    - chiusura tecnica e cadenze
    - cleanup
    - riuso
    - metriche di autonomia
- Rifinito di nuovo [AI_MASTER_IMPLEMENTATION_SINGLE_LIST.md](docs/AI_MASTER_IMPLEMENTATION_SINGLE_LIST.md)
  - aggiunte regole esplicite di scrittura della lista per evitare punti troppo vaghi o sovrapposti
  - rese piu' esplicite varie righe ancora troppo generiche
  - fusi o stretti i punti ancora troppo vicini tra loro
  - mantenute le 10 fasi logiche, ma con formulazioni piu' operative
  - riduzione finale degli item da 94 a 93

### Verifica

- `npm run audit:ai-control-plane`
- `npm run post-modifiche`

### Esito

Verde.

- `npm run audit:ai-control-plane` passato (`18/18`)
- `npm run post-modifiche` passato
- typecheck, lint e suite Vitest verdi (`136/136` file test, `1421/1421` test)

## 2026-04-18 — Resa esplicita anche la governance del catalogo capability AI

### Obiettivo

Chiudere un altro gap emerso dalla chat: la documentazione parlava gia' di skill duplicate e di primitive corrette, ma non ancora in modo abbastanza esplicito su:

- inventario unico delle capability installate o disponibili
- decisione `skill` vs `MCP` vs `plugin` vs `hook` vs `workflow`
- valutazione di candidate esterne specifiche prima di installarle
- routing per dominio pratico, cosi' backend e frontend non restano casi impliciti

### Interventi completati

- Aggiornato [AI_MASTER_SYSTEM_SPEC.md](docs/AI_MASTER_SYSTEM_SPEC.md)
  - aggiunto inventario unico delle capability
  - resa esplicita la scelta della primitive corretta anche con `plugin`
  - aggiunta la valutazione preventiva di candidate come Caveman, LeanCTX, SIMDex e Contact Skills
- Aggiornato [AI_MASTER_IMPLEMENTATION_BACKLOG.md](docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md)
  - aggiunti item aperti su inventory capability, keep/merge/remove, routing matrix per dominio e valutazione candidate esterne
- Aggiornato [AI_MASTER_IMPLEMENTATION_SINGLE_LIST.md](docs/AI_MASTER_IMPLEMENTATION_SINGLE_LIST.md)
  - resa esplicita la parte di audit capability installate e valutazione delle skill candidate nominate in chat
- Aggiornato [AI_OPERATING_MODEL.md](docs/AI_OPERATING_MODEL.md)
  - esplicitata la governance del catalogo installato e la routing matrix per dominio pratico

### Verifica

- `npm run pre-modifiche`
- verifica locale sui path skill disponibili per Caveman / LeanCTX / SIMDex / Contact Skills

### Esito

Verde.

- `npm run pre-modifiche` passato
- nessuna delle skill candidate nominate risulta gia' installata nei percorsi locali controllati
- il requisito ora e' tracciato in modo esplicito nei canonici corretti, senza aprire documenti duplicati

### Estensione successiva dello stesso blocco

Per chiudere il rischio di requisito solo "documentato ma non operativo", il tema e' stato propagato anche nei file che guidano davvero il comportamento runtime:

- [AGENTS.md](AGENTS.md)
  - esteso da sola `skill governance` a `capability governance`
  - inventario capability + routing matrix + valutazione candidate esterne
- [AI_RUNTIME_BRIEF.md](docs/AI_RUNTIME_BRIEF.md)
  - aggiunti `plugin`, overlap capability e routing mentale per dominio pratico
- [active.md](todos/active.md)
  - il tema entra anche nelle priorita' vive come catalogo capability ordinato
- [aiControlPlaneAudit.ts](src/scripts/aiControlPlaneAudit.ts)
  - l'audit statico pretende ora anche questi frammenti, cosi' il requisito non puo' sparire senza essere rilevato


## 2026-04-19 — Audit e riscrittura AI_MASTER_IMPLEMENTATION_SINGLE_LIST + slim-down canonici

### Obiettivo

Mettere a posto la lista di implementazione AI in modo "perfetto e impeccabile" e allineare i canonici correlati.

### Interventi eseguiti

**AI_MASTER_IMPLEMENTATION_SINGLE_LIST.md — riscrittura completa**
- Separazione netta aperti/completati (63 aperti + 34 completati)
- Fasi rinumerate 1-12, nessun suffisso lettera (eliminati 82b-82h dalla numerazione principale)
- Duplicati fusi: 42+62, 67+70, 12+14+65 → risparmio 4 item
- Condensamenti: 21-28 (8→5 item parity), 71-76 (6→3 item temporal horizons)
- Nuovi item aperti: L2-L6 enforcement, behavioral biometrics, dashboard drain, self-healing, CLAUDE.md slim-down
- Nuovi item completati: skill-activation hook, AGENTS.md slim-down
- Local tools separati in Fase 4 dedicata

**AI_OPERATING_MODEL.md — aggiornamento stato**
- Punto 2 "Loop e verifica sistematica": ✅ → ⚠️ (L2-L6 audit-assisted, non ancora blocking)
- Nota di stato permanente su L2-L6 aggiunta in testa al documento

**AI_MASTER_IMPLEMENTATION_BACKLOG.md — caveat L1-L9**
- Riga baseline "protocollo L1-L9" emendata con nota esplicita: L1 e L7-L9 enforced, L2-L6 da costruire

**AGENTS.md slim-down (Layer A del piano sessione)**
- 476→199 righe: rimosse sezioni duplicate con AI_RUNTIME_BRIEF.md
- Condensate: fonte di verita', automazione, blast radius, contratti

**CLAUDE.md globale slim-down**
- 326→195 righe: eliminata sezione "Orchestrazione cognitiva contestuale" (coperta dal runtime brief)
- Condense: fonte-di-verita' → tabella lookup; Step A/B → bullet; L1-L9 → una riga per livello
- Tutte le sezioni operative preservate

**skill-activation.ps1**
- Hook UserPromptSubmit che suggerisce skill per dominio in base al testo del prompt
- Wired in settings.json
- Testato PowerShell 5.x (rimosso operatore `??` non compatibile)

### Verifica eseguita

- File post-riscrittura letti e verificati manualmente
- Conteggio item: tutti 100 originali tracciati (aperti o completati o fusi con nota)
- CLAUDE.md: 195 righe, tutte sezioni critiche presenti (`grep` verificato)
- Nessuna modifica al codice runtime in questo blocco

### Esito

Sistema di documentazione AI allineato. La single list e' ora la vista canonica unica senza duplicati, la numerazione e' pulita e il gap L2-L6 e' tracciato correttamente come "audit-assisted, da promuovere a blocking dove giustificato dai miss ricorrenti".
