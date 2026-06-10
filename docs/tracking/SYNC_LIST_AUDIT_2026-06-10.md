# Audit 360 — Workflow sync-list (perimetro diretto+indiretto)

> Generato 2026-06-10 da workflow multi-agente (54 agenti, 5709k token). Read-only.
> Branch refactor/adk-split, HEAD post-commit ff4cffd (fix mitigazione A applicato).

**Totale: 41 findings** (verificati o incerti) — critical 3, high 7, medium 17, low 14. Falsi positivi scartati: 4.

Legenda verdict: `confirmed` = verifica adversariale superata · `unverified` = verifica saltata (rate-limit), finding del finder non confutato.

## CRITICAL

### [D1-bug-doppio-lancio-browser] Root cause confermata: canary e workflow lanciano DUE browser separati sullo STESSO profilo persistente (account.sessionDir) → lock conflict camoufox/Firefox
- **Verdict**: unverified  
- **File**: `src/core/workflowEntryGuards.ts:44 + src/core/salesNavigatorSync.ts:652-660`  
- **Perché**: È la radice esatta del WORKFLOW_ERROR al primo run di sync-list: due processi Firefox sullo stesso profilo persistente = lock conflict noto di Firefox/camoufox. Bug operativo che blocca il workflow al primo avvio della giornata (quando il canary è scaduto), regredendo a errore ogni 4h.  
- **Fix**: Riusare la sessione del canary nel workflow (alternativa a): è la fix MIGLIORE (zero-C.10) perché elimina il 2o launch alla radice (un solo browser = zero lock conflict, zero attesa, niente PID-tracking fragile) E risparmia ~30-60s di re-launch + warmup. Il plumbing ESISTE GIÀ: `SalesNavigatorSyncOptions.existingSession` (salesNavigatorSync.ts:48) + `ownsBrowser` (riga 651) + è già usato in syncSearchService.ts:247. Va portato a sync-list facendo sì che `evaluateWorkflowEntryGuards`/`runCanaryIfNeeded` ritornino la `BrowserSession` del canary e syncListService la passi come `existingSession`. Trade-off: il canary oggi chiude sempre il browser nel finally (workflowEntryGuards.ts:163) e gira su TUTTI gli account in un for-loop (riga 43) — riusarlo richiede attenzione a (1) non chiuderlo se il workflow lo riprende, (2) gestire il caso multi-account. Se il refactoring di handoff è troppo grande per un turno → alternativa (b) già applicata (vedi finding successivo) come mitigazione, ma la radice resta il doppio-lancio.

### [D3-robustezza-runtime] Doppio browser sullo stesso profilo persistente camoufox: il canary non garantisce il rilascio di parent.lock prima del secondo launch (timeout 180s)
- **Verdict**: confirmed  
- **File**: `src/core/workflowEntryGuards.ts:44 + src/browser/launcher.ts:849-856 + src/browser/windowInputBlock.ts:94-116`  
- **Perché**: E' il bug runtime piu' grave del perimetro: al PRIMO run sync-list di una finestra (canary non in cache) il workflow si blocca 180s e fallisce. Architetturalmente si aprono DUE browser sequenziali sullo stesso user_data_dir camoufox, e la mitigazione esistente (attesa 8s best-effort, no-op senza PID) non e' una garanzia ma un palliativo a tempo: regredisce a fallimento totale quando il rilascio del lock e' piu' lento del bound o il PID e' sconosciuto. Inoltre lanciare/chiudere un secondo browser pochi secondi dopo il primo sullo stesso profilo e' anche un pattern poco umano (anti-ban).  
- **Fix**: Eliminare il doppio launch: riusare la sessione del canary passandola come `existingSession` a runSalesNavigatorListSync (l'opzione esiste gia', salesNavigatorSync.ts:48/651), oppure far ritornare a evaluateWorkflowEntryGuards la BrowserSession aperta dal canary e inoltrarla al sync. In subordine (se il riuso non e' praticabile), rendere il rilascio del lock una garanzia: bloccare il secondo launch finche' waitForBrowserProcessExit non ritorna true, e in caso di PID ignoto fare fallback su attesa del rilascio di parent.lock (poll del file nel sessionDir) invece del no-op a 8s.

### [D7-concorrenza-lifecycle] Doppio lancio browser sullo STESSO profilo persistente (canary -> workflow) senza handoff di sessione: lock parent.lock -> timeout 180s non recuperabile
- **Verdict**: unverified  
- **File**: `src/core/workflowEntryGuards.ts:44 + src/core/salesNavigatorSync.ts:652`  
- **Perché**: E' il bug reale del run 2026-06-10: al PRIMO run (canary non in cache) il profilo viene aperto e chiuso dal canary, poi runSalesNavigatorListSync prova ad aprirlo di nuovo mentre il parent.lock del profilo Firefox/camoufox potrebbe non essere ancora rilasciato -> launchPersistentContext timeout 180000ms -> l'intero sync-list fallisce. Al SECONDO run il canary e' in cache 4h (workflowEntryGuards.ts:35) quindi singolo lancio -> successo. E' anti-ban-rilevante: una run fallita a meta' lascia il profilo in stato sporco e fa ripartire la sessione in modo anomalo.  
- **Fix**: Eliminare il doppio lancio per il path UI: far ritornare al chiamante la BrowserSession del canary gia' loggata e passarla a runSalesNavigatorListSync via `existingSession` (come fa gia' sync-search), oppure disabilitare il canary quando il workflow apre comunque il proprio browser (il login-check lo fa gia' runSalesNavigatorListSync a riga 666). In subordine, il mitigante waitForBrowserProcessExit gia' presente va reso piu' robusto (vedi finding dedicato). Verifica: run sync-list a freddo (canary cache vuota) su profilo camoufox reale -> nessun Timeout 180000ms.

## HIGH

### [D1-bug-doppio-lancio-browser] camoufox-js usa il timeout Playwright di DEFAULT (180000ms) su launchPersistentContext — nessun timeout/retry configurato in launcher.ts
- **Verdict**: unverified  
- **File**: `node_modules/camoufox-js/dist/sync_api.js:24 + src/browser/launcher.ts:330-346,439-458`  
- **Perché**: Conferma la causa-immediata: il lock-conflict si manifesta come attesa di 180s (default) perché non c'è un timeout più corto né un retry. 180s di blocco = workflow morto + nessun fallback. Anche con la fix wait-for-exit, se l'attesa fallisse (PID ignoto), il workflow ricadrebbe nel timeout di 180s senza recovery.  
- **Fix**: Difesa-in-profondità (NON sostituisce la fix radice): passare un `timeout` esplicito più corto (es. 30-45s) al launch camoufox e classificare il timeout come retryable nel loop di launcher.ts (oggi solo i proxy-error sono retryable). Così, anche se il lock fosse ancora preso, fail-fast + 1 retry breve invece di 180s di blocco. Trade-off: timeout troppo corto su macchine lente potrebbe far fallire launch legittimi → tarare con margine. Da fare insieme al fix radice (riuso sessione), non al posto.

### [D3-robustezza-runtime] Silent failure: scrape che restituisce 0 lead per selettori cambiati viene riportato come success, la lista marcata synced e il checkpoint avanzato (lista saltata nei run futuri)
- **Verdict**: confirmed  
- **File**: `src/salesnav/listScraper.ts:642 + src/core/salesNavigatorSync.ts:837-843,926-937 + src/workflows/services/syncListService.ts:249`  
- **Perché**: E' un silent failure classico: un cambio di selettore SalesNav (evento ricorrente e gia' previsto da L4-LI.3) non genera alcun errore ne alert; peggio, la lista viene marcata synced e il checkpoint la esclude dai run successivi finche' non si resetta manualmente lo stato. Risultato: lead reali persi e il report dice 'tutto ok'. Viola direttamente L5-LI.4 (no silent failure) e L4.7 del progetto.  
- **Fix**: Distinguere 'lista realmente vuota' da 'scrape fallito': se waitForSelector(LEAD_ANCHOR_SELECTOR) va in timeout E body non contiene indicatori di lista-vuota noti, NON marcare synced/checkpoint e contabilizzare un errore (report.errors++ o un flag report.scrapeDegraded) che faccia scattare success=false e alert Telegram. In subordine, far ritornare a scrapeLeadsFromSalesNavList un campo `selectorHealthy: boolean` (true solo se almeno un'attesa selettore e' andata a buon fine) e usarlo nel gate di markSalesNavListSynced.

### [D7-concorrenza-lifecycle] Nessun retry su lock/timeout del profilo persistente in launchBrowser: il fallimento canary->workflow non e' recuperato (e su --no-proxy mai)
- **Verdict**: unverified  
- **File**: `src/browser/launcher.ts:721`  
- **Perché**: Il lock-contention tra due lanci ravvicinati sullo stesso profilo e' precisamente un errore TRANSIENTE (il lock si libera dopo qualche secondo), ma la classe d'errore non e' coperta: il primo run muore definitivamente invece di ritentare dopo un breve backoff. L'utente ha dovuto rilanciare a mano (run #2). Resilienza assente su un failure noto e riproducibile.  
- **Fix**: Aggiungere alla classificazione transiente i pattern di lock/timeout del profilo (es. /Timeout \d+ms|parent\.lock|ProcessSingleton|profile.*in use/i) e consentire UN retry con backoff anche quando currentProxy e' undefined (il retry sul lock non dipende dal proxy). Mantenere `retriedProxy`-style guard per evitare loop infinito. Verifica: simulare lock occupato -> 1 retry dopo backoff, non crash immediato.

### [D7-concorrenza-lifecycle] Leak window click-through (PID orfano + timer di re-apply) sul path di SUCCESSO di sync-list: disableWindowClickThrough mai chiamato
- **Verdict**: unverified  
- **File**: `src/core/salesNavigatorSync.ts:946`  
- **Perché**: windowInputBlock._reapplyTimer (windowInputBlock.ts:182) spawna un processo PowerShell `_applyClickThroughAsync(deadPid)` ogni REAPPLY_INTERVAL_MS=1000 per il PID morto per tutta la durata della fase di enrichment (puo' durare minuti) e oltre, finche' il processo node non termina. _stopReapplyTimerIfIdle (riga 189) non scatta perche' il PID non viene mai rimosso da _activePids. E' uno spreco di risorse + processi PowerShell ricorrenti + un PID stale che, se un nuovo browser riusasse lo stesso PID OS, riceverebbe click-through indesiderato. Sync-list e' l'unico path con questa asimmetria.  
- **Fix**: Nel path di successo chiamare `disableWindowClickThrough(session.browser)` PRIMA di `closeBrowser(session)` (righe 946-948), allineandosi al pattern canonico degli altri 4 call-site. In subordine, far rimuovere a closeBrowser lo stato windowInputBlock del context cosi' nessun call-site possa dimenticarlo. Verifica: dopo sync-list completo, `_activePids.size === 0` e `_reapplyTimer === null`.

### [D8-test-coverage] Nessun regression-test sul contratto session-reuse: il bug doppio-lancio browser (canary + sync) e' completamente scoperto
- **Verdict**: confirmed  
- **File**: `src/workflows/services/syncListService.ts:206 vs src/workflows/services/syncSearchService.ts:247`  
- **Perché**: E' il bug di produzione gia' osservato (timeout 180s al primo run) e non c'e' un solo test che assicuri che sync-list passi (o non passi) la sessione riusata. Anti-ban/affidabilita': un secondo launchPersistentContext sullo stesso profilo con parent.lock e' una fonte di crash ricorrente e di sessioni mezze-aperte. Senza test, la regressione (qualcuno 'sistema' un ramo e riapre il doppio launch) e' invisibile.  
- **Fix**: Aggiungere un characterization/regression test su executeSyncListWorkflow che monti spy su launchBrowser e asserisca il contratto di lifecycle del browser sul perimetro sync-list (canary + sync): contare quante volte un browser viene lanciato sullo stesso sessionDir per un singolo run, e che il sync NON apra un secondo persistent context se il preflight/canary ne ha gia' uno disponibile. Mockare runSalesNavigatorListSync per catturare l'argomento `existingSession` e asserire la simmetria col path sync-search (syncSearchService passa session, syncList no). Test minimo a zero-browser-reale: vi.fn su runSalesNavigatorListSync + assert sull'oggetto-opzioni.

### [D8-test-coverage] L'orchestratore runSalesNavigatorListSync (994 righe) non ha test: dedup cross-lista, checkpoint/resume, challenge-break, conteggi inserted/updated/unchanged tutti scoperti
- **Verdict**: unverified  
- **File**: `src/core/salesNavigatorSync.ts:595-994`  
- **Perché**: E' l'orchestratore reale del workflow (login, challenge, estrazione, dedup, DB upsert, enrichment, cloud). Il dedup cross-lista sbagliato → enrichment doppio → chiamate API doppie (costo + rate-limit). Il checkpoint corrotto non gestito → re-scraping completo → piu' navigazione = piu' superficie anti-ban. Il challenge-break che non scatta → il bot continua a scrapare DOPO un challenge = pattern che porta a restrizione account. Nessun test protegge questi invarianti su 994 righe.  
- **Fix**: Test characterization mirati (browser interamente mockato via vi.mock di '../browser', '../salesnav/listScraper', './repositories'): (1) dedup cross-lista — stesso leadId in 2 liste → postSyncEnrichment chiamato una volta per quel lead; (2) checkpoint — lista in completedListNames viene skippata (riga 787); checkpoint JSON corrotto → completedListNames vuoto, non crash; (3) challenge — detectChallenge=true + attemptChallengeResolution=false → report.challengeDetected=true e loop interrotto (break); (4) URL guard — listUrl='Nome Lista' (non http) → usato come filtro, non page.goto. Prioritizzare (1) e (3) (impatto anti-ban + costo).

### [D9-automation-api-coerenza] Doppio browser sullo stesso profilo persistente: canary (entry-guard) + sync lanciano due launchBrowser separati su account.sessionDir — sync-list NON riusa la sessione come fa sync-search
- **Verdict**: unverified  
- **File**: `src/workflows/services/syncListService.ts:187-216`  
- **Perché**: Anti-ban + affidabilità. Due sessioni browser separate sullo STESSO profilo persistente camoufox al primo run (canary cache fredda): la prima è il canary, la seconda è il sync — al cold-start la seconda launchPersistentContext va in timeout 180000ms (bug reale osservato 2026-06-10). Il path automation/loop è il PIÙ esposto perché il dispatcher forza dryRun:false (dispatcher.ts:48) → evaluateWorkflowEntryGuards NON ha lo short-circuit dryRun (workflowEntryGuards.ts:187 `if (options.dryRun) return {allowed:true}`), quindi il canary gira SEMPRE quando la cache 4h è fredda, senza l'escape `--dry-run` che il CLI ha. Inoltre 2 sessioni LinkedIn distinte per run = superficie di detection maggiore (lo stesso anti-pattern già rimosso per warmup/inbox in loopCommand.ts:704-715).  
- **Fix**: Allineare sync-list al pattern di sync-search: NON lasciare che canary e sync aprano due browser. Opzioni (zero-I, minima): (a) far sì che executeSyncListWorkflow lanci UNA sessione e la passi sia al canary (via existingSession sul canary) sia a runSalesNavigatorListSync (existingSession), come fa syncSearchService.ts:247; oppure (b) saltare il canary interno quando il sync aprirà comunque il browser e farà il proprio checkLogin (salesNavigatorSync.ts:666). Verifica: primo run a freddo (canary cache invalidata) deve aprire UN solo browser, no timeout launchPersistentContext.

## MEDIUM

### [D1-bug-doppio-lancio-browser] waitForBrowserProcessExit dipende da un PID ottenuto via diff fragile getFirefoxLikePids() e degrada a no-op silenzioso se il PID non è tracciato
- **Verdict**: confirmed  
- **File**: `src/browser/launcher.ts:399-477 + src/browser/windowInputBlock.ts:94-116`  
- **Perché**: La fix ff4cffd è interamente condizionata alla disponibilità di un PID corretto. In tutti i casi in cui il diff fallisce (Firefox utente aperto, race di spawn, processo launcher vs finestra), `waitForBrowserProcessExit` ritorna false → degrada al comportamento PRE-fix → il bug del lock può riapparire. Inoltre la fix non ha test (vedi finding successivo), quindi questa fragilità non è verificata.  
- **Fix**: Se si mantiene l'approccio wait-for-exit come difesa: rendere il rilevamento del PID più robusto — preferire `browser.process()?.pid` quando disponibile (già tentato in getBrowserPid via WeakMap+playwright, windowInputBlock.ts:66-81) e, per camoufox, validare che il PID registrato sia ancora vivo subito dopo il lancio. Ma la soluzione strutturale resta eliminare il 2o launch (riuso sessione): senza secondo launch sullo stesso profilo, il PID-tracking diventa irrilevante per questo bug.

### [D1-bug-doppio-lancio-browser] La fix del lock-conflict (waitForBrowserProcessExit) non ha alcuna copertura di test
- **Verdict**: confirmed  
- **File**: `src/tests/windowInputBlock.vitest.ts`  
- **Perché**: La fix tocca il lifecycle browser anti-ban (path critico) e si basa su una premessa fragile (PID via diff). Senza test, la regressione 'PID assente → no-op → bug riappare' è invisibile e non c'è garanzia che il poll process.kill(pid,0) si comporti come atteso su Windows (dove ESRCH/EPERM hanno semantica diversa). zero-Q: una pulizia/fix regression-safe richiede evidenza prima/dopo — qui manca.  
- **Fix**: Aggiungere un unit test mirato per `waitForBrowserProcessExit`: (1) PID di un processo finto già morto → ritorna true rapidamente; (2) PID vivo che muore dopo N poll → ritorna true entro il timeout; (3) PID ignoto (getBrowserPid → null) → ritorna false (no-op, comportamento degradato dichiarato). Mockare process.kill per simulare ESRCH/EPERM. Test leggero, isola la logica di poll senza lanciare browser reali.

### [D2-antiban-stealth] Canary e workflow lanciano DUE browser camoufox in sequenza sullo STESSO profilo persistente (doppio login ravvicinato + rischio lock/timeout)
- **Verdict**: confirmed  
- **File**: `src/core/workflowEntryGuards.ts:44 + src/core/salesNavigatorSync.ts:652`  
- **Perché**: Due aperture/chiusure browser ravvicinate sullo stesso account in pochi secondi NON e' un pattern umano (un utente non apre, chiude e riapre il browser sullo stesso profilo in 10s). Oltre al timeout tecnico, e' un doppio TLS-handshake/login signal verso LinkedIn a brevissima distanza, e ogni close+reopen rigenera la sessione. Sul primo run il timeout 180s lascia anche una finestra anomala.  
- **Fix**: Far riusare al workflow la sessione gia' aperta dal canary invece di chiuderla e riaprirla: il canary potrebbe restituire la BrowserSession (gia' previsto il path `existingSession` in SalesNavigatorSyncOptions:48 e ownsBrowser in salesNavigatorSync.ts:651). In alternativa, se il riuso non e' praticabile, garantire che closeBrowser del canary rilasci davvero il parent.lock prima del 2° launch (verificare waitForBrowserProcessExit copre il caso camoufox quando il PID non viene trovato — launcher.ts:461-476 logga camoufox_pid_not_found, e in quel caso waitForBrowserProcessExit e' no-op).

### [D2-antiban-stealth] Timezone Chromium puo' restare disallineata dal paese del proxy (geo-coerenza garantita solo su camoufox)
- **Verdict**: unverified  
- **File**: `src/browser/launcher.ts:340`  
- **Perché**: Se il deploy NON e' IT-only (proxy in altro paese) e l'engine e' chromium, timezone JS (Intl/Date) e geoip dell'IP proxy possono divergere: incoerenza tz vs IP e' un segnale classico di fingerprint spoofing per LinkedIn. Il run reale usa camoufox (coerente), ma il codice chromium resta una trappola latente per altri ambienti/engine.  
- **Fix**: Sul path chromium, derivare timezoneId dal paese del proxy (mapping IP/geo -> IANA tz) quando un proxy e' attivo, oppure forzare un check che fallisca/avvisi se fingerprint.timezone e geo del proxy divergono. Mantenere la coerenza geo non solo su camoufox.

### [D3-robustezza-runtime] Challenge rilevato a meta scraping interrompe in silenzio: dati parziali restituiti senza propagare challengeDetected ne segnalare l'interruzione
- **Verdict**: confirmed  
- **File**: `src/salesnav/listScraper.ts:660-668 + src/core/salesNavigatorSync.ts:845-863`  
- **Perché**: Un'interruzione causata da una challenge LinkedIn (segnale anti-ban di primaria importanza) puo' finire mascherata da run riuscito con scraping parziale, perdendo lead e — peggio — non alzando l'alert di challenge che dovrebbe innescare pausa/quarantena. La rilevazione e la propagazione del challenge sono disaccoppiate tra scraper (che fa break) e orchestratore (che fa il check su un altro istante temporale).  
- **Fix**: Far propagare l'interruzione dallo scraper: aggiungere al SalesNavListScrapeResult un campo `interruptedByChallenge: boolean` (settato quando si fa break a listScraper.ts:664) e nell'orchestratore, se true, settare report.challengeDetected=true ed eseguire handleChallengeDetected, invece di affidarsi al solo re-check post-scrape (riga 845) che e' time-dependent.

### [D4-dataflow-correttezza] cloudSynced over-conta: vale cloudLeads.length anche se l'upsert Supabase fallisce silenziosamente
- **Verdict**: confirmed  
- **File**: `src/core/salesNavigatorSync.ts:558-561`  
- **Perché**: Conteggio non veritiero: il report afferma una sincronizzazione cloud che potrebbe non essere avvenuta. Viola SSOT/onesta dei conteggi (zero-M): il numero mostrato non riflette lo stato reale del cloud. Mascherato anche dal fatto che gli errori cloud non toccano success (vedi finding correlato). L'utente crede che i dati siano sul Control Plane quando potrebbero essere solo nell'outbox o persi.  
- **Fix**: Far ritornare a batchUpsertCloudLeads il conteggio reale di righe upsertate (somma di `count` dalla .select('id') o length-failed-chunks), come gia fa batchUpsertCloudSalesNavMembers (supabaseDataClient.ts:284-296 usa `.select('id')` e `synced += count ?? chunk.length`). Poi `enrichReport.cloudSynced = await batchUpsertCloudLeads(...)`. Fix chirurgico, allinea il pattern gia esistente nello stesso file.

### [D4-dataflow-correttezza] success=true ignora gli errori di enrichment e di cloud sync
- **Verdict**: confirmed  
- **File**: `src/workflows/services/syncListService.ts:249`  
- **Perché**: Il report puo dichiarare 'COMPLETATO' (success=true, severity Telegram 'info') anche se l'intera cloud sync e fallita o l'enrichment ha sollevato eccezioni su tutti i lead. Un fallimento cloud totale passa inosservato. Coerenza dato/stato (zero-O) e nessun silent failure (L5-LI.4): qui il fallimento e silenziato a livello di esito.  
- **Fix**: Includere gli errori non-bloccanti nel calcolo dello stato in modo distinto: mantenere success per il sync DB locale ma aggiungere un campo/warning derivato (es. `cloudHealthy = report.enrichment.cloudErrors === 0`) e degradare la severity Telegram a 'warn' se cloudErrors>0 o enrichment.errors>0, invece di 'info'. Non flippare success a false (il sync locale e davvero riuscito), ma rendere visibile il degrado.

### [D5-architettura-srp] runSalesNavigatorListSync è una god-function (~400 righe) che mescola browser-lifecycle, login-recovery, discovery liste, scraping, upsert DB, checkpoint e orchestrazione enrichment/cloud
- **Verdict**: confirmed  
- **File**: `src/core/salesNavigatorSync.ts:595-994`  
- **Perché**: Bassa coesione: un singolo punto che cambia browser-lifecycle, persistenza, anti-ban (click-through/challenge) e business-logic di enrichment. Difficile da testare in isolamento (infatti il perimetro nota ZERO test E2E su salesNavigatorSync/listScraper). Aumenta il rischio che una modifica a una responsabilità (es. checkpoint) regredisca un'altra (es. browser cleanup nel finally). È best-practice-retroattiva (zero-P): gira, ma è fragile.  
- **Fix**: NON un big-bang. Estrazione incrementale a chunk verificati (zero-Q): (a) `discoverTargetLists(session, listFilter, interactive)` (711-762); (b) il blocco re-login → helper condiviso del finding #2; (c) `processTargetList(session, targetList, options, report)` (loop 781-938 corpo); (d) lasciare runSalesNavigatorListSync come orchestratore sottile (snapshot→browser→discover→process→enrich→close). postSyncEnrichment: estrarre le 5 fasi (cleanLead/enrichLead/scoreLead/promoteLead/cloudSync) in funzioni dedicate. Solo se si aggiunge prima copertura test sui pezzi estratti (perimetro = 0 test E2E ora).

### [D6-preflight-guards-incidenti] Canary lancia un browser PER OGNI account, poi il workflow ne lancia un ALTRO sullo stesso profilo persistente camoufox (parent.lock) — la mitigazione è solo best-effort 8s
- **Verdict**: confirmed  
- **File**: `src/core/workflowEntryGuards.ts:43-52 + src/core/salesNavigatorSync.ts:652-660`  
- **Perché**: È il BUG NOTO del run reale 2026-06-10: al primo run launchPersistentContext va in timeout 180000ms perché il parent.lock del profilo non è ancora rilasciato dal browser del canary. La mitigazione esiste ma è fragile: (1) 8s possono non bastare per la terminazione reale del processo Firefox/camoufox su Windows; (2) se la registrazione PID camoufox fallisce (>1 processo firefox-like preesistente, comune se l'utente ha Firefox aperto) waitForBrowserProcessExit ritorna immediatamente false e NON attende affatto, riproducendo il timeout. Inoltre il canary apre N browser (uno per account) ma il workflow target è UN solo account: per multi-account si pagano N lanci canary inutili sul profilo sbagliato.  
- **Fix**: Far CONDIVIDERE la sessione canary→workflow invece di chiudere e rilanciare: runSalesNavigatorListSync già supporta `options.existingSession` (salesNavigatorSync.ts:651-653 `ownsBrowser = !options.existingSession`). Passare la session del canary (per l'account target) al workflow elimina alla radice la contention sul parent.lock. In subordine: limitare il canary al solo account target (non `for` su tutti gli account) e rendere l'attesa lock-release deterministica (poll del parent.lock file del profilo, non solo del PID) con timeout adeguato prima del secondo launch.

### [D6-preflight-guards-incidenti] Quarantena è un flag GLOBALE (account_quarantine), non per-account: un incidente su un account blocca sync-list per TUTTI gli account
- **Verdict**: confirmed  
- **File**: `src/core/workflowEntryGuards.ts:208-216 + src/risk/incidentManager.ts:33-35`  
- **Perché**: Collasso di stato: in setup multi-account (config.multiAccountEnabled, accountManager.ts:128) un singolo account ristretto/challenged mette in quarantena l'intero bot, bloccando sync-list anche su account sani. È una classificazione che collassa cause/scope diversi in un solo booleano globale — esattamente il pattern che la dimensione 6 cerca. Non è critico per il deploy IT single-account corrente, ma è un problema latente (zero-P) che diventa bug operativo appena si abilita il multi-account.  
- **Fix**: Scope-are la quarantena per-account: chiave `account_quarantine:<accountId>` (coerente con il pattern già usato per `browser_session_started_at:<id>` in configInspector.ts:36 e riskAssessor.ts:41). evaluateWorkflowEntryGuards deve controllare la quarantena dell'account TARGET (options.accountId), non un flag globale. Mantenere un flag globale solo per quarantena platform-wide esplicita.

### [D7-concorrenza-lifecycle] Nessun cleanup handler 'exit' per il window click-through sul path sync-list: crash a meta' lascia il mouse utente bloccato + timer attivo
- **Verdict**: unverified  
- **File**: `src/core/salesNavigatorSync.ts:704`  
- **Perché**: Se il processo muore a meta' sync-list (uncaughtException/SIGINT/kill) dopo enableWindowClickThrough e prima del cleanup, la finestra del browser resta WS_EX_TRANSPARENT e il _reapplyTimer continua finche' node vive; soprattutto, su un crash che NON passa dal finally il mouse fisico dell'utente puo' restare bloccato e il timer orfano. sync-search si protegge con process.on('exit'); sync-list no -> incoerenza di robustezza tra due workflow gemelli.  
- **Fix**: Replicare in salesNavigatorSync il pattern di sync-search: registrare `process.on('exit', () => cleanupWindowClickThrough())` quando si attiva il click-through (solo modalita' non-interactive) e rimuoverlo nel finally; oppure, meglio (fix di classe), aggiungere disableWindowClickThrough()/cleanupWindowClickThrough() allo step 2b di performGracefulShutdown in index.ts cosi' OGNI path e' coperto. Verifica: SIGINT durante sync-list -> mouse utente sbloccato, nessun processo PowerShell residuo.

### [D7-concorrenza-lifecycle] Assenza di guard di idempotenza/anti-concorrenza: due sync-list sullo stesso account in parallelo aprono lo stesso profilo persistente -> corruzione lock/sessione
- **Verdict**: unverified  
- **File**: `src/core/salesNavigatorSync.ts:595`  
- **Perché**: Due browser camoufox sullo stesso user_data_dir = corruzione del profilo Firefox (parent.lock), cookie/localStorage race, e DUE sessioni LinkedIn simultanee dallo stesso account/IP = pattern fortemente anti-ban (login concorrenti, azioni parallele sullo stesso account violano L7-LI.4 'no parallel su stesso account'). E' la stessa classe del bug canary->workflow ma estesa a run concorrenti.  
- **Fix**: Introdurre un lock per-account (file-lock sul sessionDir o runtime flag DB tipo `sync_running:<accountId>` con TTL) verificato all'ingresso di runSalesNavigatorListSync: se gia' attivo -> blocco con reason dedicato invece di aprire un secondo browser. Allinearsi al mutex M36 gia' usato in jobRunner.ts:170 per i challenge-check concorrenti. Verifica: due sync-list paralleli stesso account -> il secondo viene rifiutato, non apre browser.

### [D8-test-coverage] executeSyncListWorkflow (cuore del service) non ha alcun test: report-to-result mapping, success/challenge e branch WORKFLOW_ERROR scoperti
- **Verdict**: confirmed  
- **File**: `src/workflows/services/syncListService.ts:124-278`  
- **Perché**: E' l'adapter che traduce l'esito reale del sync nel risultato strutturato che n8n/dashboard/Telegram consumano. Un errore qui (es. success=true nonostante un challenge, o summary con conteggi sbagliati) produce report falsi-positivi: il bot dichiara 'sync ok' mentre LinkedIn ha mostrato un challenge — esattamente lo scenario anti-ban che va segnalato, non nascosto. Il bug di mapping e' silenzioso e non lo cattura nessun test.  
- **Fix**: Test characterization su executeSyncListWorkflow con runSalesNavigatorListSync mockato per restituire report sintetici: (1) report con errors=0, challengeDetected=false, promoted=3 → success=true, nextAction contiene 'send-invites', summary.promossi_ready_invite=3; (2) report con challengeDetected=true → success=false, errors include il messaggio challenge; (3) runSalesNavigatorListSync che throwa → blocked.reason='WORKFLOW_ERROR' con il messaggio dell'errore; (4) report null → WORKFLOW_ERROR 'non ha prodotto un report'. Mockare anche evaluateWorkflowEntryGuards (allowed) e runPreflight (confirmed).

### [D8-test-coverage] Estrazione/dedup SalesNav (listScraper, bulkSaveOrchestrator monolite 1840, salesnavDedup, pagination/pageActions) senza alcun test: il punto di contatto DOM piu' fragile e' il meno coperto
- **Verdict**: confirmed  
- **File**: `src/salesnav/bulkSaveOrchestrator.ts:1, src/salesnav/listScraper.ts:1, src/salesnav/salesnavDedup.ts:234`  
- **Perché**: Sono i moduli che leggono il DOM mutevole di LinkedIn/SalesNav: i selettori cambiano spesso (e c'e' un selectorCanary proprio per questo). Un bug nel dedup (livello fuzzy che diventa blocco invece di warning, o un Set lookup case-sensitive) → o lead persi silenziosamente, o re-save dello stesso profilo = scrittura DB ridondante + pattern. Il monolite da 1840 righe senza un solo test e' debito latente: ogni modifica e' a rischio regressione cieca. checkDuplicates e' il candidato a piu' alto valore/costo perche' e' DB-pura, non serve browser.  
- **Fix**: Partire dal frutto basso DB-puro: unit test su salesnavDedup.checkDuplicates con un db mockato (3 query → Set/Map) che verifichi: match livello-1 LinkedIn URL → alreadySaved++; match livello-2 SalesNav URL; livello-3 hash → fuzzyWarnings++ ma NON conta come alreadySaved (resta in newProfiles); newProfiles = total - alreadySaved esatto. Test su computeNameCompanyHash (normalizzazione lowercase/trim/spazi). Per listScraper/bulkSave (DOM): estrarre prima le funzioni pure (parsing card → ExtractedProfile, paginazione/limiti) e testare quelle senza Playwright; il path browser-vivo resta E2E in staging. Tracciare lo split del monolite bulkSaveOrchestrator come prerequisito di testabilita'.

### [D8-test-coverage] runCanaryIfNeeded (lifecycle browser del canary + classificazione fallimenti) non ha test: il punto di origine del doppio-lancio gira mockato a un livello troppo alto
- **Verdict**: unverified  
- **File**: `src/core/workflowEntryGuards.ts:29-170`  
- **Perché**: Il canary E' il primo dei due browser nel bug doppio-lancio. Senza un test che fissi 'canary launcha+chiude esattamente 1 browser e poi la cache 4h impedisce il re-launch', il comportamento intermittente (1 run fallisce, 1 run ok a seconda della cache) resta non specificato — e una modifica alla finestra di cache o al lifecycle puo' reintrodurre il doppio launch senza segnale.  
- **Fix**: Estendere workflowEntryGuards.vitest.ts con: (1) cache hit — getRuntimeFlag('canary_last_ok_at') entro 4h → runCanaryIfNeeded ritorna ok senza chiamare launchBrowser (asserire launchBrowser non chiamato); (2) cache miss/scaduta → launchBrowser e closeBrowser chiamati 1 volta per account, e setRuntimeFlag('canary_last_ok_at', ...) scritto a fine; (3) restriction/challenge nel page text → quarantineAccount con reason dedicato e NESSUNA ri-quarantena dal caller (quarantineType=null). Browser gia' mockato, costo basso.

### [D8-test-coverage] postSyncEnrichment (scoring/promozione/cloud-sync + fallback outbox) senza test: la regola anti-ban 'non promuovere lead con confidence bassa o score-fallback' non e' protetta
- **Verdict**: confirmed  
- **File**: `src/core/salesNavigatorSync.ts:293-593`  
- **Perché**: Promuovere a READY_INVITE un lead con confidence bassa o con score-fallback significa inviare inviti a target non verificati → acceptance rate basso → pending ratio in salita → rischio ban (lo dice il codice stesso). E' una regola anti-ban a tutti gli effetti, e oggi e' difesa solo da commenti, non da un test. Una regressione (es. qualcuno rimuove il gate confidence>=70 'per arricchire di piu'') passerebbe inosservata.  
- **Fix**: Unit test su postSyncEnrichment con db, scoreLeadProfile, enrichLeadAuto, transitionLead mockati: (1) lead con scoreResult.reason='API_ERROR_FALLBACK' → updateLeadScores NON chiamato (score resta null, riga 482 saltato); (2) lead score=40 confidence=80 → transitionLead a READY_INVITE, promoted++; (3) lead score=40 confidence=50 → transitionLead a REVIEW_REQUIRED, promoted NON incrementato; (4) batchUpsertCloudLeads che throwa → pushOutboxEvent chiamato per ogni lead (fallback) e cloudErrors++. Prioritizzare (1)-(3): sono direttamente anti-ban.

### [D9-automation-api-coerenza] AI Advisor ABORT gate (L5) attivo solo nel ramo interattivo del preflight: il path automation/n8n (non-TTY, skipPreflight) lo salta
- **Verdict**: unverified  
- **File**: `src/workflows/preflight.ts:46-71`  
- **Perché**: Asimmetria di un gate di sicurezza anti-ban tra CLI e automation. Un operatore CLI che lancia sync-list interattivo riceve il consiglio AI di ABORT (es. condizioni di rischio borderline sotto la soglia STOP=60 ma sopra il giudizio AI); lo stesso comando via API/n8n (loop) procede senza quel controllo. Le condizioni critiche (proxy assente/blacklisted, risk STOP) restano coperte nel ramo headless (commento H4 fix riga 62-66), ma il livello AI-advisor no — è una protezione presente in un path e assente nell'altro per lo stesso workflow.  
- **Fix**: Decidere esplicitamente la semantica (è un'asimmetria intenzionale o un buco): se l'AI ABORT deve valere anche in produzione non-interattiva, spostare la valutazione runAiAdvisor + blocco ABORT anche nel ramo headless (riga 46-71), bloccando con reason 'AI_ABORT' come fa buildPreflightBlockedResult (shared.ts:70). Se è intenzionale (AI advisor solo come aiuto interattivo umano), documentarlo come decisione in AGENTS.md/commento per evitare che venga letto come gate mancante.

## LOW

### [D2-antiban-stealth] In modalita' interactive il bot salta il warmup di sessione e va dritto su SalesNav (pattern 'apri-e-vai-dritto')
- **Verdict**: confirmed  
- **File**: `src/core/salesNavigatorSync.ts:688`  
- **Perché**: Anche in interactive il bot esegue navigazione AUTOMATICA (page.goto diretto alla pagina liste SalesNav, scroll, paginazione, click): saltare il warmup significa che la primissima richiesta della sessione e' un hit diretto a /sales/lists/people/, esattamente il pattern che il warmup esiste per mascherare. La presenza dell'utente al terminale non rende la navigazione del bot piu' umana lato LinkedIn.  
- **Fix**: Eseguire (almeno) un warmup ridotto anche in interactive — es. il ramo 'feed rapido' gia' presente in warmupSession (sessionWarmer.ts:81-94) — disaccoppiando il warmup dal blockUserInput (che giustamente resta off in interactive). Il warmup non richiede input-block.

### [D2-antiban-stealth] sync-list non e' soggetto al gate pending-ratio dell'antiBanChecklist (gate ristretto a send-invites/send-messages)
- **Verdict**: confirmed  
- **File**: `src/workflows/preflight/antiBanChecklist.ts:13`  
- **Perché**: Corretto in linea di principio (sync-list non invia inviti, non muove direttamente il pending ratio), MA sync-list AUTO-PROMUOVE lead a READY_INVITE nel post-sync (salesNavigatorSync.ts:500-515) alimentando la coda outbound. Un sync che genera molti READY_INVITE mentre il pending ratio e' gia' oltre soglia rende piu' facile sforare al successivo send-invites. Non e' un bug del sync, ma un punto cieco di coerenza anti-ban tra fasi.  
- **Fix**: Non bloccare sync-list sul pending ratio (giusto cosi'), ma in caso di pending-ratio gia' oltre soglia mostrare un warning informativo nel preflight di sync-list (es. 'pending ratio alto: i lead promossi non verranno inviati finche' non rientra'), per evitare che la pipeline accumuli outbound a vuoto. Igiene/coerenza, severity bassa.

### [D3-robustezza-runtime] takeDbSnapshot e setRuntimeFlag(checkpoint) swallowano ogni errore con .catch(()=>null): degradazioni DB invisibili nel report
- **Verdict**: confirmed  
- **File**: `src/core/salesNavigatorSync.ts:646,984,936,942,949,991`  
- **Perché**: Errori di I/O DB vengono nascosti: lo snapshot mancante e' solo cosmetico, ma il fallimento silenzioso della persistenza del checkpoint ha impatto anti-ban (ri-scraping non voluto di liste gia' fatte = volume azioni LinkedIn extra) e nessun segnale lo evidenzia. E' il pattern 'swallowed error' che L5-LI.4 vieta.  
- **Fix**: Loggare (logWarn) dentro i .catch invece di degradare in silenzio: per takeDbSnapshot un warn 'snapshot DB non disponibile' con il messaggio errore; per setRuntimeFlag(checkpoint) un logWarn dedicato cosi' che un fallimento di persistenza del checkpoint sia tracciato (rilevante perche' causa ri-scraping). Mantenere il fallback non-bloccante ma renderlo osservabile.

### [D4-dataflow-correttezza] uniqueCandidates del report somma i per-lista: stesso profilo in 2+ liste e contato 2 volte (diverge dal DB)
- **Verdict**: confirmed  
- **File**: `src/core/salesNavigatorSync.ts:843`  
- **Perché**: Incoerenza di conteggio tra 'unici' riportati e unicita effettiva nel DB quando si sincronizzano piu liste con overlap di profili. Nel run reale (1 sola lista, 25 unici = 8 updated + 17 unchanged + 0 inserted = 25) il numero torna, ma con --list vuoto (tutte le liste) il report sovrastima gli unici. Best-practice retroattiva (zero-P): 'funziona sul caso 1-lista' non significa corretto sul caso multi-lista.  
- **Fix**: Per il conteggio aggregato degli unici usare un Set<string> globale dei linkedinUrl normalizzati popolato man mano (o derivare report.uniqueCandidates da `new Set(allSyncedLeadIds.map(e=>e.id)).size` dopo il loop), invece della somma dei per-lista. Lasciare il per-lista intatto nel listReport.

### [D4-dataflow-correttezza] candidatesDiscovered e un contatore lordo di anchor DOM, non di candidati reali: rapporto 200/25 spiegato da re-scan
- **Verdict**: confirmed  
- **File**: `src/salesnav/listScraper.ts:679`  
- **Perché**: Etichetta del report fuorviante ('Candidati scoperti: 200') vs realta (25 persone). Non e un bug di correttezza del DATO finale (gli unici e gli upsert sono corretti), ma il numero esposto all'utente sovrastima di un ordine di grandezza cosa e stato realmente trovato. Rischio di interpretazione errata delle performance dello scraping.  
- **Fix**: Documentare/rinominare la semantica: o rietichettare in report come 'Righe lead grezze lette' vs 'Candidati unici', oppure contare candidatesDiscovered solo come somma dei rawCandidates NUOVI (non gia in byUrl) per riflettere candidati realmente nuovi per pagina. Intervento minimo (zero-I): cambiare l'etichetta nel formatFinalReport (salesNavigatorSync.ts:194) e nel summary Telegram, dato che il valore numerico ha un significato legittimo (carico DOM) ma il nome inganna.

### [D4-dataflow-correttezza] enriched/promoted=0 con 25 cloudSynced: i lead gia completi vengono saltati ma comunque ri-spinti al cloud (comportamento corretto ma non documentato nel conteggio)
- **Verdict**: confirmed  
- **File**: `src/core/salesNavigatorSync.ts:327-330`  
- **Perché**: Non e un over/under-count errato sul dato finale, ma 'Lead processati: 25' vs '0 puliti/scorati/arricchiti' e ambiguo: l'utente non distingue 'processati ma gia completi (skip)' da 'processati e falliti'. Trasparenza del conteggio (zero-M.3: ogni numero deve poter citare cosa rappresenta).  
- **Fix**: Aggiungere un contatore `skippedComplete` in PostSyncEnrichmentReport incrementato nel ramo alreadyComplete, ed esporlo nel report ('Gia completi (skip): N') cosi i totali quadrano esplicitamente (processed = skipped + cleaned-path). Cambiamento additivo, nessun rischio anti-ban.

### [D5-architettura-srp] Triplicazione del blocco re-login SalesNav (disable click-through → awaitManualLogin → enable → blockUserInput → retry) in runSalesNavigatorListSync
- **Verdict**: confirmed  
- **File**: `src/core/salesNavigatorSync.ts:722-741, 811-836 (+ initial login 666-684)`  
- **Perché**: Duplicazione di logica anti-ban critica (gestione click-through + input-block durante login manuale). Se la sequenza va corretta (es. ordine enable/blockUserInput, timeout, gestione interactive) va modificata in 3 punti → rischio di drift e incoerenza fra le 3 copie (una già diverge: la #1 usa timeout 5min, le #2/#3 usano 3min). Violazione DRY su codice che tocca finestra/sessione.  
- **Fix**: Estrarre un helper `withSalesNavReloginRetry(session, interactive, action)` che incapsula disable→awaitManualLogin→enable→blockUserInput→retry(action) e usarlo nei 3 punti, parametrizzando il context label e l'azione di retry. Surgical: nessun cambio di comportamento, solo deduplicazione verificata con i test esistenti + antiban-review (tocca click-through/blockUserInput).

### [D5-architettura-srp] leadsCore.ts (1447 righe) aggrega responsabilità DB eterogenee in un solo modulo (leads, lead_lists, company_targets, salesnav_lists, lead_timing, review_queue, enrichment_data, deconfliction)
- **Verdict**: confirmed  
- **File**: `src/core/repositories/leadsCore.ts:1-1447`  
- **Perché**: Coesione per 'è codice DB di lead' ma non per dominio: il modulo supera 4.8x la soglia 300 righe (L1.6) e mescola tabelle non correlate (timing analytics vs review queue vs company_targets). È un problema latente di manutenibilità/navigabilità, non un bug. Severity bassa perché: alta omogeneità tecnica (tutto data-access con stesso stile), nessun side-effect nascosto, madge=0, e il rischio anti-ban/runtime è nullo.  
- **Fix**: NON refactor gratuito (zero-I). Proporre (non applicare a reflex) uno split per dominio quando si tocca l'area: es. salesnavListsRepository.ts (salesnav_lists/items), companyTargetsRepository.ts, leadTimingRepository.ts, mantenendo leadsCore.ts per le leads core. Tracciare in todos/improvements-proposed.md; eseguire solo con baseline test verde (zero-Q regression-safe) dato che il barrel repositories.ts re-esporta tutto.

### [D6-preflight-guards-incidenti] skipPreflight + path non-TTY bypassa la CHECKLIST anti-ban interattiva (L6) e l'AI advisor: in produzione (scheduler/n8n) restano solo i warning critical
- **Verdict**: confirmed  
- **File**: `src/workflows/preflight.ts:46-72 + src/automation/dispatcher.ts:44-52`  
- **Perché**: Per sync-list lo scope della checklist saltata è limitato (pending-ratio gate è `isOutreach`-only, sync-list non è outreach — antiBanChecklist.ts:12,69), quindi l'impatto anti-ban diretto è contenuto. MA il controllo `recentSessionHours < minHours` (minHours=1 per sync-list) — anti-maratona/spacing sessioni — viene saltato del tutto sul path produzione: lo scheduler può lanciare sync-list back-to-back senza il guard di spacing sessione che invece l'utente interattivo vede. Il commento H4 (preflight.ts:62-69) riconosce esplicitamente che il path non-TTY è 'produzione reale' ma copre solo i warning critical, non lo spacing.  
- **Fix**: Estrarre da runAntiBanChecklist i controlli MECCANICI non-interattivi (recentSessionHours spacing, lastSync staleness) in una funzione pura che gira ANCHE sul branch non-TTY/skipPreflight e produce warning di livello adeguato (critical se sotto soglia hard), così lo spacing-sessione è enforced anche in produzione, non solo quando c'è un umano al terminale. Lasciare interattivi solo gli askConfirmation.

### [D6-preflight-guards-incidenti] Override accountId della run NON scoped/ripristinato: il preflight legge il flag CLI-override globale e non lo resetta a fine run
- **Verdict**: uncertain  
- **File**: `src/accountManager.ts:80-85 + src/workflows/services/syncListService.ts:187-192`  
- **Perché**: In esecuzione singola (CLI one-shot) l'override globale è innocuo perché il processo termina. In contesto loop/long-running che riusa lo stesso processo per comandi di account diversi, un override non ripristinato può far ereditare l'accountId del comando precedente a un comando successivo senza accountId esplicito (selectedAccountId/request.accountId entrambi null → accounts[0] in workflowEntryGuards.ts:194). È un rischio di leakage di scope cross-run, basso perché i path attuali passano accountId esplicito, ma fragile (zero-P).  
- **Fix**: Rendere l'accountId della run un parametro esplicito end-to-end (già lo è in gran parte: selectedAccountId fluisce nei guard e nel sync) ed evitare di dipendere dallo stato modulo-global per la selezione dentro il workflow; se l'override globale serve, ripristinarlo in un finally a chiusura del comando nel loop. Verificare che varianceAccountId (wEG.ts:193-194) non cada su accounts[0] quando l'intento era un account specifico.

### [D7-concorrenza-lifecycle] Ordine invertito close/disable nel cleanup del canary (incoerente con il pattern canonico)
- **Verdict**: unverified  
- **File**: `src/core/workflowEntryGuards.ts:163`  
- **Perché**: Non e' un leak permanente (il commento a workflowEntryGuards.ts:160-162 dice intenzionalmente 'il click-through resta attivo per tutto il wind-down'), ma e' incoerente con la convenzione del resto del codebase e mantiene per ~8s un timer che agisce su un processo che sta morendo. Coerenza/robustezza (zero-O), non bug funzionale.  
- **Fix**: Valutare l'allineamento al pattern canonico (disable -> close) anche nel canary, oppure documentare in modo univoco perche' qui l'ordine e' invertito. Surgical, basso rischio. Se si tiene l'ordine attuale, almeno rimuovere il PID da _activePids prima del wind-down per fermare lo spray inutile.

### [D8-test-coverage] Il contratto API/dispatcher di sync-list e' coperto solo parzialmente: payload accept-path e legacy-error-mapping non verificati
- **Verdict**: confirmed  
- **File**: `src/tests/automationBridge.vitest.ts:22, src/tests/workflowRefactor.vitest.ts:332`  
- **Perché**: Robustezza del contratto n8n→bot. Se lo schema zod accetta erroneamente un payload o il dispatcher non propaga maxLeads/enrichment, il sync gira con parametri sbagliati (es. enrichment quando l'utente l'ha disabilitato → chiamate API non volute). E' lower severity perche' il path felice tende a funzionare, ma il test asimmetrico (solo reject, mai accept) lascia scoperta la meta' positiva.  
- **Fix**: Aggiungere a automationBridge: un caso 'accetta sync-list con listName valido' e uno 'accetta sync-list con listUrl valido' su PublicAutomationCommandRequestSchema. Estendere il test dispatcher sync-list per asserire la propagazione completa del payload (maxLeads, listUrl, enrichment) a executeSyncListWorkflow, non solo listName/maxPages.

### [D9-automation-api-coerenza] Path automation/n8n non emette alcun alert Telegram su blocco/fallimento sync-list: solo persistenza DB + console.log (asimmetria col CLI che invia il report)
- **Verdict**: unverified  
- **File**: `src/cli/commands/loopCommand.ts:401-429`  
- **Perché**: Robustezza/observability: un fallimento o blocco anti-ban del sync-list lanciato via n8n/dashboard (es. SELECTOR_CANARY_FAILED, ACCOUNT_QUARANTINED, WORKFLOW_ERROR per il timeout doppio-browser del finding #1) non genera nessun alert proattivo — viola lo spirito di L5-LI.1/L5-LI.4 (nessun silent failure, alert Telegram strutturato). Il risultato è recuperabile via GET /automation/commands/:requestId (automationReadModel.ts:101), ma è un modello PULL: se n8n/dashboard non fa polling, il fallimento resta silente. Severity bassa perché il dato è persistito e interrogabile, non perso.  
- **Fix**: Nel loop (loopCommand.ts task automation_commands), su result non-success inviare un sendTelegramAlert strutturato (WHAT/WHY/DO) almeno per blocked.reason critici e WORKFLOW_ERROR, riusando la formattazione di reportFormatter; oppure documentare che il surfacing è demandato a n8n via polling dell'endpoint e garantire che il workflow n8n lo faccia. Verifica: un sync-list bloccato via API produce un alert o un record interrogato.

### [D9-automation-api-coerenza] Bounds maxLeads/maxPages validati solo nel path automation (zod), non nel path CLI: il service non clampa l'upper-bound
- **Verdict**: unverified  
- **File**: `src/cli/commands/workflowCommands.ts:19-20`  
- **Perché**: Coerenza/robustezza. Asimmetria di validazione tra i due entrypoint sullo stesso service: il CLI (operatore locale, rischio minore) può chiedere volumi illimitati che lo scraping eseguirà senza tetto, mentre l'API li limita. Non è un buco di sicurezza grave (CLI = accesso locale), ma è un'incoerenza di contratto: lo stesso parametro ha regole diverse a seconda del path. Volumi elevati su SalesNav sono comunque rilevanti anti-ban (sessioni lunghe = pattern non-umano).  
- **Fix**: Centralizzare il clamp nel service (syncListService.ts:183-184) applicando lo stesso upper-bound dello zod (es. Math.min(rawMaxPages, 999) e Math.min(rawMaxLeads, 100000)) così entrambi i path condividono lo stesso contratto a valle, indipendentemente dall'entrypoint. Verifica: `--max-pages 5000` da CLI viene clampato come l'API.

## Falsi positivi scartati (verifica adversariale)

- **[D1-bug-doppio-lancio-browser]** Fix applicato (waitForBrowserProcessExit) NON copre il path sync-list via session-reuse: existingSession è wired solo in sync-search, non in sync-list — _La tesi centrale del finding ("il fix waitForBrowserProcessExit NON copre il path sync-list perché existingSession è wired solo in sync-search") è ERRATA. Verifica sul codice reale: FATTI CONFERMATI (parziali): - syncListService.ts:206-216 NON passa existingSession a runSalesNavigatorListSync. Vero._
- **[D2-antiban-stealth]** runDecoyStep/performDecoyAction navigano via page.goto diretto a feed/network/notifications/search (teletrasporto URL, non click su menu) — _VERIFICA SUL CODICE REALE. 1) ASSERZIONE LETTERALE = corretta ma irrilevante per il perimetro. runDecoyStep (humanBehavior.ts:1260/1268/1276/1286) e performDecoyAction (1409/1421/1428/1445) usano davvero page.goto diretto verso feed/mynetwork/notifications/search. Letto e confermato. 2) PREMESSA DI _
- **[D2-antiban-stealth]** Navigazione iniziale alla pagina liste e alle singole liste via page.goto diretto su URL SalesNav — _Verificato il codice reale. Il fatto tecnico nudo del finding È vero: src/salesnav/listScraper.ts:576 fa `page.goto(SALESNAV_LISTS_URL, ...)` e listScraper.ts:626 fa `page.goto(options.listUrl, ...)`. Confermato leggendo le funzioni navigateToSavedLists e scrapeLeadsFromSalesNavList. MA la premessa _
- **[D5-architettura-srp]** Contratto di sessione browser rotto tra guard-phase e execution-phase: sync-list lancia 2 browser sullo stesso profilo persistente Camoufox (root del timeout 180s) — _Il bug descritto ESISTEVA ma è GIÀ FIXATO in HEAD del branch corrente (refactor/adk-split). Verifica sul codice reale: 1. MECCANICA CONFERMATA: il canary lancia un browser Camoufox su account.sessionDir (workflowEntryGuards.ts:44-52, launchBrowser) e lo chiude (riga 163, closeBrowser); poi syncListS_
