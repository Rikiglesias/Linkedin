# TODO — Analisi 360° Sistema Completo

> Generated: 2026-03-13 | Aggiornato dopo analisi completa codebase
> Audit precedente: 30/30 + 7 fix effetti composti + 3 fix L1→L6 — COMPLETATO e archiviato
> Focus: GAP trovati dall'analisi lifecycle completo (boot → sessione → shutdown → multi-giorno)
> **Completati: 0/13**

---

## REGOLA OBBLIGATORIA PER OGNI MODIFICA

Ogni task DEVE essere verificato con i **6 livelli di controllo + anti-ban**:

### Anti-ban (PRIORITA' ZERO — prima di scrivere codice)
1. Questa modifica cambia il comportamento del browser su LinkedIn?
2. Cambia timing, delay, ordine delle azioni?
3. Tocca fingerprint, stealth, cookie, session?
4. Aggiunge un'azione nuova su LinkedIn?
5. Cambia volumi (budget, cap, limiti)?

### L1 — Compilazione e test (BLOCCANTE)
- `npm run conta-problemi` = EXIT 0 (typecheck 0, lint 0, tutti i test passano)
- Dead code check, circular dependency check se moduli core

### L2 — Catene dirette
- Import→export→chiamata per ogni file toccato
- Parametri opzionali per retrocompatibilita'
- Barrel file propagano a tutti i consumatori

### L3 — Runtime profondo
- Edge case: NaN, null, undefined, array vuoti, numeri negativi
- Performance: costo per iterazione nel loop
- Per browser: memory leak? Listener rimossi? Timeout propaga?
- Per DB: transazione? Crash consistency?

### L4 — Ragionamento preventivo
- "E se null/undefined?" per ogni input
- "E se fallisce a meta'?" per ogni flusso multi-step
- "E se chiamata 2 volte?" per ogni side-effect
- Scenari: multi-giorno, recovery, interazione utente, aggiornamento LinkedIn

### L5 — Visione prodotto
- Utente capisce cosa succede (log, Telegram, report)
- Alert dicono COSA FARE, non solo cosa e' successo

### L6 — Coerenza sistema e osservabilita'
- Dati end-to-end: dato arriva fino all'utente?
- Reversibilita': rollback senza data loss?
- Config: nuova var .env documentata, parsata, validata?

### Workflow obbligatorio
```
1. npm run pre-modifiche PRIMA di iniziare
2. Valutare impatto anti-ban
3. Ragionare a 360° breve/medio/lungo termine + effetti composti
4. Implementare la modifica
5. npm run conta-problemi DOPO (DEVE essere exit code 0)
6. Verifica L2→L3→L4→L5→L6
7. Se qualsiasi livello trova un problema → STOP e fixare
```

---

## Sprint A: Anti-Ban Architetturale (P0 — CRITICO)

### A.1 Browser Singleton per Ciclo (rivisto dopo analisi L4: multi-account)
- [x] **File**: `src/cli/commands/loopCommand.ts`, `src/core/orchestrator.ts`, `src/core/jobRunner.ts`
- **Problema**: Ogni ciclo del loop apre fino a **4 browser separati**: (1) auto_site_check warmup, (2) session_warmup, (3) canary check nell'orchestratore, (4) jobRunner. Ogni apertura = nuovo fingerprint check, nuovo TLS handshake, nuova sessione LinkedIn. LinkedIn correla multiple sessioni dallo stesso account come automatismo.
- **Fix**: Creare un `SessionManager` che apre il browser UNA VOLTA per ciclo e lo passa a tutti i sub-task (warmup, canary, jobRunner, follow-up). Il browser viene chiuso solo alla fine del ciclo.
- **Impatto breve**: Elimina 3 aperture browser ridondanti per ciclo
- **Impatto medio**: Fingerprint coerente per tutta la sessione, meno TLS handshake, meno cookie load
- **Impatto lungo**: LinkedIn vede una singola sessione continua e naturale, non 4 micro-sessioni da 30 secondi
- **Anti-ban**: CRITICO — risolve il problema di detection multi-sessione piu' grave

### A.2 Warmup Integrato nel JobRunner (implementato in A.1)
- [x] **File**: `src/core/jobRunner.ts`, `src/core/sessionWarmer.ts`
- **Problema**: Il warmup (sub-task 17 del loop) apre un browser SEPARATO, fa warmup, chiude il browser. Poi il jobRunner apre il SUO browser e va direttamente al primo lead. Nessun warmup nella sessione operativa. E' come se un umano aprisse il browser, navigasse feed/notifiche, chiudesse il browser, lo riaprisse e andasse subito a lavorare.
- **Fix**: Il jobRunner deve fare warmup nella PROPRIA sessione browser, PRIMA del primo job. Usare `warmupSession(session.page)` dopo `checkLogin()` e prima del loop dei job. Rimuovere il sub-task 17 separato.
- **Dipendenza**: Si risolve automaticamente con A.1 (browser singleton), ma va fatto comunque come fallback
- **Impatto breve**: Il primo job della sessione ha warmup organico nella stessa sessione
- **Impatto medio**: LinkedIn vede un pattern naturale: feed → notifiche → poi lavoro
- **Impatto lungo**: Pattern coerente cross-sessione
- **Anti-ban**: ALTO — primo job senza warmup nella stessa sessione = segnale bot

### A.3 Working Hours Guard all'Avvio del Loop
- [x] **File**: `src/cli/commands/loopCommand.ts`
- **Problema**: Se PM2 riavvia il bot alle 2 di notte (dopo crash/OOM), il bot parte, passa il doctor preflight (sessione LinkedIn valida), e inizia a lavorare. Il `maintenance_window_skip` (3:00-6:00) copre solo 3 ore. Tra 0:00-3:00 e 6:00-HOUR_START il bot fa warmup, site-check, SalesNav sync — tutte azioni che aprono browser su LinkedIn di notte.
- **Fix**: All'inizio di ogni ciclo del loop, PRIMA di qualsiasi sub-task, verificare `isWorkingHour()`. Se fuori orario → skip TUTTO il ciclo (non solo il maintenance window). Il sleep inter-ciclo puo' essere piu' corto fuori orario (5 min invece di 15) per ricontrollare rapidamente.
- **Impatto breve**: Nessuna attivita' LinkedIn fuori orario lavorativo
- **Impatto medio**: Pattern di attivita' coerente con un umano che lavora 9-18
- **Impatto lungo**: Nessun accumulo di segnali "attivita' notturna" nel profilo LinkedIn
- **Anti-ban**: ALTO — attivita' notturna e' un segnale bot forte

---

## Sprint B: Operativita' e Osservabilita' (P1)

### B.1 Daily Report Automatico nel Loop
- [ ] **File**: `src/cli/commands/loopCommand.ts`
- **Problema**: Il daily report (251 righe, molto completo) NON viene mai chiamato automaticamente. Il config ha `dailyReportAutoEnabled` e `dailyReportHour` ma nessun sub-task nel loop li usa. L'utente deve eseguire `npm start -- daily-report` manualmente ogni giorno.
- **Fix**: Aggiungere un sub-task `daily_report` nel loop che verifica se `config.dailyReportAutoEnabled` e se l'ora corrente >= `config.dailyReportHour` e se il report non e' gia' stato inviato oggi (flag `daily_report.last_sent_date`). Se tutte le condizioni sono vere, chiama `generateAndSendDailyReport()`.
- **Impatto breve**: L'utente riceve il report ogni sera senza doverlo lanciare manualmente
- **Impatto medio**: Visibilita' quotidiana su pending ratio, acceptance rate, ban risk
- **Impatto lungo**: L'utente rileva trend negativi prima che diventino problemi
- **Anti-ban**: NEUTRO (nessuna azione LinkedIn) ma CRITICO per la visibilita' utente

### B.2 Ban Probability nel Daily Report
- [ ] **File**: `src/telemetry/dailyReporter.ts`
- **Problema**: `estimateBanProbability()` e' implementata e integrata nell'orchestratore, ma il daily report Telegram NON la include. L'utente vede il risk score (0-100) ma non il ban probability score separato che pesa diversamente i fattori.
- **Fix**: Aggiungere sezione `Ban Probability` nel daily report con score, level, fattori principali, e trend vs ieri.
- **Anti-ban**: NEUTRO (solo osservabilita') ma CRITICO per early warning

### B.3 Alert Telegram Avvio/Spegnimento Bot
- [ ] **File**: `src/index.ts`, `src/cli/commands/loopCommand.ts`
- **Problema**: L'utente non sa se il bot e' attivo o no, a meno di guardare PM2 o la dashboard. Se il bot crasha silenziosamente, l'utente non riceve nessun alert.
- **Fix**: Inviare alert Telegram "Bot avviato" all'inizio del loop e "Bot spento" nel graceful shutdown. Includere: ora, workflow, account, motivo shutdown.
- **Impatto breve**: L'utente sa immediatamente se il bot e' attivo
- **Impatto medio**: Rileva crash/restart anomali via storico alert
- **Impatto lungo**: Audit trail delle sessioni del bot

### B.4 Wind-Down Naturale a Fine Sessione
- [ ] **File**: `src/core/jobRunner.ts`, `src/browser/humanBehavior.ts`
- **Problema**: Quando il browser viene chiuso (fine sessione, rotazione, shutdown), la chiusura e' immediata. L'ultima azione visibile e' un invito/messaggio → chiusura browser. Un umano non fa cosi' — torna al feed, scrolla un po', poi chiude.
- **Fix**: Aggiungere `humanWindDown(page)` che fa: 30% probabilita' tornare al feed e scrollare 2-3 secondi, poi chiudere. Chiamarla prima di `closeBrowser()` nel jobRunner (fine sessione) e nel graceful shutdown.
- **Impatto breve**: L'ultima azione non e' sempre un'azione operativa
- **Impatto medio**: Pattern di chiusura naturale
- **Anti-ban**: MEDIO — chiusura brusca dopo azione operativa e' un pattern bot

---

## Sprint C: Resilienza e Infrastruttura (P1)

### C.1 Proxy Morto — Circuit Breaker con Escalation
- [ ] **File**: `src/core/jobRunner.ts`, `src/proxyManager.ts`
- **Problema**: Se il proxy e' permanentemente morto, il bot cicla infinitamente: avvio → proxy error → pausa 15min → riavvio → proxy error. L'utente non viene avvisato che il proxy e' **permanentemente** morto (non temporaneamente lento).
- **Fix**: Tracciare failure proxy consecutive cross-ciclo in `runtime_flags`. Dopo 3 cicli consecutivi con proxy error: (1) inviare alert Telegram CRITICO "Proxy morto permanentemente — intervento manuale richiesto", (2) pausare automazione indefinitamente, (3) NON riprovare automaticamente.
- **Impatto breve**: L'utente sa subito che deve cambiare proxy
- **Impatto medio**: Non spreca budget in tentativi inutili
- **Impatto lungo**: Previene accumulo segnali di connessione instabile su LinkedIn

### C.2 Disk Space Check nel Preflight
- [ ] **File**: `src/workflows/preflight.ts`, `src/core/doctor.ts`
- **Problema**: Se il disco e' pieno, il DB write fallisce con errore criptico. `checkDiskSpace()` esiste nell'orchestratore ma il preflight non lo verifica. Il bot puo' partire su disco pieno → crash mid-session → job stuck.
- **Fix**: Aggiungere check spazio disco nel doctor preflight e nel `computeSessionRiskLevel()`. Se <500MB → WARNING, se <100MB → STOP.

### C.3 Docker CMD Corretto
- [ ] **File**: `Dockerfile`, `docker-compose.yml`
- **Problema**: Il Dockerfile usa `CMD ["node", "dist/index.js", "dashboard"]` che avvia SOLO la dashboard, NON il bot. L'utente pensa "il container gira" ma il bot non sta facendo nulla.
- **Fix**: Cambiare il CMD a un entrypoint che avvia SIA il dashboard (background) SIA il run-loop. Oppure documentare chiaramente che servono 2 container separati.

---

## Sprint D: UX e Lifecycle (P2)

### D.1 Intervallo Loop con Jitter
- [ ] **File**: `src/config/index.ts`, `src/cli/commands/loopCommand.ts`
- **Problema**: L'intervallo tra i cicli del loop e' costante (15 min default). Un umano non lavora a intervalli di 15 minuti precisi.
- **Fix**: Aggiungere jitter +-20% sull'intervallo: `effectiveInterval = base * (0.8 + Math.random() * 0.4)`.
- **Anti-ban**: BASSO ma contribuisce alla varianza complessiva

### D.2 Transizione Weekend Graduale
- [ ] **File**: `src/risk/strategyPlanner.ts`
- **Problema**: Il bot passa da 100% attivita' venerdi' sera a 10% sabato mattina. Transizione brusca e innaturale.
- **Fix**: Venerdi' pomeriggio (14:00+) → `inviteFactor` cala progressivamente. Lunedi' mattina → parte lento e accelera. Modellare come una curva sinusoidale, non un gradino.
- **Anti-ban**: BASSO ma contribuisce al realismo multi-giorno

---

## Ordine Implementazione

```
Sprint A (P0 anti-ban arch) → A.1, A.2, A.3                     [3/3] ✅
Sprint B (P1 observability) → B.1, B.2, B.3, B.4                [0/4]
Sprint C (P1 resilience)    → C.1, C.2, C.3                     [0/3]
Sprint D (P2 UX/lifecycle)  → D.1, D.2                          [0/2]
                                                          Totale [3/13]
```

Gate: `npm run conta-problemi` = EXIT 0 dopo ogni sprint

---

## Archivio: Audit Precedente (COMPLETATO 2026-03-13)

> **30/30 task + 7 fix effetti composti + 3 fix L1→L6 wiring**
> Commit: `fdcf92e` — "feat: TODO 30/30"
> Verificato: `npm run conta-problemi` EXIT 0 (202/202 test), `npm run test:e2e:dry` PASS
>
> Sprint 1-6 completati: session variance, navigation chains, trust score, deconfliction,
> outcome-driven budget, post-action verification, warmup ordinato, scroll 3 fasi,
> viewport dwell, profile dwell, checkpoint/resume, smart batch, risk assessment,
> per-list report, stale data warning, ban probability, cross-day jitter, mouse ease-in-out,
> typing flow, suggerimenti azionabili, graceful degradation, circuit breaker per-lista,
> session breadcrumbs, selector false positives fix.
>
> Fix effetti composti: computeProfileDwellTime unificata, nav chain keywords generiche + decay,
> trust score fuori loop, hasOtherAccountTargeted senza JSON_EXTRACT, list perf >=7gg,
> checkpoint per nome, selector body check, import statico getLeadById,
> frequencyFactor timestamp ISO, estimateBanProbability sempre attivo.
