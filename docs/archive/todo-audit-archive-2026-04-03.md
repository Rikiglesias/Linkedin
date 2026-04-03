# TODO — Audit Unificato Sistema LinkedIn Automation

> Nota operativa 2026-04-01:
> questo file resta l'audit storico ampio.
> Per il lavoro corrente usare anche:
> - [active.md](C:/Users/albie/Desktop/Programmi/Linkedin/todos/active.md)
> - [workflow-architecture-hardening.md](C:/Users/albie/Desktop/Programmi/Linkedin/todos/workflow-architecture-hardening.md)
> - [ENGINEERING_WORKLOG.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/tracking/ENGINEERING_WORKLOG.md)

> Unificazione di 5 mappe audit (deep_dive_360, linkedin_system_map_v2, mappa_commerciale, mappa_sistema_linkedin, mappa_tecnica_audit_3).
> 97 finding unici dopo deduplicazione. Ogni item ha: descrizione, file coinvolti, impatto, fix proposto.
> **OGNI fix deve passare i 6 livelli di controllo (L1→L6) documentati sotto.**

---

## Statistiche

| Severità | Conteggio |
|----------|----------|
| 🔴 CRITICAL | 14 |
| 🟠 HIGH | 30 |
| 🟡 MEDIUM | 49 |
| 🏗️ ARCHITETTURA | 22 |
| 🤖 RACCOMANDAZIONI INTELLIGENZA | 10 (R01-R10) |
| ✅ BEN FATTO | ~35 moduli |
| **TOTALE ACTIONABLE** | **115 + 10 raccomandazioni** |

> Basato sulla lettura di **~40.000 righe** di codice sorgente (120+ file TypeScript).

---

## 📊 STATO IMPLEMENTAZIONE (aggiornato marzo 2026)

| Categoria | Done | Open | Note |
|-----------|------|------|------|
| 🔴 CRITICAL (C01-C14) | **14/14** | 0 | Tutti implementati ✅ |
| 🟠 HIGH (H01-H30) | **30/30** ✅ | 0 | Tutti completati |
| 🟡 MEDIUM (M01-M49) | **49/49** ✅ | 0 | Tutti completati |
| 🏗️ ARCHITETTURA | ~18/22 | ~4 | Circular deps ✅, integration.ts rimosso ✅ |
| 📋 PROD READINESS | 3/12 | 9 | Graceful shutdown ✅, env config ✅, secrets ✅ |

---

## ⚙️ WORKFLOW OBBLIGATORIO PER OGNI FIX — 6 Livelli di Controllo

> **OGNI singolo fix di questa lista DEVE passare tutti e 6 i livelli prima di essere considerato completato.**
> Se un livello trova un problema → STOP e fixare. Non procedere al livello successivo.

### Pre-modifica
```
npm run pre-modifiche
```
Se errori/warnings/test falliti → **BLOCCO**. Non iniziare la modifica.

### Post-modifica
```
npm run conta-problemi
```
Deve essere **EXIT CODE 0** — zero tolleranza. 1 errore = BLOCCO, 1 warning = BLOCCO, 1 test fallito = BLOCCO.

### I 6 Livelli

| Livello | Nome | Cosa controllare | Bloccante? |
|---------|------|------------------|------------|
| **L1** | Compilazione e test | `npm run conta-problemi`: typecheck 0, lint 0, tutti i test passano. `npm run build` se frontend. Circular dependency check se moduli core. Dead code: grep che nessun file importa funzioni rimosse. | ✅ BLOCCANTE |
| **L2** | Import/export e compatibilità | Catene di import/export intatte. Parametri opzionali aggiunti con `?` (retrocompatibili). Barrel file (`index.ts`) aggiornati. Nessun breaking change nelle interfacce pubbliche. | ✅ BLOCCANTE |
| **L3** | Edge case e robustezza | Edge case: NaN, null, undefined, stringhe vuote, array vuoti. Performance: no loop O(n²) su dataset grandi. Memory leak: listener rimossi, WeakMap usate dove serve. DB: transazioni dove servono, rollback su errore. | ✅ BLOCCANTE |
| **L4** | Scenari di fallimento | "E se il valore è null?" "E se fallisce a metà?" "E se viene chiamato 2 volte?" "E se il DB è pieno?" "E se il proxy muore mid-session?" Scenari multi-giorno: cosa succede dopo 7 giorni di operazione continua? Race condition con processi concorrenti? | ✅ BLOCCANTE |
| **L5** | Osservabilità utente | L'utente capisce cosa sta succedendo? Log chiari con contesto (non solo "error"). Alert Telegram dicono COSA FARE, non solo cosa è successo. Report leggibili. Messaggi d'errore actionable (non "errore generico"). | ⚠️ IMPORTANTE |
| **L6** | Integrità dati e reversibilità | Dati corretti end-to-end (verificare con query DB). Operazione reversibile? Se no, documentare. Config documentata in `CONFIG_REFERENCE.md`. Migration DB compatibile con rollback (`.down.sql`). Nessun dato orfano dopo la modifica. | ⚠️ IMPORTANTE |

### Checklist da copiare per ogni fix
```markdown
## Fix [ID] — [Titolo]
- [ ] `npm run pre-modifiche` PASSED
- [ ] Impatto anti-ban valutato (5 domande)
- [ ] Implementazione completata
- [ ] `npm run conta-problemi` EXIT 0
- [ ] L1: typecheck 0, lint 0, test passano
- [ ] L2: import/export catene intatte, parametri retrocompatibili
- [ ] L3: edge case (null, vuoti, NaN), performance, memory leak, transazioni DB
- [ ] L4: "e se null?", "e se fallisce a metà?", "e se chiamato 2 volte?", multi-giorno
- [ ] L5: log chiari, alert Telegram actionable, utente capisce cosa succede
- [ ] L6: dati end-to-end corretti, reversibilità, config documentata, migration compatibile
```

### 5 Domande Anti-Ban (Priorità #0)
Prima di OGNI modifica, chiedersi:
1. Questa modifica cambia il comportamento del browser su LinkedIn? Se sì → massima attenzione
2. Questa modifica cambia timing, delay, ordine delle azioni? Se sì → verificare che la varianza resti
3. Questa modifica tocca fingerprint, stealth, cookie, session? Se sì → verificare coerenza + test regressione
4. Questa modifica aggiunge un'azione nuova su LinkedIn (click, navigazione, typing)? Se sì → deve sembrare umana
5. Questa modifica cambia volumi (budget, cap, limiti)? Se sì → verificare che il pending ratio non salga

---

## 🗺️ WALKTHROUGH PRATICO — Ogni azione al millimetro (scenario utente reale)

> Mi siedo al PC, accendo il bot. Questa sezione percorre OGNI singola azione: ogni click del mouse,
> ogni scroll, ogni query DB, ogni check, ogni possibile fallimento. Basata sulla lettura riga per riga
> di: `index.ts` (656 righe), `jobRunner.ts` (1075 righe), `inviteWorker.ts` (560 righe),
> `messageWorker.ts` (275 righe), `bulkSaveOrchestrator.ts` (2834 righe).

---

### WF-BOOT — Accendo il bot: `bot.ps1 send-invites --list "MiaLista"`

**1. Crash safety** (index.ts:1-9)
- Registra handler per `unhandledRejection` e `uncaughtException` → chiama `performGracefulShutdown()`
- Lo shutdown ha timeout 30s. Se il browser sta digitando un messaggio → LinkedIn vede disconnessione brusca
- ⚠️ **Scenario**: crash durante `humanType()` → LinkedIn salva draft fantasma nella chat (**H16**)

**2. Graceful shutdown setup** (index.ts:81-158)
- SIGINT/SIGTERM → rilascia cursore mouse → wind-down browser → recovery stuck jobs → close DB
- `setupPlannedRestart()`: dopo `processMaxUptimeHours` → exit code 0 per protezione memory leak. Check ogni 30min.
- ✅ OK: ben implementato

**3. Config validation** (index.ts:254-271 → config/validation.ts)
- `validateConfigFull()` esegue 12 regole di validazione. Se errori critici su comandi operativi → `process.exit(1)`
- 🔴 **MANCA**: nessun check range su cap numerici. `HARD_INVITE_CAP=-1` o `HARD_INVITE_CAP=500` passano senza warning (**M01**)
- 🔴 **MANCA**: nessun check coerenza tra profili dev/production

**4. DB init + recovery** (index.ts:346-373 → db.ts:700-711)
- `initDatabase()`: check spazio disco → `getDatabase()` → `applyMigrations()` (55 file .sql)
- Recovery: `recoverStuckJobs()` (RUNNING da >N min → PENDING), `recoverStuckAcceptedLeads()` (ACCEPTED → READY_MESSAGE), `recoverStuckPublishingPosts()` (PUBLISHING → FAILED)
- ✅ OK: auto-riparazione eccellente

**5. 🔴 Mandatory preflight — IL DOCTOR** (index.ts:375-405 → core/doctor.ts:256-373)
- `runDoctor()` verifica: DB integrity, login, account isolation, quarantena, compliance, disaster recovery
- **IL PROBLEMA**: alla riga 297 di doctor.ts, chiama `launchBrowser()` PER OGNI account per verificare il login. Il browser si apre, va su LinkedIn, controlla la navbar.
- 🔴 **Ma il proxy check è DOPO (riga 407 di index.ts)**. Se il proxy è morto → il browser del doctor naviga LinkedIn con l'IP REALE del server (**C01**)
- Il doctor verifica anche l'isolation: session directory duplicate? Proxy condiviso tra account? ✅ OK

**6. Proxy health check** (index.ts:407-420 → proxyManager.ts:504-549)
- Per ogni account con proxy: `checkProxyHealth()` → TCP socket connect con timeout 5s → se `ipReputationApiKey` configurata, check AbuseIPDB
- 🔴 Se fallisce: `console.error(...)` ma **NON** `process.exit(1)`. Il bot parte lo stesso senza proxy (**C02**)
- 🔴 Nessun check CycleTLS. `validateJa3Configuration()` esiste in `proxy/ja3Validator.ts:105-165` ma è chiamata SOLO nei comandi `doctor` e `proxy-status`, MAI qui (**C03**)

**7. Switch al workflow** (index.ts:422-643)
- In base al comando: `send-invites` → `runSendInvitesCommand()`, `sync-search` → `runSyncSearchCommand()`, etc.

**ORDINE CORRETTO DA IMPLEMENTARE**: config → DB → **proxy check** → **CycleTLS check** → doctor (con proxy verificato) → workflow

---

### WF-ORCHESTRATOR — L'orchestrator decide SE e COME procedere

> `orchestrator.ts:326-742` — 742 righe. Letto riga per riga. Chiamato PRIMA del jobRunner.

**1. Quarantina check** (righe 332-336): `getRuntimeFlag('account_quarantine')` → se `true` → return senza fare nulla
**2. Pausa check** (righe 338-347): `getAutomationPauseState()` → se pausa attiva → log reason + return
**3. Disk space check** (righe 350-364): `checkDiskSpace()` → se critico → `pauseAutomation('DISK_SPACE_CRITICAL', 60min)` + return
**4. Working hours check** (righe 366-372): `isWorkingHour()` → se fuori orario → log + return. Orari configurabili.
- 🔴 **Non usa timezone dell'account** — usa timezone del server (**M18**)
**5. Selector failure burst** (righe 374-385): se `selector_failures` oggi >= `maxSelectorFailuresPerDay` → quarantina account
**6. Run errors burst** (righe 387-407): se `run_errors` oggi >= `maxRunErrorsPerDay` → pausa `autoPauseMinutesOnFailureBurst`
**7. Canary selector check** (righe 409-413 → `runCanaryIfNeeded()` righe 75-178):
   - Se `selectorCanaryEnabled` e workflow tocca UI (invite/message/check)
   - Cache 4h: se canary OK nelle ultime 4h → skip
   - Per ogni account: `launchBrowser()` → `checkLogin()` → check restriction indicators ("restricted", "under review", "temporarily limited", "limitato", "attività sospetta") → se trovato → `quarantineAccount('ACCOUNT_RESTRICTED')`
   - Check URL per `/checkpoint` o `/challenge` → quarantina
   - `runSelectorCanaryDetailed()` → verifica selettori CSS critici per il workflow
   - Se canary fallisce → `quarantineAccount('SELECTOR_CANARY_FAILED')`
   - ✅ Eccellente: rileva problemi PRIMA di fare azioni reali

**8. scheduleJobs()** (riga 416) — vedi **WF-SCHEDULER** sotto

**9. Compliance health guard** (righe 426-441 → `evaluateComplianceHealthGuard()` righe 180-324):
   - Solo per workflow outreach (invite/message)
   - Calcola: acceptance rate %, engagement rate %, pending ratio
   - Se `pendingRatio >= compliancePendingRatioAlertThreshold` → alert Telegram per-account e per-lista (una volta al giorno)
   - Se `healthScore < complianceHealthPauseThreshold` → `pauseAutomation('COMPLIANCE_HEALTH_LOW')`
   - 🔴 **Il pending ratio è il KPI #1 per LinkedIn** — se > 65% → red flag

**10. Predictive risk alerts** (righe 443-487):
   - Ultimi N giorni di daily stats → `evaluatePredictiveRiskAlerts()` con z-score sigma
   - Se anomalie (error rate, selector failure rate, challenge count, invite velocity) → alert Telegram
   - ✅ Rileva trend PRIMA del problema

**11. Ban probability score** (righe 492-520):
   - `estimateBanProbability()` → score 0-100 con livello LOW/MEDIUM/HIGH/CRITICAL
   - Se HIGH o CRITICAL → alert Telegram con `recommendation`

**12. AI Guardian** (righe 561-610):
   - `evaluateAiGuardian()` → AI analizza schedule snapshot e decide se procedere
   - Se `severity === 'critical'` → `pauseAutomation('AI_GUARDIAN_PREEMPTIVE')` + return
   - Se `severity === 'watch'` → log warning + prosegue

**13. Cooldown decision** (righe 612-636):
   - `evaluateCooldownDecision()` basato su risk score + pending ratio
   - Se attivato → `pauseAutomation('RISK_COOLDOWN')` con tier e minuti variabili

**14. Risk action handling** (righe 638-663):
   - STOP → quarantina (già gestito sopra)
   - WARN → log warning
   - LOW_ACTIVITY → `runRandomLinkedinActivity()` per ogni account (1-2 azioni random) per sembrare attivo senza fare outreach

**15. Session maturity guard** (righe 685-707):
   - Per ogni account: `getSessionMaturity()` → se `forceRandomActivityFirst` (cookie < 2 giorni) → `runRandomLinkedinActivity()` prima dell'outreach
   - ✅ Protegge sessioni fresche

**16. Dispatch al jobRunner** (riga 709): `runQueuedJobs()` con allowedTypes dal workflow
**17. Post-run state sync** (righe 715-738): `runSiteCheck()` per verificare che gli stati lead nel DB corrispondano alla realtà su LinkedIn
**18. Event sync** (riga 740): `runEventSyncOnce()` per sincronizzare outbox verso Supabase/webhook

---

### WF-SCHEDULER — Calcolo budget e creazione job nella coda

> `scheduler.ts:370-982` — 983 righe. Letto riga per riga. Il file che decide QUANTI job fare e PER CHI.

**FASE 1 — Calcolo budget globale** (righe 370-555):

**1. Risk assessment** (righe 376-377): `getRiskInputs()` → `evaluateRisk()` → score 0-100, action (NORMAL/LOW_ACTIVITY/WARN/STOP), pending ratio
**2. Daily/weekly stats** (righe 379-384): inviti e messaggi già inviati oggi e questa settimana
**3. Weekly invite limit** (righe 386-394): se `complianceDynamicWeeklyLimitEnabled` → limite dinamico basato su età account (ramp-up)
**4. SSI dynamic limits** (righe 395-402): se `ssiDynamicLimitsEnabled` → cap inviti/messaggi derivati dal Social Selling Index (50-100 → range cap)
**5. Per ogni account** (righe 416-472):
   - Warmup factor: se `warmupEnabled` → `calculateAccountWarmupMultiplier()` basato su età (0.0→1.0)
   - Dynamic budget: `calculateDynamicBudget(softCap, hardCap, avgDaily, riskAction)` — riduce se risk alto
   - Growth model: `applyGrowthModel()` → cap per-account basato su fase crescita (sigmoid)
   - Trust score: `calculateAccountTrustScore()` → multiplier basato su acceptance rate, challenges 7d, pending ratio, SSI
   - Budget = somma di tutti gli account
**6. Weekly cap** (righe 474-476): `inviteBudget = min(budget, weeklyRemaining)`
**7. Hour intensity** (righe 477-478): `getWorkingHourIntensity()` → riduce budget fuori orario di punta
**8. Green mode** (righe 479-482): se nella finestra green mode → ulteriore riduzione
**9. Two-session mode** (righe 484-489): se 2 sessioni/giorno → budget dimezzato per sessione
**10. Cookie maturity** (righe 492-497): `getSessionMaturity()` → sessioni 0-2gg: 30% budget. 2-7gg: 60%. 7+gg: 100% ✅
**11. Session memory** (righe 500-505): `getSessionHistory(7 giorni)` → pacing factor (dopo challenge recenti → budget ridotto)
**12. Weekly strategy** (righe 508-518): `getTodayStrategy()` → inviteFactor e messageFactor per giorno settimana (lun alto inviti, gio messaggi, etc.)
**13. 🔥 Mood factor** (righe 520-545): varianza ±20% giornaliera DETERMINISTICA (hash FNV-1a della data)
   - Volume complessivo: `moodFactor = 0.80-1.20`
   - Sbilancio invite/message: `ratioShift = -0.15 to +0.15` → oggi "giornata inviti", domani "giornata messaggi"
   - ✅ Eccellente anti-pattern: ogni giorno volume e mix diversi, ma media settimanale stabile
**14. Session limit override** (righe 548-551): se `--limit N` dal CLI → cap budget

**FASE 2 — Enqueue job per lista** (righe 559-964):

**15. Promote NEW → READY_INVITE** (righe 623-629): `promoteNewLeadsToReadyInvite()` — massimo 4× hardInviteCap lead promossi
**16. Per ogni lista attiva** — INVITI (righe 631-756):
   - **Circuit breaker per lista** (righe 641-648): se `cb::list::X` flag nel DB e non scaduto → skip lista intera
   - **List budget** (righe 650-665): `computeListBudget()` → min(global remaining, list daily cap - already sent) × `adaptiveFactor` × `listPerformanceMultiplier`
   - **Adaptive factor** (righe 591-602): basato su pending ratio e blocked ratio della lista
   - **Performance multiplier** (riga 662): `computeListPerformanceMultiplier()` → liste con bassa acceptance → budget ridotto
   - **Per ogni lead READY_INVITE**:
     - Blacklist check (riga 697): `isBlacklisted(linkedin_url, company_domain)`
     - Account assignment (riga 700): `pickAccountIdForLead()` → bilanciamento tra account
     - Multi-account deconfliction (righe 707-712): `hasOtherAccountTargeted()` → skip se un altro account ha targettizzato lo stesso lead negli ultimi 30gg
     - NoBurst delay (riga 714): delay incrementale tra job per evitare burst
     - Timing optimizer (riga 715): `getTimingDecisionForLead('invite', jobTitle)` → delay basato su timezone, giorno, orario
     - Timezone delay (riga 716): `computeTimezoneDelaySec(lead.location)` → invio nell'orario lavorativo del lead
     - `enqueueJob('INVITE', payload, key, priority=10, maxAttempts, delaySec, accountId)`
**17. Per ogni lista — ACCEPTANCE CHECK** (righe 758-791):
   - Tutti i lead INVITED → `enqueueJob('ACCEPTANCE_CHECK', payload, priority=30)`
   - 🔴 **NESSUN filtro per età invito** — controlla lead invitati anche 1h fa (**H13**)
**18. Per ogni lista — MESSAGGI** (righe 793-908):
   - Promuove ACCEPTED → READY_MESSAGE (riga 837)
   - Per ogni lead READY_MESSAGE: blacklist check, account assignment, acceptance delay (min-max hours configurabili), timing optimizer, `enqueueJob('MESSAGE')`
**19. HYGIENE job** (righe 911-924): `enqueueJob('HYGIENE')` per ogni account — pulizia inviti vecchi
**20. POST CREATION** (righe 927-946): se `postCreationEnabled` e max non raggiunto → `enqueueJob('POST_CREATION')` con delay 1-3h
**21. ENRICHMENT** (righe 949-964): lead che necessitano enrichment → `enqueueJob('ENRICHMENT')` con delay 5min-1h

**Scenario mancante scoperto leggendo il codice**:
- 🔴 **Budget calcolato UNA VOLTA** all'inizio della sessione. Se durante la sessione il risk score sale (challenge), i job già in coda usano il budget vecchio (**H24**). Il throttler HTTP adatta il DELAY ma non il BUDGET.
- 🔴 L'acceptance check non filtra per età invito — enqueue TUTTI i lead INVITED (**H13**)

---

### WF-SESSION — Il JobRunner apre il browser e prepara la sessione

> Questo avviene per TUTTI i workflow che usano il browser (invites, messages, check, sync).
> `jobRunner.ts:161-1031` — il file più complesso del sistema.

**1. Launch browser** (jobRunner.ts:176-181 → browser/launcher.ts)
- `launchBrowser()` con: sessionDir (profilo persistente), proxy binding, `forceDesktop: true`
- Playwright apre Firefox/Chromium con profilo dalla session directory (cookie, localStorage persistiti)
- Stealth scripts iniettati: 19 sezioni anti-detection (navigator, webdriver, canvas, WebGL, fonts, etc.)
- Fingerprint selezionato deterministicamente per `accountId + weekNumber` dal pool di 14 (**M27**: pool piccolo)
- ⚠️ Tutti i fingerprint hanno `locale: 'it-IT'` hardcoded (**M28**)

**2. Check login** (jobRunner.ts:184-191 → browser/auth.ts)
- `checkLogin()`: verifica presenza navbar LinkedIn (`globalNav` selector)
- Se non loggato → `quarantineAccount('LOGIN_MISSING')` → return (sessione abortita)
- 🔴 Se TOTP fallisce → nessun timeout, nessun alert, bot si blocca (**H01**)

**3. Session freshness** (jobRunner.ts:193-211 → sessionCookieMonitor.ts)
- `checkSessionFreshness()`: se cookie più vecchio di `sessionCookieMaxAgeDays` → pausa 60min + alert
- ✅ OK: protegge da cookie stale

**4. Blocco input utente** (jobRunner.ts:218-219)
- `enableWindowClickThrough()` + `blockUserInput()`: overlay trasparente che cattura i click dell'utente
- Previene click accidentali durante l'automazione. Re-iniettato dopo ogni `page.goto()`
- ✅ OK

**5. Cookie anomaly detection** (jobRunner.ts:224-238)
- `detectSessionCookieAnomaly()`: il cookie `li_at` è cambiato o scomparso?
- COOKIE_MISSING → quarantina + alert Telegram critico
- COOKIE_CHANGED → alert warning ma **continua** ⚠️ (**M24**: dovrebbe fermare il workflow)

**6. Probe LinkedIn** (jobRunner.ts:243-279)
- `probeLinkedInStatus()`: navigazione leggera per verificare stato LinkedIn
- HTTP 429 → pausa automatica. SESSION_EXPIRED → quarantina. Challenge → handleChallengeDetected.
- SLOW_RESPONSE → warning ma prosegue con cautela
- ✅ OK: eccellente pre-check

**7. Session warmup** (jobRunner.ts:285-297 → sessionWarmer.ts:67-120)
- Feed scroll (90%), notifiche (70%), messaging check (50%), search random (30%), profile visit random (20%)
- Due modalità: full warmup o reduced (solo feed) se nella "gap" tra sessioni
- 🔴 Non controlla tempo dall'ultima sessione. Se login 5 min fa → rifà tutto (**H25**)
- Se fallisce → non bloccante, prosegue

**8. Pre-batch setup** (jobRunner.ts:300-371)
- Reset proxy failure counter. Proxy quality check (non bloccante).
- `getSessionHistory()` → pacing factor (dopo challenge recenti → delay più lunghi)
- `getBehavioralProfile()` → abitudini uniche per account (scroll speed, click delay, warmup order)
- 🔴 `applyProfileDrift()` aggiunge ±5% ad OGNI lettura → drift accumula con riavvii (**C12**)
- Session max jobs/time jitterati per evitare pattern fissi. Wind-down threshold calcolato.
- Backpressure level caricato da DB → batch size adattivo

**9. Main loop** (jobRunner.ts:373-946) — PER OGNI JOB:
- **Check fairness quota**: se `processedThisRun >= maxJobsPerRun` → break
- **Check pausa**: `getAutomationPauseState()` → se pausa attiva → break
- **Wind-down detection**: ultimo X% sessione → `windDownActive = true` → delay più lunghi
- **HTTP throttle**: `session.httpThrottler.getThrottleSignal()`
  - `shouldPause` → pausa 15min + break
  - `shouldSlow` → extra delay 3-8s. Se 3+ slow consecutivi → **abort sessione** + batch -30%
- **Lock job**: `lockNextQueuedJob()` — SELECT con `FOR UPDATE SKIP LOCKED` (PostgreSQL) o transazione (SQLite)
  - Ordine: priorità ASC, poi `next_run_at + random jitter` (anti-pattern burst)
- **Decoy burst**: ogni N job (jitterato 15-22) → `performDecoyBurst()` (random like, profile visit)
  - 🔴 Decoy non coerenti con settore target (**M15-M16**)
- **Dispatch al worker**: `workerRegistry.get(job.type).process(job, context)`
- **Post-job**: `markJobSucceeded()`, `pushOutboxEvent()`, `advanceLeadCampaign()` se drip
- **Inter-job delay**: `interJobDelay()` (adattivo con throttle signal + pacing factor) IN PARALLELO con `enrichLeadsParallel(limit: 2)` — sfrutta il delay per enrichment zero-LinkedIn
- **Coffee break**: ogni N job (jitterato) → pausa 60-180s
- **Session rotation**: ogni N job O N minuti → chiude browser, riapre con nuovo fingerprint
- **Browser GC**: ogni 10 job → `performBrowserGC()` per prevenire memory leak

**10. Error handling nel loop** (jobRunner.ts:601-856):
- `ChallengeDetectedError` → incrementa challenges, `handleChallengeDetected()`, break sessione
- `ProxyConnectionError` → counter cross-ciclo in runtime_flags. 3 failure → pausa 7gg + alert Telegram critico "cambia proxy"
- `WEEKLY_LIMIT_REACHED` → quarantina account
- Retry generico: `resolveWorkerRetryPolicy()` → exponential backoff + jitter → `markJobRetryOrDeadLetter()`
- Dead letter → lead → `REVIEW_REQUIRED` + circuit breaker per lista (3 DL = lista sospesa 4h)
- N failure consecutive → session rotation forzata → pausa `autoPauseMinutesOnFailureBurst`

---

### WF-SYNC — Sync-Search: trovo i lead su SalesNav

> `bulkSaveOrchestrator.ts` — 2834 righe. Il workflow più complesso del sistema.

**FASE PRE-SYNC — Scarico i membri attuali della lista** (riga 1704-1995)

**1. Navigazione a Sales Navigator** (riga 1717)
- `page.goto('https://www.linkedin.com/sales/home')` — goto diretto (**M04**)
- Se non loggato → `waitForManualLogin()`: rimuove overlay, aspetta max 3 minuti, poll ogni 5s
- Controlla se su SalesNav: `page.url().includes('/sales/')`

**2. Navigazione alle Lead Lists** (riga 1739)
- `page.goto('/sales/lists/people/')` — di nuovo goto diretto
- Se redirect a `/sales/login` → aspetta login manuale → ri-naviga
- 🔴 Nessun check abbonamento SalesNav. Se scaduto → errore generico (**M05**)
- `waitForSelector('a[href*="/sales/lists/people/"]')` con timeout 20s

**3. Trova e clicca la lista target** (righe 1768-1855)
- **Strategia 1 — DOM locator**: cerca `<a href="/sales/lists/people/">` che contiene il nome della lista. Prova nome completo, poi troncato a 25 char, poi 15 char. Click con `force: true`.
- **Strategia 2 — Coordinate DOM**: `page.evaluate()` per trovare coordinate del link e `smartClick()` (mouse Bezier).
- **Strategia 3 — Computer Use** (Claude): se DOM fallisce e OpenAI key presente, AI clicca sulla lista.
- Se nessuna strategia funziona → warning "dedup basato solo su dati DB"
- Dopo click: check se redirect a login → se sì, aspetta login manuale e riprova

**4. Scraping tutti i membri pagina per pagina** (righe 1929-1987)
- Per ogni pagina (max 200 pagine = 5000 lead):
  - `scrollAndReadPage(page)` — scroll umano per caricare lazy content
  - `extractProfileUrlsFromPage()` — valuta `page.evaluate()` per estrarre dati da ogni card:
    - Cerca `a[href*="/sales/lead/"]` o `a[href*="/sales/people/"]`
    - Per ogni link: risale al container card, estrae nome, firstName, lastName, company, title, location
    - Se selettori specifici falliscono → fallback testuale: splitta `innerText` della card per `" at "` / `" presso "`
    - Cerca anche link LinkedIn classico `a[href*="linkedin.com/in/"]`
  - `saveExtractedProfiles()` — INSERT OR IGNORE nel DB. Se profilo già esiste, UPDATE campi NULL con COALESCE.
  - 🔴 **NESSUN check età ultimo pre-sync**. Se DB aggiornato 5 min fa → rifa tutto (**H03**)
  - 🔴 Dedup fa 3 query per profilo: LinkedIn URL, SalesNav URL, name+company hash = **75 query/pagina** (**H05**)
  - Paginazione: `hasNextPage()` → `clickNextPage()` (scroll bottone nel viewport → smartClick o visionClick)
  - `clickNextPage()` verifica che la pagina sia cambiata dopo il click (readPaginationInfo prima/dopo)

**FASE RICERCHE — Naviga alle ricerche salvate e processa** (riga 1997-2833)

**5. Cleanup zombie runs** (riga 2003-2013)
- `UPDATE salesnav_sync_runs SET status='FAILED' WHERE status='RUNNING' AND updated_at < 30 min ago`

**6. Navigazione a ricerche salvate** (riga 2053)
- `navigateToSavedSearches()` → va a `/sales/search/saved-searches`
- `extractSavedSearches()` → trova tutti i bottoni "View"/"Visualizza" sulla pagina
- Match ricerca per nome: esatto → contiene → contenuto in → split per virgola → fuzzy
- Se `--resume`: carica `getResumableSyncRun()` dal DB per riprendere dalla posizione salvata

**7. Per ogni ricerca salvata** (riga 2243+):
- `clickSavedSearchView()` → click sul bottone View della ricerca
- Legge `readPaginationInfo()` (DOM) o `visionReadTotalResults()` (AI) per conteggio totale risultati
- Se resume: `restoreSearchPagePosition()` → clicca Next N volte per arrivare alla pagina giusta

**8. Per ogni pagina della ricerca** (riga 2385+):

  **8a. AI health check** (ogni 8 pagine):
  - DOM-first: controlla testi sospetti ("unusual activity", "restricted", "too fast", "captcha")
  - Se trovato → conferma con Vision AI → se WARNING → pausa 8-15s + `ensureNoChallenge()`
  - Circuit breaker: dopo 2 fallimenti AI consecutivi → disabilita per la sessione

  **8b. Legge paginazione** (riga 2430):
  - 3 strategie: artdeco pagination DOM → "Page X of Y" text → "X-Y of Z results" text

  **8c. Scroll e raccolta profili** (riga 2438 → `scrollAndReadPage(page, fast=true)`):
  - **Mouse**: posiziona cursore con Bezier al centro area risultati (60% width, 40% height)
  - **Scroll fast mode**: per ogni step (max 40):
    - Burst 2-4 scroll piccoli (120-180px — ~1 card) → evita che il virtual scroller distrugga card
    - Dopo ogni micro-scroll: `waitForFunction()` con timeout 1500ms che aspetta nuove card nel DOM
    - 🔴 Se proxy aggiunge latenza → timeout scatta prima del rendering → lead persi (**H04**)
    - `collectVisibleLeads()` dopo ogni scroll: `page.evaluate()` raccoglie `leadId, firstName, lastName, linkedinUrl, title, company, location` in una Map lato Node
    - Early exit: se `countAfter >= 25` → stop (tutti i lead della pagina raccolti)
    - Safety: se `noNewLeadsCount >= 10` → stop (fondo raggiunto o rendering bloccato)
  - Torna in cima: `scrollTop = 0` se container trovato, altrimenti `mouse.wheel(0, -800)` × 12
  - Warning se < 15 lead trovati dopo scroll completo

  **8d. Estrazione profili** (riga 2470):
  - Se scroll ha raccolto >= 15 profili → usa quelli (più affidabili — raccolti card per card)
  - Altrimenti → fallback a `extractProfileUrlsFromPage()` (post-scroll-to-top, meno affidabile)
  - Warning se discrepanza > 40% tra scroll count e extract count

  **8e. Dedup** (riga 2501):
  - `checkDuplicates()`: per ogni profilo → 3 query DB (LinkedIn URL, SalesNav URL, name+company hash)
  - Se tutti già nel DB → pagina SKIPPATA. Contatore `consecutiveAllDuplicatePages` incrementa.
  - 🔴 Early-stop dopo 3 pagine duplicate consecutive → potrebbe fermarsi troppo presto (**M03**)

  **8f. Se ci sono lead nuovi → SALVA** (riga 2594):
  - `processSearchPage()` con 3 tentativi (backoff esponenziale 1-2s → 3-5s → reload + 3-5s):
    1. `clickSelectAll()` — cerca checkbox "Select all" con 12 selettori diversi (DOM + Vision AI fallback)
       - 🔴 Non verifica QUANTI lead sono stati selezionati (**H06**)
    2. `openSaveToListDialog()` — clicca "Save to list" (11 selettori + Vision fallback)
       - 🔴 Se Ollama/OpenAI è giù → Vision fallback non funziona (**H07**)
    3. `chooseTargetList()` — nel dialog modale, trova e clicca la lista target
       - Prima sessione: digita nome lista nel campo ricerca
       - Sessioni successive: click diretto (cache `_bulkSaveListFoundInSession`)
    4. `verifyToast()` — verifica toast "Salvato nell'elenco X"
       - 🔴 Word overlap: verifica ≥2 parole, non nome completo (**M02**)
    5. 🔴 **NESSUN check limite 2500** — se lista piena → save fallisce silenziosamente (**C08**)
  - `saveExtractedProfiles()` → INSERT nel DB con runId, searchIndex, pageNumber
  - 🔴 Nessuna transazione per pagina → crash a metà = dati parziali (**M08**)
  - `addSyncItem()` + `updateSyncRunProgress()` → tracking nel DB per resume

  **8g. Anti-detection noise** (riga 2652):
  - `runAntiDetectionNoise()`: mouse move 20%, micro-pausa 5%, hover su profilo (ogni ~15-22 pagine), delay casuale 2-5s (ogni ~8-13 pagine)
  - Soglie jitterate ad ogni trigger → anti-pattern fisso

  **8h. Prossima pagina** (riga 2663):
  - `clickNextPage()`: scroll bottone Next nel viewport → smartClick (coordinate Bezier) o safeVisionClick
  - Verifica pagina cambiata (readPaginationInfo prima/dopo). Se non cambiata → retry con `click({force: true})`
  - `waitForSelector('a[href*="/sales/lead/"]')` con timeout 8s per aspettare card

---

### WF-INVITE — Send-Invites: invito i lead (per ogni singolo lead)

> `inviteWorker.ts:235-559` — 560 righe.

**1. Carica lead dal DB** (riga 239): `getLeadById(payload.leadId)`
**2. Check blacklist runtime** (riga 246): il lead potrebbe essere stato aggiunto DOPO la creazione del job
**3. Check status** (riga 250-258): se NEW → promuovi a READY_INVITE. Se non READY_INVITE e non campaign-driven → skip
**4. 🔴 Check SalesNav URL** (riga 278-281): `if (isSalesNavigatorUrl) → transitionLead(BLOCKED)` — dead-end permanente (**C10**)
**5. Enrichment nel worker** (righe 283-314): chiama `enrichLeadAuto()` con 8 API esterne DURANTE la sessione browser (**H08**)
**6. Skip profili già visitati oggi** (righe 317-321): Set in-memory di URL normalizzate
**7. Navigazione al profilo** (righe 325-330): `navigateToProfileWithContext()` con solo 4 argomenti → **sessionInviteCount default 0 → decay MAI attivo** (**C05**). La funzione fa: 45% search organica (ma poi goto diretto al profilo — **H02**), 25% feed organica, 30% goto diretto.
**8. Profile dwell time** (riga 334): `computeProfileDwellTime()` — scroll proporzionale a ricchezza profilo (4-20s) ✅
**9. 20% visita attività recente** (righe 339-346): `Math.random() < 0.20` → goto a `/recent-activity/all/` → `simulateHumanReading()` → **goto DIRETTO per tornare** (vanifica navigation context) (**M10**)
**10. Challenge detection** (righe 348-353): `detectChallenge()` → `attemptChallengeResolution()` → se non risolto → `ChallengeDetectedError`
**11. 🔴 NESSUNA verifica identità** — il codice passa direttamente al cap check senza mai leggere `h1` della pagina (**C04**)
**12. Cap check atomico** (righe 388-394): `checkAndIncrementDailyLimit('invites_sent', hardInviteCap)` — PRIMA del click ✅
**13. Weekly limit check** (righe 401-417): `detectWeeklyInviteLimit()` nel DOM → se raggiunto → pausa 7gg ✅
**14. Session validity check** (righe 422-430): `isLoggedIn()` — se cookie scaduto mid-session → abort ✅
**15. Dismiss overlay** (riga 433) + **Viewport dwell** (riga 437): assicura bottone Connect visibile da 800-2000ms prima del click ✅
**16. Click Connect** (riga 439): `clickConnectOnProfile()` — cerca bottone primario (4 selettori), se non trovato → "More actions" → "Connect" nel menu dropdown. Confidence check: verifica che il testo contenga "Connect"/"Collegati" ✅
**17. Post-click: modale apparso?** (righe 452-457): `isVisible({timeout: 3000})` del modale. 🔴 Se non appare → logga e basta, NON si ferma (**H09**)
**18. Handle modale invito** (righe 459-466 → `handleInviteModal()` righe 125-233):
- Se `wantsNote && canAddNote`: click "Add a note" → genera nota AI (`buildPersonalizedInviteNote()` con A/B bandit Thompson sampling)
- 🔴 Se nota vuota (AI down, timeout, template vuoto) → Escape → invia senza nota, ma NON logga PERCHÉ (**M09**)
- 🔴 Non verifica lunghezza nota < 300 char (**M39**)
- `humanType()` nel textarea → click "Send" nel modale (4 selettori + fallback)
- Se `!wantsNote` o `!canAddNote`: click "Send without a note" (5 selettori + fallback)
**19. Post-click: weekly limit?** (righe 469-484): ri-check dopo l'invio per catturare limite raggiunto
**20. Post-action verify** (righe 486-511): delay 2-5s → `detectInviteProof()` (cerca "Pending"/"In attesa"). Se non confermato → check DB per evitare duplicato → se non INVITED → `RetryableWorkerError` ✅
**21. Compensazione phantom increment** (righe 513-517): se errore dopo `checkAndIncrementDailyLimit` → `incrementDailyStat('invites_sent', -1)` ✅
**22. Transition + tracking** (righe 523-558): `transitionLead(INVITED)` → `recordLeadTimingAttribution()` → `recordSent()` per A/B bandit → `bridgeLeadStatus()` cloud sync

---

### WF-MESSAGE — Send-Messages (per ogni singolo lead)

> `messageWorker.ts:41-275` — 275 righe.

**1. Carica lead** (riga 45) + **check blacklist** (riga 54) + **check SalesNav URL** (riga 58-61): 🔴 BLOCKED permanente (**C10**)
**2. Pre-flight cap check** (righe 63-70): `getDailyStat('messages_sent')` — se >= cap → return senza navigare ✅
**3. Cerca messaggio pre-built** (righe 100-107): `getUnusedPrebuiltMessage()` → se esiste → zero latenza AI ✅
**4. Fallback AI on-the-fly** (righe 108-115): `buildPersonalizedFollowUpMessage()` → prompt con dati lead → retry 3x con temperatura crescente (0.6→0.75→0.9) → semantic similarity check (threshold 0.85) → max chars
**5. Validazione** (righe 118-132): `validateMessageContent()` — lunghezza, caratteri proibiti, hash dedup last 24h. 🔴 Solo hash esatto (**M11**)
**6. Navigazione al profilo** (righe 136-140): `navigateToProfileForMessage()` — 60% feed→notifiche→profilo, 40% diretto
**7. Human reading simulation** (righe 141-143): `humanDelay(2.5-5s)` → `simulateHumanReading()` → `contextualReadingPause()`
**8. Challenge detection** (righe 145-150) + **Session validity check** (righe 155-163)
**9. 🔴 NON CONTROLLA SE IL LEAD HA GIÀ SCRITTO** — va diretto a cliccare Message (**C07**)
**10. Dismiss overlay + viewport dwell** (righe 166-170)
**11. Confidence check bottone Message** (righe 173-187): verifica testo contiene "Message"/"Messaggio"/"Invia" ✅
**12. Click Message** (righe 189-201): `humanMouseMove()` → `clickWithFallback()` con 5 selettori → `waitForSelector('messageTextbox')` timeout 2.5s
**13. Type messaggio** (righe 204-209): `typeWithFallback()` con delay umano tra caratteri
- 🔴 Non verifica che il testo sia apparso nel campo dopo il typing (**H11**)
- 🔴 Se c'era un draft LinkedIn → testo concatenato (**M12**)
**14. Cap check atomico + Send** (righe 212-241): `checkAndIncrementDailyLimit('messages_sent')` → click Send con `clickWithFallback()`. Se fallisce → compensazione -1.
- 🔴 Cap check DOPO il typing — tutto il lavoro sprecato se cap raggiunto (**H10**, parzialmente mitigato dal pre-flight read-only)
**15. Transition + tracking** (righe 243-273): `transitionLead(MESSAGED)` → `storeMessageHash()` → cloud sync

---

### WF-CHECK — Acceptance Check (per ogni singolo lead INVITED)

> `acceptanceWorker.ts:52-128` — 128 righe. Letto riga per riga.

**1. Carica lead dal DB** (riga 56): `getLeadById(payload.leadId)`. Se non esiste o `status !== 'INVITED'` → skip (return 0)
**2. 🔴 Check SalesNav URL** (riga 61-63): `if (isSalesNavigatorUrl) → transitionLead(BLOCKED)` — dead-end permanente (**C10**)
**3. Navigazione al profilo** (riga 66): `navigateToProfileForCheck()` — catena context simile a message
**4. Delay umano** (riga 67-68): `humanDelay(2000-4000ms)` + `contextualReadingPause()`
**5. Challenge detection** (righe 70-75): come negli altri worker
**6. Lettura stato profilo** (righe 77-85) — il bot controlla 4 cose nel DOM:
   - `invitePendingIndicators` → cerca "Pending"/"In attesa" (4 selettori)
   - `connectButtonPrimary` → cerca bottone "Connect"/"Collegati" (4 selettori) — se presente = invito ritirato/rifiutato
   - `distanceBadge` → cerca "1st"/"1°" (4 selettori)
   - `messageButton` → cerca bottone "Message"/"Messaggio" (5 selettori)
   - Calcola `connectedWithoutBadge = !pendingInvite && !canConnect && hasMessageButton`
**7. Decisione accettazione** (righe 88-106):
   - Se badge "1st" → `accepted = true` ✅
   - Se "Pending" → `accepted = false` (ancora in attesa)
   - Se "Connect" presente → `accepted = false` (invito ritirato o rifiutato)
   - Se `connectedWithoutBadge` (ha bottone Messaggio ma no badge 1st e no Pending):
     - 🔴 Chiama `checkSentInvitations()` (righe 21-50) → **naviga a `/mynetwork/invitation-manager/sent/`** (**H12**)
     - Scrolla 3 volte con `window.scrollTo(0, document.body.scrollHeight)` + click "Show More" se visibile
     - Deadline 15s. Per ogni scroll: raccoglie tutti i link `/in/` e confronta con lead URL
     - Se il lead NON è nella lista inviti inviati → `accepted = true` (optimistic)
     - Se errore/timeout → `catch(() => false)` → assume NON più pending → `accepted = true` (optimistic)
     - 🔴 **Dopo questo goto, siamo nell'invitation manager, NON sul profilo del lead. Il navigation context è rotto.** (**H12**)
   - 🔴 **Nessun check per profilo eliminato** → "This page doesn't exist" → nessuno dei 4 selettori trovato → `accepted = false` → `RetryableWorkerError('ACCEPTANCE_PENDING')` → retry 3x → dead letter (**M13**)
   - 🔴 **Nessun filtro per età invito** nella query del scheduler — controlla lead invitati anche 1h fa (**H13**)
**8. Se accettato** (righe 112-126):
   - `transitionLeadAtomic()`: INVITED → ACCEPTED → READY_MESSAGE in una transazione ✅
   - `incrementDailyStat('acceptances')` ✅
   - A/B Bandit: `recordOutcome(variant, 'accepted')` per tracciare quale variante nota ha funzionato ✅
   - Cloud sync: `bridgeLeadStatus('READY_MESSAGE')` ✅
**9. Se NON accettato** (riga 108-109):
   - `throw new RetryableWorkerError('ACCEPTANCE_PENDING')` → il jobRunner NON lo conta come failure (check speciale `isAcceptancePending`)

---

### WF-FOLLOWUP — Follow-up: ricontatto chi non ha risposto (stessa sessione del jobRunner)

> `followUpWorker.ts:199-283` (runner) + `93-190` (singolo follow-up) — 355 righe totali. Letto riga per riga.

**1. Calcolo budget** (righe 200-215): `dailyCap - dailySentSoFar`. Se <= 0 → return
**2. Query lead eligibili** (riga 220): `getLeadsForFollowUp(delayDays, maxFollowUp, remaining)`
   - 🔴 Query: `WHERE status='MESSAGED' AND follow_up_count < MAX`. **NON controlla se il lead ha risposto.** (**C06**)
   - 🔴 **NON controlla se la campagna drip è ancora attiva.** (**H14**)

**3. Per ogni lead** (righe 231-279):
   - **Carica intent hint** (riga 235): `getLeadIntent(lead.id)` → intent, subIntent, confidence, entities dal DB
   - **Calcola cadenza** (riga 236): `resolveFollowUpCadence()` (righe 325-354):
     - `resolveIntentBaseDelayDays()` → 5 config diversi: default, questions, negative, not_interested, objection_handling
     - `escalationMultiplier = 1 + followUpCount × config.followUpDelayEscalationFactor`
     - `deterministicGaussian()` → hash FNV-1a del `leadId|followUpCount|intent|subIntent` → Box-Muller transform → jitter gaussiano ±2.5σ
     - `requiredDelayDays = max(1, escalatedDelay + jitterDays)`
     - Reference: `follow_up_sent_at` (ultimo follow-up) o `messaged_at` (primo messaggio)
     - 🔴 **Impossibile da debuggare**: il cliente chiede "perché Mario non ha ricevuto il follow-up?" e servono 20 min di calcolo (**M29**)
   - Se `referenceDaysSince < requiredDelayDays` → skip con log dettagliato (reason, jitter, delay)

   **4. Invio singolo follow-up** (`processSingleFollowUp()` righe 93-190):
   - **Genera messaggio** (riga 102): `buildFollowUpReminderMessage(lead, days, { intent, subIntent, entities })`
   - **Validazione** (righe 108-115): `hashMessage()` + `countRecentMessageHash(48h)` + `validateMessageContent()`
   - **🔴 Navigazione** (riga 118): `page.goto(linkedinUrl, { waitUntil: 'domcontentloaded' })` — **GOTO DIRETTO. Zero navigation context.** L'inviteWorker usa `navigateToProfileWithContext()`, il messageWorker usa `navigateToProfileForMessage()`. Il followUpWorker usa un nudo `page.goto()`. (**C11**)
   - **Reading simulation** (righe 119-121): `humanDelay(2.5-5s)` + `simulateHumanReading()` + `contextualReadingPause()`
   - **Challenge detection** (righe 123-125)
   - **🔴 NON controlla se il lead ha già scritto nella chat** — va diretto a cliccare Message (**C06**)
   - **Dismiss overlay** (riga 128) + **Click Message** (righe 131-146): `humanMouseMove()` → `clickWithFallback(SELECTORS.messageButton)` con verify: aspetta `messageTextbox` timeout 2.5s
   - **Type messaggio** (righe 149-155): `typeWithFallback(SELECTORS.messageTextbox, message)` + `humanDelay(800-1600ms)`
   - **Cap check atomico + Send** (righe 157-183): `checkAndIncrementDailyLimit('follow_ups_sent', cap)` → click `messageSendButton` → `recordFollowUpSent()` → `storeMessageHash()`
   - **Pausa umana tra profili** (riga 278): `humanDelay(4000-8000ms)`

---

### WF-INBOX — Inbox Check: leggo le risposte (per ogni conversazione non letta)

> `inboxWorker.ts:78-314` — 314 righe. Letto riga per riga.

**1. 🔴 NON nel workerRegistry** — deve essere configurato e lanciato separatamente (**C09**)
**2. Navigazione inbox** (riga 86): `page.goto('https://www.linkedin.com/messaging/')` + `simulateHumanReading()`
**3. Attesa caricamento** (righe 90-98): `waitForSelector('inboxConversationItem')` timeout 10s. Se timeout → "Nessuna conversazione" → return
**4. ✅ Anti-ban: rilevamento warning LinkedIn** (righe 100-132):
   - Scrolla le prime 8 conversazioni e legge il preview text
   - Cerca keywords: "unusual activity", "restricted", "verify your identity", "temporarily limited", "attività insolita", "account limitato", "verifica la tua identità"
   - Se trovato AND contiene "linkedin" o "security" → `pauseAutomation('LINKEDIN_INBOX_WARNING', 1440min)` + alert Telegram critico
   - **Eccellente feature di sicurezza** ✅
**5. Filtra conversazioni non lette** (riga 134): `inboxConversationItem:has(inboxUnreadBadge)`
**6. Loop: max 5 conversazioni** (riga 145): `for i < Math.min(count, 5)`
   - 🔴 **Hardcoded a 5** — se 20 messaggi non letti, 15 vengono ignorati (**H26**)
**7. 30% defer probabilistico** (riga 148): `if (Math.random() < 0.30)` → skip + log "deferred"
   - 🔴 **Nessun tracking**: la conversazione skippata non viene marcata. Al prossimo run, potrebbe uscire dalla top 5 non lette e non essere MAI processata (**H26**)
**8. Click sulla conversazione** (righe 153-158): `humanMouseMove()` → `humanDelay(200-600ms)` → `convo.click()` → `humanDelay(1500-3000ms)`
**9. Estrazione ultimo messaggio** (righe 161-168):
   - Selettore: `.msg-s-message-list__event:not([data-msg-s-message-event-is-me="true"]) .msg-s-event-listitem__body` → `.last()`
   - 🔴 **Solo l'ultimo messaggio** — se il lead ha scritto 3 messaggi, i primi 2 sono ignorati (**H27**)
   - 🔴 **Non distingue messaggi di sistema** (es. "Mario Rossi ha accettato il tuo invito") da messaggi reali del lead
**10. Simulazione lettura** (riga 171): `simulateConversationReading()` — delay basato su word count (185 WPM) + 60% probabilità scroll 180px nel container
**11. Analisi intent AI** (riga 174): `resolveIntentAndDraft(rawText)` → intent (POSITIVE/NEGATIVE/QUESTIONS/NOT_INTERESTED), subIntent, confidence, entities, responseDraft
**12. Matching lead nel DB** (righe 175-181): `extractParticipantProfileUrl()` (5 selettori per trovare link `/in/` nella chat) → `getLeadByLinkedinUrl()`
**13. Se lead trovato** (righe 182-283):
   - `storeLeadIntent()` nel DB con intent, subIntent, confidence, rawText, entities
   - Se `lead.status === 'MESSAGED'` → `transitionLead('REPLIED', 'inbox_reply_detected')` + `recordOutcome()` per A/B bandit ✅
   - **Auto-reply** (righe 209-251): se `inboxAutoReplyEnabled && confidence >= minConfidence && intent !== NOT_INTERESTED/NEGATIVE && !duplicate`:
     - `typeWithFallback(SELECTORS.messageTextbox, responseDraft)` → `clickWithFallback(SELECTORS.messageSendButton)`
     - 🔴 Cap solo per run (`inboxAutoReplyMaxPerRun`), **nessun cap giornaliero globale** (**M30**)
     - Anti-duplicate: `countRecentMessageHash(replyHash, 24)` — se già inviato nelle ultime 24h → skip ✅
   - `appendLeadReplyDraft()` nel DB con draft, confidence, source, intent, reasoning, autoReplySent
   - **🔥 Hot lead alert** (righe 267-282): se intent POSITIVE o QUESTIONS con confidence >= 0.8 → alert Telegram immediato con nome, azienda, email, messaggio ✅
**14. Delay tra conversazioni** (riga 309): `humanDelay(1000-2000ms)`

---

### WF-SHUTDOWN — Chiusura sessione (jobRunner.ts:992-1031)

> Letto dal codice reale di jobRunner.ts.

**1. Wind-down** (righe 996-1003):
   - `if (Math.random() < 0.30)` → `page.goto('/feed/')` + `waitForTimeout(2000-5000ms)`
   - 🔴 **70% delle volte il browser si chiude direttamente** dalla pagina di lavoro (profilo, SalesNav, messaggi). Un umano torna al feed prima di chiudere. (**H15**)
   - Wrapped in try/catch → se la page non risponde, si salta (best-effort)
**2. Sblocca input utente** (riga 1005): `disableWindowClickThrough(session.browser)` ✅
**3. Close browser** (riga 1006): `closeBrowser(session)`
   - 🔴 Non sempre chiude `page` prima di `browser` su tutti i percorsi → possibile memory leak Playwright (**H19**)
   - 🔴 Se crash durante `humanType()` → LinkedIn salva draft fantasma (**H16**)
**4. Persist account health** (riga 1008): `persistAccountHealth()` → `recordAccountHealthSnapshot()` nel DB
   - Calcola health: GREEN/YELLOW/RED basato su failure rate e challenges
   - Se non GREEN e `processed >= minProcessed` → alert Telegram ✅
   - `.catch(() => null)` — non bloccante
**5. Update backpressure** (righe 1009-1013): `updateAccountBackpressure()` con sent, failed, permanentFailures
   - Il livello backpressure viene persistito nel DB e usato al prossimo ciclo ✅
   - `.catch(() => null)` — non bloccante
**6. Record session pattern** (righe 1018-1029): `recordSessionPattern()` con loginHour, logoutHour, totalActions, inviteCount, messageCount, checkCount, challenges
   - Questo alimenta `getSessionHistory()` per il pacing factor del prossimo ciclo
   - 🔴 `.catch(() => null)` — **fire-and-forget**. Se fallisce, il pacing factor del prossimo ciclo è sbagliato (**A12**)
   - Solo se `!dryRun && processed > 0` (non registra sessioni vuote)

---

## 🧠 ANALISI ASTRATTA — Ragionamento umano sul flusso dei workflow

> Questa sezione NON guarda il codice. Ragiona come un utente/business owner:
> cosa DOVREBBE succedere in ogni fase? Poi verifica se il codice lo implementa.
> Ogni gap tra "dovrebbe" e "fa" è un problema reale.

### Il ciclo di vita di un lead — cosa DOVREBBE succedere

```
SCOPERTA → QUALIFICAZIONE → PRIMO CONTATTO → ATTESA → VERIFICA → CONVERSAZIONE → FOLLOW-UP → CHIUSURA
```

**1. SCOPERTA**: Trovo persone rilevanti su SalesNav. Le salvo in una lista.
- **Dovrebbe**: cercare nelle ricerche salvate, scorrere i risultati, salvare nella lista giusta, NON salvare duplicati, NON superare i limiti LinkedIn
- **Gap trovati**: limite 2500 non verificato (**C08**), dedup lento 75 query/pagina (**H05**), pre-sync ogni volta anche se DB fresco (**H03**)

**2. QUALIFICAZIONE**: Arricchisco i lead con dati esterni. AI dà un punteggio.
- **Dovrebbe**: trovare email, dominio azienda, job title. Dare un punteggio 1-100 per decidere chi contattare per primo. Lead migliori → prima priorità.
- **Gap trovati**: scoring sequenziale 200 lead = 7 min (**M06**), nessuna verifica coerenza dati SalesNav vs profilo reale (**M07**)

**3. PRIMO CONTATTO**: Invio una richiesta di connessione.
- **Dovrebbe**: navigare al profilo in modo naturale, verificare che sia la persona giusta, inviare l'invito con/senza nota personalizzata, verificare che sia andato a buon fine
- **Gap trovati**: NON verifica identità (**C04**), decay navigazione rotto (**C05**), enrichment durante la sessione browser (**H08**), modale non apparso → continua (**H09**)

**4. ATTESA**: Aspetto che la persona accetti.
- **Dovrebbe**: controllare solo dopo 2-3 giorni (non prima), distinguere "accettato" da "in attesa" da "rifiutato" da "profilo eliminato"
- **Gap trovati**: controlla tutti anche quelli di 1h fa (**H13**), no gestione profilo eliminato (**M13**), naviga all'invitation manager rompendo il contesto (**H12**)

**5. VERIFICA**: Controllo chi ha accettato, aggiorno lo stato.
- **Dovrebbe**: transizione atomica INVITED → ACCEPTED → READY_MESSAGE. Notifica immediata.
- **Stato**: ✅ Ben implementato. Transizione atomica, A/B bandit tracking, cloud sync.

**6. CONVERSAZIONE**: Mando un messaggio personalizzato.
- **Dovrebbe**: PRIMA leggere se il lead ha già scritto nella chat. POI generare un messaggio personalizzato. POI verificare che il testo sia corretto prima di inviare.
- **Gap trovati**: NON legge la chat prima (**C07**), non verifica contenuto digitato (**H11**), draft LinkedIn concatenato (**M12**), cap check dopo typing (**H10**)

**7. FOLLOW-UP**: Se non risponde dopo N giorni, mando un reminder.
- **Dovrebbe**: PRIMA verificare se ha risposto (potrebbe aver risposto e il sistema non lo sa). Usare navigazione naturale. Rispettare la campagna drip.
- **Gap trovati**: NON verifica risposte (**C06**), goto diretto (**C11**), non verifica campagna attiva (**H14**), cadenza impossibile da debuggare (**M29**)

**8. INBOX**: Leggo le risposte e reagisco.
- **Dovrebbe**: essere nel ciclo automatico (non manuale), leggere TUTTE le conversazioni non lette, capire il contesto completo (non solo ultimo messaggio), rispondere in modo appropriato
- **Gap trovati**: NON nel ciclo automatico (**C09**), max 5 conversazioni (**H26**), solo ultimo messaggio (**H27**), 30% skip senza tracking (**H26**), auto-reply senza cap giornaliero (**M30**)

### Flussi rotti — dove il ciclo si spezza

**🔴 IL GRANDE BUG: il funnel è disconnesso.**
Il ciclo completo richiede 6 comandi manuali separati (**C14**). L'autopilot gestisce solo invites + check + messages. Ma:
- L'inbox check (che rileva chi ha risposto) NON è nel ciclo → il follow-up non sa chi ha risposto → **spam a chi ha già risposto** (**C06**)
- L'enrichment iniziale NON è nel ciclo → l'utente lancia send-invites con 0 lead READY_INVITE → messaggio confuso "0 lead disponibili" (**M22**)
- Il sync-search NON è nel ciclo → l'utente deve ricordarsi di farlo separatamente

**🔴 IL PROBLEMA DELLA COERENZA: i worker non si parlano.**
- inviteWorker usa `navigateToProfileWithContext()` (con decay)
- messageWorker usa `navigateToProfileForMessage()` (60% feed, 40% diretto)
- followUpWorker usa `page.goto()` DIRETTO — **il peggiore dei tre**
- acceptanceWorker usa `navigateToProfileForCheck()`
- **4 metodi di navigazione diversi per 4 worker**. Nessuna funzione unificata.

**🔴 IL PROBLEMA DELL'IDENTITÀ: il bot non sa con CHI sta parlando.**
In NESSUN punto del flusso il bot verifica che la persona sulla pagina sia quella nel DB:
- Invito: non verifica nome → potrebbe invitare uno sconosciuto (**C04**)
- Messaggio: non verifica se ha già scritto → potrebbe sembrare un bot (**C07**)
- Follow-up: non verifica se ha risposto → potrebbe fare spam (**C06**)
- Acceptance: non verifica se il profilo esiste ancora → potrebbe andare in loop (**M13**)

**🔴 IL PROBLEMA DEL BUDGET: calcolato una volta, mai aggiornato.**
Lo scheduler calcola il budget con 14 fattori sofisticati (risk, warmup, trust, mood, strategy, SSI, maturity...). Ma il calcolo avviene UNA VOLTA all'inizio. Se durante la sessione succede qualcosa (challenge, throttle, proxy failure), il budget non viene ricalcolato (**H24**). Il throttler HTTP adatta il DELAY ma non il BUDGET.

### Sotto-flussi mancanti — cose che il sistema non fa e dovrebbe fare

1. **Risoluzione URL SalesNav → LinkedIn**: i lead importati da SalesNav hanno URL `/sales/lead/...` che non funzionano nei workflow. Tutti i worker li bloccano in BLOCKED (dead-end). Nessuno converte l'URL. (**C10**)

2. **Pulizia inviti vecchi**: il sistema manda inviti ma non li ritira dopo 21 giorni (il pending ratio sale). L'hygieneWorker esiste nel registry ma il flusso di ritiro inviti vecchi non è documentato/verificato.

3. **Monitoraggio conversazioni**: dopo il primo messaggio, il sistema non monitora la conversazione attivamente. L'inbox check è manuale. Un lead che risponde dopo 2 ore potrebbe aspettare giorni prima che il bot se ne accorga.

4. **Warm-touch pre-invito**: prima di inviare un invito, un umano guarderebbe i post della persona, metterebbe un like, forse un commento. Il bot fa solo 20% di visita attività recente (**M10**) — ma il like/commento pre-invito non c'è.

5. **Cooldown intelligente tra workflow diversi**: se il bot fa sync-search (navigazione pesante su SalesNav), poi send-invites (navigazione profili LinkedIn), poi send-messages (chat) — non c'è cooldown tra i tre. Un umano farebbe una pausa tra attività diverse.

### Scenari reali che solo un umano vede — problemi di esperienza

> Questi NON sono bug nel codice. Sono situazioni che un utente reale incontra e che il codice non gestisce.

**Scenario 1 — "Ho lanciato il bot e non succede niente"**
L'utente lancia `send-invites` per la prima volta. Non ha mai fatto `sync-search`. Il DB ha 0 lead READY_INVITE. Il bot dice "0 lead disponibili" e si ferma. L'utente non capisce perché. Nessun messaggio dice "Devi prima importare i lead con sync-search". (**M22** + manca onboarding wizard)

**Scenario 2 — "Il bot ha mandato un follow-up a chi mi ha già risposto"**
L'utente nota che Mario Rossi gli ha risposto ieri su LinkedIn. Oggi il bot manda un follow-up automatico a Mario. Perché? Perché l'inbox check NON è nel ciclo automatico → il bot non sa che Mario ha risposto. L'utente sembra un bot spammoso. (**C06** + **C09**)

**Scenario 3 — "LinkedIn mi ha chiesto una verifica e il bot si è fermato per 3 ore"**
Challenge LinkedIn → il bot va in pausa 180 minuti (default). Ma era solo un captcha immagine risolvibile in 5 secondi. L'utente non sa che può fare `bot resume` manualmente. Il messaggio Telegram dice "CHALLENGE_DETECTED" ma non dice "Puoi riprendere con: bot resume". (**L5 mancante su tutti gli alert**)

**Scenario 4 — "Ho cambiato proxy e ora il fingerprint non corrisponde"**
L'utente cambia proxy da Italia a Germania. Ma il fingerprint ha `locale: 'it-IT'` hardcoded e il geoip è '93.63.96.1' (IP italiano). LinkedIn vede: IP tedesco + locale italiano + geoip italiano = incoerenza. (**M28** + **H30**)

**Scenario 5 — "Il bot ha invitato la persona sbagliata"**
L'utente ha un lead "Marco Bianchi, CEO Acme". Il bot naviga al profilo. Ma LinkedIn fa redirect a un profilo diverso (URL cambiato, profilo rimosso, omonimo). Il bot non verifica il nome → invia l'invito alla persona sbagliata. Il vero Marco Bianchi non viene mai contattato. (**C04**)

**Scenario 6 — "Ho 200 lead nella lista ma il bot ne processa solo 10"**
L'utente non capisce perché il bot si ferma dopo 10 inviti. Non sa che: il budget è 10/giorno (hardInviteCap), il mood factor oggi è 0.85, il warmup è attivo. Il preflight mostra i numeri ma in modo tecnico. Non c'è un messaggio "Oggi il budget è 10 inviti perché..." (**A15** + manca budget explanation)

**Scenario 7 — "Il bot funziona ma non so se sta andando bene"**
L'utente guarda il report Telegram. Vede `{"invites_sent": 28, "acceptance_rate_pct": 34.2}`. Non sa se 34.2% è buono o cattivo. Non sa cosa fare per migliorare. Il report non ha benchmark ("media settore: 25-40%") né suggerimenti ("il tuo acceptance rate è sopra la media, continua così"). (**A15**)

**Scenario 8 — "Il PC si è spento durante la notte e il bot non è ripartito"**
Crash di corrente. Il bot non ha auto-restart (systemd, pm2, Windows Task Scheduler). Al riavvio, stuck jobs vengono recuperati (✅) ma la sessione giornaliera è persa. Nessun alert "bot non in esecuzione da 8 ore". (**Manca monitoring heartbeat esterno**)

**Scenario 9 — "Ho due account e il bot ha invitato la stessa persona da entrambi"**
Multi-account: Account 1 invita Mario. Account 2 invita Mario il giorno dopo. LinkedIn rileva coordinamento. Il deconfliction esiste (scheduler riga 707-712) ma controlla solo `hasOtherAccountTargeted()` che cerca job INVITE — se il primo invito è già stato accettato e il job completato, il check potrebbe non trovarlo. (**Edge case multi-account non coperto al 100%**)

**Scenario 10 — "Voglio fermare il bot ADESSO ma sta digitando un messaggio"**
L'utente preme Ctrl+C. Il graceful shutdown ha timeout 30s. Ma se il bot è a metà di `humanType()` (che può durare 20-40s per un messaggio lungo), il browser si chiude mentre sta digitando → LinkedIn salva un draft fantasma nella chat del lead. (**H16**)

---

## 🤖 ANALISI INTELLIGENZA — Il bot clicca bene? L'AI è usata al meglio? I workflow sono cervelli o catene stupide?

### Il bot clicca nei posti giusti?

**Sì meccanicamente, no intelligentemente.** Il bot trova i bottoni (4 selettori fallback, confidence check sul testo, viewport dwell 800-2000ms) e verifica post-action (Pending dopo Connect). **MA clicca al buio** — non "guarda" la pagina prima di agire:

| Azione | Cosa DOVREBBE fare prima | Cosa FA oggi | Bug |
|--------|------------------------|-------------|-----|
| Click Connect | Leggere `h1` per verificare che sia la persona giusta | Va diretto al bottone | **C04** |
| Click Message | Aprire chat, leggere se il lead ha già scritto | Va diretto a digitare | **C07** |
| Follow-up | Leggere chat per verificare risposta | `page.goto()` diretto + tipo subito | **C06, C11** |
| Acceptance check | Verificare se il profilo esiste ancora | Cerca selettori, se non trova → retry 3x → dead letter | **M13** |
| Modale invito | Aspettare che appaia, se no → STOP | Logga e continua come se niente fosse | **H09** |

### L'AI è usata al meglio?

**L'AI genera testo, ma non prende decisioni. È un segretario, non un cervello.**

| Dove l'AI è usata | Come funziona | Voto | Perché |
|-------------------|--------------|------|--------|
| Nota invito | A/B bandit Thompson, retry con temp crescente, semantic checker | ⭐⭐⭐⭐ | Sofisticato, ben implementato |
| Messaggio personalizzato | Prompt + retry 3x + semantic + pre-build offline | ⭐⭐⭐⭐ | Ottimo con pre-build |
| Intent resolution inbox | Classifica POSITIVE/NEGATIVE/QUESTIONS + draft risposta | ⭐⭐⭐⭐ | Buono, con hot lead alert |
| Lead scoring | OpenAI per ogni lead singolarmente | ⭐⭐ | Sequenziale, lento, mai aggiornato |
| AI Guardian | Analizza schedule, può fermare workflow | ⭐⭐⭐ | Buono ma chiamato UNA VOLTA, non durante |
| Decoy search terms | Lista hardcoded 80+ parole | ⭐ | Zero AI, non coerente col settore target |
| Decisioni operative | NON ESISTE | ❌ | L'AI non decide SE contattare, COME navigare, QUANDO fermarsi |

**L'AI dovrebbe decidere, non solo scrivere:**
- "Questo lead ha un profilo povero → skip, non vale un invito"
- "Questo lead ha appena pubblicato un post → commenta prima, invita domani"
- "La chat ha 3 messaggi non letti → leggi TUTTO prima di rispondere"
- "Il risk score è salito → dimezza il budget per i prossimi 5 job"
- "Ho mandato 3 inviti a CEO finanza e nessuno ha accettato → il messaggio non funziona, cambio variante"

### I workflow sono cervelli autonomi o catene stupide?

**Catene stupide.** Ogni workflow è una pipeline lineare che parte, esegue, si ferma. Non comunica con gli altri. Non impara dalla sessione corrente.

**Stato attuale — "catena di montaggio":**
```
sync-search → [STOP MANUALE] → enrich → [STOP MANUALE] → send-invites → [GIORNI] → check → messages → [???]
                                                                                                         ↑
                                                                                    inbox check MANUALE (disconnesso)
```

**Come DOVREBBE essere — "master brain con sotto-cervelli autonomi":**
```
                    ┌──────────────────────────────────────┐
                    │         MASTER BRAIN                  │
                    │  Decide COSA fare, QUANDO, QUANTO,   │
                    │  SE continuare, e ADATTA in real-time │
                    └──────────────┬───────────────────────┘
                                   │
          ┌───────────┬────────────┼────────────┬───────────┐
          ▼           ▼            ▼            ▼           ▼
     [DISCOVERY]  [INVITE]    [CHECK]     [MESSAGE]    [INBOX]
     cervello     cervello    cervello    cervello     cervello
     autonomo     autonomo    autonomo    autonomo     autonomo
     osserva      osserva     osserva     osserva      osserva
     decide       decide      decide      decide       decide
     agisce       agisce      agisce      agisce       agisce
     verifica     verifica    verifica    verifica     verifica
     comunica ←→  comunica ←→ comunica ←→ comunica ←→ comunica
```

Ogni sotto-cervello: OSSERVA → DECIDE → AGISCE → VERIFICA → COMUNICA col master.

### 7 cambiamenti architetturali per un bot intelligente

#### R01 — Pattern OBSERVE-DECIDE-ACT per ogni azione critica
- **Oggi**: navigate → click → continua
- **Domani**: navigate → **OSSERVA** (leggi h1, verifica identità, leggi chat) → **DECIDI** (è la persona giusta? il bottone è corretto? la chat è vuota?) → **AGISCI** (solo se tutto OK) → **VERIFICA** (ha funzionato?) → **ADATTA** (se no, cambia strategia)
- **Impatto**: fixa C04, C07, C06, H09, M13 in un pattern unificato
- **Effort**: MEDIO — aggiungere una funzione `observePageContext()` chiamata da tutti i worker prima dell'azione critica

#### R02 — AI Decision Engine: l'AI GUIDA il bot, non è un accessorio

**Principio**: il bot non deve eseguire passaggi meccanicamente. L'AI deve RAGIONARE ad ogni decisione chiave.

**5 punti dove l'AI decide** (oggi tutti hardcoded):

| # | Punto decisionale | Oggi (meccanico) | Domani (AI ragiona) |
|---|------------------|------------------|---------------------|
| 1 | **PRIMA di navigare** | `Math.random() < 0.45 → search` | "È il 1° invito → search organica. È il 15° → diretto. Risk alto → pausa + feed prima." |
| 2 | **SUL profilo** | `if READY_INVITE → invita` | "Profilo sparse, acceptance 12% per sparse → skip. Profilo ricco con post recente → invita con nota che cita il post." |
| 3 | **PRIMA del messaggio** | Type senza leggere chat | "Chat ha 3 messaggi: lead ha chiesto pricing → rispondo con one-pager, non messaggio generico." |
| 4 | **PRIMA del follow-up** | `daysSince >= delay → manda` | "Lead non ha risposto MA ha pubblicato ieri → è attivo, follow-up ora. Lead inattivo 30gg → skip." |
| 5 | **NELLA inbox** | Intent singolo messaggio → auto-reply | "Conversazione completa: era interessato, poi obiezione, poi silenzio. Serve approccio diverso, notifica umano." |

**Struttura dati**:
```
AIDecisionRequest {
  lead: { name, title, company, score, about, experience, recentPosts? }
  session: { invitesSent, riskScore, pendingRatio, duration, challengeCount }
  page?: { h1Name, connectionDegree, mutualConnections, profileRichness }
  chat?: { lastMessages[3-5], myLastMessage?, daysSinceLastMessage }
  history: { acceptanceRateForSegment, bestVariant, sameCompanyRecent, previousInteractions }
}

AIDecisionResponse {
  action: 'INVITE' | 'SKIP' | 'DEFER' | 'MESSAGE' | 'FOLLOW_UP' | 'REPLY' | 'NOTIFY_HUMAN'
  confidence: 0-1
  reason: string  // leggibile, loggato per debugging
  navigationStrategy?: 'search_organic' | 'feed_organic' | 'direct'
  dwellTimeSec?: number
  noteStrategy?: 'ai_personalized' | 'template' | 'none'
  noteContext?: string  // "cita il suo post su innovazione"
  messageContext?: string  // "ha chiesto pricing → risposta con one-pager"
  suggestedDelaySec?: number
}
```

**Cosa resta MECCANICO** (non serve AI, già perfetto):
- Mouse Bezier (drift→approach→overshoot→correction)
- Typing (flow state + typo + distrazione)
- Stealth scripts (19 sezioni anti-detection)
- Cap check atomico (SQL)
- Post-action verify (DOM check)
- HTTP throttling (sliding window)
- Viewport dwell (IntersectionObserver protection)
- Input blocking overlay

**Cosa diventa AI-DRIVEN** (oggi meccanico, domani ragionato):
- Decidere SE invitare un lead (oggi: sempre sì)
- Decidere COME navigare (oggi: dado random)
- Decidere QUANTO restare sul profilo (oggi: formula)
- Decidere COSA scrivere con contesto completo (oggi: dati minimi)
- Decidere SE fare follow-up (oggi: timer cieco)
- Decidere COME rispondere nella inbox (oggi: singolo messaggio)
- Decidere SE continuare la sessione (oggi: budget fisso)
- Decidere QUANDO fare decoy e di che tipo (oggi: timer + lista generica)

**Implementazione**: non riscrivere tutto. Aggiungere `aiDecisionEngine.ts` che viene chiamato nei 5 punti chiave. Ogni worker chiama `const decision = await aiDecide(context)` prima dell'azione critica. Se AI non disponibile (Ollama down) → fallback al comportamento meccanico attuale (zero regressione).

- **Effort**: ALTO ma incrementale — si può fare un punto alla volta. Partire dal punto 2 (decidere SE invitare) che ha il ROI più alto.

#### R08 — Navigazione search organica: cliccare il risultato, non goto
- **Oggi**: search organica cerca il nome nella barra LinkedIn → POI fa `page.goto(profileUrl)` diretto. LinkedIn vede: ha cercato un nome ma non ha cliccato nessun risultato, poi ha navigato direttamente al profilo. Pattern sospetto.
- **Domani**: search → aspetta risultati → trova il profilo giusto nella lista DOM (match per nome + company) → click SUL risultato. Se non trovato → goto diretto come fallback.
- **File**: `src/browser/navigationContext.ts:180-245`
- **Effort**: MEDIO — richiede scraping risultati search + match + click

#### R09 — Scroll timeout adattivo per SalesNav
- **Oggi**: `waitForFunction` timeout 1.5s fisso. Se proxy lento → card non renderizzate → lead persi.
- **Domani**: misurare tempo rendering prime 3 card → calcolare `media + 2σ` → usare come timeout dinamico. Proxy lento = timeout più lungo automaticamente.
- **File**: `src/salesnav/bulkSaveOrchestrator.ts:scrollAndReadPage()`
- **Effort**: BASSO — 10 righe di codice

#### R10 — Dedup batch invece di 75 query/pagina
- **Oggi**: per ogni profilo SalesNav → 3 query DB (LinkedIn URL, SalesNav URL, name+company hash) = 75 query/pagina.
- **Domani**: a inizio sync → caricare TUTTI gli URL della lista in una `Map<string, boolean>` in memoria (1 sola query) → dedup con lookup O(1). Da 75 query/pagina a 1 query totale.
- **File**: `src/salesnav/salesnavDedup.ts`
- **Fixa**: H05
- **Effort**: BASSO — refactor della funzione `checkDuplicates()`

#### R03 — Inbox check integrato nel ciclo standard
- **Oggi**: manuale, disconnesso, max 5 conversazioni
- **Domani**: PRIMA di ogni follow-up → il bot legge la inbox. Integrato nel `workerRegistry`. Processa TUTTE le conversazioni non lette.
- **Fixa**: C06, C09, H26, H27
- **Effort**: BASSO — aggiungere `INBOX_CHECK` al registry e al ciclo del jobRunner

#### R04 — Funzione di navigazione unificata
- **Oggi**: 4 metodi diversi (`navigateToProfileWithContext`, `navigateToProfileForMessage`, `navigateToProfileForCheck`, `page.goto` diretto)
- **Domani**: UNA funzione `navigateToProfile(page, url, { purpose, sessionContext, accountId })` che sceglie la strategia basandosi sul contesto, applica decay, verifica identità dopo
- **Fixa**: C04, C05, C11, H02
- **Effort**: MEDIO — unificare in `navigationContext.ts`, aggiornare tutti i worker

#### R05 — Budget ricalcolato mid-session
- **Oggi**: calcolato con 14 fattori, mai aggiornato durante la sessione
- **Domani**: dopo challenge, ogni 10 job, o su throttle signal → `recalculateBudget()`. Il jobRunner ha già il throttle signal — aggiungere budget recalc.
- **Fixa**: H24
- **Effort**: BASSO — aggiungere `if (challengeDetected || processedThisRun % 10 === 0) recalcBudget()`

#### R06 — Decoy context-aware generati da AI
- **Oggi**: lista hardcoded `DECOY_SEARCH_TERMS` con 80+ parole generiche
- **Domani**: all'inizio della sessione, l'AI genera 10-15 decoy search terms coerenti con il settore/industria dei lead target della lista corrente. "Se stai contattando CEO finanza → i decoy cercano CFO, financial advisor, investment banking. Non agritech."
- **Fixa**: M15, M16
- **Effort**: BASSO — una chiamata AI all'inizio della sessione

#### R07 — Autopilot completo con un solo comando
- **Oggi**: 6 comandi manuali separati, l'utente dimentica sempre qualcosa
- **Domani**: `bot.ps1 autopilot` esegue tutto in ordine intelligente:
  1. **Inbox check** → chi ha risposto? (prima di tutto, per evitare follow-up spam)
  2. **Acceptance check** → chi ha accettato?
  3. **Send messages** → a chi ha accettato
  4. **Follow-up** → a chi non ha risposto (con verifica chat)
  5. **Send invites** → a chi è READY_INVITE
  6. **Report** → cosa ho fatto oggi
- Con log chiaro: "Fase 1/6: Inbox check... 3 risposte trovate. Fase 2/6: Acceptance check... 5 accettati."
- **Fixa**: C14, C06 (indirettamente), M22
- **Effort**: MEDIO — riordinare `loopCommand.ts` e integrare inbox check

---

## 🧹 PULIZIA CODEBASE — Codice morto, duplicati, circular dependencies

### Circular dependencies (8 trovate con `madge --circular`)

| # | Ciclo | Rischio | Come fixare |
|---|-------|---------|-------------|
| 1 | `proxyManager.ts` ↔ `proxy/proxyQualityChecker.ts` | BASSO | Estrarre interfaccia comune in `proxy/types.ts` |
| 2-5 | `ai/openaiClient.ts` → `integrationPolicy.ts` → `repositories.ts` → `aiQuality.ts` → `ai/*.ts` | ALTO | Il circuito passa per 4 file. `aiQuality.ts` importa da `ai/` che importa da `openaiClient.ts` che importa da `integrationPolicy.ts`. Estrarre `aiQuality.ts` dal barrel `repositories.ts` |
| 6 | `browser/auth.ts` ↔ `browser/humanBehavior.ts` | MEDIO | `auth.ts` usa `humanDelay` per delay login. Estrarre `humanDelay` in un file separato `browser/delay.ts` |
| 7 | `browser/humanBehavior.ts` ↔ `browser/organicContent.ts` | MEDIO | `humanBehavior` importa dinamicamente `organicContent` per `interactWithFeed`. Usare injection o callback. |
| 8 | `browser/humanBehavior.ts` ↔ `browser/overlayDismisser.ts` | BASSO | `humanBehavior` chiama `dismissKnownOverlays`. Già gestito con import diretto (non circolare runtime). |

**Nota**: Le 4 circular dep AI (2-5) sono la stessa catena con 4 terminali diversi. Fixare la catena `integrationPolicy → repositories → aiQuality` risolve tutte e 4.

### Analisi struttura — 120+ file TypeScript in `src/`

| Cartella | File | Righe totali stimate | Ruolo | Stato |
|----------|------|---------------------|-------|-------|
| `core/` | ~15 file | ~6000 | Orchestrazione, scheduling, job running, state machine, repositories, campaign | 🔴 `repositories/` troppo grande (A01, A19) |
| `browser/` | ~15 file | ~5000 | Playwright, stealth, human behavior, navigation, overlay | 🔴 `humanBehavior.ts` 1438 righe (A17) |
| `workers/` | ~15 file | ~3000 | 7 worker registrati + follow-up + inbox + prebuild + dead letter + ramp-up + random activity | 🔴 `inboxWorker` non nel registry (C09) |
| `salesnav/` | ~7 file | ~4000 | Bulk save, list scraper, dedup, vision navigator, selectors | 🔴 `bulkSaveOrchestrator` 2576 righe (A17) |
| `ai/` | ~10 file | ~1500 | OpenAI client, personalizers, scorer, guardian, intent, semantic, typo | ✅ Buona struttura |
| `risk/` | ~6 file | ~1400 | Risk engine, behavior model, session memory, strategy, throttler, incidents | ✅ Buona struttura |
| `integrations/` | ~7 file | ~2500 | Enrichment pipeline (Apollo, Hunter, Clearbit, OSINT, web search) | ⚠️ `personDataFinder` 1128 righe |
| `ml/` | ~7 file | ~1200 | A/B bandit, timing, mouse, ramp, segments, significance, location | ✅ Buona struttura |
| `workflows/` | ~6 file | ~2000 | Entry point workflow con preflight interattivo | ✅ OK |
| `cli/` | ~5 file | ~2500 | Parser CLI, comandi admin/util/workflow/salesNav | 🔴 `adminCommands` 1011 righe |
| `api/` | ~8 file | ~1500 | Express REST + routes | ⚠️ `server.ts` 867 righe |
| `frontend/` | ~7 file | ~2500 | Dashboard SPA | ⚠️ Non verificato se usato |
| `sync/` | ~5 file | ~500 | Backpressure, event sync, outbox, Supabase, webhook | ✅ OK |
| `cloud/` | ~5 file | ~1000 | Supabase, Telegram, control plane | ✅ OK |
| `telemetry/` | ~6 file | ~700 | Logger, alerts, broadcaster, daily reporter, live events, correlation | ✅ OK |
| `config/` | ~5 file | ~1800 | Config loader, validation, types, profiles, domains | ⚠️ 100+ parametri senza Zod (A18) |
| `tests/` | ~16 file | ~3500 | Unit + integration + e2e | 🔴 8% coverage (A08) |
| `scripts/` | ~7 file | ~1000 | Utility scripts (backup, restore, ramp-up, etc.) | ✅ OK |
| `plugins/` | 2 file | ~400 | Plugin loader | ✅ OK |

### File potenzialmente inutilizzati o da verificare

| File | Sospetto | Verifica necessaria |
|------|----------|-------------------|
| `src/scripts/rampUp.ts` | Il ramp-up è ora gestito da `accountBehaviorModel.ts` + `rampModel.ts`. Questo script è ancora usato? | Grep per `rampUp` nei comandi CLI |
| `src/salesnav/listScraper.ts` (586 righe) | Il commento in `bulkSaveOrchestrator.ts:47` dice "listScraper: navigateToSavedLists/scrapeLeadsFromSalesNavList non più usati — pre-sync usa vision-guided navigation" | Verificare se qualcuno importa ancora da `listScraper.ts` |
| `src/workers/deadLetterWorker.ts` | Esiste ma non è nel workerRegistry. Come viene eseguito? | Verificare se è chiamato manualmente o da un cron |
| `src/workers/rampUpWorker.ts` | Il ramp-up è ora gestito dal growth model in scheduler. Questo worker è ancora attivo? | Grep per `rampUpWorker` |
| `src/ml/rampModel.ts` | Usato da `accountBehaviorModel.ts`? O duplicato del growth model? | Verificare import |
| `src/ml/significance.ts` | Test statistici per A/B. Usato effettivamente o solo placeholder? | Grep per `significance` |
| `src/integrations/crmBridge.ts` (303 righe) | CRM bridge. Configurato per qualche utente? | Verificare se qualcuno lo usa realmente |
| `src/frontend/` (intera cartella) | Dashboard SPA. È deployata e funzionante? O è un prototipo abbandonato? | Verificare con l'utente |
| `src/tests/integration.ts` (1607 righe) | File di test enorme non-vitest. È il vecchio sistema di test? Sostituito da `integration.vitest.ts`? | Verificare se è ancora eseguito |

### Pulizia da fare

- [x] **Risolvere le 8 circular dependencies** — ZERO circular deps (commit 05e1588 + 7c68e61 + 15b825d)
- [ ] **Verificare file potenzialmente inutilizzati** — grep + conferma utente
- [ ] **Verificare se `listScraper.ts` (586 righe) è codice morto** — NON è morto: importato da `salesNavigatorSync.ts` e `listActions.ts`
- [x] **Unificare i 4 metodi di navigazione** — `navigateToProfileWithContext` + `navigateToProfileForMessage` in `navigationContext.ts`
- [x] **Rimuovere `src/tests/integration.ts`** — rimosso (commit 30b6f18, 1636 righe)
- [ ] **Verificare stato frontend/** — cartella esiste (apiClient.ts, charts.ts, etc.) — chiedere all'utente se è deployata

---

## 🔴 CRITICAL — Fixare prima di usare il bot

### C01 ✅ — Doctor apre browser PRIMA del proxy health check → IP server esposto
- **File diretti**: `src/index.ts:375-420`
- **File indiretti**: `src/core/doctor.ts:297` (chiama `launchBrowser`), `src/browser/launcher.ts` (apre browser), `src/proxyManager.ts:504-549` (health check), `src/proxy/ja3Validator.ts:105-165` (JA3 validation), `src/accountManager.ts` (account profiles)
- **Problema**: Ordine boot: config → DB → doctor (LANCIA BROWSER alla riga 297 di doctor.ts) → proxy check (riga 407 di index.ts). Se il proxy è giù, il browser del doctor va su LinkedIn con l'IP reale del server. Il doctor chiama `launchBrowser()` per OGNI account per verificare il login.
- **Impatto**: LinkedIn associa l'IP reale del server all'account. Compromissione permanente.
- **Fix**: In `index.ts`, spostare il blocco proxy check (righe 407-420) PRIMA del blocco doctor (righe 375-405). Aggiungere check CycleTLS nello stesso blocco. Se proxy morto → `process.exit(1)`.
- **Scenario L4**: E se il proxy è OK al check ma muore 2 secondi dopo durante il doctor? → Aggiungere `proxy` option a `launchBrowser` in doctor.ts (già presente, ma verificare che sia usata).

### C02 ✅ — Proxy fail NON blocca il workflow → il bot parte senza protezione
- **File diretti**: `src/index.ts:407-420`
- **File indiretti**: `src/proxyManager.ts:504-549` (checkProxyHealth), `src/proxy/ipReputationChecker.ts` (reputation check), `src/accountManager.ts:getRuntimeAccountProfiles()`
- **Problema**: Riga 414: `console.error(...)` ma nessun `process.exit(1)`. Il workflow parte lo stesso. L'utente potrebbe non vedere il warning nella console (output abbondante).
- **Impatto**: Bot opera su LinkedIn senza proxy. Ban quasi certo.
- **Fix**: Dopo il loop degli account, se QUALSIASI proxy ha fallito → `process.exit(1)` con messaggio chiaro. Telegram alert critico.
- **Scenario L4**: E se un account ha proxy e l'altro no (multi-account)? → Bloccare solo l'account senza proxy, non l'intero processo.

### C03 ✅ — Nessun check CycleTLS al boot → JA3 spoofing potenzialmente OFF
- **File diretti**: `src/index.ts` (manca il check), `scripts/startCycleTls.ts`
- **File indiretti**: `src/proxy/ja3Validator.ts:105-165` (la funzione `validateJa3Configuration()` ESISTE ma non è chiamata), `src/browser/stealth.ts` (filtra pool assumendo CycleTLS attivo), `src/fingerprint/pool.ts` (selezione fingerprint), `src/config/index.ts` (config.useJa3Proxy)
- **Problema**: `validateJa3Configuration()` è chiamata SOLO nei comandi `doctor` e `proxy-status` (riga 513 di index.ts), MAI nel boot dei workflow operativi (send-invites, send-messages, sync-search, etc).
- **Impatto**: Fingerprint TLS rilevabile immediatamente da LinkedIn/Cloudflare.
- **Fix**: In `index.ts`, nel blocco proxy check (dopo aver spostato prima del doctor per C01): aggiungere `if (config.useJa3Proxy) { const report = await validateJa3Configuration(); if (!report.cycleTlsActive) process.exit(1); }`.
- **Scenario L4**: E se CycleTLS crasha mid-session? → Aggiungere periodic health check (ogni 10 min) durante la sessione.

### C04 ✅ — Nessuna verifica identità: il bot potrebbe invitare la persona SBAGLIATA
- **File diretti**: `src/workers/inviteWorker.ts:325-446`
- **File indiretti**: `src/browser/navigationContext.ts:180-245` (navigazione), `src/selectors.ts:connectButtonPrimary` (bottone Connect), `src/core/leadStateService.ts` (transizione), `src/core/repositories/leadsCore.ts:getLeadById()` (dati lead)
- **Problema**: Tra la navigazione al profilo (riga 325) e il click Connect (riga 439), il codice NON verifica mai che `h1` della pagina corrisponda a `lead.first_name + lead.last_name`.
- **Impatto**: Se URL redirect, profilo eliminato, o URL sbagliata → invita uno sconosciuto.
- **Fix**: Dopo riga 334 (computeProfileDwellTime), aggiungere: lettura `h1`, confronto Jaro-Winkler con lead name, se < 0.75 → `transitionLead(REVIEW_REQUIRED, 'identity_mismatch')`.
- **Scenario L3**: Edge case: nomi con accenti (Mario → Mário), nomi composti (Maria Elena), profili in lingue diverse (名前). Usare normalizzazione Unicode prima del confronto.

### C05 ✅ — sessionInviteCount MAI passato → decay navigazione organica rotto
- **File diretti**: `src/workers/inviteWorker.ts:325-330`, `src/browser/navigationContext.ts:180-186`
- **File indiretti**: `src/workers/context.ts` (WorkerContext — deve avere campo inviteCount), `src/core/jobRunner.ts` (deve incrementare il contatore)
- **Problema**: `navigateToProfileWithContext()` accetta `sessionInviteCount` come 5° parametro (default 0). inviteWorker.ts riga 325 chiama con solo 4 argomenti. Il decay (45% → 25% → 10% organic) non si attiva MAI.
- **Fix**: `inviteWorker.ts:325` → aggiungere 5° argomento. In `workers/context.ts` → aggiungere `inviteCount` al tipo WorkerContext. In `jobRunner.ts` → incrementare dopo ogni invite job.
- **Scenario L2**: Il parametro è opzionale (default 0) → retrocompatibile. Ma verificare che `context.session` abbia il campo disponibile.

### C06 ✅ — Follow-up NON verifica se il lead ha già risposto → rischio spam gravissimo
- **File diretti**: `src/workers/followUpWorker.ts` (il worker che invia), `src/workers/inboxWorker.ts` (il worker che rileva risposte)
- **File indiretti**: `src/workers/registry.ts` (inboxWorker NON registrato), `src/core/jobRunner.ts` (esegue follow-up alla fine della sessione), `src/core/repositories.ts:getLeadsForFollowUp()` (query senza check risposta), `src/selectors.ts:inboxLastMessage,inboxProfileLink` (selettori chat), `src/core/leadStateService.ts` (transizione REPLIED)
- **Problema**: followUpWorker query `WHERE status='MESSAGED' AND follow_up_count < MAX`. NON controlla se il lead ha risposto. L'inboxWorker (unico modo per rilevare risposte) NON è nel ciclo standard.
- **Impatto**: Bug PIÙ GRAVE per la reputazione. Un prospect che riceve follow-up dopo aver già risposto = spam palese.
- **Fix multi-livello**:
  1. IMMEDIATO: nel `followUpWorker.ts`, prima di ogni invio → aprire chat del lead, leggere ultimo messaggio. Se l'ultimo msg NON è nostro → `transitionLead(REPLIED)` e skip.
  2. STRUTTURALE: in `workers/registry.ts` → aggiungere `INBOX_CHECK`. In `core/jobRunner.ts` → eseguire inbox check PRIMA del follow-up phase.
  3. DB: in `getLeadsForFollowUp()` → aggiungere LEFT JOIN con ultimi messaggi per filtrare.
- **Scenario L4**: E se la chat è vuota (lead ha cancellato il messaggio)? E se il lead ha risposto con un'immagine (non testo)? E se il selettore `inboxLastMessage` cambia?

### C07 ✅ — Non controlla se il lead ha GIÀ scritto nella chat prima del primo messaggio
- **File diretti**: `src/workers/messageWorker.ts:134-210`
- **File indiretti**: `src/selectors.ts:messageButton,messageTextbox,inboxLastMessage` (selettori), `src/browser/navigationContext.ts:navigateToProfileForMessage()`, `src/core/leadStateService.ts`
- **Problema**: Tra navigazione al profilo (riga 136) e click Message (riga 191), il codice NON apre la chat per verificare messaggi esistenti. Il lead potrebbe aver già scritto.
- **Fix**: Dopo click Message (riga 191), prima di `typeWithFallback` (riga 204): leggere `inboxLastMessage`, verificare se è nostro o del lead. Se del lead → `transitionLead(REPLIED)` e return.
- **Scenario L4**: E se la textbox ha già un draft? (→ **M12** collegato). E se il chat widget mostra messaggi di sistema LinkedIn?

### C08 ✅ — Limite 2500 membri/lista SalesNav MAI verificato
- **File diretti**: `src/salesnav/bulkSaveOrchestrator.ts`
- **File indiretti**: `src/salesnav/listActions.ts` (gestione liste), `src/salesnav/salesnavDedup.ts` (dedup), `src/core/repositories.ts` (conteggio DB), `src/salesnav/visionNavigator.ts` (click UI)
- **Problema**: LinkedIn ha hard limit 2500 lead/lista. Il codice non verifica il conteggio attuale prima di salvare. Superato il limite → fail silenzioso o errore UI non catturato.
- **Fix**: Pre-save: query conteggio membri lista dal DOM o dal DB. Se >= 2400 → creare nuova lista via `listActions.ts:createSalesNavList()` con suffix incrementale. Aggiornare sync run con nuovo listId.
- **Scenario L4**: E se la creazione della nuova lista fallisce? E se il conteggio nel DOM non corrisponde al DB? E se due sync concurrent creano liste duplicate?

### C09 ✅ — InboxWorker NON è nel workerRegistry → deve essere eseguito manualmente
- **File diretti**: `src/workers/registry.ts`, `src/workers/inboxWorker.ts`
- **File indiretti**: `src/core/jobRunner.ts` (esecuzione job), `src/core/scheduler.ts` (enqueue), `src/core/orchestrator.ts` (coordinamento), `src/cli/commands/loopCommand.ts` (autopilot)
- **Problema**: 7 worker registrati nel registry. inboxWorker NON è nella Map. Il loop/autopilot non lo chiama mai.
- **Fix**: In `registry.ts`: aggiungere `workerRegistry.set('INBOX_CHECK', inboxProcessor)`. In `scheduler.ts`: enqueue 1 INBOX_CHECK per sessione PRIMA dei follow-up. In `loopCommand.ts`: includere INBOX_CHECK nel ciclo autopilot.
- **Scenario L2**: Aggiungere il tipo `INBOX_CHECK` nel enum `JobType` in `types/domain.ts`. Verificare che `jobRunner.ts` gestisca il nuovo tipo senza breaking change.

### C10 ✅ — Lead SalesNav bloccati permanentemente in BLOCKED — dead-end irrecuperabile
- **File diretti**: `src/workers/inviteWorker.ts:278-281`, `src/workers/messageWorker.ts:58-61`, `src/workers/acceptanceWorker.ts`
- **File indiretti**: `src/core/leadStateService.ts` (state machine: BLOCKED = []), `src/linkedinUrl.ts:isSalesNavigatorUrl()`, `src/salesnav/bulkSaveOrchestrator.ts` (importazione lead con URL SalesNav)
- **Problema**: Tutti e 3 i worker: `if (isSalesNavigatorUrl) → transitionLead(BLOCKED)`. BLOCKED ha zero transizioni permesse nella state machine. I lead SalesNav HANNO un profilo classico — l'URL `/sales/lead/` può essere convertita in `/in/`.
- **Fix**: Sostituire `BLOCKED` con `REVIEW_REQUIRED` (ha transizioni). In `bulkSaveOrchestrator.ts`: estrarre URL profilo classico durante il save. Aggiungere comando `salesnav resolve` per risolvere URL in batch.
- **Scenario L6**: Migrazione DB: aggiornare lead esistenti in BLOCKED con reason 'salesnav_url*' → REVIEW_REQUIRED. Reversibile?

### C11 ✅ — Follow-up usa page.goto() diretto — ZERO navigation context
- **File diretti**: `src/workers/followUpWorker.ts:118`
- **File indiretti**: `src/browser/navigationContext.ts:navigateToProfileForMessage()` (la funzione che DOVREBBE usare), `src/browser/humanBehavior.ts` (delay, scroll)
- **Problema**: `await context.session.page.goto(linkedinUrl, { waitUntil: 'domcontentloaded' })` — goto diretto senza catena organica. Il file `navigationContext.ts` dice esplicitamente che questo è "il segnale detection #1".
- **Fix**: Sostituire con `await navigateToProfileForMessage(context.session.page, linkedinUrl, context.accountId)`.
- **Scenario L2**: Verificare che `navigateToProfileForMessage` sia importabile senza circular dependency.

### C12 ✅ — Behavioral profile drift si accumula troppo con riavvii frequenti
- **File diretti**: `src/browser/sessionCookieMonitor.ts:getBehavioralProfile()`
- **File indiretti**: `src/browser/sessionCookieMonitor.ts:applyProfileDrift()`, `src/core/jobRunner.ts` (chiama getBehavioralProfile ad ogni sessione), `src/browser/humanBehavior.ts` (usa il profilo per delay/scroll speed)
- **Problema**: `applyProfileDrift()` aggiunge ±5% ad OGNI lettura. 10 riavvii/giorno → drift 50%.
- **Fix**: Aggiungere campo `lastDriftDate` nei metadata. Se `meta.lastDriftDate === today` → return profilo esistente senza drift.
- **Scenario L6**: Il campo `lastDriftDate` va persistito nel file metadata della sessione. Verificare formato e retrocompatibilità con sessioni esistenti.

### C13 ✅ — Captcha solver senza rate limiter → loop brucia budget API
- **File diretti**: `src/captcha/solver.ts`
- **File indiretti**: `src/captcha/visionProvider.ts` (API call), `src/workers/challengeHandler.ts` (chiama il solver in loop), `src/ai/openaiClient.ts` (se usa OpenAI), `src/core/integrationPolicy.ts` (circuit breaker generico)
- **Problema**: Il solver viene chiamato dal challengeHandler senza cooldown. Il circuit breaker di `integrationPolicy.ts` si apre dopo N failure ma NON limita la frequenza tra tentativi.
- **Fix**: In `solver.ts`: aggiungere `CAPTCHA_COOLDOWN_MS = 10_000`, `MAX_CAPTCHA_PER_SESSION = 3`. Counter persistito in daily_stats (non in-memory, per sopravvivere ai riavvii).
- **Scenario L4**: E se il CAPTCHA appare in loop infinito? → Dopo MAX_CAPTCHA_PER_SESSION → pauseAutomation() + alert Telegram critico.

### C14 ✅ — Ciclo completo richiede 6 comandi separati — gap critico nel funnel
- **File diretti**: `src/cli/commands/loopCommand.ts`, `src/cli/commands/workflowCommands.ts`
- **File indiretti**: `src/core/orchestrator.ts`, `src/workers/registry.ts` (manca inboxWorker), `src/workflows/syncSearchWorkflow.ts`, `src/workflows/sendInvitesWorkflow.ts`, `src/workflows/sendMessagesWorkflow.ts`
- **Problema**: Ciclo: sync-search → enrich-fast → send-invites → (giorni) → run check → send-messages → inbox check. L'autopilot gestisce solo 3/4/5. Inbox check è manuale. L'utente dimentica SEMPRE inbox check → follow-up a chi ha già risposto.
- **Fix**: In `loopCommand.ts`: aggiungere fase inbox check nel ciclo autopilot. Creare comando "init" che esegue sync + enrich in sequenza. Documentare il flusso minimo.
- **Scenario L5**: L'utente DEVE capire cosa succede. Aggiungere log chiaro a inizio ciclo: "Fase 1/6: Inbox check... Fase 2/6: Acceptance check... Fase 3/6: Inviti..."

---

## 🟠 HIGH — Rischio ban o perdita dati

### H01 ✅ — TOTP failure ha zero fallback → bot si blocca silenziosamente
- **File**: `src/browser/auth.ts`, `src/security/totp.ts`
- **Problema**: Se il TOTP fallisce (orologio sfasato, secret errato), il bot resta sulla pagina di verifica senza errore esplicito. Nessun alert, nessun timeout.
- **Fix**: Aggiungere timeout 30s sull'auth flow. Se scade → quarantineAccount + alert Telegram.

### H02 ✅ — navigateViaOrganicSearch: fa search poi goto DIRETTO al profilo
- **File**: `src/browser/navigationContext.ts:navigateViaOrganicSearch()`
- **Problema**: La catena "organica": Feed → Search → `page.goto(profileUrl)`. Il profilo target NON è nei risultati di ricerca. LinkedIn vede referrer=/search/ ma profilo non nei risultati. Pattern più sospetto del goto diretto.
- **Fix**: Cliccare un risultato reale nelle ricerche oppure andare direttamente al profilo senza finta ricerca.

### H03 ✅ — PRE-SYNC: full scan della lista OGNI volta anche se DB aggiornato 5 min fa
- **File**: `src/salesnav/bulkSaveOrchestrator.ts:preSyncListToDb()`
- **Problema**: Prima di cercare lead nuovi, scarica TUTTI i membri della lista (2000 = 80 pagine). Non controlla se il DB ha già dati recenti. Con --resume dopo crash, rifa il full sync.
- **Fix**: Check età ultimo pre-sync. Se < 2h → skip.

### H04 ✅ — Scroll fast: timeout 1500ms troppo basso per rete lenta
- **File**: `src/salesnav/bulkSaveOrchestrator.ts:scrollAndReadPage()`
- **Problema**: Timeout 1500ms per rendering card. Se proxy aggiunge latenza → lead non raccolti.
- **Fix**: Timeout adattivo: `baseTimeout + Math.min(proxyLatency * 2, 3000)`.

### H05 ✅ — Dedup fa 3 query DB per profilo in un for loop → 75 query/pagina
- **File**: `src/salesnav/salesnavDedup.ts:checkDuplicates()`
- **Problema**: Per ogni profilo: query LinkedIn URL, query SalesNav URL, query name+company hash. 25 lead/pagina = 75 query SELECT.
- **Fix**: Batch: caricare tutti i membri della lista in un Set una volta sola.

### H06 ✅ — Select All non verifica QUANTI lead sono stati selezionati
- **File**: `src/salesnav/bulkSaveOrchestrator.ts:clickSelectAll()`
- **Problema**: Dopo click, verifica solo se "Save to list" appare, NON se il conteggio selezionato = lead sulla pagina. Virtual scroller potrebbe aver renderizzato 20 su 25.
- **Fix**: Leggere contatore dal DOM dopo clickSelectAll. Se < 80% expected → warning.

### H07 ✅ — Vision navigator è SPOF — se Ollama è giù, zero risultati salvati
- **File**: `src/salesnav/visionNavigator.ts`
- **Problema**: Quando i bottoni SalesNav non hanno selettori DOM standard, il sistema ricade sulla Vision AI. Se Ollama offline → funzioni falliscono → pagina saltata.
- **Fix**: Graceful skip + tracking lead non salvati. Fallback a coordinate fisse per bottoni noti.

### H08 ✅ — Enrichment duplicato: pre-workflow + dentro il worker
- **File**: `src/workflows/sendInvitesWorkflow.ts`, `src/workers/inviteWorker.ts:283-314`
- **Problema**: sendInvitesWorkflow fa enrichment PRIMA del browser. Ma inviteWorker fa un SECONDO enrichment per lead DURANTE la sessione browser (2-5s extra di API calls per lead).
- **Fix**: Rimuovere enrichment dal worker. Fidarsi del pre-enrichment. MAI fare API calls esterne mentre il browser è aperto.

### H09 ✅ — Se modale invito non appare dopo click Connect, logga e basta
- **File**: `src/workers/inviteWorker.ts:453-458`
- **Problema**: `isVisible({ timeout: 3000 })` fallisce → logga → continua con `handleInviteModal()` che cerca bottoni inesistenti → retry. Ma il click Connect è già stato registrato da LinkedIn.
- **Fix**: Se modale non appare → Escape, decrementa stat, throw RetryableWorkerError. NON procedere.

### H10 ✅ — Cap check messaggi DOPO aver generato AI + navigato + digitato
- **File**: `src/workers/messageWorker.ts:140-170`
- **Problema**: Ordine: genera AI (~2-5s) → naviga (~5s) → digita (~3s) → SOLO ORA `checkAndIncrementDailyLimit`. Se cap raggiunto, tutto sprecato. inviteWorker fa il cap check PRIMA.
- **Fix**: Spostare cap check SUBITO dopo generazione messaggio, PRIMA della navigazione.

### H11 ✅ — Nessuna verifica del contenuto digitato prima di Send
- **File**: `src/workers/messageWorker.ts:173-185`
- **Problema**: Dopo typeWithFallback, il bot clicca Send senza verificare che il testo nel campo sia quello generato. Se typing in campo sbagliato → contenuto diverso o vuoto.
- **Fix**: Leggere `inputValue()` del textbox. Se < 50% del messaggio atteso → throw error.

### H12 ✅ — checkSentInvitations() naviga all'invitation manager → rompe contesto
- **File**: `src/workers/acceptanceWorker.ts:22-52`
- **Problema**: Se il profilo non ha badge "1st" né "Pending", il bot va su `/mynetwork/invitation-manager/sent/`. Dopo: siamo nell'invitation manager, non sul profilo. Navigation context rotto. Pattern automatico rilevabile.
- **Fix**: Usare euristica connectedWithoutBadge (ha bottone Messaggio + no Pending = accettato). Rimuovere navigazione all'invitation manager.

### H13 ✅ — Controlla TUTTI i lead INVITED — anche quelli invitati 1 ora fa
- **File**: `src/workers/acceptanceWorker.ts`
- **Problema**: Nessun filtro per età dell'invito. Con 50 lead INVITED, visita tutti anche se invitati ieri.
- **Fix**: `WHERE status='INVITED' AND invited_at < datetime('now', '-2 days')`.

### H14 ✅ — Non verifica che la campagna drip sia ancora attiva
- **File**: `src/workers/followUpWorker.ts`
- **Problema**: Se l'utente ha disattivato la campagna, il follow-up worker continua a inviare.
- **Fix**: Check `campaignState.status === 'ACTIVE'` prima di ogni step drip.

### H15 ✅ — Wind-down solo nel 30% delle sessioni → 70% chiude di colpo
- **File**: `src/core/jobRunner.ts:999-1005`
- **Problema**: `if (Math.random() < 0.30)` → torna al feed prima di chiudere. Il 70% chiude direttamente dal profilo/SalesNav. Un umano chiude dal feed.
- **Fix**: Wind-down SEMPRE: torna al feed, scroll leggero, pausa, poi chiudi.

### H16 ✅ — Crash durante typing → draft fantasma nella textbox LinkedIn
- **File**: `src/workers/messageWorker.ts`, `src/browser/launcher.ts:cleanupBrowsers()`
- **Problema**: Se crash durante `humanType()`, LinkedIn salva il draft. La prossima volta l'utente umano vede "Ciao Mario, ho visto il tu" come draft.
- **Fix**: Al prossimo boot, check se ci sono modali/draft aperti. Cleanup textbox.

### H17 ✅ — humanType: pattern correzione typo sempre uguale → fingerprint-abile
- **File**: `src/browser/humanBehavior.ts:humanType()`
- **Problema**: Typo → 280-420ms pausa → Backspace → retype. Sempre. Un umano usa Ctrl+Z, seleziona e sovrascrive, cancella più caratteri.
- **Fix**: Variare il pattern di correzione (Ctrl+Z, selezione, cancellazione multipla, ignorare errore).

### H18 ✅ — simulateTabSwitch: mock programmatico Visibility API → rilevabile
- **File**: `src/browser/humanBehavior.ts:simulateTabSwitch()`
- **Problema**: Modifica `document.visibilityState` via JS. Chrome DevTools Protocol può rilevare che il tab non è realmente in background.
- **Fix**: Valutare se necessario. Se sì, usare CDP per minimizzare/ripristinare realmente la finestra.

### H19 ✅ — closeBrowser non chiude sempre page prima di browser → memory leak
- **File**: `src/browser/index.ts`
- **Problema**: `closeBrowser` non chiude sempre la page prima del browser su tutti i percorsi.
- **Fix**: Assicurare `page.close()` prima di `browser.close()` in tutti i percorsi.

### H20 ✅ — uiFallback non registra mai il fallback riuscito nel DB
- **File**: `src/browser/uiFallback.ts`
- **Problema**: Il fallback funziona ma non registra il successo per future ottimizzazioni.
- **Fix**: Chiamare selector learner `recordSuccess()` dopo ogni fallback riuscito.

### H21 ✅ — Audio context fingerprint NON protetto
- **File**: `src/browser/stealth.ts`, `src/browser/stealthScripts.ts`
- **Problema**: Fingerprint pool gestisce Canvas, WebGL, fonts, screen, navigator — ma NON AudioContext. Playwright ha un profilo audio deterministico. Spoofing parziale è PEGGIORE dell'assenza (hash non corrisponde a nessun browser reale). Mancano: `createOscillator()` + `createDynamicsCompressor()`, `getByteFrequencyData()`, `OfflineAudioContext.startRendering()`.
- **Fix**: Completare spoofing AudioContext con tutte le API.

### H22 ✅ — Font enumeration defense troppo permissiva
- **File**: `src/browser/stealthScripts.ts:sezione 14`
- **Problema**: Mock di `document.fonts.check()` non cambia come i glifi vengono renderizzati → fingerprint canvas-based rimane uguale.
- **Fix**: Aggiungere noise al rendering glyph, non solo al check fonts.

### H23 ✅ — CDP leak detection: lista statica, non intercetta nuovi artefatti
- **File**: `src/browser/stealthScripts.ts:sezione 17`
- **Problema**: Rimuove 20+ proprietà note (__playwright, __webdriver_evaluate) ma la lista è statica. `Error.prepareStackTrace` override è esso stesso rilevabile.
- **Fix**: Aggiornare la lista ad ogni release Playwright. Rendere override meno rilevabile.

### H24 ✅ — Budget calcolato una volta al boot → non ricalcolato mid-session
- **File**: `src/core/scheduler.ts`, `src/core/jobRunner.ts`
- **Problema**: Se al job 10 il risk score sale (challenge), i job 11-50 usano il budget vecchio.
- **Fix**: Ricalcolare budget dopo challenge o ogni N job.

### H25 ✅ — Warmup sempre uguale indipendentemente dal tempo dall'ultima sessione
- **File**: `src/core/sessionWarmer.ts`
- **Problema**: Se login 5 min fa, il bot rifà feed scroll + random likes. Un umano non riscorre il feed dopo 5 minuti.
- **Fix**: Controllare tempo dall'ultima sessione. Se < 30min → skip warmup o warmup ridotto.

### H26 ✅ — InboxWorker: processa max 5 conversazioni, 30% skip probabilistico
- **File**: `src/workers/inboxWorker.ts`
- **Problema**: Hardcoded a 5 per run. Con 10-20 messaggi/giorno, conversazioni oltre le prime 5 non processate MAI. Il 30% "defer" non viene tracciato → conversazione potrebbe non essere MAI processata.
- **Fix**: Aumentare limit. Tracciare conversazioni skippate. Processarle nel run successivo.

### H27 ✅ — InboxWorker legge SOLO l'ultimo messaggio → contesto perso
- **File**: `src/workers/inboxWorker.ts`
- **Problema**: Se il lead ha mandato 3 messaggi, il contesto dei primi 2 è perso. Auto-reply potrebbe essere fuori tema.
- **Fix**: Leggere ultimi 3-5 messaggi della conversazione per contesto AI.

### H28 ✅ — Provider registry AI: fallback senza circuit breaker
- **File**: `src/ai/providerRegistry.ts`
- **Problema**: Se OpenAI è down, fa 10+ retry prima di switchare a Ollama.
- **Fix**: Circuit breaker: dopo 3 fail consecutivi → switch immediato al backup.

### H29 ✅ — emailGuesser: SMTP probe su porta 25 bloccata da molti firewall aziendali
- **File**: `src/integrations/emailGuesser.ts:105-189`
- **Problema**: `smtpProbe()` si connette su porta 25 (SMTP relay). Molti firewall aziendali e cloud provider (AWS, GCP, Azure) bloccano outbound porta 25. Il probe fallisce silenziosamente → `guessBusinessEmail()` ritorna null anche per email valide. Timeout 5s per ogni tentativo × 8 pattern = 40s di attesa inutile.
- **Fix**: 1) Tentare porta 587 (submission) come fallback se porta 25 fallisce. 2) Cache risultato "port 25 blocked" per dominio per evitare retry. 3) Log warning se tutti i probe falliscono per timeout (indica porta bloccata, non email invalida).

### H30 ✅ — Camoufox geoip hardcoded IP italiano quando proxy è configurato
- **File**: `src/browser/launcher.ts:387`
- **Problema**: `geoip: currentProxy ? '93.63.96.1' : config.camoufoxGeoip` — quando un proxy è configurato, il geoip è forzato a un IP italiano fisso (93.63.96.1 = Telecom Italia). Se il proxy è in Germania/USA/NL, il browser dice "sono in Italia" ma l'IP dice "sono in Germania" → incoerenza rilevabile da LinkedIn.
- **Fix**: Risolvere l'IP reale del proxy con un DNS lookup e usare quello per il geoip. Oppure rendere `CAMOUFOX_GEOIP_PROXY` configurabile. Se proxy è in NL → geoip deve essere un IP olandese.

---

## 🟡 MEDIUM — Miglioramenti importanti

### M01 — Config validation non controlla range numerici
- **File**: `src/config/validation.ts`
- **Problema**: `HARD_INVITE_CAP=-1` accettato. Nessun min/max per cap. Profilo dev ha cap 5 ma .env sovrascrive senza warning.
- **Fix**: Aggiungere validazione Zod con min/max su tutti i cap numerici.

### M02 — Toast verification con word overlap → può confermare lista sbagliata
- **File**: `src/salesnav/bulkSaveOrchestrator.ts:verifyToast()`
- **Fix**: Verificare che il NOME COMPLETO della lista corrisponda, non solo ≥2 parole.

### M03 — Early-stop dopo 3 pagine duplicate potrebbe fermarsi troppo presto
- **File**: `src/salesnav/bulkSaveOrchestrator.ts`
- **Fix**: Aumentare a 5 pagine o rendere configurabile.

### M04 — Navigazione a SalesNav con goto diretto → no navigation context
- **File**: `src/salesnav/bulkSaveOrchestrator.ts:navigateToSavedSearches()`
- **Fix**: Navigare a SalesNav dalla navbar LinkedIn, non con goto diretto.

### M05 — No check abbonamento SalesNav → errore generico se scaduto
- **File**: `src/salesnav/bulkSaveOrchestrator.ts`
- **Fix**: Controllare se l'account ha SalesNav attivo. Messaggio chiaro se scaduto.

### M06 — Scoring AI sequenziale → 200 lead = 7 minuti di API calls
- **File**: `src/ai/leadScorer.ts`
- **Fix**: Batch processing con parallelismo controllato (p-limit concurrency 5).

### M07 — Nessuna verifica coerenza dati SalesNav vs profilo reale
- **File**: `src/salesnav/`, `src/core/repositories/`
- **Fix**: Reconciliation step tra dati SalesNav e profilo classico.

### M08 — Partial page saves on failure → nessuna transazione per pagina
- **File**: `src/salesnav/bulkSaveOrchestrator.ts:processSearchPage()`
- **Fix**: Wrappare in transazione DB per pagina. Se errore → rollback pagina intera.

### M09 — Nota AI vuota → invia senza nota SENZA loggare il motivo
- **File**: `src/workers/inviteWorker.ts:handleInviteModal()`
- **Fix**: Loggare PERCHÉ la nota era vuota (AI down? template vuoto? timeout?).

### M10 — 20% visita attività recente → percentuale fissa + goto diretto per tornare
- **File**: `src/workers/inviteWorker.ts:338-345`
- **Fix**: Probabilità variabile per sessione (10-40%). Usare `page.goBack()` invece di goto diretto.

### M11 — Messaggio "troppo ripetitivo" basato su hash esatto → parafrasi passano
- **File**: `src/validation/messageValidator.ts`
- **Fix**: Usare semantic checker anche nella validazione finale, non solo durante la generazione.

### M12 — Se textbox ha draft LinkedIn, il messaggio viene concatenato
- **File**: `src/workers/messageWorker.ts`
- **Fix**: Pulire il campo prima di digitare: `selectAll` + `Delete`.

### M13 — Nessuna gestione profilo eliminato / URL cambiato nell'acceptance check
- **File**: `src/workers/acceptanceWorker.ts`
- **Fix**: Detectare "This page doesn't exist" → transizionare a `PROFILE_DELETED`.

### M14 — Scroll pattern lineare → incrementi uniformi rilevabili
- **File**: `src/browser/humanBehavior.ts:scrollPage()`
- **Fix**: Profilo velocità variabile: fast iniziale, slow down random, pausa reading 30%, scroll-back 5%.

### M15 — Decoy search terms: lista hardcoded 80+ parole → pattern rilevabile
- **File**: `src/browser/humanBehavior.ts:DECOY_SEARCH_TERMS`
- **Fix**: Personalizzare decoy in base al settore dei lead target. Non cercare "agritech" se fai outreach finanza.

### M16 — performDecoyAction: naviga in sezioni NON correlate al lavoro
- **File**: `src/browser/humanBehavior.ts:performDecoyAction()`
- **Fix**: Decoy coerenti con il settore/industria dei lead target.

### M17 — interactWithFeed: mette like al primo post senza verificare contenuto
- **File**: `src/browser/organicContent.ts:reactToPost()`
- **Fix**: Filtro contenuto base: no post politici/controversi.

### M18 — Orari attività non calibrati per timezone
- **File**: `src/risk/strategyPlanner.ts`
- **Fix**: Aggiungere `activeHoursStart`/`End` per timezone dell'account.

### M19 — Search query rate limit margin solo 17%
- **File**: `src/core/scheduler.ts`
- **Fix**: Ridurre a 200/giorno (33% margine). Dynamic adjustment basato su risk score.

### M20 — Backpressure solo per account, non per tipo di worker
- **File**: `src/sync/backpressure.ts`
- **Fix**: Estendere con granularità per JobType.

### M21 — Dead letter queue senza recovery
- **File**: `src/workers/deadLetterWorker.ts`
- **Fix**: Retry selettivo dopo cooldown, alert aggregato Telegram, CLI command `dead-letter --retry`.

### M22 — Gap sync-search → send-invites: messaggio "0 lead" senza spiegare che manca enrichment
- **File**: `src/workflows/sendInvitesWorkflow.ts:163-182`
- **Fix**: Messaggio chiaro: "200 lead nel DB ma nessuno arricchito. Esegui enrichment prima."

### M23 — Nessun workflow traccia QUANTO TEMPO il lead sta in ogni stato
- **File**: `src/core/leadStateService.ts`
- **Fix**: Tabella `lead_state_history` con `from_status`, `to_status`, `transitioned_at`, `duration_seconds`.

### M24 — Cookie anomaly detection non blocca il workflow → logga solo warning
- **File**: `src/browser/sessionCookieMonitor.ts`
- **Fix**: Se COOKIE_MISSING o COOKIE_CHANGED → fermare il workflow + alert critico.

### M25 — Nessun check modale residuo al boot
- **File**: `src/index.ts`, `src/core/jobRunner.ts`
- **Fix**: Al boot, verificare se c'è un modale aperto. Se sì → chiuderlo.

### M26 — Challenge resolver: cap giornaliero in-memory → reset su restart
- **File**: `src/workers/challengeHandler.ts`
- **Problema**: `challengeResolutionsToday` è una variabile in-memory. Con 5 riavvii → 15 challenge, non 3.
- **Fix**: Persistere il contatore nel DB tramite daily_stats.

### M27 — Fingerprint pool: solo 14 fingerprint totali (8 desktop + 6 mobile)
- **File**: `src/fingerprint/pool.ts`
- **Fix**: Espandere a 50-100. Aggiornare Chrome/Firefox versions periodicamente.

### M28 — Tutti i locale hardcoded 'it-IT' nel fingerprint pool
- **File**: `src/fingerprint/pool.ts`
- **Fix**: Derivare locale dall'account/config. Supportare en, de, fr, nl.

### M29 — Follow-up cadence troppo complessa → impossibile da debuggare e spiegare al cliente
- **File**: `src/workers/followUpWorker.ts:resolveFollowUpCadence()`
- **Problema**: Base delay per intent × escalation multiplier + jitter gaussiano deterministico con hash FNV-1a del leadId. Il cliente chiede "perché Mario non ha ricevuto il follow-up?" e servono 20 minuti di debug. Nessuno può prevedere quando un follow-up partirà.
- **Fix**: Semplificare con cadenza esplicita: `[{ afterDays: 3, tone: 'gentle_reminder' }, { afterDays: 7, tone: 'value_add' }, { afterDays: 14, tone: 'final_check' }]`. MAX 3 follow-up. Delay fisso + jitter 0-1 giorno.

### M30 — Auto-reply inbox senza cap giornaliero → solo cap per run
- **File**: `src/workers/inboxWorker.ts`
- **Problema**: `config.inboxAutoReplyMaxPerRun` limita le risposte per singola esecuzione, ma se il bot viene eseguito 10 volte/giorno → 10 × maxPerRun auto-risposte. Non c'è un cap giornaliero globale.
- **Fix**: Aggiungere `checkAndIncrementDailyLimit(localDate, 'auto_replies', config.maxAutoRepliesPerDay)`.

### M31 — performance.memory mock: crescita troppo lineare → pattern rilevabile
- **File**: `src/browser/stealthScripts.ts:sezione 12`
- **Problema**: Il mock simula crescita heap a 800KB/min costante. Un browser reale ha picchi (apertura tab, caricamento pagina) e GC drops improvvisi. La crescita perfettamente lineare è rilevabile.
- **Fix**: Aggiungere picchi casuali (+2-5MB) e GC drops (-10-30%) con probabilità 10% ad ogni lettura.

### M32 — MOUSE_MOVE_TIMEOUT_MS=3000ms potrebbe essere troppo breve
- **File**: `src/browser/humanBehavior.ts`
- **Problema**: Su connessioni lente o browser virtuali, 3000ms potrebbe non bastare per completare il movimento mouse → timeout errore.
- **Fix**: Rendere configurabile via config o aumentare a 5000ms.

### M33 — Pool fingerprint Firefox ridotto rispetto a Chrome
- **File**: `src/browser/stealth.ts`, `src/fingerprint/pool.ts`
- **Problema**: Il pool Firefox è ridotto rispetto al pool Chrome → minor randomizzazione per account che usano Firefox/Camoufox.
- **Fix**: Espandere il pool Firefox con più fingerprint realistici.

### M34 — Proxy cooldown fisso 10min indipendentemente dal tipo di errore
- **File**: `src/proxyManager.ts`
- **Problema**: Dopo un errore proxy, il cooldown è fisso a 10 minuti qualunque sia l'errore. Ban IP, timeout, e rifiuto connessione hanno gravità molto diverse.
- **Fix**: Differenziare: ban IP → 2h, timeout → 5min, rifiuto connessione → 15min.

### M35 — PostgreSQL senza connection pooling esplicito
- **File**: `src/db.ts`
- **Problema**: La connessione PostgreSQL non usa connection pooling esplicito (es. pg-pool). Rischio di connection exhaustion ad alto carico.
- **Fix**: Aggiungere pg-pool con `max: 10` connections per istanza.

### M36 — jobRunner doppio controllo challenge → race condition
- **File**: `src/core/jobRunner.ts`
- **Problema**: Il challenge detection avviene sia in jobRunner che nel worker. Può creare race condition con doppie gestioni dello stesso challenge.
- **Fix**: Centralizzare challenge detection solo in jobRunner. Workers non rilevano challenge.

### M37 — v1 API routes senza autenticazione JWT
- **File**: `src/api/routes/v1Automation.ts`
- **Problema**: Le route v1 usano solo session cookie, non JWT. Non adatte per integrazioni machine-to-machine.
- **Fix**: Aggiungere supporto API key per integrazioni esterne.

### M38 — visionNavigator usa screenshot piena pagina → slow + più token AI
- **File**: `src/salesnav/visionNavigator.ts`
- **Problema**: Lo screenshot è full-page invece di ritagliare la zona target. Più lento e consuma più token AI.
- **Fix**: Usare screenshot `clip` area dell'elemento target per ridurre dimensione immagine e token.

### M39 — Nota invito > 300 caratteri non verificata prima dell'invio
- **File**: `src/workers/inviteWorker.ts`
- **Problema**: LinkedIn ha un limite di 300 caratteri per la nota invito. L'inviteWorker non verifica la lunghezza prima di cliccare Invia.
- **Fix**: Troncare/riformulare nota > 280 char (buffer sicurezza) prima dell'invio.

### M40 — INVITE_NOTE_MODE=none diventa silenziosamente 'template'
- **File**: `src/config/domains.ts:384`
- **Problema**: Il parser config fa `=== 'ai' ? 'ai' : 'template'` — se l'utente imposta `INVITE_NOTE_MODE=none`, viene convertito in `'template'` senza warning. I worker controllano per `'none'` ma il config non lo permette.
- **Fix**: Aggiungere `'none'` come terzo valore valido: `'ai' | 'template' | 'none'`. Aggiornare il parser e il tipo `AppConfig`.

### M41 — performance.memory mock solo Chromium → rilevabile su Firefox
- **File**: `src/browser/stealthScripts.ts:461-479`
- **Problema**: Il mock di `performance.memory` (crescita heap progressiva) viene iniettato solo se `performance.memory` non esiste. In Firefox `performance.memory` non esiste per spec (non-standard). Un detector che controlla `typeof performance.memory === 'undefined'` sa che è Firefox (ok) MA se CloakBrowser/Camoufox lo patcha a livello C++, il mock JS qui viene saltato.
- **Fix**: Nessuna azione urgente — il mock è corretto per Chromium. Documentare che in Firefox `performance.memory` è assente by design.

### M42 — Mouse move timeout 8s → abort silenzioso → potenziale "mouse teleport"
- **File**: `src/browser/humanBehavior.ts:39-58`
- **Problema**: `MOUSE_MOVE_TIMEOUT_MS = 8_000`. Se il mouse move impiega >8s (conflitto Camoufox, browser lento, page navigating), il movimento viene abortito silenziosamente e `undefined` viene restituito. La prossima azione non verifica che la posizione sia corretta → il mouse potrebbe "teletrasportarsi" al target.
- **Fix**: Dopo abort timeout, aggiornare `pageMouseState` con la posizione dell'ultimo punto raggiunto (non il target). Log warning per monitorare frequenza timeout.

### M43 — checkAndIncrementDailyLimit: potenziale race condition su PostgreSQL
- **File**: `src/core/repositories/stats.ts:663-683`
- **Problema**: L'upsert atomico `INSERT ... ON CONFLICT DO UPDATE SET field = field + 1 WHERE field < ?` è atomico su SQLite (single-writer). Su PostgreSQL con worker concorrenti, due transazioni potrebbero leggere lo stesso valore e entrambe incrementare, superando il cap di 1. Non critico (off-by-one) ma viola il principio di atomicità.
- **Fix**: Aggiungere `FOR UPDATE` lock sulla riga daily_stats prima dell'upsert su PostgreSQL, oppure usare `pg_advisory_xact_lock()`.

### M44 — AI validation pipeline: solo 4 seed samples → insufficiente per confidence statistica
- **File**: `src/core/repositories/aiQuality.ts:36-69`
- **Problema**: `DEFAULT_AI_VALIDATION_SAMPLES` ha solo 4 campioni (1 positive-call, 1 price-question, 1 invite, 1 message). Con 4 campioni, anche un 100% match rate non è statisticamente significativo. Il pipeline gira ma i risultati non sono affidabili.
- **Fix**: Aggiungere almeno 20-30 campioni di seed (5+ per ogni intent type × 3 lingue). Aggiungere edge case: messaggi ambigui, emoji, abbreviazioni, inglese/italiano mix.

### M45 — Feature store raccoglie dati ML ma nessun modello li consuma
- **File**: `src/core/repositories/featureStore.ts` (648 righe)
- **Problema**: `buildFeatureDatasetVersion()` estrae features (segment, timing, scores, intent) e le divide in train/validation/test. Ma nessun modulo nella codebase importa queste features per addestrare un modello ML. Il feature store è infrastruttura senza consumatore.
- **Fix**: Documentare il feature store come "pronto per ML futuro". Oppure implementare un modello di scoring lead basato sulle features (sostituzione dello scoring AI sequenziale — fixa M06).

### M46 — hygieneWorker: HYGIENE_DAILY_WITHDRAW_CAP=10 hardcoded, non configurabile
- **File**: `src/workers/hygieneWorker.ts:12`
- **Problema**: `const HYGIENE_DAILY_WITHDRAW_CAP = 10` — il cap giornaliero di ritiro inviti è hardcoded. Se il pending ratio è alto e servono più ritiri urgenti, l'utente non può aumentare il cap senza modificare il codice.
- **Fix**: Renderlo configurabile via `HYGIENE_DAILY_WITHDRAW_CAP` env var con default 10.

### M47 — deadLetterWorker non nel workerRegistry → pattern inconsistente
- **File**: `src/workers/deadLetterWorker.ts`, `src/workers/registry.ts`
- **Problema**: Il `deadLetterWorker` è chiamato direttamente da `loopCommand.ts`, non tramite il `workerRegistry`. Questo rompe il pattern centralizzato: se qualcuno cerca "quali worker esistono?" nel registry, non lo trova. Stesso problema di `inboxWorker` (C09) ma meno critico.
- **Fix**: Documentare l'architettura: registry = worker che processano job dalla coda. deadLetterWorker e inboxWorker sono "meta-worker" che non processano job singoli. Aggiungere commento in `registry.ts`.

### M48 — personDataFinder latenza 30-60s per lead → compone H08 durante sessione browser
- **File**: `src/integrations/personDataFinder.ts:132-136`
- **Problema**: `SCRAPE_TIMEOUT_MS = 12_000`. La pipeline OSINT 7-fase (homepage scrape + DNS + sitemap + team page × 3 + contact page × 2 + phones + socials GitHub/Gravatar/StackOverflow) può impiegare 30-60s per lead. Quando `enrichLeadAuto()` è chiamato dall'`inviteWorker` (H08) durante la sessione browser, aggiunge 30-60s di pausa in cui il browser è idle su LinkedIn → pattern sospetto.
- **Fix**: Separare l'enrichment profondo dalla sessione browser. L'inviteWorker dovrebbe usare solo dati già in cache (dal pre-enrichment offline). Se mancano → skip enrichment, non bloccare.

### M49 — inviteNotePersonalizer: trimToMaxChars esiste ma inviteWorker non la chiama
- **File**: `src/ai/inviteNotePersonalizer.ts:100-105` vs `src/workers/inviteWorker.ts:459-466`
- **Problema**: `trimToMaxChars(note, 300)` esiste in `inviteNotePersonalizer.ts` e viene chiamata internamente da `buildPersonalizedInviteNote()`. MA se il template diretto viene usato (senza passare per build*), il testo potrebbe non essere troncato. Inoltre, `handleInviteModal()` nell'inviteWorker non fa un check finale sulla lunghezza prima di `humanType()`.
- **Fix**: Aggiungere `note = note.slice(0, 295)` come safety net in `handleInviteModal()` prima del typing. Costa 0 performance, previene errori LinkedIn.

---

## 🏗️ ARCHITETTURA & TECH DEBT

### A01 — God Module: repositories/ = 7111 righe, 233 export
- **File**: `src/core/repositories/*.ts`
- **Fix**: Separare per dominio: `leadRepository.ts` (max 20 funzioni), `jobRepository.ts`, `campaignRepo.ts`, etc.

### A02 — jobRunner.ts: 650 righe, 23 import — fa tutto
- **File**: `src/core/jobRunner.ts`
- **Fix**: Estrarre 4 moduli: `SessionLifecycleManager`, `JobExecutor`, `JobSafetyNet`, `SessionBehavior`.

### A03 — Zero Dependency Injection: 194 chiamate dirette getDatabase()
- **File**: Intero progetto
- **Fix**: `AppContext` come DI container. Ogni modulo lo riceve come parametro.

### A04 — 256 empty catch blocks → errori silenti in produzione
- **File**: Intero progetto
- **Fix**: Regola ZERO catch vuoti. Al minimo: `catch (err) { void logWarn('module.op.fail', { error: err }); }`. ESLint rule `no-empty`.

### A05 — Sequential accounts: for loop → non scala oltre 5-10 account
- **File**: `src/core/jobRunner.ts`, `src/accountManager.ts`
- **Fix**: Worker pool parallelo con `p-limit(config.maxConcurrentAccounts || 3)`. Prerequisito: proxy diverso per account.

### A06 — SQLite in production: single-writer lock
- **File**: `src/db.ts`
- **Fix**: PostgreSQL obbligatorio in produzione. SQLite solo dev/test.

### A07 — Global mutable state: circuitStates, proxyFailureUntil
- **File**: `src/risk/httpThrottler.ts`, `src/proxyManager.ts`
- **Fix**: Stato condiviso su DB o Redis. Il codice per persistere esiste già → renderlo source of truth.

### A08 — 8% test coverage: 18 test per 216 file
- **File**: `tests/`
- **Top 10 da testare**: riskEngine, scheduler, leadStateService, messageValidator, integrationPolicy, accountBehaviorModel, timingOptimizer, messagePersonalizer, inviteNotePersonalizer, proxyManager.

### A09 — CSS selectors: 12 classi artdeco + 18 stringhe italiane hardcoded
- **File**: `src/selectors/*.ts`, `src/workers/*.ts`
- **Fix**: i18n map con auto-detect `document.documentElement.lang`. Preferire `[aria-label]` e `[role]` a classi CSS.

### A10 — Delay creep: ogni fix aggiunge delay, mai rimosso
- **Fix**: Tracciare `totalDelayMs` vs `totalActionMs`. Cap delay ratio max 60%. Review trimestrale.

### A11 — No trust-based acceleration: impara solo a rallentare
- **Fix**: Account con 30+ giorni senza incident → `inviteFactor: 1.3`, `interJobDelay: -20%`.

### A12 — 11 fire-and-forget promises che perdono dati critici
- **File**: `src/core/jobRunner.ts`
- **Fix**: Classificare in 3 tier: MUST (await), SHOULD (try/catch + log), NICE (fire-and-forget OK).

### A13 — No incident classification: non distingue "nostro bug" vs "LinkedIn changed"
- **Fix**: Stesso errore su 3+ account → "LinkedIn changed". Solo su 1 → "account-specific".

### A14 — No rollback plan: no Docker tags, no feature flags, no canary deploy
- **Fix**: Docker image tagging, feature flags, canary su 1 account prima di rollout.

### A15 — No client-facing story → metriche esistono ma non leggibili per il cliente
- **File**: `src/telemetry/`, `src/api/`
- **Problema**: Il sistema traccia KPI dettagliati (acceptance rate, response rate, daily stats). Ma l'unico modo per vederli è via API JSON o CLI. Nessun report settimanale leggibile dal cliente. Il daily report Telegram è tecnico. Un CEO non vuole vedere `{"invites_sent": 28, "acceptance_rate_pct": 34.2}`.
- **Fix**: Timeline giornaliera leggibile: "09:15 Sessione avviata | 09:35 15/15 inviti (0 errori) | 09:38 Chiusa ✅". Weekly report: "68 inviti, 12 accettati (17.6%), risk 28/100 (BASSO)". Alert cliente: non "PROXY_FAILED" ma "pausa tecnica, risolviamo in 2h".

### A16 — LinkedIn dependency risk → 100% del valore dipende da LinkedIn
- **File**: Architettura
- **Problema**: Se LinkedIn cambia UI radicalmente, blocca JA3, implementa device attestation, o riduce limiti a 20/settimana, il business muore in una settimana. Nessuna diversificazione (email outreach, altre piattaforme). Nessun "graceful degradation" — o funziona tutto o niente.
- **Fix**: Monitoring meta-rischio (trend % ban, % challenge, % selector fail — se sale → LinkedIn sta stringendo → ALERT precoce). Simulare scenari estremi: "E se il rate limit = 20/settimana?". Piano B documentato.

### A17 — File troppo lunghi da accorciare (dati reali dal progetto)

> `Get-ChildItem -Recurse -Filter "*.ts" | sort Lines DESC` — file con >500 righe.
> Un file >500 righe è difficile da mantenere, testare, e revieware. >1000 righe è un red flag.

| File | Righe | Cosa contiene | Come accorciare |
|------|-------|---------------|-----------------|
| `salesnav/bulkSaveOrchestrator.ts` | **2576** | Pre-sync + ricerche + scroll + select all + save + paginazione + AI health + anti-detection | Estrarre: `PreSyncManager` (~400 righe), `SearchPageProcessor` (~300 righe), `PaginationManager` (~200 righe), `ScrollEngine` (già parzialmente in `bulkSaveHelpers.ts` ma `scrollAndReadPage` è ancora qui) |
| `tests/integration.ts` | **1607** | Tutti i test di integrazione in un file | Dividere per area: `integration/boot.test.ts`, `integration/invite.test.ts`, `integration/message.test.ts`, `integration/sync.test.ts` |
| `browser/humanBehavior.ts` | **1306** | Mouse, delay, scroll, typing, decoy, missclick, tab switch, dwell, wind-down, coffee break | Estrarre: `ScrollBehavior` (~200 righe), `TypingBehavior` (~200 righe), `DecoyActions` (~150 righe), `SessionBehavior` (wind-down, coffee break ~150 righe) |
| `core/repositories/leadsCore.ts` | **1231** | CRUD leads, query per stato, lista, scoring, bulk operations | Dividere per dominio: `leadQueries.ts` (read), `leadMutations.ts` (write), `leadBulkOps.ts` (batch) |
| `integrations/personDataFinder.ts` | **1128** | Enrichment persona da fonti web | Estrarre per fonte: `linkedinScrapeEnricher.ts`, `webSearchEnricher.ts` (già parzialmente separato), `socialProfileFinder.ts` |
| `cli/commands/adminCommands.ts` | **1011** | 20+ comandi admin in un file | Dividere: `adminDbCommands.ts`, `adminSecurityCommands.ts`, `adminDiagCommands.ts` |
| `core/jobRunner.ts` | **1005** | Setup sessione + main loop + error handling + cleanup (già in **A02**) | Estrarre: `SessionLifecycleManager`, `JobExecutor`, `JobSafetyNet`, `SessionBehavior` |
| `core/repositories/system.ts` | **968** | Runtime flags, outbox, pause, sync status, health | Dividere: `runtimeFlags.ts`, `outboxRepository.ts`, `healthRepository.ts` |
| `core/repositories/stats.ts` | **949** | Tutte le statistiche + aggregazioni | Dividere: `dailyStats.ts`, `weeklyStats.ts`, `aggregations.ts` |
| `core/scheduler.ts` | **888** | Budget + timing + enqueue + multi-lista + risk integration | Estrarre: `BudgetCalculator` (~300 righe), `JobEnqueuer` (~200 righe) |
| `api/server.ts` | **867** | Express server + middleware + 11 route groups | Estrarre ogni route group in file separato (parzialmente fatto ma `server.ts` ancora enorme) |
| `cli/commands/loopCommand.ts` | **827** | Loop + autopilot + cycle management | Estrarre: `AutopilotEngine` (~400 righe) |
| `core/repositories/leadsLearning.ts` | **820** | ML features per leads | OK se ben organizzato — verificare |
| `browser/stealthScripts.ts` | **604** | 19 sezioni anti-detection iniettate nel browser | Non accorciare (è codice iniettato, deve stare insieme). Ma documentare ogni sezione. |
| `browser/uiFallback.ts` | **612** | Self-healing selectors a 5 livelli | Non accorciare (è un modulo coeso e ben fatto). |

**Regola proposta**: file >500 righe → candidato per split. File >800 righe → split obbligatorio al prossimo refactor. File >1000 righe → split urgente.

### A18 — Config sprawl: 100+ parametri .env senza schema validation
- **File**: `src/config/index.ts` (622 righe), `src/config/validation.ts` (437 righe), `src/config/types.ts` (332 righe)
- **Problema**: 100+ variabili d'ambiente da configurare. Nessuna validazione di schema (Zod, Joi). `CONFIG_REFERENCE.md` già outdated. Un utente mette `HARD_INVITE_CAP=500` pensando sia sicuro → bot invia 500 inviti reali. Nessun profilo "sicuro" vs "aggressivo" pre-testato.
- **Fix**: Schema Zod con min/max/default per ogni parametro. 3 profili pre-testati: `conservative` (account nuovi), `moderate` (default), `aggressive` (account maturi). Il cliente sceglie il profilo, non i singoli parametri. Auto-generare `CONFIG_REFERENCE.md` dallo schema.

### A19 — repositories/ totale: 5 file × 800-1200 righe = ~5000 righe di query
- **File**: `leadsCore.ts` (1231), `system.ts` (968), `stats.ts` (949), `leadsLearning.ts` (820), `jobs.ts` (301), `aiQuality.ts` (612), `featureStore.ts` (599), `salesnavSync.ts` (471) + barrel `repositories.ts`
- **Problema**: A01 parla del barrel con 233 export, ma il problema vero è che i singoli file sono ANCHE troppo lunghi. `leadsCore.ts` da solo è 1231 righe. Un dev che cerca una funzione non sa in quale dei 8 file guardare.
- **Fix**: Per ogni repository file >500 righe: separare queries READ (SELECT) da mutations WRITE (INSERT/UPDATE/DELETE). Aggiungere JSDoc con `@category` per raggruppamento logico.

### A20 — Nessun monitoraggio performance dei file: delay creep non misurabile
- **File**: Intero progetto
- **Problema**: A10 dice "delay creep" ma non c'è modo di MISURARLO. Nessuna metrica traccia `totalDelayMs` vs `totalActionMs` vs `totalSessionMs`. Senza dati, non si può decidere quali delay rimuovere.
- **Fix**: Aggiungere instrumentazione: `performance.mark()` per ogni fase (warmup, navigate, dwell, type, delay, enrichment). Report a fine sessione: "Tempo totale 25min. Di cui: delay 15min (60%), azioni 8min (32%), overhead 2min (8%)". Se delay > 60% → alert.

### A21 — DB layer dual-mode SQLite/PG: 8+ regex di normalizzazione SQL per ogni query
- **File**: `src/db.ts:148-203`
- **Problema**: `normalizeSql()` applica 8 regex (`DATETIME → CURRENT_TIMESTAMP`, `INSERT OR IGNORE → ON CONFLICT DO NOTHING`, `? → $1`, etc.) ad OGNI query PostgreSQL. Cache LRU (max 500) mitiga, ma le prime 500 query uniche pagano il costo regex ogni volta. Inoltre, `STRFTIME` usato in `stats.ts` e `timingOptimizer.ts` NON viene normalizzato → query che usano STRFTIME falliscono su PostgreSQL.
- **Fix**: 1) Sostituire le regex runtime con query builder type-safe (Knex o Drizzle). 2) In alternativa, pre-compilare le query normalizzate a build time. 3) Audit tutte le query con STRFTIME e sostituirle con funzioni compatibili.

### A22 — Circular dependency catena AI: 4 cicli dalla stessa radice
- **File**: `ai/openaiClient.ts → core/integrationPolicy.ts → core/repositories.ts → core/repositories/aiQuality.ts → ai/inviteNotePersonalizer.ts` (e 3 varianti)
- **Problema**: Confermato con `madge --circular`: 4 delle 8 circular dependencies partono dalla stessa catena `openaiClient → integrationPolicy → repositories → aiQuality → ai/*`. `aiQuality.ts` importa direttamente `inviteNotePersonalizer.ts`, `messagePersonalizer.ts` e `sentimentAnalysis.ts` per il validation pipeline. Questo crea un ciclo attraverso 4 file.
- **Fix**: Estrarre `aiQuality.ts` dal barrel `repositories.ts` e usare lazy import (`await import()`) per le dipendenze AI nel validation pipeline. Oppure: spostare il validation pipeline in un modulo separato `ai/qualityPipeline.ts` che non viene importato dal barrel.

---

## ✅ COSE BEN FATTE — Da non toccare

| Modulo | Perché è buono |
|--------|---------------|
| **Mouse Bezier** (`ml/mouseGenerator.ts`) | 4 fasi (drift→approach→overshoot→correction), fractal noise, micro-tremor 8-12Hz, Fitts' Law easing. Livello accademico. |
| **Timing model** (`ml/timingModel.ts`) | Log-normale con Box-Muller, fatigue factor, content awareness, per-account multiplier. |
| **Typo generator** (`ai/typoGenerator.ts`) | Rate variabile per account+ora+fatica, 4 tipi typo, QWERTY adjacency con lettere italiane. Session typo rate con seed deterministico. |
| **Self-healing selectors** (`browser/uiFallback.ts`) | 5 livelli fallback: context cache → dynamic DB → static → Shadow DOM → Vision AI. 669 righe di codice sofisticato. |
| **Selector learner** (`selectors/learner.ts`) | Promozione selettori da fallback a primari basata su success count. Rollback automatico se failure rate aumenta post-promozione. Degradation assessment con soglie configurabili. |
| **Backpressure distribuita** (`sync/backpressure.ts`) | 8 livelli persistiti in DB, auto-regolazione con failure/success. |
| **Session maturity** (`sessionCookieMonitor.ts`) | Cookie 0-2gg: 30% budget. 2-7gg: 60%. 7+gg: 100%. Eccellente anti-ban. |
| **Behavioral profile** (`sessionCookieMonitor.ts`) | Abitudini deterministiche per account, persistite tra sessioni. |
| **HTTP throttler** (`risk/httpThrottler.ts`) | Sliding window 50 campioni, trimmed mean baseline, rileva rallentamento LinkedIn PRIMA del 429. |
| **Session memory** (`risk/sessionMemory.ts`) | Cross-session learning: pacing factor basato su storico challenge. Upsert con aggregazione incrementale. |
| **Incident manager** (`risk/incidentManager.ts`) | Exponential backoff per 429 (2^N × baseMinutes, max 24h). Quarantine + audit trail + cloud sync. Challenge → reconcile lead + pause. |
| **Cloud bridge** (`cloud/cloudBridge.ts`) | Fire-and-forget con outbox fallback su errore. SQLite = source of truth, cloud = replica. Nessun errore cloud blocca il flusso. |
| **Message prebuild** (`workers/messagePrebuildWorker.ts`) | Pre-genera messaggi AI offline in batch → zero latenza durante sessione browser. Scadenza 48h per messaggi non usati. |
| **DB dual-mode** (`db.ts`) | SQLite + PostgreSQL con astrazione comune. AsyncLocalStorage per contesto transazionale. Nested transactions via SAVEPOINT. WAL mode + PRAGMA ottimizzati. Query profiling opzionale. |
| **Dashboard security** (`api/server.ts`) | Session cookie con hash SHA256, TOTP 2FA, rate limiting per client (non solo IP), IP lockout dopo 5 failure, CORS ristretto, CSP header, timing-safe comparison. |
| **Daily reporter** (`telemetry/dailyReporter.ts`) | Report Telegram ricco: funnel, hot leads, A/B stats, timing slots, SLO/SLA, selector cache KPI, proxy status, ban probability, pending ratio trend vs ieri, suggerimenti automatici (ritiro inviti). |
| **Site check** (`core/audit.ts`) | Verifica coerenza DB ↔ LinkedIn reale. Auto-fix per 6 tipi di mismatch. Evidence screenshot per review manuale. |
| **Security advisor** (`core/securityAdvisor.ts`) | 6 check: threat model freshness, secret rotation, open incidents, DR restore drill, audit activity, security doc. Report JSON persistito. |
| **Enrichment pipeline** (`integrations/`) | 6 fonti (Apollo → Hunter → EmailGuesser → Clearbit → PersonDataFinder OSINT 7-fase → WebSearch DuckDuckGo). Domain discovery automatica (Clearbit autocomplete → DNS probe → pattern heuristic). Business email classificazione. Zero API cost per 3 fonti. |
| **A/B Bandit** (`ml/abBandit.ts`) | Thompson Sampling bayesiano con prior Beta. Segmentazione per job_title + hour bucket. Fallback 3 livelli (segment:hour → segment base → global). Gate di significatività statistica (z-test 2-proportion). |
| **Timing optimizer** (`ml/timingOptimizer.ts`) | Data-driven: analizza storico invite/message per hour × dayOfWeek. Bayesian slot scoring con recent weight. A/B experiment baseline vs optimizer. Segment-aware. |
| **Growth model** (`risk/accountBehaviorModel.ts`) | 4 fasi (browse_only → soft_outreach → moderate_growth → full_budget) con intra-phase ramp. Trust score composito (SSI 30% + age 25% + acceptance 25% + challenges 10% + pending 10%). |
| **Ramp model non-lineare** (`ml/rampModel.ts`) | Logistic sigmoid per curva crescita. 4 penalty (risk, pending, error, health). Downscale 35% più veloce di upscale. |
| **Stealth scripts** (`browser/stealthScripts.ts`) | 19 sezioni anti-detection: WebRTC kill, webdriver delete, plugins mock, languages, window.chrome, permissions, headless guards, hwconcurrency, battery mock dinamico, notification, audio noise PRNG, deviceMemory, colorDepth, performance.memory crescente, font enumeration defense, OS consistency, language consistency, CDP leak bypass, iframe chrome consistency. |
| **Input blocking** (`browser/humanBehavior.ts`) | Overlay full-screen che blocca click/scroll/keyboard utente ma lascia passare eventi CDP del bot via dataset flag. Re-iniettato dopo navigazione. Toast "Automazione in corso" su click utente. |
| **Hygiene worker** (`workers/hygieneWorker.ts`) | 3-fase ritiro inviti (click Pending → Withdraw dropdown → confirm modal). Vision AI fallback per ogni fase. Transition a WITHDRAWN con tracking. |
| **Interaction worker** (`workers/interactionWorker.ts`) | VIEW_PROFILE, LIKE_POST, FOLLOW per warm-touch pre-invito nelle drip campaigns. Blacklist check + daily cap per profile views. |
| **Dead letter worker** (`workers/deadLetterWorker.ts`) | Analisi errori con heuristic (recoverable vs terminal). Recycle una volta con delay 24h + jitter. Cap anti-recycling infinito via priority marker. |
| **Circuit breaker** (`core/integrationPolicy.ts`) | CLOSED/OPEN/HALF_OPEN con probe singola. Persistito in DB tra riavvii. Exponential backoff + jitter. Proxy dispatcher via undici per integration requests. |
| **Confidence check** (`inviteWorker.ts`) | Verifica testo bottone prima di cliccare + post-action verify. |
| **Phantom increment compensation** (`inviteWorker.ts`) | Cap atomico pre-click + decremento se fallisce. |
| **Message prebuild** (`workers/messagePrebuildWorker.ts`) | Pre-genera messaggi AI offline, zero latenza runtime, scadenza 48h. |
| **Recovery automatico al boot** (`index.ts`) | Stuck jobs, stuck leads, stuck posts ripristinati automaticamente. |
| **Resume logic sync** (`bulkSaveOrchestrator.ts`) | Sync run tracciato nel DB, resume dopo crash, cleanup zombie run. |
| **AI health check** (`bulkSaveOrchestrator.ts`) | DOM-first check + Vision AI conferma. Circuit breaker dopo 2 fail. |
| **Virtual scroller handling** | Raccoglie profili DURANTE lo scroll in Map lato Node. |
| **Proxy ASN classification** (`proxyQualityChecker.ts`) | Score: mobile 90, residential 70, datacenter 20. |
| **JA3 coherence check** (`ja3Validator.ts`) | Verifica UA↔TLS family match. |
| **Profile dwell time** (`humanBehavior.ts`) | Budget proporzionale a ricchezza profilo (4-20s). |
| **Missclick simulation** (`missclick.ts`) | 2% click su zona vuota, safety check bottoni pericolosi, solo in fase idle. |

---

## 📋 PRODUCTION READINESS CHECKLIST

- [ ] Health check endpoint
- [ ] Metrics exporter (Prometheus/Grafana)
- [ ] Alerting su failure rate
- [x] Graceful shutdown
- [ ] Auto-recovery dopo crash
- [ ] Log strutturati JSON con correlation ID
- [ ] Database backup automatico
- [ ] Rate limit dashboard real-time
- [ ] Error tracking centralizzato
- [ ] CI/CD pipeline
- [x] Environment config (dev/staging/prod)
- [x] Secret management

---

## 📌 ORDINE DI ESECUZIONE CONSIGLIATO

> **⚠️ OGNI fix DEVE passare i 6 livelli di controllo (L1→L6) documentati sopra.**
> Workflow per ogni fix: `pre-modifiche` → 5 domande anti-ban → implementazione → `conta-problemi` EXIT 0 → L1→L2→L3→L4→L5→L6 → commit.
> Se un livello trova un problema → STOP e fixare prima di procedere.
>
> **⚠️ DIPENDENZE TRA FIX**: I fix sono raggruppati per FILE CONDIVISI.
> Fix che toccano lo stesso file DEVONO essere fatti nella stessa fase per evitare conflitti e rework.

### Fase 1 — Boot sicuro (C01-C03, C13)
**File toccati**: `index.ts`, `proxyManager.ts`, `proxy/ja3Validator.ts`, `workers/challengeHandler.ts`
**Nessun conflitto** — file isolati dal resto.

| Fix | File principale | Cosa fa |
|-----|----------------|---------|
| C01 | `index.ts:375-420` | Invertire ordine: proxy check PRIMA del doctor |
| C02 | `index.ts:407-420` | Se proxy fallisce → `process.exit(1)` |
| C03 | `index.ts:407-420` | Aggiungere check CycleTLS nello stesso blocco |
| C13 | `workers/challengeHandler.ts:21` | Persistere counter in DB invece di `let` in-memory |
| M01 | `config/validation.ts` | Aggiungere min/max range su cap numerici (fare insieme a C01-C03) |

### Fase 2 — Navigazione unificata + Identity check (C04, C05, C11, H02, R04)
**File toccati**: `navigationContext.ts`, `inviteWorker.ts`, `messageWorker.ts`, `followUpWorker.ts`, `acceptanceWorker.ts`
**⚠️ DIPENDENZA CRITICA**: C04, C05, C11, H02 toccano TUTTI la navigazione. Fare R04 (funzione unificata) PRIMA, poi i fix si applicano al codice unificato. Se fai C05 da solo, poi R04 rifà tutto.

| Fix | File principale | Cosa fa |
|-----|----------------|---------|
| **R04** | `navigationContext.ts` (NUOVO) | Creare `navigateToProfile(page, url, {purpose, sessionContext})` unificata |
| C04 | `inviteWorker.ts` + navigazione unificata | Aggiungere `observePageContext()` → leggi h1, verifica identità |
| C05 | navigazione unificata | Passare `sessionInviteCount` correttamente → decay funzionante |
| C11 | `followUpWorker.ts` | Sostituire `page.goto()` con navigazione unificata |
| H02 | navigazione unificata | Organic search → poi navigazione ORGANICA al profilo (non goto) |
| M10 | `inviteWorker.ts:339-346` | Visita attività recente → tornare con history.back, non goto |

### Fase 3 — Inbox + Follow-up safety (C06, C07, C09, C14, R03, R07)
**File toccati**: `inboxWorker.ts`, `followUpWorker.ts`, `messageWorker.ts`, `workers/registry.ts`, `loopCommand.ts`
**⚠️ DIPENDENZA CRITICA**: C06 (follow-up non verifica risposte) e C09 (inbox non nel ciclo) sono lo STESSO problema visto da due lati. C07 (messaggio senza leggere chat) è correlato. Fixarli insieme.

| Fix | File principale | Cosa fa |
|-----|----------------|---------|
| **C09** | `workers/registry.ts` + `inboxWorker.ts` | Aggiungere INBOX_CHECK al registry |
| **R03** | `inboxWorker.ts` + `jobRunner.ts` | Integrare inbox check PRIMA di follow-up nel ciclo standard |
| C06 | `followUpWorker.ts` | Dopo R03: query ESCLUDE lead con intent REPLIED/POSITIVE |
| C07 | `messageWorker.ts` | Leggere ultimi 3 messaggi nella chat PRIMA di digitare |
| C14 | `loopCommand.ts` | Autopilot: inbox → check → messages → follow-up → invites → report |
| **R07** | `loopCommand.ts` | Ordine intelligente con log "Fase 1/6..." |
| H14 | `followUpWorker.ts` | Verificare campagna drip attiva prima del follow-up |
| H26-H27 | `inboxWorker.ts` | Rimuovere cap 5, leggere 3+ messaggi, tracking skip |
| M30 | `inboxWorker.ts` | Cap giornaliero globale auto-reply |

### Fase 4 — Anti-ban browser (C05 già fatto in Fase 2, C08, C12, H01, H15-H19, H21-H25, H30)
**File toccati**: `jobRunner.ts`, `humanBehavior.ts`, `launcher.ts`, `browser/auth.ts`, `sessionWarmer.ts`
**⚠️ DIPENDENZA**: H15 (wind-down) e H25 (warmup) toccano entrambi `jobRunner.ts`. Farli insieme.

| Fix | File principale | Cosa fa |
|-----|----------------|---------|
| C08 | `bulkSaveOrchestrator.ts` | Check limite 2500 lista prima di save |
| C12 | `jobRunner.ts:300-371` | Drift fix: cap `applyProfileDrift()` a ±15% max |
| H01 | `browser/auth.ts` | TOTP timeout + alert Telegram se fallisce |
| H15 | `jobRunner.ts:996-1003` + `launcher.ts:666-704` | Wind-down: 75%→feed/notifiche, non 30% |
| H19 | `launcher.ts:706-714` | Chiudere page PRIMA di browser context |
| H25 | `jobRunner.ts:285-297` + `sessionWarmer.ts` | Skip warmup se ultima sessione < 30min fa |
| H30 | `launcher.ts:387` | Geoip dinamico basato su proxy location |
| **R05** | `jobRunner.ts` main loop | Budget recalc ogni 10 job o dopo challenge |
| H24 | `jobRunner.ts` (dipende da R05) | Il budget ricalcolo fixa H24 automaticamente |
| M42 | `humanBehavior.ts:39-58` | Mouse timeout → aggiornare stato posizione, log warning |

### Fase 5 — Enrichment + SalesNav (H03-H08, H29, C10, M48)
**File toccati**: `inviteWorker.ts` (enrichment), `parallelEnricher.ts`, `leadEnricher.ts`, `emailGuesser.ts`, `leadStateService.ts`, `bulkSaveOrchestrator.ts`
**⚠️ DIPENDENZA**: H08 (enrichment nel worker) e M48 (personDataFinder latenza) sono lo STESSO problema. C10 (SalesNav URL) tocca `leadStateService.ts` che è usato da tutti i worker.

| Fix | File principale | Cosa fa |
|-----|----------------|---------|
| H08 + M48 | `inviteWorker.ts:283-314` | Rimuovere enrichment dal worker → solo dati in cache |
| H03 | `bulkSaveOrchestrator.ts:preSyncListToDb()` | Skip se ultimo pre-sync < 1h fa |
| H05 | `salesnav/salesnavDedup.ts` | Batch query invece di 3 query/profilo |
| H04 | `bulkSaveOrchestrator.ts:scrollAndReadPage()` | Timeout adattivo basato su proxy latenza |
| C10 | `leadStateService.ts:19` + nuovo `salesnavUrlResolver.ts` | BLOCKED → PENDING_RESOLUTION. Nuovo worker converte URL. |
| H29 | `emailGuesser.ts:105-189` | Fallback porta 587, cache "port 25 blocked" |

### Fase 6 — Robustezza secondaria (H09-H13, M02-M49 rimanenti)
**File toccati**: vari file isolati — ogni fix è indipendente.

| Gruppo | Fix | File |
|--------|-----|------|
| Invite modal | H09, M09, M39, M49 | `inviteWorker.ts` (fare insieme — stesso file) |
| Message safety | H10, H11, M11, M12 | `messageWorker.ts` (fare insieme — stesso file) |
| Acceptance | H12, H13, M13 | `acceptanceWorker.ts` + `scheduler.ts` (fare insieme) |
| Config | M01, M40, M46, A18 | `config/domains.ts` + `config/types.ts` + `config/validation.ts` (fare insieme) |
| Toast/dedup | M02, M03 | `bulkSaveOrchestrator.ts` |
| DB safety | M08, M43 | `bulkSaveOrchestrator.ts`, `stats.ts` |
| Decoy | M15, M16, R06 | `humanBehavior.ts:1200-1225` |
| AI quality | M06, M44, M45 | `ai/leadScorer.ts`, `aiQuality.ts`, `featureStore.ts` |
| Reporting | M29, A20 | `followUpWorker.ts`, intero progetto |

### Fase 7 — Architettura (A01-A22, R01-R02)
**⚠️ ORDINE INTERNO OBBLIGATORIO**:
1. **A22 PRIMA**: risolvere circular deps AI (sblocca refactoring successivi)
2. **A17 file lunghi**: split `bulkSaveOrchestrator.ts`, `humanBehavior.ts`, `leadsCore.ts` (sblocca parallizzazione sviluppo)
3. **A01 + A19**: split repositories barrel (dipende da A17)
4. **A02**: split jobRunner (dipende da A01 per import puliti)
5. **R01**: pattern OBSERVE-DECIDE-ACT (dipende da navigazione unificata in Fase 2)
6. **R02**: AI decisionale (dipende da R01 + R03 + R05)
7. **A21**: DB layer type-safe (dipende da split repositories)

**Regola**: se un fix architetturale tocca un file che un fix Fase 1-6 ha già modificato, assicurarsi di fare `git pull` prima e risolvere eventuali merge conflict.
