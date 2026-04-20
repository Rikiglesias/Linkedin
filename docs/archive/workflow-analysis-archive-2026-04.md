# Analisi Dettagliata Workflow — LinkedIn Automation Bot

> Stato documento: analisi tecnica approfondita e di supporto.
> Non e' il contratto canonico del motore: per quello usare `WORKFLOW_ENGINE.md`.
> Non e' la guida utente ai workflow: per quello usare `WORKFLOW_MAP.md`.

> Documento generato dall'analisi completa della codebase (~43.000 righe, 120+ file TypeScript).
> Ogni workflow è descritto passo-passo con riferimenti ai file sorgente.

---

## Indice

1. [Ciclo di Vita Globale (Orchestratore)](#1-ciclo-di-vita-globale)
2. [Workflow INVITE](#2-workflow-invite)
3. [Workflow MESSAGE](#3-workflow-message)
4. [Workflow FOLLOW-UP](#4-workflow-follow-up)
5. [Workflow ACCEPTANCE CHECK](#5-workflow-acceptance-check)
6. [Workflow INBOX SCAN](#6-workflow-inbox-scan)
7. [Workflow HYGIENE (Withdraw)](#7-workflow-hygiene)
8. [Sistema di Risk Management](#8-sistema-di-risk-management)
9. [Sistema ML/AI](#9-sistema-ml-ai)
10. [Anti-Ban & Stealth](#10-anti-ban--stealth)

---

## 1. Ciclo di Vita Globale

### Entry Point: `src/core/index.ts`
Il bot parte da `startAutomation()` che chiama l'orchestratore.

### Orchestratore: `src/core/orchestrator.ts`
Il loop principale del bot segue questo ciclo:

```
┌─────────────────────────────────────────────────────┐
│  1. Check pausa automazione (incidentManager)       │
│  2. Check orario lavorativo (config.workingHours)    │
│  3. Per ogni account configurato:                    │
│     a. Scheduler → calcola budget + crea job queue   │
│     b. JobRunner → esegue i job in sequenza          │
│     c. SessionMemory → registra pattern sessione     │
│  4. Inter-account delay (anti-detection)             │
│  5. Daily reporter → report Telegram fine giornata   │
│  6. Sleep fino al prossimo ciclo                     │
└─────────────────────────────────────────────────────┘
```

### Scheduler: `src/core/scheduler.ts`
Responsabile di:
1. **Calcolo budget giornaliero** per inviti e messaggi
2. **Applicazione fattori**: warmup account, risk policy, strategy planner (giorno settimana), growth model, trust score
3. **Selezione lead** dal DB per ogni tipo di job
4. **Creazione coda job** con priorità e timing ottimizzato

**Formula budget inviti:**
```
softCap × warmupMultiplier × strategyFactor × trustMultiplier × moodFactor
→ clampato a [0, hardCap]
→ ridotto da risk policy (WARN=50%, LOW_ACTIVITY=configurable, STOP=0)
→ ridotto da growth model (fasi: browse_only → soft_outreach → moderate → full)
```

### JobRunner: `src/core/jobRunner.ts`
Loop di esecuzione per account:

```
1. Lancia browser (Playwright + stealth patches)
2. Login con cookie salvati
3. Session warmup (feed, notifiche, search)
4. Per ogni job nella coda:
   a. Pre-flight: check pausa, challenge, session validity
   b. Pacing: humanDelay tra job (log-normale + fatigue)
   c. Dispatch al worker appropriato (invite/message/etc.)
   d. Post-action: decoy burst (10-20% probabilità)
   e. Error handling: retry policy, circuit breaker
   f. Session rotation check (max job, max tempo, memory)
5. Follow-up phase (dopo tutti i job primari)
6. Chiusura sessione + registrazione pattern
```

**Session Rotation:** il browser viene riavviato quando:
- Più di N job completati (configurable)
- Sessione attiva > 25 min
- Memory protection threshold superato

---

## 2. Workflow INVITE

**File:** `src/workers/inviteWorker.ts` (684 righe)
**Stato lead:** `READY_INVITE` → `INVITED`

### Passo-passo dettagliato:

```
STEP 1: VALIDAZIONE PRE-NAVIGAZIONE
├── 1.1 Carica lead dal DB (getLeadById)
├── 1.2 Check blacklist runtime (isBlacklisted)
│   └── Il lead potrebbe essere stato blacklistato DOPO la creazione del job
├── 1.3 Promozione stato: se NEW → READY_INVITE
├── 1.4 Check stato: se non READY_INVITE (e non campaign) → skip
├── 1.5 Parsing metadata campagna (nota override, noteMode)
├── 1.6 SalesNav URL → REVIEW_REQUIRED (non dead-end)
└── 1.7 Check profilo già visitato oggi (dedup visite)

STEP 2: NAVIGAZIONE CONTESTUALE
├── 2.1 navigateToProfileWithContext()
│   ├── Sceglie strategia: search organic (45% decay) / feed / direct
│   ├── Decay: primi inviti → più ricerca organica
│   ├── Dopo N inviti → navigazione sempre più diretta (umano si stufa)
│   └── Passa per feed/search prima del profilo target
├── 2.2 computeProfileDwellTime()
│   ├── Analizza ricchezza profilo (about, experience, skills)
│   ├── Budget totale 4-20s proporzionale al contenuto
│   └── Scroll + pause realistiche
└── 2.3 Visita attività recente (10-30% probabilità, con decay)
    ├── Naviga a /recent-activity/all/
    ├── simulateHumanReading()
    └── goBack() (usa history del browser, più naturale)

STEP 3: OBSERVE-DECIDE (R01+R02)
├── 3.1 observePageContext(page)
│   ├── Raccoglie: nome h1, headline, grado connessione
│   ├── Detecta: profilo eliminato, challenge, modale aperto
│   └── Verifica: bottoni Connect/Message/Pending presenti
├── 3.2 logObservation() → log strutturato
├── 3.3 GATE: se profilo eliminato → REVIEW_REQUIRED + return
├── 3.4 aiDecide({ point: 'pre_invite', lead, pageObservation, session })
│   ├── Se AI non configurata → fallback PROCEED (zero regressione)
│   ├── SKIP → workerResult(0), log motivo
│   ├── NOTIFY_HUMAN → REVIEW_REQUIRED
│   ├── DEFER → workerResult(0)
│   └── PROCEED → applica suggestedDelaySec se presente
└── 3.5 Identity Check (Jaro-Winkler similarity)
    ├── Confronta h1 della pagina vs nome lead nel DB
    ├── Se similarity < 0.75 → REVIEW_REQUIRED (persona sbagliata!)
    └── Profile reconciliation: aggiorna job_title se diverso dal DB

STEP 4: PRE-CLICK SAFETY
├── 4.1 Challenge detection + tentativo risoluzione
├── 4.2 Profile context extraction (about, experience → DB)
├── 4.3 Atomic daily cap check (checkAndIncrementDailyLimit)
│   └── Incrementa PRIMA del click per evitare race condition
├── 4.4 Weekly invite limit detection (pre-click)
│   └── Se rilevato → pauseAutomation(7 giorni)
├── 4.5 Session validity check (isLoggedIn)
│   └── Se cookie scaduto → SESSION_EXPIRED error
├── 4.6 dismissKnownOverlays() → chiude popup LinkedIn
└── 4.7 ensureViewportDwell() → bottone visibile 800-2000ms prima del click

STEP 5: CLICK CONNECT + MODALE
├── 5.1 clickConnectOnProfile()
│   ├── Cerca bottone primario Connect
│   ├── Confidence check: testo bottone contiene "Connect"/"Collegati"?
│   │   └── Se NO → skip (bottone sbagliato, layout cambiato)
│   ├── Fallback: More Actions → Connect in menu
│   └── humanMouseMove + humanDelay prima di ogni click
├── 5.2 Post-action verify: modale invito DEVE apparire entro 3s
│   └── Se non appare → abort + compensazione daily stat
├── 5.3 handleInviteModal()
│   ├── Decide se aggiungere nota (config, noteMode, campaign)
│   ├── Se nota richiesta:
│   │   ├── Click "Add a note"
│   │   ├── buildPersonalizedInviteNote(lead) → AI o template
│   │   │   ├── A/B test con abBandit (AI_VAR_A vs AI_VAR_B)
│   │   │   ├── SemanticChecker: verifica unicità messaggio
│   │   │   └── Fallback template se AI down
│   │   ├── Tronca a 280 char (LinkedIn limit 300, buffer sicurezza)
│   │   ├── humanType() → digita con typos e correzioni
│   │   └── Click "Send" nel modale
│   └── Se nota vuota o non richiesta:
│       ├── Click "Send without note"
│       └── Fallback: click sendFallback
└── 5.4 Post-click weekly limit check
    └── Se LinkedIn mostra limite → pauseAutomation(7 giorni)

STEP 6: VERIFICA + REGISTRAZIONE
├── 6.1 humanDelay(2-5s) → aspetta feedback visivo
├── 6.2 detectInviteProof()
│   ├── Cerca indicatore "Pending" sulla pagina
│   ├── Regex: "invitation sent" / "in attesa" / "pending"
│   └── Timeout 5s con Promise.race
├── 6.3 Se proof NON trovato:
│   ├── Check se lead già INVITED nel DB (evita duplicati)
│   └── Se non INVITED → RetryableWorkerError
├── 6.4 Transizione lead: READY_INVITE → INVITED
├── 6.5 Record timing attribution (per A/B timing optimizer)
├── 6.6 Record A/B bandit sent (per variant tracking)
├── 6.7 Incrementa stat lista + daily stat
└── 6.8 Cloud sync (bridgeLeadStatus, bridgeDailyStat)

### Compensazione Phantom Increment
Se l'invito fallisce DOPO l'incremento atomico del daily cap:
→ `incrementDailyStat('invites_sent', -1)` per decrementare
→ Evita di gonfiare il budget e bloccare inviti futuri

---

## 3. Workflow MESSAGE

**File:** `src/workers/messageWorker.ts` (412 righe)
**Stato lead:** `READY_MESSAGE` → `MESSAGED`

### Passo-passo dettagliato:

```
STEP 1: VALIDAZIONE
├── 1.1 Carica lead, check stato READY_MESSAGE (o campaign)
├── 1.2 Blacklist check runtime
├── 1.3 SalesNav URL → REVIEW_REQUIRED
└── 1.4 Pre-flight cap check (read-only, no incremento)

STEP 2: GENERAZIONE MESSAGGIO
├── 2.1 Check metadata campagna (messaggio override, lang, forceTemplate)
├── 2.2 Se forceTemplate → buildFollowUpMessage(lead) da template
├── 2.3 Se non template:
│   ├── Cerca messaggio pre-built (generato offline, zero latenza)
│   │   └── getUnusedPrebuiltMessage(leadId)
│   ├── Se trovato → usa pre-built, marca come used
│   └── Se non trovato → buildPersonalizedFollowUpMessage(lead, lang)
│       ├── AI: prompt GPT con contesto lead
│       ├── SemanticChecker: verifica unicità (3 retry)
│       ├── Temperatura crescente ad ogni retry (+0.15)
│       └── Fallback template se AI down
├── 2.4 Hash messaggio + check duplicati (24h)
└── 2.5 validateMessageContentAsync()
    ├── Lunghezza min/max
    ├── Contenuto proibito (link, emoji, claim aggressivi)
    ├── Duplicate hash check
    └── Se invalid → BLOCKED + motivo

STEP 3: NAVIGAZIONE + OBSERVE
├── 3.1 navigateToProfileForMessage() → catena contestuale
├── 3.2 humanDelay(2.5-5s) + simulateHumanReading() + contextualReadingPause()
├── 3.3 observePageContext() → raccolta contesto pagina
├── 3.4 GATE profilo eliminato → REVIEW_REQUIRED
├── 3.5 aiDecide({ point: 'pre_message' })
│   └── SKIP/NOTIFY_HUMAN/DEFER/PROCEED
└── 3.6 Identity check (Jaro-Winkler < 0.75 → REVIEW_REQUIRED)

STEP 4: SAFETY CHECKS
├── 4.1 Challenge detection + risoluzione
├── 4.2 Session validity (isLoggedIn)
├── 4.3 dismissKnownOverlays()
└── 4.4 ensureViewportDwell() per bottone Message

STEP 5: APERTURA CHAT + TYPING
├── 5.1 Confidence check bottone Message ("Message"/"Messaggio"/"Invia")
├── 5.2 humanMouseMove + click bottone Message
├── 5.3 waitForSelector(messageTextbox, 2.5s)
├── 5.4 Draft cleanup: se c'è testo residuo → Ctrl+A + Delete
├── 5.5 Check reply esistente nella chat
│   └── Se il lead ha GIÀ scritto → REPLIED (non inviare messaggio freddo)
├── 5.6 typeWithFallback() → digita messaggio con humanType
├── 5.7 Content verification: textbox contiene ≥50% del messaggio atteso
│   └── Se mismatch → RetryableWorkerError
└── 5.8 humanDelay(0.8-1.6s) post-typing

STEP 6: INVIO + REGISTRAZIONE
├── 6.1 Atomic daily cap check (checkAndIncrementDailyLimit)
├── 6.2 Click bottone Send
│   ├── Check bottone visibile e non disabled
│   ├── humanMouseMove + clickWithFallback
│   └── Se fallisce → compensazione (-1 messages_sent)
├── 6.3 Transizione: READY_MESSAGE → MESSAGED
├── 6.4 Record timing attribution
├── 6.5 storeMessageHash() per dedup futuro
├── 6.6 Incrementa stat lista
└── 6.7 Cloud sync
```

---

## 4. Workflow FOLLOW-UP

**File:** `src/workers/followUpWorker.ts` (475 righe)
**Stato lead:** `MESSAGED` (resta MESSAGED — incrementa `follow_up_count`, nessuna transizione di stato)

### Passo-passo dettagliato:

```
STEP 1: VALIDAZIONE + CADENZA
├── 1.1 Carica lead, check stato MESSAGED
├── 1.2 Blacklist check
├── 1.3 Campaign active check (se campaign-driven)
├── 1.4 Calcolo delay follow-up
│   ├── Base: config.followUpDays (default 5 giorni)
│   ├── Adattivo per intent: QUESTIONS→3d, POSITIVE→2d, NEGATIVE→7d
│   └── Verifica: messaged_at + delay < now
└── 1.5 SalesNav URL → REVIEW_REQUIRED

STEP 2: GENERAZIONE MESSAGGIO
├── 2.1 Check metadata campagna (messaggio override)
├── 2.2 Se non override → buildFollowUpReminderMessage()
│   ├── Fallback intent-aware templates
│   │   ├── QUESTIONS + prezzo → template pricing
│   │   ├── QUESTIONS + competitor → template confronto
│   │   ├── POSITIVE → template call
│   │   └── NEGATIVE → template soft close
│   ├── AI: prompt con contesto lead + intent hint
│   └── Max 300 char
├── 2.3 Hash + duplicate check (24h)
└── 2.4 validateMessageContentAsync()

STEP 3: NAVIGAZIONE + OBSERVE
├── 3.1 Navigazione contestuale al profilo
├── 3.2 Reading simulation
├── 3.3 observePageContext() → GATE profilo eliminato
├── 3.4 aiDecide({ point: 'pre_follow_up' })
└── 3.5 Check in-browser se il lead ha GIÀ risposto
    ├── Apre chat, cerca messaggi non-nostri
    └── Se risposta trovata → REPLIED (skip follow-up)

STEP 4: INVIO
├── 4.1 Challenge + session check
├── 4.2 Click Message → apri chat
├── 4.3 Verifica che l'ultimo messaggio sia il NOSTRO (non il loro)
├── 4.4 Draft cleanup
├── 4.5 humanType() messaggio
├── 4.6 Daily cap check atomico
├── 4.7 Click Send
└── 4.8 Compensazione se fallisce

STEP 5: REGISTRAZIONE
├── 5.1 recordFollowUpSent() → incrementa follow_up_count + follow_up_sent_at
├── 5.2 storeMessageHash()
├── 5.3 Stat incremento (follow_ups_sent)
└── 5.4 Log dettagliato (source, daysSince, messageLength)
NOTA: il lead resta in stato MESSAGED — non esiste lo stato FOLLOWED_UP
```

---

## 5. Workflow ACCEPTANCE CHECK

**File:** `src/workers/acceptanceWorker.ts` (135 righe)
**Stato lead:** `INVITED` → `READY_MESSAGE` oppure `INVITED` (resta)

### Passo-passo dettagliato:

```
STEP 1: VALIDAZIONE
├── 1.1 Carica lead, check stato INVITED
└── 1.2 SalesNav URL handling

STEP 2: NAVIGAZIONE + VERIFICA
├── 2.1 Naviga al profilo del lead
├── 2.2 humanDelay(2-4s) + simulateHumanReading()
├── 2.3 Identity check (h1 vs nome lead)
│   └── Se mismatch → REVIEW_REQUIRED
├── 2.4 Challenge detection
└── 2.5 Profilo eliminato/404 → REVIEW_REQUIRED

STEP 3: DETERMINAZIONE STATO CONNESSIONE
├── 3.1 Cerca bottone "Message" → indica connessione accettata
├── 3.2 Cerca indicatore "Pending" → invito ancora in attesa
├── 3.3 Cerca bottone "Connect" → invito rifiutato/ritirato
├── 3.4 Logica decisionale:
│   ├── Badge 1st degree → ACCEPTED ✓
│   ├── Pending presente → ancora in attesa → retry
│   ├── Connect presente → invito rifiutato → WITHDRAWN (re-invitabile)
│   ├── Message + no Pending + no Connect → ACCEPTED ✓ (badge lento)
│   └── Nessun segnale chiaro → RetryableWorkerError (retry)
└── 3.5 Se accettato:
    ├── Transizione: INVITED → READY_MESSAGE
    ├── Record accepted_at timestamp
    └── Cloud sync + Telegram alert (hot lead)
```

---

## 6. Workflow INBOX SCAN

**File:** `src/workers/inboxWorker.ts` (328 righe)
**Funzione:** Scansiona messaggi non letti, detecta intent, auto-reply

### Passo-passo dettagliato:

```
STEP 1: NAVIGAZIONE INBOX
├── 1.1 Naviga a linkedin.com/messaging/
├── 1.2 humanDelay(2-4s) + reading simulation
├── 1.3 SAFETY: Check warning LinkedIn nella inbox
│   ├── Regex: "unusual activity" / "restricted" / "temporarily limited"
│   └── Se trovato → pauseAutomation() + Telegram alert critico
└── 1.4 Raccolta conversazioni non lette
    └── Selettori: .msg-conversation-listitem--unread

STEP 2: PER OGNI CONVERSAZIONE NON LETTA
├── 2.1 Click sulla conversazione
├── 2.2 humanDelay(1-2.5s) + reading simulation
├── 2.3 Estrai profilo partecipante
│   ├── Cerca link profilo nel thread header
│   ├── Normalizza URL LinkedIn
│   └── Match con lead nel DB (per linkedin_url)
├── 2.4 Se lead NON trovato nel DB → skip
├── 2.5 Estrai ultimi N messaggi dal thread
│   └── Parsing strutturato: autore, testo, timestamp
└── 2.6 Analisi intent con AI
    ├── intentResolver: classifica intent (POSITIVE, QUESTIONS, NEGATIVE, etc.)
    ├── Sub-intent: CALL_REQUESTED, PRICE_INQUIRY, COMPETITOR_MENTION
    ├── Entities: prezzo, competitor, timeline
    └── Confidence score

STEP 3: AZIONE SU INTENT
├── 3.1 Se intent = POSITIVE/QUESTIONS (hot lead):
│   ├── Transizione lead → REPLIED
│   ├── Telegram alert "HOT LEAD" con dettagli
│   └── Se auto-reply abilitato + confidence > threshold:
│       ├── Daily auto-reply cap check
│       ├── Genera risposta AI contestuale
│       ├── humanType() nella textbox
│       ├── Click Send
│       └── Log + stat incremento
├── 3.2 Se intent = NEGATIVE/NOT_INTERESTED:
│   ├── Transizione lead → REPLIED (comunque registrato)
│   └── Log dettagliato per analytics
├── 3.3 Se intent = SPAM/IRRELEVANT:
│   └── Skip (nessuna azione)
└── 3.4 Se intent = SYSTEM_WARNING:
    └── pauseAutomation() immediata
```

---

## 7. Workflow HYGIENE (Withdraw)

**File:** `src/workers/hygieneWorker.ts` (166 righe)
**Stato lead:** `INVITED` → `WITHDRAWN`

### Passo-passo dettagliato:

```
STEP 1: SELEZIONE INVITI SCADUTI
├── 1.1 Query DB: lead INVITED con invited_at > 21 giorni
├── 1.2 Daily withdraw cap check
└── 1.3 Ordina per data invito (più vecchi prima)

STEP 2: PER OGNI INVITO SCADUTO
├── 2.1 Naviga al profilo del lead
├── 2.2 humanDelay + reading simulation
├── 2.3 Cerca bottone "Pending" / "In attesa"
│   └── Se non trovato → skip (potrebbe essere già accettato/ritirato)
├── 2.4 Click "Pending" → apre dropdown
├── 2.5 humanDelay(700-1300ms) → attesa dropdown
├── 2.6 Cerca opzione "Withdraw" / "Ritira" nel dropdown
│   ├── CSS selector primario
│   └── Fallback: vision-based click (uiFallback)
├── 2.7 Click "Withdraw"
├── 2.8 humanDelay(500-1000ms) → attesa modale conferma
├── 2.9 Click "Withdraw" nel modale di conferma
│   └── Selettori multipli per modale LinkedIn
└── 2.10 Registrazione
    ├── Transizione: INVITED → WITHDRAWN
    ├── Log dettagliato
    └── Stat incremento (withdrawals_today)

STEP 3: IMPORTANZA ANTI-BAN
└── Mantenere pending ratio < 65% è il KPI #1
    ├── LinkedIn monitora attivamente il pending ratio
    ├── Ritirare inviti dopo 21 giorni previene flag
    └── Score lead migliori prima → acceptance rate più alto → meno withdraw
```

---

## 8. Sistema di Risk Management

### 8.1 Risk Engine (`src/risk/riskEngine.ts`)

**Formula Risk Score (0-100):**
```
score = errorRate × 40
      + selectorFailureRate × 20
      + pendingRatio × 25
      + min(30, challengeCount × 10)
      + inviteVelocityRatio × 15
```

**Azioni basate su score:**
| Condizione | Azione |
|---|---|
| score ≥ riskStopThreshold OR pendingRatio ≥ pendingRatioStop OR challengeCount > 0 | **STOP** |
| lowActivityEnabled AND (score ≥ lowActivityThreshold OR pending ≥ lowActivityPending) | **LOW_ACTIVITY** |
| score ≥ riskWarnThreshold OR pendingRatio ≥ pendingRatioWarn | **WARN** |
| Altrimenti | **NORMAL** |

### 8.2 Ban Probability Score (`estimateBanProbability`)

Stima probabilità ban 0-100 combinando 4 segnali:
- **Z-score anomalie (peso 30):** alert attivi = account sotto osservazione
- **Trend acceptance (peso 25):** acceptance <40% = targeting scadente
- **Frequenza challenge (peso 25):** challenge recenti = account flaggato
- **Pending ratio (peso 20):** >30% = crescente, >65% = red flag

**Livelli:**
- 0-20: LOW → operazioni normali
- 21-45: MEDIUM → monitoraggio attivo
- 46-70: HIGH → ridurre budget 50%, pausa consigliata
- 71+: CRITICAL → STOP immediato

### 8.3 Strategy Planner (`src/risk/strategyPlanner.ts`)

Piano settimanale per simulare comportamento umano:

| Giorno | Invite Factor | Message Factor | Descrizione |
|---|---|---|---|
| Lunedì | 1.2 | 0.8 | High invites |
| Martedì | 1.0 | 1.2 | High messages |
| Mercoledì | 1.0 | 1.0 | Balanced |
| Giovedì | 0.7 | 1.3 | Message focus |
| Venerdì | 0.5 | 0.5 | Wind-down |
| Sabato | 0.0 | 0.0 | Rest |
| Domenica | 0.0 | 0.0 | Rest |

**Transizioni graduali:**
- Venerdì 14:00+ → cala progressivamente (ramp down)
- Lunedì 9-12 → sale progressivamente (ramp up)

**Cross-Day Jitter (6.1):** ±15% deterministico per account+settimana (FNV-1a hash).

### 8.4 Session Memory (`src/risk/sessionMemory.ts`)

Traccia pattern comportamentali cross-sessione:
- Login/logout hour tipici (mode)
- Media azioni giornaliere, inviti, messaggi
- Media intervallo inter-azione (ms)
- Challenge recenti

**Pacing Factor:**
- ≥3 challenge recenti → 0.5 (dimezza pacing)
- 1-2 challenge → 0.75 (cautela)
- 0 challenge + attività bassa → 1.1 (leggermente più aggressivo)

### 8.5 Account Behavior Model (`src/risk/accountBehaviorModel.ts`)

Curva di crescita progressiva a 4 fasi:

| Fase | Inviti/giorno | Messaggi/giorno | Descrizione |
|---|---|---|---|
| browse_only | 0 | 0 | Solo browsing |
| soft_outreach | config (ramp 40-100%) | 0 | Pochi inviti |
| moderate_growth | config (ramp 50-100%) | config (ramp 50-100%) | Crescita |
| full_budget | ∞ | ∞ | Nessun limite modello |

**Trust Score Composito (0-100):**
```
score = SSI × 0.30 + age × 0.25 + acceptance × 0.25 + challengeHistory × 0.10 + pendingRatio × 0.10
```
- Score ≥75 (+ prerequisiti) → budgetMultiplier fino a 1.30 (accelerazione)
- Score <75 → budgetMultiplier 0.3-1.0 (riduzione)

### 8.6 HTTP Throttler (`src/risk/httpThrottler.ts`)

Monitora response time LinkedIn per rallentare PRIMA del 429:
- Sliding window 50 campioni, max 10 min
- Baseline: trimmed mean dei primi 10 campioni
- **shouldSlow:** ratio ≥ 2.0× baseline
- **shouldPause:** ratio ≥ 3.5× baseline

### 8.7 Incident Manager (`src/risk/incidentManager.ts`)

Gestione incidenti a 3 livelli:

1. **quarantineAccount():** incidente CRITICAL → quarantena totale
   - Flag runtime `account_quarantine = true`
   - Telegram alert CRITICAL
   - Cloud health → RED

2. **pauseAutomation():** incidente WARN → pausa temporanea
   - Exponential backoff per 429: `baseMinutes × 2^recentIncidents` (max 24h)
   - Telegram alert WARN
   - Cloud health → YELLOW

3. **handleChallengeDetected():** challenge → pausa + review queue
   - pauseAutomation(challengePauseMinutes)
   - Lead → REVIEW_REQUIRED
   - Flag `challenge_review_pending = true`

**Classificazione incidenti (A13):**
- ≥3 account con stesso errore in 24h → `platform_wide` (cambio LinkedIn)
- 1 account → `account_specific` (problema locale)

### 8.8 Cooldown System

Due livelli di cooldown basati su risk score:

| Tier | Trigger | Durata |
|---|---|---|
| warn | score ≥ cooldownWarnScore OR pending ≥ cooldownPendingThreshold | cooldownWarnMinutes |
| high | score ≥ cooldownHighScore OR pending ≥ cooldownPendingHighThreshold | cooldownHighMinutes |

---

## 9. Sistema ML/AI

### 9.1 Timing Model (`src/ml/timingModel.ts`)

Calcola delay contestuali con distribuzione **log-normale** (coda lunga a destra):

```
delay = lognormal(baseMin, baseMax)
      × fatigueMultiplier (1.35 serale, 1.25 post-pranzo)
      × contentMultiplier (proporzionale a contentLength/1000)
      × profileMultiplier (per-account behavioral profile)
      × jitter (0.85-1.15)
```

### 9.2 Timing Optimizer (`src/ml/timingOptimizer.ts`)

Ottimizzatore data-driven per trovare gli slot temporali migliori:

1. **Raccolta dati:** query DB per ora/giorno/job_title degli inviti/messaggi inviati
2. **Bayesian scoring:** `(blended_rate × N + prior_mean × prior_weight) / (N + prior_weight)`
   - blended_rate = lifetime × (1-recentWeight) + recent × recentWeight
3. **Segment-aware:** score diversi per segmento lead (C-Level, VP, Manager, etc.)
4. **Exploration:** `timingExplorationProbability` chance di usare slot casuale
5. **Decision:** trova lo slot qualificato più vicino nel tempo
6. **A/B experiment:** confronta baseline vs optimizer con two-proportion z-test

### 9.3 A/B Bandit (`src/ml/abBandit.ts`)

Multi-Armed Bandit con policy Bayesiana per template/prompt selection:

**Bayesian Score:**
```
posteriorMean = (accepted + α_prior) / (accepted + α_prior + (sent - accepted) + β_prior)
posteriorStd = sqrt(α × β / (α+β)² × (α+β+1))
explorationBonus = sqrt(log(totalSent+1) / (sent+1)) × 0.05
bayesScore = posteriorMean + posteriorStd × 0.75 + explorationBonus
```

**Selezione variante:**
1. ε-greedy con decay: `ε = max(0.02, 0.15 × 0.999^totalTrials)`
2. Se esplora → random
3. Se sfrutta → `evaluateBanditDecision()`:
   - Se c'è un significant winner (z-test) → usa quello
   - Altrimenti → Bayes score più alto

**Fallback 3 livelli:** segment:hourBucket → segment base → global

### 9.4 AI Decision Engine (`src/ai/aiDecisionEngine.ts`)

5 punti decisionali con LLM:
1. `pre_invite` → decidere SE invitare
2. `pre_message` → decidere SE inviare messaggio
3. `pre_follow_up` → decidere SE fare follow-up
4. `inbox_reply` → classificare e rispondere
5. `navigation` → strategia navigazione

**Fallback:** Se AI non configurata o timeout (8s) → PROCEED (comportamento meccanico, zero regressione).

### 9.5 Message Personalizer (`src/ai/messagePersonalizer.ts`)

Due funzioni principali:

**buildPersonalizedFollowUpMessage():**
- Prompt GPT con contesto lead (nome, company, ruolo, website)
- 3 retry con temperatura crescente (+0.15)
- SemanticChecker: verifica unicità (similarity < 0.85)
- Fallback template se AI down
- Max chars: config.aiMessageMaxChars

**buildFollowUpReminderMessage():**
- Intent-aware: template diversi per QUESTIONS/POSITIVE/NEGATIVE
- Sub-intent: PRICE_INQUIRY, COMPETITOR_MENTION, CALL_REQUESTED
- Entities: prezzo, competitor → template specifico
- AI con temperatura 0.75 (più creativa)
- Max 300 char

### 9.6 Invite Note Personalizer (`src/ai/inviteNotePersonalizer.ts`)

**Template multilingua:** IT (8), EN (5), FR (3), ES (3)

**A/B Testing prompt:**
- `AI_VAR_A_DIRECT`: tono professionale, colloquiale
- `AI_VAR_B_VALUE`: social selling, leva specifica su about/experience

**Flow:**
1. Seleziona template variant via abBandit (segmento + hourBucket)
2. Se `inviteNoteMode=ai` + AI configurata → genera con LLM
3. SemanticChecker per unicità
4. 3 retry con temperatura crescente
5. Fallback template se AI down
6. Max 300 char (LinkedIn limit)

### 9.7 Page Observer (`src/browser/observePageContext.ts`)

Pattern OBSERVE-DECIDE-ACT:
- Raccolta parallela (Promise.allSettled) per minimizzare latenza
- Max 3s per step, 5s totale
- Non lancia mai eccezioni → ritorna sempre PageObservation parziale
- Detecta: nome profilo, headline, grado connessione, profilo eliminato, challenge, bottoni

---

## 10. Anti-Ban & Stealth

### 10.1 Principi Fondamentali

| Principio | Implementazione |
|---|---|
| **Varianza su tutto** | Log-normale per delay, jitter ±15% deterministico, typing speed variabile |
| **Sessioni corte** | Max ~25 min, session rotation, 2 sessioni/giorno |
| **Pending ratio** | KPI #1, hygiene worker ritira dopo 21 giorni, targeting per score |
| **Fingerprint coerente** | FNV-1a per account+settimana, canvas noise PRNG Mulberry32, WebGL pool 12 valori |
| **Azioni sicure** | Confidence check pre-click, post-action verify, cap challenge 3/giorno |
| **Navigazione umana** | Organic visit 20% feed prima di Connect, warmup sessione, humanDelay |
| **Monitoring attivo** | Probe LinkedIn, inbox scan keywords ban, daily report Telegram |

### 10.2 Human Behavior Simulation (`src/browser/humanBehavior.ts`)

- **humanMouseMove():** movimento mouse con curve Bézier naturali
- **humanType():** typing con speed variabile per lunghezza, typos (2-5%), correzioni (backspace+retype), micro-pause
- **simulateHumanReading():** scroll con fasi (fast scan → slow read → backtrack), pause proporzionali al contenuto
- **interJobDelay():** delay log-normale tra job, fatigue crescente nella sessione
- **decoyActions():** 10-20% probabilità di azione casuale (search, profilo random, feed scroll)
- **computeProfileDwellTime():** 4-20s proporzionale alla ricchezza del profilo
- **ensureViewportDwell():** bottone visibile 800-2000ms prima del click

### 10.3 Navigation Context (`src/browser/navigationContext.ts`)

Catena di navigazione realistica (evita goto diretto = segnale #1 di bot):
1. **Search organic (45% → decay):** cerca il lead su LinkedIn search
2. **Feed organic (30%):** passa dal feed, scorre, poi vai al profilo
3. **Direct (25% → increase):** goto diretto (dopo molti inviti, un umano si stufa)

Decay: `sessionActionCount × 0.02` riduce probabilità organic → simula stanchezza umana.

### 10.4 Flusso Completo Anti-Ban per Sessione

```
1. WARMUP (sessionWarmer)
   ├── Feed scroll (3-8s)
   ├── Notifiche check
   ├── Search casuale
   └── Delay variabile

2. AZIONI (jobRunner loop)
   ├── Pacing adattivo (log-normale + fatigue)
   ├── Decoy burst ogni 3-5 azioni (10-20%)
   ├── Navigation context per ogni profilo
   ├── Profile dwell proporzionale
   └── HTTP throttler monitoring

3. WIND-DOWN
   ├── Organic content (feed/search random)
   ├── humanWindDown() variato
   └── Session chiusura graduale

4. INTER-SESSION
   ├── Pausa 2h (pausa pranzo)
   ├── Weekend zero attività
   └── Jitter login ±30 min
```

---

## Appendice: Diagramma Stati Lead

```
NEW
 └→ READY_INVITE
     ├→ INVITED
     │   ├→ ACCEPTED → READY_MESSAGE (transizione atomica)
     │   │   ├→ MESSAGED (follow_up_count++ per follow-up, resta MESSAGED)
     │   │   │   └→ REPLIED / CONNECTED
     │   │   └→ REPLIED / CONNECTED
     │   ├→ WITHDRAWN (hygiene 21gg / invito rifiutato)
     │   │   └→ READY_INVITE (re-invitabile)
     │   └→ REVIEW_REQUIRED (problemi)
     ├→ SKIPPED (connect not found)
     └→ REVIEW_REQUIRED (salesnav, identity mismatch, etc.)
 └→ BLOCKED (validation failed)

NOTE:
- FOLLOWED_UP non esiste come stato — i follow-up incrementano follow_up_count
- ACCEPTED è transitorio — transitionLeadAtomic fa INVITED→ACCEPTED→READY_MESSAGE
- WITHDRAWN permette re-invito futuro (WITHDRAWN→READY_INVITE)
```

---

## Appendice: Tabella File → Responsabilità

| File | Righe | Responsabilità |
|---|---|---|
| `core/jobRunner.ts` | ~1295 | Loop esecuzione, session management, error handling |
| `core/scheduler.ts` | ~1002 | Budget, selezione lead, creazione job queue |
| `workers/inviteWorker.ts` | 684 | Invio inviti con nota AI/template |
| `workers/messageWorker.ts` | 412 | Invio messaggi personalizzati |
| `workers/followUpWorker.ts` | 457 | Follow-up intelligente per intent |
| `workers/acceptanceWorker.ts` | 135 | Verifica accettazione inviti |
| `workers/inboxWorker.ts` | 328 | Scan inbox, intent resolution, auto-reply |
| `workers/hygieneWorker.ts` | 166 | Ritiro inviti scaduti |
| `risk/riskEngine.ts` | 410 | Risk score, budget dinamico, ban probability |
| `risk/strategyPlanner.ts` | 110 | Piano settimanale, jitter deterministico |
| `risk/sessionMemory.ts` | 223 | Pattern cross-sessione, pacing factor |
| `risk/incidentManager.ts` | 268 | Quarantena, pausa, challenge handling |
| `risk/httpThrottler.ts` | 138 | Monitoring response time LinkedIn |
| `risk/accountBehaviorModel.ts` | 252 | Growth phases, trust score |
| `ml/timingModel.ts` | 55 | Delay log-normale contestuale |
| `ml/timingOptimizer.ts` | 498 | Ottimizzazione slot temporali data-driven |
| `ml/abBandit.ts` | 537 | Multi-Armed Bandit Bayesiano |
| `ai/aiDecisionEngine.ts` | 231 | 5 punti decisionali AI |
| `ai/messagePersonalizer.ts` | 206 | Personalizzazione messaggi AI |
| `ai/inviteNotePersonalizer.ts` | 224 | Personalizzazione note invito AI |
| `browser/observePageContext.ts` | 152 | Pattern OBSERVE per contesto pagina |
| `browser/humanBehavior.ts` | ~1464 | Simulazione comportamento umano |
