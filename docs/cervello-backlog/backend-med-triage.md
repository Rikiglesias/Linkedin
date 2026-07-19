---
keyword: backend-med-triage
end_state: i 142 finding MEDIUM del Backend Deep Audit sono classificati (FIX-NOW/CONFIRM/DEFER/ALREADY-FIXED) e tutti i FIX-NOW non-anti-ban hanno fix+test, con `npm run conta-problemi` a 0 e nessun file anti-ban toccato
---
> **CONFERMATO-APERTO 2026-07-04 — passata `todos-freddi`** (auditor opus, verifica alla fonte; verdetti integrali: `maintenance/2026-07-04-verdetti-todos-freddi.json`)
> Evidenza: 12 commit med-triage esistono, tutti 2026-06-07 non-anti-ban: `1f6c303`(ondata1) `e104afb`(2) `404a8a5`(3) `1428bec`(3b) `864d15b`(4a) `d1a5e01`(4b totp+supabaseSyncWorker) `68c9125`(4c) `103ceb4`(4d) `6870071`(2b addLead/leadsLearning) `da40203`(2c featureStore) `f481bf0`(searchLeads, dato DEFER a riga 69 ma FATTO) `1555a60`(batch B 8 HIGH). Checkbox aperto riga 62 = FOTO stantia: item chiusi nei commit sopra + sez. Stato riga 100 (csvImporter bounded/leadEnricher deep FATTO). Residuo reale = S…
> Azione/causa: Mantieni CONFERMATO-APERTO. Marca [x] gli item FIX-NOW del checkbox riga 62 (supabaseSyncWorker=d1a5e01, addLead/leadsLearning=6870071, featureStore=da40203, csvImporter-bounded/leadEnricher-deep=riga 100), riscrivendo il checkbox così che resti esplicito SOLO il residuo leva-utente: (a) ~26 finding anti-ban Gruppi A/B/C in attesa di /antiban-review; (b) 2 CONFIRM-USER (env.ts priorità secret prod, auth+rate-limit /metrics); (c) 1 DEFER csvImporter tx-batch (savepoint per-riga). Aggiungi puntatore: anti-ban vive anche in backend-antiban-hardening.md. NON archiviare finché le leve anti-ban non …


# Backend MEDIUM triage — `/goal backend-med-triage`

> Fonte: `docs/tracking/BACKEND_DEEP_AUDIT_2026-06-06.md` sezione "Findings medium/low" (righe 226-448).
> 142 medium (+66 low). Batch A (P0 GDPR + AB-24) e Batch B (8 HIGH) già chiusi.

## End-state (DONE globale)
1. Tutti i medium classificati in questo tracker con decisione.
2. Ogni **FIX-NOW** applicato + test mirato (a ondate); `npm run conta-problemi` = 0.
3. **Zero file anti-ban toccati**: `src/browser/**`, `src/risk/**`, `src/proxy/**`, `src/salesnav/**`,
   `src/fingerprint/**`, `src/captcha/**`, `src/workers/**`, `src/core/scheduler.ts`.
4. **Zero file del peer** adk-split/codex toccati: `src/scripts/aiControlPlaneAudit.ts`, `.codex/**`,
   `AGENTS.md`/`CLAUDE.md`, `src/scripts/lib/aiControlPlaneRegistry.ts`.

## Regole di classificazione
- **FIX-NOW**: bug di correttezza / security / resilience / GDPR / igiene in file NON-anti-ban, fixabile
  chirurgicamente con test, basso rischio, non cambia comportamento su LinkedIn.
- **CONFIRM-USER**: tocca anti-ban (timing/volumi/navigazione/fingerprint/proxy) o è una decisione di
  prodotto/legale (data-minimization, LIA, anonymize-vs-delete) → conferma utente prima (zero-G).
- **DEFER**: refactor grande (god-module split), test-suite mancanti estese, performance non urgente.
- **ALREADY-FIXED / VERIFY**: da ricontrollare alla fonte (zero-M); alcuni già risolti (come H11/T3).

## Classificazione per categoria (142 medium)

### Anti-ban (~26 med, righe 234-277) → tutti CONFIRM-USER
Toccano browser/risk/proxy/salesnav/fingerprint/captcha/workers/scheduler. NON toccare senza conferma.

### Security (righe 283-306)
- FIX-NOW: `security/redaction.ts` (sk-/sk-ant- con trattino) · `cloud/telegramAiImporter.ts` (URL validation `new URL()`) · `api/helpers/audit.ts` (audit-write swallow→logError) · `security/totp.ts` (anti-replay) · `config/env.ts` (priorità /run/secrets vs process.env) · `scripts/restoreDb.ts` (execSync→execFileSync) · `api/routes/metrics.ts` (auth+rate-limit /metrics) · `security/filesystem.ts` (ACL Windows / log al boot).
- CONFIRM-USER: `proxy/proxyQualityChecker.ts`, `proxy/proxyManager.ts` (ASN HTTP, password proxy, validazione exit-proxy) · `captcha/openaiVisionProvider.ts` (generatePlaywrightCode) → anti-ban path.
- VERIFY: `integrations/personDataFinder.ts`+`emailGuesser.ts` (SSRF/SMTP enum) · `ai/inviteNotePersonalizer.ts` (prompt injection) · `cli/loopCommand.ts` (cmd Telegram authz).

### Compliance-GDPR (righe 312-323)
- FIX-NOW: `scripts/gdprRetentionCleanup.ts:163-189` (deleteLead transazionale) + `:307-350` (runRightToErasure estendere a message_history/lead_events/lead_intents) — **follow-up già tracciati da Batch A** · `integrations/personDataFinder.ts:1284-1298` (maskName) · `core/repositories/leadsCore.ts` (gdpr_opt_out filtro nei selettori).
- CONFIRM-USER / decisione: `system.ts:954-984` (anonymize vs hard-delete convertiti) · data-minimization personDataFinder · LIA OSINT · emailGuesser catch-all · PII a LLM remoto.

### Data-flow-db / Correctness (righe 329-370)
- FIX-NOW: `core/repositories/leadsCore.ts` (deconfliction LIKE leadId `1337-1368`; promoteNewLeads race `600-622`; addLead atomicità+URL `313-349`; searchLeads normalize `1279`; appendLeadEvent JSON.stringify `1231`) · `leadsLearning.ts` (read-modify-write `149-172`; resolveLeadMetadataColumn fallback `100-117`) · `featureStore.ts:506-511` (signature tautologica) · `ai/leadDataCleaner.ts:131-141` (`new RegExp` non-escaped → crash) · `campaignEngine.ts:84-132` (atomicità+idempotenza) · `workflows/preflight/statsCollector.ts:55-87` (trend UTC/locale) · `workflows/preflight.ts:92-134` (db stats pre-listName) · `integrations/leadEnricher.ts:437-494` (flag deep) · `integrations/webSearchEnricher.ts:214` (phone validation) · `cloud/supabaseDataClient.ts:166-189` (RMW atomico) · `stats.ts:808-828` (finestra invertita) · `risk/significance.ts` (z-test guard min-sample — risk/ ma puro stat, VERIFY).
- VERIFY/DEFER: `db.ts:150-154` adaptParams (RIMOSSO in Batch B → ri-verificare) · `db.ts:156-218` (migliorato T1) · `stats.ts:87-88` timezone (più ampio) · `db.ts:246-258,430-458` (RETURNING/DDL) · `isPostgres` doppia sorgente `370`.
- CONFIRM-USER: `salesnav/*`, `captcha/*`, `workers/*`, `companyEnrichment.ts` (page.goto).

### Observability / Resilience (righe 376-410)
- FIX-NOW: `config/telemetry/logger.ts:28-46` (isolare fallimento recordRunLog) · `config/telemetry/alerts.ts:44-72` (markdown escaping) · `sync/outboxUtils.ts:1-11` (payload malformato→DLQ) · `validation/messageValidator.ts:57-73` (catch vuoto→logWarn) · `db-sync/supabaseSyncWorker.ts:204-212` (alert PERMANENT_FAILURE) · `csvImporter.ts:36-136` (bounded+transazione) · `ai/semanticChecker.ts:10-11` (memory leak Map) · `sync/backpressure.ts:69-82` (RMW atomico) · `scripts/restoreDb.ts:139-147` (backup pre-restore) · `repos-2/aiQuality.ts:494-587` (finalize+reaper).
- VERIFY (core/jobRunner gestisce sessioni browser — borderline anti-ban): `jobRunner.ts` failureRate clamp `79-104`, watchdog `638-772`, circuit breaker `1044`. → trattare come CONFIRM salvo i puri calcoli.
- CONFIRM-USER: `proxy/*`, `salesnav/*`, `captcha/*`, `core/salesNavigatorSync.ts`, `workflows/services/send*Service` (outreach), `workflows/preflight/riskAssessor.ts`.
- PEER (NON toccare): `scripts/aiControlPlaneAudit.ts`, `scripts/lib/aiControlPlaneRegistry.ts`.

### Architettura / Hygiene / Type-safety / Perf / Testing (righe 416-448)
- FIX-NOW (piccoli): `cli/cliParser.ts:53-59` (parseIntStrict regex) · `cli/stdinHelper.ts:15-46` (listener leak) · `ai/aiDecisionEngine.ts:101-113` (clearTimeout finally) · `integrations/personDataFinder.ts:180-181` (regex lastIndex) · `workers/registry.ts` (zod payload — workers/ → CONFIRM) · `config/validation.ts:326-364` (regole duplicate) · `db/migrations/059` (commento/IF NOT EXISTS) · `core/securityAdvisor.ts:78-263` (fs async).
- DEFER (refactor grandi): god-module `cli/loopCommand.ts`, `core/salesNavigatorSync.ts`, `stats.ts` split · N+1 scheduler (risk/) · `system.ts:150-202` claim set-based · test-suite mancanti (leadsCore, scheduler, proxyQualityChecker, e2eDry, coverage thresholds).
- CONFIRM-USER: `browser/windowInputBlock.ts` (execSync), `browser/missclick.ts` (dead code), `db.ts` pool config.

## Ondate di fix (FIX-NOW)
- [x] **Ondata 1** FATTA: redaction `sk-`/`sk-ant-`/`sk-proj-` (security) · leadDataCleaner regex escape (crash) · gdprRetentionCleanup `withTransaction` su deleteLead/anonymizeLead/runRightToErasure (chiude follow-up Batch A) · logger isola recordRunLog · telegramAiImporter `new URL()`. +22 test mirati. `outboxUtils` spostato (richiede fix nel chiamante → Ondata 3).
- [~] **Ondata 2** PARZIALE: deconfliction LIKE delimitato · promoteNewLeads `AND status='NEW'` · appendLeadEvent JSON guard (+3 test). **Restano** (richiedono infra DB-test o più articolati): addLead atomicità, leadsLearning RMW, featureStore signature, searchLeads normalize.
- [~] **Ondata 3** (hygiene+resilience): cliParser `parseIntStrict` regex completa (+test) · stdinHelper listener close/error · aiDecisionEngine `clearTimeout` · alerts `escapeTelegramHtml` (+test) · semanticChecker eviction chiavi (cap 500) · messageValidator catch→logWarn (+test). **Restano**: supabaseSyncWorker alert, csvImporter, statsCollector tz, leadEnricher deep.
- [~] **Ondata 4** PARZIALE: audit.ts swallow→logError (+test) · statsCollector trend tz · totp anti-replay (+test) · supabaseSyncWorker alert PERMANENT_FAILURE · restoreDb execSync→execFileSync (no shell injection). **Restano**: metrics auth+rate-limit, filesystem ACL (Windows icacls → DEFER), csvImporter bounded+tx, leadEnricher deep (VERIFY API findPersonData), residui Ondata 2 (DB-test). **env.ts resolveSecret → CONFIRM-USER**.
- [ ] **Residui sparsi** (correttezza/resilience): supabaseSyncWorker alert PERMANENT_FAILURE, csvImporter bounded+transazione, integrations/leadEnricher deep flag (dipende da API findPersonData → VERIFY), residui Ondata 2 (addLead/leadsLearning/featureStore → infra DB-test).

## FIX-NOW restanti (articolati/infra → turno fresco) e riclassifiche
- `api/routes/metrics.ts` echo err.message → **FATTO** (messaggio generico + logError). **AUTH/rate-limit su /metrics → CONFIRM-USER** (aggiungere auth rompe lo scraping Prometheus esistente = contratto deployment).
- `csvImporter` bounded+transazione → DEFER (refactor medio: streaming a batch + withTransaction).
- `integrations/leadEnricher` deep flag → VERIFY (dipende dall'API di findPersonData per un mode company-only).
- `security/filesystem.ts` ACL Windows → DEFER (icacls, OS-specific).
- Residui Ondata 2: **addLead atomicità FATTO** (withTransaction +test) · **leadsLearning RMW FATTO** (withTransaction) · **featureStore signature tautologia FATTO** (verifica reale se firmata, logWarn se non firmata; throw invariato) · `searchLeads` normalize status (L minore) → DEFER.

## Triage ANTI-BAN per decisione utente (analisi `/antiban-review`, NESSUNA modifica applicata)

> Tutti richiedono tua autorizzazione (zero-G). Classificati per impatto anti-ban. File: `src/{risk,browser,proxy,salesnav,fingerprint,captcha,workers}`.

### Gruppo A — RINFORZI DIFENSIVI (riducono il rischio ban; basso rischio comportamentale → autorizzazione rapida)
- `riskEngine.ts:35-48` **pendingRatioStop 0.80→0.65** (default sopra red-flag 65% — verdetto /antiban-review: SICURO migliorativo).
- `scheduler.ts:489-560` weekly cap superabile dai moltiplicatori strategy/mood → re-clamp a weeklyRemaining come ultimo step.
- `proxyManager.ts:398-407` Tor fallback default-ON → **Tor opt-in (default off)** + halt/alert a pool esaurito.
- `proxyQualityChecker.ts:272-373` datacenter detection advisory → scartare/cooldown ASN DC nella selezione.
- `incidentManager.ts:223-266` challenge → gate persistente multi-giorno (no auto-resume su account flaggato).
- `workers/inboxWorker.ts:251-295` auto-reply non decrementa budget → `checkAndIncrementDailyLimit`.
- `workers/interactionWorker.ts:148-185` LIKE/FOLLOW senza daily cap → aggiungere cap+varianza.
- `fingerprint/pool.ts:282-301` rotazione settimanale DOWNGRADE versione → fissare OS/famiglia per account, ruotare solo a versioni ≥.
- `exitIpChecker.ts:98-162` no geo-coerenza exit-IP/tz → validare/scartare.

### Gruppo B — CAMBI COMPORTAMENTALI (cambiano il comportamento browser → review approfondita + test PRIMA)
- `stealthScripts.ts:255-283,491-513` freeze chrome.loadTimes/performance.memory.
- `humanBehavior.ts:889-894` inter-keystroke uniforme → log-normale; `:813-852` simulateTabSwitch; `:1217-1258` decoy page.goto→click.
- `workers/randomActivityWorker.ts:63-88` navigazione teletrasportata warm-up.
- `workers/followUpWorker.ts:448-514` burst spacing; `postCreatorWorker`/`hygieneWorker`/`inviteWorker` verify post-azione.
- `salesnav/visionNavigator.ts` + `captcha/openaiVisionProvider.ts` click a coordinate fisse.
- `companyEnrichment.ts` / `salesNavCommands.ts` / `loopCommand.ts` / `utilCommands.ts(--no-proxy)` / `syncSearchService.ts(noProxy)` navigazione/proxy autenticati.

### Gruppo C — DE-CORRELAZIONE MULTI-ACCOUNT (architetturale)
- `scheduler.ts:523-560` getTodayStrategy senza accountId, mood seedato solo su data → seed `mood:${accountId}:${date}`.
- `accountManager.ts:132-171` binding lead→account da ordine array → persistere account_id.

## Stato (aggiornato dall'AI)
Triage COMPLETO (142 classificati). **27 fix-now medium applicati + testati/ispezione** + 8 HIGH (Batch B) = **35 fix, 15 commit verdi, gate sempre exit 0** (`1f6c303` `e104afb` `404a8a5` `1428bec` `864d15b` `d1a5e01` `68c9125` `103ceb4` `6870071` `da40203` `f481bf0` + `1555a60`). **Esauriti TUTTI i fix-now netti e a basso rischio.** Restanti SOLO:
- **csvImporter bounded FATTO** (cap MAX_CSV_ROWS anti-OOM). **leadEnricher deep gating FATTO** (deep=false salta OSINT; default invariato). **filesystem ACL warn FATTO** (avviso una-tantum no-op Windows). **DEFER residuo UNICO**: csvImporter tx-batch (edge-case PG transaction-abort senza savepoint per addCompanyTarget — refactor che richiede savepoint per-riga, turno fresco). ACL reali icacls/DPAPI = evoluzione.
- **CONFIRM-USER (leve utente, zero-G)**: `env.ts` priorità secret prod, auth `/metrics` (deployment Prometheus), **~26 finding anti-ban**.
Zero file anti-ban/peer in tutti i commit.
