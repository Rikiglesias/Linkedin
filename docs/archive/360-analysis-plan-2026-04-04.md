# Piano d'azione — Analisi 360° Codebase (2026-04-04)

> Stato documento: archivio storico.
> Generato da analisi parallela del 2026-04-04. Non usare come backlog operativo corrente: per quello usare `todos/active.md`, `todos/workflow-architecture-hardening.md` e `docs/tracking/ENGINEERING_WORKLOG.md`.

Generato da analisi con 10 agent paralleli che hanno coperto l'intera codebase.
Ogni fix include il blast radius reale mappato dall'agent cross-domain.

**Regola operativa:** chiudere sempre i fix in ordine di fase. Non iniziare la Fase 1 senza aver completato la Fase 0.
Dopo ogni blocco: aggiornare [ENGINEERING_WORKLOG.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/tracking/ENGINEERING_WORKLOG.md) e fare commit atomico.

---

## FASE 0 — Quick wins (blast radius zero/minimo, ~3 ore totali)

> Tutti i fix di questa fase toccano al massimo 1-2 file. Nessun rischio di regressione su TypeScript.

### Docker / Infrastruttura

- [ ] **`docker-compose.yml`** — PostgreSQL porta `"5432:5432"` → `"127.0.0.1:5432:5432"` (DB pubblico su tutte le interfacce)
- [ ] **`docker-compose.yml`** — n8n porta `"5678:5678"` → `"127.0.0.1:5678:5678"` (basic auth non è sufficiente su porta pubblica)
- [ ] **`docker-compose.yml`** — Rimuovere volumi `./.env:/app/.env` da `bot-api` e `bot-worker` (doppio mount ridondante — env_file è già sufficiente)
- [ ] **`docker-compose.yml`** — `n8nio/n8n:latest` → `n8nio/n8n:1.87.0` (o ultima versione stabile pinned)
- [ ] **`docker-compose.yml`** — Aggiungere healthcheck a `bot-worker` (attualmente nessuno — crash silenziosi non rilevati da Docker)

### Sicurezza / Telemetria

- [ ] **[`src/telemetry/logger.ts:44`](C:/Users/albie/Desktop/Programmi/Linkedin/src/telemetry/logger.ts)** — `captureError(event, payload)` invia payload RAW a Sentry prima della sanitizzazione. Spostare la chiamata dopo la riga che calcola `safePayload` e passare `safePayload`. Se un errore contiene cookie o API key, arriva in chiaro su Sentry.

### CI/CD

- [ ] **[`.github/workflows/ci.yml`](C:/Users/albie/Desktop/Programmi/Linkedin/.github/workflows/ci.yml)** — Aggiungere step in `quality-fast`:
  ```yaml
  - name: Circular deps check
    run: npx madge --circular --extensions ts src/
  ```
  La regola "zero circular deps" è in `decisions.md` ma mai verificata in CI.

### Anti-ban / Fingerprint

- [ ] **[`src/browser/stealth.ts:63,108`](C:/Users/albie/Desktop/Programmi/Linkedin/src/browser/stealth.ts)** — Rimuovere fallback `'it-IT'` hardcoded da `normalizeCloudFingerprint`. Sostituire con: `cloudFingerprint.locale ?? proxyCountryToLocale(proxyCountry) ?? config.browserLocale`. La geo lookup del proxy è già in `proxyQualityChecker.ts`. Il mobile pool è 100% `it-IT` — con proxy tedesco il mismatch IP/lingua è rilevabile da LinkedIn.
  - Blast radius: 1 file, funzione privata, zero propagazione.

### Database / Migrazioni

- [ ] **[`src/db/migrations/055_daily_stats_account_id.sql`](C:/Users/albie/Desktop/Programmi/Linkedin/src/db/migrations/055_daily_stats_account_id.sql)** — Rendere idempotente: aggiungere `IF NOT EXISTS` su `CREATE TABLE daily_stats_new`, sostituire `DROP TABLE daily_stats` con `DROP TABLE IF EXISTS daily_stats`. Se eseguita due volte (crash a metà + riavvio) distrugge i dati.
  - Blast radius: 1 file SQL. Nessun TS da modificare.

### Workers / Retry

- [ ] **[`src/workers/errors.ts`](C:/Users/albie/Desktop/Programmi/Linkedin/src/workers/errors.ts)** — Aggiungere entry nel `RETRY_POLICY_BY_CODE`:
  ```typescript
  INVITE_MODAL_NOT_FOUND: { retryable: false, maxAttempts: 1, category: 'structural' }
  ```
  Attualmente cade nel fallback `retryable: true` con fino a 20 tentativi — consuma budget giornaliero su un errore strutturale (LinkedIn ha cambiato layout, non si recupera con retry).
  - Blast radius: 1 file + 3 test da verificare (`unit.vitest.ts`, `integrationSanity.vitest.ts`, `workerResultAndErrors.vitest.ts`).

### Indici DB

- [ ] **Nuova migration `059_indexes.sql`** — Aggiungere indice su `leads.updated_at`:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_leads_updated_at
      ON leads(updated_at DESC) WHERE updated_at IS NOT NULL;
  ```
  Usato da `recoverStuckAcceptedLeads`, `runPrivacyCleanup`, `listCompanyTargets` senza indice → full table scan su tabella grande.

### SSE / API

- [ ] **[`src/api/server.ts:775`](C:/Users/albie/Desktop/Programmi/Linkedin/src/api/server.ts)** — Aggiungere cap massimo connessioni SSE simultanee (50-100). Senza cap, apertura massiva di connessioni = DoS. Aggiungere check `if (getLiveEventSubscribersCount() >= 50) return res.status(429)...` prima di registrare il listener.

---

## FASE 1 — Sicurezza e resilienza (~10 ore)

> Blast radius basso/medio. Ogni fix tocca 1-4 file. Verificare test dopo ogni blocco.

### Frontend / Sicurezza UI

- [ ] **[`src/frontend/renderers.ts:692-699`](C:/Users/albie/Desktop/Programmi/Linkedin/src/frontend/renderers.ts)** — XSS via `innerHTML` in `renderLeadDetail`. I campi `lead.linkedin_url`, `lead.account_name`, `lead.job_title`, `lead.email` vengono interpolati senza sanitizzazione. Sostituire con DOM API (`createElement`, `textContent`, `setAttribute`).
  - Verificare anche `main.ts`, `leadSearch.ts`, `dom.ts` per pattern analoghi.
  - Blast radius: 1 file diretto + 3 frontend da ispezionare.
- [ ] **[`src/frontend/main.ts:456`](C:/Users/albie/Desktop/Programmi/Linkedin/src/frontend/main.ts)** — Sostituire `confirm()` bloccante con `<dialog>` personalizzato. Già esistono `pause-modal` e `login-modal` nel progetto — creare un `ConfirmDialog` generico riutilizzabile con colore configurabile per severity.

### Auth / TOTP

- [ ] **[`src/api/server.ts:713-728`](C:/Users/albie/Desktop/Programmi/Linkedin/src/api/server.ts)** — TOTP senza brute-force protection: 7.200 tentativi/ora possibili. Aggiungere lockout IP dopo 5 tentativi consecutivi falliti (15 min ban). Pattern: `Map<ip, {count, lockedUntil}>` nel middleware auth. Oppure applicare il `controlsLimiter` (10 req/min) già esistente su `/api/auth/session`.

### Config

- [ ] **[`src/config/hotReload.ts`](C:/Users/albie/Desktop/Programmi/Linkedin/src/config/hotReload.ts)** — Dopo ogni reload config, chiamare `validateConfigFull(config)` e se ci sono errori fare `broadcastWarning` + `logWarn`. Attualmente una config invalida viene caricata silenziosamente senza nessuna notifica.

### Core / Stato persistente

- [ ] **[`src/core/jobRunner.ts:173`](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/jobRunner.ts)** — Il `Map _challengeCheckInProgress` non sopravvive ai riavvii PM2. Dopo crash durante challenge: doppi alert Telegram + doppia pausa. Sostituire con `getRuntimeFlag`/`setRuntimeFlag` (già disponibili nel barrel) con chiave `challenge_in_progress:${accountId}` e TTL 5 minuti.
  - Blast radius: 1 file. Nessuna migration necessaria — `runtime_flags` esiste già.

### Cloud / Sync

- [ ] **[`src/cloud/cloudBridge.ts`](C:/Users/albie/Desktop/Programmi/Linkedin/src/cloud/cloudBridge.ts)** — Rimuovere `Date.now()` dalle chiavi idempotency outbox. Le chiavi devono essere deterministiche rispetto all'evento: `cloud.lead.status:${linkedinUrl}:${status}` senza timestamp. Attualmente la stessa operazione può accumularsi N volte nell'outbox generando duplicati di eventi cloud.
- [ ] **[`src/cloud/supabaseDataClient.ts:286-298`](C:/Users/albie/Desktop/Programmi/Linkedin/src/cloud/supabaseDataClient.ts)** — `syncSalesNavMembersToCloud` rilegge sempre gli stessi 500 record senza marcare quelli già sincronizzati. Aggiungere colonna `synced_at` a `salesnav_list_members` e filtrare `WHERE synced_at IS NULL OR synced_at < datetime('now', '-1 hour')`.
- [ ] **Nuova migration `060_outbox_ttl.sql`** — Aggiungere colonna `expires_at` alla tabella `outbox_events` (default `now + 72h`). Aggiungere job di cleanup periodico nel loop: `DELETE WHERE expires_at < NOW()`. Previene SQLite unbounded growth con Supabase down 24h+ (stima: 50.000+ righe in outreach intenso).
- [ ] **Automation commands recovery** — In `loopCommand.ts` o `automationCommands.ts`, aggiungere recovery all'avvio:
  ```sql
  UPDATE automation_commands
     SET status = 'FAILED', last_error = 'recovered:crash', finished_at = CURRENT_TIMESTAMP
   WHERE status = 'RUNNING' AND started_at < datetime('now', '-30 minutes')
  ```
  Tracciato in `workflow-architecture-hardening.md` come item noto ma mai implementato.

### Supabase / Database

- [ ] **Supabase schema** — Riabilitare RLS su tutte le tabelle con policy `USING (auth.role() = 'service_role')`. Attualmente `disable row level security` su tutto — se la `anon key` viene esposta, accesso completo a tutti i dati senza restrizioni.

---

## FASE 2 — Correttezza e qualità (~8 ore)

> Blast radius medio. Alcuni fix toccano la logica di business critica — verificare test prima e dopo.

### Core / Race conditions

- [ ] **[`src/workers/inviteWorker.ts:567,624,654,714`](C:/Users/albie/Desktop/Programmi/Linkedin/src/workers/inviteWorker.ts)** — Rendere atomico il check+increment del cap giornaliero con transazione SQLite. Il `.catch(() => {})` silente sul decremento compensativo va sostituito con `logWarn` — se fallisce il contatore rimane gonfio e blocca i job successivi ingiustamente.

### Anti-ban / Timing

- [ ] **[`src/browser/humanClick.ts:22`](C:/Users/albie/Desktop/Programmi/Linkedin/src/browser/humanClick.ts)** — `waitForTimeout(30)` fisso → `waitForTimeout(20 + Math.floor(Math.random() * 20))`. Inter-evento mousedown→click costante è rilevabile. Stessa varianza da aggiungere in `bulkSavePagination.ts` (200ms, 500ms, 30ms fissi).
- [ ] **[`src/workers/postCreatorWorker.ts:113,128`](C:/Users/albie/Desktop/Programmi/Linkedin/src/workers/postCreatorWorker.ts)** e **[`src/workers/batchAcceptanceChecker.ts:93`](C:/Users/albie/Desktop/Programmi/Linkedin/src/workers/batchAcceptanceChecker.ts)** — Sostituire `locator.click()` nativo con `clickLocatorHumanLike`. Il click nativo genera `isTrusted: false` nel DOM — LinkedIn può rilevarlo con `addEventListener('click', e => e.isTrusted)`.

### Risk Engine

- [ ] **[`src/risk/riskEngine.ts:27-31`](C:/Users/albie/Desktop/Programmi/Linkedin/src/risk/riskEngine.ts)** — Spostare i pesi della formula di scoring in config:
  ```
  riskWeightErrorRate: 40
  riskWeightSelectorFailure: 20
  riskWeightPendingRatio: 25
  riskWeightChallengeCount: 10
  riskWeightInviteVelocity: 15
  ```
  Attualmente hardcoded — se LinkedIn cambia detection pattern serve un deploy per ricalibrarli.
  - Blast radius: `riskEngine.ts` + `config/domains.ts` + `config/validation.ts`.
- [ ] **[`src/risk/riskEngine.ts:405`](C:/Users/albie/Desktop/Programmi/Linkedin/src/risk/riskEngine.ts)** — Soglia acceptance 40% hardcoded in `estimateBanProbability` → aggiungere `config.riskBanAcceptanceThresholdPct` con default 40.

### Database / Query

- [ ] **[`src/core/salesNavigatorSync.ts:315`](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/salesNavigatorSync.ts)** — N+1 in `postSyncEnrichment`: 200 lead = 600+ SELECT singoli. Sostituire con batch fetch:
  ```typescript
  const allLeads = await getLeadsByIds(leadIds);
  const leadMap = new Map(allLeads.map(l => [l.id, l]));
  ```

### Config / Telemetria

- [ ] **[`src/config/featureFlags.ts`](C:/Users/albie/Desktop/Programmi/Linkedin/src/config/featureFlags.ts)** — Aggiungere cache in-memory con TTL 10 secondi per `isFeatureEnabled`. Pattern: `Map<flagName, {value, expiresAt}>`. `setFeatureFlag` invalida la cache per quella chiave. Attualmente: 1 query DB per flag per job → overhead in run-loop intensi.
- [ ] **[`src/telemetry/`](C:/Users/albie/Desktop/Programmi/Linkedin/src/telemetry/)** — Estrarre rate limiter Telegram in modulo condiviso `telemetry/telegramRateLimiter.ts`. Importato da `alerts.ts` e `broadcaster.ts`. Attualmente due rate limiter separati possono entrambi floodare Telegram in cascading failure.

---

## FASE 3 — Refactoring strutturale (piano dedicato, ~1-2 settimane)

> Blast radius alto. Richiedono un piano dettagliato, typecheck completo e test di regressione.
> Non iniziare senza aver chiuso le fasi 0-2.

### Monoliti da splittare

- [ ] **[`src/core/jobRunner.ts`](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/jobRunner.ts)** — 1339 righe, unico consumer: `orchestrator.ts`. Split proposto:
  - `core/accountHealthTracker.ts` — metriche e alert account
  - `core/browserSessionManager.ts` — lifecycle browser per account (open/close/rotate)
  - `core/accountSessionState.ts` — struttura esplicita con metodi `rotate()`, `windDown()`, `abort()`
  - `jobRunner.ts` rimane solo il loop di dispatch

- [ ] **[`src/browser/humanBehavior.ts`](C:/Users/albie/Desktop/Programmi/Linkedin/src/browser/humanBehavior.ts)** — 1423 righe, **25 consumer cross-domain**. Split proposto (le API pubbliche NON cambiano — barrel re-export obbligatorio):
  - `browser/decoyActions.ts` — 4 decoy actions (~150 righe)
  - `browser/typingSimulator.ts` — typing + typo injection
  - `browser/mouseMovement.ts` — Bézier + WeakMap state
  - `browser/humanDelay.ts` — delay log-normale + reading scroll
  - Typecheck obbligatorio su tutti i 25 consumer dopo ogni split.

- [ ] **[`src/core/repositories/leadsCore.ts`](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories/leadsCore.ts)** — 1417 righe, **49 consumer indiretti via barrel**. Split proposto:
  - `repositories/leadsQuery.ts` — tutte le SELECT
  - `repositories/leadsMutation.ts` — INSERT/UPDATE/DELETE
  - `repositories/leadsStatusOps.ts` — transizioni di stato + conteggi
  - **ATTENZIONE**: il barrel `repositories/leads.ts` deve continuare a re-esportare le stesse funzioni con gli stessi nomi. I 3 consumer diretti (`inviteWorker`, `leadStateService`, `messagePrebuildWorker`) vanno aggiornati esplicitamente.

- [ ] **[`src/api/server.ts`](C:/Users/albie/Desktop/Programmi/Linkedin/src/api/server.ts)** — 969 righe. Split proposto (blast radius basso — importato solo da `index.ts`):
  - `api/middleware/auth.ts` — TOTP + session cookie
  - `api/middleware/cors.ts` + `api/middleware/rateLimiter.ts`
  - `api/websocket.ts` — WebSocket + SSE handler
  - `server.ts` rimane solo come composer di middleware + route mounting

### Decisioni strategiche da prendere

- [ ] **`src/frontend/` vs `dashboard/`** — Decidere se tenere il frontend vanilla TypeScript (~2500 righe) o migrare tutto a Next.js. Non tenere codice in stato ambiguo. Se Next.js è la strada: marcare `src/frontend/` come `@deprecated` e aprire ticket di migrazione.
- [ ] **JA3 spoofing** — Il sistema documenta il gap (UA Firefox + TLS Chromium = rilevato) ma non lo blocca. Valutare integrazione CycleTLS o migrazione a Camoufox per sessioni LinkedIn production.
- [ ] **AB bandit decay** — Le statistiche `ab_variant_stats` crescono indefinitamente. Aggiungere lookback window (es. ultimi 90 giorni) per evitare che varianti vecchie abbiano peso su campagne nuove.

---

## Riferimenti rapidi

| File | Consumer diretti | Note |
|------|-----------------|------|
| `src/config/index.ts` | 111 | Non toccare senza grep preventiva su ogni chiave |
| `src/db.ts` | 57 | Cambio interfaccia rompe tutti i repository |
| `src/core/repositories.ts` | 49 | Barrel critico — rimozione export rompe metà progetto |
| `src/browser/humanBehavior.ts` | 25 | Cross-domain — barrel re-export obbligatorio in caso di split |
| `src/workers/errors.ts` | 4 | File più sicuro da modificare |
