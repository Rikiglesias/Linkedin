# Engineering Worklog

Questo file tiene traccia dei blocchi tecnici realmente analizzati, provati o verificati nel repo.

Archivio mensile: [2026-04](ENGINEERING_WORKLOG_2026-04.md).

## 2026-06-07 — Med-triage: classificazione 142 medium + Ondata 1 fix (`/goal backend-med-triage`)

### Obiettivo
Triage dei 142 finding MEDIUM del Backend Deep Audit: classificare (FIX-NOW/CONFIRM-USER/DEFER/ALREADY-FIXED) e fixare i FIX-NOW non-anti-ban con test, `conta-problemi`=0, senza toccare file anti-ban né del peer.

### Interventi
- **Triage completo** dei 142 medium per categoria → `~/todos/backend-med-triage.md` (self-contained, con regole e ondate). La maggior parte degli anti-ban è CONFIRM-USER; refactor grandi DEFER.
- **Ondata 1 (5 fix FIX-NOW)**:
  - `security/redaction.ts`: `API_KEY_PATTERN` ora copre il separatore trattino (`sk-`, `sk-ant-`, `sk-proj-`) oltre all'underscore → niente leak di chiavi OpenAI/Anthropic nei log/Sentry.
  - `ai/leadDataCleaner.ts`: `escapeRegExp` sul nome non fidato prima di `new RegExp()` nel fallback → niente crash su metacaratteri.
  - `scripts/gdprRetentionCleanup.ts`: `deleteLead`/`anonymizeLead`/`runRightToErasure` avvolti in `withTransaction` → atomicità (chiude il follow-up "wrap transazionale erasure" tracciato dal Batch A).
  - `telemetry/logger.ts`: `recordRunLog` isolato in try/catch → un errore di scrittura DB non rompe più `publishLiveEvent`/il chiamante.
  - `cloud/telegramAiImporter.ts`: validazione URL Sales Navigator via `new URL()`+hostname esatto (era `includes('linkedin.com/sales')` aggirabile).

- **Ondata 2 (3 fix correttezza leadsCore, non anti-ban)**:
  - `hasOtherAccountTargeted`: match `leadId` delimitato (`,%`/`}%`) → niente collisione substring 42↔420 nella deconfliction multi-account.
  - `promoteNewLeadsToReadyInvite`: `UPDATE ... AND status='NEW'` → niente clobber se lo status cambia tra SELECT e UPDATE.
  - `appendLeadEvent`: `JSON.stringify` del metadata in try/catch (fallback `{}`) → niente crash su riferimenti circolari.

### Stato reale
- Triage 142/142 classificato. Ondata 1 (5 fix, +9 test) e Ondata 2 parziale (3 fix, +3 test) applicate e committate. Restano: Ondata 2 residua (addLead/leadsLearning/featureStore — richiedono infra DB-test), Ondate 3-4. Nessun file anti-ban/peer toccato. Push da coordinare col peer.

### Verifica
- `npm run conta-problemi`: exit 0 (typecheck BE+FE + lint + 1471 test). Suite mirata Ondata 1: 22/22.

## 2026-06-07 — Batch B audit backend: 8 bug HIGH non-anti-ban (prod-DB + security)

### Obiettivo

Remediation degli 8 bug HIGH non-anti-ban del Backend Deep Audit 2026-06-06 (`/goal backend-bugs`): fix + test mirato per ognuno, `npm run conta-problemi` a 0, senza toccare file anti-ban (`src/browser|risk|proxy|salesnav|fingerprint`, `scheduler.ts`).

### Interventi eseguiti

- **T1** `db.ts`: `normalizeSqlForPg` ora traduce `DATE('now','±'||$n||' days')` con parametro bound (sbloccava `sessionMemory.getSessionHistory` su Postgres) e include `STRFTIME→EXTRACT`. **Root cause**: il metodo runtime `normalizeSql` e la funzione testata `normalizeSqlForPg` erano due copie divergenti (STRFTIME solo nel metodo) → rischio falso-verde test-vs-runtime. Unificato: `normalizeSql` ora delega a `normalizeSqlForPg` (rimosso `adaptParams` orfano, −55 righe duplicate).
- **T2** `stats.ts`: `getAccountAgeDays` gestisce `string | Date` (`raw instanceof Date ? raw : new Date(...Z)`) → niente NaN su Postgres (node-postgres ritorna Date).
- **T3** `leadsCore.ts`: GIÀ risolto in codebase (`upsertSalesNavigatorLead`/`applyControlPlaneCampaignConfigs` usano `withTransaction`; rollback reale in `PostgresManager.withTransaction`). Spec stale. Aggiunto test di copertura.
- **T4** `system.ts`: `cleanupPrivacyData` cancella le 7 tabelle figlie di `leads` mancanti (salesnav_list_items, ml_feature_store, challenge_events, lead_campaign_state, lead_intents, lead_enrichment_data, prebuilt_messages) PRIMA del padre, dentro la transazione (su Postgres la FK bloccava la DELETE → rollback → purge mai eseguito). Set allineato a `deleteLead()`.
- **T5** `telegramListener.ts`: `processTelegramMessage` fail-closed (chatId non configurato → rifiuta). Esportata per test.
- **T6** `server.ts` + nuovo `api/wsAuth.ts`: `/ws` richiede auth quando `dashboardAuthEnabled` (prima gated solo su apiKey → basic-auth-only lasciava il WS aperto). `isWebSocketAuthorized` (token query/Bearer/x-api-key/Basic) estratta per SRP+testabilità.
- **T7** `sentry.ts`: `captureError` sanitizza il payload via `sanitizeForLogs` prima di `Sentry.captureException` (choke-point unico) → niente PII/secret a Sentry.
- **T8** `orchestrator.ts` + `accountManager.ts`: `runWorkflow` salva/ripristina l'override account in `try/finally` (estratto `runWorkflowInternal`); aggiunto getter `getOverrideAccountId`. Niente leak cross-account su early return/throw.

### Stato reale dopo il blocco

- 8/8 fix applicati inline. +24 test mirati (costruiti per fallire senza il fix). Commit `1555a60` (17 file, +538/−70). Nessun file anti-ban toccato.
- Push NON eseguito: branch `refactor/adk-split` condiviso col peer adk-split/codex + aree security/DB ad alto rischio → coordinamento/PR richiesti.

### Verifica

- `npm run conta-problemi`: exit 0 (typecheck BE+FE + lint `--max-warnings 0` + 1462 test).
- Suite mirata dei fix: 43/43 verdi.

## 2026-06-04 — Chiusura sottopunti backlog AI punto 8 (parità) e punto 10 (git/review)

### Obiettivo

Completare i sottopunti operativi aperti di #8 (parità ambienti Claude Code/Codex) e #10 (git/review/chiusura blocchi fuori Claude Code), con prova reale e fonte aggiornata — non spuntare a sentimento.

### Interventi eseguiti

- Creato `.codex/smoke-test-hooks.ps1` + npm script `audit:codex-hook-smoke`: esercita ogni hook Codex con input simulato e verifica la decisione reale (anti-ban/secrets/git block + advisory). Chiude la verifica "smoke task comparativi" mancante del punto 8. Root cause risolta in fase di sviluppo: powershell.exe 5.1 legge i file senza BOM come ANSI (script reso ASCII-only) e il pipe stringa→child è inaffidabile per ConvertFrom-Json in 5.1 (stdin passato via `Start-Process -RedirectStandardInput` da temp file, più fedele all'OS-pipe usato da Codex reale).
- Corretto drift interno in `.codex/hooks/codex-runtime-context.ps1`: la sezione CODEX_PARITY dichiarava gap GIÀ chiusi (PreToolUse Edit "0 hook", post-edit hygiene "assente", sync Obsidian "non configurato"). Riallineata ai gate attivi reali + gap residui STRUTTURALI veri (GAP-1 memoria non auto-letta, GAP-3 PreCompact, switch modello manuale, Cloud Code). Corretta anche la riga "Sync memoria: manuale" (ora automatico via codex-stop-check).
- Riscritto `docs/PARITY_MATRIX.md` (era 2026-06-01, stale): GAP-2/GAP-4/GAP-5 marcati CHIUSI con hook che li chiude e prova smoke; GAP-1/GAP-3 mitigati con gap residuo dichiarato; tabella hook allineata allo stato reale (codex-edit-gate, codex-post-edit, codex-bash-gate, codex-post-tool-review); nuova sezione "Model/provider switching Codex" (limite strutturale governato, chiude sottopunto #8 "stabilizzare provider switching").
- Aggiunta sezione "Livelli di review: locale / branch / audit periodico" in `.claude/rules/git-commit-push.md` (chiude sottopunto #10 "distinguere review locale/branch/audit periodico", unico gap reale di #10; gli altri 4 erano già coperti dalla regola).
- Aggiornati backlog madre `AI_MASTER_IMPLEMENTATION_BACKLOG.md` e vista lineare `AI_IMPLEMENTATION_LIST_GLOBAL.md`: #8 sottopunti operativi → [x] con prova; #10 tutti i 5 sottopunti → [x] con prova; Status onesti (8 = parziale con gap strutturali residui + 1 verifica end-to-end utente; 10 = chiuso sottopunti).

### Stato reale dopo il blocco

- Punto 8: sottopunti operativi chiusi e verificati. Gap residui STRUTTURALI dichiarati non normalizzati (GAP-3 PreCompact opaco, Cloud Code non coperto, switch modello manuale) + verifica end-to-end in sessione Codex reale = passo utente.
- Punto 10: sottopunti operativi chiusi e verificati cross-ambiente (Claude + Codex).

### Verifica

- `npm run audit:codex-hook-parity`: 3/3.
- `npm run audit:codex-hook-smoke`: 13/13 (anche via npm).
- `npm run audit:ai-reasoning-hardening`: 8/8.
- `npm run audit:ai-list-completeness`: 10/10.
- `npm run audit:ai-backlog-consistency`: 3/3.
- `npm run audit:git-automation`: commit READY, push BLOCKED (working tree dirty — comportamento corretto).

## 2026-06-01 — Audit zero-trust dei 13 punti AI

### Obiettivo

Ricontrollare uno per uno i 13 punti del Cervello AI senza fidarsi di checkbox/backlog, creare un report canonico con evidenze e aggiungere un gate che blocchi drift tra backlog madre, vista lineare e `active.md`.

### Interventi eseguiti

- Creato `docs/tracking/AI_POINT_BY_POINT_AUDIT_2026-06-01.md`: tabella zero-trust per ogni sottopunto con fonte, evidenza, stato reale, mancanza, miglioramento e verifica richiesta.
- Rimosso da `~/.claude/settings.json` il hook legacy `PostCompact -> post-compact-restore-openrouter.ps1`; la decisione router corrente dice che il vecchio restore OpenRouter e `/or:compact` non devono tornare.
- Aggiornato `~/.claude/CAPABILITY_INVENTORY.md` per spostare il PostCompact restore tra le esclusioni, non tra gli hook attivi.
- Riallineati `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md` e `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md`: stesso conteggio checkbox per tutti i 13 punti, con criteri conservativi zero-trust.
- Aggiunto `src/scripts/aiBacklogConsistencyAudit.ts` e script `audit:ai-backlog-consistency`; incluso nel bundle `audit:ai-control-plane`.
- Aggiunta regola globale "fatto da noi non significa best practice" in `~/.claude/CLAUDE.md`, `AGENTS.md` e `docs/AI_RUNTIME_BRIEF.md`.
- Aggiornati `todos/active.md` repo-side e globale con snapshot `ZERO_TRUST_AI_AUDIT`.
- Rivalutate e aggiornate 6 project memory stale come snapshot storici o fonti non autoritative.
- Eseguito sync Obsidian memory->vault dopo le modifiche a canonici e memoria.

### Stato reale dei 13 punti

- Chiuso provato: 1, 5.
- Parziale: 2, 3, 4, 6, 8, 11, 13.
- Aperto reale: 7, 9, 10, 12.
- Obsoleto/duplicato: PostCompact restore OpenRouter legacy rimosso.

### Verifica

- `npm run pre-modifiche --silent`: 137 file test, 1430 test passati.
- `npm run audit:hooks --silent`: 17/17.
- `npm run audit:ai-control-plane --silent`: bundle completo verde, incluso `audit:ai-backlog-consistency`.
- `npm run audit:memory-staleness --silent`: 12/12, nessuna memoria stale.
- `npm run audit:obsidian-vault --silent`: 5/5 dopo sync `sync-memory-to-obsidian.mjs --verbose`.
- `npm run audit:codex-hook-parity --silent`: 2/2.

### Stato

DONE per il blocco audit/gate. Restano volutamente aperti i punti zero-trust non provati; non sono stati marcati chiusi a sentimento.

---

## 2026-05-17 — /goal 1 Cat 11 dedupe audit:monthly

### Obiettivo

Eseguire `/goal 1` dalla queue `AI_GOAL_QUEUE.md`: rimuovere duplicato `audit:adk-capabilities` da script `audit:monthly` in package.json.

### Problema verificato

`audit:monthly` invocava `audit:adk-capabilities` direttamente E indirettamente via `audit:ai-control-plane`, causando doppia esecuzione (~2-3 secondi sprecati + log doppio).

### Fix applicato

Rimosso `&& npm run audit:adk-capabilities` dallo script `audit:monthly` (già coperto da `audit:ai-control-plane`).

### Verifica end-to-end

- `npm run audit:monthly` eseguito: `audit:adk-capabilities` ora appare 1 sola volta nel log.
- Tutti i sotto-audit passano: ai-control-plane 25/25, hooks 17/17, adk-capabilities 4/4, ai-list-completeness 10/10, rule-enforcement, ledger 14/14, skill-activation.
- Caller esterni invariati: `scripts/run-audit-monthly.bat` (Task Scheduler), `plugin.json` registry.

### Stato

DONE. /goal 1 chiuso al primo turno (era 3 max). Sposta entry in "Completati" di AI_GOAL_QUEUE.md.

---

## 2026-05-16 — Ripresa problemi contesto e audit AI 9-13

### Obiettivo

Riprendere il lavoro dalla chat vecchia usando il contesto reale e chiudere i problemi aperti emersi dagli audit: handoff/session prompt, categorie 9-13 del report best practice AI, wrapper scheduler, gitignore runtime e tracking docs troppo lunghi.

### Interventi eseguiti

- Completate nel report `AI_BEST_PRACTICE_AUDIT_2026-05.md` le categorie 9-13: audit TypeScript, wrapper `.bat`, npm scripts, `.gitignore`, tracking docs.
- Corretti `scripts/run-audit-weekly.bat` e `scripts/run-audit-monthly.bat`: preservano `%ERRORLEVEL%`, loggano `Exit code`, usano `Get-Date -Format yyyyMMdd`.
- Aggiunto `data/restore-drill/` a `.gitignore`, eliminando il warning `Permission denied` da `git status`.
- Creato `C:\Users\albie\memory\MEMORY.md` e aggiunto frontmatter mancante a `C:\Users\albie\memory\CLAUDE.md` e alla memoria progetto `research_dump.md`.
- Split di `ENGINEERING_WORKLOG.md`: entries 2026-04 archiviate in `ENGINEERING_WORKLOG_2026-04.md`.
- Aggiornato `SESSION_HANDOFF.md` al blocco 2026-05-16.

### Stato residuo

- Restano warning advisory: memorie stale da rivalutare, documenti sopra soft limit ma sotto hard limit.
- `audit:handoff-staleness` va rieseguito dopo aggiornamento di `.claude/SESSION_PROMPT.md`, perche' il working tree e' dirty durante questo blocco.

### Verifica

- `npm run audit:docs-size`: nessun file oltre hard limit.
- `npm run audit:memory-staleness`: indice e frontmatter coerenti; restano solo warning stale.
- `npm run audit:handoff-staleness`: 6/6 dopo aggiornamento session prompt.
- `cmd /c scripts\run-audit-weekly.bat`: exit code 0, log scritto in `C:\Users\albie\memory\audit-weekly-20260516.log`.
- `cmd /c scripts\run-audit-monthly.bat`: exit code 0, log scritto in `C:\Users\albie\memory\audit-monthly-20260516.log`.
- `npm run post-modifiche`: verde, 137 file test e 1430 test Vitest passati.
- `npm run conta-problemi`: verde, 137 file test e 1430 test Vitest passati.

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


## 2026-05-17 — AI reasoning hardening, continuation e Codex hook parity

### Obiettivo

Rendere verificabile il sistema AI globale per ragionamento, scelta automatica di skill/capability/fonti, hook, continuation e truthful completion. Il perimetro e' solo control plane AI: non LinkedIn applicativo, n8n produzione, Whisper o problemi hardware.

### Interventi eseguiti

- Creato `docs/tracking/AI_ORCHESTRATOR_CONTRACT.md`.
  - Copre intento reale, input come ipotesi, esempi come pattern, decomposizione ricorsiva, root cause, fonte di verita, capability routing, modello/ambiente, blast radius L2-L9, cross-domain e truthful completion.
  - Esplicita Hook Coverage per `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact` e `Stop`.
- Creato `src/scripts/aiReasoningHardeningAudit.ts`.
  - Scope: `orchestrator`, `reasoning`, `hook-coverage`, `continuation`, `codex`.
  - Verifica che contract, runtime brief, AGENTS, hook Claude, continuation e Codex parity restino allineati.
- Aggiunti hook Codex minimi in `.codex/hooks.json` e `.codex/hooks/*.ps1`.
  - `codex-runtime-context.ps1`: reinietta contratto e runtime context.
  - `codex-bash-gate.ps1`: gate shell/git minimo.
  - `codex-post-tool-review.ps1`: log/reminder post-tool.
  - `codex-stop-check.ps1`: stop gate leggero su false completion, continuation e dirty tree.
- Aggiornato `C:/Users/albie/.codex/config.toml` con `[features].hooks = true`, forma corrente indicata dalle docs OpenAI.
- Aggiornati `package.json`, `src/scripts/aiControlPlaneAudit.ts`, `AGENTS.md`, `docs/AI_RUNTIME_BRIEF.md`, `docs/tracking/README.md`, `docs/tracking/AI_HOOK_ENFORCEMENT_PLAN.md`, `docs/tracking/AI_GOAL_QUEUE.md`.
- Aggiornati `.claude/CONTINUATION.md` e `.claude/SESSION_PROMPT.md` per rimuovere placeholder e riflettere il working tree corrente.

### Stato residuo

- I hook Codex sono installati nel repo e la feature e' abilitata, ma la prova comportamentale end-to-end richiede una nuova sessione Codex dopo il reload.
- `PreCompact` non ha equivalente diretto Codex al 2026-05-17; mitigazione corrente: `Stop` + continuation/handoff audit.
- `audit:git-automation` blocca push e richiede commit locale coerente perche' il working tree e' dirty.

### Verifica

- `npm run audit:orchestrator-contract` passato: 1/1.
- `npm run audit:reasoning-trace` passato: 1/1.
- `npm run audit:hook-semantic-coverage` passato: 2/2.
- `npm run audit:continuation-completeness` passato: 1/1.
- `npm run audit:codex-hook-parity` passato: 1/1.
- `npm run audit:ai-reasoning-hardening` passato: 6/6.
- `npm run audit:ai-control-plane` passato: 26/26 + audit collegati verdi.
- `npm run audit:weekly` passato, con warning non bloccanti su memoria stale project e docs oltre soft limit.
- `npm run post-modifiche` passato: typecheck backend/frontend, ESLint e 1430 test Vitest verdi.
- `git diff --check` passato.


## 2026-05-17 — /goal 2 wrapper audit portabili

### Obiettivo

Chiudere `/goal 2` della coda AI: rendere `scripts/run-audit-weekly.bat` e `scripts/run-audit-monthly.bat` portabili per altri ambienti/progetti tramite `CLAUDE_REPO_ROOT`, mantenendo fallback compatibile con il path attuale.

### Interventi eseguiti

- Aggiornato `scripts/run-audit-weekly.bat`.
  - Usa `CLAUDE_REPO_ROOT` se definita.
  - Mantiene fallback a `C:\Users\albie\Desktop\Programmi\Linkedin`.
  - Valida che `%REPO_DIR%\package.json` esista prima di eseguire npm.
- Aggiornato `scripts/run-audit-monthly.bat` con la stessa logica.
- Aggiornato `scripts/README.md` con uso dei wrapper e comando `setx CLAUDE_REPO_ROOT`.
- Aggiornato `docs/tracking/AI_GOAL_QUEUE.md` segnando `/goal 2` come DONE.

### Stato residuo

- I task schedulati esistenti continuano a funzionare via fallback.
- Per renderli cross-project va impostata `CLAUDE_REPO_ROOT` a livello utente o macchina nel sistema che esegue Task Scheduler.

### Verifica

- `cmd /c scripts\run-audit-weekly.bat` con `CLAUDE_REPO_ROOT` impostata: exit code 0.
- `cmd /c scripts\run-audit-weekly.bat` senza `CLAUDE_REPO_ROOT`: exit code 0.
- `cmd /c scripts\run-audit-monthly.bat` con `CLAUDE_REPO_ROOT` impostata: exit code 0.


## 2026-05-17 — /goal 3 output styles user-scope

### Obiettivo

Chiudere `/goal 3`: spostare gli output styles riusabili da project-scope a user-scope, verificare Caveman e aggiungere audit dedicato.

### Interventi eseguiti

- Spostati `italian-concise.md` e `terse.md` da `.claude/output-styles/` a `C:\Users\albie\.claude\output-styles\`.
- Mantenuto `.claude/output-styles/README.md` come puntatore project-side verso la sede user-scope.
- Verificato stato Caveman: `C:\Users\albie\.claude\.caveman-active` e `caveman-state.txt` indicano `ultra`.
- Aggiornato `italian-concise.md` globale come override italiano per Caveman ultra.
- Creato `src/scripts/outputStylesAudit.ts`.
- Aggiunto `audit:output-styles` e integrato in `audit:weekly`.
- Aggiornati `AGENTS.md` e `src/scripts/aiControlPlaneAudit.ts` per riflettere la nuova primitive.

### Stato residuo

- Caveman non risulta come plugin abilitato nel `settings.json` corrente, ma i flag locali lo marcano `ultra`; per questo non e' stato rimosso.
- La selezione effettiva dello style resta azione Claude Code (`/output-style italian-concise` o config `outputStyle`), non forzata dal repo.

### Verifica

- Fonte ufficiale Claude Code: gli output styles user-level stanno in `~/.claude/output-styles`.
- `npm run audit:output-styles` passato: 3/3.
- `npm run audit:ai-control-plane` passato: 26/26 + audit collegati verdi.


## 2026-05-17 — /goal 4 MCP env var expansion

### Obiettivo

Chiudere `/goal 4`: rendere `.mcp.json` portabile usando env var expansion con default, aggiungere audit dedicato e verificare che gli MCP coinvolti si riconnettano.

### Interventi eseguiti

- Aggiornato `.mcp.json`.
  - `lean-ctx.command` usa `${LEAN_CTX_PATH:-C:\Users\albie\AppData\Local\lean-ctx\lean-ctx.exe}`.
  - `claude-peers.command` usa `${BUN_PATH:-C:\Users\albie\.bun\bin\bun.exe}`.
  - `claude-peers.args[0]` usa `${CLAUDE_PEERS_SERVER_PATH:-C:\Users\albie\AppData\Local\claude-peers-mcp\server.ts}`.
- Creato `src/scripts/mcpConfigAudit.ts`.
  - Valida JSON/schema minimo.
  - Valida transport coerente.
  - Blocca path machine-specific senza `${VAR:-default}`.
  - Risolve i default locali e verifica i path.
- Aggiunto `audit:mcp-config` a `package.json` e `audit:weekly`.
- Aggiornati `src/scripts/aiControlPlaneAudit.ts`, `docs/tracking/README.md` e `docs/tracking/AI_GOAL_QUEUE.md`.
- Corretto server esterno locale `C:\Users\albie\AppData\Local\claude-peers-mcp`:
  - `server.ts`: `fileURLToPath(new URL("./broker.ts", import.meta.url))` per path Windows corretto.
  - `broker.ts`: fallback `USERPROFILE` quando `HOME` non e' definita.

### Stato residuo

- `claude-context` resta failed in `claude mcp list`, ma e' fuori scope di `/goal 4` e non dipende da `.mcp.json`.
- Le patch a `C:\Users\albie\AppData\Local\claude-peers-mcp` sono locali/non versionate in questa repo; se il pacchetto viene reinstallato, vanno riportate upstream o tracciate in gestione tool globali.

### Verifica

- Fonte ufficiale Claude Code: `.mcp.json` supporta `${VAR}` e `${VAR:-default}` in `command`, `args`, `env`, `url`, `headers`.
- `npm run audit:mcp-config` passato: 4/4.
- `claude --version`: 2.1.143.
- `claude mcp get lean-ctx`: connected.
- `claude mcp get claude-peers`: connected.
- `claude mcp list`: `lean-ctx`, `symdex`, `code-review-graph`, `claude-peers` connected; `claude-context` ancora failed fuori scope.


## 2026-06-02 — Migrazione cambio chat a Obsidian

### Obiettivo

Migrare la regola di cambio chat dal metodo legacy `SESSION_HANDOFF.md` / `.claude/SESSION_PROMPT.md` alla continuita primaria basata su `~/memory`, `todos/active.md`, `.claude/CONTINUATION.md` e Obsidian `Resources/continuita`.

### Interventi eseguiti

- Esteso `C:\Users\albie\.claude\scripts\sync-memory-to-obsidian.mjs` per pubblicare `CONTINUATION-Linkedin.md`, `START-NEXT-CHAT.md` e i file legacy con banner di fallback.
- Riallineati hook globali Claude: `pre-compact-handoff.ps1`, `stop-session.ps1`, `post-bash-handoff-invalidate.ps1`, `session-start-continuation.ps1` e `_lib.ps1`.
- Riscritto `src/scripts/handoffStalenessAudit.ts`: stesso comando `audit:handoff-staleness`, nuova semantica Obsidian-first.
- Aggiornati canonici e registry: `AGENTS.md`, `.claude/rules/meta-reasoning.md`, `docs/AI_RUNTIME_BRIEF.md`, backlog/lista AI, `AI_CAPABILITY_ROUTING.json`, `AI_ADK_CAPABILITY_GOVERNANCE.json`, cadenze audit, change map e skill globali `context-handoff` / `session-prompt`.
- Aggiornate memoria globale e priorita correnti con la decisione: `SESSION_HANDOFF.md` e `.claude/SESSION_PROMPT.md` restano fallback legacy.

### Verifica

- `node C:\Users\albie\.claude\scripts\sync-memory-to-obsidian.mjs --verbose`: 19 memorie + 3 auto-memory + 7 canonici + 4 continuita, 0 fallite.
- `npm run audit:handoff-staleness`: 6/6.
- `npm run audit:obsidian-vault`: 5/5.
- `npm run audit:skills`: 5/5.
- `npm run audit:ai-list-completeness`: 10/10.
- `npm run audit:hooks`: 18/18.
- `npm run audit:ai-control-plane`: verde.
- `npm run conta-problemi`: typecheck, lint e 1430 test Vitest passati.
