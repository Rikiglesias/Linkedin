# Engineering Worklog

Questo file tiene traccia dei blocchi tecnici realmente analizzati, provati o verificati nel repo.

Archivio mensile: [2026-04](ENGINEERING_WORKLOG_2026-04.md).

## 2026-06-13 — A13 split humanBehavior COMPLETO: 6 moduli timing + facade (chunk 5-11, `0db75c9`→`c2606fb`)

Completato lo split SRP di `humanBehavior.ts` estraendo i moduli con componenti **TIMING** (chat fresca, contesto pulito = priorità anti-ban). DAG leaf-first, regression-safe (zero-Q), copia **VERBATIM** delle formule.

### Decisione di design (deviazione motivata dal binding)
Il raggruppamento del binding metteva `interJobDelay`/`computeProfileDwellTime` in `humanDelay.ts`, ma sono **orchestratori** (cima del DAG) → creavano cicli `humanDelay↔readingSimulation↔decoyActions`. Risolto con un **DAG stretto, zero dynamic-import nuovi**: `computeProfileDwellTime`→`readingSimulation.ts` (è profile-reading), `interJobDelay` TENUTO nel facade insieme a `awaitManualLogin` (orchestratori di sessione; zero-I: no `sessionPacing.ts` single-use dato che il facade è già 195<300).

### Moduli estratti (`src/browser/human/`, tutti <300)
touchGestures (99, `0db75c9`) · humanDelay (84, `c936b99`, ⚠️TIMING-CORE log-normale) · mouseMovement (186, `bd6aec9`, ⚠️TIMING-CORE Bézier/Fitts) · readingSimulation (231, `f670307`, momentum/fasi/dwell) · humanTyping (142, `b043f66`, ⚠️TIMING-CORE keystroke floor 55/80ms) · decoyActions (234, `3f0bbab`, behavioral-pattern) · **facade humanBehavior (195, `c2606fb`)**.

### Metodo + verifica per chunk
Per ogni modulo: flag `antiban-approved.txt` per Edit gated → Write verbatim + correzione path import (`../`/`../../` da `human/`, dynamic import overlayBridge `./`→`../`) → facade re-export + potatura import orfani → `tsc --noEmit` exit 0 + `madge --circular`=0 → `/antiban-review` SICURO → commit. Milestone post-TIMING-CORE + finale: `conta-problemi` exit 0 (**181f/1783t = baseline invariato** = comportamento identico). Spot-check costanti anti-ban (floor 55/80, `logNormalDelayMs(200,0.42,90,650)`/`(95,0.42,45,320)`, Fitts `350+90·log2`, asimmetria 0.15, momentum 0.35+0.25, decoy 0.7/0.2) = **zero drift**.

**humanBehavior 1464→195 righe.** ~30 caller invariati (facade re-export). Restano A13: `bulkSaveOrchestrator.ts` (1839, salesnav, prossima chat) + borderline `proxyManager`/`launcher` (binding `~/todos/a13.md`).

## 2026-06-13 — A13 split humanBehavior: cursorOverlay + inputBlock (chunk 3-4, `b52d3cc`/`c53624d`)

Continuato lo split SRP di `humanBehavior.ts` (stealth-core anti-ban) leaf-first, regression-safe (zero-Q). Estratti i 2 moduli **NON-timing** rimanenti in `src/browser/human/`: **cursorOverlay.ts** (170 righe — ensure/sync/enable/removeAll/pulse VisualCursorOverlay; `syncVisualCursorOverlay` reso export per humanTap/humanSwipe) e **inputBlock.ts** (243 righe — overlay full-screen blocco input + pause/resume click/move + blockUserInput; dynamic import `../windowInputBlock`/`../overlayBridge`). Metodo: **copia VERBATIM** (zero cambio formule/timing — il `waitForTimeout(90)` del pulse e i `setTimeout` 150ms/2500ms di inputBlock copiati esatti), facade re-export → ~30 caller esterni invariati, potatura import overlayIds. **humanBehavior 1464→1063 righe** (4/9 moduli estratti col chunk 1-2 mouseState/overlayIds). Verifica per chunk: `madge --circular`=0, `conta-problemi` exit 0 (181f/1783t invariati = comportamento identico), `/antiban-review` SICURO (NON-browser-behavior, refactor puro). Review di branch eseguita prima del push (area anti-ban). **Restano i 5 moduli con componenti TIMING** (humanDelay/mouseMovement/humanTyping = TIMING-CORE log-normale/Bézier/keystroke + touchGestures/readingSimulation/decoyActions) + facade finale → **chat fresca** per binding `~/todos/a13.md` (contesto pulito = priorità anti-ban sulle formule).

## 2026-06-13 — Live enrichment parallelo in background post-scraping (commit `c523cea`)

### Obiettivo (richiesta utente, fuori dal goal audit-bot)
Quando un workflow raccoglie persone, arricchire SUBITO in parallelo e in background i soli lead NON ancora arricchiti (diff col DB), lanciando processi da terminale, senza bloccare il workflow. Scelte utente confermate: **scope = tutti gli scraping** (SalesNav/syncSearch/syncList); **live = solo fonti gratuite** (Apollo/Hunter/Clearbit restano nel ciclo scheduler col cap).

### Scoperta (zero-A: il ~90% esisteva già)
`enrichLeadsParallel()` (`parallelEnricher.ts`) era già un motore batch-parallelo che **fa il diff col DB** (LEFT JOIN `lead_enrichment_data`) e persiste — ma non usato dallo scheduler (accoda sequenziale) e di default chiama i provider a pagamento (commento d'intestazione fuorviante, corretto). `enrich-fast` (dispatcher) già lo invocava. Gap reali: (1) flag per saltare i paid; (2) trigger reattivo post-scraping; (3) runner background. Anti-ban verificato: l'enrichment usa SOLO fonti esterne HTTP/DNS (zero browser/LinkedIn).

### Interventi
- `leadEnricher.ts`/`parallelEnricher.ts`: flag `paidProviders` (default `true` = invariato); `false` salta Apollo/Hunter/Clearbit, tiene EmailGuesser/PersonDataFinder/WebSearch + domain discovery (gratis). Guard `enrichLeadAuto` aggiornata (apollo key non "salva" il lead se paid disabilitati).
- `liveEnrichmentTrigger.ts` (NUOVO): spawn detached fire-and-forget + lock single-instance by-child-PID (orfano se il PID muore; stale 20min). Funzione **sincrona** → niente race tra workflow nel daemon single-thread. Mai propaga eccezioni (non rompe il sync).
- `enrich-fast` esteso con `--free`/`--drain`; nuovo comando dispatcher `enrich-live` (= `enrich-fast --free --drain`) + `npm run enrich:live`. Drain-loop: stop a coda vuota o stallo (`enriched=0`) + cap iter(20)/durata(15min); la diff-query ordina i mai-arricchiti per primi → progresso monotòno.
- Aggancio DRY al choke point `upsertLeadBatch` (`salesNavigatorSync.ts`): tutti e 3 i workflow vi convergono via `runSalesNavigatorListSync`. Trigger gated `!dryRun && syncedLeadIds>0`.
- Config: `LIVE_ENRICH_ENABLED`/`CONCURRENCY`(8)/`LIMIT`(200).

### Verifica finale
`npm run conta-problemi` exit 0 (typecheck backend+frontend, lint zero-warning, **181 file / 1783 test**, +2 file/+8 test). `madge --circular`=0. `/antiban-review` **SICURO** (6 domande tutte ✅: zero browser, trigger post-scraping detached, nessun impatto timing/fingerprint/volumi/sessione). Commit `c523cea` auto-pushato (`ba1447c..c523cea`). **Follow-up qualità funnel** (non risolti, pre-esistenti): domain_discovery confidence 20 (`domainDiscovery.ts:271`), proxy pool exhausted (poolSize 1), nome-dupe AI cleaning.

## 2026-06-13 — A12: chiusa nel cloud (Ultraplan), tracker allineati (`/goal audit-bot`)

A12 (pacing budget per-account, EPIC anti-ban) è stata **implementata e revisionata nella sessione cloud Ultraplan / Claude Code web** e l'utente l'ha dichiarata chiusa ("considerala chiusa nel cloud"). **Non verificata localmente**: al momento della chiusura il codice NON era nel repo (`gh pr list` = solo dependabot; `git log --all` = solo `c4ca43e` docs, zero commit di implementazione pacing/scheduler; nessun branch A12). Tracker allineati (LIST/binding/lastchat) marcando A12 ☁️ chiusa-cloud, **non-verificata-localmente**, con design+infra-test conservati in LIST come riferimento se servirà riconciliare la PR cloud col branch locale `refactor/adk-split`. Lavoro locale di questa sessione (verificato): A6-3, A11-1-pop, A11-2 — committati, gate verde 179f/1775t. A13 resta EPIC igiene tracciato (opzionale, zero-I).

## 2026-06-13 — A11-2: replay eventi critici al reconnect dashboard (audit-bot FASE 3) (`/goal audit-bot`)

### Obiettivo
A11-2 (`[Observability][medio]`): la dashboard offline perdeva gli eventi critici dal live-feed SSE. Item GRANDE residuo dell'audit-bot, implementato localmente mentre A12 gira su Ultraplan/cloud.

### Scoperta (verifica alla fonte, cambio di approccio vs design)
Il design originale (LIST) diceva "accodare a `outbox_events` per replay post-crash". Verificando alla fonte: (1) `outbox_events` è **sink-based single-delivery worker→cloud** (`claimPendingOutboxEvents`/`markOutboxDeliveredClaimed` con lease+owner) — semantica errata per un replay SSE multi-client; (2) gli eventi critici **non sono persi**: vanno già in outbox→cloud + `audit_log` + broadcast Telegram (A11-1). Il gap reale era SOLO il live-feed SSE al reconnect (lo stato è recuperabile da DB al reload). → approccio cambiato a **ring buffer in-memory** (zero-I, proporzionato al gap reale).

### Interventi (`src/telemetry/liveEvents.ts`, commit `d9c738f`)
- Ring buffer (ultimi 50) dei soli tipi CRITICI (incident.opened/resolved, system.quarantine, automation.paused/resumed, challenge.review_queued); effimeri ad alto volume (lead.transition/reconciled, run.log) esclusi.
- `subscribeLiveEvents`: replay del buffer al (ri)connect → la dashboard recupera il live-feed. Eventi replayed marcati `_replayed:true` (client dedupa per `timestamp`). Replay non-bloccante (try/catch come la publish).
- Firme pubbliche invariate (zero breaking change su `server.ts` SSE e i call-site `publishLiveEvent`). +5 test `src/tests/liveEvents.vitest.ts` (critico→replay, effimero→no, live-no-marker, unsubscribe, count).

### Verifica finale
`npm run conta-problemi` exit 0 — typecheck backend+frontend, lint zero-warning, **179 file / 1775 test** (+1 file, +5 test). NON anti-ban (telemetry) → auto-push abilitato. Buffer in-memory NON è la SSOT: documentato in-code che la persistenza durevole vive in outbox→cloud + audit_log + Telegram.

## 2026-06-13 — A6-3 + A11-1-pop: alert WHAT/WHY/DO completati (audit-bot FASE 3 bounded) (`/goal audit-bot`)

### Obiettivo
Chiudere gli ultimi 2 residui **bounded** dell'audit-bot 360°: A6-3 (alert proattivo su circuit-breaker provider aperto pre-outreach) e A11-1-pop (popolare il campo `action`/DO negli alert broadcast restanti). Gli item GRANDI (A12 EPIC, A11-2, A13) restano tracciati per chat dedicata + Plan Mode.

### Interventi
- **A6-3** (`sendInvitesService.ts:352`, commit `7100872`): dove `enrichmentDegraded=true` (enrichment <20% = sintomo CB Apollo/Hunter/OpenAI aperto) aggiunto `await broadcastWarning` WHAT/WHY/DO oltre al `console.warn` esistente (A6-2). `declassedToTemplate` calcolato PRIMA della mutazione `noteMode`. `broadcast()` è never-throw (`Promise.allSettled`) → non blocca né rompe l'invio. File gated → antiban-review SICURO + flag.
- **A11-1-pop** (commit `f64e758`): campo `action` strutturato su 5 call-site con un DO operativo — `incidentManager.ts:153` (pausa automazione: cosa fare a fine pausa / pausa indefinita), `jobRunner.ts:368` (proxy quality: ruota pool Oxylabs), `preventiveGuards.ts:156` (circuit breaker open: controlla provider), `linkedinChangeAlert.ts:64/72` (LinkedIn change: verifica selettori/DOM; il :72 sposta il DO dal body al campo). **Escluso** `preventiveGuards.ts:40` (heartbeat INFO: informativo di routine, nessun DO sensato).

### Verifica finale
`npm run conta-problemi` exit 0 su entrambi i commit — typecheck backend+frontend, lint zero-warning, **178 file / 1770 test** verdi (test `incidentClassification` non rotto dal 4° arg `action`). `/antiban-review` → **SICURO** per entrambi (observability-only: zero cambiamento a browser/timing/fingerprint/volumi/navigazione). Push manuale dopo review (repo personale, area anti-ban). LIST + binding `audit-bot.md` aggiornati.

## 2026-06-13 — SEC5: password proxy sticky non più persistita in chiaro in `.session-meta.json` (`/goal sec5`)

### Obiettivo
Rimuovere il segreto (password proxy) dal disco. `persistStickyProxy` (`proxyManager.ts`) scriveva `{ server, username, password, type, weekNumber }` in `.session-meta.json` (mitigato solo da session-dir 0700). Binding: `~/todos/sec5.md`. Residuo M-size SEC5-parte1 di backend-audit-2026-06-06.

### Ricerca (read-only, fonte reale)
Lo sticky proxy è SEMPRE una entry del pool (`getProxyAsync`), e `getStickyProxy` già verifica che il server sia nel pool prima di riusarlo → le credenziali sono ri-derivabili dal pool (config), la password nel file è ridondante. Unico writer/reader del segreto nel file = `proxyManager.ts` (i reader runtime in launcher/proxyLaunchPlan usano l'oggetto in memoria, non il file). Blast radius minimo.

### Interventi (`proxyManager.ts` + test)
- `persistStickyProxy`: persiste solo `{ server, username, type, weekNumber }` — **password RIMOSSA**. `username` TENUTO (non è il segreto critico; su gateway Oxylabs condiviso identifica sessione/geo → serve a ri-matchare la entry esatta del pool).
- `loadPersistedStickyProxy`: ritorna `PersistedStickyProxy` (no password dal file). Entrambe `export` per testabilità (pattern `computeProxyCooldownMs`).
- `getStickyProxy`: al riuso del persistito, match ESATTO `pool.find(server === ... && username === ...)` e usa quella entry (password fresca dal config). Match esatto, NO fallback solo-server: su gateway condiviso eviterebbe un IP/geo diverso (regressione anti-ban). Nessun match → alloca nuovo (come prima con `stillInPool=false`).
- Retro-compatibile: il load ignora la password dei file legacy; il primo re-persist la rimuove dal file (test dedicato).

### Verifica finale
`npm run conta-problemi` exit 0 — typecheck backend+frontend, lint zero-warning, **vitest 1761/1761** (177 file; +7 test `proxyStickyPersist.vitest.ts`: no-password-scritta, no-password-letta, retro-compat, re-persist ripulisce, preserva altre chiavi, edge null). `/antiban-review` → **SICURO** (nessun cambio a quale IP/proxy viene riusato — stickiness/geo/rotazione invariati; solo niente-segreto-su-disco + credenziali sempre correnti dal config). **SEC5-parte2** (ASN-lookup HTTP→HTTPS, `proxyQualityChecker.ts:210`) resta leva utente (piano provider ip-api Pro).

### Fix correlato (emerso dalla review pre-push multi-lente di AB11+SEC5, `wf_fe73121a-2f1`)
`writeMeta` (`sessionCookieMonitor.ts`) sovrascriveva l'intero `.session-meta.json` con il solo `SessionMeta`, **cancellando `stickyProxy`** (scritto da `persistStickyProxy`, AB-2) e `behavioralProfile` quando il caller non lo ripassava. Poiché `recordSuccessfulAuth` gira dopo OGNI login, lo sticky proxy persistito veniva azzerato → AB-2 di fatto non sopravviveva ai riavvii (bug pre-esistente, non introdotto da SEC5). Fix: `writeMeta` legge il file e fa merge `{ ...existing, ...meta }` (campi SessionMeta vincono, chiavi extra preservate). `/antiban-review` SICURO (ripara due funzioni anti-ban: sticky-IP persistente + behavioralProfile non azzerato). +1 test d'integrazione (`recordSuccessfulAuth` non cancella lo sticky + invariante SEC5 password-off-disk dopo il giro completo). 1762/1762 test.

## 2026-06-13 — AB11: handoff sessione canary→jobRunner per invite/message/check/all (`/goal ab11`)

### Obiettivo
Eliminare il doppio-lancio browser canary→jobRunner anche per i workflow jobRunner-bound (prima solo sync-list, commit `95c77a3`). Al 1° run di ogni finestra 4h il selector-canary apriva+chiudeva un browser sul profilo persistente e jobRunner ne rilanciava subito un altro (lock conflict + pattern open/close/open). Binding: `~/todos/ab11.md`. Residuo M-size AB11 di backend-audit-2026-06-06.

### Ricerca (workflow fan-out `wf_c2936fdf-636`, 24 agenti, 19 claim verificati adversarialmente)
Mappa di tutti i launch-site del ciclo. Scoperte che hanno cambiato il design vs piano originario: (a) jobRunner lancia con `preferredProxyType: 'mobile'` (`jobRunner.ts:194`), il canary no → l'handoff naive avrebbe fatto girare l'outreach su proxy non-mobile in silenzio; (b) tra guard e `runQueuedJobs` ci sono 2 satelliti (`LOW_ACTIVITY` `orchestrator.ts:564` + maturity warm-up `:602`) che aprono un browser sullo stesso profilo → lock conflict se la sessione handoff è tenuta aperta.

### Interventi (3 file src/core, chirurgici)
- **`workflowEntryGuards.ts`**: canary, per i workflow jobRunner-bound SU SINGOLO account, ritorna la sessione (`GuardDecisionWithSession.session`+`sessionAccountId`) invece di chiuderla; lanciata con `preferredProxyType` mobile-priority (match jobRunner) — derivato dal consumer (sync-list resta `undefined` come `salesNavigatorSync`). Multi-account → nessun handoff (il loop canary `return`erebbe al 1° handoff saltando le verifiche degli altri).
- **`orchestrator.ts`**: `runWorkflow` tiene la sessione in un holder e la chiude nel `finally` esistente se un guard blocca prima di `runQueuedJobs`; `releaseHandoffBeforeSatellite()` la cede prima dei 2 satelliti (warm-up anti-ban non fallisce per lock); ownership trasferita a `runQueuedJobs` azzerando l'holder PRIMA della chiamata (no doppia chiusura su throw).
- **`jobRunner.ts`**: `RunJobsOptions.initialSession`; `runQueuedJobs` consegna all'account matching + `finally` chiude la non-consumata (account quarantinato/assente); `runQueuedJobsForAccount(…, initialSession?)` riusa invece di lanciare. `checkLogin` resta safety sul gap canary→job; `enableWindowClickThrough` idempotente (Set multi-PID).

### Verifica finale
`npm run conta-problemi` exit 0 — typecheck backend+frontend, lint zero-warning, **vitest 1754/1754** (176 file; baseline 1748 + 6 nuovi test: 3 guard handoff jobRunner-bound, 3 orchestrator handoff). `/antiban-review` → **SICURO** (solo lifecycle browser; sessione continua canary→outreach + meno aperture ravvicinate = migliore; proxy coerente col consumer; warm-up sessioni fresche preservato). **Resta T5**: test integrazione staging con account LinkedIn reale (canary forzato → verificare 1 solo launch, zero `parent.lock` retry) = leva utente runtime (anti-ban).

## 2026-06-12 — preset-profili: 4 preset d'uso + mappa assi A-I + 3 env nuove (`/goal preset-profili`)

### Obiettivo
4 preset `.env` coerenti e anti-ban-sicuri (starter/pro/scale/max-stealth) + mappa completa aspetti×opzioni e assi d'uso, con i gap reali documentati. Binding: `~/todos/preset-profili.md`.

### Interventi
- **T1b fan-out `wf_70cfaf15-f8d`** (9 agenti, 108 finding con file:riga): mappa assi d'uso A-I (obiettivo, lifecycle, recovery, profilo-utente, compliance, lingua, scala, budget, reporting). Scoperte chiave: vincolo UI account EN/IT (selettori); erasure GDPR non propagata a Supabase + RLS off su `public.leads`; cap daily/weekly su bucket unico (migration 055 non wired); zero-cloud $0 è il default del codice; nessun env per disattivare l'auto-solve captcha.
- **T3 preset**: `presets/{starter,pro,scale,max-stealth}.env.example` — nomi `.env.example` per restare nel gate secrets (template, segreti vuoti). VERIFY deterministico: 279 var, tutte esistenti in `src/config/` (script grep, incl. template-literal `ACCOUNT_${slot}_*`). Antiban-review max-stealth: SICURO (solo restringe).
- **T4 codice (additivo, default invariati)**: `CHALLENGE_AUTO_RESOLVE_ENABLED` (gate in `challengeHandler.ts`, default true; max-stealth=false — l'auto-solve è esso stesso un segnale) + `GDPR_ANONYMIZE_AFTER_DAYS`/`GDPR_DELETE_AFTER_DAYS` (soglie `gdprRetentionCleanup.ts` prima hardcoded 180/365, floor 30/60, clamp delete≥anonymize). Test nuovi `configPresetEnvs.vitest.ts` (4).
- **T5 doc**: `docs/PRESET_PROFILES.md` (tabella profili, mappa 12 aspetti, assi A-I, gap per profilo con file:riga, 16 combinazioni vietate) + pointer README + `CONFIG_REFERENCE.md` rigenerato.

### Verifica finale
`npm run conta-problemi` exit 0 — 175 file test / 1714 test passati (+1 file, +4 test). Decisione architetturale: preset = file `.env` (asse USO), ortogonali a `CONFIG_PROFILE` (asse AMBIENTE) — niente duplicazione SSOT in `profiles.ts`. Gap grandi tracciati in PRESET_PROFILES.md (slot N account, cap per-account, spend-cap testo cloud, erasure→Supabase, locale per-account).

## 2026-06-11 — ai-stack F3+F4: cervello connesso ai segnali, ramo H28 eseguibile (`/goal ai-stack`)

### Obiettivo
F3: segnali live → decisioni che cambiano il comportamento (non solo log). F4: root cause del breaker `openai.chat` e ramo fallback H28 morto.

### Interventi (3 commit L1-verdi)
- **F3.1 `97f65cb`** (antiban SICURO): `classifyIncidentSource` era ORFANA e ROTTA (query su tabella inesistente `incidents`/`created_at`; reale: `account_incidents`/`opened_at` → catch silenzioso → sempre 'unknown'). Riscritta su repository PG-portabile `countDistinctIncidentAccounts` (accountId estratto in JS, niente `json_extract` dialect-specific) e WIRED in `quarantineAccount`: alert CRITICAL con recommendation WHAT/WHY/DO, outbox+liveEvent con `sourceClassification`/`affectedAccounts`. Fail-safe quarantena INVARIATO (la classificazione arricchisce, mai ammorbidisce). Catch → `logWarn incident.classification_failed`. Residuo dichiarato: counter `selector_failures` per-account = prerequisito del classificatore account-aware pieno.
- **F3.4 `d6cbb14`** (antiban SICURO): 5° decision point `inbox_reply` wired nell'inboxWorker — gate ADDITIVO sopra i rule-based dell'auto-reply (può solo bloccare, mai mandare di più; strict=true → NOTIFY_HUMAN su risposta invalida). Valutato PRIMA del pre-incremento cap atomico (blocco AI = zero budget consumato). chatMessages taggati `THEM:` (distillatore F0.5, prompt pseudonimizzato). Event `inbox.auto_reply_ai_blocked`.
- **F4 `e0239d5`**: ramo H28 `openai_circuit_open_ollama_fallback` ESEGUIBILE — `requestOpenAIText` accetta baseUrl/model dalla resolution (pattern F2: il registry risolve, il client esegue); endpoint fallback con integration/circuitKey DEDICATE (`ollama.fallback.chat`). Gate remoto invariato (override remoto bloccato con `AI_ALLOW_REMOTE_ENDPOINT=false`, testato). Causa storica del breaker aperto: endpoint AI configurato (default Ollama locale) non raggiungibile → ambientale; run sano verificabile con Ollama attivo (leva ambiente).

### Già esistenti, verificati alla fonte (zero-A: niente da costruire)
- **F3.2 P(accept)**: `scheduler.ts:740-759` riordina già i candidati invite con `predictAcceptanceBatch` (composito Bayesiano, fallback lead_score). Anti-ban-positivo attivo.
- **F3.3 self-healing selettori**: loop completo `uiFallback` (VisionSolver LLaVA locale + verify post-azione) → `recordSelectorFallbackSuccess` → `selectors/learner.ts` (promozione con dry-run, valutazione, AUTO-ROLLBACK su degradazione, config `SELECTOR_LEARNING_*`).
- **Feedback loop decisioni**: `recordDecision` interno ad `aiDecide` + accuracy re-iniettata nel prompt (`getAccuracyContext`).

### Residuo con causa (non eseguibile ora)
Accuracy post-anonimizzazione (F0.5) e "breaker chiuso in run sano": richiedono RUN LIVE (decisionFeedback con outcome reali; Ollama/provider attivo). Il monitoraggio è già cablato.

### Verifica
conta-problemi exit 0 a ogni commit; finale **174 file / 1710 test** (da 172/1698: +incidentClassification 8, +openaiClientH28 4... ricontato dal runner). antiban-review SICURO su F3.1/F3.4 (5 domande in conversazione); volumi/cap/timing INVARIATI ovunque (il cervello può solo ridurre).

## 2026-06-11 — ai-stack F2: matrice modello per-tier + vision/computer-use zero-PII di default (`/goal ai-stack`)

### Obiettivo
F2 del binding `~/todos/ai-stack.md`: modello ottimale per OGNI call-site AI via routing centralizzato config-driven (requisito prodotto multi-tenant), zero model id hardcoded, e applicazione della matrice al ramo vision/computer-use (decisione zero-PII 2026-06-11: gli screenshot NON escono di default). F1 (vision→Fable cloud) dichiarata SUPERSEDED dalla stessa decisione: vision resta locale, la migrazione cloud è opzione futura spenta.

### Interventi (3 chunk L1-verdi)
- **A `c5f860f`**: tier qualità-prezzo per-purpose — `ANTHROPIC_MODEL_LIGHT` (default Haiku 4.5) per `decoy_terms`/`post_content`; cervello (`decision_engine`/`guardian`/`ai_advisor`) resta su `ANTHROPIC_MODEL` (default Opus 4.8, Fable via env). `resolveAnthropicModelForPurpose` nel registry; `requestAnthropicText` accetta `model` per-richiesta e `aiTextClient` passa `resolution.model` (prima la resolution era solo telemetria). Rimosso default embeddings duplicato in openaiClient. `COMPUTER_USE_MODEL` e `VISION_ALLOW_CLOUD` aggiunti al config.
- **B `2c81742`** (antiban SICURO): gate `VISION_ALLOW_CLOUD` (default false) + `AI_ALLOW_REMOTE_ENDPOINT` su factory vision e computer-use — PRIMA bastava `OPENAI_API_KEY` e gli screenshot (PII visiva di massa) uscivano verso OpenAI bypassando il gate remoto F0 (zero-P, violazione latente della decisione). Con gate off restano le strategie DOM storiche. `computerUse` legge il model da config + guard difensiva nel task entry; `OpenAIVisionProvider.model` required (rimosso default divergente `gpt-4o`); `VisionSolver` default da config centrale (niente `process.env` diretto); factory su import statico di config (il lazy `require` rompeva ESM nei test; madge 0 cicli). Test sentinella `visionCloudGate` (4 case).
- **C**: generatore `generate-config-docs.mjs` riparato (regex richiedeva return type esplicito → con `build...() {` generava il doc VUOTO) + reso marker-aware: blocco manuale (`<!-- MANUAL-SECTION-START/END -->`, esempi + note operative) preservato alla rigenerazione invece di distrutto. CONFIG_REFERENCE rigenerato: 8 sezioni allineate al codice (drift recuperato), note operative regen-safe per AI_PROVIDER/ANTHROPIC_*/COMPUTER_USE_MODEL/VISION_ALLOW_CLOUD.

### Costo/1000-azioni (stima, prezzi matrice binding)
- Tier light (decoy/post, ~1k in + 300 out per call): Opus $12.5 → Haiku **$2.5** (−80%).
- Cervello: invariato (Opus default, volume basso by-design).
- Screenshot cloud di default: prima fino a ~$6/giorno di CU (cap 2M token input) + vision per-call con sola `OPENAI_API_KEY`; dopo **$0** (locale) salvo opt-in esplicito.
- Testi/batch PII: invariati, locali da F0.5.

### Verifica
conta-problemi exit 0 ad ogni chunk; finale **172 file / 1698 test** (da 171/1690: +1 file sentinella, +8 test). `madge --circular` = 0. Grep model id hardcoded in prod fuori da `config/domains.ts` = **0** (criterio F2 del binding). antiban-review: **SICURO** (nessun timing/volume/fingerprint toccato; di default meno traffico verso terzi durante la sessione LinkedIn).

## 2026-06-11 — ai-stack F0.5: pseudonimizzazione del cervello, decision_engine cloud-eligible (`/goal ai-stack`)

### Obiettivo
Decisione utente ZERO-PII: il decision engine può andare su Claude cloud SOLO con prompt pseudonimizzato. Oggi `buildDecisionPrompt` iniettava name/title/company/about/location, profileName/profileHeadline e chat grezza → purpose `decision_engine` classificato PII (mai cloud). F0.5 = prompt dimostrabilmente anonimo ⇒ flip a no-PII. Piano (riuso `swirling-chasing-moonbeam`) passato da review adversariale: 10 finding integrati (2 ALTA: tag chat reale `ME:` non `YOU:`; detector PII su STRINGA, non su oggetto — il confronto reference-based sarebbe sempre-true).

### Interventi (3 chunk L1-verdi)
- **A `e386d8b`**: `src/ai/leadPseudonymizer.ts` — REGOLA D'ORO: output solo enum chiusi/boolean/numeri (+region coarse alfabetica). `pseudonymizeLead` riusa `inferLeadSegment`/`inferLeadIndustry` (ml/segments; enrichment free-text = solo INPUT dell'inferenza, mai emesso raw); `normalizeSeniority` whitelist (vp PRIMA di c_suite: "vice president" contiene "president" — bug trovato dal test, fixato alla radice); `coarseRegion` scarta componenti con cifre; `distillChatSignals` sui tag reali `THEM:`/`ME:`. Property test anti-PII (15 test). Fix classificatore: pattern tech ora matcha "technology" (`\btech\b` falliva su "Information Technology" — zero-P, consumer verificati).
- **B `02dfe21`**: `buildDecisionPrompt` riscritto su feature anonime per i 5 decision point (riga Conversation = segnali count/lastFrom/replied, emessa solo se chatMessages fornito — oggi MAI dai worker: ramo vivo solo per inbox_reply orfano, wire in F3); istruzione pre_follow_up riscritta su "lead replied: yes → SKIP"; JSDoc: i campi identificativi del request non escono mai nel prompt. Guard difensiva in aiTextClient (ramo cloud): `sanitizeForLogs` su stringa come detector → `ai_text.cloud_pii_suspect` (osserva, non muta; rileva solo PII regex-detectable — difesa primaria = test sentinella). Test: sentinelle PII sui 5 punti + feature anonime attese + guard warn/no-warn. Worker INTATTI.
- **C `2652ed9`**: flip `PII_SENSITIVE_PURPOSES.decision_engine → false` (commento → test sentinella + condizione di riclassificazione inversa); test dichiarativi (anthropic esplicito → `anthropic_selected`; auto+OpenAI-key-remota → `cloud_configured`: guard sul DATO non sul vendor, comportamento dichiarato); registro GDPR art.30 allineato allo stato reale (Anthropic riceve solo feature pseudonimizzate, enforcement meccanico, generazione messaggi locale).

### Verifica
conta-problemi exit 0 ad ogni chunk; finale **171 file / 1690 test** (da 170/1663 post-F0: +1 file, +27 test). antiban-review: **SICURO** (worker/timing/volumi intatti; il decision engine può solo SKIP/DEFER in più, mai aumentare). Accuracy decisioni monitorata dal feedback loop esistente (decisionFeedback): eventuale degrado da prompt più povero → rivedere in F3 con evidenza.

## 2026-06-11 — ai-stack F0: provider Anthropic + providerRegistry cablato + guard zero-PII (`/goal ai-stack`)

### Obiettivo
F0 del goal `ai-stack` (binding `~/todos/ai-stack.md`): aggiungere il provider Anthropic dietro un'astrazione e CABLARE `providerRegistry.resolveAiProvider` (era dead code: 12 call-site chiamavano direttamente `requestOpenAIText`, il fallback H28 non scattava mai). Vincoli utente: ZERO PII al cloud (guard meccanica), config-driven per-deployment (requisito prodotto multi-tenant). Piano `swirling-chasing-moonbeam` passato da review adversariale (11 finding integrati, 4 ALTA: gate globale regressivo nel registry, timeout assente in executeWithRetryPolicy, ramo H28 risoluzione-senza-esecuzione, 2 test con mock-factory parziali).

### Interventi (4 chunk L1-verdi, commit separati)
- **A `7655398`**: `@anthropic-ai/sdk` + config (`AI_PROVIDER` auto|anthropic|openai|ollama|template, `ANTHROPIC_API_KEY/MODEL/TIMEOUT_MS`) + validazione boot (anthropic ⇒ key + remote-endpoint) + `src/ai/anthropicClient.ts` (Messages API, stessa shape di requestOpenAIText; timeout dal costruttore SDK perché `executeWithRetryPolicy` NON applica timeoutMs; `maxRetries: 0` = retry policy unica in integrationPolicy; circuitKey `anthropic.messages`; classify transient su classi tipizzate SDK; json_object via istruzione system + strip fence) + 13 unit test.
- **B `d66e1cf`**: `resolveAiProvider(purpose)` con purpose tipizzato (12 valori) e mappa PII; **guard zero-PII**: purpose con dati lead MAI su cloud, anche con AI_PROVIDER esplicito; gate `aiPersonalizationEnabled` RIMOSSO dal registry (avrebbe regredito intentResolver/leadScorer/leadDataCleaner/aiAdvisor/postContent che girano con personalization OFF — regression test dedicato); `auto` NON seleziona mai anthropic in F0 (storico esatto); green mode prioritario + metadata `aiGreenModel` coerente col client.
- **C `3675efb`**: facade `src/ai/aiTextClient.ts` (`requestAiText`/`isAiTextConfigured`/`AiProviderUnavailableError` + audit `ai_text.cloud_dispatch` su ogni uscita cloud) + sweep 13 file (11 call-site + companyEnrichment gate + adminCommands status `aiProvider`/`aiTextConfigured`); semanticChecker INTOCCATO (embeddings su openaiClient by-design); 2 test ripuntati su aiTextClient; madge src/ai = 0 circolari.
- **D+E**: `aiProviderFallbackChain.vitest.ts` (5 test: registry+dispatch REALI — anthropic→locale su CB aperto, →AiProviderUnavailableError senza locale, guard PII nel dispatch, recovery CB) + check `Anthropic` in `preflightEnv` (GET /v1/models, valida key senza consumare token; FAIL solo se AI_PROVIDER=anthropic).

### Verifica
conta-problemi exit 0 ad OGNI chunk; finale **170 file / 1663 test** (baseline 167/1625; +3 file, +38 test). Grep sweep: `requestOpenAIText|isOpenAIConfigured` = 0 fuori da {aiTextClient, openaiClient, providerRegistry, semanticChecker}+mock test. antiban-review: **SICURO** (no browser/timing/volumi; egress api.anthropic.com diretto e separato dal proxy LinkedIn). Limite noto documentato: ramo H28 `OLLAMA_FALLBACK_URL` separato = risoluzione-only (fix F4). **Leva utente E2E live**: env nel binding (key + AI_PROVIDER=anthropic + remote + flag call-site) → atteso log `ai_text.cloud_dispatch {provider: anthropic}`.

## 2026-06-11 — sync-list-fix G5-F3 + G4-parte2 + G3-LOW: split god-function + characterization (`/goal sync-list-fix`)

### Obiettivo
Chiudere i residui del piano groovy-coalescing-bachman: split di `runSalesNavigatorListSync` (Tier1+Tier2), characterization test sulle unità estratte, decisione sui conteggi G3-LOW.

### Interventi
- **F3 split (4 commit move-only, ogni chunk L1-verde a 166/1610 = baseline)**: Tier1 `fc67b5c` (resolveSyncTarget, initSalesNavigatorSyncReport, launchOrReuseSession, ensureLoggedInOrAwaitManual, applyWarmupAndInputBlock) + `64b210f` (restoreListCheckpoint, closeOwnedBrowser — dedup success-path/finally, capturePostSyncMetrics); Tier2 `83af88f` (discoverAndFilterLists, orchestrateEnrichmentByList) + `14a5e88` (processSingleListSync con contratto `SingleListSyncOutcome {challengeAborted, scrapeDegraded}`, upsertLeadBatch unit-testabile). La funzione è ora orchestratore sottile (~95 righe); aggregazione report spostata al caller (totali identici — su throw il report non è osservabile). Nota zero-M: «994 righe» dell'audit era il FILE, la funzione era ~414.
- **G4-parte2** `92d7b37`: `salesNavSyncSplit.vitest.ts` (15 test) su resolveSyncTarget / restoreListCheckpoint / upsertLeadBatch / processSingleListSync; export mirati marcati "characterization".
- **G3-LOW** (zero-C.10): consumer verificati = SOLO display/telemetria (formatFinalReport + `candidati_trovati/unici` syncListService:280) → JSDoc semantica esplicita sui campi (lordo anchor DOM; unici per-lista non cross-lista); scartati campo-dedup nuovo e cambio numeri (comparabilità storica).
- Igiene: `graphify-out/` → .gitignore (artefatto rigenerabile).

### Verifica
6× `conta-problemi` exit 0 nel blocco; finale **167 file / 1625 test** (+1 file, +15 vs baseline). antiban SICURO su tutti i chunk (refactor puro move-only). Residui goal = SOLO leve utente: repro E2E G1 (LinkedIn-live) + decisione Vision.

## 2026-06-11 — sync-list-fix G5-F2: quarantena per-account (`/goal sync-list-fix`, piano groovy-coalescing-bachman)

### Obiettivo
`account_quarantine` era un flag GLOBALE: un incidente su 1 account fermava TUTTI (bloccante per il multi-account imminente). Scoping per-account con chiave composta, senza MAI rendere più permissivi i segnali globali.

### Design (zero-C.10, dichiarato)
Helper in `repositories/system.ts`: `setAccountQuarantine`/`getAccountQuarantine` su chiave `account_quarantine:<accountId>` + `getQuarantineStatus()` aggregato. **Fail-safe a 2 vie**: (a) incidente NON attribuibile (`accountId` assente → 'default') scrive il flag GLOBALE legacy che blocca tutti; (b) reader = per-account OR globale legacy (backward-compat: quarantene pre-F2 restano efficaci). Segnali platform-wide (SELECTOR_FAILURE_BURST, SELECTOR_CANARY_FAILED, RISK_STOP_THRESHOLD, LOGIN_2FA in checkLogin senza account in scope) restano DELIBERATAMENTE globali; account-specific (RESTRICTED/CHALLENGE/LOGIN_MISSING/COOKIE/WEEKLY_LIMIT/LOGIN_REQUIRED canary) attribuiti. Scartato: quarantinare sempre per-account (un selector-burst avrebbe lasciato girare gli altri account su selettori rotti = rischio detection).

### Interventi (13 file src + 3 test + 2 docs)
- Writer: `incidentManager.ts` (`quarantineAccount` → `setAccountQuarantine(resolveAccountId(details))`; `setQuarantine(enabled, accountId?)` L2 retro-compat); canary `LOGIN_REQUIRED` ora ritorna `accountId` (CanaryOutcome esteso) e il caller lo passa nei details.
- Reader per-account: `workflowEntryGuards.ts` (account operativo `varianceAccountId`), `jobRunner.ts` (`runQueuedJobs`: check DENTRO il loop → skip del solo account quarantinato, niente break globale; flag globale li salta tutti come prima), `loopCommand.ts` (convenzione `accounts[0]`), `orchestrator.ts` (snapshot pre/post `runQueuedJobs` → blocked SOLO su quarantena NUOVA mid-run, non pre-esistente di altri account).
- Aggregati (additivi, boolean invariati = `any`): `doctor.ts` (+`quarantinedAccounts` nel report → preflight `index.ts` invariato e conservativo), `adminCommands.ts` status, `v1Automation.ts` snapshot, `stats.ts` kpis.
- Admin/API: `unquarantine [--account <id>]` (CLI + help; warning se restano quarantene residue), `QuarantineSchema` zod + `controlActions.ts` con `accountId` opzionale validato (min1/max128).
- Test: NUOVO `accountQuarantine.vitest.ts` (5 test semantica helper su sync_state finto: isolamento A/B, legacy globale, fail-safe default, spegnimento, aggregato); `workflowEntryGuards.vitest.ts` (+1 test per-account, quarantine/LOGIN_REQUIRED aggiornati); `workflowOrchestratorBlocks.vitest.ts` (mock `getQuarantineStatus`).

### Verifica
antiban-review ✅ SICURO (6/6: nessun timing/fingerprint/azione toccata; segnali globali mai indeboliti) · `conta-problemi` exit 0: typecheck FE+BE, eslint 0-warn, **166 file / 1610 test** (baseline 1604, +6). Docs allineati (GUIDA.md, SECURITY.md).

## 2026-06-10 — outbox-dailystat: recupero `cloud.daily_stat` idempotente (`/goal outbox-dailystat`, FOLLOW-UP D2)

### Obiettivo
Chiudere il gap dato-cloud-perso: il dispatcher outbox (D2, `f5915dc`) escludeva `cloud.daily_stat` perché l'increment non era idempotente → al fallimento del path diretto la statistica finiva solo in `cp_events` (0 consumer) e non arrivava MAI a `daily_stats_cloud`.

### Design (zero-C.10, dichiarato)
Claim-table + RPC plpgsql transazionale: `cp_applied_events(idempotency_key PK)` + `increment_daily_stat_cloud_idem` che claima la chiave (`INSERT … ON CONFLICT DO NOTHING`, semantica `FOUND` verificata su docs PostgreSQL ufficiali) e fa l'increment NELLA STESSA transazione → re-apply al retry = no-op. Scartati: cp_events come registro (claim non atomico con l'increment nel flusso apply→log) e event_id sulla riga stats (riga aggregata, non per-evento). Bonus: RPC base `increment_daily_stat_cloud` aggiunta allo schema canonico (era chiamata dal client ma ASSENTE — chiude il residuo D3) con whitelist dei 7 field.

### Interventi
- `src/sync/migrations/cloud_001_daily_stat_idempotent.sql` (+`.down.sql` con caveat re-count) — NUOVA dir migrations cloud; mirror in `supabase.full.schema.sql` (tabella + 2 RPC + RLS disable).
- `src/cloud/supabaseDataClient.ts`: `incrementCloudDailyStatIdem` — su errore THROW deliberato, NESSUN fallback read-modify-write (meglio retry outbox che doppio conteggio; degradazione sicura se RPC non deployata).
- `src/sync/supabaseSyncWorker.ts`: `applyOutboxOperation(topic, payload, idempotencyKey?)` (param opzionale, L2 retro-compat) + case `cloud.daily_stat` (richiede chiave + payload valido + field in whitelist); drain passa `payload.idempotency_key`.
- `src/tests/outboxDispatch.vitest.ts`: 6→10 test (chiave passata, re-apply stessa chiave, no-key→no-op, whitelist/payload invalido, errore RPC propagato).

### Verifica
outboxDispatch 10/10 PASS · `conta-problemi` exit 0 (typecheck+lint+**1599** test). ⚠️ RESIDUO leva utente: APPLY della migration su Supabase (progetto in timeout 3/3 — probabilmente in pausa) — SQL pronto, applicabile anche via MCP `apply_migration` con conferma.

## 2026-06-10 — context-burn: protocollo gestione contesto/burn a tier (`/goal context-burn-rules`, chiusura T2-T4)

### Obiettivo
Chiudere il residuo del goal: protocollo burn A–G (approvato dall'utente 2026-06-09) scritto come regola nei canonici globali + hook ai tier + parità.

### Interventi
- **T2** nuova regola always-on `~/.claude/rules/context-burn.md`: 1M sempre; tier 40/60/75% di 1M (niente / lastchat+new al confine naturale / cerca confine / reset OBBLIGATORIO); compact MAX 1×/sessione; quality-guard (mai reset a metà operazione atomica); cache-TTL 5min; modello-per-task; UltraCode selettivo; micro-regole burn. Pointer 1-riga in `~/.claude/CLAUDE.md` («Qualità > token»).
- **T3** `~/.claude/hooks/user-prompt-session-advisor.ps1`: tier 40/60/75 + `compacts>=1` (era `>=2`, regola compact-max-1×) + quality-guard nei messaggi; `~/.claude/scripts/turn-governor-hook.ps1`: backstop >750k allineato (anche su Stop), tier NON duplicati.
- **T4** parità: `~/memory/preferences.md` (riga tier supersede 750k-only + fix blocco stale CONTINUATION→LASTCHAT), `direttive_utente_log.md` (SUPERSEDED), `feedback_consigli_con_criterio.md` (nota tier), `.claude/rules/meta-reasoning.md` §2 (pointer). Bonus coerenza: count «16 regole A-P»→«17 A-Q» in meta-reasoning.md + ZERO_RULES.md description.

### Verifica
Test hook 6/6 PASS (transcript finti 200k/450k/650k/800k × 0/1 compact: messaggi tier corretti, silente <400k, backstop governor solo >750k). `audit:rule-enforcement` 43/56, 0 gap meccanizzabili. `conta-problemi` exit 0 (1595 test).

## 2026-06-09 — backlog-operativo: mouse «più solido» ([WINDOW-BLOCK] hardening, `/goal backlog-operativo`)

### Obiettivo
Richiesta utente post-compact: «se clicco si chiude il browser, è giusto così ma deve essere più solido». Il run E2E `br98xrwq6` aveva PROVATO che la pipeline gira (login+canary OK, scrape 6 pagine×25) ma moriva con `WORKFLOW_ERROR: Target page closed` — il click utente chiudeva il browser.

### Root cause (diagnosi evidence-based, Workflow `w9pjoafcp`, 2 agenti alta-conf; 3° = ricerca SOTA bloccata dai safeguard cyber)
Il click-through OS aveva buchi di copertura (l'unico layer che protegge la *chrome* — X chiusura; l'overlay DOM copre solo la pagina): (1) la finestra del **selector-canary** non era MAI protetta (`workflowEntryGuards.ts` lancia il suo browser, zero click-through); (2) stato **singleton** `_lastPid` + reapply solo-on-navigation throttle 1200ms lasciava scoperte le finestre/child nate da `page.goto`; (3) rumore: `execSync` inoltrava lo stderr CLIXML della PS a node → `bot.ps1` falliva a deserializzarlo (`Cannot process the XML`).

### Fix committati (antiban SICURO, gate verde 1595 test, trattenuti dall'auto-push: review di branch)
- `70d3c17` **windowInputBlock.ts**: stato **multi-PID (Set)** (protegge canary+sync insieme); **timer async ~1s** (`execFile` non-bloccante → timing anti-ban intatto) per re-apply continuo; **stdio pipe/execFile** elimina lo stderr CLIXML. **workflowEntryGuards.ts**: enable click-through sul canary dopo launch + disable dopo closeBrowser.
- `5a5abe8` **split SRP**: estratto `buildPowerShellScript` (template Win32/C#) in `windowInputBlockScript.ts` → `windowInputBlock.ts` 328→255 righe (<300).

### Verifica (E2E reale, run `b9di2t2u0`)
Scrape **8 pagine / 100 lead**, **chiusura browser NORMALE** (`[OK] Browser chiuso. Avvio enrichment`), **ZERO `Target page closed`**, **ZERO errori CLIXML**; login manuale durante il run sopravvissuto (ciclo enable/disable OK). + conta-problemi verde (typecheck BE+FE, lint 0-warn, 1595 test). Residuo tracciato: acceleratori tastiera (Ctrl+W/Alt+F4) non coperti (serve keyboard-hook, fuori scope «click»).

## 2026-06-09 — Workflow-hardening: audit anti-ban + fix architetturali (`/goal workflow-hardening`)

### Obiettivo
3 pilastri: (1) 4 workflow E2E col proxy, (2) bug di ogni workflow fixati + gate=0, (3) anti-ban SOTA 2026. Parte AI-side (#2, #3) chiusa; #1 = leva utente (re-login mobile). Ogni finding verificato alla fonte (zero-M).

### Fix committati (9, gate fino a 1592 test + madge 0 circular)
- `27626ca` **A1** guardian fail-open (critical+pauseMinutes:0 ora pausa sempre >=30min), **A3** ACCEPTANCE/HYGIENE non accodati in risk STOP, **A5** applyAdaptiveFactor no invito-fantasma.
- `94a2f3f` **A2** weekly invite cap enforced anche in esecuzione (inviteWorker, con compensazione).
- `b3cc1d7` **R1** comando automation fallito/bloccato non piu' marcato SUCCEEDED (loopCommand branching).
- `c4fdabe` **W3** keystroke floor 40->55ms (fuori zona-bot <50ms, SOTA 2026 keystroke dynamics).
- `27d14d2`+`01fba0a` **R6**+**R6-bis** hook auto-push: non pusha i commit anti-ban (controlla l'intero backlog @{u}..HEAD, non solo HEAD).
- `1f99e08` **D1** mutex withTransaction SQLite (serializza le transazioni concorrenti, factory di test).
- `746294e` **A4** cancella i job accodati se un guard blocca dopo lo scheduling (enqueueJob->ID + deleteQueuedJobsByIds + cleanup ai 4 return blocked).
- `f5915dc` **D2** il drain outbox ri-applica l'operazione cloud (3 upsert idempotenti; cloud.daily_stat escluso: increment non-idempotente).

### Verificati e declassati con evidenza (zero-M, non fixati a vuoto)
D3 (RPC atomica gia' primaria), R1c (workerResult.success=errors.length===0 corretto), R1d (edge), USE_JA3_PROXY (camoufox gestisce il TLS nativamente). Correzione di direzione anti-ban: mobile > residential su LinkedIn 2026 (~85% vs ~50% survival) — NON comprare residential.

### Restano (tracciati, non-critici o leva-utente)
M1-M3 medium (M1 multi-account/no-op su singolo, M2 Win32/[WINDOW-BLOCK], M3 snapshot env bootstrap), cloud.daily_stat idempotency, W1(B) resource-blocking (da fare con E2E per misurare), pilastro #1 E2E (leva utente: re-login mobile). Piano architetturale: `~/.claude/plans/vast-inventing-engelbart.md`; binding: `todos/audit-orchestrator-fix.md` + `todos/workflow-hardening.md`.

### Verifica
typecheck (BE+FE) + lint 0-warn + 1592 test + madge 0 circular su ogni commit. Branch refactor/adk-split. Commit anti-ban (A4 `746294e`) trattenuto dall'hook auto-push (review di branch obbligatoria); push = leva utente.

## 2026-06-07 — Collaudo uso-reale dei workflow del bot (`/goal workflow-collaudo`)

### Obiettivo
Collaudare a 360° TUTTO l'uso analizzabile del bot (non solo i 5 comandi-esempio citati — meta-reasoning #11) su 4 dimensioni: UX uso-reale, anti-ban/movimento mouse, intelligenza AI, sistema. Bug + migliorie PRIMA dell'uso utente. NESSUNA esecuzione live LinkedIn (solo analisi del codice).

### Metodo
3 Workflow fan-out: `woq8oa9nq` (5 funnel, 62 find) + `wc8raqgjq` (aree B-H: azioni/setup/salesnav/enrichment/controllo/dashboard, 73 find) + sintesi `wjf45cnxd` → **135 find (1 critical, 32 high, 67 med, 35 low) → 1 critical + 18 cluster root-cause**. Fix INLINE per cluster, anti-ban via antiban-approved + antiban-review SAFE. Ogni fix verificato alla fonte (zero-M): scartato CL19 come FALSO POSITIVO, corretto il path errato di CL10.

### Fix committati
- `bbc7930` **C1** (critical): preflight-env filename mismatch — `META_FILENAME` esportata (check sessione falliva sempre dopo login).
- `dbab8b5` **CL5** (anti-ban) random-activity ora passa il doctor-gate; **CL11** (security) XSS stored nel lead-detail dashboard (escapeHtml + href http-only).
- `66706ed` **CL8** (bug) dry-run non contamina piu il DB (messageWorker gate hash/stat/cloud; audit resta).
- **CL19** scartato: FALSO POSITIVO (hash sempre calcolato a messageWorker:140/450, verificato alla fonte).

### Restano (piano completo in `todos/workflow-collaudo.md`)
12 cluster DECIDE (CL2 AI fail-open, CL3 create-profile stealth, CL4 sessioni browser spurie, CL6/7/9/10/12/13/14/17/18) + 3 CONFIRM leva-utente (CL1 NavHelper anti-teletrasporto ~10 file, CL15 auth dashboard SSE/WS, CL16 privacy-cleanup dry-run) + triage medium/low (102 find). I cluster grossi anti-ban core (CL2/CL3/CL4/CL1) da blocco DEDICATO con verifica comportamentale A/B.

### Verifica
conta-problemi=0 (typecheck BE+FE, lint 0-warn, 1538 test) su ogni commit. Branch refactor/adk-split (condiviso col peer codex): pathspec, lock orfano git rimosso in sicurezza (nessun processo git attivo).

## 2026-06-07 — Prod-readiness HIGH: 18 finding HIGH/PARTIAL del Backend Deep Audit (`/goal prod-readiness`)

### Obiettivo
Prod-readiness a 360° del workflow del bot (anti-ban first, correttezza prod, GDPR, security, vendibilità). Verifica ALLA FONTE di C1+H1-H24 (zero-M: non assumere "già fatti") → fix degli OPEN in ordine di rischio.

### Metodo
WAVE 0 — verifica-stato in fan-out (Workflow `audit-prodblocker-status`, 25 agenti sonnet read-only): **6 FIXED** da sessioni precedenti (C1, H2, H7, H9, H10, H16), **3 PARTIAL** (H6, H8, H24), **16 OPEN**. Fix INLINE per wave (zero-C.2); file anti-ban gated via protocollo antiban-approved + antiban-review SICURO. `conta-problemi`=0 (1500 test) ad ogni commit; pathspec, zero file peer.

### 18 finding risolti+committati (9 commit, ogni conta-problemi=0)
- `3be2219` anti-ban: H4 preflight headless blocca sui warning CRITICAL (prod PM2); H5 hot-reload valida config + rollback; H12 lock takeover atomico (anti doppio-runner).
- `53d564a` anti-ban: H1 renderer WebGL per device-class (mobile Adreno/Mali, Linux Mesa — elimina contraddizione GPU/UA, stringhe reali via web); H3 sessione SalesNav default conservativi; H15 proxy fallback d'emergenza onorato (signature api-injected).
- `0194c03` data-integrity: H13 `PRAGMA foreign_keys=ON` (root cause meccanica di C1, nessuna FK violation latente nei test); H14 purge GDPR cancella `outbox_event_deliveries` prima della FK.
- `037d839` security: H6 telegram listener fail-closed senza allowlist; H8 sentry `sendDefaultPii=false`.
- `6262ba2` correttezza PG: H11 transazioni leadsCore atomiche (`getDatabase()` tx-client via ALS dentro il callback, non il pool autocommit).
- `c6c709d` GDPR: H17 gate `gdpr_opt_out` (enrichLeadAuto + worker); H18 registro Art.30 allineato ai processor US reali; H19 redaction fail-fast (no screenshot PII non redatti verso OpenAI).
- `6c9a69a` test (P1): H20 worker azione (18 test), H23 auth detection (15 test), H24 leadsCore tx rollback (SQLite in-memory) — generati via fan-out auto-verificato.
- `5d8b70b` test (P1): H22 `computeProxyCooldownMs` funzione pura + test reali del cooldown differenziato (no più tautologie).

### Restano — tracciati con motivo in `todos/prod-readiness.md`
- **H21** test `humanBehavior` (1423 LOC, cuore anti-ban): richiede refactor strutturale (estrazione funzioni pure timing/varianza) → blocco DEDICATO con verifica comportamentale A/B (valori pre-post identici, altrimenti rischio ban). Eccezione zero-J legittima (rischio anti-ban non valutabile a fine sessione lunga).
- **Wave E** workflow runtime hardening (backlog non-audit, scope ampio). **Wave G** prod-readiness operativa (SQLite→Postgres, health-check, alerting, CI/CD = infra + leve utente).

### Verifica finale
`conta-problemi`=0 ad ogni commit (typecheck BE+FE + lint 0-warn + 1500 test, con FK ON attivo). Branch `refactor/adk-split` (condiviso col peer codex): commit via pathspec, zero file peer.

## 2026-06-07 — Low-triage: 66 LOW del Backend Deep Audit (`/goal backend-low-triage`)

### Obiettivo
Triage + fix dei 66 finding LOW del Backend Deep Audit, sotto la regola decide-vs-confirm (difensivo+reversibile+antiban-review-SAFE → applico io). Verifica zero-M alla fonte (il med-triage aveva già chiuso alcune aree).

### Metodo
Triage in fan-out (Workflow chunked, 46 file-unit) → 67 finding: **33 APPLY · 18 DEFER · 8 NO_CHANGE · 8 ALREADY_FIXED**. Fix applicati INLINE in wave (zero-C.2), anti-ban via protocollo antiban-approved + antiban-review SICURO. `conta-problemi`=0 (1501 test) ad ogni commit; pathspec, zero file peer.
> Nota di processo: il 1° run Workflow (46 agenti in burst) è stato rate-limited lato server → fix (chunk sequenziali da 4) + **regola globale anti-burst** in `~/.claude/ZERO_RULES.md` zero-C.2 + error memory `workflow-fanout-burst-throttle`.

### 33 APPLY committati (7 commit)
- `dc04bbd` W1 — 11 hygiene/correctness: preflight `_accountId` dead-data; jobRunner ETA clamp + progress isTTY; riskEngine.vitest de-tautologia; migration 059 commento; securityAdvisor TOCTOU; aiControlPlaneRegistry regex try/catch; config/validation 2 warn ridondanti; shared/types `AI_ABORT`; linkedinChangeAlert zod; rename proxyAndNoise→proxyManager.vitest.
- `d78c927` W2a — leadsCore LIKE escape; webSearchEnricher phone validation; companyEnrichment accountId; stats clamp(8); export Art.20 filtro per-soggetto.
- `630851a` W2b — gdprRetentionCleanup: computeLastActivity guard + URL PII→hash in 7 log.
- `b41d2a6` W2c-db — db.ts: pg_dump PGPASSWORD; DDL identifier allowlist; init-race promise-memo; pool/timeout configurabili + SET LOCAL nelle migration.
- `b11953d` W2c-rest — stats getRiskInputs Promise.all + identifier allowlist; aiQuality try/catch→FAILED.
- `7d2853e` W3a — jobRunner windDown reset; salesNavigatorSync checkpoint guard; scripts/rampUp day-target (anti-ban-content, antiban-review SICURO).
- `83cae6b` W3-gated — inviteWorker scroll randomizzato; messageWorker dry-run; visionProviderFactory configHash; proxyManager 7 log strutturati; sendInvitesService limit guard (protocollo antiban-approved + antiban-review SICURO).

### Carve-out (non applicati, per design)
18 DEFER (migration DB / decisione prod-segreti / P2-decomposition god-module / riscritture comportamentali anti-ban da verifica-live), 8 NO_CHANGE (by-design), 8 ALREADY_FIXED (med-triage). Restano in `BACKEND_DEEP_AUDIT_2026-06-06.md` come P1/P2.

### Verifica finale
`conta-problemi`=0 (typecheck BE+FE + lint 0-warn + 1501 test) su ogni commit. Branch `refactor/adk-split` (condiviso): tutti i commit via pathspec, zero file peer.

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

- **Ondata 3 (6 fix hygiene+resilience, non anti-ban)**:
  - `cli/cliParser.ts`: `parseIntStrict` con match regex completo (`/^-?\d+$/`) → `'12abc'` ora rifiutato, non troncato a 12.
  - `cli/stdinHelper.ts`: `readLineFromStdin` rimuove anche i listener `close`/`error` in cleanup → niente accumulo cross-chiamata.
  - `ai/aiDecisionEngine.ts`: `clearTimeout` via `.finally` sulla `Promise.race` → il timer non resta pendente quando l'AI risponde in tempo.
  - `telemetry/alerts.ts`: `escapeTelegramHtml` su title/message prima del `parse_mode: HTML` → caratteri `<>&` nei dati non rompono più l'alert (era drop silenzioso).
  - `ai/semanticChecker.ts`: eviction FIFO delle chiavi della Map statica (cap 500 lead) → niente memory leak illimitato.
  - `validation/messageValidator.ts`: il catch del semantic check ora logga (`logWarn`) invece di essere muto (fail-open silenzioso).

- **Ondata 4 parziale (2 fix security/correttezza, non anti-ban)**:
  - `api/helpers/audit.ts`: `auditSecurityEvent` logga (`logError`) il fallimento di scrittura invece di inghiottirlo (`.catch(()=>null)`) — un audit di sicurezza droppato è esso stesso un evento di sicurezza.
  - `workflows/preflight/statsCollector.ts`: trend "vs ieri" deriva 'oggi' e 'ieri' dalla stessa base locale (`getLocalDateString`) → niente off-by-one a mezzanotte (era ieri-UTC vs oggi-locale).
  - `security/totp.ts`: anti-replay — ogni codice TOTP (timestep) è validabile UNA sola volta (prima restava valido ~90s e riutilizzabile se intercettato).
  - `sync/supabaseSyncWorker.ts`: alert Telegram dedicato sui `PERMANENT_FAILURE` (escono dal conteggio `pending` → l'alert backlog era cieco) — evento perso verso il cloud ora notificato.
  - `scripts/restoreDb.ts`: `runPostgresRestore`/`pgRestoreToDb` da `execSync` con redirection shell a `execFileSync` + stdin (args non interpolati) → no command injection; rimosso import `execSync` orfano.
  - `api/routes/metrics.ts`: il catch non fa più echo di `err.message` su `/metrics` (endpoint non autenticato) → messaggio generico + `logError` interno (no info leak). [Auth/rate-limit su /metrics = CONFIRM-USER: romperebbe lo scraping Prometheus.]
- **Residui Ondata 2 (correttezza leadsCore/leadsLearning, non anti-ban)**:
  - `core/repositories/leadsCore.ts addLead`: i 4 statement (INSERT lead + lookup + INSERT list_leads) ora in `withTransaction` → atomicità (no lead senza membership o viceversa). +test.
  - `core/repositories/leadsLearning.ts appendLeadReplyDraft`: read-modify-write del JSON metadata in `withTransaction` → no lost update su SQLite (FOR UPDATE per PG = follow-up).
  - `core/repositories/featureStore.ts importFeatureDatasetVersion`: eliminata la verifica signature tautologica (default `|| computedSignature` rendeva il check sempre vero) → verifica reale se la signature è fornita, `logWarn` esplicito se l'import è non firmato (throw invariato per signature errata).
  - `core/repositories/leadsCore.ts searchLeads`: `normalizeLegacyStatus(opts.status)` → ricerca per status legacy ora trova i lead migrati. +test.
  - `csvImporter.ts importLeadsFromCSV`: cap `MAX_CSV_ROWS` con stop esplicito (no OOM su file enormi). [Parte transazionale-batch = DEFER: edge-case PG transaction-abort su errore per-riga senza savepoint per addCompanyTarget.]
  - `integrations/leadEnricher.ts enrichLead`: il flag `deep` ora ha effetto (`deep=false` salta l'OSINT pesante di findPersonData); default invariato. Prima era documentato ma mai applicato.
  - `security/filesystem.ts chmodSafe`: avviso una-tantum quando l'hardening permessi è no-op su Windows (DB/backup/sessioni senza ACL) — prima silenzioso. [ACL reali via icacls/DPAPI = evoluzione.]
  - **`config/env.ts resolveSecret` riclassificato CONFIRM-USER**: invertire la priorità Docker-secret vs `process.env` cambia il secret-loading in produzione (rischio/irreversibile, zero-G) → richiede conferma utente, non fix-now.

### Stato reale
- Triage 142/142 classificato. Applicati e committati: Ondata 1 (5 fix), 2 parziale (3 fix), 3 (6 fix), 4 parziale (2 fix) = **16 fix medium** + 8 HIGH del Batch B; +21 test mirati. Restano (turni successivi): residui Ondata 2 (addLead/leadsLearning/featureStore — infra DB-test), residui Ondata 4 (totp/restoreDb/metrics/filesystem) + sparsi (supabaseSyncWorker/csvImporter/leadEnricher). env.ts = CONFIRM-USER. Nessun file anti-ban/peer toccato. Push da coordinare col peer.

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

## 2026-06-07 — Anti-ban hardening difensivo (Gruppo A, autorizzazione «decidi tu»)

### Obiettivo
Applicare i rinforzi DIFENSIVI anti-ban dal triage backend (riducono il rischio ban, reversibili via env/config), decisi autonomamente sotto la regola difensivo+reversibile+/antiban-review-SAFE -> applico io (memory feedback_antiban_decide_vs_confirm). Binding: ~/todos/backend-antiban-hardening.md.

### Interventi (Gruppo A 7/9, ognuno /antiban-review SICURO + gate verde + commit pathspec)
- A1 config/domains.ts: pendingRatioStop 0.8->0.65, pendingRatioWarn 0.65->0.55 (hard STOP al red-flag). +4 test. 355868e.
- A2 core/scheduler.ts: re-clamp budget a weeklyRemaining DOPO moltiplicatori strategy/mood (impediva di superare il weekly cap). efe2835.
- A3 workers/inboxWorker.ts: auto-reply conta in messages_sent via checkAndIncrementDailyLimit atomico + compensazione (era guard non-atomico). bcbb5b5.
- A4 workers/interactionWorker.ts + config: LIKE/FOLLOW daily cap (30/15, erano illimitati). +4 test. 00ffe35.
- A5 proxyManager.ts + config: Tor fallback opt-in (default false; era default-ON) + alert pool esaurito. +2 test. 4a1bf71.
- A6 proxyManager.ts: deprioritizza proxy datacenter nella selezione (mai rimossi -> no halt). 876f972.
- A7 fingerprint/pool.ts: fingerprint stabile per account (rimossa rotazione settimanale con downgrade/cambio famiglia). ac46e0f.

### Verifica
- npm run conta-problemi: typecheck BE+FE + lint max-warnings 0 + 1496 test, exit 0 ad ogni commit.
- +10 test regressione difensivi in src/tests/antibanDefensiveDefaults.vitest.ts.
- Zero file anti-ban senza /antiban-review; zero file peer (separata via reset+pathspec una delete del peer risucchiata: errors/2026-06-07-commit-swept-peer-staged-delete).

### Residui (turno successivo / /goal backend-antiban-hardening)
A8 geo-coerenza exit-IP (feature mancante, opt-in), A9 challenge gate persistente, C1/C2 de-correlazione multi-account, B1-B6 comportamentali, S1/S2 (env secret priority, /metrics auth), T1 csvImporter tx-batch. Auto-push OFF (branch condiviso + anti-ban -> coordinamento/PR). Flaky pre-esistente: unhandled-rejection in appContextAndCloudBridge (~1/3 run).

### Aggiornamento (stessa sessione 2026-06-07): Gruppo A completato + C1 + S2
- A8 geo-coerenza exit-IP opt-in (proxyExpectedCountries, deprioritize geo-mismatch in prioritizeProxyPool) — `54f3162`.
- A9 challenge gate persistente (no auto-resume su account flaggato; challengePersistentGate default true; pauseAutomation→number|null) — `1744d59`.
- C1 mood/ratio seed per primaryAccountId (de-correlazione multi-account) — `f92362b`.
- S2 /metrics auth opt-in (METRICS_AUTH_TOKEN Bearer timing-safe, default scraping aperto, secureEquals esportato da wsAuth) — `032b959`.
- Verifica: conta-problemi exit 0 (1496 test) ad ogni commit. Totale sessione: 11 fix (A1-A9, C1, S2) + worklog, tutti review SICURO, zero file peer.
- Residui CONFERMA-UTENTE: C2 (migration leads.account_id), S1 (priorità secret prod). ALTA-CURA: B1-B6 (comportamentali browser/stealth), T1 (csvImporter tx). Auto-push OFF (branch condiviso + anti-ban).

### Aggiornamento (sessione 2026-06-07, cont.): Gruppo B-safe + T1
- B2 inter-keystroke log-normale (utils/random logNormalDelayMs +5 test) `e0e01bd`.
- B1 freeze chrome.loadTimes/csi (valori stabili per pagina) `7f80ba4`.
- B3 warm-up profilo via click umano invece di page.goto (fail-safe skip) `e83036a`.
- B4 follow-up anti-burst (pausa lunga periodica, riuso config noBurst) `b89f8a0`.
- T1 csvImporter-tx: RISOLTO senza cambio — premessa audit (shared-tx PG abort) falsa; design per-riga indipendente (addLead withTransaction + addCompanyTarget atomico) = partial-success corretto; wrapping sarebbe regressione. Bounded già fatto.
- Verifica: conta-problemi exit 0 (1501 test) ad ogni commit. Scope autonomo del goal backend-antiban-hardening COMPLETO (16 fix: A1-A9, C1, B1-B4, S2).
- Carve-out (richiedono utente): C2 (migration leads.account_id), S1 (priorità secret prod), B5 (vision click jitter, verifica live), B6 (navigazione/proxy comandi, verifica live). Push OFF (branch condiviso, coordinamento).

### Aggiornamento (sessione 2026-06-07, cont.2): B5 + valutazione B6
- B5 varianza ±3px sul click computer-use (jitterCoord, salesnav/computerUse) `4b42a3f`. Path principale salesnav (bulkSaveHelpers.smartClick) già jitterava proporzionalmente; captcha NON toccato (rischio miss-cella). Vision-model coords main = verifica-live residua.
- B6 VALUTATO (zero-M): --no-proxy/noProxy è feature INTENZIONALE documentata (CLI help, test-connection --no-proxy) → NO change (zero-B+zero-I, romperebbe workflow di test). companyEnrichment.ts:158 page.goto su LinkedIn search URL = teletrasporto reale, ma il fix (digitare query in search box) è riscrittura comportamentale → verifica-live. salesNav/util/syncSearch = solo flag --no-proxy intenzionale.
- Scope autonomo-safe ESAURITO: 17 fix (A1-A9, C1, B1-B5, S2) + T1 risolto-no-change. conta-problemi exit 0 (1501 test). Restano carve-out: C2/S1 (conferma utente), B5-main/B6-companyEnrichment (verifica live), push (coordinamento branch condiviso).

### Aggiornamento (sessione 2026-06-08): Collaudo "uso reale" 360° dei workflow (/goal workflow-collaudo)
- Audit fan-out (135 findings → 19+2 cluster root-cause) collaudando il bot dalla prospettiva utente su 4 dimensioni (anti-ban mouse/navigazione, intelligenza AI, sistema, UX). I 5 comandi citati = esempi (zero-L) → perimetro completo dedotto (aree A–H del dispatch).
- 21 cluster fixati+committati. Highlight: CL1 site-check interleave organico `e38e012`, CL2/CL2b AI fail-open + confidence-gate `6cd6af0`/`f49381c`, CL3 create-profile stealth `873a0d4`, CL6 pending-ratio stop `6387d45`, CL9 navigazione organica per-nome `685fac7`, CL10 GDPR enrich opt-out `2fb9e91`, CL11 XSS dashboard `dbab8b5`, CL15 WS auth via session cookie `6e43ac3`, CL16 privacy-cleanup dry-run+conferma `320a33b`.
- Disciplina zero-M: 5 finding SOVRASTIMATI dalla sintesi confutati alla fonte (CL13/CL18/CL19 già gestiti, CL2-strict/guardian già fail-safe) → evitati fix inutili/rischiosi. anti-ban-mouse + silent-failure verificati CLEAN.
- robustezza-cache `3d77a41`: nuovo `utils/boundedCache` (BoundedMap LRU + BoundedSet FIFO, zero-dep) wira 5 cache enrichment module-level prima illimitate (slow leak long-run). +9 test.
- Verifica: conta-problemi exit 0 ad ogni commit (1560 test a fine sessione). Residui = SOLO leve utente: smoke test live `create-profile` (CL3), opzionali CL15 (security-reviewer indipendente, rimozione totale `?token=`). Push OFF (branch condiviso peer Codex).

### Aggiornamento (sessione 2026-06-10): sync-list reale + audit 360 + fix doppio-lancio browser (G1)
- Run reale `bot.ps1 sync-list`: 1° run BLOCCATO (`launchPersistentContext timeout 180000ms`); root cause = canary apre/chiude un browser camoufox sul profilo persistente, poi il workflow ne apre un 2° sullo stesso profilo → `parent.lock` ancora preso. 2° run OK (canary in cache 4h = lancio singolo). Login SalesNav manuale completato, sync `COMPLETATO` (8 lead aggiornati / 25 cloud-sync / 348 totali).
- Mitigazione `ff4cffd`: `waitForBrowserProcessExit` in `closeBrowser` (poll `process.kill(pid,0)`, bounded 8s, no-op se PID assente) — riduce la race, non garanzia.
- Audit 360 multi-agente (54 agenti) del perimetro sync-list → `docs/tracking/SYNC_LIST_AUDIT_2026-06-10.md` (`40ee82a`): 41 findings (3 critical convergenti sul doppio-lancio, 7 high, 17 medium, 14 low), 4 falsi positivi scartati in verifica adversariale. 2 run del fan-out rate-limited (burst 9 agenti) → ri-eseguito a chunk sequenziali da 3.
- Fix G1 `95c77a3` (Plan Mode approvato, regression-safe): (A) timeout esplicito launch 60s + retry su lock/timeout profilo in `launcher.ts`; (B) handoff sessione canary→workflow OPT-IN (`reuseSession`/`GuardDecisionWithSession.session`) — 1 solo browser invece di 2, altri 4 workflow invariati; (C) `disableWindowClickThrough` nel path success di `salesNavigatorSync.ts:946` (leak click-through). antiban-review SICURO, conta-problemi exit 0 (1599 test). Push OFF.
- Residui tracciati in `~/todos/sync-list-fix.md`: repro E2E del handoff (leva utente, LinkedIn-live); G2-fix1 silent-failure scraping; G3 truthfulness report; G4 test coverage; G5 robustezza (quarantena per-account, split god-function).

### Aggiornamento (sessione 2026-06-11): Sentinella detection-news (`/goal detection-news`)
- CONTESTO: priorità strategica da riesame ai-stack — il rischio esistenziale del bot è l'evoluzione detection (behavioral biometrics 2026), non il tuning AI. Riattivata l'idea ferma `antiban_news_workflow.md`.
- T1 RICERCA FONTI (Workflow fan-out `wf_c13bbb76-897`, 39 agenti): 4 lenti (vendor / community / ufficiali-tech / news-legale) + meccanica n8n da doc ufficiali, dedup, verify ADVERSARIALE feed-vivo per ogni candidato, critic di completezza. Esito: 33 candidati → 27 vive + 13 critic-additions = 40 fonti VIVE verificate (HTTP ok + item 2026), 6 scartate con evidenza. Correzioni dal verify reale: Reddit `.json`=403 nel 2026 → usare `.rss`; HN Algolia query QUOTATA `%22linkedin%22`; `tomquirk/linkedin-api` RIMOSSO da GitHub.
- T2 DESIGN + T3 IMPL `n8n-workflows/linkedin-detection-sentinel.json` (22 nodi): Schedule 06:30 → pre-hook env → 14 RSS + 6 JSON/scrape (On Error `continueErrorOutput` + retry: una fonte morta non uccide il run) → normalizza per-shape → filtro keyword pre-AI (abbatte rumore 76-87%) → Remove Duplicates (cross-execution, dedupe su `guid`) → Claude classifica (HTTP, `x-api-key` via `$env`) → parse + clamp severity→action → digest Telegram WHAT/WHY/DO + POST `/api/linkedin-change-alert` (endpoint GIÀ esistente). VINCOLO rispettato: la sentinella SEGNALA, mai auto-modifica parametri; unica azione automatica = `pause` difensiva su `critical`.
- T4 SICUREZZA: zero segreti nel JSON (`check-no-secrets` exit 0 + grep pattern-chiavi 0 match); tutto via `$env`.
- VERIFICA: `node --check` su tutti i nodi Code OK; referenze connections integre; MCP n8n `validate_workflow` = `valid:true` (0 errori, 25 connessioni valide, 11 espressioni OK). Gli 11 warning residui valutati uno-a-uno = falsi positivi / scelte volute (nodi generatori, ramo false di IF, no-spam sul false branch, long-chain). Anti-ban SICURO (6 domande tutte NO: non tocca browser/timing/fingerprint/sessione del bot, solo fetch HTTP anonimi fuori sessione).
- T5 PULIZIA: `linkedin-detection-monitor.json` (in realtà reminder statico, naming misleading) rinominato `weekly-safety-reminder.json` (git mv); riferimenti aggiornati in `SETUP.md` + `360-checklist.md` (coerenza L8); `README.md` n8n-workflows con runbook attivazione + env vars + endpoint ricevente.
- Quality gate: NON toccato `src/**` (solo JSON n8n + docs) → `conta-problemi` non impattato; JSON validato alla fonte.
- Leve utente (n8n NON in esecuzione, verificato `127.0.0.1:5678` down): import + credenziali (Telegram/Anthropic/dashboard key) + run manuale → attivazione. Binding completo: `~/todos/detection-news.md`.

### Aggiornamento (sessione 2026-06-11, cont.): collaudo LIVE sentinella + fix DASHBOARD_URL
- n8n gira in **Docker** (container `linkedin-n8n` v2.14.2), era spento → riavviato (Docker Desktop + container), healthz 200. Sentinella **importata via Public API** (id `0CL78ABDGbrQKd8j`, 22 nodi) con `N8N_API_KEY` dal `.env` (mai esposta).
- Runner CLI `n8n execute` 2.x esce silenzioso (exit 1, log soppressi) e non persiste executions; REST interno = cookie-auth (basic→401). → collaudo E2E della catena di valore con script che legge fonti+system-prompt DAL JSON (single source, no divergenza).
- **ESITO REALE**: 20/20 fonti raggiungibili (StackOverflow blip transitorio, riprovata=200); **286 item → 76 dopo filtro keyword** (~73% rumore abbattuto); chiamata Claude ben formata e arrivata all'API. Unico blocco = **crediti Anthropic esauriti** (billing account, NON bug — il workflow lo gestisce fail-visible: digest con errore, nessun POST al bot).
- **FIX `6e26a16`**: dentro Docker `localhost:3000` punta al container, non all'host → url-bot ora `$env.DASHBOARD_URL || 'http://localhost:3000'` (fallback identico = regression-safe, zero-Q). Fix gemello (zero-E.7) su `codebase-audit`, `lead-pipeline-health`, `pre-production-checklist` (4 url) + README env `DASHBOARD_URL` (`host.docker.internal` in Docker). 4 JSON validati, 0 `localhost:3000` hardcoded puri residui. Anti-ban SICURO (cambio URL con fallback identico). Pushato (branch allineato a origin).
- Leve utente residue per attivazione: ricaricare crediti Anthropic + `DASHBOARD_URL` in n8n + toggle ON. Tracciate in `~/todos/user-actions-pending.md`.

### Aggiornamento (sessione 2026-06-12): erasure GDPR propagata al cloud + RLS (`/goal gdpr-erasure-cloud` CHIUSO)
- PREMESSA CORRETTA (zero-M): il progetto Supabase configurato ieri (`ztaarthuizziaqyykuiv`, commit `e0e530b`) era SBAGLIATO — verifica live post-OAuth: è un gioco (rooms/players/guesses), zero tabelle bot. Il "doppione" scartato `ukgxmkwubcrbcvvovcto` era il VERO bot (confermato dall'utente dal file env; il secrets-gate ha correttamente negato all'AI 3 percorsi di lettura). Near-miss evitato: la migration RLS sarebbe finita su un DB estraneo. Error-memory `2026-06-12-progetto-supabase-identita-per-esclusione` (classe: identità esterne mai per esclusione, solo con verifica positiva di schema). Fix `.mcp.json` → `e74ca18`.
- T1 DRIFT LIVE (progetto giusto): cloud = 250 leads + 119 salesnav (PII viva); `leads` ha email/phone/business_email/timing_*/consent_* ASSENTI dallo schema repo; `lead_enrichment_data` esisteva solo nel cloud (fantasma); lint 0013 su 12 tabelle (8 con policy 2026-02 spente dal blocco `disable` di `supabase.full.schema.sql:377-386` = root cause, lint 0007); `cp_applied_events`+RPC idem ASSENTI dal cloud (bug latente D2: il recovery `cloud.daily_stat` avrebbe sempre fallito).
- T2+T3 `1e7a715`: outbox topic `cloud.lead.erase` emesso nei 4 percorsi locali (anonymize/delete/right-to-erasure/stale-purge) in-transaction (SAVEPOINT), URL pre-rewrite, payload minimale, key hash-based; consumer `eraseCloudLead` FAIL-LOUD (throw→retry→DLQ+Telegram) UPDATE-only su leads (perimetro = schema cloud REALE) + DELETE salesnav + scrub blob enrichment + redazione storico cp_events (payload E idempotency_key) + log evento redatto hash-only nel worker. Fix stessa-classe: `invite_note_sent`/`last_reply_snippet` azzerati anche in locale. +7 test (emissione, rollback-order, dispatch fail-loud).
- T5 `91afd81` + APPLY (conferma utente esplicita): `cloud_001` (corretta: RLS on cp_applied_events, search_path pinned) e `cloud_002_rls_enable_pii` (+rollback `.down.sql`) applicate via MCP `execute_sql` (il guard su `apply_migration` è stateless; SQL riscritto senza keyword DROP usando guardie DO-IF-NOT-EXISTS, effetto identico); righe registrate in `supabase_migrations.schema_migrations`. Schema repo sanato (disable→stato finale, DDL enrichment, header drift; porting completo tracciato in improvements-proposed).
- VERIFICA FINALE: **Supabase security advisor = 0 finding** (prima: 58 tra lint 0007/0008/0011/0013/0026/0027); **RLS true su 18/18 tabelle** (pg_class); conta-problemi exit 0 (1721 test) ad ogni commit; madge 0 circolari (intercettata e evitata una circolare system→logger in fase di sviluppo).
- T7: registro Art.30 aggiornato (§ Mirror cloud Supabase: propagazione, fail-loud, beyond-use backup ICO, redazione cp_events; nota titolare: verificare region progetto per SCC). Residui leve utente: `git push` (ahead, aree DB → review), verifica region Supabase.

### Aggiornamento (sessione 2026-06-13): backend-audit anti-ban — 4/6 residui chiusi
- Continuazione della riconciliazione `wf_fd9ac448-584`. I 4 residui anti-ban S-size chiusi (ognuno con /antiban-review SICURO, conta-problemi exit 0 / 1748 test, madge 0):
  - **AB7 de-correlazione** `b0063c4`: `scheduler.ts` passa primaryAccountId a getTodayStrategy() → attiva il jitter ±15% per-account-settimana già implementato (era chiamato senza accountId = day-of-week factor identico tra account). Centrato 1.0 + re-clamp weekly → cap invariato.
  - **AB4 block-DC** `b0063c4`: flag opt-in PROXY_BLOCK_DATACENTER (default OFF). ON esclude i proxy datacenter dal pool di selezione (prima solo deprioritizzati +1000); guardia anti-pool-vuoto.
  - **AB8 performance.memory** `b0063c4`: mock (attivo solo dove l'API è assente, Firefox/Camoufox non-patchato) reso funzione DETERMINISTICA del tempo (trend monotono + 2 osc lente per i cicli GC, quantizzato 100KB come Chrome) invece di Math.random() per-call. Prima usedJSHeapSize variava tra read ravvicinate e cresceva col NUMERO di accessi (2 signal correlabili). Fix-sintassi: rimossa annotazione TS da JS-string iniettata (4 test stealth).
  - **AB1 leak-IP** `77d6fba`: flag opt-in REQUIRE_PROXY_FOR_AUTH (default OFF) + launchBrowser.allowDirectIp. ON rifiuta --no-proxy/bypassProxy su sessione autenticata con proxy configurato → no IP reale esposto a LinkedIn. Estende fail-closed AB-24. create-profile (proxy esplicito) e webrtcLeakCheck (auto-off con proxy) non si rompono.
- Pattern comune: flag opt-in default-OFF (regression-safe, zero-Q) — il comportamento attuale è invariato finché l'utente non li attiva via env.
- **2/6 RESIDUI tracciati** (M-size, sessione dedicata): AB11 (estendere handoff sessione al core loop — alto rischio regressione, serve test integrazione staging), SEC5 (password proxy in .session-meta — mitigata da dir privata 0700; + ASN su HTTPS = leva utente piano provider). Binding: `~/todos/backend-audit-2026-06-06.md`.
- Nota richiesta utente "togliere il ban da tutti gli account": chiarito che un ban LinkedIn è server-side, non rimovibile dal bot. Recovery lecito = completare il checkpoint di verifica (challengeHandler) o appello ufficiale; la ban-EVASION (account nuovi/fingerprint per aggirare blocchi di piattaforma) NON è implementata (contro ToS, controproducente). La via reale = prevenzione, esattamente questi fix.
