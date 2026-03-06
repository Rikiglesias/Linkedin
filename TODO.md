# TODO — Codebase Perfetta (Analisi 360° — 4 Passaggi, 157 file)

> Generato dall'analisi maniacale completa dell'intera codebase.
> Ogni item è tracciabile, prioritizzato e riferito al file esatto.

---

## LEGENDA PRIORITÀ

- 🔴 **CRITICO** — bug funzionale attivo o vulnerabilità di sicurezza grave
- 🟠 **ALTO** — impatta correttezza, sicurezza o performance in produzione
- 🟡 **MEDIO** — inefficienza, inconsistenza architettuale, manutenibilità
- 🟢 **BASSO** — refactor, DRY, qualità codice, UX

---

## 1. PRIORITÀ ASSOLUTA — Bug funzionali attivi

- [ ] 🔴 **`acceptanceWorker.ts`** — `isFirstDegreeBadge(null) → true`: se il badge DOM non si carica, il lead viene marcato ACCEPTED senza esserlo → riceve messaggi indesiderati
- [ ] 🔴 **`acceptanceWorker.ts`** — Doppia transizione `ACCEPTED → READY_MESSAGE` non atomica: se il processo crasha tra le due chiamate il lead resta bloccato in ACCEPTED per sempre. Fix: wrappare entrambe in `withTransaction`
- [ ] 🔴 **`messageWorker.ts`** — Messaggi da template campagna bypassano TUTTA la validazione (anti-duplicato, lunghezza, contenuto). Un template può inviare messaggi identici N volte alla stessa persona
- [ ] 🔴 **`inviteWorker.ts`** — `detectWeeklyInviteLimit` avviene DOPO il click "Send": l'invito è già inviato su LinkedIn ma il lead non viene transizionato a `INVITED`. Al retry (7 giorni dopo) tenta di reinviare
- [ ] 🔴 **`jobRunner.ts`** — Job con type non riconosciuto: `executionResult` rimane `workerResult(0)` con `success: true`. Job di tipi futuri vengono marcati SUCCEEDED silenziosamente
- [ ] 🔴 **`orchestrator.ts`** — `dryRun: false` hardcoded nel branch `LOW_ACTIVITY` e `WARMUP`: in dry-run mode vengono eseguite azioni reali su LinkedIn
- [ ] 🔴 **`crmBridge.ts`** — `pullFromHubSpot` non recupera mai nulla: URL GET con JSON nel query param malformato. HubSpot v3 richiede POST su `/crm/v3/objects/contacts/search`
- [ ] 🔴 **`crmBridge.ts`** — Salesforce 400 (Bad Request) trattato come successo (errore copia-incolla dal pattern HubSpot 409). Errori di formato Salesforce spariscono silenziosamente
- [ ] 🔴 **`browser/humanBehavior.ts`** — Regex `isSpaceOrPunctuation` sbagliata: `/[\\s.,!?-]/` usa `\\s` (backslash + s letterale), NON whitespace. Gli spazi non ricevono il delay maggiore → timing di digitazione piatto e rilevabile
- [ ] 🔴 **`humanBehavior.ts`** — `VISUAL_CURSOR_ELEMENT_ID = '__linkedin_bot_visual_cursor__'`: stringa "bot" nel DOM. Qualsiasi script di detection che faccia `getElementById('__linkedin_bot_visual_cursor__')` identifica il bot istantaneamente. Fix: ID randomico generato a runtime
- [ ] 🔴 **`db.ts`** — `PostgresManager.run` aggiunge `RETURNING id` a OGNI query: tabelle con PK composita o nome diverso da `id` (es. `list_daily_stats`) crashano su PostgreSQL
- [ ] 🔴 **`secretRotationWorker.ts`** — `fs.writeFileSync(envFilePath, ...)` non atomico: se il processo viene killato a metà scrittura, il file `.env` è corrotto → perdita di tutte le credenziali. Fix: scrivere su `.env.tmp` poi `fs.renameSync`
- [ ] 🔴 **`api/server.ts`** — Gli endpoint `/api/export/leads` e `/api/export/posts` non hanno middleware di autenticazione. Dati GDPR (email, phone, consent_basis, gdpr_opt_out) accessibili senza sessione
- [ ] 🔴 **`scripts/backupDb.ts`** — Shell injection in `pg_dump`: `config.databaseUrl` interpolato nella stringa shell. Una URL con `;` o `&` inietta comandi arbitrari. Fix: `execFileSync` con array argomenti
- [ ] 🔴 **`scripts/rampUp.ts`** — `process.exit(1)` dentro il blocco `try` bypassa `finally { closeDatabase() }`. Connessione SQLite lasciata aperta con WAL lock attivo
- [ ] 🔴 **`ai/openaiClient.ts`** — `resolveAiModel()` usato anche per `/embeddings`: su OpenAI i modelli chat (GPT-4o-mini) non funzionano per embeddings → richiede `text-embedding-3-small`. Fix: aggiungere `config.embeddingModel` separato
- [ ] 🔴 **`ai/semanticChecker.ts`** — `private static memory: MemoryItem[]` condivisa tra TUTTI i lead: messaggi del Lead A interferiscono con Lead B → falsi positivi "too similar" → uso ingiustificato del template fallback
- [ ] 🔴 **`fingerprint/pool.ts`** — `DEFAULT_JA3` identico per tutti i profili (Firefox, Safari, Edge, Chrome). Firefox/Safari hanno cipher-suite TLS diversi: UA Firefox + JA3 Chrome = incoerenza rilevabile da qualsiasi proxy TLS-aware

---

## 2. SICUREZZA

- [ ] 🟠 **`api/server.ts`** — Session cookie senza flag `Secure` se `NODE_ENV` non è impostato a `'production'` (scenario comune in produzione). Cookie trasmissibile su HTTP in chiaro
- [ ] 🟠 **`api/server.ts`** — IP trusted bypassano completamente l'audit logging. Operazioni sensibili (pausa, quarantena, risoluzione incidenti) da IP fidati non sono mai tracciate. Violazione del principio di non-ripudio
- [ ] 🟠 **`api/server.ts`** — `apiV1AuthMiddleware` blocca utenti con session cookie valida: chi è autenticato via browser non può usare `/api/v1/*`. Bug di architettura autenticazione
- [ ] 🟠 **`api/routes/export.ts`** — CSV formula injection: valori che iniziano con `=`, `+`, `-`, `@` non sono protetti. Un lead con `first_name: "=CMD|'/C calc'!A0"` viene esportato tal quale. Fix: prefisso `\t` per caratteri pericolosi
- [ ] 🟠 **`browser/launcher.ts`** — `ignoreHTTPSErrors: true` globale per Bright Data: ignora TUTTI gli errori HTTPS, non solo quelli del proxy. Un attacker MITM può intercettare cookie LinkedIn. Fix: limitare al dominio proxy
- [ ] 🟠 **`browser/stealthScripts.ts`** — `localStorage.setItem('li_sp', 'random_state_XXXXX')`: `li_sp` è una chiave interna LinkedIn con formato proprietario. Iniettare un valore sbagliato può flaggare la sessione. Fix: non toccare questa chiave
- [ ] 🟠 **`security/redaction.ts`** — `PHONE_PATTERN` troppo aggressivo: redacta date (`2024-01-15`), versioni software (`3.1.0`), ID numerici. Fix: pattern più restrittivo con word boundary e contesto
- [ ] 🟠 **`security/redaction.ts`** — `SENSITIVE_KEY_PATTERN` matcha `monkey`, `donkey`, `idempotencyKey`: qualsiasi stringa contenente `key` viene redactata. Fix: word boundary o lista esplicita
- [ ] 🟠 **`security/filesystem.ts`** — `chmodSafe` è un no-op totale su Windows: i file di sessione (cookie LinkedIn) non ricevono mai protezione permessi. Fix: implementare con `icacls` su Windows
- [ ] 🟠 **`api/routes/campaigns.ts`** — `nextExecAt` accetta qualsiasi stringa senza validazione come data. Potenziale injection se il repository non usa query parametrizzate. Fix: `Date.parse()` + controllo `isFinite`
- [ ] 🟠 **`cloud/supabaseDataClient.ts`** — Fallback counter non atomico: read-modify-write su Supabase non è protetto da race condition. Due processi simultanei possono perdere un incremento

---

## 3. ANTI-DETECTION — Stealth e Fingerprinting

- [ ] 🟠 **`browser/stealth.ts`** — `pickMobileFingerprint` non filtra per mobile: può selezionare un profilo Desktop dal pool cloud e forzarlo a `isMobile: true`. UA Windows Desktop + viewport mobile + touch events = incoerenza rilevabile
- [ ] 🟠 **`browser/stealth.ts`** — Cloud fingerprint ID randomico (`cloud_${Date.now()}_${Math.random()}`): `FingerprintPool.generateConsistentProfile` usa l'ID come seed. Canvas noise diverso ad ogni sessione per lo stesso account — esatto contrario della "consistenza" cercata
- [ ] 🟠 **`browser/organicContent.ts`** — Hover reactions completamente rotto: `humanDelay(1000, 1500)` attende ma non sposta il mouse. Il popover CSS delle reactions richiede `page.hover()` fisico. Tutti i "like con reaction specifica" finiscono in like generico silenziosamente
- [ ] 🟠 **`browser/launcher.ts`** — WebGL vendor con trailing space: `'Google Inc. (Intel '` + `)` → `'Google Inc. (Intel )'` con spazio prima della parentesi. Valore impossibile in qualsiasi browser reale
- [ ] 🟠 **`browser/stealthScripts.ts`** — `hardwareConcurrency = 8` per il 100% delle sessioni: pattern rilevabile da qualsiasi detection che tracci distribuzioni. Fix: randomizzare da fingerprint (range 4-16, distribuzione pesata verso 8-12)
- [ ] 🟠 **`browser/stealthScripts.ts`** — `Notification.permission: 'default'` vs `permissions.query: 'prompt'`: In Chrome reale questi valori sono sempre sincronizzati. Discrepanza rilevabile da detection avanzati
- [ ] 🟠 **`browser/auth.ts`** — URL di authentication check incompleto: mancano `/uas/login`, `/authwall/redirect`, `/signup`, `/reauthentication`, `/sessionPasswordChallenge`
- [ ] 🟡 **`ml/mouseGenerator.ts`** — Bézier quadratica (1 control point) invece di cubica (2 control points): curvatura monotona, riconoscibile da sistemi come Kasada che analizzano firme matematiche delle traiettorie
- [ ] 🟡 **`ml/mouseGenerator.ts`** — Noise armonico a frequenza singola (`sin/cos` con frequenza fissa): riconoscibile da analisi FFT. Vero Perlin noise richiede somma di più ottave
- [ ] 🟡 **`browser/humanBehavior.ts`** — Passi mouse fissi (15-24) indipendenti dalla distanza: da angolo a angolo del viewport il cursore salta 80-100px per passo. Fix: `steps = Math.max(15, Math.round(distance / 20))` (Fitts's Law)
- [ ] 🟡 **`browser/humanBehavior.ts`** — Solo 7 termini di ricerca nelle decoy action: detection che traccia search terms vede sempre gli stessi 7 rotare. Fix: pool di 100+ termini, eventualmente settore-aware
- [ ] 🟡 **`browser/humanBehavior.ts`** — `simulateTabSwitch` con timing troppo pulito: evento blur + esatta pausa N secondi + visible. Mancano micro-delay tra gli eventi e jitter sui timestamp
- [ ] 🟡 **`browser/fingerprint/pool.ts`** — Canvas noise con soli 12 valori possibili per 12 fingerprint locali: un sistema che testa più volte il canvas troverà un set ristrettissimo di valori
- [ ] 🟢 **`browser/launcher.ts`** — Iniezione userAgent in script via template literal non sicura: `replace(/'/g, "\\'"`)` non escapa backslash e backtick. Un fingerprint cloud con questi caratteri rompe lo script di init
- [ ] 🟢 **`ai/typoGenerator.ts`** — Tastiera solo QWERTY US: mancano caratteri accentati italiani (`à`, `è`, `ì`, `ò`, `ù`), tasti numerici adiacenti, typo per doppia lettera e lettera mancante

---

## 4. WORKER PIPELINE — Bug nei worker

- [ ] 🟠 **`workers/inboxWorker.ts`** — Auto-reply senza hash anti-duplicato: al run successivo la stessa conversazione può ricevere lo stesso auto-reply. Fix: `storeMessageHash` dopo ogni invio
- [ ] 🟠 **`workers/inboxWorker.ts`** — `clickWithFallback(page, sel, name, 5000)`: il 4° argomento è `options: object`, non un numero. `5000` viene ignorato o causa TypeError silenzioso
- [ ] 🟠 **`workers/inboxWorker.ts`** — Tutti i selettori CSS sono hardcoded inline (`.msg-conversation-listitem`, ecc.) violando completamente il sistema centralizzato `SELECTORS` + `joinSelectors`. Se LinkedIn aggiorna il DOM, niente è tracciabile
- [ ] 🟠 **`workers/postCreatorWorker.ts`** — Se eccezione avviene dopo `insertPostRecord` ma prima di `updatePostStatus`, il record rimane in stato `PUBLISHING` permanentemente. Nessun meccanismo di cleanup per record orfani
- [ ] 🟠 **`workers/randomActivityWorker.ts`** — Apre il proprio browser invece di riusare la sessione del `WorkerContext`: overhead significativo, zero telemetry, nessun uso del sistema di log, nessun cap giornaliero
- [ ] 🟠 **`workers/errors.ts`** — `ACCEPTANCE_PENDING` con `maxAttempts: 40` e backoff esponenziale: al tentativo 40 il delay è `5000ms × 2^39 ≈ 2.7 trilioni di ms`. Fix: usare delay fisso (polling, non backoff)
- [ ] 🟠 **`workers/acceptanceWorker.ts`** — Nessun `attemptChallengeResolution`: lancia subito `ChallengeDetectedError` invece di tentare la risoluzione come fanno `inviteWorker` e `messageWorker`
- [ ] 🟠 **`workers/hygieneWorker.ts`** — Selettore fallback `.pvs-profile-actions button:has(svg)` troppo generico: può cliccare "Follow", "Connect" o qualsiasi bottone con icona invece del bottone "Pending"
- [ ] 🟡 **`workers/inviteWorker.ts`** — Dead code: `else { console.log('[DRY RUN] ...') }` in `handleInviteModal` non viene mai eseguito (la funzione ritorna prima se `dryRun=true`)
- [ ] 🟡 **`workers/challengeHandler.ts`** — `isStillOnChallengePage` controlla solo URL: LinkedIn può mostrare challenge in overlay modale senza cambiare URL → verifica sempre `false` con CAPTCHA ancora visibile
- [ ] 🟡 **`workers/context.ts`** — `getThrottleSignal` esportata ma mai usata: `jobRunner.ts` accede direttamente a `session.httpThrottler`. Rimuovere o usare davvero
- [ ] 🟢 **`workers/deadLetterWorker.ts`** — `logInfo`/`logWarn` senza `await`: log potrebbero andare persi se il logger è async e scrive su DB
- [ ] 🟢 **`workers/randomActivityWorker.ts`** — Zero chiamate a `logInfo`/`logWarn`/`logError`: completamente invisibile al sistema di monitoring

---

## 5. ARCHITETTURA — Separation of concerns, duplicazioni, pattern

- [ ] 🟠 **`services/emailEnricher.ts`** — Duplicato inferiore di `integrations/leadEnricher.ts`: nessun retry, nessun circuit breaker, nessun timeout, legge `process.env` direttamente invece del `config` module. **Eliminare e usare `leadEnricher.ts` in produzione**
- [ ] 🟠 **`core/leadStateService.ts`** — Race condition sulla transizione lead: `getLeadById()` → validazione → `setLeadStatus()` senza transazione DB. Due processi concorrenti sullo stesso lead entrambi trovano la transizione valida e uno sovrascrive l'altro
- [ ] 🟠 **`core/leadStateService.ts`** — `reconcileLeadStatus` bypassa la macchina a stati: può portare un lead da `REPLIED` a `NEW` senza passare per le transizioni valide. Nessuna documentazione che giustifichi il bypass
- [ ] 🟠 **`core/integrationPolicy.ts`** — Circuit breaker puramente in memoria: al riavvio del processo (crash, deploy) tutti i circuiti tornano a CLOSED. Un servizio esterno in OPEN riceve richieste immediatamente dopo il restart
- [ ] 🟠 **`core/integrationPolicy.ts`** — `classifyError` custom ignorato in `fetchWithRetryPolicy`: viene sovrascritto dalla riga successiva nello stesso spread. Chi passa un classificatore custom nelle options lo vede silenziosamente ignorato
- [ ] 🟠 **`core/campaignEngine.ts`** — 4+ query SQL dirette invece di usare `repositories/campaigns.ts`. Pattern N+1 in `dispatchReadyCampaignSteps`. Viola la separazione dei concern
- [ ] 🟠 **`core/repositories/system.ts`** — `ensureGovernanceTables()` chiamata ad ogni operazione di governance: 4× `CREATE TABLE IF NOT EXISTS` per ogni call. Spostare all'init DB o usare flag booleano lazy
- [ ] 🟠 **`core/repositories/system.ts`** — `cleanupPrivacyData` esegue la stessa subquery 4 volte in DELETE separate senza transazione: se un lead cambia stato tra una DELETE e l'altra, i dati sono eliminati parzialmente
- [ ] 🟠 **`core/doctor.ts`** — Restore DB sovrascrive il file corrotto senza prima salvarne una copia: se il backup è anch'esso corrotto, il DB originale (potenzialmente recuperabile) è perso per sempre
- [ ] 🟠 **`accountManager.ts`** — `getAccountProfileById` usa `accounts[0]` come fallback silenzioso se l'ID non viene trovato: può causare inviti da account sbagliato con IP diversi senza alcun warning
- [ ] 🟠 **`proxyManager.ts`** — Fallback Tor aggiunto in FONDO alla lista dei proxy in cooldown: il sistema prova prima tutti i proxy già falliti e solo alla fine usa Tor. L'ordine dovrebbe essere invertito
- [ ] 🟡 **`cli/commands/loopCommand.ts`** — `WORKFLOW_RUNNER_LOCK_KEY` come `let` a livello di modulo mutato a runtime: stato globale mutabile. In test o doppia invocazione il secondo call usa la chiave modificata
- [ ] 🟡 **`salesnav/searchExtractor.ts`** — Resume state su file JSON non atomico invece del DB (come `bulkSaveOrchestrator`). Nessun challenge detection. Deprecare o migrare a DB
- [ ] 🟡 **`salesnav/`** — `NEXT_PAGE_SELECTOR`, `SELECT_ALL_SELECTOR`, `SAVE_TO_LIST_SELECTOR` definiti identicamente in `bulkSaveOrchestrator.ts` e `searchExtractor.ts`. Estrarre in `src/salesnav/selectors.ts`
- [ ] 🟡 **`core/scheduler.ts`** — `syncLeadListsFromLeads()` chiamata 2-3 volte per esecuzione. Divisione per zero se `accounts.length === 0`. Dry-run riporta più job del reale (include `NEW` oltre a `READY_INVITE`)
- [ ] 🟡 **`core/sessionWarmer.ts`** — `console.log` ovunque invece di `logInfo`: log invisibili al sistema di telemetria. Selettori CSS LinkedIn hardcoded fragili invece di usare il sistema canary
- [ ] 🟡 **`scripts/rampUp.ts`** — Logica RAMP_UP_SCHEDULE fissa diverge da `rampUpWorker.ts` che usa la config centralizzata. Due implementazioni paralleli per la stessa funzione con comportamento diverso
- [ ] 🟡 **`api/routes/export.ts`** — Non usa `sendApiV1` envelope: i client ricevono formato diverso da tutti gli altri endpoint. Aggiungere `/api/v1/export` con formato standard
- [ ] 🟢 **`scripts/securityAdvisor.ts` + `rotateSecrets.ts` + `aiQualityPipeline.ts`** — `getOptionValue` e `hasFlag` definiti identicamente in 3 file. Già esistono in `src/cli/cliParser.ts`. Importare da lì
- [ ] 🟢 **`core/repositories/leadsLearning.ts`** — `parseRollbackSnapshot` duplicata identicamente in `selectors/learner.ts`. Estrarre in `core/repositories/shared.ts`
- [ ] 🟢 **`telemetry/logger.ts`** — 3 funzioni `logInfo`/`logWarn`/`logError` quasi identiche (1 riga diversa). Estrarre funzione interna `log(level, event, payload)` e wrappare
- [ ] 🟢 **`sync/webhookSyncWorker.ts`** — `parseOutboxPayload` duplicata identicamente in `supabaseSyncWorker.ts`. Estrarre in `sync/outboxUtils.ts`
- [ ] 🟢 **`integrations/crmBridge.ts`** — `cleanLinkedinUrl(raw)` è una funzione che fa solo `.trim()`. Dead code. Inlining diretto
- [ ] 🟢 **`.gitignore`** — `node_modules/` è commentato con `#`: il file `node_modules/.vite/vitest/.../results.json` è tracked da Git (status `M`). Fix: rimuovere `#`, poi `git rm -r --cached node_modules/`

---

## 6. AI / ML — Modelli, timing, bandit

- [ ] 🟠 **`ai/guardian.ts`** — L'AI Guardian può bypassare la heuristica CRITICAL: quando le euristiche identificano un HTTP 429, l'AI viene comunque chiamata e la sua risposta `severity: 'normal'` sovrascrive. L'AI non ha visibilità real-time sugli errori HTTP
- [ ] 🟠 **`ml/timingOptimizer.ts`** — `STRFTIME('%H', invited_at)` usa timezone del server (UTC): con bot su server UTC e target in Italia (UTC+2), l'ottimizzatore apprende l'ora sbagliata. Discrepanza sistematica di 1-2 ore
- [ ] 🟠 **`ml/timingOptimizer.ts`** — `computeDelayUntilSlot` aspetta 7 giorni se lo slot ottimale è già passato di 1 minuto: dovrebbe cercare il prossimo slot disponibile nella settimana invece di aspettare 7 giorni
- [ ] 🟠 **`ml/timingModel.ts`** — `new Date().getHours()` usa timezone del server: il fatigue multiplier serale si attiva all'ora sbagliata per target italiani su server UTC
- [ ] 🟡 **`ml/abBandit.ts`** — `EPSILON = 0.15` fisso: 150 inviti su 1000 vanno a varianti random anche con sistema maturo. Fix: epsilon configurabile e decrescente nel tempo (decaying epsilon)
- [ ] 🟡 **`ml/abBandit.ts`** — `ensureSegmentTable` chiamata ad ogni `selectVariant`, `recordSent`, `recordOutcome`: `CREATE TABLE IF NOT EXISTS` a ogni operazione. Spostare all'init DB
- [ ] 🟡 **`ml/significance.ts`** — Test two-tailed invece di one-tailed: per determinare se il candidato è MEGLIO del baseline, un one-tailed test è più potente statisticamente (rileva lo stesso effetto con meno dati)
- [ ] 🟡 **`captcha/solver.ts`** — Coordinate LLaVA non validate contro viewport: il modello può restituire coordinate negative o fuori schermo senza errore
- [ ] 🟡 **`captcha/solver.ts`** — Modello default `'llava'` = `llava:7b` (2023, obsoleto). Modelli migliori per UI grounding: `llava:34b`, `moondream2`, `llava-llama3:8b`
- [ ] 🟡 **`salesnav/visionNavigator.ts`** — `visionWaitFor` swallows tutti gli errori silenziosamente: se Ollama è down, il loop aspetta l'intero timeout. Il caller riceve `false` indistinguibile da "condizione non verificata"
- [ ] 🟡 **`salesnav/visionNavigator.ts`** — `getVisionSolver` crea nuova istanza ad ogni chiamata: singleton module-level o pattern pool
- [ ] 🟡 **`ai/messagePersonalizer.ts`** — `safeFirstName` fallback `'there'` in inglese: "Ciao there" in messaggi italiani. Fix: usare `'collega'` come in `inviteNotePersonalizer.ts`
- [ ] 🟢 **`core/repositories/leadsLearning.ts`** — Cache module-level in `resolveLeadMetadataColumn` non differenzia errori DB temporanei da "colonna non esiste": se il DB è irraggiungibile alla prima call, la cache viene settata al valore sbagliato per tutta la vita del processo

---

## 7. DATABASE / INFRA — Migration, performance, atomicità

- [ ] 🟠 **`db.ts`** — DDL di 7+ tabelle hardcoded nel bootstrap TypeScript (`ab_variant_stats_segment`, `dynamic_selectors`, `selector_failures`, `list_rampup_state`, ecc.): due fonti di verità per lo schema DB. Migrare verso SQL dedicate in `db/migrations/`
- [ ] 🟠 **`scripts/backupDb.ts`** — `fs.copyFileSync` su DB SQLite in WAL mode: può catturare uno stato intermedio. Fix: `VACUUM INTO` o API `.backup()` di `better-sqlite3`
- [ ] 🟠 **`scripts/restoreDb.ts`** — `runSqliteRestore` sovrascrive il DB di produzione senza prima fare un backup preventivo: se il backup è corrotto il DB originale è perso per sempre
- [ ] 🟠 **`cli/commands/adminCommands.ts`** — `runDbBackupCommand` usa `backupDatabase()` base senza audit trail, checksum SHA256, retention policy, Telegram alert. Dovrebbe chiamare `runBackup()` da `backupDb.ts`
- [ ] 🟠 **`core/repositories/leadsCore.ts`** — `promoteNewLeadsToReadyInvite` con `IN (${placeholders})`: SQLite limita a 999 variabili bind. Con lista grande → runtime error. Fix: batch processing a 999 max
- [ ] 🟡 **`core/repositories/featureStore.ts`** — Insert row-by-row senza bulk: migliaia di `await db.run` sequenziali per dataset grandi. Fix: bulk INSERT con `VALUES(...),(...),...` dentro la transazione già presente
- [ ] 🟡 **`core/repositories/aiQuality.ts`** — `ensureAiValidationTables` chiamata 3+ volte per ogni `runAiValidationPipeline`: triplo `CREATE TABLE IF NOT EXISTS` consecutivo
- [ ] 🟡 **`core/repositories/system.ts`** — `applyCloudAccountUpdates` con `COALESCE(?, field)`: se un campo cloud è esplicitamente `null`, viene silenziosamente ignorato e il valore locale resta invariato. Semantica non documentata
- [ ] 🟡 **`db/migrations/035_salesnav_sync_runs.sql`** — Manca indice su `target_list_name`: la query `getResumableSyncRun` filtra per `(account_id, target_list_name, status)` ma l'indice copre solo `(status, account_id)`
- [ ] 🟡 **`core/scheduler.ts`** — N+1 query: `getListDailyStat()` chiamata sequenzialmente per ogni lista. Batch con una sola query su tutte le liste
- [ ] 🟡 **`scripts/aiQualityPipeline.ts`** — `sha256File` carica l'intero file JSONL in RAM con `readFileSync`: per dataset di centinaia di MB blocca l'event loop e può causare OOM. Fix: streaming con `fs.createReadStream`
- [ ] 🟢 **`scripts/rotateSecrets.ts` + `aiQualityPipeline.ts`** — Exit code sempre 0 anche se il worker fallisce (`status: 'FAILED'`): CI/CD non può rilevare i fallimenti. Fix: `if (result.status === 'FAILED') process.exitCode = 1`
- [ ] 🟢 **`package.json`** — `pre-modifiche`, `post-modifiche`, `conta-problemi` eseguono solo typecheck + lint, NON vitest. Viola la policy "zero tolleranza test falliti". Aggiungere `&& npm run test:vitest`
- [ ] 🟢 **`package.json`** — `npm run lint` manca `--max-warnings 0`: warning passano localmente ma bloccano il CI. Inconsistenza con `ci.yml` che lo impone
- [ ] 🟢 **`eslint.config.js`** — `project: "./tsconfig.json"` è commentato: tutte le regole type-aware (`no-floating-promises`, `no-misused-promises`, `await-thenable`) sono disabilitate

---

## 8. CLOUD / SYNC — Telegram, Supabase, CRM

- [ ] 🟠 **`cloud/telegramListener.ts`** — `await import('@supabase/supabase-js')` dentro il loop messaggi: crea nuova connessione WebSocket Supabase per ogni comando Telegram ricevuto. Fix: singleton client
- [ ] 🟠 **`cloud/telegramListener.ts`** — `lastUpdateId` non persistito: al riavvio del processo Telegram reinvia tutti gli update non confermati → comandi duplicati nel DB. Fix: persistere su runtime flag DB
- [ ] 🟠 **`cloud/cloudBridge.ts`** — Tutti i bridge call con `.catch(() => {})` completamente silenzioso: in produzione è impossibile sapere quante sincronizzazioni cloud falliscono. Fix: aggiungere `logWarn` e metrica contatore
- [ ] 🟡 **`sync/webhookSyncWorker.ts`** — Payload usa `idempotencyKey` (camelCase) mentre `supabaseSyncWorker.ts` usa `idempotency_key` (snake_case): rottura del contratto tra i due worker
- [ ] 🟡 **`cloud/controlPlaneSync.ts`** — `syncAccountsDown()` e `syncLeadsDown()` sequenziali invece di `Promise.all`: latenza inutile ad ogni ciclo di sync
- [ ] 🟡 **`telemetry/alerts.ts`** — `parse_mode: 'Markdown'` mentre `broadcaster.ts` usa `HTML`: stesso bot Telegram con due parse mode diversi. Caratteri speciali Markdown non escapati causano errori
- [ ] 🟡 **`telemetry/broadcaster.ts`** — `logWarn`/`logError` non awaited: unhandled Promise. Se `no-floating-promises` venisse attivato in ESLint, questi diventerebbero errori
- [ ] 🟢 **`cloud/cloudBridge.ts`** — Il parametro `timestamps?` contiene `about`, `experience`, `invite_prompt_variant`: non sono timestamp. Rinominare in `updates` o `fields`
- [ ] 🟢 **`integrations/crmBridge.ts`** — `pushLeadToCRM` con `.catch(() => {})` completamente silenzioso: nemmeno un `console.error`. Se Salesforce/HubSpot fallisce, nessuna traccia
- [ ] 🟢 **`scripts/restoreDb.ts`** — Drill Disaster Recovery completamente skippato per ambienti PostgreSQL: se il sistema gira su Postgres, i drill di recovery non vengono mai eseguiti

---

## 9. FRONTEND — Dashboard, UX, performance

- [ ] 🟡 **`src/frontend/`** — Rendering DOM imperativo in `renderers.ts`: ogni poll di 20s ricostruisce integralmente tutte le tabelle/sezioni anche se i dati non sono cambiati. Fix: dirty-check con hash dei dati o migrazione a Preact/SolidJS con reattività fine-grained
- [ ] 🟡 **`src/frontend/apiClient.ts`** — Session bootstrap via query param URL: il token compare nei log del server, nella history del browser, negli header Referer. Fix: POST body o header dedicato
- [ ] 🟡 **`src/frontend/`** — Nessun indicatore visivo dello stato della connessione SSE (online/offline/reconnecting): l'utente non sa se la dashboard è in tempo reale o staccata
- [ ] 🟡 **`public/index.html`** — Badge "Operativo" hardcoded nell'HTML: mostrato prima che qualsiasi dato venga caricato. Se il bot non è in esecuzione, l'utente vede "Operativo" per un intervallo indefinito
- [ ] 🟡 **`public/index.html`** — `aria-label="Code review commenti AI"` su tabella che mostra suggerimenti commenti LinkedIn: etichetta sbagliata per screen reader
- [ ] 🟢 **`src/frontend/`** — Nessun grafico per dati temporali: trend inviti/accettazioni mostrati solo in tabella. Aggiungere con Chart.js: linea inviti per giorno, gauge compliance health score, barchart distribuzione ora send
- [ ] 🟢 **`src/frontend/`** — Dashboard non ha responsive design: inutilizzabile su tablet/telefono. Aggiungere viewport meta tag, breakpoint CSS, collasso tabelle in card
- [ ] 🟢 **`src/frontend/voiceCommands.ts`** — Comandi vocali senza feedback visivo: nessun indicatore di "ascolto attivo", nessun transcript visibile. Aggiungere microfono animato e transcript parziale in tempo reale
- [ ] 🟢 **`src/frontend/`** — `TimelineStore` (300 eventi max in-memory) si resetta ad ogni refresh: filtri e preferenze non persistiti. Aggiungere `localStorage` per preferenze UI

---

## 10. DEAD CODE — Rimozione elementi inutili

- [ ] 🟡 **`src/services/emailEnricher.ts`** — File intero da eliminare: versione inferiore (nessun retry, circuit breaker, timeout) di `src/integrations/leadEnricher.ts`. La versione migliore esiste ma non è usata in produzione dall'`enrichmentWorker.ts`. Sostituire l'import
- [ ] 🟡 **`plugins/exampleEngagementBooster.js`** — Plugin demo che scrive solo file marker: in produzione è rumore puro. Rimuovere o spostare in una directory `examples/`
- [ ] 🟢 **`src/api/schemas.ts`** — `ListConfigUpdateSchema`: mai importato da nessuna route. O creare il route `PUT /api/lists/:name` o rimuovere lo schema
- [ ] 🟢 **`src/workers/context.ts`** — `getThrottleSignal()`: esportata ma mai chiamata. `jobRunner.ts` accede direttamente a `session.httpThrottler`. Rimuovere o usare davvero
- [ ] 🟢 **`src/integrations/crmBridge.ts`** — `cleanLinkedinUrl(raw)`: funzione di 3 righe che fa solo `.trim()`. Inline diretto nei 2 posti dove viene chiamata
- [ ] 🟢 **`src/types/domain.ts`** — `JobPayload` union type: documentazione pura, `jobRunner.ts` usa string comparison su `job.type`. Non fornisce type safety al dispatch runtime
- [ ] 🟢 **`src/types/domain.ts`** — `PENDING` status: legacy compatibility. Migrare i lead legacy e rimuovere il tipo
- [ ] 🟢 **`src/scripts/rampUp.ts`** — Branch `if (targetDay === 'auto')`: irraggiungibile dalla CLI (`parseInt(...) || 1` produce sempre un number). Rimuovere o esporre tramite flag CLI
- [ ] 🟢 **`src/core/repositories/legacy.ts`** — Re-export manual di tipi: ogni aggiunta di tipo a `repositories.types.ts` richiede aggiornamento manuale anche qui. Nessun meccanismo che enforzi la sincronizzazione

---

## CONFIGURAZIONE — Validazioni e config mancanti

- [ ] 🟠 **`src/config/validation.ts`** — Mancano validazioni critiche: `softInviteCap <= hardInviteCap`, `softMsgCap <= hardMsgCap`, `workingHoursStart < workingHoursEnd` (orari invertiti non rilevati), `pendingInviteMaxDays >= 1`
- [ ] 🟠 **`src/config/domains.ts`** — `postCreationDefaultTone` con cast `as` senza whitelist: qualsiasi stringa viene accettata. Gli altri campi enum usano whitelist esplicita. Inconsistenza
- [ ] 🟠 **`src/config/domains.ts`** — `pendingInviteMaxDays` senza `Math.max(1, ...)`: con `PENDING_INVITE_MAX_DAYS=0` tutti gli inviti vengono considerati scaduti immediatamente
- [ ] 🟡 **`src/config/index.ts`** — `as AppConfig` invece di `satisfies AppConfig`: type assertion nasconde campi mancanti. TypeScript non rileva se un builder dimentica un campo required
- [ ] 🟡 **`src/config/env.ts`** — `isLocalAiEndpoint` non copre `0.0.0.0`, `::ffff:127.0.0.1`: endpoint locali non convenzionali richiedono API key inutilmente
- [ ] 🟢 **`ecosystem.config.cjs`** — `kill_timeout` non impostato: default PM2 (1600ms) troppo corto per chiusura graceful di SQLite con transazioni in corso. Aggiungere `kill_timeout: 10000`
- [ ] 🟢 **`docker-compose.yml`** — `POSTGRES_PASSWORD: changeme` hardcoded: pericoloso se dimenticato. Referenziare da `.env`
- [ ] 🟢 **`README.md`** — Dice "34 migrazioni" ma ne esistono 35 (migration 035 aggiunta). Inconsistenza documentazione

---

## RIEPILOGO STATISTICO

| Priorità | Count |
|---|---|
| 🔴 Critico | 18 |
| 🟠 Alto | 39 |
| 🟡 Medio | 34 |
| 🟢 Basso | 26 |
| **Totale** | **117** |

**File da eliminare:** `src/services/emailEnricher.ts`  
**File da deprecare:** `src/salesnav/searchExtractor.ts`, `plugins/exampleEngagementBooster.js`  
**Tutto il resto del codice è necessario e attivo.**
