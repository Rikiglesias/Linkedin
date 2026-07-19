# /goal workflow-hardening — i 4 workflow girano CON PROXY, bug fixati, anti-ban SOTA

> **CONFERMATO-APERTO 2026-07-04 — passata `todos-freddi`** (auditor opus, verifica alla fonte; verdetti integrali: `maintenance/2026-07-04-verdetti-todos-freddi.json`)
> Evidenza: Linkedin HEAD 0daaf6d (2026-06-14, branch refactor/adk-split). Pilastri #2/#3 chiusi con evidenza: worklog 8d94367 (9 fix workflow-hardening), c4fdabe (keystroke floor 40->55ms SOTA), 27626ca/94a2f3f (A1/A2/A3/A5), + goal syncsearch T1-T7 sync-search e99cc90..1e906c4 il 06-14. Pilastro #1 (4 workflow E2E CON PROXY) MAI raggiunto: user-actions-pending.md:79 = re-login FATTO 06-10 ma "proxy mobile ~85s/nav" ancora aperto; send-invites/send-messages mai girati live e senza flag --no-proxy. NON nel …
> Azione/causa: NON marcare [x], NON archiviare. Aggiorna la riga STATO del tracker (e roadmap.md:26) così: pilastro #2 (bug) e #3 (anti-ban SOTA) chiusi con evidenza commit; pilastro #1 (E2E con proxy) unico residuo reale = leva utente. Prossimo passo AI-eseguibile (sblocca senza attesa, ma non verificabile senza proxy): implementare W1(B) — resource-blocking via page.route (immagini/media/font/tracker) + alzare timeout canary/nav sul path-proxy (>=30s) + aggiungere il flag --no-proxy a send-invites/send-messages per smoke-test offline; file gated -> /antiban-review + antiban-approved.txt PRIMA di ogni Edit.…


> Binding per `/goal workflow-hardening`. Aperto in NUOVA chat il 2026-06-09 (sessione precedente a 2599 turni).
> Riprende i backlog di "ieri sera": [[linkedin-bot-backlog-2026-06-09]] + improvements-proposed.md + user-actions-pending.md + audit-orchestrator-fix.md.
> Modello: Opus (reasoning alto-rischio anti-ban). Ultracode ON → per analisi/ricerca usare Workflow fan-out; fix a codice vivo INLINE.

## END-STATE (misurabile)
1. **Tutti e 4 i workflow girano end-to-end CON IL PROXY** (non solo `--no-proxy`): sync-list, sync-search, send-invites, send-messages — ognuno parte nel terminal, completa, salva nel DB, senza crash/canary-fail.
2. **Bug/problemi di ogni workflow identificati e fixati** (gate `conta-problemi` verde + antiban-review SAFE per ogni file gated).
3. **Anti-ban potenziato allo stato dell'arte 2026** — gap vs SOTA identificati con ricerca web, top-improvements applicati.

## Stato di partenza (verificato sessione precedente — NON ri-diagnosticare a vuoto)
- `sync-list --no-proxy` **GIRA e scrapa** (Pagina 1-4, salva DB). Commit chiave: `e7913ac` (canary onora --no-proxy), `ee7dfc0` (canary timeout feed.global_nav 4s→10s: la global-nav React monta a ~4-6s, NON era selettore stale), `9bf5552` (listUrl validato), `327e329` (login goto robusto), `4393bcc` (diagnosi canary per causa).
- **IL MURO per "con proxy"**: proxy Oxylabs è **MOBILE** (exit IT/TIM) → serializza le connessioni → camoufox **85s/navigazione** (fetch grezza 2s). Il canary a 10s NON basta sul proxy mobile (85s). Vedi sotto W1.

## PROGRESSO 2026-06-09 (turno /goal workflow-hardening)
**Anti-ban audit-orchestrator (i bug W2 agganciati) — 3/5 + 1 infra, tutti gate verde 1582 test:**
- ✅ **A1** guardian fail-open (commit `27626ca`): `severity:critical + pauseMinutes:0` non pausava → ora pausa SEMPRE ≥30min (`MIN_CRITICAL_PAUSE_MINUTES`). Radice in `guardian.ts` (`enforceCriticalPauseFloor`) + difesa fail-closed in `orchestrator.ts` + 7 test.
- ✅ **A3** ACCEPTANCE_CHECK/HYGIENE accodati in risk STOP (`27626ca`): aggiunto `&& riskSnapshot.action !== 'STOP'` (coerenza con POST_CREATION/ENRICHMENT).
- ✅ **A5** `applyAdaptiveFactor` invito-fantasma (`27626ca`): il floor a 1 vale solo senza penalità (factor≥1); con factor<1 (lista a rischio) si permette 0. Test buggy corretto.
- ✅ **R6** hook auto-push (commit `27d14d2`): `post-bash-auto-push.ps1` ora fa SKIP su commit anti-ban (era il bug ricorrente che auto-pushava i fix anti-ban senza review). Verificato su HEAD reale.
- ⚠️ NB: i 2 commit anti-ban (27626ca) sono stati auto-pushati PRIMA del fix R6 (branch `refactor/adk-split`, codice verde → no revert). Dal fix in poi i commit anti-ban NON si auto-pushano più.

- ✅ **A2** weekly invite cap (commit `94a2f3f`): check weekly in esecuzione nell'inviteWorker (dopo il daily atomico) — se `countWeeklyInvites > config.weeklyInviteLimit` → compensa (-1) + skip. +test. Rischio anti-ban CHIUSO; over-scheduling nello scheduler = follow-up igiene (no rischio).
- ✅ **R6 VERIFICATO end-to-end**: il commit A2 (tocca inviteWorker, anti-ban) NON è stato auto-pushato — l'hook ha fatto SKIP correttamente. Commit `94a2f3f` resta LOCALE.

- ✅ **R1** comando automation fallito→SUCCEEDED (commit `b3cc1d7`): loopCommand branching success→SUCCEEDED / WORKFLOW_ERROR→FAILED / blocco-protezione→SKIPPED. R1c escluso (workerResult.success corretto), R1d edge tracciato. Auto-pushato (non anti-ban).
- 🔵 **A4** guard post-enqueue: ANALIZZATO, NON fixato. Rischio principale GIÀ mitigato dai re-check runtime jobRunner (pausa `:489` + quarantena `:1378` + cap atomici). Gap residuo ARCHITETTURALE (compliance senza barriera + job che sopravvivono alla scadenza pausa) → fix vero = tracciare ID job accodati + delete al blocco, o split plan/commit di scheduleJobs = multi-file alto-impatto → **richiede Plan Mode dedicato**. Dettaglio in `audit-orchestrator-fix.md`.

**STATO: 9 fix verdi committati** (A1/A3/A5/A2/R6/R1 + R6-bis + W3-keystroke + D1/A4/D2), gate fino a 1592 test. **PIANO ARCHITETTURALE D1+A4+D2 COMPLETO** (vast-inventing-engelbart.md eseguito al 100%). Pilastro #2 (bug) sostanzialmente CHIUSO: restano solo M1-M3 medium (verificati/tracciati, non-critici) + follow-up cloud.daily_stat idempotency. Pilastro #3 (SOTA) chiuso (bot già allineato + keystroke + correzione proxy). Pilastro #1 (E2E proxy) = LEVA UTENTE (re-login mobile). W1(B) resource-blocking: codice fattibile ma effetto misurabile solo con proxy E2E (leva utente).
**PROSSIMO:** D1-D3 integrità dati [D1 mutex `withTransaction` SQLite = concorrenza, ALTO RISCHIO deadlock → contesto fresco/Plan; D2 outbox cloud drena solo cp_events; D3 incrementCloudDailyStat non atomico] → M1-M3 (medium) → **W3 ricerca SOTA 2026** (WebSearch dedicata + audit stack vs gap, top-fix gated) → **W1(B) resource-blocking** (gated). Pilastro #1 (4 workflow E2E col proxy) = LEVA UTENTE (re-login + scelta proxy residential/mobile).

## W0 — Carica contesto (inizio, read-only)
- [ ] Leggi: `~/todos/linkedin-bot-backlog-2026-06-09.md` (8 punti), `~/todos/improvements-proposed.md` (sez. 2026-06-09: geoip exit-IP, resource-blocking, [WINDOW-BLOCK] mouse, canary-noproxy ✅fatto), `~/todos/user-actions-pending.md` (proxy, re-login), `~/todos/audit-orchestrator-fix.md` (A1-A5 anti-ban, D1-D3 dati, R1). VERIFY: elenco consolidato dei task aperti.

## W1 — 🔴 FAR GIRARE CON IL PROXY (il pilastro #2)
- [ ] Root: proxy MOBILE troppo lento per il browser (85s/nav). Due strade — DECIDERE con l'utente (anti-ban + costo = leva utente):
  - (A) ⛔ **Residential NON è il fix anti-ban** (CORRETTO da W3/SOTA 2026, 2026-06-09): su LinkedIn 2026 il proxy MOBILE ha ~85% survival vs ~50% del residential — i residential sono stati FLAGGATI da quando LinkedIn ha esteso la proxy-detection nel 2025. Il residential sarebbe più veloce in concorrenza ma PIÙ rilevabile → **NON comprarlo per LinkedIn**. Il mobile va TENUTO (è il migliore anti-ban); il suo unico difetto è la lentezza (85s/nav) → si affronta BOT-SIDE (strada B sotto), non cambiando tipo di proxy.
  - (B) Bot-side se si resta su mobile: **resource-blocking** (immagini/media/font/tracker via `page.route`, taglia banda+tempo) + alzare timeout canary/nav per il path-proxy (es. 30s+) + ri-login ATTRAVERSO il proxy (coerenza IP). NB: la (B) rende il bot lento ma usabile; la (A) è la soluzione pulita.
  - DONE: `.\bot.ps1 sync-list` (SENZA --no-proxy) gira end-to-end e salva. VERIFY: report SYNC-LIST status≠BLOCCATO + righe nel DB.

## W2 — 🔴 I 4 WORKFLOW (bug + miglioramenti, uno per uno)
Per OGNUNO: run nel terminal → osserva → trova bug/problemi → fixa (INLINE, gated→antiban-review) → ri-run verde.
- [ ] **sync-list** — gira (--no-proxy); verificare con proxy (W1) + edge: lista multipla, paginazione, enrichment, dedup. VERIFY: run completo + DB.
- [ ] **sync-search** — MAI testato live. Bulk-save da ricerche salvate + Vision AI fallback + dedup + sync. Trovare bug. VERIFY: run + lista popolata.
- [ ] **send-invites** — MAI testato live (richiede lead READY_INVITE dallo scrape). Cronometria disfasica, nota AI, cap/min-score. ⚠️ NON supporta `--no-proxy` (gap noto) → richiede proxy funzionante (W1) o aggiungere il flag. VERIFY: 1 invito reale salvato (status INVITED) o dry-run.
- [ ] **send-messages** — MAI testato live (richiede ACCEPTED). Prebuilt message, multilingua, anti-doppione. Stesso gap --no-proxy. VERIFY: dry-run o 1 messaggio reale.
- Bug già tracciati da agganciare qui: audit-orchestrator-fix A1-A5 (guardian fail-open, weekly limit, risk-STOP), D1-D3 (transazioni SQLite, outbox cloud, stat atomiche), R1 (job fallito→SUCCEEDED). [WINDOW-BLOCK] mouse 2°-monitor.

## W3 — PROGRESS 2026-06-09 (ricerca SOTA + audit + primo top-fix)
**Ricerca SOTA 2026 FATTA** (5 query WebSearch: keystroke/mouse biometrics, fingerprint JA3/JA4/canvas, residential-vs-mobile, Camoufox stealth, rate-limits). **Audit stack vs gap:**
- ✅ **Keystroke floor 40→55ms** (commit `c4fdabe`): SOTA dice <50ms = zona-bot (21% bot vs 5.8% umani); il floor a 40ms era ancora rilevabile. FIXATO.
- ✅ **Soglie rate-limit GIÀ conservative/allineate** (no fix): weekly 80 (<100 baseline SOTA), daily hardCap 25 (range safe 20-30), pending ratio 0.55/0.65, SSI 30-80. Il bot è già prudente.
- 🔄 **CORREZIONE DIREZIONE PROXY** (vedi W1-A sopra): mobile > residential su LinkedIn 2026 → leva utente corretta.
- **Gap residui — ESITI VERIFICATI (2026-06-09):**
  1. ✅ `USE_JA3_PROXY=false` = **FALSO GAP**: il bot usa camoufox (evidenza runtime: misurazioni camoufox+proxy 85s, config camoufox* attive). Con camoufox il TLS handshake è NATIVO del browser (Firefox), coerente e pre-JS — la validation del bot (validation.ts:389) warna solo se `browserEngine !== camoufox`. JA3-proxy serve solo a client non-browser → ridondante qui. Nessun fix. ⚠️ MA: se si passasse a chromium (default `BROWSER_ENGINE`), diventerebbe gap reale.
  2. ✅ **Warming già conservativo**: bot `warmupMaxDays` default 30gg > 21gg SOTA. OK.
  3. 🟡 **Varianza volume**: bot HA NoBurstPlanner (commit B `489768d`) + mood factor + adaptiveFactor + weekly 80<100 baseline → varianza presente e cap conservativo. Verifica fine (il volume settimanale non tende meccanicamente al cap) = follow-up leggero.
  4. 🟡 **pending COUNT assoluto <500/700** (oggi solo ratio): miglioria a SCALA (account test non lo tocca) → follow-up, non urgente.
  5. 🟡 **Camoufox maintenance-gap 2026** (versione base Firefox datata + inconsistenze rotazione): dipendenza esterna → monitorare/aggiornare camoufox (leva infra), non un fix di codice immediato.
  **Conclusione W3: il bot è GIÀ largamente allineato alla SOTA 2026** (soglie conservative, warming 30gg, varianza NoBurst, camoufox TLS nativo); l'unico gap NETTO era il keystroke floor (FIXATO `c4fdabe`). Restano migliorie a-scala/monitoraggio, non gap critici.

## W3 — 🔴 ANTI-BAN STATO DELL'ARTE ("hacker-level") — con RICERCA WEB
- [ ] **WebSearch SOTA 2026** (fonti che "sanno quello che fanno"): query mirate —
  - "LinkedIn bot detection 2026 behavioral biometrics keystroke mouse ML"
  - "anti-detect browser fingerprint 2026 canvas webgl audio JA3 JA4 TLS"
  - "residential vs mobile proxy LinkedIn detection 2026"
  - "Camoufox / Playwright stealth detection bypass 2026"
  - "LinkedIn rate limits pending ratio safe thresholds 2026"
  (cataloghi: linkboost, stormy.ai, anti-detect vendor docs, security research blog)
- [ ] **Audit del bot vs SOTA**: confrontare lo stack reale (camoufox fingerprint, humanBehavior timing/typing/mouse, riskEngine, proxy, JA3 `USE_JA3_PROXY=false`!, geoip exit-IP bug, sessionMemory) coi gap della ricerca. Workflow fan-out per l'audit.
- [ ] **Applica i top-potenziamenti** (gated, antiban-review, gate verde): es. JA3/TLS coerente (USE_JA3_PROXY), geoip da exit-IP reale (improvements-proposed), keystroke/mouse ulteriore varianza se sotto-SOTA, ecc. DONE: gap critici chiusi + dichiarati.

## Note operative
- File gated (browser/workers/salesnav/guards): `/antiban-review` + flag `antiban-approved.txt` (SOVRASCRIVI con Set-Content -NoNewline, NON appendere) PRIMA di ogni Edit.
- Config no-proxy attuale (se serve testare veloce): `$env:BYPASS_WORKING_HOURS='true'; .\bot.ps1 sync-list --no-proxy` (+ unquarantine se serve).
- NON fare `rm -rf .playwright-mcp` (file tracciati del 18/04).
- PR gpt-5.5 Supervisor bloccata nel cloud (ferry da fare, vedi linkedin-bot-backlog) — separata da questo goal.
