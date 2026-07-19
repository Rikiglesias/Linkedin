# Run-through workflow LinkedIn bot — uno a uno (demo domani)

> **CONFERMATO-APERTO 2026-07-04 — passata `todos-freddi`** (auditor opus, verifica alla fonte; verdetti integrali: `maintenance/2026-07-04-verdetti-todos-freddi.json`)
> Evidenza: readingSimulation.ts:116-122 orientation 300-800 / reading 500-2000 INVARIATI + :155 tab-switch 0.15 (chiesti 150-450/350-1100/6-8%) → line64 NON fatto. typoGenerator.ts:191 `return 0.7` (chiesto 0.8) → line65 NON fatto. missclick.ts esporta shouldMissclick/performMissclick (computeSafeMissclickPoint:125 già safe-zoned) ma humanBehavior.ts:16 importa solo accidental-nav, le 2 fn sono unused → line63 NON cablato. scheduler.ts:350 log-normale + :357-361 long-break stocastico → line66 FATTO. Residu…
> Azione/causa: NON archiviare (perderebbe 3 micro-fix anti-ban verificati aperti e non tracciati altrove). 1) Marcare [x] SOLO line 66 (scheduler.ts:350 inter-arrival log-normale + :357-361 long-break stocastico = intento uniforme→non-uniforme e periodico→random soddisfatto). 2) Tenere [ ] line 63/64/65 con causa "verificato NON applicato alla fonte 2026-07-04". Prossimo passo AI, sotto /antiban-review + gate `npm run conta-problemi`: readingSimulation.ts:116-117 300-800→150-450, :121-122 500-2000→350-1100, :155 0.15→0.06-0.08 (line64); typoGenerator.ts:191 0.7→0.8 (line65); cablare shouldMissclick/performMi…


> Creato 2026-06-08. Obiettivo utente: far partire OGNI workflow del bot e verificare che funzioni
> davvero, pronto da mostrare a una persona domani (locale). Modalità: interattiva, uno a uno —
> io lancio, l'utente dà feedback su cosa non va, io fixo.
> Branch refactor/adk-split. Gate: `npm run conta-problemi` exit 0.

## Griglia di accettazione PER OGNI workflow (dedotta da zero-L: gli esempi dell'utente sono seed)
Gli esempi dell'utente ("salva DB", "non si blocca", "mouse human", "veloce") sono RADICI; sotto il perimetro completo.

- **A. Avvio & non-blocco**: parte senza crash; completa senza hang; timeout su ogni I/O; fail pulito (no crash muto); idempotenza; cleanup (context/listener/fd); termina correttamente.
- **B. Persistenza DB**: scrive tabelle giuste, dato completo; transazione atomica (rollback su fail); aggiorna stato (lead pending→sent, automation_command done/failed); nessun dato perso; VERIFICABILE con query reale.
- **C. Mouse human-like**: traiettoria curva (no teletrasporto); velocità a DOPPIO limite (né più veloce né più lento di un umano); ordine umano (scroll→hover→dwell→click); hesitation/pause variabili; typing human-paced; scroll naturale; niente page.goto dove un umano clicca.
- **D. Velocità (tensione risolta)**: veloce sul SOFTWARE (setup/logica/DB/avvio browser); human-paced sull'INTERAZIONE LinkedIn. Non confondere: accelerare l'interazione = ban.
- **E. Anti-ban/stealth** (dedotto, priorità zero): fingerprint coerente; varianza timing; cap/pending rispettati; sessione corta; WebRTC/proxy leak off; no bypass risk engine; proxy fail-closed.
- **F. Correttezza funzionale**: azione giusta/persona giusta; guardrail (no blacklist/over-budget); contenuto/template corretto; verify pre/post.
- **G. Osservabilità demo**: headed + log chiaro (la persona vede il mouse e gli step); errori leggibili.
- **H. Robustezza edge**: coda vuota; DOM cambiato; challenge/captcha; rete lenta/caduta; proxy fallito.

## Inventario workflow (worker src/workers/) — da completare con la mappatura agenti
inviteWorker · messageWorker · followUpWorker · acceptanceWorker · inboxWorker · interactionWorker ·
enrichmentWorker · randomActivityWorker · postCreatorWorker · hygieneWorker · rampUpWorker ·
batchAcceptanceChecker · chatMessageExtractor · deadLetterWorker · messagePrebuildWorker
(orchestrati da src/automation/dispatcher.ts via coda automation_commands)

## Findings verificati alla fonte (mappatura wf_2ad7b6c2-88d, 6 agent)
### Sicurezza proxy (CRITICO anti-ban)
- Comandi REALI (`run invite`...) = FAIL-CLOSED al preflight: `index.ts:421-456` checkProxyHealth → se tutti KO `process.exit(1)`. `--skip-preflight` NON bypassa il check proxy (gated solo il doctor, index.ts:418 vs 487-492). ✅
- `launchBrowser` di per sé è FAIL-OPEN: `launcher.ts:271-276` chain vuota → `launchPlan=[undefined]` → IP diretto. La protezione reale è il preflight, non il launcher.
- `dry-run` SALTA il preflight (index.ts:418,490) → col proxy morto aggira la protezione e arriva a launchBrowser → NON fare dry-run linkedin-live senza proxy vivo.
- → FIX proposto (gated, non applicato): rendere launchBrowser fail-closed coerente col preflight (throw se managed-proxy ma nessuno disponibile). File src/browser/launcher.ts.

### Flusso lancio
- automation_commands (coda SQLite/PG) -> claimNextAutomationCommand (loopCommand.ts:358-413) -> dispatcher.ts:32-114 (switch kind) -> service -> runWorkflow (orchestrator.ts:233) -> jobRunner runQueuedJobs -> workerRegistry.get(type).process(job, ctx) (jobRunner.ts:633-638).
- Daemon = PM2 `linkedin-bot-daemon` = `dist/index.js run-loop` (while(true), min 300s anti-ban).
- Lancio UN workflow isolato: `npm run start:dev -- run <invite|message|check|all|warmup>` (one-shot, no loop); dry-run: `dry-run <wf>`. Worker db-only senza CLI → importare e chiamare la funzione (rampUp/deadLetter sono pure funzioni DB sicure).
- DB locale = SQLite `data/linkedin_bot.sqlite` di default (no DATABASE_URL); Postgres/Supabase solo se DATABASE_URL set.

### Triage worker (15) per proxyRisk
- DB-only/local (SICURI ora, salvano DB): rampUpWorker (lead_campaign_config/ramp_up_state/runtime_flags), deadLetterWorker (jobs), enrichmentWorker (leads — API terze). + CLI `import` (leads), `enrich-fast`.
- linkedin-live (BLOCCATI senza proxy): invite, message, followUp, acceptance, inbox, interaction, randomActivity, postCreator, hygiene, batchAcceptance, chatExtractor.
- Mouse human-like = MouseGenerator (Bézier+fractal+tremor+Fitts, launcher.ts:456-459) + clickLocatorHumanLike (humanClick.ts) + green dot (humanBehavior.ts:86). Demo SICURA = mini-script headed su pagina LOCALE, COMPILATO (no ts-node → rompe binding camoufox).

## Piano demo domani (ordine sicuro→bloccato)
- [x] 1. Mouse human-like su pagina locale → FATTO. `npm run mouse:demo` (src/scripts/mouseDemo.ts). Gira 6/6 click, no blocco, usa motore reale humanMouseMoveToCoords→MouseGenerator. Engine chromium (BROWSER_ENGINE forzato), no input-block, no proxy. ATTESA feedback utente sulla VELOCITÀ del mouse (né più veloce né più lento).
- [ ] 2. Worker DB-only (rampUp/deadLetter o `enrich-fast`/`import`): prova parte/salva-DB/non-blocca/veloce. VERIFY = query SQLite mostra la riga.
- [ ] 3. (solo se proxy ricaricato) Un workflow LinkedIn-live end-to-end headed: mouse su LinkedIn + invio + save. Altrimenti resta bloccato fail-closed.
- NB gate: mouseDemo.ts + package.json NON ancora committati → `npm run conta-problemi` prima del commit (dopo validazione utente).

## INTENTO REALE CHIARITO (2026-06-08, supera "demo sicura")
L'utente vuole: i workflow girano DAVVERO su LinkedIn (account vero), salvano/aggiornano il DB
coerentemente, e il COMPORTAMENTO è best-practice anti-ban = un VENTENNE SVELTO E VELOCE (non un
90enne lento, non un robot). Da analizzare: mouse, SCROLL, click, dove clicca, volumi, timing, navigazione.
"Diversi tipi di workflow che fanno cose diverse" → coprire ciascuno distintamente (i 15 worker già mappati).

## Audit comportamentale anti-ban — DONE (wf_307f39ee)
Verdetto: split-brain. MACRO (volumi/timing/navigazione) già OK. MICRO robotica → 4 fix APPLICATI (commit 94fcd96, gate verde 1561 test):
- [x] TYPING floor post-moltiplicatore (char≥40ms, spazio≥80ms) + default ~137→~87 WPM — humanBehavior.ts:898-905
- [x] SCROLL wheelWithMomentum (4-8 tick decrescenti) sostituisce il singolo wheel — humanBehavior.ts
- [x] MOUSE durata ∝ Fitts + jitter log-normale (no budget fisso, no uniforme) — humanMouseMove/ToCoords
- [x] CLICK dispersione gaussiana 2D σ~18% + pre-click non uniforme — humanClick.ts
### Fix minori TRACCIATI (non-blocker, da fare in un 2° giro):
- [ ] MISSCLICK: cablare shouldMissclick/performMissclick rate 0.02 — MA prima fixare computeSafeMissclickPoint (offset può cadere DENTRO il target = click sbagliato reale). Rischioso, va testato.
- [ ] SCROLL pause inter-step più brevi (orientation 300-800→150-450, reading 500-2000→350-1100); tab-switch 15%→6-8%.
- [ ] TYPING typoGenerator.ts:191 flow-state cap 0.7→0.8.
- [ ] VOLUMI igiene: scheduler.ts:345 spacing uniforme→gamma; long-break ogni 7→5-10 random.

## END-STATE misurabile (per /goal workflow-runthrough-2026-06-08)
1. I fix comportamentali anti-ban applicati (mouse: timing non-piatto var distanza; scroll: momentum/multi-tick; typing: floor reale + WPM credibile; click: missclick riattivato + jitter più largo) — più VARIANZA, non più lento (il flag è l'uniformità, non la velocità).
2. Gate verde: `npm run conta-problemi` exit 0 + `/antiban-review` SAFE su ogni file gated toccato.
3. Almeno un workflow LinkedIn gira END-TO-END su account TEST (proxy vivo) salvando/aggiornando il DB; poi via via gli altri tipi.
4. Verificato a runtime (headed) che mouse/scroll/typing sembrano un ventenne sveglio, non robot né 90enne.

## Budget invite 0 — CAUSA VERIFICATA (2026-06-08 20:47), NON è un bug
1. ORARIO: 20:47 > working hours 9-18 (domains.ts HOUR_START=9/HOUR_END=18). getWorkingHourIntensity() ritorna 0 fuori orario (config/index.ts:97-99) → inviteBudget = budget×0 = 0 (scheduler.ts:492). Anti-ban corretto. → invite reale possibile SOLO in orario 9-18.
2. LEAD non pronti: 250 lead tutti NEW (importati marzo), 0 READY_INVITE. Scheduler invita solo READY_INVITE (scheduler.ts:722). daily_stats vuoto (account senza storia). → servono qualificazione/enrichment NEW→READY_INVITE.
Dry-run invite = SOLO preview (no browser). Schema reale: lead_campaign_state, lead_lists, list_leads, list_rampup_state (NON lead_campaign_config).

### Per un invite REALE che salva nel DB servono ENTRAMBE: orario 9-18 + lead READY_INVITE.
- [ ] Capire pipeline qualificazione NEW→READY_INVITE (enrichment offline + scoring/site-check).
- [ ] Demo invite reale: domani in orario, con lead qualificati.
- Alternative per vedere stasera (fuori orario): random-activity (navigazione reale, no budget-dipendente, ma azioni reali) · worker DB-only (rampUp/deadLetter, salvano DB, zero LinkedIn).

## ⚠️ QUARANTENA account (scoperta 2026-06-08 sera) — NON è un ban
- sync_state.account_quarantine=true dal 2026-03-30. Causa: account_incidents id1 SELECTOR_CANARY_FAILED CRITICAL OPEN ({"workflow":"all"}). challenge_events VUOTO → LinkedIn NON ha beccato l'account. Auto-quarantena interna del bot (selettori non matchavano il DOM a marzo).
- sync-list NON è guarded (index.ts:273 guardedCommands = run/run-loop/autopilot/connect/check/message/warmup/random-activity) → quarantena NON lo blocca, può girare.
- OUTREACH (invite/message/random-activity) BLOCCATI dal preflight quarantine (index.ts:498 → exit 1). Per sbloccare: comando `unquarantine` (index.ts:625) MA prima verificare che i selettori funzionino ancora (ri-eseguire selector canary; LinkedIn UI può essere cambiata da marzo). NON unquarantine alla cieca.
- run_logs ultimo 2026-06-08 18:39 (solo plugin loader) → sync-list non risulta ancora partito. salesnav_list_items=250 (sync marzo), last_synced 24/03.

## Leve utente (stato)
- **#1 Proxy Oxylabs** — ✅ FATTO (traffico ricaricato 2026-06-08).
- **#2 Account** — ✅ account di TEST reale (scelto dall'utente).
- **#3 /goal** — DA LANCIARE: `/goal workflow-runthrough-2026-06-08` PRIMA delle modifiche al codice gated anti-ban (regola fasi).
- Goal `linkedin-os-dashboard` (sito) → /goal clear se ancora attivo (fuori scope ora).

## Git
- Commit fabc25b (demo mouse) + 94fcd96 (4 fix anti-ban) AUTO-PUSHATI su origin/refactor/adk-split (hook). Gate verde.
- ⚠️ BUG ENFORCEMENT da fixare: la regola `.claude/rules/git-commit-push.md` dice "anti-ban/stealth/fingerprint ROMPONO l'auto-push → review di branch", ma l'hook auto-push l'ha pushato comunque (94fcd96 tocca src/browser/* anti-ban). Regola DOCUMENTATA ma NON enforced nell'hook. → fixare l'hook auto-push perché rompa su glob anti-ban (src/browser|risk|salesnav|captcha|workers, proxy, migration). Task separato (infra hook globale).
