# TODO — Workflow 360° Improvement Plan

> Generated: 2026-03-13 | Prev audit: 52/52 completati (archiviato)
> Focus: Anti-ban hardening, workflow intelligence, realismo comportamentale, resilienza
> 30 item su 6 sprint + 3 deferred audit — Anti-ban first, 6 livelli di verifica
> **Completati: 30/30** (+ 7 fix critici da analisi effetti composti)
> Tutti i task implementati, verificati L1→L6, test E2E dry-run passa

---

## Sprint 1: Anti-Ban Hardening Critico (P0)

### 1.1 Session Duration Variance + Wind-Down
- [x] **File**: `src/core/jobRunner.ts` (linee 734-739), `src/browser/humanBehavior.ts`
- **Problema**: Hard limit fissi `500 job` e `60 min` — pattern rilevabile da LinkedIn
- **Fix**: Range jitterato `35-70 min` e `300-600 job`. Fase wind-down nell'ultimo 15%: `interJobDelay ×1.5`, velocità azioni `-30%`
- **Anti-ban**: FORTEMENTE POSITIVO

### 1.2 Navigation Context Chains (Intent Simulation)
- [x] **File**: Nuovo `src/browser/navigationContext.ts`, `src/workers/inviteWorker.ts`, `src/workers/messageWorker.ts`
- **Problema**: Bot naviga direttamente `page.goto(profileUrl)` — segnale bot #1 (no referral chain)
- **Fix**: Catene realistiche: Feed→Search→Scroll→Click profilo→Connect (70%), diretto (30%). Per messaggi: Feed→Messaging inbox→Conversazione
- **Anti-ban**: FORTEMENTE POSITIVO — risolve segnale detection principale

### 1.3 Wire Trust Score nello Scheduler
- [x] **File**: `src/core/scheduler.ts` (dopo linea 448), `src/core/repositories.ts`
- **Problema**: `calculateAccountTrustScore()` in `accountBehaviorModel.ts:186` produce `budgetMultiplier` (0.3-1.0) ma MAI collegata allo scheduler
- **Fix**: Dopo `applyGrowthModel()`, chiamare trust score e moltiplicare budget. Aggiungere `getAccountTrustInputs()` query (acceptance rate, challenges 7d, pending ratio)
- **Anti-ban**: FORTEMENTE POSITIVO — account basso trust auto-limitati

### 1.4 Multi-Account Target Deconfliction
- [x] **File**: `src/core/scheduler.ts` (prima linea 686), `src/core/repositories.ts`
- **Problema**: 2 account possono invitare la stessa persona — LinkedIn rileva coordinamento
- **Fix**: Query `hasOtherAccountTargeted(linkedinUrl, excludeAccountId, 30gg)` prima di `enqueueJob()`. Se positivo, skip lead
- **Anti-ban**: FORTEMENTE POSITIVO — previene detection coordinamento multi-account

---

## Sprint 2: Intelligenza Workflow (P0)

### 2.1 Outcome-Driven Budget per Lista (Acceptance Rate Feedback)
- [x] **File**: `src/core/scheduler.ts`, `src/core/repositories.ts`
- **Problema**: `evaluateAdaptiveBudgetContext()` usa solo pending/blocked ratio, NON acceptance rate storico. Liste con acceptance <15% ricevono budget pieno
- **Fix**: `computeListPerformanceMultiplier(listName, lookbackDays)`: acceptance >40%→×1.15, 20-40%→×1.0, <20%→×0.5, <10%→×0.25
- **Anti-ban**: FORTEMENTE POSITIVO — auto-throttle liste bassa qualità

### 2.2 Post-Action Verification per Inviti
- [x] **File**: `src/workers/inviteWorker.ts` (o follow-up worker), `src/workers/errors.ts`
- **Problema**: Dopo click Connect, nessuna verifica che invito sia stato effettivamente inviato. Inviti fantasma inflazionano pending ratio
- **Fix**: Attendere 2-5s, verificare bottone diventato "Pending"/"Sent". Se no → `INVITE_NOT_CONFIRMED` error
- **Anti-ban**: NEUTRO/POSITIVO — dwell time realistico + previene pending ratio inflazionato

---

## Sprint 3: Realismo Comportamentale (P1)

### 3.1 Warm-Up Sessione con Sequenza Ordinata
- [x] **File**: `src/core/sessionWarmer.ts`
- **Problema**: Ordine warmup randomizzato. Umano reale fa Feed (90%) → Notifiche (70%) → Messaging (40%). Mai Search/Settings per primo
- **Fix**: Catena probabilistica ordinata. Feed primo (90%), poi notifications (70%), poi messaging (40%, solo sessione 2)
- **Anti-ban**: POSITIVO — pattern primo-accesso realistico

### 3.2 Scroll Velocity a 3 Fasi
- [x] **File**: `src/browser/humanBehavior.ts` (funzione `simulateHumanReading()`)
- **Problema**: `deltaY` range uniforme 150-530px. Scroll reale ha 3 fasi
- **Fix**: Fase 1 orientation (400-600px, 300-800ms), Fase 2 reading (100-250px, 500-2000ms), Fase 3 skip (500-800px, 200-500ms). Transizioni probabilistiche
- **Anti-ban**: POSITIVO — scroll uniforme è rilevabile

### 3.3 Viewport Dwell Time Before Click
- [x] **File**: `src/browser/humanBehavior.ts`, `src/workers/inviteWorker.ts`, `src/workers/messageWorker.ts`
- **Problema**: LinkedIn traccia IntersectionObserver. Click <500ms dopo apparizione nel viewport = sospetto
- **Fix**: `ensureViewportDwell(page, selector, minMs=800, maxMs=2000)`: verifica elemento nel viewport da almeno `minMs` prima del click
- **Anti-ban**: POSITIVO — previene segnale click-before-visible

### 3.4 Content-Aware Profile Dwell Time
- [x] **File**: `src/browser/humanBehavior.ts`, `src/workers/inviteWorker.ts`
- **Problema**: Dwell time profilo fisso indipendente dalla ricchezza contenuto
- **Fix**: `computeProfileDwellTime(page)` — misura lunghezza DOM, scala tempo lettura. Profilo ricco 15-30s, sparse 5-10s. Usa `contextualReadingPause()` (linea 724, non usata per profili)
- **Anti-ban**: POSITIVO — dwell time fisso è segnale bot

---

## Sprint 4: Resilienza + Checkpoint (P1)

### 4.1 Workflow Checkpoint/Resume
- [x] **File**: `src/workflows/syncSearchWorkflow.ts`, `src/workflows/syncListWorkflow.ts`
- **Problema**: Crash sync-search dopo 3/5 ricerche → riparte da zero. Spreco page view
- **Fix**: Persistere `lastProcessedSearchIndex` e `lastProcessedPage` in `runtime_flags` (usa `setRuntimeFlag/getRuntimeFlag` già presenti). Resume dall'ultimo checkpoint
- **Anti-ban**: POSITIVO — meno page view ripetute

### 4.2 Smart Batch Sizing Mid-Session
- [x] **File**: `src/core/jobRunner.ts` (near linea 339-367)
- **Problema**: `maxJobsPerRun` da backpressure ma non riduce mid-session se LinkedIn rallenta
- **Fix**: Se `httpThrottler.shouldSlow` → ridurre batch -30%. Se 3+ job consecutivi con response time >2x baseline → terminare sessione con wind-down
- **Anti-ban**: POSITIVO — cattura pushback prima di 429/challenge

### 4.3 Selector Self-Healing con Fallback Chain (già implementato)
- [x] **File**: `src/browser/uiFallback.ts` (già esiste — estendere), `src/browser/humanBehavior.ts`
- **Problema**: Selector canary rileva selettori rotti e blocca tutto il workflow
- **Fix**: Per ogni selettore critico, lista prioritizzata 3-5 alternative. Primario fallisce → prova secondario. Log fallback per aggiornamento pool
- **Anti-ban**: NEUTRO — nessun comportamento LinkedIn-visible

---

## Sprint 5: Monitoring + Reporting (P1)

### 5.1 Preflight Risk Assessment con Go/No-Go
- [x] **File**: `src/workflows/preflight.ts`, `src/workflows/types.ts`
- **Problema**: Preflight mostra config/warning ma non calcola rischio sessione
- **Fix**: `computeSessionRiskLevel()`: challenge recenti + pending ratio + account health + proxy reputation + tempo dall'ultimo run. Output: GO / CAUTION / STOP
- **Anti-ban**: POSITIVO — previene run durante periodi alto rischio

### 5.2 Per-List Performance in Report
- [x] **File**: `src/workflows/types.ts`, `src/workflows/reportFormatter.ts`, `src/workflows/sendInvitesWorkflow.ts`, `src/workflows/sendMessagesWorkflow.ts`
- **Problema**: Report mostra solo aggregati, non per-lista
- **Fix**: Sezione `listBreakdown` in `WorkflowReport` con acceptance rate, inviti inviati, flag per liste sottoperformanti
- **Anti-ban**: NEUTRO — solo osservabilità

### 5.3 Preflight Stale Data Warning
- [x] **File**: `src/workflows/sendInvitesWorkflow.ts`, `src/workflows/sendMessagesWorkflow.ts`
- **Problema**: Nessun warning se ultimo sync >7 giorni. Lead stale = basso acceptance = rischio
- **Fix**: In `generateWarnings()`: se `lastSyncAt > 7gg` → WARNING "Dati lead obsoleti"
- **Anti-ban**: POSITIVO — lead freschi = acceptance più alto

### 5.4 Predictive Ban Probability Score
- [x] **File**: `src/risk/riskEngine.ts`, `src/core/orchestrator.ts`
- **Problema**: `evaluatePredictiveRiskAlerts()` manda solo alert Telegram. Manca punteggio ban 0-100
- **Fix**: `estimateBanProbability()`: z-score predittivi + trend acceptance + frequenza challenge + trend durata sessione. Output a dashboard e outbox
- **Anti-ban**: POSITIVO — early warning prima ban irreversibili

---

## Sprint 6: Polish (P2)

### 6.1 Cross-Day Pattern Randomization
- [x] **File**: `src/risk/strategyPlanner.ts`, `src/core/scheduler.ts`
- **Fix**: Jitter per-account per-settimana con seed `FNV-1a(accountId + weekNumber)` sui fattori giornalieri

### 6.2 Mouse Ease-In-Out
- [x] **File**: `src/ml/mouseGenerator.ts`
- **Fix**: Sostituire ease-out con ease-in-out-quint per profilo velocità a campana realistico

### 6.3 Typing Flow State
- [x] **File**: `src/browser/humanBehavior.ts`, `src/ai/typoGenerator.ts`
- **Fix**: Parole comuni → 0.7x delay, parole rare → 1.4x delay (dizionario frequenza)

### 6.4 Report con Suggerimenti Azionabili
- [x] **File**: `src/workflows/reportFormatter.ts`
- **Fix**: `nextAction` arricchito con suggerimenti multi-step context-aware

### 6.5 Graceful Degradation Enrichment
- [x] **File**: `src/workflows/sendInvitesWorkflow.ts`
- **Fix**: Se enrichment fallisce >80% e nota AI selezionata → auto-downgrade a template con warning

### 6.6 Circuit Breaker Per-Lista
- [x] **File**: `src/core/scheduler.ts`, `src/core/jobRunner.ts`, `src/risk/incidentManager.ts`
- **Fix**: Per-lista con prefix `cb::list::${listName}` in runtime_flags (attualmente solo globale)

### 6.7 Session Replay Breadcrumbs
- [x] **File**: `src/workers/context.ts`, `src/core/jobRunner.ts`, `src/risk/incidentManager.ts`
- **Fix**: Ultimi 20 eventi navigazione in memoria. Su challenge/errore → dump nel record incidente + Telegram

---

## Ordine Implementazione

```
Sprint 1 (P0 anti-ban)    → 1.1, 1.2, 1.3, 1.4              [4/4] ✅
Sprint 2 (P0 intelligence) → 2.1, 2.2                        [2/2] ✅
Sprint 3 (P1 behavioral)  → 3.1, 3.2, 3.3, 3.4              [4/4] ✅
Sprint 4 (P1 resilience)  → 4.1, 4.2, 4.3                    [3/3] ✅
Sprint 5 (P1 monitoring)  → 5.1, 5.2, 5.3, 5.4              [4/4] ✅
Sprint 6 (P2 polish)      → 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7  [7/7] ✅
Deferred audit            → D-1, D-2, D-3                    [3/3] ✅
```

Gate: `npm run conta-problemi` = EXIT 0 dopo ogni sprint

---

## Deferred dall'Audit Precedente (da chiudere)

### D-1: CC-25 — Selector learning false positives from slow pages
- [x] **File**: `src/browser/uiFallback.ts`
- **Problema**: Su proxy lenti, selector timeout inflaziona `selectorFailureRate` nel risk engine → quarantine ingiusta
- **Fix**: `trackSelectorFailure` ora verifica body length >200 chars prima di registrare failure. Pagina vuota = problema connettività, non selettore.
- **Stato**: ✅ Completato

### D-2: NEW-10 — No lead-level lock during worker processing
- [x] **File**: `src/core/leadStateService.ts`
- **Problema**: Job table ha lock (`locked_at`), ma lead table NO row-level lock
- **Fix**: Confermato che `transitionLead` usa `withTransaction` + `isValidLeadTransition` check-and-set atomico. SQLite serializza le transazioni. Su PG, la seconda transazione concurrent fallirebbe con "transizione non consentita" (check-and-set pattern funzionante).
- **Stato**: ✅ Confermato mitigato — robustezza sufficiente per il setup attuale

### D-3: Verifica end-to-end dei 4 workflow
- [x] **Verifica**: Test E2E dry-run automatizzato per `invite`, `check`, `message`, `all` + verifica nuove funzioni esportate
- **Stato**: ✅ Completato — `npm run test:e2e:dry` passa con 4 workflow + validazione trust score, list performance, risk assessment, ban probability, breadcrumbs

---

## Archivio Audit Precedente

> L'audit originale (52/52 task + JA3 extra) è stato completato il 2026-03-13.
> 2 item deferred (CC-25, NEW-10) ora inclusi sopra come D-1, D-2.
> Tutti i fix verificati L1→L6 + anti-ban.
