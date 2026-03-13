# Roadmap v2.1 + Ottimizzazioni Anti-Ban Avanzate

**Data**: 2026-03-12 | **Aggiornato**: 2026-03-13  
**Baseline**: v2.0.0-beta.1 — 202 test, audit 52/52 task completati, 0 debito critico  
**Principio guida**: anti-ban viene PRIMA di ogni feature. Ogni proposta è valutata per impatto detection.

---

## PARTE 1 — Ottimizzazioni Anti-Ban Avanzate

### Analisi pattern attuali (punti di forza)

L'architettura anti-ban è già solida:
- **Varianza budget**: mood factor FNV-1a ±20%, ratio shift ±15%, weekly strategy per giorno
- **Sessioni**: 2 sessioni 60/40 con gap pranzo 2h, login jitter 0-30min, maintenance 03-06
- **Fingerprint**: FNV-1a per account+settimana, Mulberry32 PRNG, 12 WebGL, 19 stealth mock
- **Azioni**: confidence check, missclick 2%, tab switch 40%, decoy burst, accidental nav
- **Monitoring**: probe pre-batch, inbox ban scan, cookie anomaly, HTTP throttle reattivo

### Proposte miglioramento (ordinate per impatto/rischio)

#### AB-1: Behavioral Fingerprint Cross-Session (ALTO impatto, BASSO rischio) ✔️ IMPLEMENTATO
**Problema**: LinkedIn può correlare sessioni diverse dello stesso account analizzando pattern comportamentali (timing tra click, velocità scroll, ordine navigazione). Attualmente ogni sessione parte da zero — nessuna memoria comportamentale.

**Proposta**: `sessionMemory.ts` già traccia `pacingFactor` — estenderlo con un **profilo comportamentale persistente** per account:
- Velocità media scroll (px/s) — derivata da `simulateHumanReading`
- Delay medio tra click — derivato da `humanDelay` history
- Pattern navigazione preferito (feed-first vs notifications-first) — derivato da `warmupSession`
- Orario preferito di picco attività — derivato da `getSessionWindow`

I valori vengono seedati dalla prima sessione e poi mantenuti con drift lento (±5% per settimana) — come un umano reale che ha abitudini stabili ma non identiche.

**Impatto anti-ban**: alto. LinkedIn usa ML per behavioral fingerprinting — sessioni coerenti nel tempo sono meno sospette.
**Rischio**: basso. Solo lettura/scrittura `.session-meta.json`, nessun cambio nel flusso browser.
**Effort**: 1 sessione.
**Stato**: ✅ Implementato (2026-03-13). `getBehavioralProfile` genera profilo deterministico per account, `profileMultiplier` wired in `humanDelay`/`interJobDelay` via `DeviceProfile` WeakMap.

#### AB-2: Geolocation Consistency (ALTO impatto, MEDIO rischio)
**Problema**: se il proxy cambia IP da Milano a Roma tra sessioni, LinkedIn vede un "teletrasporto" sospetto. `proxyManager.ts` ha rotation ma nessun vincolo geografico.

**Proposta**: aggiungere `PROXY_GEO_LOCK=true` in config — quando attivo, il proxy selezionato alla prima sessione viene "pinned" per tutta la settimana (stesso periodo del fingerprint). Il proxy ruota solo se fallisce.

**Impatto anti-ban**: alto per chi usa proxy pool con mix geografico.
**Rischio**: medio — richiede modifica in `proxyManager.ts` e `jobRunner.ts` session rotation.
**Effort**: 1 sessione.

#### AB-3: Activity Volume Correlation con SSI (MEDIO impatto, BASSO rischio)
**Problema**: un account con SSI 20 che invia 15 inviti/giorno è sospetto. Un account con SSI 80 che ne invia 15 è normale. Attualmente `ssiDynamicLimitsEnabled` modula i cap, ma la correlazione è lineare e non tiene conto della storia.

**Proposta**: introdurre un **trust score** composito che combina:
- SSI score (già disponibile)
- Account age (già in `getAccountAgeDays`)
- Acceptance rate storico (già in `complianceHealthScore`)
- Challenge history (già in `sessionMemory`)

Il trust score modula il budget con curva non-lineare: account giovane con basso SSI → budget molto ridotto, account maturo con alto SSI → budget pieno.

**Impatto anti-ban**: medio. Previene over-activity su account fragili.
**Effort**: 1 sessione.

#### AB-4: Micro-Pausa "Distrazione" durante Typing (MEDIO impatto, BASSO rischio)
**Problema**: `humanType` ha `lengthSlowFactor` e delay bimodale, ma un umano reale si distrae DURANTE la digitazione — guarda un'altra finestra, controlla il telefono, rileggere il testo.

**Proposta**: aggiungere in `humanType` una probabilità del 5-8% per ogni 30 caratteri di:
1. Pausa lunga (2-5s) — "rileggere il testo"
2. Selezionare e riscrivere gli ultimi 2-3 caratteri — "correzione riflessiva"
3. Scroll su nella conversazione prima di continuare — "rileggere il contesto"

**Impatto anti-ban**: medio. Keystroke dynamics è un segnale usato per bot detection.
**Effort**: 30 minuti, modifica solo `humanBehavior.ts`.

#### AB-5: Response Time Fingerprint (BASSO impatto, BASSO rischio)
**Problema**: il bot risponde alla inbox sempre con lo stesso delay (`estimateReadingDelayMs` basato su word count). Un umano ha varianza molto più alta — a volte risponde in 10s, a volte dopo ore.

**Proposta**: `inboxWorker.ts` attualmente processa tutte le conversazioni unread in sequenza. Introdurre un "defer" probabilistico: 30% delle conversazioni vengono skippate e processate nel ciclo successivo (simulando "l'ho visto ma rispondo dopo").

**Impatto anti-ban**: basso (inbox monitoring è già non-critico).
**Effort**: 15 minuti.

#### AB-6: Browser Memory Footprint Realismo (BASSO impatto, MEDIO rischio) ✔️ GIÀ IMPLEMENTATO
**Problema**: `performance.memory` in Chromium espone `usedJSHeapSize` — un browser con 0 history e poche tab ha un heap piccolo e costante, diverso da un browser reale con decine di tab e history.

**Proposta**: mock `performance.memory` in `stealthScripts.ts` con valori realistici che crescono durante la sessione (simulando memory leak naturale di un browser con tab aperte).

**Stato**: ✅ Già implementato nella sezione 12 di `stealthScripts.ts`. Heap cresce progressivamente (~800KB/min con jitter ±20%).

---

## PARTE 2 — Roadmap Feature v2.1

### Tier 1 — Quick Wins (1-2 sessioni ciascuno)

#### F-1: Dashboard What-If Panel (frontend)
L'endpoint `POST /api/risk/what-if` esiste ma il frontend non ha il pannello. Aggiungere un widget nella dashboard con slider per softCap/hardCap e visualizzazione real-time dell'impatto su risk score e budget.

#### F-2: Form Login TOTP UX
Il form login è funzionale ma basico. Aggiungere:
- Auto-focus sul campo TOTP dopo 401→403
- Mostrare/nascondere password con toggle eye icon
- Remember API key in sessionStorage (non localStorage — scompare alla chiusura tab)
- Redirect a dashboard dopo login success con smooth transition

#### F-3: Daily Report Arricchito
Il report Telegram include funnel + risk. Aggiungere:
- Top 3 lead hot (intent POSITIVE con confidence >0.8)
- Pending ratio trend (vs ieri e vs media 7 giorni)
- Selector health: drift rate attuale
- Suggestion automatica: "Ritira X inviti pending >21gg" se pending ratio >50%

#### F-4: Enrichment Dashboard Widget
`/api/observability` ha i dati. Aggiungere widget che mostra:
- Lead arricchiti oggi / totale da arricchire
- Source breakdown (hunter/clearbit/web)
- Hit rate per source
- Errori enrichment

### Tier 2 — Feature Strategiche (2-4 sessioni ciascuno)

#### F-5: Multi-Language Support
Il bot genera messaggi e note solo in italiano/inglese. Per espansione internazionale:
- Aggiungere `LEAD_LANGUAGE_DETECTION=true` — detect lingua dal profilo LinkedIn (campo "Languages")
- Template per FR, DE, ES, NL
- AI prompt localizzato per lingua
- Configurazione per lista: `lang` override

#### F-6: Campaign Builder UI
Le drip campaign (`campaigns` table) sono configurabili solo via API/DB. Aggiungere nella dashboard:
- Visualizzazione pipeline: step → delay → step
- Creazione campagna con drag-and-drop di step
- Enrollment bulk di lead per lista/filtro
- Stato campagna in tempo reale (lead per step)

#### F-7: A/B Test Dashboard
`abBandit.ts` ha dati ricchi. Aggiungere pannello dedicato:
- Varianti attive con score Bayesiano
- Convergenza: quanti sample mancano per significatività
- Winner declaration automatica con confidence interval
- Segmentazione per orario e job title

#### F-8: Webhook Inbound (ricevi eventi esterni)
Attualmente il bot è push-only verso webhook. Aggiungere endpoint `POST /api/v1/webhooks/inbound` per:
- Ricevere lead da CRM (HubSpot/Salesforce webhook)
- Ricevere trigger "pausa" da monitoring esterno (PagerDuty, Datadog)
- Ricevere aggiornamenti liste da n8n/Zapier

### Tier 3 — Evoluzione Architetturale (4+ sessioni)

#### F-9: Multi-Worker Scaling
L'architettura supporta 1 worker. Per scalare a 2+:
- `FOR UPDATE SKIP LOCKED` in `lockNextQueuedJob` (già predisposto per PG)
- Account affinity: worker X gestisce account A, worker Y gestisce account B
- Shared session state via Redis (o PG-backed)
- Health check cross-worker

#### F-10: Plugin Marketplace
`plugins/` ha già il loader con integrity check. Estendere:
- Plugin registry con versioning
- Hook points: pre-invite, post-accept, pre-message, post-reply
- Plugin config in `.env` per plugin
- Dashboard panel per enable/disable/configure plugin

#### F-11: Analytics & Reporting Module
Oltre il daily report, un modulo analytics completo:
- Funnel conversion rate per periodo (week, month)
- Cohort analysis: lead importati settimana X → conversion a Y settimane
- ROI per lista/campagna
- Export PDF report per stakeholder

---

## Priorità raccomandata

| # | Item | Tipo | Effort | Impatto |
|---|------|------|--------|---------|
| 1 | AB-1 | Anti-ban | 1 sessione | Alto — behavioral fingerprint |
| 2 | AB-4 | Anti-ban | 30 min | Medio — keystroke dynamics |
| 3 | F-1 | Feature | 1 sessione | Alto — what-if già pronto backend |
| 4 | F-3 | Feature | 1 sessione | Alto — daily report è il touchpoint #1 |
| 5 | AB-2 | Anti-ban | 1 sessione | Alto — geo consistency |
| 6 | AB-3 | Anti-ban | 1 sessione | Medio — trust score composito |
| 7 | F-2 | Feature | 30 min | Medio — UX login |
| 8 | AB-5 | Anti-ban | 15 min | Basso — inbox defer |
| 9 | F-5 | Feature | 3 sessioni | Alto — espansione mercato |
| 10 | F-6 | Feature | 4 sessioni | Alto — campaign builder |
