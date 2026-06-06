# Backend Deep Audit (2026-06-06)

> Audit 360 del backend `src/` (bot LinkedIn B2B, TypeScript 5.9 / Express 5 / Playwright+camoufox / Supabase+pg+sqlite). 80.410 LOC runtime, 84 file >300 righe. 21 unità di analisi (17 cluster-modulo + 4 lenti cross-cutting), ognuna con verifica avversariale alla fonte. I finding qui sotto sono **già verificati** (i refuted sono stati rimossi a monte) e **deduplicati** (problemi identici da unità diverse fusi, tenendo la severity più alta).

---

## Executive summary

**Stato di salute complessivo: BUONO sulla struttura macro, MEDIO-FRAGILE sui bordi caldi.** Il codebase mostra investimento anti-ban serio e maturo (mouse Bézier, navigation chains organiche, PRNG crittografico ovunque, clamp difensivi pervasivi), igiene macro solida (0 dipendenze circolari su 435 file, type-safety eccellente: 0 `as any`), e un perimetro di sicurezza HTTP ben temprato (auth di default, CSP, CSRF, timingSafeEqual, query parametrizzate — **nessuna SQLi sfruttabile** trovata). Il rischio reale è concentrato in tre fronti: (1) **divergenza SQLite(dev)↔Postgres(prod)** che nasconde bug funzionali e di compliance che esplodono solo in produzione; (2) **gap di enforcement anti-ban** dove difese dichiarate sono advisory, morte o aggirabili (caps espandibili, proxy DC non bloccato, sessioni illimitate, login su IP diretto); (3) **catena GDPR di cancellazione/registro disallineata dal codice reale**, con PII che sopravvive all'erasure.

### Numeri per severità (dopo dedup)

| Severità | Conteggio |
|---|---|
| **Critical** | 1 |
| **High** | 25 |
| **Medium** | 142 |
| **Low** | 66 |
| **TOTALE** | **234** |

> 252 finding verificati → 18 merge (duplicati cross-unità sullo stesso file/righe) → **234 finding unici**.

### Distribuzione per categoria (primaria; alcuni finding sono cross-cutting)

| Categoria | ~Conteggio | Nota |
|---|---|---|
| anti-ban | ~49 | priorità zero del progetto |
| correctness | ~35 | molti dual-dialect / race |
| resilience | ~31 | catch silenziosi, timeout mancanti |
| security | ~24 | quasi tutto condizionale, niente RCE/SQLi |
| data-flow-db | ~18 | transazioni, FK, dialect drift |
| compliance-gdpr | ~15 | erasure/registro disallineati |
| observability | ~14 | alert che droppano in silenzio |
| architecture | ~14 | god-module/mega-function |
| testing | ~12 | copertura distributiva, gap sui path di azione |
| performance | ~9 | N+1, fs sync, full scan |
| hygiene | ~8 | duplicazioni, dead code |
| type-safety | ~4 | cast non validati ai boundary |

### I 5 rischi più gravi

1. **[CRITICAL · GDPR] L'erasure non ripulisce `lead_enrichment_data`** — telefoni mobili e profili social sopravvivono indefinitamente a una richiesta Art.17 (anche su Postgres, perché i path di anonimizzazione/erasure non cancellano la riga `leads`, quindi il `ON DELETE CASCADE` è irrilevante). Root cause meccanica correlata: `PRAGMA foreign_keys` mai abilitato su SQLite → ogni cascade è no-op.
2. **[HIGH · anti-ban] Cluster "IP diretto" (branch `fix/antiban-ab24-no-direct-ip`)** — `createProfile` logga LinkedIn (cookie `li_at`) su IP diretto senza proxy; `--no-proxy`/`noProxy` esegue login/azioni autenticate su IP reale; il gate di validazione config è bypassato per `login`/`create-profile`. Mismatch geo login-IP vs automation-IP = uno dei segnali di detection più forti.
3. **[HIGH · prod-breaking] Bug Postgres-only latenti** — `getSessionHistory` (`date('now',...)` non tradotta) rompe lo scheduler a ogni ciclo; `getAccountAgeDays` ritorna `NaN` corrompendo i limiti settimanali/warmup; le "transazioni" di `leadsCore` su PG girano in autocommit (atomicità illusoria); la purge GDPR rollbacka per una FK senza cascade. Tutti verdi sui test SQLite locali.
4. **[HIGH · security] Authz fail-open** — comandi Telegram accettati da chiunque quando `TELEGRAM_CHAT_ID` è vuoto (default), inclusi `restart`→`process.exit` (DoS) e `importa` (naviga il browser autenticato); WebSocket `/ws` aperto senza auth in config basic-auth-only; Sentry riceve il payload PII/secret **non** sanitizzato.
5. **[HIGH · anti-ban] Difese che non difendono** — sessione SalesNav illimitata di default (maratona meccanica 1000+ pagine); cap settimanale superabile dai moltiplicatori mood/strategy applicati dopo il clamp; in modalità headless (il path di produzione) solo `risk==STOP` blocca, quindi un proxy blacklisted procede comunque ad agire.

---

## Metodologia

- **17 cluster-modulo**: browser/stealth · risk/scheduler/ramp-up · proxy/network · salesnav · workers · fingerprint/captcha · repositories(leads/write) · repositories(stats/system) · core-engine · db/sync/outbox · api/http · integrations(PII) · ai/cloud · cli · config/security-primitives/telemetry · workflows · scripts/tooling.
- **4 lenti cross-cutting**: architettura globale (grafo di accoppiamento, god-module, circular deps) · sicurezza globale · GDPR/PII/compliance · qualità test-suite.
- **Verifica avversariale**: ogni finding è stato confermato leggendo il codice reale (`file:riga`), eseguendo i traduttori SQL (`normalizeSqlForPg`), verificando lo stato git del branch, e — dove pertinente — declassato/promosso con evidenza (es. molti "high" sono stati riportati a "medium" dopo aver verificato mitigazioni di default come proxy-pool on, feature opt-in, gating a monte). I "refuted" sono stati rimossi.
- **Dedup**: 18 coppie cross-unità che descrivono lo stesso `file:righe` sono state fuse, mantenendo la severità massima (es. Sentry leak, password proxy in chiaro, PRAGMA FK, WebSocket auth, SSRF enrichment, god-function scheduleJobs/bulkSaveOrchestrator/inviteWorker).

---

## Findings critici e high

### CRITICAL

#### C1 — Erasure/anonimizzazione non ripuliscono `lead_enrichment_data`: PII (telefoni, social) sopravvive alla cancellazione
- **Severità**: critical · **Categoria**: compliance-gdpr
- **File**: `src/scripts/gdprRetentionCleanup.ts:121-189, 316-350` (root cause correlata: `src/db.ts:639-642`)
- **Descrizione**: `anonymizeLead` e `runRightToErasure` azzerano email/phone/about solo sulla tabella `leads`, ma NON toccano `lead_enrichment_data`, dove `persistEnrichment.ts` salva `phones_json` (mobile/office), `socials_json` (GitHub/Gravatar/profili) e `company_json`. `deleteLead` cancella esplicitamente message_history/lead_events/list_leads/lead_intents/leads ma **omette** `lead_enrichment_data`. La migration 045 dichiara `ON DELETE CASCADE`, ma sui path di anonimizzazione/erasure il record `leads` **non viene cancellato** (solo aggiornato), quindi il cascade è irrilevante a prescindere dal motore; inoltre SQLite ha `foreign_keys` OFF (vedi H13), quindi anche su hard-delete il cascade non scatta.
- **Impatto**: violazione diretta del diritto alla cancellazione (Art.17) e dei limiti di retention (Art.5(1)(e)). Dopo un Right to Erasure, il numero di telefono personale e i profili cross-platform del soggetto restano nel DB indefinitamente. Un audit del Garante troverebbe PII di soggetti formalmente "cancellati".
- **Raccomandazione**: in `anonymizeLead`/`deleteLead`/`runRightToErasure` aggiungere `DELETE FROM lead_enrichment_data WHERE lead_id = ?` (e azzerare `phones_json`/`socials_json`/`company_json` per l'anonimizzazione); estendere l'erasure a message_history/lead_events/lead_intents (testo messaggi = PII). Avvolgere tutto in una transazione per-lead. Test: dopo erasure, 0 righe PII residue in TUTTE le tabelle collegate.

### HIGH — Anti-ban (priorità zero)

#### H1 — Fingerprint Android/Linux con renderer WebGL Windows-Direct3D11 (contraddizione GPU↔UA)
- **Severità**: high · **Categoria**: anti-ban · **File**: `src/browser/launcher.ts:576-600`
- **Descrizione**: lo script WebGL sceglie il renderer da `desktopRenderers` (tutti `ANGLE ... Direct3D11` = Windows) o `appleRenderers`, via `isApple ? appleRenderers : desktopRenderers`. Un fingerprint Android (`Linux; Android 15; Pixel 9`) o Linux-desktop ottiene un renderer Windows-Direct3D11 — API esclusiva Windows, mai esposta da un device Android reale (Mali/Adreno) o Linux. Patch attiva di default (`BROWSER_ENGINE=chromium`, `CLOAKBROWSER_ENABLED=false`).
- **Impatto**: contraddizione hard UA↔GPU↔platform che FingerprintJS/LinkedIn correlano direttamente → marker di spoofing. Sotto config default colpisce il subset Linux-desktop; con `MOBILE_PROBABILITY>0` l'intero set mobile.
- **Raccomandazione**: aggiungere `mobileRenderers` realistici (Mali/Adreno/Apple GPU) e selezionare per device-class (isMobile + Apple/Android), non solo `isApple`. In subordine forzare camoufox quando `isMobile=true`.

#### H2 — `createProfile` logga LinkedIn sull'IP diretto (fix AB-24 assente sul ramo in checkout)
- **Severità**: high · **Categoria**: anti-ban · **File**: `src/scripts/createProfile.ts:23-35`
- **Descrizione**: `createPersistentProfile` lancia `launchPersistentContext` senza alcuna opzione proxy; il login manuale setta `li_at` (il momento più sensibile). Verifica git: HEAD=`ea3867e` su `refactor/adk-split`; il commit AB-24 `b05697e` NON è ancestor; nessuna stringa proxy/`getStickyProxy` nel working tree.
- **Impatto**: con proxy gestito attivo (Oxylabs mobile sticky), i cookie/li_at vengono mintati dall'IP reale mentre tutte le sessioni successive girano dal proxy → de-anonimizzazione al login + mismatch geo login-IP vs automation-IP. Mitigante: è uno script di bootstrap manuale one-time, non runtime ripetuto (per questo high, non critical).
- **Raccomandazione**: portare AB-24 su questo ramo: risolvere il proxy (`getStickyProxy`→`getProxyFailoverChainAsync`) e impostare `contextOptions.proxy` prima di `launchPersistentContext`; se managed proxy ON e nessun proxy risolto → throw fail-closed. Test che fallisce se si lancia senza proxy con managed proxy attivo. Indagare il drift codice↔commit-dichiarato-DONE.

#### H3 — Sessione di scraping SalesNav illimitata di default → maratona meccanica
- **Severità**: high · **Categoria**: anti-ban · **File**: `src/salesnav/bulkSaveHelpers.ts:47-59`
- **Descrizione**: `getSafeMaxSearches()` ritorna `Number.MAX_SAFE_INTEGER` e `getSafeSessionLimit()` ritorna `null` quando i limiti non sono passati. Il caller CLI primario (`salesNavCommands.ts:622-623`) passa di default `maxSearches=null`/`sessionLimit=null`. Il check di sessione (`orchestrator:1341`) è bypassato del tutto con `null`. Il pre-sync da solo può scansionare 200 pagine. Tra le pagine solo `humanDelay` 1-5s.
- **Impatto**: un singolo run scorre TUTTE le ricerche × tutte le pagine in un'unica sessione continua (potenzialmente 10+ ore), violando "sessioni corte e credibili, niente maratone meccaniche". I helper si chiamano `getSafe*` ma il default è il comportamento meno sicuro.
- **Raccomandazione**: default conservativo nel modulo (sessionLimit max 25-40 pagine e/o limite temporale), spezzare in più sessioni con pause lunghe credibili, controllo finestra oraria. `getSafeSessionLimit` non deve ritornare `null`.

#### H4 — In modalità non-interattiva (headless/schedulata) i warning CRITICAL sono ignorati: solo `risk==STOP` blocca
- **Severità**: high · **Categoria**: anti-ban · **File**: `src/workflows/preflight.ts:46-63`
- **Descrizione**: nel branch non-interattivo `runPreflight` ritorna `confirmed:true` a meno che `risk.level==='STOP'`. I warning critical (proxy IP BLACKLISTED, "Nessun proxy", noLoginAccounts) NON sono valutati. Un proxy blacklisted contribuisce ≤15 punti (mai soglia STOP=60); noLogin/no-proxy contribuiscono 0. Il branch interattivo invece blocca su `warnings.some(level==='critical')`.
- **Impatto**: il path di produzione reale (scheduler/PM2 = non-TTY) ignora la condizione anti-ban più pericolosa: agisce su SalesNav/inviti da un IP blacklisted o senza login senza blocco. La protezione esiste solo nel path interattivo, quasi mai usato in prod.
- **Raccomandazione**: applicare lo stesso gate critical anche headless (`warnings.some(critical) → confirmed:false`), oppure promuovere proxy-blacklisted e no-login a guardie hard in `evaluateWorkflowEntryGuards`. Test: proxy `isSafe=false` blocca anche headless.

#### H5 — Hot-reload del `.env` riapplica caps/timing live senza ri-validazione né alert
- **Severità**: high · **Categoria**: anti-ban · **File**: `src/config/hotReload.ts:59-97`
- **Descrizione**: `reloadConfig()` muta in-place hardInviteCap/hardMsgCap/weeklyInviteLimit/timing senza mai chiamare `validateConfigFull()`. Le regole che a startup bloccano (hardInviteCap>50 = error) non sono applicate a runtime. Gap già documentato come TODO aperto, non chiuso.
- **Impatto**: modificando il `.env` a runtime si spingono volumi/timing oltre le soglie LinkedIn-safe bypassando il gate di validazione dello startup, senza warning. Rischio anti-ban diretto.
- **Raccomandazione**: dopo il merge eseguire `validateConfigFull(config)`; su errori NON applicare i changedKeys fuori range (rollback) + `broadcastWarning`/`logWarn`. In alternativa validare via schema Zod prima dell'assegnazione.

### HIGH — Security

#### H6 — Autorizzazione comandi Telegram fail-open quando `TELEGRAM_CHAT_ID` non è impostato
- **Severità**: high · **Categoria**: security · **File**: `src/cloud/telegramListener.ts:130-134`
- **Descrizione**: il check è `if (config.telegramChatId && String(chat.id) !== config.telegramChatId) return`. `telegramChatId` default `''` (falsy) → il controllo è saltato: qualsiasi utente Telegram può accodare comandi. `startTelegramListener` richiede solo il bot token, non l'allowlist. Comandi: `restart`→`process.exit(0)` (DoS), `pausa`, `importa <url>` (naviga il browser autenticato), `funnel`/`status` (esfiltra KPI/lead).
- **Impatto**: authz fail-open nella config DI DEFAULT → kill remoto ripetuto, stop campagne, pilotaggio browser, senza autenticazione.
- **Raccomandazione**: fail-closed: se nessuna allowlist è configurata, rifiutare TUTTI i comandi + warning all'avvio. Supportare lista di chat-id autorizzati, validarla al boot, non avviare il listener se token presente ma allowlist vuota.

#### H7 — WebSocket `/ws` auth bypassata in config basic-auth-only
- **Severità**: high · **Categoria**: security · **File**: `src/api/server.ts:906-917`
- **Descrizione**: il WS è attaccato al raw HTTP server (`path:'/ws'`), bypassando il middleware Express; l'unica auth è `if (config.dashboardAuthEnabled && config.dashboardApiKey)`. Con basic-auth e nessuna API key (config supportata e validation-blessed), il blocco è saltato → connessione accettata senza verifica. Token anche via query string (leak in log).
- **Impatto**: ogni deployment basic-auth-only ha il canale real-time `/ws` (`lead.transition`, `run.log`, incident/quarantine) completamente aperto a client non autenticati senza misconfig aggiuntiva.
- **Raccomandazione**: autenticare l'upgrade WS per ogni tipo di credenziale (cookie di sessione o ticket short-lived), mai gattare solo su `dashboardApiKey`; token via header/primo messaggio, mai query string.

#### H8 — Sentry riceve il payload NON sanitizzato: leak PII + secret verso terza parte (US)
- **Severità**: high · **Categoria**: security/observability · **File**: `src/telemetry/sentry.ts:19-23` + `src/telemetry/logger.ts:28-46`
- **Descrizione**: `logError()` chiama `captureError(event, payload)` con il payload GREZZO **prima** della sanitizzazione (`sanitizeForLogs` gira solo dentro `log()`, dopo). `captureError` inoltra `payload` come `extra` a `Sentry.captureException`. Tutti i campi sensibili (nomi/email/linkedin_url, token, cookie, Error.message con URL scrapati) raggiungono Sentry in chiaro. La redazione protegge console/DB/liveEvents ma NON il canale Sentry. Sentry non è nemmeno dichiarato come processor US nel registro Art.30.
- **Impatto**: esfiltrazione di PII (GDPR) e potenziale leak di credenziali verso un processor US su OGNI `logError`. Mitigante: solo se `SENTRY_DSN` configurato.
- **Raccomandazione**: in `logError` calcolare `safe = sanitizeForLogs(enrichWithCorrelation(payload))` UNA volta e passarlo SIA a `captureError` SIA a `log()`; aggiungere `sendDefaultPii:false` + `beforeSend`. Test: email/token nel payload non raggiungono Sentry.

### HIGH — Integrità dati / Postgres-prod (bug latenti mascherati da SQLite)

#### H9 — `getSessionHistory` usa `date('now','-'||?||' days')` non tradotta per Postgres → scheduler rotto
- **Severità**: high · **Categoria**: data-flow-db · **File**: `src/risk/sessionMemory.ts:81-90`
- **Descrizione**: la query usa `date(...)` concatenata; `normalizeSqlForPg` traduce SOLO la forma `DATETIME(...)` (regex `\bDATETIME\(`). Eseguito il traduttore: l'output conserva `date('now', '-' || $2 || ' days')` intatto. Postgres non ha `date(unknown, text)` → throw. È l'UNICA occorrenza di questo pattern. Chiamata bare (no try/catch) da `scheduler.scheduleJobs:516`.
- **Impatto**: ad ogni ciclo dello scheduler la query lancia e aborta l'intero `scheduleJobs` (enqueue invite/message/check) → l'outreach si ferma su prod. I test passano su SQLite.
- **Raccomandazione**: riscrivere usando `DATETIME(...)` già supportata, o passare il cutoff calcolato in JS come parametro ISO. Test che asserisca nessun `date('now'` residuo in `normalizeSqlForPg`.

#### H10 — `getAccountAgeDays` restituisce `NaN` su PostgreSQL (`Date + 'Z'`)
- **Severità**: high · **Categoria**: correctness · **File**: `src/core/repositories/stats.ts:1045-1059`
- **Descrizione**: `MIN(created_at)` su PG ritorna un oggetto `Date` (pg-types default, nessun `setTypeParser` nel repo). La riga 1055 fa `new Date(row.firstDate + 'Z')` → `toString()+'Z'` → Invalid Date → `getTime()=NaN`. Su SQLite `created_at` è TEXT, quindi funziona e maschera il bug.
- **Impatto**: `ageDays=NaN` propaga in `calculateDynamicWeeklyInviteLimit` (scheduler/ramp-up): `weeklyInviteLimitEffective=NaN`, `weeklyRemaining=NaN`, confronti sempre falsi → blocca o salta il cap. Funzione anti-ban-critica (budget/velocità) rotta in prod.
- **Raccomandazione**: non concatenare `'Z'` a un possibile `Date`. Se è `Date` usarlo; se stringa parsare e validare `Number.isFinite(getTime())` con fallback 0. Test su Postgres reale.

#### H11 — Transazioni non atomiche su PostgreSQL: `db` catturato prima di `withTransaction` e riusato dentro il callback
- **Severità**: high · **Categoria**: data-flow-db · **File**: `src/core/repositories/leadsCore.ts:136-221, 362-482`
- **Descrizione**: `applyControlPlaneCampaignConfigs` e `upsertSalesNavigatorLead` catturano `db = getDatabase()` PRIMA di `withTransaction`, poi usano `db.get`/`db.run` nel callback. Il routing al client transazionale avviene SOLO via `getDatabase()` fresco (legge l'AsyncLocalStorage); il `db` catturato punta al PostgresManager (pool, autocommit). BEGIN/COMMIT girano su un PoolClient dedicato mentre gli statement girano su connessioni pool diverse fuori transazione. Prova: a riga 370 `ensureLeadList` usa `getDatabase()` fresco (vede il TX), riga 371 `db.get` no → read-your-own-write fallito. Su SQLite (connessione unica) funziona "per caso".
- **Impatto**: su prod (Postgres) la transazione è illusoria: applicazione config non atomica, upsert SalesNav perde isolamento (UNIQUE violation su upsert concorrenti), ROLLBACK non annulla nulla. Invisibile ai test SQLite.
- **Raccomandazione**: dentro `withTransaction` chiamare sempre `getDatabase()` per ogni statement, oppure propagare il `tx` come parametro via `shared.ts`. Test di integrazione su Postgres che verifichi il rollback parziale.

#### H12 — `acquireRuntimeLock`: race nel takeover di lock stale → doppia acquisizione del workflow runner
- **Severità**: high · **Categoria**: resilience/anti-ban · **File**: `src/core/repositories/system.ts:409-441`
- **Descrizione**: nel ramo stale-takeover l'UPDATE imposta `owner_id` con `WHERE lock_key = ?` SENZA condizione su owner/expires_at. Sotto PG READ COMMITTED, due runner concorrenti vedono lo stesso lock stale, T2 si blocca sul row-lock di T1 e al rilascio sovrascrive incondizionatamente owner=T2. Entrambi ritornano `acquired:true` (nessun check su `result.changes`). Il ramo no-existing è protetto dal PK, il takeover stale no.
- **Impatto**: usato in `loopCommand.ts:114` per garantire un singolo workflow runner. Doppia acquisizione = due runner che operano lo stesso account in parallelo → volume doppio, azioni concorrenti, pattern non umano → rischio ban. Finestra stretta, conseguenza grave.
- **Raccomandazione**: UPDATE condizionale idempotente `WHERE lock_key=? AND expires_at<=CURRENT_TIMESTAMP AND owner_id=?` (owner osservato), acquisito solo se `changes>0`; altrimenti `acquired:false`. In alternativa `SELECT ... FOR UPDATE` a inizio transazione.

#### H13 — `PRAGMA foreign_keys` mai abilitato su SQLite → tutti gli `ON DELETE CASCADE` sono no-op
- **Severità**: high · **Categoria**: data-flow-db/gdpr · **File**: `src/db.ts:639-642`
- **Descrizione**: l'init SQLite imposta WAL/busy_timeout/synchronous/auto_vacuum ma NON `PRAGMA foreign_keys = ON` (default OFF, per-connessione). Grep `foreign_keys` su `src/` = 0. Ogni `REFERENCES ... ON DELETE CASCADE` (045/058/001…) è silenziosamente inerte. SQLite è supportato anche in prod (`ALLOW_SQLITE_IN_PRODUCTION`).
- **Impatto**: integrità referenziale assente su SQLite: righe figlie PII orfane su delete lead. È la root cause meccanica di C1 e del finding outbox (H14-correlato). Divergenza dev/prod.
- **Raccomandazione**: aggiungere `await sqliteDb.exec('PRAGMA foreign_keys = ON;')` nell'init; verificare i cascade con test. Finché non abilitato, ogni delete-lead deve elencare ESPLICITAMENTE tutte le tabelle figlie.

#### H14 — FK `outbox_event_deliveries` senza `ON DELETE CASCADE` rompe la purge GDPR su Postgres
- **Severità**: high · **Categoria**: data-flow-db · **File**: `src/db/migrations/058_automation_commands_and_outbox_deliveries.sql:24-40`
- **Descrizione**: la FK `event_id → outbox_events(id)` non ha CASCADE. `cleanupPrivacyData` (`system.ts:941-946`) esegue `DELETE FROM outbox_events WHERE delivered_at IS NOT NULL` senza prima cancellare le righe figlie. Su PG (FK enforced) il DELETE viola la FK e fa ROLLBACK dell'INTERA transazione di cleanup. Invocata nel loop di prod (`loopCommand.ts:566`) con `retentionDays`.
- **Impatto**: retention/erasure GDPR silenziosamente non funzionante su prod: lead scaduti/run_logs/message_history mai cancellati. Su SQLite, delivery orfane illimitate.
- **Raccomandazione**: aggiungere `ON DELETE CASCADE` (migration che ricrea il vincolo) O cancellare `outbox_event_deliveries` prima/nella stessa transazione. Test purge con sink attivo su Postgres.

#### H15 — Il proxy d'emergenza dal provider viene scartato subito dopo il fetch (signature cache invertita)
- **Severità**: high · **Categoria**: correctness · **File**: `src/proxyManager.ts:350-359, 386-395`
- **Descrizione**: `fetchFallbackProxyFromProvider` fa `cachedPool.proxies.unshift(finalProxy)` poi `cachedPool.signature = 'api-injected:<ts>'`. Ma `loadProxyPool` ritorna la cache solo se `signature === signatureForPool(file)`; una signature `api-injected:*` non eguaglia MAI quella del file → il successivo `loadProxyPool()` (riga 390) FORZA il reload dal file e ricostruisce il pool SENZA l'iniettato. Comportamento opposto al commento. Stesso difetto nella variante integration.
- **Impatto**: la feature di fallback d'emergenza è morta: sotto esaurimento pool il provider è chiamato e loggato come success, ma l'IP fresco non entra nella chain → la sessione gira su cooling/Tor o fallisce.
- **Raccomandazione**: flag esplicito `cachedPool.pinnedInjected = true` rispettato da `loadProxyPool`, oppure usare direttamente il proxy iniettato in testa alla chain senza ri-chiamare `loadProxyPool`. Test che verifichi l'IP iniettato nella chain risultante.

#### H16 — `setOverrideAccountId` imposta stato globale mai resettato → leak cross-run + hazard concorrenza
- **Severità**: high · **Categoria**: correctness · **File**: `src/core/orchestrator.ts:233-235`
- **Descrizione**: `runWorkflow` chiama `setOverrideAccountId(options.accountId)` e non lo riazzera MAI (grep `setOverrideAccountId(null)` = 0). `_cliOverrideAccountId` è module-globale: un run per-account (sendInvites/sendMessages dispatchato nel loop) lascia l'override attivo; un run `workflow-all` successivo eredita il vincolo. Se l'id non combacia, `getConfiguredRuntimeProfiles → []` e "niente gira" in silenzio.
- **Impatto**: in multi-account, run che dovrebbero coprire tutti gli account ne processano uno solo (o nessuno) senza errore: invii/check saltati per account interi, o operazione sull'account sbagliato (hazard anti-ban).
- **Raccomandazione**: `try/finally` in `runWorkflow` che ripristina il valore precedente (o `null`) su OGNI path. Meglio: passare `accountId` esplicito lungo la catena invece del singleton mutabile.

### HIGH — GDPR / compliance

#### H17 — L'enrichment non verifica `gdpr_opt_out`/consenso prima di raccogliere e trasferire PII
- **Severità**: high · **Categoria**: compliance-gdpr · **File**: `src/workers/enrichmentWorker.ts:19-43`
- **Descrizione**: `processEnrichmentJob` seleziona il lead senza `gdpr_opt_out`/`consent_basis` e chiama `enrichLeadAuto` senza gate. `enrichLead`/`enrichLeadAuto` non controllano mai `gdpr_opt_out` (grep su `src/integrations` = 0). Il registro Art.30 dichiara che l'opposizione (Art.21) si esercita con `gdpr_opt_out=1` ed "esclude da tutte le campagne future", ma l'enrichment è RACCOLTA dati e gira comunque.
- **Impatto**: il flag di opposizione è aggirabile: si continua ad arricchire (scraping + chiamate a terzi US) dati di chi ha esercitato l'Art.21.
- **Raccomandazione**: gate centralizzato in `enrichLead`/`enrichLeadAuto` che rifiuta l'enrichment per lead con `gdpr_opt_out=1` o senza base giuridica valida (copre anche l'enrichment al volo dell'inviteWorker); includere `gdpr_opt_out` nel SELECT con short-circuit.

#### H18 — Trasferimenti PII a terzi US non dichiarati nel registro Art.30 (che afferma "nessun destinatario, solo locale")
- **Severità**: high · **Categoria**: compliance-gdpr · **File**: `src/integrations/leadEnricher.ts:164-333, 437-525`
- **Descrizione**: `leadEnricher` invia nome+dominio+linkedin_url ad Apollo.io, Hunter.io, Clearbit (processor US); `personDataFinder` invia il nome a GitHub/StackExchange e l'MD5 email a Gravatar; `webSearchEnricher` a DuckDuckGo. Il registro Art.30 Trattamento 1 dichiara "Nessun destinatario terzo. Dati trattati solo localmente" e come unici trasferimenti extra-UE solo Anthropic+Oxylabs. Il registro è materialmente falso rispetto al codice.
- **Impatto**: violazione Art.30 (registro non veritiero) e Art.44+ (trasferimenti extra-UE senza strumento documentato, senza DPA). Mitigante: ogni provider è gated da API key.
- **Raccomandazione**: allineare il registro ai destinatari reali; documentare base giuridica + meccanismo di trasferimento (SCC/adequacy) o disabilitare i provider non coperti; rendere ogni provider opt-in e bloccato di default se non dichiarato; valutare la liceità dell'origine per i data broker (Apollo/Clearbit).

#### H19 — `applyRedaction` è un no-op: con `redactScreenshots=true` gli screenshot PII vengono comunque inviati interi a OpenAI
- **Severità**: high · **Categoria**: compliance-gdpr · **File**: `src/captcha/openaiVisionProvider.ts:419-431`
- **Descrizione**: `applyRedaction` logga `redaction_active` e RESTITUISCE `base64Image` invariato (il commento ammette "solo loggato"). I due call site (`imageData = redactScreenshots ? applyRedaction(...) : base64Image`) producono byte-identici. La config pubblicizza "blur su aree sensibili".
- **Impatto**: screenshot di profili LinkedIn (PII di terzi) trasmessi interi a OpenAI (US) anche quando l'operatore ha attivato la redaction credendo di proteggerli — falso senso di sicurezza con un log che asserisce `redaction_active`.
- **Raccomandazione**: implementare la redaction reale (blur lato browser) OPPURE, finché assente, fail-fast quando `redactScreenshots=true && provider=openai` (throw esplicito). Documentare lo stato.

### HIGH — Copertura test (superfici ban/dati scoperte)

#### H20 — I worker d'azione (invite/message/acceptance) non hanno alcun test diretto
- **Severità**: high · **Categoria**: testing · **File**: `src/workers/inviteWorker.ts` (760 LOC), `messageWorker.ts` (569), `acceptanceWorker.ts` (175)
- **Descrizione**: nessun test in `src/tests/` li importa (grep → NONE). Gli unici riferimenti ai send-service sono in `workflowRefactor.vitest.ts` dove sono `vi.mock` completi. L'`e2eDry.ts` asserisce solo `assert.ok(true)`. La logica di esecuzione azione (verify pre/post, idempotency key, budget decrement, transizione stato) non è mai esercitata.
- **Impatto**: le superfici a più alto rischio anti-ban/correttezza. Una regressione che rimuove un verify, sbaglia l'idempotency (doppio invito), o non decrementa il budget porta a flood/ban e nessun test la intercetta. L1.3/L1.4 restano verdi.
- **Raccomandazione**: test unit con Page Playwright fittizia + repo in-memory che asseriscano idempotency, decremento budget, transizione stato su successo/fallimento, propagazione errore su fallimento a metà.

#### H21 — `browser/humanBehavior.ts` (1423 LOC anti-ban) è solo mockato, mai testato
- **Severità**: high · **Categoria**: testing · **File**: `src/browser/humanBehavior.ts:558-1356`
- **Descrizione**: il modulo di orchestrazione anti-ban (humanDelay, humanType, simulateHumanReading, interJobDelay, ensureViewportDwell, computeProfileDwellTime, performDecoyBurst) appare solo in `vi.mock`. `humanBehavior.vitest.ts` importa in realtà `ml/mouseGenerator`, `ml/timingModel`, `ai/typoGenerator` (le primitive), NON il modulo browser. Nome fuorviante.
- **Impatto**: le primitive sono testate, l'orchestrazione che le compone nelle azioni reali no. Una regressione che introduce un delay fisso (viola varianza L3-LI.3) o salta il viewport dwell non viene rilevata.
- **Raccomandazione**: estrarre la logica di timing/varianza in funzioni pure testabili e testare varianza (set di valori distinti, nessun valore fisso) con Page fittizia. Rinominare il file.

#### H22 — Test proxy "advanced" verifica solo `.not.toThrow()`: il cooldown differenziato non è mai asserito
- **Severità**: high · **Categoria**: testing · **File**: `src/tests/proxyManagerAdvanced.vitest.ts:4-31`
- **Descrizione**: tutti i test asseriscono solo `expect(() => markProxyFailed(...)).not.toThrow()` (il commento lo ammette). I test "ban → cooldown lungo"/"timeout → cooldown corto" non verificano alcun cooldown. Stesso pattern in `proxyAndNoise.vitest.ts`. Zero test su `getStickyProxy`/`parseProxyEntry`/`buildProxyUrl`/`checkProxyHealth`.
- **Impatto**: una regressione che azzera i cooldown, scambia ban↔timeout, o degrada verso IP diretto (`parseProxyEntry`, proprio il tema del branch) passa tutti i test.
- **Raccomandazione**: esporre lo stato cooldown (`getProxyCooldownMs`) e asserire `ban > timeout > 0`; test su `parseProxyEntry` (input malformato → null), `buildProxyUrl`, `getStickyProxy` (stessa sessione → stesso proxy).

#### H23 — `auth.ts` (login/2FA/challenge detection) senza alcun test
- **Severità**: high · **Categoria**: testing · **File**: `src/browser/auth.ts:25-224`
- **Descrizione**: `isLoggedIn`/`detectChallenge`/`probeLinkedInStatus` e la rilevazione 2FA non sono importati da alcun test (grep → NONE). Solo la generazione del secret TOTP è coperta, non la detection del challenge.
- **Impatto**: se `detectChallenge`/`isLoggedIn` smettono di riconoscere una pagina di verifica (cambio URL/selettore), il bot continua ad agire su un account già flaggato → escalation verso ban.
- **Raccomandazione**: test con Page fittizia che simuli URL `/checkpoint/challenge`, assenza `li_at` (SESSION_EXPIRED), navbar presente, asserendo i ritorni per ogni branch.

#### H24 — Transazioni DB e repository centrale (`leadsCore`) senza test di rollback/atomicità
- **Severità**: high · **Categoria**: testing · **File**: `src/core/repositories/leadsCore.ts` (1417 LOC, hub del grafo)
- **Descrizione**: grep `withTransaction`/`leadsCore`/`ROLLBACK` su `src/tests` = NONE. `dbCoherence.vitest.ts` copre solo `normalizeSqlForPg` (stringa). `leadsCore` importa e usa `withTransaction` (137/153/369) ma i path transazionali non sono esercitati.
- **Impatto**: i sub-check L3.4 (rollback path) non coperti sul modulo dati centrale. Un fallimento a metà sequenza (invito segnato ma budget non decrementato) lascia stato incoerente senza test.
- **Raccomandazione**: test integrazione su SQLite in-memory che provochino errore a metà transazione e asseriscano rollback completo + idempotenza di `promoteNewLeadsToReadyInvite` chiamata 2 volte.

---

## Findings medium/low raggruppati per categoria

> Formato compatto: **Sev** (M/L) · `file:righe` · titolo · → raccomandazione. I duplicati cross-unità sono già fusi.

### Anti-ban

| Sev | File:righe | Titolo | Raccomandazione |
|---|---|---|---|
| M | `browser/stealthScripts.ts:255-283` | `chrome.loadTimes()`/`csi()` ritornano valori freschi (Date.now/Math.random) a ogni chiamata | Congelare i valori a un `_navStart` calcolato una volta all'init |
| M | `browser/stealthScripts.ts:491-513` | `performance.memory` fluttua ±20% tra letture consecutive | Stateful quasi-monotòno per finestra temporale |
| M | `browser/humanBehavior.ts:813-852` | `simulateTabSwitch` emette visibilitychange senza cambiare `visibilityState` | Coerenza evento↔stato o rimuovere la simulazione (via `/antiban-review`) |
| M | `browser/humanBehavior.ts:1217-1258` | Decoy/wind-down con `page.goto` diretto + keyword non URL-encoded | Click via global-nav/search box; uniformare `encodeURIComponent` |
| M | `browser/sessionCookieMonitor.ts:68-78` | `recordSuccessfulAuth` azzera `behavioralProfile` → drift cross-sessione mai accumulato | Spread del meta esistente preservando `behavioralProfile` |
| M | `browser/humanBehavior.ts:889-894` | Inter-keystroke uniforme dove la dinamica umana è log-normale | Far passare i delay per il timing model log-normale (gamma) |
| M | `risk/scheduler.ts:489-560` | Weekly cap superabile dai moltiplicatori strategy/mood applicati DOPO il clamp | Re-clamp a `weeklyRemaining`/daily come ULTIMO step |
| M | `risk/incidentManager.ts:223-266` | Challenge mid-azione → solo pausa auto-scadente, auto-resume il giorno dopo | Gate persistente (`challenge_cooldown_until` multi-giorno o quarantena) + review |
| M | `risk/scheduler.ts:523-560` | De-correlazione multi-account morta: `getTodayStrategy()` senza accountId, mood seedato solo su data | Passare accountId; seed `mood:${accountId}:${date}` nel loop per-account |
| M | `risk/httpThrottler.ts:34-56` | Baseline 429 inquinata da asset+API; JSDoc dichiara filtro voyager inesistente | Filtrare per endpoint voyager; baseline a media mobile robusta |
| M | `risk/riskEngine.ts:35-48` | STOP pending ratio default 0.80 sopra la red-flag ~0.65 dichiarata nel codice | Abbassare `pendingRatioStop`~0.65-0.70; pending per-account |
| M | `proxy/proxyManager.ts:398-407` | Fallback silenzioso a Tor (default-ON) instrada LinkedIn su exit-IP blacklistati | Tor opt-in (default vuoto); halt+alert a pool esaurito; reputation come gate |
| M | `proxy/proxyQualityChecker.ts:272-373` | Rilevamento datacenter mai applicato alla selezione (advisory) | Scartare/cooldown proxy ASN datacenter nella selezione; allineare `proxy.type` all'ASN |
| M | `proxy/exitIpChecker.ts:98-162` | Nessuna coerenza geo tra paese exit-IP e timezone/locale | Geolocalizzare exit-IP e validare vs tz/locale; scartare o adattare il fingerprint |
| M | `salesnav/bulkSavePagination.ts:270-298` | Stato anti-detection in module-global mai resettato per run → varianza degradata + leak cross-account | Stato per-run/per-Page (WeakMap<Page>), reinizializzare soglie con jitter |
| M | `salesnav/visionNavigator.ts:132-362` | Fallback Vision a coordinate FISSE hardcoded (click ciechi) | Retry DOM-based prima; se Vision down, pausare invece di cliccare alla cieca |
| M | `workers/inboxWorker.ts:251-295` | Auto-reply inbox NON incrementano `messages_sent` → budget bypassato | `checkAndIncrementDailyLimit('messages_sent')` dopo invio auto-reply |
| M | `workers/followUpWorker.ts:448-514` | Burst follow-up: spacing inter-lead 4-8s su batch fino a 10 | Spacing minimo 5-15min per messaggio o limitare la run a 1-2 |
| M | `workers/interactionWorker.ts:148-185` | LIKE_POST/FOLLOW senza daily cap (solo VIEW limitato) | Aggiungere `likeDailyCap`/`followDailyCap` con varianza + cap settimanale |
| M | `workers/randomActivityWorker.ts:63-88` | Navigazione teletrasportata nel warm-up (`page.goto` profili + deep-link settings) | Click sull'anchor reale/nav bar; niente deep-link a sottopagine settings |
| M | `workers/hygieneWorker.ts:73-176` | Withdraw senza verify post-azione + selettore `:has(svg)` ambiguo | Verify post-withdraw; vincolare il selettore con aria-label esplicito |
| M | `workers/postCreatorWorker.ts:108-235` | Post marcato PUBLISHED senza proof-of-publish + click raw non human-like | Verify post-pubblicazione; `clickLocatorHumanLike` + dwell |
| M | `workers/inviteWorker.ts:681-711` | Falso negativo proof-of-send: `invites_sent` decrementato anche se l'invito è partito | Proof più robusto (retry/reload Pending) prima di decrementare |
| L | `workers/inviteWorker.ts:510-518` | Scroll a delta di pixel fissi (900/500/-700) | Randomizzare l'ampiezza (`700 + rand*400`) |
| M | `fingerprint/pool.ts:28-275` | Locale non legato a geo/proxy + nessun timezone → fingerprint incoerente | Filtrare il pool per locale coerente col paese proxy; valorizzare `timezone` per voce |
| M | `fingerprint/pool.ts:282-301` | Rotazione settimanale cambia OS/famiglia e DOWNGRADE versione (evoluzione implausibile) | Fissare OS+famiglia per account (hash su accountId); ruotare solo a versioni ≥ |
| M | `captcha/openaiVisionProvider.ts:106-176` | `findCoordinates` quantizza i click ai 48 centri di una griglia 8x6 | Offset gaussiano nell'elemento o bounding box reale via DOM/locator |
| M | `core/jobRunner.ts:480-646` | Cap sessione/budget contano solo `processedCount>0` → sessione più lunga su skip | Contatore `jobs attempted` con cap di sicurezza |
| M | `core/companyEnrichment.ts:157-184` | Navigazione teletrasportata: `page.goto` ai risultati people-search (deep-link) | Percorso umano (feed→search box→typing); budget per-sessione; via `/antiban-review` |
| M | `core/orchestrator.ts:335-364` | Ban probability ignora i `predictiveAlerts` (passa `[]`) + proxy grezzo dell'acceptance | Sollevare predictiveAlerts a scope funzione; usare `acceptanceRatePct` reale |
| L | `core/jobRunner.ts:404-518` | `windDownActive` mai resettato: sessione fresca resta "umano stanco" dopo rotazione | Reset `windDownActive=false` quando si ricalcola `sessionStartedAtMs` |
| M | `accountManager.ts:132-171` | Binding lead→account da ordine array + fallback silenzioso ad `accounts[0]` | Persistere il binding (colonna account_id); job con account assente → bloccato+alert |
| M | `ai/inviteNotePersonalizer.ts:246-296` | Nessun guardrail deterministico di output sul testo AI inviato (URL/emoji/lingua) | Validatore post-generazione condiviso (rifiuta/sanitizza URL/email/emoji/lingua) |
| M | `cloud/controlPlaneSync.ts:44-50` | Nessun clamp superiore sui cap giornalieri pilotati dal control plane | Clamp a `hardInviteCap`/`hardMsgCap` all'ingestione |
| M | `cli/loopCommand.ts:679-720` | `inbox_check` apre una sessione browser separata per account a ogni ciclo (multi-sessione) | Eseguire `inbox_check` DENTRO la sessione del jobRunner (come il warmup) |
| M | `cli/salesNavCommands.ts:497-604` | `salesnav resolve`: pacing fisso 1-2s tra navigazioni profili autenticati | Allineare a enrich-profiles (base ≥6s, varianza, dwell, decoy); cap su `--limit` |
| M | `cli/utilCommands.ts:54-112` | `--no-proxy` esegue login/azioni LinkedIn autenticate su IP diretto | Vietare `--no-proxy` sui comandi autenticati; consentirlo solo per diagnostica |
| M | `cli/loopCommand.ts:1091-1103` | Autopilot riduce i cap via type-cast; un hot-reload può ripristinare il budget pieno | Passare il fattore budget come override esplicito o runtime flag rispettato dal reload |
| M | `workflows/syncSearchService.ts:165-171` | `noProxy` bypassa il proxy su SalesNav senza warning né contributo al risk score | Warning `critical` + fattore di rischio dedicato quando `noProxy=true` su workflow LinkedIn |
| M | `workflows/preflight.ts:169-194` | AI advisor + riduzione budget in CAUTION solo cosmetici (`suggestedParams` mai applicato, advisor non gira headless) | Applicare clamp `sessionLimit`/budget; riduzione deterministica anche headless |
| M | `config/messages.ts:22-27,75-79` | Template follow-up deterministici (`id % len`) + singolo template per de/nl | Aumentare template de/nl (≥3) + spinning lessicale/selezione casuale |
| L | `risk/rampUp.ts:6-60` | Ladder ramp-up a valori "tondi" che non aggiorna `rampUpState` | Aggiornare `upsertRampUpState` + varianza sui cap; deprecare a favore del worker |
| L | `risk/scheduler.ts:332-353` | `noBurstPlanner` con spaziatura uniforme + coppia LIKE→MESSAGE sempre presente | Distribuzione gamma/log-normale; rendere probabilistico il LIKE pre-messaggio |
| L | `browser/launcher.ts:562-571` | Noise canvas itera su tutti i pixel di ogni `getImageData` (anche letture legittime) | Limitare il noise ai casi plausibili di fingerprinting (soglia dimensione/campionamento) |

### Security

| Sev | File:righe | Titolo | Raccomandazione |
|---|---|---|---|
| M | `api/routes/metrics.ts:18-146` (+`server.ts:688`) | `/metrics` non autenticato + non rate-limited, espone segnali detection + echo `err.message` | Auth/rate-limit o bind 127.0.0.1; body errore generico |
| M | `api/helpers/audit.ts:3-14` | Security-audit writes inghiottiti (`.catch(()=>null)`) | `logError` dell'evento droppato + alert oltre soglia + buffer fallback |
| M | `integrations/personDataFinder.ts:146-178` (+sitemap 199-226) | SSRF: fetch di URL/dominio dai lead senza blocklist IP privati; sitemap bypassa il filtro same-origin | Risolvere DNS e rifiutare IP privati/loopback/link-local/metadata; `redirect:'manual'`+re-validate; stesso check hostname al sitemap |
| M | `integrations/emailGuesser.ts:113-227` | Enumeration SMTP RCPT-TO dall'IP del server (fuori proxy pool) → blacklist | Probe via proxy/IP dedicati; EHLO con FQDN risolvibile; rate per MX; valutare provider gestito |
| M | `proxy/proxyQualityChecker.ts:157-231` | Lookup ASN su HTTP in chiaro (ip-api.com) → MITM misclassifica DC→residential | Endpoint HTTPS; validare formato; risposte inattese = unknown conservativo |
| M | `proxy/proxyManager.ts:331-348` | JSON del provider usato senza validazione per costruire l'exit-proxy | Imporre scheme/allowlist host; HTTPS; verificare reputation/ASN prima dell'inserimento |
| M | `proxy/proxyManager.ts:646-665` | Password proxy persistita in chiaro su `.session-meta.json` | Salvare solo riferimento e re-iniettare da config; o cifrare; permessi ACL reali |
| M | `captcha/openaiVisionProvider.ts:204-226` | `generatePlaywrightCode` ritorna codice LLM (RCE-class latente, nessun executor oggi) | Non promuovere esecuzione; whitelist di azioni tipizzate; marcare sperimentale/disabilitato |
| M | `cloud/telegramAiImporter.ts:26-45` | Validazione URL import via substring `includes('linkedin.com/sales')` aggirabile | `new URL()` + check `hostname==='www.linkedin.com'`+`pathname.startsWith('/sales')`+https |
| M | `ai/inviteNotePersonalizer.ts:210-251` | Indirect prompt injection: profilo/inbox non fidati nei prompt, output inviato su LinkedIn | Delimitare data/instruction; structured/function-calling; troncare; trattare output come non fidato |
| M | `cli/loopCommand.ts:241-286` | Comandi remoti Telegram (restart/importa/pausa) consumati senza validazione/authz in-process | Whitelist comandi + schema/regex su args + verifica sorgente autorizzata |
| M | `security/redaction.ts:26-53` | Pattern redaction non copre API key con trattino (OpenAI `sk-`, Anthropic `sk-ant-`) | Estendere il pattern al trattino + prefissi noti; test con `sk-ant-`/`sk-proj-` |
| M | `security/filesystem.ts:4-35` | Hardening permessi file no-op su Windows (DB/backup/sessioni con ACL default) | ACL reali via `icacls` (grant solo utente corrente) o cifratura DPAPI; almeno log al boot |
| M | `config/env.ts:13-30` | `resolveSecret` preferisce `process.env` al Docker secret (priorità invertita vs doc) | Allineare codice+doc; in prod controllare prima `/run/secrets`; test |
| M | `index.ts:287-297` | Gate validazione config bypassato per `login`/`create-profile` (che autenticano su LinkedIn) | Bloccare comunque su errori proxy/sessione/JA3 per questi comandi |
| M | `security/totp.ts:36-58` | TOTP senza anti-replay (codice valido ~90s riutilizzabile) | Tracciare ultimo token validato (replay-cache); rate-limit+lockout nel chiamante |
| M | `scripts/restoreDb.ts:139-147,330-345` | `execSync` con interpolazione shell nel restore Postgres (injection + fragilità path) | Uniformare a `execFileSync` con args; dump via stdin (`input`) |
| L | `api/server.ts:43,500-510` (+199-219,414-485) | `trust proxy=false` + IP allowlist/lockout collassano dietro reverse proxy (auth bypass + DoS auto-inflitto) | Trust proxy mirato; non whitelistare l'IP del proxy; chiave lockout dall'IP client reale |
| L | `cloud/telegramListener.ts:76-117` | Bot token Telegram negli URL di richiesta (fragile al logging) | Garantire che nessun logger emetta l'URL; helper di redazione token |
| L | `api/routes/linkedinChangeAlert.ts:30-95` | Webhook change-alert senza validazione zod + side-effect (auto-pause 120min) senza secret dedicato | Zod su severity/action; header secret dedicato; rate-limit |
| L | `core/repositories/leadsCore.ts:1263-1296` | `searchLeads`: metacaratteri LIKE non escapati + scansione leading-wildcard | Escapare `%`/`_` + `ESCAPE`; valutare FTS5/tsvector |
| L | `core/repositories/stats.ts:38-39…` | Identifier (field) interpolato in SQL senza allowlist runtime (non sfruttabile oggi) | Allowlist runtime (Set di colonne) con throw |
| L | `db.ts:430-458,529-552` | Interpolazione identificatori in DDL `ensureColumn*`/`PRAGMA table_info` (latente) | Allowlist `^[a-zA-Z0-9_]+$` + commento di contratto "solo identificatori statici" |
| L | `db.ts:748-767` | `pg_dump` riceve la connection string (con password) come argv | Password via `PGPASSWORD`/`~/.pgpass`; host/port/db/user come arg separati |

### Compliance-GDPR

| Sev | File:righe | Titolo | Raccomandazione |
|---|---|---|---|
| M | `salesnav/bulkSaveOrchestrator.ts:1472-1486` | PII loggata in chiaro + screenshot con dati personali inviati a OpenAI | Oscurare PII nei log (id hashati); confermare DPA/base giuridica; crop/mascheramento |
| M | `core/audit.ts:164-179` | Screenshot fullPage di profili (PII) su disco senza retention né cifratura | Retention/cleanup TTL; cifratura/ACL; collegare all'erasure; salvare solo crop |
| M | `integrations/personDataFinder.ts:1091-1301` | Raccolta OSINT di PII (Art.14/opposizione non gestita nella pipeline) | LIA documentato; limitare a contatto professionale; suppression-list consultata pre-enrichment |
| M | `integrations/personDataFinder.ts:614-634` (+654-936) | Data-minimization violata: raccolti anche email/telefoni personali + profilazione cross-platform | Applicare `PERSONAL_EMAIL_DOMAINS`; disabilitare mobile personali/aggregazione social di default |
| M | `integrations/personDataFinder.ts:1284-1298` | Nomi (PII) loggati in chiaro (`maskName` disponibile ma non usato) | Applicare `maskName()` o loggare solo leadId |
| M | `integrations/emailGuesser.ts:258-298` | Email indovinate salvate come contatto reale (accuratezza Art.5(1)(d)) | Su domini catch-all non restituire candidato; flag schema `verified` vs `guessed`, gating invio |
| M | `ai/inviteNotePersonalizer.ts:228-237` | PII a LLM remoto senza minimizzazione quando endpoint remoto abilitato | Troncare/redigere campi; gating dietro flag "PII processing consentito"; DPA; default locale |
| M | `core/repositories/leadsCore.ts:859-874…` | `gdpr_opt_out` non scritto né filtrato nelle query di selezione outreach | Filtrare `COALESCE(gdpr_opt_out,0)=0` in tutti i selettori + write-path opt-out; o documentare blacklist come SSOT |
| M | `core/repositories/system.ts:954-984` | `cleanupPrivacyData` hard-deleta lead convertiti (REPLIED/CONNECTED) + subquery 4× | Anonimizzazione invece di delete per i convertiti; materializzare gli id stale (CTE/temp) |
| M | `scripts/gdprRetentionCleanup.ts:163-189` | Cancellazione multi-tabella non transazionale (parziale + audit mancante su crash) | `withTransaction` per-lead; audit PRIMA/nella stessa transazione |
| M | `scripts/gdprRetentionCleanup.ts:307-350` | `runRightToErasure` dichiara "TUTTE le tabelle" ma tocca solo leads+audit_log | Estendere a message_history/lead_events/lead_intents in transazione; check esistenza lead |
| L | `api/routes/export.ts:82-144` | Endpoint "portabilità Art.20" è export massivo, non per singolo interessato | Filtro per linkedin_url/identificativo; separare export admin dalla portabilità |

### Data-flow-db / Correctness

| Sev | File:righe | Titolo | Raccomandazione |
|---|---|---|---|
| M | `risk/incidentManager.ts:171-210` | `classifyIncidentSource` usa `json_extract`+`GROUP_CONCAT` (SQLite-only) in catch vuoto → A13 rotta su PG | Tradurre per dialetto (jsonb/`STRING_AGG`); loggare l'errore nel catch |
| M | `salesnav/bulkSaveOrchestrator.ts:1427-1452` | Path scroll salva URL SalesNav in `linkedin_url` → dedup rotto, righe duplicate | Valorizzare `salesnavUrl` con `/sales/lead/`; campo distinto in `ScrollCollectedProfile`; test parità chiavi |
| M | `salesnav/salesnavDedup.ts:319-345` | Contatore `inserted` gonfiato: `INSERT OR IGNORE` non lancia mai | Usare `result.changes` per incrementare solo su insert reale |
| M | `salesnav/bulkSavePageActions.ts:585-676` | `chooseTargetList` prosegue il salvataggio con verifica lista fallita → lista SBAGLIATA | Abortire la pagina+FAILED+alert; distinguere "inconcludente" da "negativa" |
| M | `salesnav/bulkSavePagination.ts:104-160` | `clickNextPage` può ritornare true anche quando il cambio non è verificabile | Verificare con segnale alternativo (leadId set/URL); in mancanza di prova ritornare false |
| L | `salesnav/bulkSavePagination.ts:42-84` | `readPaginationInfo` sottostima il totale dai bottoni visibili → scraping interrotto presto | Usare "X di Y results" come fonte primaria; non cappare a `maxPage` visibile |
| M | `workers/interactionWorker.ts:56-127` | `likes_given`/`follows_given` incrementate anche quando l'azione non avviene | Helper ritorna booleano "azione eseguita"; incrementare solo su successo |
| M | `workers/inboxWorker.ts:160-187` | `nth(i)` su locator dinamico `:has(unreadBadge)` → conversazioni non lette saltate | Raccogliere upfront href/threadId stabili, o `.first()` finché count>0 |
| L | `workers/messageWorker.ts:555-557` | In dry-run incrementa la stat reale `messages_sent` | Non incrementare in dry-run (o contatore separato), allineare a invite/follow-up |
| L | `workers/inviteWorker.ts:318-323` | `visitedProfilesToday` marcato prima dell'esito → blocca il retry in-sessione | Aggiungere al set solo dopo esito definitivo; due set "visitato"/"completato" |
| M | `captcha/visionProviderFactory.ts:330-335` | `getOpenAIProviderFromCurrent` non gestisce `LocalFirstHybrid` → delay contestuale morto in local-first | Aggiungere il ramo `instanceof LocalFirstHybrid`; interfaccia comune `getOpenAIProvider()` |
| M | `captcha/openaiVisionProvider.ts:61-92` | System prompt anomaly iniettato anche in `suggestContextualDelay`/`generatePlaywrightCode` | System prompt mirato per task; parametrizzare `analyzeImage` |
| L | `captcha/visionProviderFactory.ts:183-215` | Cache provider con hash che ignora apiKey/temperature/`redactScreenshots` | Includere tutti i campi che influenzano il comportamento; invalidare su override |
| M | `core/repositories/leadsCore.ts:1337-1368` | Deconfliction multi-account: `LIKE` su leadId fa substring-match senza delimitatore | `json_extract(payload_json,'$.leadId')=l.id` (o delimitare); test collisione 4 vs 42 |
| M | `core/repositories/leadsCore.ts:600-622` | `promoteNewLeadsToReadyInvite`: UPDATE senza ri-check status (clobber race) | `AND status='NEW'` nella WHERE; o UPDATE...WHERE atomico |
| M | `core/repositories/leadsLearning.ts:149-172` | Read-modify-write del JSON `lead_metadata` senza transazione/lock (lost update) | `withTransaction`+`FOR UPDATE`; o `jsonb_set` atomico |
| M | `core/repositories/leadsCore.ts:313-349` | Nessuna validazione URL LinkedIn prima di usarlo come chiave dedup (chiave degenere `''`) | Validare a monte come `upsertSalesNavList` (rifiutare URL vuoto/non-LinkedIn) |
| M | `core/repositories/leadsCore.ts:313-349` | `addLead`: 4 statement non atomici (insert+2 select+list_leads) | `withTransaction` (`getDatabase()` dentro); o `RETURNING` invece di re-select |
| L | `core/repositories/leadsCore.ts:1279-1281` | `searchLeads` non normalizza `opts.status` (incoerente con i sibling) | `normalizeLegacyStatus(opts.status)` prima del push |
| L | `core/repositories/leadsLearning.ts:100-117` | `resolveLeadMetadataColumn` ritorna 'metadata_json' su QUALSIASI errore | Fallback solo su missing-column confermato; ri-lanciare i transitori |
| L | `core/repositories/leadsCore.ts:1231-1245` | `appendLeadEvent`: `JSON.stringify` del metadata non protetto | Serializzare in try/catch con fallback `{}`+logWarn |
| M | `core/repositories/featureStore.ts:506-511` | `importFeatureDatasetVersion`: verifica signature tautologica bypassabile | Signature obbligatoria o flag esplicito `skipSignatureCheck`; mai tautologia |
| M | `core/repositories/stats.ts:87-88,873-885` | Inconsistenza timezone: date-key tz-config vs `DATE(now)`/UTC + divergenza SQLite/PG | Centralizzare le finestre in JS con `config.timezone`; passare date come parametri |
| L | `core/repositories/stats.ts:808-828` | `computeListPerformanceMultiplier`: finestra invertita per `lookbackDays<7` disattiva il penalty | Clampare `Math.max(8,...)`; flag esplicito su finestra degenerata |
| M | `core/campaignEngine.ts:84-95` | Dispatch campagna non atomico (enqueueJob + updateState separati) → churn ripetuto | Unica transazione; riconciliare stato se job già in coda |
| M | `core/campaignEngine.ts:108-132` | `advanceLeadCampaign` non idempotente nonostante il commento → salta uno step | Ancorare l'avanzamento allo stepId completato; correggere il commento |
| M | `core/companyEnrichment.ts:111-131` | Fallback `a[href*="/in/"]` cattura ogni profilo della pagina → lead spazzatura | Restringere ai container risultati; selector versioning + alert |
| M | `db.ts:150-154` | `adaptParams` sostituisce TUTTI i `?` (incluso literal/operatori jsonb PG) | Tokenizzare ignorando stringhe quotate e operatori `?`/`?|`/`?&`; o placeholder `$N` a monte |
| M | `db.ts:156-218` | Traduzione SQLite→Postgres parziale e fragile in `normalizeSql` | Documentare i costrutti supportati; test query rappresentative su PG in CI |
| L | `db.ts:246-258` | `lastID` risolto solo se la PK si chiama 'id' (divergenza rowid) + `RETURNING *` espone PII | Mirare `RETURNING` alla PK reale; disabilitare auto-RETURNING quando `returning=false` |
| M | `ai/leadDataCleaner.ts:131-141` | `new RegExp(rawFirst)` non-escaped → crash su metacaratteri (ramo AI-disabled) | `escapeRegExp` o `split/join`; validare lunghezza input |
| L | `cloud/supabaseDataClient.ts:166-189` | Fallback read-modify-write non atomico per le stat cloud giornaliere | Affidarsi alla RPC atomica; fallback con UPSERT+espressione di incremento SQL |
| M | `workflows/preflight.ts:92-96,113-134` | DB stats/checklist calcolati col listFilter di default PRIMA della risposta `listName` | Spostare `collectDbStats`/checklist DOPO le risposte; `byStatus` list-scoped |
| M | `workflows/preflight/statsCollector.ts:55-87` | Trend "vs ieri" mescola data UTC e locale (off-by-one a mezzanotte) | Derivare "ieri" dalla stessa base locale di `getLocalDateString` |
| L | `workflows/services/sendInvitesService.ts:221,322,346` | `limit` non numerico → `parseInt` NaN → cap di sessione silenziosamente perso | `Number.isFinite` + fallback esplicito + warning; applicare a limit/maxPages/maxLeads |
| M | `integrations/leadEnricher.ts:437-494` | Flag `deep` documentato ma mai applicato: pipeline OSINT completa gira sempre | Implementare il gating (deep=false → solo company intel) o rimuovere flag+commento |
| L | `integrations/webSearchEnricher.ts:214-219` | Telefoni da web-search salvati senza validazione/normalizzazione | `parsePhoneNumberFromString` come in personDataFinder; scartare i non validi |
| L | `integrations/personDataFinder.ts:1052-1064` | `computeOverallConfidence`: bonus flat al numeratore senza peso → confidence sovrastimata | Incrementare anche il denominatore o cap esplicito; company intel non come confidence persona |
| L | `risk/significance.ts:24-47` | Test z one-sided senza guardia campione minimo né continuity correction | Guardia min sample (~30/expected≥5); minSampleSize prima di assegnare un winner |
| M | `scripts/ruleEnforcementMatrix.ts:256-264` | Regola richiede `token-cost-context.ps1` che un altro audit dichiara deprecato → GAP permanente | Allineare alla realtà (turn-governor cost-aware); check che fallisce se i due audit divergono |
| L | `scripts/rampUp.ts:84` | Day-target invalido/0 coerciato a giorno 1 senza warning | `parseIntStrict`, rifiutare fuori 1..7 con messaggio + exit 1 |
| L | `lens-arch · db.ts:51,416…` | Doppia sorgente di verità per `isPostgres` (istanza vs variabile modulo) | Derivare sempre da `getDatabase().isPostgres`; eliminare la variabile modulo |

### Observability / Resilience

| Sev | File:righe | Titolo | Raccomandazione |
|---|---|---|---|
| M | `browser/uiFallback.ts:342-368` | Vision fallback clicca a coordinate LLM senza guard contro elementi pericolosi | `isNearDangerousElement` (riusa DANGEROUS_SELECTORS); `verify` obbligatorio su azioni critiche |
| M | `proxy/proxyManager.ts:37-42,199-227` | Stato globale mutabile condiviso tra sessioni concorrenti (race cursore/cache) | Serializzare l'accesso al pool/cursore (mutex async) o stato per-worker |
| M | `proxy/proxyManager.ts:533-549` | Deep health-check fail-open quando gli echo-IP sono irraggiungibili | Distinguere "echo down" da "proxy rotto"; non promuovere "non verificabile" a "sano" |
| L | `proxy/proxyManager.ts:293,584…` | `console.log`/`warn` invece del logger strutturato; server proxy non mascherato | `logWarn`/`logInfo` + `maskUrl`; event+metric per fallback provider/Tor |
| M | `salesnav/bulkSaveOrchestrator.ts:1369-1373` | Segnali di detection (unusual activity, toast mismatch, limite 2500) solo su `console.log` | `logWarn`/`logError` strutturati collegati ad alert (Telegram/Sentry) con severità+azione |
| M | `salesnav/listActions.ts:141-228` | `createSalesNavList`/`addLead...` ritornano `ok:true` "best-effort" senza verify | Verificare toast/stato post-azione; `ok:false` con causa quando la verifica non passa |
| M | `workers/challengeHandler.ts:77-79` | `challenges_count` conta solo i challenge RISOLTI (i più gravi non alimentano segnali) | Tracciare ENCOUNTERED separato dalle RESOLVED; cap/cooldown per-account |
| M | `captcha/visionProviderFactory.ts:28-76` | `HybridVisionProvider` disabilita OpenAI permanentemente al primo errore transitorio | Distinguere transitori (retry/re-enable dopo N) da permanenti (budget/auth); contatore recovery |
| M | `captcha/openaiVisionProvider.ts:402-417` | Budget vision su stima costante, non sull'uso token reale | Costo da `usage` reale; verificare il budget anche DOPO l'accumulo |
| M | `core/jobRunner.ts:1044-1091` | Circuit breaker: fallimento rotazione non imposta `sessionClosed` → close su browser già chiuso | Allineare al path periodico: `sessionClosed=true` su rotazione fallita prima di break |
| M | `core/jobRunner.ts:638-772` | Nessun timeout/watchdog su `processor.process` e enrichment parallelo → stallo sessione | `Promise.race` con timeout per-job; timeout interno all'enrichment |
| M | `core/jobRunner.ts:79-104` | `failureRate=failed/processed` su popolazioni disgiunte → può superare 1.0, RED falsi | `failed/(processed+failed)`; clamp `[0,1]` |
| M | `core/salesNavigatorSync.ts:669-951` | Con `existingSession` l'overlay blockUserInput/click-through resta attivo sulla sessione del chiamante | Cleanup overlay in `finally` indipendentemente da `ownsBrowser` (flag `overlayEnabled`) |
| L | `core/salesNavigatorSync.ts:733-737` | `JSON.parse` del checkpoint non protetto → un flag corrotto aborta l'intero sync | try/catch → checkpoint vuoto + logWarn |
| L | `core/companyEnrichment.ts:146-283` | Attribuzione account errata: challenge/quarantine con accountId 'default' | accountId coerente lungo il flusso; evitare stringhe hardcoded |
| M | `db-sync/supabaseSyncWorker.ts:204-212` | Backlog alert cieco ai `PERMANENT_FAILURE` (escono dal conteggio pending) | Alert dedicato sul tasso `PERMANENT_FAILURE` per sink; DLQ con notifica |
| M | `sync/outboxUtils.ts:1-11` | `parseOutboxPayload` degrada payload malformati a `{raw}` e li marca delivered | `logWarn` con idempotency_key; non marcare delivered → DLQ/PERMANENT_FAILURE |
| M | `csvImporter.ts:36-136` | Import CSV non bounded in memoria, non transazionale, insert sequenziali | Streaming a batch con cap; `withTransaction` per batch; validare filePath se via API |
| M | `db.ts:115-124` | Transazioni di scrittura SQLite usano `BEGIN` deferred invece di `BEGIN IMMEDIATE` | `BEGIN IMMEDIATE` per le transazioni di scrittura (attesa pulita su busy_timeout) |
| L | `db.ts:597-647` | Race nell'init del singleton `getDatabase()` (pool/handle duplicati e orfani) | Memoizzare la PROMISE di init, non l'istanza; reset su errore per retry |
| L | `sync/backpressure.ts:69-82` | Backpressure level read-modify-write non atomico (last-writer-wins) | Overlap-guard per-sink o update atomico SQL `SET value=f(value)` |
| M | `ai/semanticChecker.ts:10-11` | Memory leak: Map statica per-lead senza eviction delle chiavi | LRU con cap o TTL; rimuovere entry a fine lifecycle (persistenza già su DB) |
| M | `config/telemetry/alerts.ts:44-72` | Alert Telegram come HTML con body Markdown non-escaped → formattazione rotta + drop silenzioso | Un solo formato con escaping coerente; fallback plain-text se `parse_mode` fallisce |
| M | `config/telemetry/logger.ts:28-46` | Il logger non isola il fallimento della scrittura DB → rompe i fallback | `try/catch` attorno a `recordRunLog` (best-effort, console.warn) |
| L | `validation/messageValidator.ts:57-73` | Semantic-similarity check fail-open silenzioso (catch vuoto) | `logWarn` nel catch; valutare fail-closed per messaging critico |
| M | `workflows/preflight/riskAssessor.ts:86-96` | Read-modify-write non atomico su `risk_score_history` (race su run concorrenti) | Serializzare l'update (transazione/mutex) o append store dedicato con UPSERT |
| M | `workflows/services/sendInvitesService.ts:327-339` | Enrichment in send-invites non protetto da try/catch → crash dell'intero workflow | Stesso pattern di send-messages (`enrichmentDegraded=true`+logWarn); helper condiviso |
| M | `workflows/services/sendMessagesService.ts:249-251` | Catch silenziosi diffusi inghiottono errori (enrichment/warmup/listBreakdown) | `logWarn` strutturato (evento+accountId+errore) mantenendo best-effort |
| L | `workflows/services/sendInvitesService.ts:183,355-361` | Conteggio inviti come delta del daily stat (inaffidabile a mezzanotte/concorrenza/`.catch(()=>0)`) | Ritornare il conteggio reale della sessione dal job runner; non `.catch(()=>0)` su `invitesBefore` |
| L | `workflows/services/shared.ts:57-78` | Abort dell'AI advisor etichettato `USER_CANCELLED` → nessun alert Telegram | Propagare `abortReason` (AI_ABORT); mappare a reason che genera report |
| M | `scripts/restoreDb.ts:139-147` | Restore Postgres distruttivo senza backup pre-restore (asimmetria vs SQLite) | `pg_dump` di sicurezza pre-restore; `--force` per non-drill; fermare il runtime |
| M | `scripts/aiControlPlaneAudit.ts:376-378…` | Audit HARD dipendono da stato globale `~/.claude` e crashano su JSON malformato | `readJson` con try/catch → FAIL pulito; condition-aware (SKIPPED se file globali assenti) |
| L | `scripts/lib/aiControlPlaneRegistry.ts:134-143` | Pattern routing compilati con `new RegExp` senza validazione → crash su pattern malformato | Validare la compilazione in `validateRoutingRegistry`; try/catch + skip in `countPatternMatches` |
| L | `scripts/gdprRetentionCleanup.ts:80-94` | `computeLastActivity` su date tutte invalide → Invalid Date; URL PII parziale su stdout | Gestire candidates vuoto (fallback created_at); loggare solo `lead.id`/hash |
| L | `repos-2/aiQuality.ts:494-587` | `runAiValidationPipeline`: run lasciato in RUNNING su crash, loop AI non bounded | finalize in try/catch → FAILED; reaper per run vecchi; timeout per-sample |

### Architettura / Hygiene / Type-safety / Performance / Testing (medium/low)

| Sev | File:righe | Titolo | Raccomandazione |
|---|---|---|---|
| M | `core/repositories/system.ts:29-88` | DDL runtime duplica lo schema delle migration (doppia sorgente di verità) | Eliminare le CREATE TABLE runtime; affidarsi alle migration; cache idempotenza |
| M | `cli/loopCommand.ts:1-1148` | God-module: loopCommand (1147) + adminCommands (1102) con responsabilità eterogenee | Estrarre lock/evaluators/processCloudCommands; feature-store in modulo dedicato |
| L | `core/salesNavigatorSync.ts:572-952` | `runSalesNavigatorListSync` god-function (~380) con re-login duplicato 3× | Estrarre `withSalesNavReloginRetry`/`discoverLists`/`processList`; separare enrichment/cloud |
| L | `core/repositories/stats.ts:1-1059` | `stats.ts` 1059 righe con responsabilità multiple | Estrarre SLO/observability in `observability.ts`; separare trust/list multiplier |
| M | `risk/scheduler.ts:736-798` | N+1 di query sequenziali per-lead/per-lista nello scheduler | Batchare blacklist/target/cb-flag in una query `WHERE ... IN (...)` |
| M | `core/repositories/system.ts:150-202` | `claimPendingOutboxEvents`: claim per-riga in loop invece di set-based | PG `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING`; loop solo fallback SQLite |
| L | `core/repositories/stats.ts:738-781` | `getRiskInputs`: ~7 query in serie nel hot-path scheduler | `Promise.all`; accorpare le 3 `getDailyStat` in una SELECT |
| L | `salesnav/salesnavDedup.ts:234-262` | `checkDuplicates` ricarica l'intero set membri a ogni pagina | Caricare i Set una volta per run e aggiornare in memoria |
| L | `core/repositories/leadsLearning.ts:271-293` | `listCommentSuggestionsForReview`: `LIKE '%...%'` full scan non indicizzato | Colonna/flag indicizzata `has_pending_comment_review` o tabella review-queue |
| M | `browser/windowInputBlock.ts:193-220` | `_applyClickThrough` usa `execSync` con compile C# dopo ogni navigazione → blocca event loop | Esecuzione async (execFile/spawn); pre-compilare il tipo C# una volta; o P/Invoke nativo |
| L | `core/securityAdvisor.ts:78-263` | `fs` sincrono in funzione async (+ TOCTOU `existsSync`/`statSync`) | `fs.promises`; gestire file-mancante via catch su stat |
| L | `db.ts:140-148` | Pool PG max=10 + `statement_timeout` globale 30s (esaurimento + kill migration lunghe) | Rendere configurabili; `SET LOCAL statement_timeout=0` nelle migration |
| M | `security/filesystem.ts` (+`pluginLoader`) | Hardening permessi no-op su Windows (vedi Security) | (consolidato con il finding security) |
| L | `proxy/exitIpChecker.ts:54-64` | `buildProxyUrl` duplicato tra exitIpChecker e proxyManager | Estrarre un'unica `buildProxyUrl` condivisa |
| L | `browser/missclick.ts:74-183` | `shouldMissclick`/`performMissclick` + safe-offset dead code (mai invocati) | Cablare (offset garantito fuori bbox) o rimuovere il dead code |
| L | `core/jobRunner.ts:758-1113` | Shadowing `throttleSignal`, progress-bar `\r` sotto PM2, ETA negativo | Rinominare; `Math.max(0,...)`; writer condizionato a `isTTY` |
| L | `db/migrations/059_gdpr_retention.sql:1-16` | Commento fuorviante su idempotenza `ADD COLUMN`; 029/059 senza `IF NOT EXISTS` | Correggere il commento o usare `ADD COLUMN IF NOT EXISTS`/check colonna |
| L | `config/validation.ts:326-364,430-440` | Regole di validazione duplicate/contraddittorie (stessa condizione warn+error) | Consolidare ogni soglia in un'unica regola con severity corretta |
| L | `integrations/personDataFinder.ts:180-181` | Regex globali module-level con `lastIndex` mutabile usate con `test()`/`exec()` | Regex locali per chiamata o togliere `/g` dove si usa solo `test()` |
| L | `scripts/hooksConformityAudit.ts:112-118` | `checkConfiguredCommandTargetsExist` riconosce solo path Windows → no-op fuori Windows | Estendere a path POSIX; memoizzare `getAllHookCommands` |
| L | `workflows/preflight.ts:87-90` | `answers['_accountId']` impostato/parsato ma mai letto a valle (dato morto) | Rimuovere `_accountId`; mantenere `selectedAccountId` come SSOT |
| L | `workers/registry.ts:25-89` | Payload job deserializzati con cast `as T` non validato | Schema zod per JobType; INVALID_PAYLOAD non-retryable |
| L | `integrations/leadEnricher.ts:199-223` | Risposte API esterne (Apollo/Hunter/Clearbit) con cast `as` senza validazione | Schema zod minimo + `safeParse` |
| L | `cli/cliParser.ts:53-59` | `parseIntStrict` accetta coda non numerica (`12abc`→12) | Regex match completo `/^-?\d+$/` prima di parseInt |
| L | `cli/stdinHelper.ts:15-46` | `readLineFromStdin` lascia listener `once('close'/'error')` attaccati | Rimuovere anche i listener close/error in cleanup |
| L | `ai/aiDecisionEngine.ts:101-113` | Timer del timeout non cancellato nella `Promise.race` | `clearTimeout` in `finally` dopo la race |
| M | `core/repositories/leadsCore.ts:136-221…` | Zero copertura di test sui write-path e dedup critici | Test unit/integrazione (anche su Postgres) su atomicità/upsert concorrente/collisione leadId |
| M | `tests/e2eDry.ts:44-105` | L'e2e dry-run usa `assert.ok(true)` per i 4 workflow (solo no-throw) | Asserire stato DB post-dry-run (record/automation_commands, transizioni); no azioni outbound |
| M | `proxy/proxyQualityChecker.ts:272-386` | `checkProxyQuality` (verifica exit-IP) non testata (proprio il tema AB-22) | Iniettare http client fittizio; asserire exit-IP coincidente/divergente + fail-closed su errore rete |
| M | `core/scheduler.ts:385-660` | `scheduleJobs` non esercitata: testati solo gli helper puri | Test con repo/clock fittizi su spaziatura/varianza/budget adattivo/STOP |
| M | `vitest.config.ts:13-31` | Coverage misurata ma mai enforced (no thresholds) + cli/scripts esclusi | `coverage.thresholds` su risk/scheduler/auth/proxy/workers; reintegrare cli nel report |
| L | `tests/riskEngine.vitest.ts:58-71` | Asserzioni tautologiche (`toContain([tutti i valori])`) sul risk engine | Asserzioni precise sull'azione attesa per gli input (come riskEngineBoundary) |
| L | `tests/proxyAndNoise.vitest.ts:1-25` | Naming dei file di test fuorviante vs modulo coperto | Allineare nome file al SUT; un file = un modulo |

---

## Architettura (coupling, god-module, file >300, circular deps)

**Igiene macro: BUONA.** `madge --circular` = 0 su 435 file; type-safety eccellente (0 `as any`, 1 solo `: any`); domain types centralizzati in `types/domain.ts`; helper random/delay consolidati. Il rischio architetturale è concentrato in pochi smell dominanti, **nessuno bloccante a livello di correttezza** ma con alto blast-radius e bassa testabilità proprio sulle aree anti-ban.

### Mega-funzioni (testabilità anti-ban compromessa)
- **`jobRunner.ts::runQueuedJobsForAccount` — 1198 righe in un'unica funzione** (out_degree 283, il più alto del codebase), un solo `try/finally` che orchestra launch/login/freshness/overlay + loop dispatch + health/backpressure/decoy/GC + teardown, con `session`/`sessionClosed`/`accountHealthMetrics` come stato locale mutabile condiviso da decine di branch. È la funzione più anti-ban-critica e di fatto non unit-testabile (varianza, verify pre/post, cleanup per-branch). **(medium, architecture)**
- **9 ulteriori mega-funzioni 420-944 righe**, la maggioranza LinkedIn-touch: `runSalesNavBulkSave` (944), `scheduleJobs` (675), `buildStealthInitScript` (656), `launchBrowser` (524), `processMessageJob` (523), `processInviteJob` (512), `buildLoopSubTasks` (485), `index.ts main` (461), `runWorkflow` (420). **(medium)** — *Include i finding modulo-specifici fusi: scheduleJobs monolith, bulkSaveOrchestrator monolith, processInviteJob god-function.*

### God-module e accoppiamento
- **`leadsCore.ts` god-module**: 56 export, 1417 righe, ≥7 responsabilità (campagne/SalesNav lists/company targets/CRUD lead/enrichment/scoring/timeline/follow-up). Nucleo della community più accoppiata. → split per dominio in file <300 (`leadCampaignConfig`, `companyTargets`, `leadEnrichment`, `leadScoring`, `leadTimeline`, `leadStatus`). **(medium)**
- **Barrel `repositories.ts` con `export *` da 11 moduli, importato da 59 file**: ha già causato una circular dependency reale (documentata e patchata a mano rimuovendo `aiQuality`). → re-export espliciti o import diretti dal modulo specifico; lint che vieta nuovi `export *` nel layer. **(medium)**
- **Community `repositories-lead`**: 434 nodi, coesione **0.17**, epicentro di **41 warning di high-coupling** (proxy→repos 277 edge, repos→telemetry 156, →workers 134, commands→repos 113, browser→repos 89, →risk 63). Chokepoint `getDatabase` (in_degree 277). → segregazione per dominio con interfacce per consumer; facade per-dominio invece del barrel monolitico. **(medium)**
- **God-config**: oggetto `config` flat con ~317 proprietà importato in 86 file; ogni modulo si accoppia all'intera shape. → slice tipizzate per dominio (`AntibanConfig`/`ProxyConfig`/`SchedulerConfig`/`ApiConfig`); migrare prima le aree ad alto rischio. **(medium)**

### Altri smell strutturali
- **Doppia SSOT `isPostgres`** (proprietà istanza vs variabile di modulo `db.ts:416`): coerenti oggi ma in sync manuale; un path futuro che non aggiorni entrambe produce SQL malformato silenzioso. **(low)**
- **Side-effect su import in `api/server.ts`** (Express app + `setInterval` a livello di modulo) + pattern di 68 singleton mutabili senza reset hook (proxy rotation/sticky/cache fingerprint) → moduli non importabili "a freddo" nei test, non determinismo sulle aree anti-ban. → factory `createServer()`/`startSessionCleanup()` + reset hook per i singleton anti-ban. **(low)**

### File >300 righe
84 file runtime >300 righe (L1.6/L1-LI.4). Hotspot principali già citati: `bulkSaveOrchestrator.ts` 1840, `humanBehavior.ts` 1423 (anti-ban), `leadsCore.ts` 1417, `jobRunner.ts` 1415, `personDataFinder.ts` 1301 (PII), `loopCommand.ts` 1147, `scheduler.ts` 1059, `stats.ts` 1059, `server.ts` 969, `proxyManager.ts` ~838. Decomposizione prioritizzata per criticità anti-ban (vedi Roadmap P2).

---

## Roadmap di remediation prioritizzata

### P0 — Immediato (anti-ban / security / dati / prod-breaking)
*Impatto: blocca ban reali, leak GDPR, o rottura silenziosa della produzione. Da fare prima di qualsiasi feature.*

1. **GDPR erasure completo** (C1 + H13 + H14): abilitare `PRAGMA foreign_keys=ON`; estendere erasure/anonymize/delete a `lead_enrichment_data` + tabelle figlie; CASCADE su FK outbox o delete esplicito nella transazione di cleanup. *Stima: medio. Sblocca prod-readiness GDPR.*
2. **Cluster IP-diretto** (H2 + finding `--no-proxy` cli/workflows + `index.ts` bypass + H4): portare AB-24 su `createProfile`; vietare `--no-proxy` sui comandi autenticati; gate critical anche headless; fail-closed quando managed proxy ON e nessun proxy. *Stima: medio. È il tema del branch corrente.*
3. **Bug Postgres-only** (H9 + H10 + H11 + H14): riscrivere `getSessionHistory` con `DATETIME`; fix `getAccountAgeDays` (`Z`+`Date`); `getDatabase()` fresco dentro `withTransaction`; test di integrazione su Postgres reale in CI. *Stima: medio. Oggi l'outreach si ferma in prod a ogni ciclo.*
4. **Authz/leak** (H6 + H7 + H8): Telegram fail-closed (allowlist obbligatoria); auth WS per ogni credenziale; sanitizzare il payload prima di Sentry. *Stima: basso. Fix mirati ad alto valore.*
5. **Cap che non cappano** (H3 + weekly-cap + control-plane cap + auto-reply budget): default session limit conservativo; re-clamp finale a `weeklyRemaining`/daily; clamp superiore ai cap cloud; contare le auto-reply nel budget. *Stima: basso-medio.*
6. **Single-runner** (H12 + H16): UPDATE takeover condizionale idempotente; `try/finally` su `setOverrideAccountId`. *Stima: basso. Previene doppia automazione sullo stesso account.*
7. **Proxy safety** (H15 + Tor default-ON + DC non bloccato + geo coherence): fix fallback d'emergenza; Tor opt-in con halt+alert; gating reale su ASN datacenter; coerenza geo exit-IP↔fingerprint. *Stima: medio.*
8. **Dato SalesNav corrotto** (H15-salesnav field mismatch + chooseTargetList lista sbagliata): fix mapping salesnavUrl/linkedinUrl; abortire su verifica lista fallita. *Stima: basso-medio.*
9. **GDPR enforcement** (H17 + H18 + H19): gate `gdpr_opt_out` nell'enrichment; allineare registro Art.30; redaction reale o fail-fast su `redactScreenshots`. *Stima: medio.*

### P1 — Alta priorità (rischio reale, non immediato)
*Impatto: degrada difese anti-ban, osservabilità o coerenza dati senza rottura immediata.*

- **Anti-ban fingerprint/timing**: renderer WebGL mobile (H1), coerenza locale/timezone/OS del pool, drift comportamentale cross-sessione, keystroke log-normale, decoy/warm-up senza teletrasporto, burst follow-up, cap LIKE/FOLLOW, challenge mid-azione → quarantena durevole.
- **Osservabilità che droppa in silenzio**: alert Telegram HTML/escape, backlog PERMANENT_FAILURE, security-audit swallowed, segnali SalesNav su console, catch silenziosi nei workflow, logger che rompe i fallback.
- **Resilienza runtime**: timeout/watchdog su `processor.process`+enrichment, circuit-breaker `sessionClosed`, overlay leak su sessione condivisa, memory leak (`semanticChecker`, cache OSINT), `BEGIN IMMEDIATE` su SQLite.
- **Copertura test critica** (H20-H24): worker d'azione, `humanBehavior`, `auth.ts`, transazioni `leadsCore`, exit-IP proxy, `scheduleJobs`; abilitare coverage thresholds; sostituire le asserzioni tautologiche.
- **SSRF + security hardening condizionale**: blocklist IP privati nell'enrichment, `/metrics` dietro auth, ACL reali su Windows, redaction API-key con trattino, SMTP probe via proxy.

### P2 — Manutenibilità / debito (no rischio immediato)
*Impatto: testabilità, blast-radius, velocità di review — abilita i fix P0/P1 futuri.*

- **Decomposizione god-function/god-module** in ordine di criticità anti-ban: `stealthScripts`/`launcher`/`inviteWorker`/`messageWorker` (fingerprint+timing) → `jobRunner`/`scheduler` → `bulkSaveOrchestrator`/`salesNavigatorSync` → `leadsCore`/`loopCommand`/`adminCommands`/`stats`.
- **Accoppiamento**: sostituire `export *` con re-export espliciti; slice di config per dominio; facade per `repositories-lead`; SSOT `isPostgres`; factory per `server.ts`.
- **Performance**: N+1 scheduler, claim outbox set-based, `getRiskInputs` parallelo, full-scan review-queue, fs async in securityAdvisor.
- **Hygiene/type-safety**: dedup `buildProxyUrl`, dead code missclick, zod ai boundary (registry/integrations), `parseIntStrict`, regole di validazione duplicate, commenti migration fuorvianti, naming dei file di test.

---

## Appendice: copertura per modulo

| Key | Titolo | File coperti | Salute |
|---|---|---|---|
| `browser` | Browser / stealth / human-behavior | 20 | Buona con riserve (coerenza fingerprint, simulazioni incomplete) |
| `risk-scheduler` | Risk engine / scheduler / ramp-up | 19 | Buona con riserve · **P0** (2 query PG-breaking, cap espandibile) |
| `proxy` | Proxy / network / exit-IP | 6 | Media · **P0** (enforcement advisory, Tor default, fallback morto) |
| `salesnav` | Sales Navigator scraping | 12 | Media-bassa · **P0** (sessione illimitata, dedup rotto) |
| `workers` | Workers (invite/follow-up/message/activity) | 23 | Buona con riserve (budget secondari bypassati) |
| `fingerprint-captcha` | Fingerprint / captcha / selectors | 9 | Media (coerenza locale/OS, redaction no-op) |
| `repos-1` | Repositories: leads / write / learning | 12 | Media · **P0** (transazioni illusorie su PG) |
| `repos-2` | Repositories: stats / system / aiQuality | 15 | Buona con riserve · **P0** (NaN PG, race lock) |
| `core-engine` | Core engine: jobRunner / orchestrator / campaign | 11 | Media (god-function, state leak, no watchdog) |
| `db-sync` | DB layer / sync / outbox / import | 19 | Media · **P0** (FK/cascade, dual-dialect fragile) |
| `api` | API / HTTP surface / dashboard | ~6 | Buona con riserve (WS/metrics auth gap) |
| `integrations` | Integrations: personDataFinder / leadEnricher (PII) | 11 | Media-bassa · **P0** (SSRF, GDPR) |
| `ai-cloud` | AI clients / cloud bridge | 27 | Media (Telegram fail-open, prompt injection) |
| `cli` | CLI commands (loop/admin/util/salesnav) | 10 | Media (anti-ban direct-IP, multi-sessione) |
| `config-misc` | Config / validation / security / telemetry / ml | 41 | Buona con riserve · **P0** (Sentry leak, hot-reload) |
| `workflows` | Workflow services / automation | 21 | Buona con riserve · **P0** (enforcement asimmetrico headless) |
| `scripts-tooling` | Scripts: audit / ops tooling | 18 | Media · **P0** (createProfile direct-IP, GDPR non-trans) |
| `lens-arch` | LENTE: Architettura globale | 15 | Media (igiene macro buona, god-module/coupling) |
| `lens-sec` | LENTE: Sicurezza globale | 18 | Buona con riserve (gap per lo più condizionali) |
| `lens-gdpr` | LENTE: GDPR / PII / compliance | 17 | Bassa · **P0** (erasure/registro disallineati) |
| `lens-test` | LENTE: Qualità test-suite | 23 | Media (copertura distributiva, path d'azione scoperti) |

---

*Audit generato dalla fusione di 252 finding verificati (21 unità) → 234 finding unici dopo dedup. Severità: 1 critical · 25 high · 142 medium · 66 low. Priorità zero del progetto = anti-ban: tutti i P0 anti-ban vanno fatti passare da `/antiban-review` prima del merge.*
