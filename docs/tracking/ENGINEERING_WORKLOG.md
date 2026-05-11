# Engineering Worklog

Questo file tiene traccia dei blocchi tecnici realmente analizzati, provati o verificati nel repo.

## 2026-05-09 — Completati lista AI resi espliciti

### Obiettivo

Rendere la sezione dei punti gia' fatti della lista AI esplicita quanto gli item aperti: ogni completato deve dire cosa copre, dove vive, quale prova lo sostiene e quale limite residuo resta.

### Interventi eseguiti

- Riscritta la sezione `## Completati` di `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md` in 21 blocchi strutturati.
- Ogni blocco completato ora contiene `Cosa copre`, `Dove vive`, `Prova` e `Limite residuo`.
- Aggiunto in `src/scripts/aiListCompletenessAudit.ts` il controllo sui completati strutturati, cosi' la lista non possa tornare a bullet generici.

### Stato residuo

- I completati sono incrementi verificati, non chiusura totale delle aree: i limiti residui restano negli item aperti.

### Verifica

- `npm run pre-modifiche` passato: typecheck backend/frontend, lint e 1430 test Vitest verdi
- `npm run audit:ai-list-completeness` passato: 10/10 check, incluso controllo sui completati strutturati
- `npm run audit:ai-control-plane` passato: docs, hooks, routing, ADK, L2-L6 e lista AI verdi
- `npm run post-modifiche` passato: typecheck backend/frontend, lint e 1430 test Vitest verdi
- `git diff --check` passato

## 2026-05-09 — Decomposizione ricorsiva degli argomenti

### Obiettivo

Rendere esplicito che un esempio o argomento dell'utente va aperto in albero dell'argomento: sottopunti, sotto-sottopunti e rami correlati. Per ogni ramo l'AI deve rivalutare fonte corretta, web/docs/MCP, skill/capability, rischi, verifiche e done criteria.

### Interventi eseguiti

- Rafforzati `docs/AI_RUNTIME_BRIEF.md` e `docs/AI_MASTER_SYSTEM_SPEC.md` con decomposizione ricorsiva dell'argomento.
- Aggiornati backlog madre e vista lineare AI per rendere il requisito parte del punto aperto su ragionamento autonomo.
- Aggiornati `docs/AI_OPERATING_MODEL.md`, `docs/360-checklist.md`, `AGENTS.md`, `todos/active.md` e `docs/tracking/AI_HOOK_ENFORCEMENT_PLAN.md`.
- Aggiornato `C:/Users/albie/.claude/hooks/skill-activation.ps1` con reminder runtime su albero argomento e rivalutazione per ramo.
- Estesi `aiControlPlaneAudit.ts` e `aiListCompletenessAudit.ts` per proteggere il requisito.

### Stato residuo

- La decomposizione resta cognitiva/advisory: non puo' essere un blocking hook generico senza falsi positivi. Va misurata con audit ledger e test su prompt densi.

### Verifica

- `npm run pre-modifiche` passato: typecheck backend/frontend, lint e 1430 test Vitest verdi
- `npm run audit:ai-control-plane:docs` passato: 24/24 check
- `npm run audit:ai-list-completeness` passato: 9/9 check
- `npm run audit:hooks` passato: 17/17 check
- `npm run audit:ai-control-plane` passato: docs, hooks, routing, ADK, L2-L6 e lista AI verdi
- `npm run post-modifiche` passato: typecheck backend/frontend, lint e 1430 test Vitest verdi
- `git diff --check` passato

## 2026-05-09 — Gerarchia P0 del ragionamento AI

### Obiettivo

Rendere prioritari e non opzionali i ragionamenti piu' importanti: intento reale, input utente come ipotesi, esempi come pattern, visione 360/lungo termine, root cause/soluzione migliore, fonte/primitive/verifica e truthful completion.

### Interventi eseguiti

- Aggiunta la `Gerarchia P0 prima di ogni ragionamento` in `docs/AI_RUNTIME_BRIEF.md`, reiniettata dai hook `UserPromptSubmit`.
- Allineata la fonte madre `docs/AI_MASTER_SYSTEM_SPEC.md` con la `Priorita P0 non negoziabile`.
- Rafforzati backlog madre e vista lineare AI per rendere P0 parte del punto aperto su ragionamento autonomo, esempi come pattern e no false completion.
- Aggiunto un reminder P0 compatto in `C:/Users/albie/.claude/hooks/skill-activation.ps1`, cosi' il routing advisory non si limita a skill/fonte ma ricorda l'ordine cognitivo.
- Aggiornati `docs/AI_OPERATING_MODEL.md`, `docs/360-checklist.md`, `AGENTS.md`, `hooks/README.md` e `docs/tracking/AI_HOOK_ENFORCEMENT_PLAN.md`.
- Estesi `aiControlPlaneAudit.ts` e `aiListCompletenessAudit.ts` per fallire se la gerarchia P0 o il reminder hook spariscono.

### Stato residuo

- Non e' stato creato un hook blocking "ragiona meglio", perche' sarebbe semantico e fragile. La scelta corretta resta runtime brief + routing advisory + audit statico.
- Resta utile una prova comportamentale reale con prompt ambiguo/denso per misurare se il modello applica davvero P0 senza reminder dell'utente.

### Verifica

- `npm run audit:ai-list-completeness` passato: 9/9 check
- `npm run audit:ai-control-plane:docs` passato: 24/24 check
- `npm run audit:hooks` passato: 17/17 check
- `npm run audit:ai-control-plane` passato: docs, hooks, routing, ADK, L2-L6 e lista AI verdi
- `npm run post-modifiche` passato: typecheck backend/frontend, lint e 1430 test Vitest verdi
- `git diff --check` passato

## 2026-05-09 — Continuita' proattiva di chiusura

### Obiettivo

Evitare che l'utente debba fare da project manager dopo ogni risposta. Alla fine di ogni blocco operativo l'AI deve completare tutto il completabile nel turno corrente e lasciare continuita' operativa: prossimo passo concreto, blocco reale o domanda specifica.

### Interventi eseguiti

- Esteso `docs/AI_RUNTIME_BRIEF.md` con `Continuita' proattiva` dentro la gerarchia P0 e nella sezione `Prima di chiudere`.
- Allineati `docs/AI_MASTER_SYSTEM_SPEC.md`, `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md`, `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md`, `docs/AI_OPERATING_MODEL.md`, `docs/360-checklist.md`, `AGENTS.md` e `todos/active.md`.
- Aggiornato `C:/Users/albie/.claude/hooks/skill-activation.ps1` con reminder di chiusura proattiva su ogni prompt.
- Estesi gli audit `aiControlPlaneAudit.ts` e `aiListCompletenessAudit.ts` per proteggere questo requisito.

### Stato residuo

- La regola e' advisory/runtime, non blocking: una chiusura proattiva dipende da ragionamento semantico. Potra' diventare piu' forte solo con metriche su miss reali o false completion ripetute.

### Verifica

- `npm run audit:ai-control-plane:docs` passato: 24/24 check
- `npm run audit:ai-list-completeness` passato: 9/9 check
- `npm run audit:hooks` passato: 17/17 check
- `npm run audit:ai-control-plane` passato: docs, hooks, routing, ADK, L2-L6 e lista AI verdi
- `npm run post-modifiche` passato: typecheck backend/frontend, lint e 1430 test Vitest verdi
- `git diff --check` passato

## 2026-05-09 — Organizzazione futura control plane AI

### Obiettivo

Verificare che il sistema AI resti organizzato e modificabile anche per cambi futuri: nessuna modifica isolata a documenti, hook, capability o livelli deve poter creare drift silenzioso.

### Interventi eseguiti

- Ripristinato `post-edit-codebase-hygiene.ps1` in `C:/Users/albie/.claude/settings.json`, che era dichiarato dai canonici ma non piu' richiamato dal settings reale.
- Aggiornato `C:/Users/albie/.claude/scripts/model-router-config.mjs`, fonte di autoriparazione dei settings Claude Code, cosi' il hook non venga rimosso di nuovo.
- Aggiunta in `docs/tracking/README.md` la `Change map sistema AI`: regole/requisiti, capability, hook, L2-L9 e handoff indicano quali file aggiornare insieme e quali audit eseguire.
- Corretti i link relativi in `docs/tracking/README.md` per evitare riferimenti fragili o ambigui.
- Esteso `aiControlPlaneAudit.ts` con il check della change map, incluso `model-router-config.mjs` per i futuri hook.

### Stato residuo

- I canonici principali sono coerenti e auditati; restano lunghi per natura, ma sono separati per responsabilita' invece che duplicati.
- `ENGINEERING_WORKLOG.md` e' storico e molto lungo: resta accettabile come log cronologico, non come runtime brief.

### Verifica

- `npm run audit:hooks` passato: 17/17 check
- `npm run audit:ai-control-plane:docs` passato: 23/23 check
- `npm run audit:ai-control-plane` passato: docs, hooks, routing, ADK, L2-L6 e lista AI verdi
- `npm run post-modifiche` passato: typecheck backend/frontend, lint e 1430 test Vitest verdi
- `git diff --check` passato
- Link target della tracking README verificati: tutti presenti

## 2026-05-08 — Protocollo soluzione migliore e root cause

### Obiettivo

Rendere esplicito il principio emerso dalla chat: l'AI deve cercare il problema reale/root cause e la soluzione migliore verificabile, senza limitarsi alla prima risposta plausibile o al primo workaround.

### Interventi eseguiti

- Rafforzato `docs/AI_MASTER_SYSTEM_SPEC.md` con protocollo soluzione migliore: root cause, alternative, best practice aggiornate, iterazione ricerca/verifica/correzione e blocco truthful se non raggiungibile.
- Aggiornati `docs/AI_RUNTIME_BRIEF.md`, `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md`, `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md`, `docs/AI_OPERATING_MODEL.md` e `docs/360-checklist.md`.
- Rafforzato L4 in `AI_LEVEL_ENFORCEMENT.json` per includere root cause, alternative e divieto di primo workaround quando esiste soluzione migliore.
- Estesi `aiListCompletenessAudit.ts` e `aiControlPlaneAudit.ts` per fallire se spariscono root cause, alternative, soluzione migliore o primo workaround.

### Stato residuo

- Resta da validare con test comportamentale reale su un prompt ambiguo in cui la prima soluzione plausibile non e' la migliore.
- Non e' un permesso a loop infinito: se le fonti o i tool non bastano, va dichiarato il blocco reale.

### Verifica

- `npm run audit:ai-list-completeness` passato: 9/9 check
- `npm run audit:ai-control-plane:docs` passato: 22/22 check
- `npm run audit:l2-l6` passato
- `npm run audit:ai-control-plane` passato: docs, hooks, routing, ADK, L2-L6 e lista AI verdi
- `npm run post-modifiche` passato: typecheck backend/frontend, lint e 1430 test Vitest verdi
- `git diff --check` passato

## 2026-05-08 — Skill discovery esterna obbligatoria se manca capability locale

### Obiettivo

Chiudere il miss emerso su `find-skills`: una skill non presente nella lista locale non deve essere trattata come inesistente. Il sistema deve cercare su internet/cataloghi ufficiali prima di concludere che manca o prima di crearne una nuova.

### Interventi eseguiti

- Verificata fonte esterna `vercel-labs/skills`: il CLI ufficiale espone `npx skills find [query]` e la skill `find-skills` rimanda a `skills.sh`.
- Aggiornati `docs/AI_MASTER_SYSTEM_SPEC.md`, `docs/AI_RUNTIME_BRIEF.md`, `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md`, `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md`, `docs/AI_OPERATING_MODEL.md` e `docs/360-checklist.md`.
- Estesi `aiListCompletenessAudit.ts` e `aiControlPlaneAudit.ts` per fallire se spariscono `npx skills find`, `skills.sh` e discovery esterna dal contratto Orchestrator.

### Stato residuo

- La regola e' codificata nei canonici e negli audit; resta da installare/integrare davvero la skill `find-skills` se si decide di promuoverla a capability locale.
- La discovery esterna deve verificare reputazione, install count, compatibilita' e overlap: non e' installazione cieca.

### Verifica

- `npm run audit:routing` passato: 37 capability, 16 domini, smoke prompt `capability-discovery` verde
- `npm run audit:adk-capabilities` passato: 37 capability routing con placement ADK
- `npm run audit:ai-list-completeness` passato: 9/9 check
- `npm run audit:ai-control-plane:docs` passato: 22/22 check
- `npm run audit:ai-control-plane` passato: docs, hooks, routing, ADK, L2-L6 e lista AI verdi
- `npm run post-modifiche` passato: typecheck backend/frontend, lint e 1430 test Vitest verdi
- `git diff --check` passato

## 2026-05-08 — Orchestrator Layer esplicitato nei canonici

### Obiettivo

Chiarire che il punto centrale non e' una singola skill o un comando di ricerca skill, ma un Orchestrator Layer architetturale che decide come il sistema AI lavora prima dell'esecuzione.

### Interventi eseguiti

- Aggiunto in `docs/AI_MASTER_SYSTEM_SPEC.md` il blocco `Orchestrator Layer: decisione centrale prima dell'esecuzione`.
- Rafforzato `docs/AI_RUNTIME_BRIEF.md` con responsabilita' runtime dell'orchestrator: input, task class, fonte, capability, modello/ambiente, loop, handoff e verifiche.
- Rinominato e ampliato il punto 2 in `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md` e `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md` per trattare l'orchestrator come layer, non solo routing strumenti.
- Aggiornato `docs/AI_OPERATING_MODEL.md` e `todos/active.md` per rendere l'Orchestrator Layer parte della Fase A.
- Estesi gli audit `aiListCompletenessAudit.ts` e `aiControlPlaneAudit.ts` per fallire se spariscono Orchestrator Layer, skill-finder/capability finder o contratto decisionale.

### Verifica

- `npm run pre-modifiche` -> verde prima delle modifiche
- `npm run audit:ai-list-completeness` -> 8/8, incluso check Orchestrator Layer
- `npm run audit:ai-control-plane` -> 21/21 + audit collegati verdi
- `git diff --check` -> verde
- `npm run post-modifiche` -> typecheck, lint e 1430/1430 test Vitest verdi
- `npm run audit:git-automation` -> commit `REVIEW`, push `BLOCKED` per working tree misto pre-esistente

### Esito

Il requisito e' ora tracciato come architettura: skill-finder, session-prompt, context-handoff e routing registry sono componenti dell'orchestrator, non il layer stesso.

## 2026-05-08 — Hardening operativo ragionamento 360 e lista AI

### Obiettivo

Verificare se la modifica "ragionamento 360" aveva senso e trasformarla da principio generico a protocollo operativo. Rendere poi tutti i punti aperti della lista AI piu' espliciti con la stessa logica: quando scattano, cosa producono e cosa non devono promettere.

### Interventi eseguiti

- Riscritto il principio madre in `docs/AI_MASTER_SYSTEM_SPEC.md` come protocollo con scopo, trigger obbligatori, modello della situazione, fonte corretta, generalizzazione degli esempi, previsione problemi, scelta primitive, output minimo e limiti.
- Rafforzato `docs/AI_RUNTIME_BRIEF.md` con un digest runtime del protocollo 360, incluso output minimo e limiti anti-false-completion.
- Esteso `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md`: ogni sezione aperta ora deve avere anche `Trigger operativo`, `Output atteso` e `Limiti / non-goals`.
- Esteso `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md`: ogni item aperto ora deve avere anche `Trigger`, `Output` e `Limiti`.
- Rafforzato `src/scripts/aiListCompletenessAudit.ts` per fallire se backlog madre o vista lineare tornano a punti generici senza trigger/output/limiti.
- Rafforzato `src/scripts/aiControlPlaneAudit.ts` per proteggere nei canonici il protocollo 360, non solo la frase "ragionamento 360".

### Verifica

- `npm run audit:ai-list-completeness` -> 7/7
- `npm run audit:ai-control-plane` -> 21/21 + audit collegati verdi
- `git diff --check` -> verde
- `npm run post-modifiche` -> primo run con unhandled Vitest `EnvironmentTeardownError` transient dopo 1430/1430 test passati; secondo run verde con typecheck, lint e 1430/1430 test passati

### Esito

La modifica ha senso, ma solo nella forma operativa introdotta qui. Il rischio residuo resta comportamentale: serve ancora test reale con prompt denso incompleto e review di un loop completo prima di dire che il comportamento AI e' validato end-to-end.

## 2026-05-07 — Audit completo hook e fix auto-commit trigger

### Obiettivo

Controllare tutti gli hook attivi, capire se ne mancano altri da creare e correggere i gap reali invece di aggiungere hook generici.

### Interventi eseguiti

- Mappati i 32 command hook configurati in `~/.claude/settings.json`.
- Identificato gap reale: `audit:hooks` verificava solo 14 hook critici storici, non tutto il set attivo.
- Esteso `src/scripts/hooksConformityAudit.ts` per verificare:
  - tutti i target configurati esistono
  - i 32 command hook attesi sono presenti con evento e matcher corretti
  - `post-edit-request-action.ps1` non usa `git add .` e non usa `--no-verify`
  - `post-edit-request-action.ps1` richiede `post-modifiche`, `audit:git-automation:strict:commit` e `audit:git-automation:strict:push`
- Collegato `audit:hooks` dentro `audit:ai-control-plane`.
- Corretto `C:\Users\albie\.claude\hooks\post-edit-request-action.ps1`:
  - rimosso staging cieco
  - rimosso bypass `--no-verify`
  - aggiunti gate `post-modifiche` e `audit:git-automation:strict:*`
- Riallineati `AGENTS.md`, `docs/tracking/AI_HOOK_ENFORCEMENT_PLAN.md`, `AI_MASTER_IMPLEMENTATION_BACKLOG.md` e `AI_IMPLEMENTATION_LIST_GLOBAL.md`.

### Verifica

- `npm run pre-modifiche` -> verde prima delle modifiche
- `npm run audit:hooks` -> 17/17
- `npm run audit:rule-enforcement` -> 41/54 enforced, 0 gap meccanizzabili
- `pwsh -NoProfile -ExecutionPolicy Bypass -File C:\Users\albie\.claude\hooks\post-edit-request-action.ps1` -> exit 0 senza trigger
- `npm run audit:ai-control-plane` -> 21/21 + hooks + routing + L2-L6 + lista AI
- `npm run post-modifiche` -> typecheck, lint e 1430/1430 test Vitest verdi
- `git diff --check` -> verde

### Esito

Set hook corrente verificato. Nessun nuovo hook da creare adesso: i gap reali erano audit incompleto e auto-commit trigger troppo permissivo.

## 2026-05-07 — Completamento lista sistema AI globale

### Obiettivo

Rendere completa, esplicita e operativa solo la lista del sistema AI globale, separandola dal backlog applicativo LinkedIn.

### Interventi eseguiti

- Riscritto `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md` come backlog AI-only con 13 sezioni uniformi: problema reale, stato attuale, primitive corrette, ordine logico, sottopunti, done criteria e verifiche.
- Rimosso dal backlog AI il contenuto applicativo LinkedIn-specifico: runtime bot, proxy, JA3, dashboard, staging account reali e anti-ban operativo del bot restano fuori scope e nei backlog specialistici.
- Riscritta `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md` come vista lineare derivata, senza completati dentro gli aperti e con lo stesso livello operativo minimo per ogni item.
- Aggiornato `todos/active.md` per rendere prioritaria la completezza della lista AI globale e dichiarare fuori scope il backlog LinkedIn applicativo.
- Creato `src/scripts/aiListCompletenessAudit.ts` e aggiunto `audit:ai-list-completeness`.
- Collegato `audit:ai-list-completeness` a `audit:ai-control-plane`.

### Verifica

- `npm run pre-modifiche` -> verde prima delle modifiche
- `npm run audit:ai-list-completeness` -> 5/5
- `npm run audit:ledger` -> 14/14
- `npm run audit:ai-control-plane` -> 21/21 + routing + L2-L6 + lista AI
- `npm run post-modifiche` -> typecheck, lint e 1430/1430 test Vitest verdi

### Esito

Lista AI globale completata nel formato operativo richiesto. Resta fuori scope il backlog applicativo LinkedIn, che non e' stato ampliato.

## 2026-05-07 — Hardening control plane AI, hook audit e runtime brief

### Obiettivo

Rendere il sistema AI meno dipendente dalla memoria del modello: capire quali hook servono davvero, correggere errori negli audit e rinforzare routing, requirement ledger, no-false-completion, web policy, loop e context handoff.

### Interventi eseguiti

- Espanso `docs/AI_RUNTIME_BRIEF.md` con requirement ledger, esempi come pattern, no hallucination, fonte di verita', web policy, capability gap, blast radius, context degradation e chiusura L1-L9.
- Corretto falso negativo negli audit hook: `hooksConformityAudit.ts` e `aiControlPlaneAudit.ts` ora accettano sia `-HookEventName UserPromptSubmit` sia argomento posizionale `UserPromptSubmit`.
- Aggiornato `aiControlPlaneRegistry.ts` con capability kind `plugin`, `agent`, `cli` e source of truth `session-state`.
- Aggiornato `docs/tracking/AI_CAPABILITY_ROUTING.json` con capability `context-handoff` e `session-prompt`.
- Ripristinata skill globale Claude `context-handoff` in `C:\Users\albie\.claude\skills\context-handoff\skill.md`.
- Creato `docs/tracking/AI_HOOK_ENFORCEMENT_PLAN.md` con lista hook operativi, errori trovati e criteri per decidere cosa deve diventare hook.
- Riscritto `SESSION_HANDOFF.md` in forma operativa: file da leggere in nuova chat, obiettivi, decisioni, blast radius, stato, verifiche, blocchi, prossimi passi e prompt minimo.
- Reso esplicito nei backlog il punto "validare trasferimento contesto in nuova chat", distinguendo meccanismo presente da validazione end-to-end ancora aperta.

### Verifica

- `npm run pre-modifiche`
- `npm run audit:hooks` -> 14/14
- `npm run audit:ai-control-plane` -> 21/21 + routing + L2-L9 verdi
- `npm run audit:rule-enforcement` -> 29/42 enforced, 0 gap meccanizzabili
- `npm run audit:ledger` -> 14/14
- `npm run audit:routing` -> registry valido, 36 capability, 15 domini
- `npm run audit:skills` -> 5/5 skill critiche

### Esito

Control plane AI riallineato. Il numero operativo attuale e' 22 hook logici: non vanno aumentati senza miss ricorrenti misurati. Il prossimo passo non e' aggiungere hook generici, ma misurare violazioni reali e promuovere solo controlli deterministici che falliscono spesso.

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


## 2026-05-07 — Integrazione requisiti immagini Agent Development Kit

### Obiettivo

Integrare nella lista AI globale i punti contenuti nelle immagini WhatsApp fornite dall'utente, senza trasformarli in backlog applicativo LinkedIn.

### Input analizzato

- `WhatsApp Image 2026-05-06 at 23.43.12.jpeg`
- `WhatsApp Image 2026-05-06 at 23.43.12 (1).jpeg`
- `WhatsApp Image 2026-05-06 at 23.43.12 (2).jpeg`
- `WhatsApp Image 2026-05-06 at 23.43.12 (3).jpeg`
- `WhatsApp Image 2026-05-06 at 23.43.12 (4).jpeg`
- `WhatsApp Image 2026-05-06 at 23.43.12 (5).jpeg`

Nota: le immagini presenti coprono slide 1/7-6/7; la slide 7/7 non risulta presente tra i file locali trovati.

### Requisiti estratti

- Il sistema AI va governato come Agent Development Kit a 5 layer: rules/memory, skill, hook, subagent, plugin/distribution.
- Le regole globali e di progetto devono distinguere chiaramente cosa vive a livello globale e cosa vive nella repo.
- Le skill devono avere struttura standard: `SKILL.md`, `scripts/`, `templates/`, `assets/`, trigger descrittivo e contesto minimo.
- Gli hook devono restare guardrail deterministici, non ragionamento AI mascherato.
- I subagent devono avere un job specifico, contesto proprio, strumenti/permessi propri e un singolo risultato di ritorno.
- I plugin devono diventare il mezzo di distribuzione riusabile: manifest, versione, provenance, skill/hook/subagent/comandi inclusi e installazione team/repo.
- Gli MCP restano strumenti esterni e non vanno confusi con skill, hook o plugin.

### Interventi eseguiti

- Aggiornati `AI_MASTER_IMPLEMENTATION_BACKLOG.md` e `AI_IMPLEMENTATION_LIST_GLOBAL.md` per rendere esplicito il modello ADK a 5 layer nella governance capability.
- Esteso il punto cleanup/bootstrap/riuso con pacchetto ADK installabile, `plugin.json`, manifest/versione/provenance e simulazione installazione.
- Aggiornato `todos/active.md` con priorita' viva sul modello Agent Development Kit a 5 layer.
- Esteso `audit:ai-list-completeness` per fallire se i requisiti ADK spariscono da backlog madre o vista lineare.

### Verifica

- `npm run audit:ai-list-completeness` passato, incluso controllo ADK a 5 layer
- `npm run audit:ai-control-plane` passato
- `npm run post-modifiche` passato: typecheck backend/frontend, lint e 1430 test Vitest verdi
- `git diff --check` passato


## 2026-05-08 — Hook post-edit per codebase hygiene

### Obiettivo

Rendere operativo il nuovo punto della lista AI: dopo ogni ragionamento/modifica il sistema deve valutare se la codebase resta pulita e coerente, non solo se il singolo file modificato funziona.

### Interventi eseguiti

- Creato `post-edit-codebase-hygiene.ps1` come hook advisory globale su Edit/Write/MultiEdit.
- Aggiornato `~/.claude/settings.json` per eseguire il controllo dopo ogni modifica file.
- Aggiornati canonici AI, runtime brief, operating model, AGENTS.md e piano hook per dichiarare il requisito su file diretti, file indiretti, duplicati, obsoleti, split, rename, delete e follow-up.
- Estesi `audit:hooks`, `audit:ai-list-completeness` e `audit:ai-control-plane` per non perdere il requisito.

### Stato residuo

- Il hook e' advisory, non blocking: puo' obbligare la valutazione, ma non puo' decidere da solo cancellazioni o refactor invasivi.
- Le pulizie invasive restano da fare solo dopo conferma o con follow-up tracciato nel backlog corretto.

### Verifica

- `npm run audit:hooks` passato: 17/17 check
- `npm run audit:ai-list-completeness` passato: 9/9 check, incluso codebase hygiene
- `npm run audit:ai-control-plane` passato: 22/22 check docs/control-plane + audit collegati
- `npm run post-modifiche` passato: typecheck backend/frontend, lint e 1430 test Vitest verdi
- `git diff --check` passato


## 2026-05-07 — Governance ADK capability e audit dedicato

### Obiettivo

Avviare l'implementazione reale del blocco 3 della lista AI: governance di skill, MCP, plugin, hook, subagent, script, workflow e candidate esterne secondo il modello Agent Development Kit.

### Interventi eseguiti

- Creato `docs/tracking/AI_ADK_CAPABILITY_GOVERNANCE.json`.
  - Definisce i 5 layer ADK: rules/memory, skill, hook, subagent, plugin/distribution.
  - Distingue surface esterne: MCP, script/audit, workflow, fonti repo/web e CLI.
  - Classifica tutte le capability presenti in `AI_CAPABILITY_ROUTING.json` con layer, scope, primitive, trigger, limiti, decisione, relazione e verifica.
  - Registra Caveman, LeanCTX, SIMDex e Contact Skills come candidate `evaluate-before-install`, senza installazione cieca.
- Creato `src/scripts/adkCapabilityGovernanceAudit.ts`.
  - Verifica standard minimi per skill, hook, subagent e plugin.
  - Verifica che ogni capability del routing abbia un placement ADK.
  - Verifica che le candidate esterne restino gated prima dell'installazione.
- Aggiunto `npm run audit:adk-capabilities` e incluso in `audit:ai-control-plane`.
- Aggiornati runtime brief, operating model, master spec, backlog madre, vista lineare e tracking README.

### Stato residuo

- Da fare: valutazione qualitativa vera dei duplicati e degli overlap.
- Da fare: decisione effettiva su Caveman, LeanCTX, SIMDex e Contact Skills.
- Da fare: creare manifest/plugin installabile reale e simulare installazione in progetto vuoto.

### Verifica

- `npm run audit:adk-capabilities` passato: 4/4 check, 36 capability routing classificate + 1 plugin packaging pianificato
- `npm run audit:ai-control-plane` passato
- `npm run audit:ai-list-completeness` passato
- `npm run post-modifiche` passato: typecheck backend/frontend, lint e 1430 test Vitest verdi
- `git diff --check` passato


## 2026-05-08 — Principio madre ragionamento 360 e controllo dominio

### Obiettivo

Rendere esplicito il punto centrale emerso dalla chat: il sistema AI non deve limitarsi agli esempi o alla richiesta letterale, ma deve costruire un modello completo della situazione, studiare il dominio e prevedere problemi diretti e indiretti.

### Interventi eseguiti

- Aggiornato `docs/AI_MASTER_SYSTEM_SPEC.md` con il principio madre: ragionamento 360 e controllo del dominio.
- Aggiornato `docs/AI_RUNTIME_BRIEF.md` per reiniettare il principio a runtime: modello della situazione, domini correlati, problemi prevedibili e studio con internet/docs ufficiali/MCP/tool live quando serve.
- Aggiornati `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md` e `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md` nel punto 6, rendendo il requisito operativo e verificabile.
- Aggiornato `docs/AI_OPERATING_MODEL.md` per dichiarare lo stato corrente da non contraddire.
- Estesi `aiListCompletenessAudit.ts` e `aiControlPlaneAudit.ts` per fallire se il principio madre sparisce dai canonici.

### Stato residuo

- Da fare: test comportamentale reale con prompt denso incompleto.
- Da fare: checklist/audit finale contro false completion su task lunghi.
- Da fare: trasformare i miss ricorrenti in hook/audit solo dove esiste segnale deterministico.

### Verifica

- `npm run audit:ai-list-completeness` passato: 7/7, incluso check "Ragionamento 360"
- `npm run audit:ai-control-plane` passato
- `npm run post-modifiche` passato: typecheck backend/frontend, lint e 1430 test Vitest verdi
- `git diff --check` passato


## 2026-05-09 — Stop hook per continuita proattiva

### Obiettivo

Rendere la chiusura proattiva una primitive reale, non solo una regola testuale: ogni risposta operativa deve lasciare prossimo passo concreto, blocco reale o domanda specifica.

### Interventi eseguiti

- Creato `~/.claude/hooks/stop-proactive-next-step.ps1` come `Stop` hook sync advisory.
- Registrato il hook in `~/.claude/settings.json` e nella fonte canonica `~/.claude/scripts/model-router-config.mjs`.
- Aggiornati AGENTS, runtime brief, master spec, backlog/lista AI, hook README e piano enforcement.
- Estesi `audit:hooks` e `audit:ai-control-plane` per verificare script, settings e fonte canonica.

### Stato residuo

- Il hook e' advisory: reinietta e logga l'obbligo, ma non legge semanticamente ogni risposta finale.
- Un eventuale blocking hook richiede prima metriche affidabili su false completion o miss ripetuti.

### Verifica

- Smoke test diretto hook passato: `stop-proactive-next-step.ps1` emette `systemMessage` con `PROACTIVE_NEXT_STEP_GATE`.
- `npm run audit:hooks` passato: 17/17 check, incluso `Stop hook (session log + continuita)`.
- `npm run audit:ai-control-plane` passato: 25/25 docs/control-plane + audit collegati.
- `npm run audit:ai-list-completeness` passato: 10/10 check.
- `npm run post-modifiche` passato: typecheck backend/frontend, lint e 1430 test Vitest verdi.
- `git diff --check` passato.


## 2026-05-11 — Validazione reale ripresa nuova chat

### Obiettivo

Verificare che una nuova sessione riesca a ripartire dal sistema di memoria e handoff senza chiedere a Riccardo di rispiegare contesto, stato o blocchi aperti.

### Interventi eseguiti

- Avviata nuova sessione Codex con prompt `resume`.
- Letti i file obbligatori di memoria globale e `todos/active.md`.
- Letti `SESSION_HANDOFF.md`, `.claude/CONTINUATION.md`, `AGENTS.md`, `docs/AI_RUNTIME_BRIEF.md`, backlog e worklog rilevanti.
- Verificato lo stato git reale: `main` allineato a `origin/main` su `99c9eb5`; restano solo 6 immagini WhatsApp untracked in root.
- Aggiornati `SESSION_HANDOFF.md`, backlog AI, vista lineare, `todos/active.md` e memoria globale active per registrare la prima prova passata e il residuo anti-staleness.
- Aggiornato `.claude/SESSION_PROMPT.md` ignorato da git per rimuovere contenuto stale del 2026-05-06.

### Stato residuo

- Il trasferimento chat ha una prova reale passata, ma resta aperto il controllo anti-staleness di `SESSION_HANDOFF.md` / `.claude/SESSION_PROMPT.md` dopo nuovi commit o cambi working tree.
- Le 6 immagini WhatsApp untracked restano fuori scope e non vanno incluse in commit ciechi.

### Verifica

- `npm run pre-modifiche` passato: typecheck backend/frontend, ESLint e 1430 test Vitest verdi.
- `npm run post-modifiche` passato: typecheck backend/frontend, ESLint e 1430 test Vitest verdi.
- `npm run audit:ai-control-plane` passato: 25/25 control-plane, 17/17 hook, routing/adk/L2-L9/list completeness verdi.
- `npm run conta-problemi` passato: typecheck backend/frontend, ESLint e 1430 test Vitest verdi.
- `git diff --check` passato.
