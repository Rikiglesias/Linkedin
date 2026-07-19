# Backend Deep Audit — remediation (2026-06-06)

> **CONFERMATO-APERTO 2026-07-04 — passata `todos-freddi`** (auditor opus, verifica alla fonte; verdetti integrali: `maintenance/2026-07-04-verdetti-todos-freddi.json`)
> Evidenza: SEC5-parte2 REALE (anti-ban): proxyQualityChecker.ts:277 default `http://ip-api.com/json/` in chiaro (MITM spoofa DC→residential); NON in user-actions-pending.md (grep=0). God-functions PARZIALE: salesNavigatorSync.ts=1204, scheduler.ts=1093 ancora >1000 righe; bulkSaveOrchestrator 1840→1416 (A13 split, commit f786562/3b4b51d). Checkbox test CHIUSO: actionWorkers.vitest.ts copre invite/message/acceptanceWorker + humanBehavior.vitest.ts + browserAuth.vitest.ts esistono. Checkbox N+1/execSync/miss…
> Azione/causa: NON archiviare/chiudere: resta 1 leva anti-ban aperta (SEC5-parte2). Nel tracker spunta [x] con nota i 3 checkbox risolti: (riga 49 test) «actionWorkers+humanBehavior+browserAuth.vitest.ts esistono»; (riga 50) «missclick live humanBehavior.ts:176 + execSync C# rimosso = premessa stale, resta solo N+1 non verificato»; (riga 51 triage) «assorbito in backend-med-triage/backend-low-triage». Lascia [ ] aperti: riga 45 SEC5-parte2 (leva utente) e riga 48 God-functions residue (salesNavigatorSync 1204 + scheduler 1093 → puntatore a prod-readiness/workflow-hardening). Prossimo passo concreto: aggiunge…


> Fonte: `docs/tracking/BACKEND_DEEP_AUDIT_2026-06-06.md` (234 findings: 1 critical, 25 high, 142 medium, 66 low).
> Workflow originale: w7rey8c4d (43 agenti). Branch reale: `refactor/adk-split`.
> ⚠️ I fix **anti-ban** (browser/timing/proxy/fingerprint/volumi) cambiano comportamento su LinkedIn → **conferma utente PRIMA di applicare** (zero-G).

## RICONCILIAZIONE 2026-06-12 (fan-out 23 agenti, run `wf_fd9ac448-584`)

Verificati alla fonte sul codice attuale (HEAD `86080d0`) tutti i 23 finding che risultavano aperti.
Esito: **14 già FIXED dai lavori di giugno** (collaudo-360, linkedin-hardening, G1, T7-backend-batch, gdpr-erasure-cloud) · **3 STILL_VALID** · **6 PARTIAL**. Backlog reale 06-06 = **9 residui** + P2 igiene.

### ✅ FIXED — verificati con evidenza (nessuna azione)
- **AB2** salesnav unlimited → `53d564a` default 15 ricerche/30 pagine + enforcement PAUSED (`bulkSaveHelpers.ts:52`, `bulkSaveOrchestrator.ts:925`).
- **AB3** weekly cap → `efe2835` re-clamp dopo strategy/mood (`scheduler.ts:582`). Gap igiene: nessun test dedicato.
- **AB5** preflight headless → `3be2219` blocca anche su warning critical (`workflows/preflight.ts:67`). NB: il `src/browser/preflight.ts` del finding non è mai esistito.
- **AB6** Tor fallback → `4a1bf71` opt-in default OFF (`proxyManager.ts:441`, `domains.ts:358`, test).
- **AB9** captcha-resume → `1744d59` pausa indefinita persistita DB, manual-resume-only (`incidentManager.ts:253`, `system.ts:604`).
- **AB10** inbox budget → `bcbb5b5` pre-incremento atomico + rollback (`inboxWorker.ts:308`).
- **DB1** date('now') PG → `18079da`+`1555a60` regex 3 forme (`db.ts:361-392`), test 17/17.
- **DB2** account_age NaN → `1555a60` normalizza Date|string (`stats.ts:1097`), test 4/4.
- **DB3** leadsCore tx → `6262ba2` withTransaction su entrambe (`leadsCore.ts:158,384`), test 4/4.
- **DB4** purge FK outbox → `H14` figlie prima del padre (`system.ts:1056`), test.
- **SEC1** telegram authz → `1555a60` fail-CLOSED (`telegramListener.ts:140`).
- **SEC2** WS bypass → `6e43ac3` (CL15) guard su dashboardAuthEnabled (`server.ts:891`, `wsAuth.ts:89`).
- **SEC3** sentry PII → `1555a60` sanitizeForLogs nel choke-point (`sentry.ts:29`) + sendDefaultPii:false.
- **SEC6** override-account leak → `1555a60` try/finally restore (`orchestrator.ts:235`), test.

### 🔴 STILL_VALID / 🟠 PARTIAL — residui veri

**Non-anti-ban — ✅ CHIUSI 2026-06-12 (`dbe45ba`, conta-problemi exit 0 / 1748 test):**
- [x] **P0c** (GDPR): `anonymizeLead` + `runRightToErasure` azzerano `message_history.message_text` (tieni content_hash) + `lead_intents.raw_message`. Test in `gdprErasure.vitest.ts`.
- [x] **SEC4** (SSRF): nuovo `src/security/ssrfGuard.ts` (isBlockedIp v4/v6 + assertSafeOutboundUrl con resolve DNS) + flag opt-in `blockPrivateHosts` in `fetchWithRetryPolicy`, attivato su `personDataFinder.fetchPage` + `webSearchEnricher.page_fetch`. Test `ssrfGuard.vitest.ts`. Caveat noto: no pin-IP anti-DNS-rebinding (follow-up).
- [x] **P0a** (GDPR): migration `061_orphan_pii_cleanup.sql` sweep idempotente righe figlie PII orfane + 3 commenti stale "FK off" corretti.

**Anti-ban — ✅ 4/6 CHIUSI 2026-06-13 (/antiban-review SICURO ciascuno, conta-problemi exit 0 / 1748 test):**
- [x] **AB7** (`b0063c4`): `scheduler.ts:536` passa `primaryAccountId` a `getTodayStrategy()` → attiva il jitter ±15% per-account-settimana (era morto). Jitter centrato 1.0 + re-clamp weekly → cap invariato.
- [x] **AB4** (`b0063c4`): flag opt-in `PROXY_BLOCK_DATACENTER` (default OFF) → ON esclude i DC dal pool; guardia anti-pool-vuoto.
- [x] **AB8** (`b0063c4`): `performance.memory` mock ora deterministico nel tempo (trend monotono + 2 osc lente, quantizzato 100KB) invece di Math.random per-call. Seed per-sessione.
- [x] **AB1** (`77d6fba`): flag opt-in `REQUIRE_PROXY_FOR_AUTH` (default OFF) + `launchBrowser.allowDirectIp` → ON rifiuta `--no-proxy` su sessione autenticata con proxy configurato (no leak IP reale). create-profile (proxy esplicito) e webrtcLeakCheck non si rompono.

**Anti-ban/SEC — ✅ 6/6 CODICE CHIUSO 2026-06-13 (restano solo 2 leve utente RUNTIME, non-codice):**
> Leve utente residue: **AB11-T5** (test staging account reale) + **SEC5-parte2** (piano provider ip-api Pro). Nessun fix-codice anti-ban/security ancora aperto in questo audit.
- [x] **AB11** (codice DONE `82c6706` 2026-06-13): handoff sessione canary→jobRunner esteso a invite/message/check/all (single-account). `/antiban-review` SICURO, conta-problemi exit 0 / 1754 test (+6). Design+ricerca: binding `~/todos/ab11.md` (goal `/goal ab11`). **Resta T5** = test integrazione staging con account reale (canary forzato → 1 launch, zero parent.lock retry) = leva utente runtime. Satelliti scorporati come **AB11-b** (consolidamento sessione cross-subtask salesnav/ssi/random_activity; company_enrichment escluso = account separato) — vedi "Fuori scope" nel binding ab11.
- [x] **SEC5-parte1** (codice DONE `8488173` 2026-06-13): password proxy NON più persistita in chiaro in `.session-meta.json` — `persistStickyProxy` salva solo server+username+type+weekNumber, `getStickyProxy` ri-deriva le credenziali dal pool/config (match esatto server+username). `/antiban-review` SICURO (stickiness/geo invariati), conta-problemi exit 0 / 1761 test (+7). Binding `~/todos/sec5.md`.
- [ ] **SEC5-parte2** (leva utente): lookup ASN su `http://` (`proxyQualityChecker.ts:210`) → MITM spoofa DC→residential. Fix = ip-api su HTTPS, richiede **piano provider Pro** = leva utente. Tracciato in `user-actions-pending.md`.

## P2 — architettura / test / igiene (medium/low, dal report originale — NON ri-verificati nel fan-out)
- [ ] God-functions: `salesNavigatorSync` ~1197, `scheduler.ts` 1059, `bulkSaveOrchestrator.ts` 1840; 84 file >300 righe.
- [ ] Test mancanti action worker ban-critical: `inviteWorker`/`messageWorker`/`acceptanceWorker` (mockati), `humanBehavior`, `auth.ts`.
- [ ] N+1 query per-lead scheduler; execSync compile C# blocca event loop; dead code `missclick`.
- [ ] 142 medium + 66 low → triage dal report (non urgente).

## Note storiche (pre-riconciliazione)
- `[x]` GDPR `lead_enrichment_data` → DONE `4877b82` (poi esteso da goal gdpr-erasure-cloud 2026-06-12).
- `[x]` createProfile IP diretto → DONE (gate AB-24 ora fail-closed per tutti i comandi, `df91413`).
- Verdetti completi con evidenza: output `wf_fd9ac448-584`.
