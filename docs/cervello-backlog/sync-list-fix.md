# /goal sync-list-fix — sync-list E2E verde + fix doppio-lancio browser

> **CONFERMATO-APERTO 2026-07-04 — passata `todos-freddi`** (auditor opus, verifica alla fonte; verdetti integrali: `maintenance/2026-07-04-verdetti-todos-freddi.json`)
> Evidenza: Codice DONE e vivo a HEAD: fix A `waitForBrowserProcessExit` (commit ff4cffd → launcher.ts:907-908 + windowInputBlock.ts:95); fix B′ handoff canary→workflow (commit 95c77a3 → workflowEntryGuards.ts:255-282 reuseSession/GuardDecisionWithSession + salesNavigatorSync.ts:49,697-699 existingSession + orchestrator.ts:279), esteso ai jobRunner via AB11 82c6706; LAUNCH_TIMEOUT_MS=60_000 launcher.ts:178; test workflowEntryGuards.vitest.ts:263. Task4 RE-LOGIN chiuso (user-actions-pending.md:79). APERTO: r…
> Azione/causa: NON archiviare. Mantieni il file aperto e aggiungi in testa una riga "CONFERMATO-APERTO 2026-07-04 — solo residuo runtime user-gated; tutto il codice committato (ff4cffd/95c77a3/82c6706) e testato". Lascia [~]/[ ] su task 3, 3b/G1 e il FINDING NUOVO; segna esplicitamente che le PARTI CODICE di 3/3b/G1/G2-G5 sono DONE-verificate-a-HEAD (solo la VERIFICA RUNTIME resta). Prossimo passo concreto: dopo il run live analizzo il log per (a) esattamente 1 launchBrowser = canary riusato, (b) zero timeout 180s, (c) feed.global_nav passa (→ ambientale, chiudi) o fallisce ancora con login+rete OK (→ drift …


> Binding GOAL_TASK_BINDING. Creato 2026-06-10 durante run sync-list dal vivo.
> Contesto: run #1 BLOCCATO (timeout 180s al 2° launchPersistentContext dopo canary);
> run #2 con canary in cache → lancio singolo OK, login SalesNav manuale completato, sync in corso.

## End-state

`bot.ps1 sync-list` gira E2E senza timeout browser ANCHE con canary attivo (doppio lancio),
i lead sono sincronizzati nel DB, il fix è committato con verifiche verdi.

## Task

- [x] 1. Run sync-list E2E completo (run #2)
  - DONE 2026-06-10: REPORT `Status: COMPLETATO`, durata 8m48s, exit 0. Lista "EVENTI EU DA 1-50
    FR, SPA, Paesi Bassi": 8 pagine, 200 candidati, 25 unici → 8 aggiornati / 17 invariati /
    0 inseriti / 0 errori; cloud sync 25; lead totali 348. Enrichment AI = 0 (circuit breaker
    `openai.chat` aperto → vedi nota sotto), promossi READY_INVITE = 0.
  - VERIFY: output `REPORT: SYNC-LIST` nel log del task bih3lnn0p + exit code 0. ✔
  - NOTA correzione (premise-assumed #7): la prima stesura riportava "273 lead, daily report
    inviato" — numeri MAI esistiti, scritti prima della fine del run. Corretti coi dati reali.

- [x] 2. Confermare il MECCANISMO esatto del hang doppio-lancio (root cause alla fonte, zero-B.7e)
  - DONE 2026-06-10: catena confermata leggendo il codice REALE. `closeBrowser` (launcher.ts:823)
    → `humanWindDown` → `await session.browser.close().catch(()=>{})` (842): per camoufox il
    context Playwright si chiude ma il PROCESSO OS Firefox/camoufox NON è garantito morto, né il
    `parent.lock` del profilo persistente è rilasciato, quando la funzione ritorna. Canary e workflow
    usano lo STESSO profilo `data/session` (confermato nei log: `accountId: ...\data\session` su
    entrambi i lanci). Quindi: canary lancia→"chiude" (processo ancora vivo/lock preso)→
    runCanaryIfNeeded ritorna→workflow chiama launchBrowser sullo stesso profilo lockato→
    launchPersistentContext aspetta il lock→timeout 180s. Run#2 (canary in cache 4h)=lancio singolo=OK.
  - VERIFY: lettura launcher.ts:823-843 (closeBrowser/humanWindDown) + log run#1 (2 lanci stesso
    accountId data/session) vs run#2 (1 lancio). ✔ "Extension is invalid" = red herring (addon UBO
    in cache integro, manifest.json presente; build passa).

- [~] 3. Fix doppio-lancio applicato + verificato (CODICE VIVO src/browser/** — anti-ban)
  - SCELTO (zero-C.10): opzione (A) — attesa bounded morte processo in closeBrowser per camoufox/firefox.
    Scartate (B) riuso-browser-canary (blast-radius/stato sporco, viola zero-I) e (C) retry-su-launch
    (latenza 180s + tratta il sintomo).
  - APPLICATO 2026-06-10: nuovo helper `waitForBrowserProcessExit(ctx, timeoutMs=8000)` in
    windowInputBlock.ts (poll `process.kill(pid,0)` sul PID già tracciato, no-op se PID assente) +
    chiamata in closeBrowser (launcher.ts) dopo browser.close(), gated su engine camoufox/firefox.
    antiban-review = SICURO (attesa a browser chiuso, zero impatto timing azioni LinkedIn).
  - L1 VERDE 2026-06-10: `npm run conta-problemi` exit 0 (typecheck + eslint 0-warn + 165 test
    files / 1599 test vitest verdi). COMMIT `ff4cffd` (solo locale, no push — area anti-ban).
  - RESTA il repro RUNTIME definitivo (zero-M): forzare i 2 lanci browser e vedere nessun timeout
    180s. È azione LinkedIn-live ravvicinata + possibile login SalesNav → LEVA UTENTE (anti-ban +
    presenza). Naturale: il path a 2 lanci si riesercita al 1° sync-list dopo scadenza canary (4h)
    o a boot freddo (flag `canary_last_ok_at` non settato).
  - AUDIT (2026-06-10) ha rivisto il fix: (A) = MITIGAZIONE valida (committata ff4cffd; funziona nel
    caso reale, PID camoufox registrato nei log; limite = bounded 8s, non garanzia). Il fix
    STRUTTURALE è (B′): il canary RIUSA la sessione passandola al workflow via `existingSession`
    (pattern GIÀ esistente, usato da syncSearchService.ts:247 per riuso bulkSave→listSync). (B′)
    elimina la root cause (niente 2° lancio) E migliora l'anti-ban (1 sessione continua vs 2 aperture
    ravvicinate). VERIFICATO che `existingSession` oggi NON copre il canary (lo passa solo
    syncSearchService; il canary chiude sempre nel finally di workflowEntryGuards). (B′) cambia il
    contratto di evaluateWorkflowEntryGuards → blast radius tutti i workflow → PLAN MODE prima.

- [ ] 3b. (B′) Fix strutturale: canary riusa la sessione → workflow via existingSession [PLAN MODE]
  - Richiede: runCanaryIfNeeded/evaluateWorkflowEntryGuards ritornano la BrowserSession (non chiudono)
    quando il canary gira; syncListService + syncSearchService la passano a runSalesNavigatorListSync
    come existingSession; gestire il caso canary-in-cache (nessuna sessione → lancio normale) e il
    caso login-richiesto/restricted (chiudere la sessione, non passarla).
  - DONE: design + Plan Mode approvato dall'utente + applicato + antiban-review + conta-problemi exit 0
    + repro 2-lanci. (A) resta come safety-net difensivo in closeBrowser.

- [ ] 4. Housekeeping di chiusura
  - DONE: `user-actions-pending.md` aggiornato (RE-LOGIN LinkedIn FATTO 2026-06-10);
    `ENGINEERING_WORKLOG.md` blocco datato; memoria progetto aggiornata; commit puliti.
  - VERIFY: file aggiornati + `git status` pulito.

## Findings audit 2026-06-10 → fix prioritizzati (fonte: docs/tracking/SYNC_LIST_AUDIT_2026-06-10.md)

41 findings (3 critical / 7 high / 17 medium / 14 low). I 3 CRITICAL + 4 HIGH convergono sul
doppio-lancio browser (GRUPPO 1). Il mio fix (A) confermato = mitigazione, non garanzia.

- [~] G1 — BUG DOPPIO-LANCIO (radice, 3 critical) → fix B′ riuso sessione canary [APPLICATO 2026-06-10]
  - Piano approvato (Plan Mode): C:\Users\albie\.claude\plans\groovy-coalescing-bachman.md
  - Parte A (launcher.ts): timeout esplicito LAUNCH_TIMEOUT_MS=60s su camoufox/firefox/chromium +
    retry su lock/timeout profilo (flag retriedLock, anche senza proxy). DONE.
  - Parte B (workflowEntryGuards.ts + syncListService.ts): handoff sessione canary→workflow OPT-IN
    (reuseSession; GuardDecisionWithSession.session; runCanaryIfNeeded(reuseAccountId) non chiude la
    sessione dell'account operativo e la ritorna; syncListService la passa come existingSession e la
    chiude nel finally). Altri 4 workflow invariati (default off). DONE.
  - Parte C (salesNavigatorSync.ts:946): disableWindowClickThrough nel path success (= G2-fix2). DONE.
  - VERIFICA: conta-problemi exit 0 (typecheck + eslint 0-warn + 1599 test) ✔. COMMIT 95c77a3 (locale).
  - Repro E2E runtime (prova del handoff Parte B): flag `canary_last_ok_at` AZZERATO 2026-06-11
    (DELETE su sync_state verificato: flag ASSENTE) → Riccardo lancia `bot.ps1 sync-list`; atteso
    1 SOLO launchBrowser (canary riusato) e nessun timeout 180s. Dopo il run: analisi log mia.
  - RUN 2026-06-11 = INCONCLUDENTE per l'handoff: BLOCCATO/SELECTOR_CANARY_FAILED. 1 solo browser
    (pid 4860), canary fallito su `feed.global_nav` (critico) + `invite.search_surface` (opt) PRIMA
    del 2° lancio → handoff non esercitato. POSITIVO: nessun timeout 180s. F2 confermato live:
    SELECTOR_CANARY_FAILED senza accountId → quarantena GLOBALE (fail-safe). NON regressione mia
    (canary/selettori non toccati da F2/F3).
  - [ ] FINDING NUOVO (probabile ambientale, NON code-bug → leva utente per distinguere): canary
    `feed.global_nav` not-found = quasi sempre pagina non-feed-loggato. Indizi: `fetch failed` cloud,
    `[WINDOW-BLOCK] nessuna finestra PID`, 7 circuit breaker aperti (openai.chat/ddg/apollo/telegram)
    → connettività ballerina. SBLOCCO: `unquarantine` + `doctor` (sessionLoginOk?) + `login` se serve
    + rete/proxy stabili, poi re-run. Se feed.global_nav fallisce ANCORA con login OK + rete stabile
    → drift selettore reale → fix canary (task piccolo a parte). Eccezione zero-J: serve azione utente
    + ambiente LinkedIn-live per distinguere ambientale vs drift.
- [~] G2 — HIGH chirurgici indipendenti:
  - [x] Silent-failure scraping — APPLICATO 2026-06-10. `SalesNavListScrapeResult.scrapeDegraded`
    (listScraper.ts) = 0 lead E nessun indicatore di lista-vuota (helper `hasEmptyListIndicator`
    multi-locale + cattura `anchorAppeared`); salesNavigatorSync NON marca synced/checkpoint se degraded
    e fa `report.errors++` → success=false + alert + lista ri-tentata. antiban-review SICURO. VERIFICA L1 in corso.
  - [x] Leak window click-through path SUCCESS — già fatto in G1 Parte C (salesNavigatorSync.ts:946,
    commit 95c77a3): disableWindowClickThrough prima di closeBrowser nel ramo ownsBrowser.
- [~] G3 — Truthfulness report — i 2 medium APPLICATI 2026-06-10 (L1 in verifica):
  - [x] success ora include enrichment.errors+cloudErrors (syncListService.ts) + errors[] elenca TUTTI
    i tipi (scraping/enrichment/cloud) → niente success=true con cloud non sincronizzato.
  - [x] cloudSynced veritiero: batchUpsertCloudLeads ritorna il conteggio REALE (no-client e chunk
    falliti esclusi); il caller fa cloudErrors++ se parziale.
  - [x] LOW — RISOLTI 2026-06-11 come documentazione-semantica (zero-C.10): verificati TUTTI i consumer
    di uniqueCandidates/candidatesDiscovered → solo display/telemetria (formatFinalReport + payload
    candidati_trovati/unici syncListService.ts:280), NESSUN consumer decisionale (budget/risk/cap).
    → JSDoc esplicito sui campi (lordo anchor DOM; unici per-lista, non cross-lista). Scartati campo
    dedup nuovo (overengineering su dato telemetrico) e cambio dei numeri (rompe comparabilità storica).
    VERIFY: grep consumer + conta-problemi exit 0. ✔
- [~] G4 — Test coverage:
  - [x] Regression test handoff/session-reuse (il bug doppio-lancio G1) — APPLICATO 2026-06-10:
    3 test in `src/tests/workflowEntryGuards.vitest.ts` (handoff ritorna+non chiude / no-reuse chiude
    invariato / login-fail blocca+chiude). Run mirato 8/8 verde. È il test a maggior valore (protegge il fix critical).
  - [x] Characterization — APPLICATO 2026-06-11 (post-split F3, commit 92d7b37): NUOVO
    `salesNavSyncSplit.vitest.ts` 15 test su resolveSyncTarget / restoreListCheckpoint / upsertLeadBatch
    (dryRun no-write, contatori, errore→continua, samples cap, preferenza URL pubblico+salesnavUrl) /
    processSingleListSync (challenge abort, scrapeDegraded no-mark-synced, happy, dryRun).
    VERIFY: conta-problemi exit 0 (167 file / 1625 test, +15). ✔ (postSyncEnrichment: coperta indirettamente
    via orchestrateEnrichmentByList; unit dedicata = miglioria futura non bloccante, è già funzione separata.)
- [~] G5 — Robustezza (piano: C:\Users\albie\.claude\plans\groovy-coalescing-bachman.md; multi-account imminente):
  - [x] F1 guard anti-concorrenza per-account — APPLICATO 2026-06-10: `acquireRuntimeLock('sync.account:<id>')`
    in evaluateWorkflowEntryGuards (riusa lock atomico esistente); release nel finally di syncListService+
    syncSearchService; reason `SYNC_CONCURRENT_ON_ACCOUNT`; 2 test. Run mirato 10/10. L1 in verifica.
  - [x] F2 quarantena per-account — APPLICATO 2026-06-11: helper `setAccountQuarantine`/`getAccountQuarantine`/
    `getQuarantineStatus` (system.ts, chiave `account_quarantine:<id>`, fail-safe: non-attribuibile→globale,
    reader=per-account OR legacy); writer attribuiti (canary LOGIN_REQUIRED con accountId; platform-wide
    DELIBERATAMENTE globali: SELECTOR_*_BURST/CANARY, RISK_STOP, 2FA); reader per-account in guards/jobRunner
    (skip nel loop, no break)/loopCommand/orchestrator (snapshot pre/post, blocked solo su quarantena NUOVA);
    aggregati additivi doctor/status/API; `unquarantine [--account <id>]`; zod accountId.
    VERIFY: antiban-review SICURO; `conta-problemi` exit 0 (166 file/1610 test, +6: accountQuarantine.vitest
    nuovo 5 test + 1 guard per-account). ✔
  - [x] F3 split god-function — COMPLETO 2026-06-11 (4 commit: fc67b5c, 64b210f, 83af88f, 14a5e88).
    Nota zero-M: "994 righe" dell'audit era il FILE; la funzione era 602→1015 (~414 righe). Tier1:
    8 helper setup/teardown (resolveSyncTarget, initSalesNavigatorSyncReport, launchOrReuseSession,
    ensureLoggedInOrAwaitManual, applyWarmupAndInputBlock, restoreListCheckpoint, closeOwnedBrowser,
    capturePostSyncMetrics). Tier2: discoverAndFilterLists, orchestrateEnrichmentByList,
    processSingleListSync, upsertLeadBatch — runSalesNavigatorListSync ora è orchestratore sottile
    (~95 righe). Tutto move-only (zero-Q), ogni chunk L1-verde (166/1610 = baseline a ogni step).
    VERIFY: 4× conta-problemi exit 0 + antiban SICURO (refactor puro). ✔

## Vincoli

- Il fix #3 tocca `src/browser/**` (anti-ban path): inline, MAI delegato, con review anti-ban
  (5 domande pre-merge browser-antiban.md) prima del commit.
- Niente modifiche al codice mentre un run sync-list è attivo.
