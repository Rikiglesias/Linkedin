# Goal: syncsearch — fix workflow sync-search (anti-ban)

> End-state: il workflow `sync-search` rispetta i requisiti anti-ban dell'utente (navigazione a mouse, block OS coerente, warmup condizionale, cap volume) + chiusi i silent-failure. Ogni fix è codice vivo anti-ban → `/antiban-review` SICURO + `npm run conta-problemi` verde + (alto rischio) review diff prima del push.
> Fonte audit: Workflow `wolk4iwtp` (2026-06-14), 6 dimensioni, file:riga reali.
> Metodo: un fix per volta, INLINE (no fan-out su codice vivo, zero-C.2b), antiban-review per ognuno, test, commit. NON big-bang.

## STATO FINALE — VERIFICATO ALLA FONTE 2026-06-14 (sessione App Rise cwd, repo LinkedIn `refactor/adk-split`)
- **Code-work COMPLETO**: T1,T2a,T2b,T4,T5,T7 → 6 commit (`e99cc90 f7096f8 ee12712 b6273dc 32ba75b 1e906c4`) tutti ON-BRANCH (ancestor di HEAD), working tree PULITO.
- **Quality-gate VERDE**: `npm run conta-problemi` exit 0 → typecheck backend+frontend OK, lint --max-warnings 0 OK, **1810 test passati** (185 file).
- **Leve utente-only RIMASTE** (zero-J ②/③, NON code-work):
  1. **Set env `SALESNAV_SYNC_MAX_SAVES_PER_DAY=1500`** nel deployment — meccanismo T4 fatto+testato, default 0=disabilitato; il valore deciso 1500 va nell'env (dominio utente). NON baco il default nel codice (anti-ban posture + design opt-in deliberato).
  2. **T3** — verifica click-vs-goto su SalesNav reale (login+GUI): solo l'utente può eseguire una run reale.
  3. **T6** — selettori FR/DE: solo se aggiunge account FR/DE o dopo un selector-failure reale (tracciato in improvements-proposed.md).
- **Verdetto**: goal `syncsearch` raggiunto (end-state code soddisfatto e verificato). I residui sono leve utente, non lavoro AI.

## Task (ordine per rischio anti-ban)

### [x] T1 — Block OS nel re-login mid-run del bulk-save (GAP severo, focus/login) ✅ FATTO (antiban SICURO, conta-problemi verde, 1797 test)
`bulkSaveNavigation.ts:32-78 waitForManualLogin` sospende solo l'overlay DOM (`setInputBlockSuspended` + `removeAllOverlays`) ma NON chiama `disableWindowClickThrough` → durante il login manuale richiesto da `bulkSaveOrchestrator.ts:200/222/348` il click-through OS resta attivo → l'utente non può cliccare il browser per loggarsi.
- Fix: passare il `BrowserContext` (`page.context()`) a `waitForManualLogin`; `disableWindowClickThrough(ctx)` prima di `removeAllOverlays`, `enableWindowClickThrough(ctx)` + `blockUserInput` nel finally — pattern identico a `salesNavigatorSync.ts:843-851/1050-1057` e `awaitManualLogin`.
- **VERIFY**: grep `waitForManualLogin` → chiama `disableWindowClickThrough` prima e `enableWindowClickThrough` dopo; `/antiban-review` SICURO; conta-problemi verde.

### [x] T2 — Warmup condizionale (gira sempre + H25 morto + no orario) ✅ FATTO (T2a H25 f7096f8 + T2b condizionale ee12712 + test 0daaf6d 5 casi, antiban SICURO)
`syncSearchService.ts:219-225` chiama `warmupSession(session.page)` sempre e SENZA `lastSessionEndedAt` (→ riduzione H25 `sessionWarmer.ts:73` mai attiva). Non guarda risk/età/orario.
- Fix (incrementale): (a) passare `lastSessionEndedAt` come fa `jobRunner.ts:347`/`salesNavigatorSync.ts:743` (riattiva H25); (b) allineare la chiave flag tra i 3 call-site (started_at vs ended_at) — zero-O; (c) estendere `warmupSession` con `{riskLevel, accountAgeDays}` da `preflight.riskAssessment` (già a `:161`) + `getAccountAgeDays()` → warmup ridotto/saltato su risk GO+sessione recente, più cauto su account nuovi; (d) gate `isWorkingHour()` (no warmup notturno, A7-1).
- **VERIFY**: test che warmup skippa/riduce su sessione recente e risk basso; non gira 02:00-06:00; `/antiban-review` SICURO.

### [~] T3 — Teletrasporti fase 2 (list-sync) → DEFER (premessa audit smentita dal codice)
**Scoperta 2026-06-14 (zero-M/zero-B alla fonte)**: la premessa dell'audit («i goto fase-2 sono teletrasporti da convertire») è PARZIALMENTE FALSA:
- `bulkSaveOrchestrator.ts:210-211` documenta che **i click DOM su link liste SalesNav SI BLOCCANO** (SPA navigation, `waitForLoadState` non completa mai) → il `goto` è un workaround DELIBERATO a un limite reale, già scelto DOPO aver provato il click. Convertirlo = reintrodurre un bug noto (zero-Q regressione, zero-A.5).
- Lo Step 3 (`bulkSaveOrchestrator.ts:241+`) **GIÀ usa il click DOM** per aprire la lista specifica dove funziona.
- I `goto` rimasti (`listScraper.ts:607/657`, `bulkSaveOrchestrator.ts:213/223`) puntano a URL **INTERNE di SalesNav** (`/sales/lists/people/`, listUrl), **NON a profili** → impatto anti-ban BASSO (la regola «mai goto su profili» NON è violata; SalesNav stesso è SPA che cambia URL senza reload).
- **Verdetto**: ALTO rischio regressione + BASSO beneficio anti-ban + richiede **test SalesNav reale** (login+GUI) per confermare se oggi il click funziona davvero (documentato che NON funziona). Eccezione zero-J ②/③: leva utente-only.
- **Azione utente (pending)**: durante una run reale, verificare se un click DOM sulla card lista naviga senza bloccarsi; SOLO se sì, valutare click-first+fallback per `listScraper.ts:657`. Finché non confermato → goto resta (corretto).

### [x] T4 — Cap volume giornaliero save SalesNav (manca del tutto) ✅ FATTO (32ba75b, modulo+config+check/increment+8 test, antiban SICURO)
Solo `sessionLimit` 30 pagine/sessione (`bulkSaveHelpers.ts:53`) + hard-limit 2500/lista. Nessun cap giornaliero → più sessioni/giorno superano il budget.
- Fix: `incrementDailyStat('salesnav_saves', ...)` dove cresce `report.totalLeadsSaved`; soglia config `SALESNAV_MAX_SAVES_PER_DAY`; oltre → PAUSE (come `challenges_count`). Coerente col cap enrichment già reso effettivo (`f0fc9f0`).
- **VERIFY**: oltre soglia → stop/PAUSE; test; `/antiban-review` SICURO. (richiede colonna daily_stats → migration: valutare se vale, vs runtime-flag.)

### [x] T5 — Silent failure DOM-drift nel path sync-search ✅ FATTO (b6273dc, errors[]+success+alert critical, antiban SICURO, 1797 test)
`scrapeDegraded` emette solo `console.warn` (`listScraper.ts:744`/`salesNavigatorSync.ts:1097`) e `syncSearchService.ts:250-256` NON legge `syncReport.errors` → un cambio DOM nel sync resta silenzioso (viola L5-LI.4 + regola anti-ban #9).
- Fix: in `syncSearchService` leggere `syncReport.errors`/flag `scrapeDegraded` → push in `errors[]` (come `syncListService.ts:294`) → attiva alert Telegram esistente; + `sendTelegramAlert` WHAT/WHY/DO "DOM-DRIFT SalesNav" diretto su `scrapeDegraded=true`.
- **VERIFY**: scrapeDegraded → errors[] + alert; test.

### [~] T6 — (basso) Resilienza selettori → PROPOSTA (zero-I.2/zero-P.4, non eseguito)
Razionale del DEFER: hardening opportunistico dell'ESISTENTE, non gap funzionale. (a) multi-locale FR/DE non serve al setup IT/EN attuale (zero-G: leva utente, non richiesto); (b) cascata su `LEAD_ANCHOR_SELECTOR` = robustezza ma rischio su selettori funzionanti (zero-I: non toccare il funzionante senza forte motivo) + richiede test SalesNav reale per validare i nuovi rami. → Tracciato in `~/todos/improvements-proposed.md`. Da attivare se l'utente aggiunge account FR/DE o dopo un selector-failure reale.
`LEAD_ANCHOR_SELECTOR` (`listScraper.ts:56`) selettore singolo senza cascata; no selector-versioning; multi-locale solo IT/EN (no FR/DE sui bottoni Visualizza/Seleziona/Salva/Next).
- Fix: cascata/fallback su LEAD_ANCHOR; estendere selettori azione a FR/DE (Suivant/Weiter, Tout sélectionner/Alle auswählen, Enregistrer/Speichern) in `selectors.ts`; selector-versioning minimo (data ultima-verifica + log di quale ramo della chain matcha in prod).
- **VERIFY**: grep selettori FR/DE presenti; conta-problemi verde.

### [x] T7 — Cap durata sessione bulk-save 32-45min jitterato ✅ FATTO (1e906c4, rule #3, riusa PAUSE+resume, antiban SICURO). NB: varianza oraria notturna NON inclusa (il warmup notturno è già gestito da T2b; il save scraping non invia azioni a LinkedIn — orario meno critico, vedi commento syncSearchService:272).
Loop pagine senza break a ~30-45min jitterati; sync-search non applica degradazione 02:00-06:00 (browser-antiban.md #3).
- Fix: registrare sessionStart, break PAUSED oltre ~30-45min jitter (riprendibile via resume esistente); soft-throttle/varianza oraria notturna riusando `getSessionVarianceFactor`/`getSessionWindow`.
- **VERIFY**: sessione si ferma oltre soglia; delay inter-pagina omogeneo save vs skip.

## Principio trasversale (vale per TUTTO il bot, non solo sync-search)
Adattività per-account/rischio: le azioni (warmup, volumi, cadenze) NON sempre uguali → condizionate a `riskAssessment`/età-account/recency. Riusare le primitive esistenti (riskEngine, backpressure, rampUp), non inventarne.

## NON fare
- NO big-bang: un fix per volta, verificato.
- NO rimuovere i goto fase-2 senza test SalesNav reale (rischio che il click si blocchi davvero, vedi commento codice).
- NO modifiche senza `/antiban-review` SICURO per ogni file browser/salesnav-touch.
