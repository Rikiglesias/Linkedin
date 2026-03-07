# TODO — Codebase Perfetta (Analisi 360° — Ragionamento Preventivo)

> Analisi maniacale completa: 157 file TypeScript, 4 passaggi + arricchimento preventivo.
> Per ogni item: problema, casi limite, effetti di secondo ordine, dipendenze, fix completo.

> **PRIORITÀ TRASVERSALE:** Qualsiasi fix che riduce azioni su LinkedIn (click, inviti, messaggi)
> o aumenta la coerenza del fingerprint ha automaticamente impatto anti-ban prioritario.

---

## LEGENDA

- 🔴 **CRITICO** — bug funzionale attivo o vulnerabilità grave
- 🟠 **ALTO** — impatta correttezza, sicurezza o performance in produzione
- 🟡 **MEDIO** — inefficienza, inconsistenza, manutenibilità
- 🟢 **BASSO** — refactor, DRY, qualità codice, UX
- 🛡️ **ANTI-BAN** — impatto diretto sul rischio di ban LinkedIn

---

## 0. REGRESSIONI OPUS CLOUD — Fix immediati

> Problemi introdotti da modifiche recenti fatte con effort minimo. Hanno priorità sopra tutto
> perché sono **regressioni**: codice che prima funzionava correttamente, ora è peggiorato.
> Fixare PRIMA di qualsiasi altro lavoro nella codebase.

- [x] 🔴 **`security/redaction.ts` — REGRESSIONE: `SENSITIVE_KEYS` Set fa match esatto** — Il vecchio regex `/(token|secret|password|...)/i` matchava sottostringhe (`apiToken`, `sessionId`, `accessToken` in camelCase). Il nuovo `Set` fa match esatto lowercase: `'apitoken'` non è nel Set, quindi `apiToken` NON viene più redatto. Stesso problema per `cookieValue`, `authorizationHeader`, `secretKey` composte. **Questo è un data leak attivo nei log.** Fix: tornare a regex ma con word boundary: `/\b(token|secret|password|passwd|key|cookie|authorization|session|bearer|credential)\b/i` — matcha sia `accessToken` che `access_token` senza matchare `monkey` o `donkey`.

- [x] 🔴 **`security/redaction.ts` — REGRESSIONE: `PHONE_PATTERN` solo nordamericano** — Il nuovo pattern `/\b(\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/` matcha solo formato 3-3-4 (USA). Numeri italiani (`+39 06 1234567`, `338 1234567`), tedeschi (`+49 30 12345678`), UK (`+44 20 7946 0958`) non vengono redatti. Per un bot LinkedIn italiano è un buco critico. Fix: usare `libphonenumber-js` (già standard de facto) oppure aggiungere pattern multi-formato europeo. Il vecchio pattern era troppo aggressivo (matchava date), il nuovo è troppo restrittivo — serve un punto medio.

- [x] 🔴 **`api/server.ts` — REGRESSIONE: `/api/v1/export` senza autenticazione** — L'endpoint `/api/export` ha correttamente `apiV1AuthMiddleware` + `exportLimiter`. Ma `/api/v1/export` ha SOLO `exportLimiter` — nessun middleware auth. Dati GDPR (email, phone, consent) accessibili con solo rate limiting. Fix: aggiungere `apiV1AuthMiddleware` come primo middleware su `/api/v1/export`. Verificare anche che tutti gli altri endpoint `/api/v1/*` abbiano il middleware.

- [x] 🟠 🛡️ **`browser/stealthScripts.ts` — REGRESSIONE: `Notification.permission = 'prompt'`** — Il valore `'prompt'` è valido SOLO per `PermissionStatus.state` (Permissions API), NON per `Notification.permission` che accetta solo `'default'`, `'granted'`, `'denied'`. Un anti-bot script che verifica `Notification.permission === 'default'` rileva immediatamente il valore anomalo `'prompt'`. **Questa modifica PEGGIORA attivamente la stealth.** Fix: revertire a `'default'`. La coerenza corretta è: `Notification.permission = 'default'` ↔ `permissions.query({name:'notifications'}).state = 'prompt'` — sono API diverse con valori diversi per lo stesso stato "non ancora chiesto".

- [x] 🟠 **`browser/fingerprint/pool.ts` — FIX MANCANTE: JA3 per browser family** — La modifica di Opus Cloud ha migliorato la hash function per il canvas noise (da 12 a 10.000 valori — buono), ma il fix richiesto era diverso: `DEFAULT_JA3` è ancora identico per tutti i browser (Chrome, Firefox, Safari, Edge). Il fix JA3 per browser family non è stato implementato. L'item nella sezione 1 resta aperto — non è stato risolto, solo la hash noise è migliorata.

- [x] 🟠 **`core/jobRunner.ts` — REGRESSIONE: `as never` invalida l'exhaustive check** — Il pattern implementato `const _exhaustive: never = job.type as never` usa `as never` che forza il cast — TypeScript accetta qualsiasi tipo senza errore. Se viene aggiunto un nuovo job type senza aggiornare il runner, il compilatore NON lo segnalerà. Fix: rimuovere `as never` → `const _exhaustive: never = job.type` — ora se `job.type` può essere un valore non gestito, TypeScript dà errore al compile time. Rimuovere anche `void _exhaustive` (dead code dopo il `throw`).

---

## 1. PRIORITÀ ASSOLUTA — Bug funzionali attivi

- [ ] 🔴 **`salesnav/bulkSaveOrchestrator.ts`** — **Deduplicazione per-persona mancante**: nessuna estrazione di URL individuali per pagina → impossibile sapere chi è già nell'elenco. Fix dettagliato: vedi item `extractProfileUrlsFromPage` in sezione 5 (Architettura). **Dipende da Migration 036.**

- [x] ~~🔴 **`salesNavCommands.ts`** — **Selezione interattiva ricerca** ✅ Completato: `askUserToChooseSearch` + `readLineFromStdin` + `extractSavedSearches` integrati in `runSalesNavBulkSaveCommand` con blocco `if (!searchName)` dopo login. Non-TTY fallback su prima ricerca trovata.~~

- [x] ~~🔴 **`salesNavCommands.ts`** — **Selezione interattiva elenco** ✅ Completato: `askUserToChooseList` integrato con blocco `if (!targetListName)`. Non-TTY → throw esplicito. Supporta inserimento nome nuovo.~~

- [x] 🔴 🛡️ **`acceptanceWorker.ts`** — `isFirstDegreeBadge(null) → true`: badge DOM non caricato → lead marcato ACCEPTED senza esserlo → riceve messaggi a persone che non hanno accettato. Fix: trattare null, stringa vuota, whitespace, testo ambiguo ("1st+") come NOT_ACCEPTED. Aggiungere retry (max 3, delay 2s) prima di concludere. **Effetto secondo ordine**: se il badge non si carica mai, il lead rimane in loop → aggiungere `MAX_BADGE_RETRIES_EXCEEDED` come motivo di transizione a `BLOCKED`. **Nuovo item dipendente**: job di recovery per lead bloccati in ACCEPTED (vedi sezione 4).

- [x] 🔴 **`acceptanceWorker.ts`** — Doppia transizione `ACCEPTED → READY_MESSAGE` non atomica. `withTransaction` protegge solo da crash processo singolo — se PM2 ha 2+ worker, due processi leggono lo stesso lead contemporaneamente. Fix completo: (1) `acquireRuntimeLock('lead_transition_{id}')` PRIMA di leggere lo stato, (2) `withTransaction` per la doppia write, (3) release lock in finally. **Dipende da**: colonna `leads.version` per optimistic locking (nuovo item in sezione DB).

- [x] 🔴 **`messageWorker.ts`** — Template campagna bypassano tutta la validazione. Fix: `message_hashes` deve avere `UNIQUE(lead_id, campaign_id)` — NON includere l'hash del contenuto del template, altrimenti una modifica al template dopo l'invio invalida il check e il messaggio viene reinviato. Caso limite: campagna pausa+ripresa → decidere se il blocco rimane (sì, per default) o si resetta (opzione `allow_resend` nella config campagna).

- [x] 🔴 🛡️ **`inviteWorker.ts`** — `detectWeeklyInviteLimit` dopo il click: invito già inviato, lead non transizionato, al retry tenta di reinviare. Fix: (1) check pre-click, (2) dopo il click verificare se LinkedIn ha mostrato errore "limit reached" (CSS selector o vision AI), (3) contatore locale conservativo con buffer di 2 inviti sotto il limite reale (LinkedIn non espone il contatore preciso). **Race condition residua**: se due processi passano il check contemporaneamente, entrambi inviano. Soluzione: `acquireRuntimeLock('weekly_invite_counter')` per serializzare la fase check+click.

- [x] 🔴 **`jobRunner.ts`** — Job type non riconosciuto → `success: true` silenzioso. Fix: caso `default` dello switch deve lanciare `UnknownJobTypeError` che viene loggato come CRITICAL e marca il job FAILED. Caso limite: job type aggiunto in futuro senza aggiornare il runner → il build TypeScript deve FALLIRE se `JobPayload` union non è exhaustive (usare pattern `satisfies` o `never` nel default).

- [x] 🔴 **`orchestrator.ts`** — `dryRun: false` hardcoded nei branch `LOW_ACTIVITY` e `WARMUP`. Fix: passare `dryRun` come parametro dall'orchestratore principale a tutti i branch. Test obbligatorio: unit test che verifica che in dry-run mode nessuna funzione che fa click/send/navigate venga chiamata.

- [x] 🔴 **`crmBridge.ts`** — `pullFromHubSpot` con URL GET malformato. HubSpot v3 richiede POST su `/crm/v3/objects/contacts/search`. Fix: sostituire con POST + body JSON. Caso limite: response paginata (HubSpot ritorna max 100 per call con cursor `after`) → implementare paginazione con `while (hasMore)` loop, max 10 pagine per run per non bloccarsi.

- [x] 🔴 **`crmBridge.ts`** — Salesforce 400 trattato come successo. Fix: `res.status >= 400` → throw. Caso limite: Salesforce 401 (token scaduto) vs 400 (payload errato) richiedono azioni diverse — 401 → refresh token + retry, 400 → logga payload per debug, non ritentare.

- [x] 🔴 🛡️ **`browser/humanBehavior.ts`** — Regex `isSpaceOrPunctuation` sbagliata: `/[\\s.,!?-]/` invece di `/[\s.,!?-]/`. Gli spazi non ricevono il delay maggiore → timing digitazione piatto e rilevabile come bot. Fix: correggere la regex. **Effetto anti-ban**: il timing di digitazione è uno dei segnali più forti per i sistemi ML di detection. Con la regex corretta, ogni spazio introduce un delay variabile (40-80ms extra) che rispecchia il pattern umano di "pausa tra parole".

- [x] 🔴 🛡️ **`humanBehavior.ts`** — `VISUAL_CURSOR_ELEMENT_ID = '__linkedin_bot_visual_cursor__'`: stringa "bot" nel DOM. Qualsiasi script di detection identifica il bot con `getElementById`. Fix: generare ID con `crypto.randomBytes(8).toString('hex')` UNA volta al `launchBrowser`, non ad ogni call — altrimenti due sessioni simultanee possono avere lo stesso ID se il timing coincide. Formato finale: `__lk_${randomHex}__` (plausibile come classe LinkedIn interna).

- [x] 🔴 **`db.ts`** — `PostgresManager.run` aggiunge `RETURNING id` a ogni query: tabelle con PK composita crashano. Fix: aggiungere `options?: { returning?: boolean }` al metodo, default `false`, aggiungere `RETURNING id` solo quando esplicitamente richiesto. **Audit obbligatorio**: prima di applicare il fix, trovare tutti i caller che si aspettano `lastID` o `rows[0].id` nel risultato — devono passare `{ returning: true }`.

- [x] 🔴 **`secretRotationWorker.ts`** — `fs.writeFileSync` non atomico: se il processo viene killato a metà, `.env` è corrotto. Fix multi-step: (1) backup dell'`.env` corrente come `.env.backup.{timestamp}`, (2) scrivere su `.env.tmp`, (3) `fs.renameSync` (su Windows: `fs.copyFileSync` + `fs.unlinkSync` perché `renameSync` fallisce se il target esiste già). **Effetto secondo ordine critico**: i worker in memoria hanno ancora le credenziali vecchie → dopo la rotazione inviare segnale `SIGUSR2` ai worker (PM2 lo supporta) per ricaricare config, o schedulare riavvio graceful. Aggiungere: retention policy per backup (max 5 file `.env.backup.*`, eliminare i più vecchi).

- [x] 🔴 **`api/server.ts`** — Export endpoints senza autenticazione. Fix: aggiungere middleware auth. **Non basta**: un utente autenticato può fare dump in loop. Aggiungere: (1) rate limiting 5 export/ora per sessione, (2) audit log `who exported what at when` con IP, (3) paginazione obbligatoria (max 500 lead per chiamata), (4) alert Telegram quando viene eseguito un export (potenziale esfiltrazione dati GDPR).

- [x] 🔴 **`scripts/backupDb.ts`** — Shell injection in `pg_dump` via interpolazione diretta di `databaseUrl`. Fix: `execFileSync('pg_dump', ['--dbname', config.databaseUrl, ...], { stdio })` — nessun interpolation, argomenti come array. Caso limite: `databaseUrl` con caratteri speciali nel password (comune) → `execFileSync` li gestisce correttamente, `exec`/`execSync` con shell no.

- [x] 🔴 **`ai/openaiClient.ts`** — `resolveAiModel()` per embeddings usa modello chat. Fix: aggiungere `config.embeddingModel` separato (default: `'text-embedding-3-small'` per OpenAI, `'nomic-embed-text'` per Ollama locale). Caso limite: se l'utente configura un modello Ollama che non supporta `/embeddings`, il fallback deve essere graceful (disabilitare semantic checker, non crashare).

- [x] 🔴 **`ai/semanticChecker.ts`** — `private static memory` condivisa tra tutti i lead. Fix: istanziare `SemanticChecker` per lead (non statico) o usare `Map<leadId, MemoryItem[]>`. Caso limite: con molti lead la Map cresce indefinitamente → aggiungere `MAX_MEMORY_PER_LEAD = 10` e LRU eviction per lead quando viene superato.

- [x] 🔴 🛡️ **`fingerprint/pool.ts`** — `DEFAULT_JA3` identico per tutti i browser. Fix: mappa `{ chrome: '...', firefox: '...', safari: '...', edge: '...' }` con JA3 per browser family. **Limitazione tecnica importante**: Playwright usa sempre il TLS stack di Chromium indipendentemente dallo UA spoofato. JA3 spoofing reale richiederebbe un proxy MitM (es. mitmproxy) o patch di Node.js TLS. Aggiungere nel TODO: documentare esplicitamente quali livelli di fingerprint sono effettivamente applicati vs solo simulati (JA3 attuale = solo metadato nel fingerprint object, non applicato al TLS reale).

---

## 2. SICUREZZA

- [ ] 🟠 **`api/server.ts`** — Session cookie senza flag `Secure` se `NODE_ENV !== 'production'`. Fix: non usare `NODE_ENV` — usare `req.secure || req.headers['x-forwarded-proto'] === 'https'` con `app.set('trust proxy', 1)` per supportare reverse proxy (nginx/Caddy). **Verificare anche**: `HttpOnly: true` (previene XSS cookie theft) e `SameSite: Strict` (previene CSRF) — se uno dei due manca, il cookie è vulnerabile anche con Secure.

- [ ] 🟠 **`api/server.ts`** — IP trusted bypassano audit logging. Violazione non-ripudio e GDPR. Fix: loggare SEMPRE le operazioni sensibili, anche da IP trusted — eventualmente con livello `DEBUG` invece di `INFO`, ma il record deve esistere. **Rischio aggiuntivo**: se `X-Forwarded-For` non è validato correttamente, un attacker può spoofarlo per risultare "trusted" e bypassare l'audit.

- [ ] 🟠 **`api/server.ts`** — `apiV1AuthMiddleware` blocca utenti con session cookie. Fix: middleware che accetta sia session cookie valida (browser) sia API key/Basic Auth (client programmatico) — OR logic, non AND.

- [ ] 🟠 **`api/routes/export.ts`** — CSV formula injection. Fix: prefisso `'` (apostrofo singolo) per valori che iniziano con `=`, `+`, `-`, `@`, `\t` — Excel/LibreOffice trattano `'` come indicatore di "stringa letterale". Il prefisso `\t` suggerito in precedenza non funziona su tutti i spreadsheet. **Verificare anche**: i campi `linkedin_url` — una URL può iniziare con caratteri interpretatili come formula in editor non standard.

- [ ] 🟠 **`browser/launcher.ts`** — `ignoreHTTPSErrors: true` globale per Bright Data. Fix: creare una lista allowlist di domini proxy (`*.brightdata.com`, `*.luminati.io`) e ignorare errori HTTPS solo per quelli. **Rischio concreto**: se il proxy viene compromesso o sostituito, tutti i cookie LinkedIn vengono esposti senza alcun warning.

- [ ] 🟠 **`browser/stealthScripts.ts`** — `localStorage.setItem('li_sp', ...)`: chiave interna LinkedIn con formato proprietario. Fix: rimuovere completamente questa riga. **Ragionamento**: iniettare un valore sbagliato in una chiave proprietaria è più pericoloso di non avere la chiave — LinkedIn può usarla per rilevare manomissioni dello storage.

- [ ] 🟠 **`security/redaction.ts`** — `PHONE_PATTERN` troppo aggressivo: redacta date, versioni software, ID numerici. Fix: pattern con word boundary e contesto: `/\b(\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/`. Caso limite: numeri europei (es. `+39 02 1234567`) hanno formato diverso — usare libreria `libphonenumber-js` invece di regex custom.

- [ ] 🟠 **`security/redaction.ts`** — `SENSITIVE_KEY_PATTERN` matcha parole contenenti "key". Fix: lista esplicita di chiavi sensibili (`['apiKey', 'api_key', 'secretKey', 'secret_key', 'password', 'passwd', 'token', 'authorization', 'cookie', 'session']`) con match case-insensitive exact su nome campo. Non usare regex substring.

- [ ] 🟠 **`security/filesystem.ts`** — `chmodSafe` no-op su Windows. Fix: rilevare OS con `process.platform === 'win32'` e usare `execFileSync('icacls', [filePath, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`])`. Caso limite: `USERNAME` potrebbe contenere spazi — passare come elemento array a `execFileSync`, non interpolato.

- [ ] 🟠 **`api/routes/campaigns.ts`** — `nextExecAt` senza validazione data. Fix: `const d = new Date(nextExecAt); if (!isFinite(d.getTime())) throw new ValidationError(...)`. Aggiungere: validare anche che la data sia nel futuro (non nel passato di più di 1 ora) e non oltre 1 anno nel futuro.

- [ ] 🟠 **`cloud/supabaseDataClient.ts`** — Fallback counter non atomico su Supabase. Fix: usare Supabase RPC con funzione PostgreSQL `UPDATE counters SET value = value + 1 WHERE key = $1 RETURNING value` — atomico lato DB. Caso limite: se la RPC non esiste, fallback a `select → increment → update` wrappato in retry con jitter (50% dei casi di race condition si risolvono al secondo tentativo).

---

## 3. ANTI-DETECTION — Stealth e Fingerprinting

> Questa sezione ha impatto diretto sul ban rate. Priorità effettiva più alta di quanto
> l'etichetta 🟠/🟡 suggerisca — un ban LinkedIn blocca l'intera operazione.

- [ ] 🟠 🛡️ **`browser/stealth.ts`** — `pickMobileFingerprint` non filtra per `isMobile`. Fix: filtrare il pool per `fp.isMobile === true` prima della selezione. **Problema più profondo**: fingerprint e launchOptions devono essere co-validati in un unico punto. **Nuovo item dipendente**: funzione `validateFingerprintConsistency(fingerprint, launchOptions)` (vedi item nuovo sotto) che verifica UA ↔ isMobile ↔ viewport dimensions ↔ touch events. Senza questa funzione, future modifiche possono introdurre inconsistenze silenziose.

- [ ] 🟠 🛡️ **`browser/stealth.ts`** — Cloud fingerprint ID randomico: canvas noise diverso ad ogni sessione per lo stesso account. Fix: seed determinisitco per account — `sha256(accountId + fingerprintVersion)` truncato a 8 hex chars come ID. Stesso account → stesso canvas noise → coerenza tra sessioni → meno segnali di "profilo cambiato".

- [ ] 🟠 🛡️ **`browser/organicContent.ts`** — Hover reactions rotto: `humanDelay` attende ma non sposta il mouse. Il popover CSS richiede `page.hover()` fisico. Fix: `await page.locator(reactionButtonSelector).hover()` → wait 800-1200ms → click sulla reaction specifica. **Impatto anti-ban**: le reactions "like generico" sono meno naturali di reactions specifiche su contenuti specifici. Un bot che fa sempre like generico su ogni post è identificabile per pattern.

- [ ] 🟠 🛡️ **`browser/launcher.ts`** — WebGL vendor con trailing space: `'Google Inc. (Intel )'`. Fix: rimuovere lo spazio. **Perché conta**: i sistemi di detection raccolgono una distribuzione di valori WebGL osservati da milioni di browser reali. Un valore non presente nella distribuzione (come con lo spazio) → segnale di fingerprint manipolato → elevata probabilità di review manuale.

- [ ] 🟠 🛡️ **`browser/stealthScripts.ts`** — `hardwareConcurrency = 8` fisso al 100%. Fix: campionare dal fingerprint attivo. **Problema sistemico**: non è solo `hardwareConcurrency` — `deviceMemory`, `screen.colorDepth`, `maxTouchPoints`, `screen.width/height`, `window.devicePixelRatio` devono TUTTI essere coerenti con il fingerprint scelto e con i valori tipici di quel device. **Nuovo item dipendente**: audit completo di tutti i valori `navigator.*` e `screen.*` iniettati per verificare coerenza con fingerprint.

- [ ] 🟠 🛡️ **`browser/stealthScripts.ts`** — `Notification.permission: 'default'` vs `permissions.query: 'prompt'`: valori sempre sincronizzati in Chrome reale. Fix: allinearli — se usi 'default' in uno, usa 'default' nell'altro. **Principio generale**: LinkedIn e i sistemi anti-bot moderni fanno cross-check tra decine di API browser. Ogni discrepanza tra due API che dovrebbero essere sincronizzate è un segnale di manomissione.

- [ ] 🟠 🛡️ **`browser/auth.ts`** — URL authentication check incompleto. Mancano: `/uas/login`, `/authwall/redirect`, `/signup`, `/reauthentication`, `/sessionPasswordChallenge`, `/checkpoint/challenge`. **Effetto**: il bot naviga su queste pagine senza riconoscerle come "non loggato" → tenta azioni → LinkedIn vede azioni su pagine di login → segnale anomalo. Caso limite: aggiungere anche pattern regex per variazioni di URL con query params (`?session_redirect=...`).

- [ ] 🟡 🛡️ **`ml/mouseGenerator.ts`** — Bézier quadratica invece di cubica. Fix: due control point. **Non basta**: i sistemi moderni (Kasada, PerimeterX) analizzano velocità (prima derivata), accelerazione (seconda), e jerk (terza). Le curve Bézier hanno accelerazione matematicamente liscia. Fix completo: (1) Bézier cubica per la traiettoria base, (2) sovrapporre micro-tremori ±1-3px a frequenza 8-12Hz (simulazione EMG del polso), (3) variazione di velocità non lineare con breve "esitazione" prima del click finale (gli umani rallentano prima di cliccare su target precisi — Fitts's Law).

- [ ] 🟡 🛡️ **`ml/mouseGenerator.ts`** — Noise armonico a frequenza singola. Fix: somma di 3-4 ottave con ampiezze decrescenti (Perlin fractal noise). Frequenze: 0.01, 0.03, 0.07, 0.15 → sommate con pesi 1.0, 0.5, 0.25, 0.125. **Perché**: l'analisi FFT di movimenti reali del mouse mostra energia distribuita su più frequenze, non un singolo picco armonico.

- [ ] 🟡 🛡️ **`browser/humanBehavior.ts`** — Passi mouse fissi (15-24) indipendenti dalla distanza. Fix: `steps = Math.max(15, Math.round(distancePixels / 20))`. Per Fitts's Law: target più piccoli richiedono più passi nella fase finale (approaching phase). Aggiungere: se il target è `width < 20px`, raddoppiare i passi negli ultimi 20% del percorso.

- [ ] 🟡 🛡️ **`browser/humanBehavior.ts`** — Solo 7 termini di ricerca decoy. Fix: pool di almeno 100 termini, variati per settore. Caso limite: se il pool è statico nel codice, LinkedIn potrebbe osservare che i decoy search di TUTTI i bot con questa codebase usano gli stessi 7 termini — fingerprinting del software stesso. Soluzione: pool configurabile via `.env` o DB, con termini correlati al settore target dell'account.

- [ ] 🟡 🛡️ **`browser/humanBehavior.ts`** — `simulateTabSwitch` con timing pulito. Fix: aggiungere micro-delay variabili (5-30ms) tra `visibilitychange` event e `document.hasFocus()` — il sistema operativo introduce questi delay naturalmente. Il timestamp degli eventi deve avere jitter ±10ms.

- [ ] 🟡 🛡️ **`browser/fingerprint/pool.ts`** — Solo 12 valori canvas noise. Fix: generare noise dinamicamente da un seed, con 50+ configurazioni. Un sistema che confronta canvas fingerprint di 1000 sessioni deve trovare una distribuzione ampia, non 12 valori che rotano.

- [ ] 🟠 🛡️ **NUOVO — `browser/launcher.ts`** — Manca `validateFingerprintConsistency(fingerprint, launchOptions)`: funzione che verifica PRIMA di avviare il browser che fingerprint e opzioni siano coerenti. Check: (1) `isMobile` fingerprint ↔ `isMobile` viewport, (2) `screenWidth/Height` del fingerprint nel range plausibile per device type, (3) `maxTouchPoints > 0` ↔ `hasTouch` viewport, (4) UA browser family ↔ JA3 browser family, (5) `deviceMemory` e `hardwareConcurrency` nel range tipico per device class. Lanciare errore se incoerente — meglio un errore esplicito che un browser incoerente in produzione.

- [ ] 🟢 🛡️ **`browser/launcher.ts`** — Iniezione userAgent via template literal non escapa backtick e `${`. Fix: `JSON.stringify(userAgent)` produce una stringa sicura da usare in un contesto JS — include già le virgolette e l'escaping necessario.

- [ ] 🟢 🛡️ **`ai/typoGenerator.ts`** — Solo QWERTY US. Fix: aggiungere layout italiano con caratteri accentati. Aggiungere anche: typo per doppia lettera accidentale (`nn` invece di `n`), lettera mancante, trasposizione di due lettere adiacenti — questi sono i pattern di typo umano più comuni secondo gli studi di HCI.

---

## 4. WORKER PIPELINE — Bug nei worker

- [ ] 🟠 **`workers/inboxWorker.ts`** — Auto-reply senza hash anti-duplicato. Fix: `storeMessageHash(leadId, conversationId, messageHash)` dopo ogni invio riuscito. **Caso limite**: la stessa conversazione letta da due worker simultanei → entrambi vedono "non risposto" e rispondono. Soluzione: lock `acquireRuntimeLock('inbox_conv_{conversationId}')` prima di processare una conversazione.

- [ ] 🟠 **`workers/inboxWorker.ts`** — `clickWithFallback(page, sel, name, 5000)`: 4° argomento è `options: object`, non un numero. Fix: `clickWithFallback(page, sel, name, { timeout: 5000 })`. **Audit**: cercare tutti gli altri call di `clickWithFallback` nel codebase per verificare che nessuno passi il timeout come numero diretto.

- [ ] 🟠 **`workers/inboxWorker.ts`** — Selettori CSS hardcoded inline. Fix: centralizzare in `SELECTORS.inbox.*` con il sistema canary. **Perché è critico**: `inboxWorker` è uno dei worker più esposti a cambiamenti UI di LinkedIn — il sistema canary permette di rilevare automaticamente quando un selettore smette di funzionare.

- [ ] 🟠 **`workers/postCreatorWorker.ts`** — Post bloccato in `PUBLISHING` permanentemente se crash tra insert e updateStatus. Fix: aggiungere recovery job (nuovo item sotto). **Schema**: aggiungere `publishing_started_at DATETIME` al record post — il recovery job trova post in PUBLISHING da `> publishing_timeout_minutes` e li riporta a `FAILED` con causa `orphaned_publishing_state`.

- [ ] 🟠 🛡️ **`workers/randomActivityWorker.ts`** — Apre browser proprio invece di riusare `WorkerContext`. **Impatto anti-ban**: due sessioni browser dallo stesso IP con lo stesso account su LinkedIn contemporaneamente → segnale di comportamento anomalo. Fix: passare `WorkerContext` esistente o usare un browser condiviso con tab separati. Aggiungere: cap giornaliero sulle azioni "random" (max 5-10 sessioni/giorno), logging su telemetry.

- [ ] 🟠 **`workers/errors.ts`** — `ACCEPTANCE_PENDING` con backoff esponenziale fino a `2^39 ms`. Fix: backoff lineare fisso — polling ogni 30s per max 40 tentativi (totale 20min). Il backoff esponenziale ha senso per errori di rete, NON per polling di stato DOM.

- [ ] 🟠 **`workers/acceptanceWorker.ts`** — Nessun `attemptChallengeResolution`. Fix: aggiungere come fanno `inviteWorker`/`messageWorker`. **Aggiungere anche**: dopo `ChallengeDetectedError`, scrivere in tabella `challenge_events (worker, lead_id, url, timestamp, resolved)` — dati preziosi per capire quando e dove LinkedIn triggera challenge (nuovo item in sezione DB).

- [ ] 🟠 🛡️ **`workers/hygieneWorker.ts`** — Selettore fallback `.pvs-profile-actions button:has(svg)` troppo generico. **Impatto anti-ban**: cliccare "Follow" o "Connect" invece di "Withdraw" è un'azione involontaria su LinkedIn. Fix: vision AI come fallback invece del selettore generico — chiedere "trova il bottone Withdraw/Rimuovi invito in sospeso" e verificare visivamente prima del click.

- [ ] 🟠 **NUOVO — Job recovery per lead bloccati in ACCEPTED** — Worker periodico (ogni 30min) che trova lead in stato `ACCEPTED` da più di `config.acceptedMaxMinutes` (default: 20). Per ognuno: tenta transizione a `READY_MESSAGE`, logga l'anomalia in audit log, invia alert Telegram se il conteggio supera soglia. Previene accumulo silenzioso di lead bloccati.

- [ ] 🟠 **NUOVO — Job recovery per post bloccati in PUBLISHING** — Worker periodico che trova post in `PUBLISHING` da più di `config.publishingTimeoutMinutes` (default: 10). Li riporta a `FAILED` con causa `timeout_publishing`. Senza questo, la dashboard mostra post perennemente "in corso" che non vengono mai puliti.

- [ ] 🟡 **`workers/inviteWorker.ts`** — Dead code `else { console.log('[DRY RUN] ...') }` irraggiungibile. Rimuovere.

- [ ] 🟡 🛡️ **`workers/challengeHandler.ts`** — `isStillOnChallengePage` controlla solo URL. LinkedIn mostra challenge in overlay modale senza cambiare URL. Fix: aggiungere vision AI check come seconda verifica — `visionVerify(page, 'is there a security challenge or captcha visible on screen?')`. Il check URL rimane come fast-path, vision come fallback.

- [ ] 🟡 **`workers/context.ts`** — `getThrottleSignal` esportata ma mai usata. Rimuovere o usare. Non lasciare export fantasma che confonde chi legge il codice.

- [ ] 🟢 **`workers/deadLetterWorker.ts`** — `logInfo`/`logWarn` senza `await`. Fix: aggiungere `await`. Anche se il logger è sincrono ora, renderlo async in futuro (scrittura su DB) romperebbe silenziosamente il comportamento attuale.

- [ ] 🟢 **`workers/randomActivityWorker.ts`** — Zero logging. Fix: aggiungere `logInfo` all'inizio e alla fine di ogni sessione, `logWarn` per ogni azione fallita. Invisibilità al monitoring è equivalente a non sapere se il worker sta funzionando.

---

## 5. ARCHITETTURA — Separation of concerns, duplicazioni, pattern

- [ ] 🟠 **`services/emailEnricher.ts`** — Duplicato inferiore di `integrations/leadEnricher.ts`: nessun retry, circuit breaker, timeout. Fix: eliminare il file, aggiornare `enrichmentWorker.ts` per usare `leadEnricher.ts`. **Prima di eliminare**: verificare con `grep -r emailEnricher src/` che non ci siano altri import nascosti.

- [ ] 🟠 **`core/leadStateService.ts`** — Race condition transizione lead. Fix con **optimistic locking**: (1) aggiungere colonna `version INTEGER DEFAULT 0` alla tabella `leads` (migration necessaria), (2) `UPDATE leads SET status=?, version=version+1 WHERE id=? AND version=?`, (3) se `changes === 0` → altro processo ha già modificato → retry o errore esplicito. **Alternativa per SQLite**: `acquireRuntimeLock('lead_{id}')` serializza le transizioni — più semplice, leggermente meno scalabile.

- [ ] 🟠 **`core/leadStateService.ts`** — `reconcileLeadStatus` bypassa la macchina a stati. Fix: documentare ESPLICITAMENTE i casi legittimi di bypass con commento `// BYPASS_REASON: ...` e aggiungere audit log ogni volta che viene usato. Se non ci sono casi legittimi, rimuovere la funzione e usare solo `transitionLead`.

- [ ] 🟠 **`core/integrationPolicy.ts`** — Circuit breaker in memoria: reset a CLOSED al riavvio. Fix: persistere gli stati in DB con `circuit_breaker_states (service TEXT PK, state TEXT, failure_count INTEGER, last_failure_at DATETIME)`. Al boot: caricare gli stati dal DB — se un servizio era OPEN meno di `resetTimeout` fa, rimane OPEN fino alla scadenza.

- [ ] 🟠 **`core/integrationPolicy.ts`** — `classifyError` custom ignorato. Fix: correggere l'ordine nello spread object — custom classifier deve sovrascrivere il default, non essere sovrascritto.

- [ ] 🟠 **`core/campaignEngine.ts`** — Query SQL dirette invece di repositories. Pattern N+1 in `dispatchReadyCampaignSteps`. Fix: consolidare in `repositories/campaigns.ts`. **Rischio**: query SQL inline bypassano la validazione e il logging del layer repository.

- [ ] 🟠 **Pattern `ensure*Tables` ripetuto in 3 file** — `ensureGovernanceTables` (`system.ts`), `ensureSegmentTable` (`abBandit.ts`), `ensureAiValidationTables` (`aiQuality.ts`) eseguono `CREATE TABLE IF NOT EXISTS` a OGNI operazione. Fix unico: creare helper `lazyEnsure(key: string, initFn: () => Promise<void>)` con `Map<string, boolean>` module-level. Applicare ai 3 file. Non implementare 3 flag lazy separati — stessa logica duplicata 3 volte.

- [ ] 🟠 **`core/repositories/system.ts`** — `cleanupPrivacyData` con 4 DELETE separate senza transazione. Fix: wrappare in `withTransaction`. **Caso limite**: se un lead cambia stato tra una DELETE e l'altra, i dati sono eliminati parzialmente — violazione GDPR peggiore del non eliminarli.

- [ ] 🟠 **`core/doctor.ts`** — Restore sovrascrive DB corrotto senza backup preventivo. Fix: (1) copiare il DB corrotto come `db.corrupted.{timestamp}` prima del restore, (2) verificare integrità del backup con `PRAGMA integrity_check` prima di usarlo, (3) se il backup è corrotto → non procedere + alert Telegram + istruzioni manuali.

- [ ] 🟠 🛡️ **`accountManager.ts`** — `getAccountProfileById` usa `accounts[0]` come fallback silenzioso. **Impatto anti-ban**: inviti inviati dall'account sbagliato con IP diverso → pattern incoerente per LinkedIn. Fix: throw esplicito `AccountNotFoundError` + alert Telegram immediato "ACCOUNT NON TROVATO — operazione bloccata" con il `accountId` cercato.

- [ ] 🟠 🛡️ **`proxyManager.ts`** — Fallback Tor in fondo alla lista proxy in cooldown. Fix: ordine corretto: (1) proxy attivi ordinati per qualità (success rate, latenza), (2) Tor immediatamente dopo l'esaurimento dei proxy attivi, (3) proxy in cooldown mai ritentati nella sessione corrente. **Nuovo item dipendente**: tabella `proxy_metrics (proxy_url, success_count, fail_count, avg_latency_ms, last_used_at)` per ordinamento intelligente.

- [ ] 🟠 **NUOVO — `leads` colonna `version`** — Aggiungere migration con `ALTER TABLE leads ADD COLUMN version INTEGER NOT NULL DEFAULT 0`. Necessaria per implementare optimistic locking in `leadStateService.ts`. Aggiornare il tipo `Lead` e tutti i repository che fanno UPDATE su leads per incrementare `version`.

- [ ] 🟡 **`cli/commands/loopCommand.ts`** — `WORKFLOW_RUNNER_LOCK_KEY` come `let` a modulo mutabile. Fix: `const` immutabile o derivarlo deterministicamente dall'input.

- [ ] 🟠 **`salesnav/bulkSaveOrchestrator.ts`** — `extractProfileUrlsFromPage(page)` mancante. Per ogni card lead visibile raccogliere `{ salesnavUrl, linkedinUrl?, name, company, title, nameCompanyHash }`. Strategia: (1) DOM primary: anchors `linkedin.com/sales/lead/` per salesnavUrl, testo strutturato della card per name/company/title; (2) Vision AI fallback se DOM non espone i testi (profili privati). Scrittura in `salesnav_list_members` SOLO DOPO "Save to list" confermato — non prima, altrimenti un crash tra extract e save produce record fantasma. **Dipende da Migration 036.**

- [ ] 🟡 **`salesnav/searchExtractor.ts`** — **DEPRECATO — 3 step in ordine**: (1) estrarre `NEXT_PAGE_SELECTOR`, `SELECT_ALL_SELECTOR`, `SAVE_TO_LIST_SELECTOR` in `src/salesnav/selectors.ts` (condiviso), (2) sostituire i 2 caller rimasti con `runSalesNavBulkSave`, (3) eliminare il file. L'ordine è obbligatorio: estrarre prima di rimuovere, altrimenti si perdono i selectors.

- [ ] 🟡 **`core/scheduler.ts`** — `syncLeadListsFromLeads()` chiamata 2-3 volte. Divisione per zero se `accounts.length === 0`. Fix: guard `if (accounts.length === 0) return` + deduplica le chiamate con un set di eseguiti.

- [ ] 🟡 **`core/sessionWarmer.ts`** — `console.log` invece di `logInfo`. Fix: sostituire tutti i `console.log/warn/error` con il sistema di telemetria. Selettori CSS hardcoded: usare `SELECTORS` con canary.

- [ ] 🟡 **`scripts/rampUp.ts`** — **3 problemi nello stesso file → deprecare**: (1) `process.exit(1)` bypassa `finally { closeDatabase() }` (fix: `process.exitCode = 1` + `return`), (2) `RAMP_UP_SCHEDULE` fissa diverge da `rampUpWorker.ts`, (3) branch `if (targetDay === 'auto')` irraggiungibile. **Soluzione unica**: deprecare il file come script standalone, farlo diventare thin wrapper di `rampUpWorker.ts`. Audit: stesso `process.exit` check su tutti gli script in `src/scripts/`.

- [ ] 🟡 **`api/routes/export.ts`** — Non usa `sendApiV1` envelope. Fix: migrare a `/api/v1/export/*` con formato standard.

- [ ] 🟢 **`scripts/securityAdvisor.ts` + `rotateSecrets.ts` + `aiQualityPipeline.ts`** — `getOptionValue`/`hasFlag` duplicati. Importare da `src/cli/cliParser.ts`.

- [ ] 🟢 **`core/repositories/leadsLearning.ts`** — `parseRollbackSnapshot` duplicata in `selectors/learner.ts`. Estrarre in `core/repositories/shared.ts`.

- [ ] 🟢 **`telemetry/logger.ts`** — 3 funzioni quasi identiche. Estrarre `log(level, event, payload)` interno.

- [ ] 🟢 **`sync/webhookSyncWorker.ts`** — `parseOutboxPayload` duplicata in `supabaseSyncWorker.ts`. Estrarre in `sync/outboxUtils.ts`.

- [ ] 🟢 **`integrations/crmBridge.ts`** — `cleanLinkedinUrl(raw)` fa solo `.trim()`. Inline diretto.

- [ ] 🟢 **`.gitignore`** — `node_modules/` commentato con `#`. Fix: rimuovere `#`, eseguire `git rm -r --cached node_modules/`, poi commit. **Farlo in un commit dedicato** — il diff sarà enorme e deve essere separato da modifiche al codice.

---

## 6. AI / ML — Modelli, timing, bandit

- [ ] 🟠 🛡️ **`ai/guardian.ts`** — AI Guardian può bypassare euristiche CRITICAL. Fix con architettura a priorità: (1) CRITICAL da euristica → blocco immediato, AI non viene consultata, (2) HIGH da euristica → AI può abbassare max a MEDIUM, non a LOW/NORMAL, (3) NORMAL da euristica → AI può alzare. L'AI è un segnale integrativo, non un arbitro finale. **Aggiungere**: test unitari per ogni combinazione heuristica × AI response.

- [ ] 🟠 **`ml/timingOptimizer.ts`** — `STRFTIME('%H', invited_at)` in UTC. Fix sistemico: aggiungere colonna `invited_at_local_hour INTEGER` calcolata all'insert usando `config.targetTimezone` (es. `Europe/Rome`). L'ottimizzatore usa questa colonna. **Questo risolve il problema alla radice** invece di fare conversioni post-hoc che possono avere edge case su DST.

- [ ] 🟠 **`ml/timingOptimizer.ts`** — Attende 7 giorni se lo slot ottimale è già passato di 1 minuto. Fix: cercare il prossimo slot disponibile nella settimana (slot dello stesso tipo nei giorni successivi), non aspettare 7 giorni.

- [ ] 🟠 **`ml/timingModel.ts`** — `new Date().getHours()` in UTC. Fix: stesso approccio — usare `config.targetTimezone` per calcolare l'ora locale.

- [ ] 🟡 **`ml/abBandit.ts`** — `EPSILON = 0.15` fisso. Fix: decaying epsilon — `epsilon = max(MIN_EPSILON, INITIAL_EPSILON * decay^totalTrials)`. Configurabile via `config.abBanditEpsilonDecay`. Caso limite: se `totalTrials` viene resettato (nuovo segmento), epsilon deve tornare al valore iniziale.

- [ ] 🟡 **`ml/significance.ts`** — Test two-tailed invece di one-tailed. Fix: usare one-tailed per "è meglio del baseline?" — stessa potenza statistica con la metà dei dati.

- [ ] 🟡 **`captcha/solver.ts`** — Coordinate LLaVA non validate. Fix: clampare a viewport bounds prima del click. Se le coordinate sono fuori bounds → retry con prompt più specifico prima di usare coordinate di fallback.

- [ ] 🟡 **`captcha/solver.ts`** — Modello `llava:7b` obsoleto. Fix: aggiornare default a `llava-llama3:8b` o `moondream2`. Rendere configurabile via `VISION_MODEL` env var (già esiste ma non documentato nel README).

- [ ] 🟡 **`salesnav/visionNavigator.ts`** — `visionWaitFor` swallows errori silenziosamente. Fix: distinguere `OllamaDownError` (servizio non disponibile → throw immediato, non aspettare timeout) da `VisionParseError` (risposta malformata → retry fino a timeout). Il caller deve ricevere informazioni diverse nei due casi. **⚠️ DIPENDENZA**: questo fix sarà assorbito dal refactor GPT-5.4 (sezione 11) — implementare DOPO il refactor `VisionProvider`, non prima, altrimenti viene riscritto.

- [ ] 🟡 **`salesnav/visionNavigator.ts`** — `getVisionSolver` crea nuova istanza ad ogni call. Fix: singleton module-level con lazy init. **⚠️ DIPENDENZA**: il pattern singleton cambierà quando si aggiunge il provider GPT-5.4 (sezione 11) — il refactor `VisionProvider` include già il factory pattern che sostituisce questo singleton. Implementare DOPO il refactor.

- [ ] 🟡 **`ai/messagePersonalizer.ts`** — Fallback `'there'` in inglese. Fix: `'collega'` come in `inviteNotePersonalizer.ts`.

- [ ] 🟢 **`core/repositories/leadsLearning.ts`** — Cache `resolveLeadMetadataColumn` non differenzia errori DB temporanei da "colonna non esiste". Fix: cache solo su successo o su `SQLITE_ERROR: no such column` — non su qualsiasi errore.

---

## 7. DATABASE / INFRA — Migration, performance, atomicità

- [x] 🔴 **Migration 036 mancante** — Tabella `salesnav_list_members` con deduplicazione a 3 livelli:
  - **Livello 1 (primario):** `UNIQUE(list_name, linkedin_url)` — URL `/in/...` normalizzato. Identificatore definitivo
  - **Livello 2 (secondario):** `UNIQUE INDEX(list_name, salesnav_url) WHERE salesnav_url IS NOT NULL` — URL SalesNav `/sales/lead/...`. ID immutabile anche se l'utente cambia username
  - **Livello 3 (fuzzy, solo warning):** `name_company_hash TEXT` = `SHA1(lower(trim(name)) || '|' || lower(trim(company)))`. Indice su `(list_name, name_company_hash)`. NON UNIQUE — esistono omonimi (es. "Mario Rossi"). Usato solo per loggare warning "possibile omonimo, verificare manualmente"
  - **Schema:** `(id PK, list_name TEXT NOT NULL, linkedin_url TEXT, salesnav_url TEXT, profile_name TEXT, company TEXT, title TEXT, name_company_hash TEXT, run_id FK, search_index INTEGER, page_number INTEGER, added_at DATETIME DEFAULT NOW, source TEXT DEFAULT 'bulk_save')`
  - **Nota:** `linkedin_url` e `salesnav_url` entrambi NULLABLE — durante il bulk save si ha solo `salesnav_url`; la risoluzione a profilo standard avviene dopo con `runSalesNavResolveCommand`
  - **Edge case omonimi:** due "Mario Rossi" in aziende diverse hanno hash diverso (perché include il nome azienda). Due "Mario Rossi" nella stessa azienda hanno hash uguale → solo warning, mai blocco

- [ ] 🟠 **`db.ts`** — DDL hardcoded nel bootstrap TypeScript. Fix: migrare verso file SQL in `db/migrations/`. **Audit obbligatorio prima del fix**: verificare che le migrazioni SQL producano esattamente lo stesso schema del DDL TypeScript — usare `PRAGMA table_info(tablename)` per confrontare.

- [ ] 🟠 **`scripts/backupDb.ts`** — `fs.copyFileSync` su SQLite in WAL mode. Fix preferito: `database.backup(destPath)` di `better-sqlite3` — copia incrementale senza bloccare i writer. Fix alternativo: `VACUUM INTO 'backup.db'` — atomico ma blocca per tutta la durata (problematico su DB >500MB). **Aggiungere post-backup**: `PRAGMA integrity_check` sulla copia — se ritorna qualcosa diverso da `'ok'`, il backup è corrotto e non deve sovrascrivere quello precedente.

- [ ] 🟠 **`scripts/restoreDb.ts`** — Restore sovrascrive DB senza backup preventivo. Fix: (1) backup del DB corrente come `db.pre-restore.{timestamp}`, (2) `PRAGMA integrity_check` sul file di restore per verificarne l'integrità, (3) solo allora sovrascrivere. Se il backup da cui si sta ripristinando è corrotto → alert Telegram + blocco, non procedere.

- [ ] 🟠 **`cli/commands/adminCommands.ts`** — `runDbBackupCommand` usa `backupDatabase()` base senza audit trail. Fix: chiamare `runBackup()` da `backupDb.ts` che include checksum SHA256, retention policy, e Telegram alert.

- [ ] 🟠 **`core/repositories/leadsCore.ts`** — `promoteNewLeadsToReadyInvite` con `IN (${placeholders})`: SQLite limit 999 variabili bind. Fix: batch a max 999 item, **tutto wrapped in una singola transazione esterna** — se il processo crasha al batch 3/10, tutti i batch precedenti vengono rollback (non si vuole un set parzialmente promosso).

- [x] 🟡 **Migration 037 — `challenge_events`** — Tabella: `(id PK, worker TEXT, lead_id INTEGER FK, url TEXT, timestamp DATETIME, resolved BOOLEAN DEFAULT 0, resolution_method TEXT)`. Necessaria per il fix `acceptanceWorker` + dati analitici su dove/quando LinkedIn triggera challenge.

- [x] 🟡 **Migration 038 — `telegram_state`** — Tabella: `(key TEXT PK, value TEXT NOT NULL, updated_at DATETIME DEFAULT NOW)`. Necessaria per persistere `lastUpdateId` di Telegram e qualsiasi altro stato del bot cloud.

- [x] 🟡 **Migration 039 — `proxy_metrics`** — Tabella: `(proxy_url TEXT PK, success_count INTEGER DEFAULT 0, fail_count INTEGER DEFAULT 0, avg_latency_ms INTEGER DEFAULT 0, last_success_at DATETIME, last_fail_at DATETIME)`. Necessaria per ordinamento intelligente proxy in `proxyManager.ts`.

- [ ] 🟡 **`core/repositories/featureStore.ts`** — Insert row-by-row. Fix: bulk INSERT con `VALUES(...),(...),...` dentro la transazione esistente.

- [ ] 🟡 **`core/repositories/system.ts`** — `applyCloudAccountUpdates` con `COALESCE` su null. Documentare la semantica o usare `CASE WHEN ? IS NOT NULL THEN ? ELSE field END`.

- [ ] 🟡 **`db/migrations/035_salesnav_sync_runs.sql`** — Manca indice su `target_list_name`. Aggiungere `CREATE INDEX IF NOT EXISTS idx_sync_runs_list ON salesnav_sync_runs(account_id, target_list_name, status)`.

- [ ] 🟡 **`core/scheduler.ts`** — N+1 query su `getListDailyStat()`. Fix: query batch su tutte le liste in una sola chiamata.

- [ ] 🟡 **`scripts/aiQualityPipeline.ts`** — `sha256File` carica tutto in RAM. Fix: streaming con `fs.createReadStream` + `crypto.createHash('sha256').update(chunk)`.

- [ ] 🟢 **`scripts/rotateSecrets.ts` + `aiQualityPipeline.ts`** — Exit code 0 su failure. Fix: `process.exitCode = 1` se `status === 'FAILED'`.

- [ ] 🟢 **`package.json`** — Scripts `pre-modifiche`/`conta-problemi` non includono vitest. Fix: aggiungere `&& npm run test:vitest`. Aggiungere anche `--max-warnings 0` a `npm run lint`.

- [ ] 🟢 **`eslint.config.js`** — `project: "./tsconfig.json"` commentato. Decommentare per abilitare regole type-aware. **Priorità**: farlo solo dopo aver risolto tutti i warning esistenti, altrimenti introduce decine di nuovi errori che bloccano il workflow.

---

## 8. CLOUD / SYNC — Telegram, Supabase, CRM

- [ ] 🟠 **`cloud/telegramListener.ts`** — `await import('@supabase/supabase-js')` nel loop messaggi: crea nuova connessione per ogni comando. Fix: singleton client con lazy init al primo uso. **Caso limite WebSocket**: la connessione Supabase può cadere — aggiungere `client.channel('...').on('error', reconnect)` con backoff esponenziale.

- [ ] 🟠 **`cloud/telegramListener.ts`** — `lastUpdateId` non persistito. Fix a 3 livelli: (1) in-memory durante la sessione, (2) scritto in `telegram_state` (Migration 038) ogni 10 update, (3) al boot: caricare da DB e aggiungere offset +50 per saltare update potenzialmente già processati ma non confermati. **Edge case**: se il bot è down per ore, Telegram accumula centinaia di update — processarli tutti in sequenza al riavvio. Aggiungere: `MAX_CATCH_UP_UPDATES = 100` — oltre questo, logga "skipped N updates" e parti dall'ultimo.

- [ ] 🟠 **`cloud/cloudBridge.ts`** — `.catch(() => {})` silenzioso su tutti i bridge call. Fix: `logWarn('cloud_bridge_error', { op, error })` + contatore errori consecutivi. Se fallisce 5 volte di fila → passare a modalità offline-first con queue locale (`cloud_sync_errors` table). **Nuovo item dipendente**: Migration per `cloud_sync_errors (id PK, op TEXT, payload JSON, error TEXT, retry_count INTEGER, created_at DATETIME, next_retry_at DATETIME)`.

- [ ] 🟡 **`sync/webhookSyncWorker.ts`** — `idempotencyKey` camelCase vs `idempotency_key` snake_case in `supabaseSyncWorker.ts`. Fix: standardizzare su snake_case (più comune in PostgreSQL/Supabase).

- [ ] 🟡 **`cloud/controlPlaneSync.ts`** — `syncAccountsDown` e `syncLeadsDown` sequenziali. Fix: `Promise.all([syncAccountsDown(), syncLeadsDown()])`.

- [ ] 🟡 **`telemetry/alerts.ts`** — `parse_mode: 'Markdown'` vs `parse_mode: 'HTML'` in `broadcaster.ts`. Fix: unificare su `HTML` — più prevedibile con caratteri speciali. Aggiungere `escapeHtml()` helper per i valori dinamici inseriti nei messaggi.

- [ ] 🟡 **`telemetry/broadcaster.ts`** — `logWarn`/`logError` non awaited. Fix: aggiungere `await`.

- [ ] 🟢 **`cloud/cloudBridge.ts`** — Campo `timestamps?` contiene campi non-timestamp. Rinominare in `updates`.

- [ ] 🟢 **`integrations/crmBridge.ts`** — `pushLeadToCRM` con `.catch(() => {})` silenzioso. Fix: `logWarn` minimo con il messaggio di errore.

- [ ] 🟢 **`scripts/restoreDb.ts`** — Drill Disaster Recovery skippato per PostgreSQL. Fix: implementare `runPostgresRestoreDrill` che fa restore su DB di test, verifica integrità, poi elimina il DB di test.

---

## 9. FRONTEND — Dashboard, UX, performance

- [ ] 🟡 **`src/frontend/`** — Rendering DOM imperativo: ogni poll di 20s ricostruisce tutto. Fix preferito: usare l'infrastruttura SSE già presente — il server invia eventi solo quando lo stato cambia, zero polling dal frontend. **Caso limite del dirty-check**: se un campo cambia e torna al valore originale in <20s, il dirty-check non rileva il cambio intermedio — SSE push risolve questo.

- [ ] 🟡 **`src/frontend/apiClient.ts`** — Token in query param URL: visibile nei log server e nella history browser. Fix: POST con token nel body, o header `Authorization: Bearer ...`.

- [ ] 🟡 **`src/frontend/`** — Nessun indicatore stato connessione SSE. Fix: 3 stati visuali — `UNKNOWN` (grigio, prima del primo heartbeat), `CONNECTED` (verde), `DISCONNECTED` (rosso con pulsante "Riconnetti"). Il colore rosso deve essere visibile anche in tab non attivi (favicon colorata).

- [ ] 🟡 **`public/index.html`** — Badge "Operativo" hardcoded. Fix: stato iniziale `UNKNOWN` (grigio) — diventa verde solo al primo heartbeat ricevuto dal SSE. **Impatto UX**: un badge verde quando il bot è crashato è fuorviante — l'utente non interviene.

- [ ] 🟡 **`public/index.html`** — `aria-label` errato su tabella. Fix: correggere con il contenuto effettivo.

- [ ] 🟢 **`src/frontend/`** — Nessun grafico temporale. Aggiungere con Chart.js: linea inviti/giorno, gauge compliance health score, barchart distribuzione ora send.

- [ ] 🟢 **`src/frontend/`** — Nessun responsive design. Aggiungere viewport meta tag, breakpoint CSS, collasso tabelle in card su mobile.

- [ ] 🟢 **`src/frontend/voiceCommands.ts`** — Comandi vocali senza feedback visivo. Aggiungere: microfono animato durante ascolto, transcript parziale in tempo reale.

- [ ] 🟢 **`src/frontend/`** — `TimelineStore` si resetta ad ogni refresh. Aggiungere `localStorage` per preferenze UI (filtri attivi, colonne visibili, ordine).

---

## 10. DEAD CODE — Rimozione elementi inutili

> Item che avevano duplicati in altre sezioni sono stati unificati lì.
> `emailEnricher.ts` → sezione 5. `getThrottleSignal` → sezione 4. `cleanLinkedinUrl` → sezione 5. `rampUp.ts` → sezione 5.

- [ ] 🟡 **`plugins/exampleEngagementBooster.js`** — Rimuovere o spostare in `examples/`.

- [ ] 🟢 **`src/api/schemas.ts`** — `ListConfigUpdateSchema` mai usato. Creare la route o rimuovere.

- [ ] 🟢 **`src/types/domain.ts`** — `JobPayload` union: non fornisce type safety al dispatch runtime. Valutare se serve per documentazione o rimuovere.

- [ ] 🟢 **`src/types/domain.ts`** — Status `PENDING` legacy. Migrare lead legacy e rimuovere il tipo.

- [ ] 🟢 **`src/core/repositories/legacy.ts`** — Re-export manuale non sincronizzato. Automatizzare o eliminare.

---

## CONFIGURAZIONE — Validazioni e config mancanti

- [ ] 🟠 **`src/config/validation.ts`** — Mancano validazioni: `softInviteCap <= hardInviteCap`, `softMsgCap <= hardMsgCap`, `workingHoursStart < workingHoursEnd`, `pendingInviteMaxDays >= 1`. **Aggiungere anche**: `targetTimezone` deve essere un timezone IANA valido — validare con `Intl.DateTimeFormat` che non lanci eccezione.

- [ ] 🟠 **`src/config/domains.ts`** — `postCreationDefaultTone` con cast `as` senza whitelist. Fix: whitelist esplicita con array `const VALID_TONES = ['professional', 'casual', 'inspirational', ...]` e controllo.

- [ ] 🟠 **`src/config/domains.ts`** — `pendingInviteMaxDays` senza `Math.max(1, ...)`. Fix: clamping + test che `PENDING_INVITE_MAX_DAYS=0` non causi il problema.

- [ ] 🟡 **`src/config/index.ts`** — `as AppConfig` invece di `satisfies AppConfig`. Fix: usare `satisfies` per far sì che TypeScript rilevi campi mancanti al compile time.

- [ ] 🟡 **`src/config/env.ts`** — `isLocalAiEndpoint` non copre `0.0.0.0`, `::ffff:127.0.0.1`. Fix: regex più completa o libreria `is-localhost-ip`.

- [ ] 🟢 **`ecosystem.config.cjs`** — `kill_timeout` mancante. Aggiungere `kill_timeout: 10000` (10s per chiusura graceful SQLite).

- [ ] 🟢 **`docker-compose.yml`** — `POSTGRES_PASSWORD: changeme` hardcoded. Referenziare da `.env`.

- [ ] 🟢 **`README.md`** — "34 migrazioni" ma ne esistono 35 (e con questo piano saranno 39). Aggiornare con ogni migration aggiunta.

- [ ] 🟠 🛡️ **`.env.example` — Configurazioni GPT-5.4 mancanti** — Aggiungere: `VISION_PROVIDER=auto|openai|ollama` (default `auto`), `VISION_MODEL_OPENAI=gpt-5.4`, `VISION_BUDGET_MAX_USD=5.0`, `VISION_REDACT_SCREENSHOTS=false`. Senza queste variabili la sezione 11 (GPT-5.4) non è configurabile. **Collegamento**: `OPENAI_API_KEY` esiste già ma va documentato come necessario anche per vision (attualmente il commento dice solo "AI opzionale").

- [ ] 🟠 **`.env.example` — `EMBEDDING_MODEL` mancante** — Attualmente `AI_MODEL=llama3.1:8b` è usato sia per chat che per embeddings. OpenAI richiede modelli diversi (`text-embedding-3-small` per embeddings). Aggiungere: `EMBEDDING_MODEL=text-embedding-3-small` con commento "Usato solo per /embeddings. Con Ollama: nomic-embed-text. Con endpoint locale: lasciare vuoto per usare AI_MODEL." **Collegamento**: fix critico `ai/openaiClient.ts` in sezione 1.

- [ ] 🟠 **`.env.example` — `TARGET_TIMEZONE` mancante** — `TIMEZONE=Europe/Rome` è usato per gli orari di esecuzione del bot, ma il layer ML (`timingOptimizer`, `timingModel`) ha bisogno di sapere il timezone dei TARGET (i lead), non del server. Aggiungere: `TARGET_TIMEZONE=Europe/Rome` con commento "Timezone dei lead target per ottimizzazione orari invio. Se diverso da TIMEZONE, il modello ML usa questo valore." **Collegamento**: fix `STRFTIME` UTC in sezione 6.

- [ ] 🟠 🛡️ **`.env.example` — `PROFILE_VIEW_DAILY_CAP` mancante** — Il sistema ha cap su inviti (`HARD_INVITE_CAP=25`) e messaggi (`HARD_MSG_CAP=35`), ma nessun limite esplicito su profile views. LinkedIn limita a 80-100 views/giorno (dati 2026); superare questo range è un segnale di automazione diretto. Aggiungere: `PROFILE_VIEW_DAILY_CAP=80`. Il contatore va implementato in `jobRunner.ts` o nel worker che naviga i profili. **Anti-ban**: è l'unico limite giornaliero completamente assente nella nostra configurazione.

---

## 11. GPT-5.4 COMPUTER USE — Navigazione AI Avanzata

> GPT-5.4 (rilasciato 5 marzo 2026) ha **computer use nativo**: guarda screenshot,
> decide dove cliccare, digita, scrolla, e scrive codice Playwright direttamente.
> 82.7% su BrowseComp, 75% su OSWorld (supera performance umana al 72.4%).
>
> **Perché è una priorità anti-ban**: ogni click sbagliato su LinkedIn è un segnale anomalo.
> Passare da ~30% accuratezza (LLaVA) a ~95% (GPT-5.4) riduce drasticamente le azioni
> involontarie che triggerano i sistemi di detection. Meno errori = meno segnali = meno ban.

- [ ] 🟠 🛡️ **Architettura ibrida a 3 livelli di fallback** — (1) GPT-5.4 API come provider primario (più accurato, contesto 1M token), (2) Ollama locale come fallback se API down o rate limited, (3) CSS selectors puri come ultimo fallback se anche Ollama è giù. Il layer di astrazione in `visionNavigator.ts` è trasparente per i caller — nessun file che usa `visionClick/visionVerify/visionWaitFor` deve cambiare. **Anti-ban**: il fallback automatico evita che un'interruzione dell'API blocchi il run e forzi un riavvio (pattern "login multipli" visibile a LinkedIn).

- [ ] 🟠 🛡️ **Refactor `visionNavigator.ts` — interfaccia `VisionProvider`** — Creare interfaccia `VisionProvider` con metodi `analyzeImage(base64, prompt): Promise<string>` e `findCoordinates(base64, description): Promise<{x,y} | null>`. Due implementazioni: `OpenAIVisionProvider` (usa GPT-5.4 Responses API con tool `computer`) e `OllamaVisionProvider` (usa `VisionSolver` attuale). Factory `createVisionProvider(config)` che sceglie in base a `config.visionProvider`. **Questo refactor assorbe**: singleton `getVisionSolver` (sezione 6) e error handling `visionWaitFor` (sezione 6) — non implementarli separatamente.

- [ ] 🟠 🛡️ **Code-execution harness (Option 3 OpenAI)** — GPT-5.4 è addestrato esplicitamente per scrivere ed eseguire codice Playwright in un runtime. Invece di screenshot → coordinate → click cieco, il modello ispeziona il DOM, scrive `page.locator('...').click()` e verifica il risultato. **Anti-ban**: il modello adatta i selettori al volo se LinkedIn cambia il DOM — nessun selettore hardcoded che si rompe silenziosamente. Implementare come metodo `executeWithCodeHarness(page, task)` nell'`OpenAIVisionProvider`.

- [ ] 🟠 🛡️ **Anti-ban: rilevamento situazioni anomale** — Con 1M token di contesto, GPT-5.4 ricorda tutta la sessione (tutte le pagine visitate, tutti i click fatti). Può rilevare: banner inattesi, popup di rate limiting parziale ("You're doing this too fast"), challenge in overlay modale che non cambiano URL, pagine di errore LinkedIn mascherate da contenuto. Aggiungere prompt di sistema: "Prima di ogni azione, verifica che la pagina sia in uno stato valido. Se rilevi segnali di rate limiting, challenge, o comportamento anomalo, interrompi e riporta."

- [ ] 🟠 🛡️ **Anti-ban: challenge/captcha resolution** — GPT-5.4 è enormemente superiore a LLaVA per risolvere captcha visivi e challenge interattivi. Più challenge risolti al primo tentativo = meno sessioni interrotte = meno pattern di "login multipli ripetuti" visibili a LinkedIn. Integrare in `attemptChallengeResolution` di tutti i worker come provider prioritario.

- [ ] 🟡 **Config `visionProvider` in `.env`** — Aggiungere `VISION_PROVIDER=auto|openai|ollama` (default: `auto`). Modalità `auto`: prova GPT-5.4, se fallisce scala a Ollama. Aggiungere `OPENAI_API_KEY` se non già presente (richiesto per GPT-5.4). Aggiungere `VISION_MODEL_OPENAI=gpt-5.4` e `VISION_MODEL_OLLAMA=llava-llama3:8b` per permettere override dei modelli specifici.

- [ ] 🟡 🛡️ **Anti-ban: timing e movimenti naturali via GPT-5.4** — Il modello può generare pause contestuali ("sto leggendo questo profilo" = pausa 3-8s proporzionale alla quantità di testo visibile) invece di delay randomici fissi. Questo è più naturale delle nostre funzioni `humanDelay` che usano range arbitrari. Implementare come opzione: se GPT-5.4 è attivo, delegare il timing al modello; se Ollama, usare le funzioni locali esistenti.

- [ ] 🟡 **Privacy: screenshot redaction** — Gli screenshot delle pagine Sales Navigator inviati a OpenAI contengono dati di lead visibili (nome, azienda, titolo). Valutare: (1) OpenAI non usa dati API per training (confermato nei loro terms), (2) aggiungere opzione `VISION_REDACT_SCREENSHOTS=true` che applica blur su aree sensibili prima dell'invio (aumenta latenza, riduce accuratezza), (3) documentare nel README che l'uso di GPT-5.4 invia screenshot a OpenAI.

- [ ] 🟡 **Stima costi e budget cap** — ~$0.50-1.50 per run di 50 pagine con GPT-5.4. Aggiungere `VISION_BUDGET_MAX_USD=5.0` per sessione — se il costo stimato supera il cap, scalare automaticamente a Ollama per il resto del run. Loggare il costo per run nel report `SalesNavBulkSaveReport`.

- [ ] 🟢 **Deprecare `VisionSolver` class diretta** — Dopo il refactor `VisionProvider`, la classe `VisionSolver` in `captcha/solver.ts` diventa un implementation detail di `OllamaVisionProvider`. Non deve più essere importata direttamente da `visionNavigator.ts` o da `bulkSaveOrchestrator.ts`. Aggiornare tutti gli import per usare la factory `createVisionProvider`.

---

## 12. STRUMENTI ESTERNI — Anti-ban e infrastruttura

> Strumenti, servizi e strategie esterne che riducono il rischio ban.
> Basati su ricerca aggiornata marzo 2026: LinkedIn ha ristretto 30M di account nel 2025;
> 23% degli utenti automation hanno avuto restrizioni nel 2026.
> Con protocolli corretti il tasso scende sotto il 5%.

- [ ] 🟠 🛡️ **CloakBrowser — Stealth Chromium drop-in** — Chromium compilato da sorgente con 26 patch C++ (canvas, WebGL, audio, fonts, GPU, CDP leaks). Passa 30/30 test detection: reCAPTCHA v3 score 0.9, Cloudflare Turnstile, FingerprintJS, BrowserScan. **Perché serve**: i nostri stealth scripts JS (`stealthScripts.ts`) vengono iniettati dopo il lancio del browser — i sistemi anti-bot moderni possono rilevare l'iniezione stessa. CloakBrowser modifica il fingerprint a livello binario — impossibile da rilevare via JS. **Integrazione**: `npm install cloakbrowser`, flag `CLOAKBROWSER_ENABLED=true` in `.env`, modifica `launcher.ts` per `import { launch } from 'cloakbrowser'` quando attivo. Stessa API Playwright — il resto del codice non cambia. **Gratuito, open-source.** Con CloakBrowser attivo, molti item della sezione 3 (Anti-Detection) diventano meno urgenti perché gestiti a livello binario.

- [ ] 🟡 🛡️ **CloakBrowser — coesistenza con stealth scripts** — Se CloakBrowser è attivo, disabilitare gli stealth scripts JS che toccano le stesse API già patchate nel binario (canvas noise, WebGL vendor, hardwareConcurrency, Navigator.plugins). Doppia manipolazione sulla stessa API può creare inconsistenze rilevabili. Aggiungere flag `STEALTH_SCRIPTS_SKIP_IF_CLOAK=['canvas','webgl','hwconcurrency','plugins']` per controllare quali script saltare.

- [ ] 🟡 🛡️ **Warm-up aggiornato con dati 2026** — Trigger ban per categoria (dati aggregati 2026): messaggi identici 34%, timing innaturale 28%, volume eccessivo 19%, IP condivisi tra account 12%, spike di profile views 7%. **Azioni concrete**: (1) verificare che `SemanticChecker` sia attivo su TUTTI i percorsi messaggio (il bug template campagna in sezione 1 bypassa la validazione — è il 34% dei ban), (2) aggiungere `WARMUP_TWO_SESSIONS_PER_DAY=true` che splitta il budget giornaliero in 2 finestre (es. 9-11 + 14-16) invece di una sessione lunga — LinkedIn preferisce pattern a 2 sessioni brevi, (3) il fix regex `isSpaceOrPunctuation` (sezione 1) e il fix Bézier cubica (sezione 3) sono priorità 1 perché impattano direttamente il 28%.

- [ ] 🟢 **Proxy providers alternativi — nota README** — Documentare nel README: (1) IPRoyal ($3/GB pay-as-you-go, nessun abbonamento — buono per volumi bassi e test), (2) Oxylabs (100M IP, pool più grande di Bright Data — meno chance di IP già flaggati da LinkedIn), (3) SOAX (geo-targeting preciso città/ISP — utile per target regionali italiani). Il sistema supporta già qualsiasi proxy HTTP/SOCKS5 via `PROXY_URL` — non serve codice, solo documentazione.

- [ ] 🟢 🛡️ **Verifica limiti correnti vs dati 2026** — I nostri limiti default sono conservativi (bene): `HARD_INVITE_CAP=25` vs safe range 30-80, `WEEKLY_INVITE_LIMIT=80` vs safe 80-100, `HARD_MSG_CAP=35` vs safe 80-150. **Unico gap**: manca `PROFILE_VIEW_DAILY_CAP` (vedi sezione Configurazione). Aggiungere nota nel `.env.example` che documenta i safe range 2026 come commento accanto a ogni limite per aiutare l'utente a calibrare.

---

## RIEPILOGO STATISTICO

| Priorità | Count |
|---|---|
| 🔴 Critico | 23 |
| 🟠 Alto | 59 |
| 🟡 Medio | 36 |
| 🟢 Basso | 25 |
| **Totale** | **143** |

> +6 regressioni Opus Cloud (sezione 0) rispetto alla versione precedente (137).

**File da eliminare:** `src/services/emailEnricher.ts`
**File da deprecare:** `src/salesnav/searchExtractor.ts`, `plugins/exampleEngagementBooster.js`
**Tutto il resto del codice è necessario e attivo.**

---

## FLUSSO SALESNAV — Stato implementazione

| Step | Stato | Note |
|---|---|---|
| Apri LinkedIn + login se necessario | ✅ Implementato | `waitForManualLinkedInLogin` in `salesNavCommands.ts` |
| Apri Sales Navigator ricerche salvate | ✅ Implementato | `navigateToSavedSearches` → `SEARCHES_URL` |
| Lista ricerche disponibili | ✅ Implementato | `extractSavedSearches` (ora esportata da `bulkSaveOrchestrator.ts`) |
| Scelta interattiva della ricerca | ✅ Implementato | `askUserToChooseSearch` + `if (!searchName)` in `runSalesNavBulkSaveCommand` |
| Click "Visualizza" sulla ricerca scelta | ✅ Implementato | `clickSavedSearchView` con AI vision fallback |
| AI capisce dove cliccare (Ollama) | ✅ Implementato | `visionClick`, `visionVerify`, `visionWaitFor` in `visionNavigator.ts` |
| AI capisce dove cliccare (GPT-5.4) | ❌ Mancante | Refactor `VisionProvider` + `OpenAIVisionProvider` + code-execution harness (sezione 11) |
| Lettura totale risultati (cap pagine reali) | ✅ Implementato | `visionReadTotalResults` → `searchMaxPages` in `bulkSaveOrchestrator.ts` |
| Skip pagine dove tutti i lead sono già salvati | ✅ Implementato | `visionPageAllAlreadySaved` → skip con `SKIPPED_ALL_SAVED` status |
| Lista elenchi disponibili | ✅ Implementato | `listSalesNavLists()` + `askUserToChooseList` integrato in `runSalesNavBulkSaveCommand` |
| Scelta interattiva dell'elenco target | ✅ Implementato | `if (!targetListName)` chiama `askUserToChooseList()` dopo login |
| Controlla DB quali persone già aggiunte | ❌ Mancante | Migration 036 `salesnav_list_members` non ancora creata |
| Deduplicazione per-persona | ❌ Mancante | 3 livelli: URL profilo, URL SalesNav, hash nome+azienda (omonimi = warning non blocco) |
| Tutte le pagine della ricerca | ✅ Implementato | Loop paginazione con `clickNextPage` |
| Clicca "Seleziona tutto" ogni pagina | ✅ Implementato | `clickSelectAll` con AI fallback |
| Aggiunge all'elenco desiderato | ✅ Implementato | `openSaveToListDialog` + `chooseTargetList` |
| Aggiorna DB con progresso | ✅ Implementato | `salesnav_sync_runs` + `salesnav_sync_items` (migration 035) |
| Aggiorna DB con profili aggiunti | ❌ Mancante | Richiede Migration 036 + `extractProfileUrlsFromPage` |
| Resume dopo interruzione | ✅ Implementato | `--resume` flag + `getResumableSyncRun` |
| Challenge detection | ✅ Implementato | `ensureNoChallenge` + `ChallengeDetectedError` |
| Anti-detection noise | ✅ Implementato | `runAntiDetectionNoise` ogni 5 pagine |
