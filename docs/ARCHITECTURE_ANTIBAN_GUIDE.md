## Stato documento

- Ruolo: reference tecnica anti-ban e stealth.
- Canonico per: dettagli implementativi e principi architetturali anti-detect.
- Non usare come guida operativa per operatori: per quello usare `GUIDA_ANTI_BAN.md`.

---

1. Architettura Generale e Principi di Base
Il bot è un’applicazione Node.js/TypeScript che orchestra browser reali (Playwright) con un focus ossessivo sull’imitazione del comportamento umano. Tutto il codice è strutturato per rendere ogni azione indistinguibile da quella di un utente legittimo.

Database : SQLite (sviluppo) o PostgreSQL (produzione). Contiene lead, job, statistiche, log e stato. Tutte le transizioni di stato sono atomiche e versionate per evitare corruzione in caso di crash.

Worker e Code : i job (inviti, messaggi, check accettazioni) sono gestiti in coda con priorità e retry intelligenti. Questo disaccoppia le operazioni e permette di distribuire il carico in modo naturale.

Orchestratore : run-loop esegue cicli continui rispettando orari lavorativi, limiti giornalieri/settimanali, e inserisce pause casuali e azioni diversive.

2. Tecniche Anti‑Ban – Strati di Protezione
Ogni strato è progettato per mascherare un diverso aspetto dell’automazione.

2.1. Fingerprinting e Identità Digitale
Pool di fingerprint realistici (src/fingerprint/pool.ts)
Sono predefiniti 8 profili desktop e 6 mobile, ciascuno con User‑Agent, viewport, JA3 fingerprint, timezone e locale coerenti. La selezione è deterministica per account e settimana (FNV‑1a hash), così lo stesso account usa lo stesso profilo per circa una settimana, imitando un browser che non cambia ogni giorno.

Coerenza TLS (JA3) (src/proxy/ja3Validator.ts)
Se USE_JA3_PROXY è attivo, il traffico passa attraverso CycleTLS che spoofa il fingerprint TLS in base al JA3 associato al profilo. Se non attivo, il filtro seleziona solo fingerprint Chrome/Edge quando si usa Chromium, e solo Firefox quando si usa Firefox, evitando incoerenze UA‑TLS.

Canvas/WebGL/audio noise deterministico (src/browser/launcher.ts, stealthScripts.ts)
Viene iniettato rumore nelle API di canvas (getImageData) e WebGL (getParameter) usando un PRNG Mulberry32 seedato dal fingerprint e dalle coordinate del crop. Lo stesso fingerprint produce sempre lo stesso rumore per la stessa regione, ma regioni diverse hanno rumore diverso, rendendo il fingerprinting incrociato impossibile.

Performance.memory mock (stealthScripts.ts)
Simula un heap JavaScript che cresce realisticamente nel tempo, come un browser con molte tab aperte.

Font enumeration defense (stealthScripts.ts)
document.fonts.check() viene mockato per restituire true solo per font di sistema comuni, evitando che servizi come FingerprintJS possano enumerare i font reali.

Navigator e piattaforma (stealthScripts.ts)
Vengono corretti navigator.platform, oscpu, hardwareConcurrency, deviceMemory per essere coerenti con lo UA. Anche le proprietà chrome.runtime, chrome.loadTimes sono mockate dove necessario.

2.2. Comportamento Umano nel Browser
Movimenti del mouse realistici (src/browser/humanBehavior.ts, src/ml/mouseGenerator.ts)
I percorsi del mouse non sono lineari ma generati con curve di Bézier cubiche + rumore frattale + micro‑tremori (fisiologici). La velocità varia con legge di Fitts (decelerazione all’avvicinarsi al target). Inoltre, c’è una probabilità di “missclick” su zone vuote e di “navigazione accidentale” (missclick.ts).

Digitazione umana (humanBehavior.ts, src/ai/typoGenerator.ts)
La digitazione include errori di battitura (adiacenti, doppi, omissioni) con una probabilità calcolata per sessione (session typo rate). Inoltre, si verifica una “distrazione” occasionale: pausa lunga, backspace e riscrittura, scroll nella conversazione. Le parole comuni vengono battute più velocemente (flow state).

Tempi di reazione log‑normali (src/ml/timingModel.ts)
I delay non sono fissi ma seguono una distribuzione log‑normale, con una coda lunga per simulare distrazioni umane. I tempi variano anche in base all’ora (fatica serale) e alla lunghezza del testo letto.

Scroll a fasi (humanBehavior.ts)
Lo scrolling non è uniforme: fasi di “orientamento” (scroll veloce), “lettura” (scroll lento con pause) e “skip” (scroll veloce). Transizioni probabilistiche tra le fasi.

Visualizzazione a schermo (viewport dwell) (humanBehavior.ts)
Prima di cliccare un elemento, il bot si assicura che sia visibile da almeno 800‑2000ms, simulando il tempo che un umano impiega per guardarlo.

Navigazione contestuale (src/browser/navigationContext.ts)
Invece di andare direttamente al profilo, il bot simula una catena di navigazione organica: feed → ricerca (con parole chiave generiche) → scroll risultati → clic sul profilo. La probabilità di usare la catena diminuisce con l’avanzare della sessione (decay), perché un umano dopo un po’ usa i bookmark.

2.3. Rotazione e Gestione Proxy
Pool proxy con fallback (src/proxyManager.ts)
I proxy possono essere caricati da lista (con tipo mobile/residenziale/unknown). Vengono ordinati per qualità e con un meccanismo di cooldown dopo errori. L’IP viene verificato prima dell’uso con ping TCP e controllo reputazione AbuseIPDB (ipReputationChecker.ts). Se tutti i proxy sono in cooldown, il bot può attingere a una API esterna per ottenere un nuovo IP, o al fallback Tor.

Proxy “sticky” per sessione (proxyManager.ts)
Per una stessa sessione (account) viene usato sempre lo stesso proxy (deterministico per settimana), evitando il “teletrasporto” geografico. Questo è fondamentale per la coerenza geolocation.

Escalation mobile
Se i proxy residenziali falliscono ripetutamente, il bot passa prioritariamente a proxy mobile, che hanno reputazione migliore su LinkedIn.

2.4. Budget e Limiti Intelligenti
Limiti giornalieri e settimanali (src/core/scheduler.ts)
I limiti sono soft (consigliato) e hard (imposti). Vengono applicati a livello di account, di lista e globali, con contatori atomici nel DB per evitare race condition.

Calcolo dinamico del budget (scheduler.ts, src/risk/riskEngine.ts)
Il budget effettivo tiene conto di:

SSI score (Social Selling Index) → più alto è, più si può inviare.

Warmup dell’account (età dei cookie).

Trust score composito (AB‑3): combina SSI, age, acceptance rate, challenge history, pending ratio.

Fase di crescita (growth model) per account nuovi: browse‑only → soft outreach → moderate growth → full budget.

Fattori orari (intensità lavorativa), giornalieri (mood factor ±20%), e strategia settimanale (es. lunedì più inviti, giovedì più messaggi).

Backpressure adattivo (src/sync/backpressure.ts)
In base agli errori nella sincronizzazione con Supabase/webhook, il livello di backpressure aumenta, riducendo il batch size. Questo previene il sovraccarico e le cascate di fallimenti.

2.5. Gestione degli Errori e Circuit Breaker
Circuit breaker per proxy e integrazioni (src/core/integrationPolicy.ts)
Se un proxy o un’API esterna fallisce consecutivamente per una certa soglia, il circuito si apre e le richieste vengono bloccate per un tempo crescente. Questo evita di martellare servizi down o proxy morti.

Dead Letter Queue (src/workers/deadLetterWorker.ts)
I job che falliscono troppe volte vengono messi in una coda di “lettere morte”, con possibilità di riciclo dopo un delay. Questo impedisce che errori transitori blocchino il flusso.

Recovery dei job stuck (src/index.ts, src/core/repositories/jobs.ts)
All’avvio, il bot cerca job in stato RUNNING da troppo tempo e li riporta a QUEUED, evitando che rimangano bloccati per sempre.

2.6. Evasione del Rilevamento di Pagina
Stealth script universale (src/browser/stealthScripts.ts)
Iniettato in ogni pagina, questo script:

Uccide WebRTC (impedisce leak IP).

Rimuove navigator.webdriver.

Crea mock di navigator.plugins (PluginArray con plugin reali come PDF Viewer, Native Client).

Imposta languages e language coerenti.

Simula window.chrome (se non è Firefox).

Mocka Notification.permission e permissions.query.

Aggiunge resistenza a headless (dimensioni finestra, connection mock).

Nasconde artefatti CDP (__playwright, __pw_manual, ecc.) e modifica Error.prepareStackTrace per rimuovere tracce di automazione.

Shadow DOM penetration (src/browser/uiFallback.ts)
Alcuni elementi di LinkedIn sono dentro shadow DOM. Il bot ha una funzione findInShadowDom che cerca ricorsivamente.

Fallback visivo (Vision AI) (src/browser/uiFallback.ts, src/salesnav/visionNavigator.ts)
Quando i selettori CSS falliscono, il bot usa un modello di visione (Ollama LLaVA o GPT‑5.4) per individuare l’elemento sullo screenshot e cliccarlo via coordinate. Questo layer “Z” è l’ultima risorsa.

2.7. Gestione delle Sessioni LinkedIn
Monitoraggio età cookie (src/browser/sessionCookieMonitor.ts)
Viene tracciato il timestamp dell’ultimo login verificato. Se il cookie ha più di SESSION_COOKIE_MAX_AGE_DAYS, il bot si ferma e richiede una nuova autenticazione.

Rotazione cookie
Se rileva che il cookie li_at è cambiato senza una rotazione esplicita (possibile invalidamento server‑side), il bot logga un warning e aggiorna il meta.

Probe pre‑sessione (src/browser/auth.ts)
Prima di iniziare i job, il bot esegue una probe (pagina feed) per verificare che la sessione sia valida, che non ci siano challenge, e che i tempi di risposta non siano eccessivi. In caso di 429 o challenge, si ferma immediatamente.

2.8. Attività Diversive e Decoy
Azioni decoy casuali (humanBehavior.ts, src/workers/randomActivityWorker.ts)
Tra un job e l’altro, o in determinati punti del ciclo, il bot visita pagine come feed, notifiche, network, o esegue ricerche casuali. Questo spezza il pattern “solo azioni operative”.

Coffee break (jobRunner.ts)
Dopo un certo numero di job, il bot si ferma per una pausa “caffè” di durata casuale (3‑7 minuti).

Tab switch simulato (humanBehavior.ts)
Viene simulato un cambio di tab (blur/focus) per ingannare la Page Visibility API.

2.9. Gestione dei Limiti e Warning Preventivi
Pre‑flight interattivo (src/workflows/preflight.ts)
Prima di ogni workflow importante (sync, send‑invites, send‑messages), il bot mostra statistiche del DB, stato configurazione, avvisi su proxy blacklisted, budget esaurito, e un risk assessment (score 0‑100). Se il rischio è alto o ci sono errori critici, blocca l’esecuzione.

Soglie di allarme (src/core/orchestrator.ts, src/risk/riskEngine.ts)
Il risk engine monitora pending ratio, error rate, challenge count e invia alert Telegram se si superano soglie predefinite. Il predictive risk calcola una probabilità di ban (0‑100) e raccomanda azioni.

Auto‑pausa e quarantena (src/risk/incidentManager.ts)
Se si verifica un numero eccessivo di errori consecutivi, challenge, o un calo di salute compliance, il bot si mette in pausa automatica per un tempo crescente (backoff esponenziale). In casi estremi, entra in quarantena (nessuna azione fino a intervento manuale).

2.10. Persistenza e Atomicità
Transizioni di stato atomiche (src/core/leadStateService.ts)
Ogni cambio di stato di un lead è una transazione SQL con withTransaction, che garantisce che se qualcosa fallisce, tutto viene rollbackato. Questo evita stati inconsistenti.

Versioning dei lead (src/db/migrations/040_leads_version.sql)
La tabella leads ha una colonna version per supportare optimistic locking, prevenendo aggiornamenti concorrenti.

Outbox con idempotenza (src/core/repositories/system.ts)
Gli eventi (lead.transition, job.failed) vengono prima salvati in outbox_events con chiave idempotente, poi inviati a Supabase/webhook in modo asincrono con backpressure. Questo garantisce che ogni evento venga recapitato almeno una volta, anche in caso di crash.

3. Automazione delle Richieste di Connessione e Messaggi
3.1. Inviti (Connect)
Generazione nota personalizzata (src/ai/inviteNotePersonalizer.ts)
La nota può essere generata con AI (se configurata) o presa da template. L’AI estrae contesto dal profilo (about, experience) per personalizzare. C’è anche un A/B test tra varianti di prompt.

Workflow di invito (src/workers/inviteWorker.ts)

Verifica blacklist e stato lead.
Enrichment al volo (se non già arricchito) tramite API esterne/OSINT.
Navigazione contestuale al profilo.
Scroll e lettura del profilo (dwell time proporzionale alla ricchezza).
Click sul pulsante Connect (con confidence check sul testo).
Gestione del modale (con/senza nota).
Verifica post‑azione (proof‑of‑send).
Transizione a INVITED e registrazione timing (per optimizer).
3.2. Messaggi dopo connessione
Generazione messaggio (src/ai/messagePersonalizer.ts)
Simile all’invito, ma può essere un follow‑up breve o un reminder. Anche qui c’è A/B test.

Pre‑built messages (src/workers/messagePrebuildWorker.ts)
I messaggi vengono generati in batch offline (per ridurre latenza durante la sessione browser) e salvati in tabella prebuilt_messages. Il worker di messaggi li consuma, se disponibili, altrimenti genera on‑the‑fly.

Workflow di messaggio (src/workers/messageWorker.ts)
Simile all’invito, ma naviga alla inbox o al profilo, apre la conversazione, scrive il messaggio con digitazione umana e invia.

3.3. Follow‑up automatici
Worker follow‑up (src/workers/followUpWorker.ts)
Per lead in stato MESSAGED da un certo numero di giorni, invia un reminder breve. Il delay dipende dall’intento del lead (es. se aveva fatto domande, il follow‑up è più breve).

4. Integrazione con Database e Aggiornamento Automatico
Il database (SQLite/PostgreSQL) è il cuore dello stato. Ogni modifica ai lead (invito inviato, accettazione, messaggio) è una transazione che aggiorna i campi e scrive un evento nell’outbox.

Schema del database : vedi le migrazioni in src/db/migrations/. Ogni migrazione è incrementale e idempotente.

Repository pattern : tutte le query sono incapsulate in funzioni in src/core/repositories/, così la logica di business è separata dall’accesso ai dati.

Sincronizzazione cloud (opzionale) : tramite supabaseDataClient.ts e webhookSyncWorker.ts, i dati possono essere replicati su Supabase per dashboard centralizzata o analytics. La sincronizzazione usa backpressure e retry.

5. Trucchi Evasivi e Bypass Policy – Lista Completa
Riassumendo, ecco l’elenco completo dei meccanismi evasivi implementati:

Fingerprint deterministico e rotazione settimanale – stessi parametri per un’intera settimana.

JA3/TLS spoofing con CycleTLS o selezione coerentemente al browser engine.

Canvas/WebGL/audio noise deterministico per regione.

Performance.memory mock con crescita simulata.

Font enumeration mock.

navigator e chrome completamente normalizzati.

Movimenti mouse realistici (curve, micro‑tremori, missclick).

Digitazione umana con errori, correzioni e distrazioni.

Tempi di reazione log‑normali + fattori contestuali (ora, lunghezza testo, fatica).

Scroll a fasi (orientamento, lettura, skip).

Viewport dwell time (elemento visibile per almeno X ms prima del click).

Navigazione contestuale (feed → ricerca → profilo) con decay.

Proxy pool con reputazione IP, cooldown, sticky per sessione.

Escalation mobile dopo fallimenti.

Budget dinamico basato su SSI, trust score, growth model, mood factor.

Backpressure adattivo su sincronizzazioni.

Circuit breaker per proxy e API.

Dead letter queue e riciclo job.

Stealth script universale (19 patch runtime).

Fallback visivo con AI quando i selettori falliscono.

Shadow DOM penetration.

Probe pre‑sessione (verifica login, challenge, 429).

Monitoraggio età cookie e rotazione.

Azioni decoy casuali (feed, notifiche, ricerche).

Coffee break e tab switch simulato.

Pause variabili tra job (inter‑job delay con distribuzione log‑normale).

Wind‑down alla fine della sessione (torna al feed, scroll, poi chiude).

Pre‑flight check con risk assessment e blocchi preventivi.

Auto‑pausa e quarantena su burst di errori/challenge.

Alert Telegram per situazioni critiche (proxy morto, challenge, pending ratio alto).

Transazioni atomiche e versioning per consistenza dati.

Outbox con idempotenza per eventi verso cloud.

A/B test delle varianti di nota/messaggio con bandit bayesiano.

Timing optimizer basato su dati storici (slot orari migliori).

Rilevamento anomalie cookie (cambiato senza rotazione).

6. Consigli Pratici per l’Uso
Non sovrapporre sessioni: usa un solo account per browser, non aprire LinkedIn manualmente mentre il bot gira (o usa lo stesso profilo con lo stesso proxy).

Monitora i log: il bot scrive log dettagliati in logs/ e invia alert su Telegram. Impara a leggere i warning.

Rispetta i limiti: non forzare HARD_INVITE_CAP oltre i 20‑25 se l’account è giovane. Usa il growth model.

Proxy di qualità: investi in proxy residenziali o mobili; i datacenter sono troppo rischiosi.

Warmup manuale iniziale: prima di lanciare il bot, usa l’account per qualche giorno come farebbe un umano (feed, like, post).

Backup periodico: usa npm run db:backup per non perdere dati.

Segui il pre‑flight: se il pre‑flight segnala un proxy blacklisted o budget esaurito, fermati e risolvi.

## Limiti del documento

Questo file non deve contenere:

- checklist operative specifiche di campagna
- `.env` preconfezionati da copiare al volo
- rollout day-by-day o runbook contestuali a un caso singolo
- backlog o TODO generici

Quel materiale e' stato rimosso e archiviato in:

- [archive/antiban-operational-rollout-legacy.md](archive/antiban-operational-rollout-legacy.md)

Per i documenti giusti usare invece:

- [GUIDA_ANTI_BAN.md](GUIDA_ANTI_BAN.md) per le regole operative
- [GUIDA.md](GUIDA.md) per il flusso utente
- [CONFIG_EXAMPLES.md](CONFIG_EXAMPLES.md) e [CONFIG_REFERENCE.md](CONFIG_REFERENCE.md) per la configurazione
- [INTEGRATIONS.md](INTEGRATIONS.md) per webhook, sync e n8n
