# Audit Completo Codebase — Verifica TODO + Livelli L1-L6

Audit read-only completo della codebase, verificando ogni claim delle TODO con evidenze reali e applicando i livelli L1-L6 pertinenti, per produrre un report finale con gap, rischi e falsi completamenti.

---

## Perimetro
- **Sorgente attivo**: `src/`, `scripts/`, `plugins/`, `public/`, config root, Docker, PM2, CI.
- **Documentazione e TODO**: `TODO_MIGLIORAMENTI.md`, `docs/archive/TODO.md`, `docs/archive/AUDIT_COMPLETAMENTI_2026.md`, `README.md`, `SECURITY.md`, `THREAT_MODEL.md`, `GUIDA_ANTI_BAN.md`, `docs/*`.
- **Storico e derivati**: `docs/archive/`, `data/`, `public/assets/`, backup/restore, bundle e sourcemap — evidenza secondaria, non fonte autorevole.

## Fonti TODO
| Fonte | Contenuto | Punti |
|---|---|---|
| `TODO_MIGLIORAMENTI.md` | 16 sezioni — il TODO attivo | ~150 |
| `docs/archive/TODO.md` | 12 sezioni — legacy 100% completato | 179 |
| `docs/archive/AUDIT_COMPLETAMENTI_2026.md` | P0-P5 — audit formale precedente | ~40 |

## Criteri di verità
- **Fonte primaria**: codice eseguibile, test, configurazione runtime, wiring reale tra moduli.
- **Fonte secondaria**: CI, script di qualità, documentazione operativa.
- **Fonte storica/derivata**: archivi, backup, asset generati.
- TODO marcata completata ma codice non la conferma → **falso completato** o **parzialmente completato**.
- Decisione marcata `NON ORA`, `RIMANDATA` o simili → distinta dai bug reali e dai claim tecnicamente falsi.

## Matrice di verifica per ogni item TODO
Per ogni voce rilevante l'audit produce:
- **Claim dichiarato** — cosa dice la TODO
- **File e prove** — evidenze nel codice
- **Stato reale**: `verificato` | `parziale` | `contraddetto` | `non verificabile senza runtime/manuale`
- **Livelli applicati**: L1-L6 solo se pertinenti
- **Rischio e priorità**
- **Consumatori impattati**
- **Gap tra documentazione e implementazione**

---

## Regola L1-L6 obbligatoria

La verifica non si ferma al "c'è il codice": ogni item TODO completato viene riesaminato con i livelli pertinenti.

### L1 — Compilazione e test
- Claim coerente con test, CI, build, quality gate.
- Gate diagnostici non distruttivi: `npm run pre-modifiche`, verifica CI, `npm run build` per claim frontend.

### L2 — Catene dirette
- Import→export→chiamata. Moduli citati davvero collegati e usati, non solo presenti.
- Barrel file, consumatori indiretti, type narrowing.

### L3 — Runtime profondo
- Edge case (NaN, null, [], ''), ordine esecuzione, sicurezza, performance, error handling.
- Check contestuali: browser/Playwright, DB, API, scheduler, stealth, worker.

### L4 — Ragionamento preventivo
- "E se fallisce a metà?" "E se chiamato 2 volte?" "E se dato nullo/sporco/incompleto?"
- Race condition, rollback mancanti, recovery parziali, assunzioni fragili.

### L5 — Visione prodotto
- Risultato promesso davvero visibile/utile all'utente?
- Feature tecnicamente presenti vs feature morte, semi-morte, non osservabili.

### L6 — Coerenza sistema e osservabilità
- Coerenza end-to-end: config→DB→API→frontend→report→logging→metriche→alert→documentazione.
- Claim incompleto se manca un anello essenziale della catena.

---

## Piano operativo — 18 Fasi

### FASE 0 — Baseline L1
- [ ] Eseguire `npm run pre-modifiche` (typecheck + lint + vitest)
- [ ] Registrare risultato: 0 errori/warning/test falliti = OK, altrimenti documentare

### FASE 1 — Security & Auth (CRITICA)
Punti TODO: regressione export auth, redaction, TOTP, risk explain, secret manager, session cookie, CSRF, CSP
- [ ] `src/security/redaction.ts` — SENSITIVE_KEYS regex, PHONE_PATTERN europeo, `credentials`
- [ ] `src/api/server.ts` — auth su `/api/v1/export`, session cookie flags, IP audit, CSP
- [ ] `src/security/totp.ts` — isTotpEnabled, validateTotpCode, generateTotpSecret
- [ ] `src/risk/riskEngine.ts` — explainRisk + endpoint `/api/risk/explain`
- [ ] `src/config/env.ts` — resolveSecret con Docker Secrets + path sanitization
- [ ] `src/api/routes/export.ts` — CSV formula injection, auth, rate limit, audit
- [ ] `src/security/filesystem.ts` — chmodSafe Windows
- [ ] L3: edge case null/injection | L4: "e se TOTP secret < 16 char?" | L5: utente capisce blocco

### FASE 2 — Anti-Detection & Stealth (CRITICA)
Punti TODO: fingerprint deterministico, canvas PRNG, WebGL pool, stealth scripts, Notification, fake storage, doppia patch WebGL
- [ ] `src/browser/stealthScripts.ts` — 19 mock, skip sections, sez.14 [RIMOSSO], sez.18 [RIMOSSO], Notification='default'
- [ ] `src/browser/stealth.ts` — pickBrowserFingerprint FNV-1a deterministico
- [ ] `src/browser/launcher.ts` — Mulberry32, WebGL 12 renderers, validateFingerprintConsistency, hwConcurrency
- [ ] `src/browser/humanBehavior.ts` — regex isSpaceOrPunctuation, VISUAL_CURSOR random, humanWindDown, typing speed, simulateTabSwitch
- [ ] `src/ml/mouseGenerator.ts` — Bézier cubica, noise multi-ottava, micro-tremori, Fitts's Law
- [ ] `src/browser/missclick.ts` — sistema missclick intelligente
- [ ] `src/fingerprint/pool.ts` + `noiseGenerator.ts` — consolidamento, noise dinamico
- [ ] `src/tests/stealth.vitest.ts` (16 test) + `fingerprint-coherence.vitest.ts` (14 test)
- [ ] L3: PRNG uniforme? Pattern rilevabile? | L4: fingerprint cambia a mezzanotte?

### FASE 3 — Worker Pipeline (ALTA)
Punti TODO: acceptance badge null, message hash, invite weekly limit, job type exhaustive, inbox, hygiene vision
- [ ] `src/workers/acceptanceWorker.ts` — isFirstDegreeBadge null, retry, transizione atomica
- [ ] `src/workers/messageWorker.ts` — template validation, hash duplicati, prebuilt lookup
- [ ] `src/workers/inviteWorker.ts` — weekly limit pre-check, confidence check, organic visit, visited Set
- [ ] `src/workers/inboxWorker.ts` — auto-reply gates, hash anti-dup, selettori, inbox monitoring
- [ ] `src/workers/hygieneWorker.ts` — vision fallback 3 fasi, visionFallbackUsed flag
- [ ] `src/core/jobRunner.ts` — exhaustive check, worker registry, session rotation, browser GC
- [ ] `src/workers/registry.ts` — 7 worker registrati
- [ ] `src/workers/errors.ts` — ACCEPTANCE_PENDING backoff lineare
- [ ] L3: race condition? | L4: "job 2 volte?", "badge mai carica?"

### FASE 4 — Database & Migrations (ALTA)
Punti TODO: pg_dump injection, VACUUM INTO, normalizeSqlForPg, profiling, migrations 036-054
- [ ] `src/db.ts` — RETURNING fix, normalizeSqlForPg, profileQuery, SQL cache LRU
- [ ] `scripts/backupDb.ts` — execFileSync, retention pg_backup_ pattern
- [ ] Contare migrazioni in `src/db/migrations/` — verificare 036-054
- [ ] `src/tests/dbCoherence.vitest.ts` — 12 test normalizzazione
- [ ] L3: transaction safety, WAL mode? | L4: "DB corrotto?" | L6: migration idempotente?

### FASE 5 — API & Server (ALTA)
Punti TODO: server split, routes estratte, health deep, Prometheus, rate limit, v1 auth
- [ ] `src/api/server.ts` — sotto 1000 righe, health/deep, /metrics, rate limit
- [ ] Routes: `stats.ts`, `ai.ts`, `security.ts`, `blacklist.ts`, `leads.ts`, `controls.ts`, `campaigns.ts`, `export.ts`
- [ ] Helpers: `controlActions.ts`, `requestIp.ts`, `audit.ts`
- [ ] L2: tutti endpoint hanno auth? | L5: feature accessibile da UI? | L6: endpoint morto?

### FASE 6 — Frontend & Dashboard (MEDIA)
Punti TODO: main.ts split, design tokens, Chart.js bundlato, data layer, toast, SW, session timer
- [ ] `src/frontend/main.ts` — sotto 600 righe, realtime.ts e leadSearch.ts estratti
- [ ] `public/style.css` — CSS custom properties, design tokens
- [ ] `public/index.html` — Chart.js NON da CDN, manifest PWA, widget IDs
- [ ] `src/frontend/apiClient.ts` — retry backoff, onAuthError, shimmer
- [ ] `public/sw.js` — cache separate, stale-while-revalidate, LRU 50 entry
- [ ] Build: `minify:true`, Chart.js non external
- [ ] L5: utente capisce stato? Responsive? | L6: dato arriva all'utente?

### FASE 7 — AI & Provider Strategy (MEDIA)
Punti TODO: providerRegistry, quality gates, local-first, GPT-5.4 vision hybrid
- [ ] `src/ai/providerRegistry.ts` — resolveAiProvider chain, green mode, remote endpoint
- [ ] `src/captcha/visionProviderFactory.ts` — HybridVisionProvider, singleton, budget
- [ ] `src/captcha/openaiVisionProvider.ts` — anomaly detection, code harness, contextual delay
- [ ] Quality gates: challenge cap 3/giorno, inbox auto-reply 5 gates
- [ ] L3: AI down → fallback template? | L4: budget exceeded → graceful degrade?

### FASE 8 — Config, Profiles & Validation (MEDIA)
Punti TODO: profili ambiente, validation cross-domain, .env.example
- [ ] `src/config/profiles.ts` — 3 profili, resolveConfigProfile, applyProfileDefaults
- [ ] `src/config/validation.ts` — softCap<=hardCap, timezone IANA, pendingDays>=1
- [ ] `src/config/domains.ts` — tone whitelist, pendingDays clamping
- [ ] `.env.example` — **MANCANTE**: verificare tutte le variabili dichiarate nelle TODO
- [ ] L6: nuova var .env documentata? Parsata? Validata?

### FASE 9 — Anti-Ban Operativo & Scheduler (ALTA)
Punti TODO: mood factor, ratio shift, weekly strategy, warmup, login jitter, maintenance, weekend
- [ ] `src/core/scheduler.ts` — mood factor FNV-1a, ratio shift, weekly strategy
- [ ] `src/core/sessionWarmer.ts` — getSessionWindow, budget 60/40, 2 sessioni
- [ ] `src/cli/commands/loopCommand.ts` — login jitter, maintenance 03-06, warmup task, privacy cleanup
- [ ] `src/browser/auth.ts` — probeLinkedInStatus, URL check completo
- [ ] `src/browser/sessionCookieMonitor.ts` — SHA-256 li_at, COOKIE_MISSING/CHANGED
- [ ] L3: overflow fattori? Budget negativo? | L4: weekNumber cambia a mezzanotte?

### FASE 10 — Integrazioni & Cloud Sync (MEDIA)
Punti TODO: Telegram persistence, CRM fix, circuit breaker, backpressure
- [ ] `src/cloud/telegramListener.ts` — singleton client, lastUpdateId persistito
- [ ] `src/integrations/crmBridge.ts` — POST HubSpot, Salesforce 400
- [ ] `src/core/integrationPolicy.ts` — circuit breaker persistenza, classifyError
- [ ] `src/sync/backpressure.ts` — livello persistito, batch dinamico
- [ ] L6: dato end-to-end arriva? Reversibilità?

### FASE 11 — DevOps, Docker & Observability (MEDIA)
Punti TODO: docker-compose split, Dockerfile USER, .dockerignore, .gitignore, PM2, Prometheus
- [ ] `docker-compose.yml` — bot-api+bot-worker, log rotation, PG password da .env
- [ ] `Dockerfile` — USER botuser
- [ ] `.dockerignore` — coverage, docs, IDE
- [ ] `.gitignore` — lint outputs, .claude, data/linkedin.db
- [ ] `ecosystem.config.cjs` — kill_timeout, pm2 in dependencies
- [ ] L6: osservabilità conferma funzionamento produzione?

### FASE 12 — Duplicazioni Risolte & Pulizia (BASSA)
Punti TODO: randomInt/randomElement unificati, cleanText, sleep, file morti
- [ ] `src/utils/random.ts` — randomInt, randomElement
- [ ] `src/utils/async.ts` — safeAsync, retryDelayMs, sleep
- [ ] `src/utils/text.ts` — cleanText, splitCsv
- [ ] File eliminati: emailEnricher.ts, searchExtractor.ts, compare_extras.js
- [ ] Consolidamento: `src/fingerprint/noiseGenerator.ts` (ex browser/fingerprint/pool.ts)
- [ ] L2: nessun import orfano? Barrel aggiornati?

### FASE 13 — CLI, Comandi & Workflow (BASSA)
Punti TODO: deprecati, help aggiornato, workflow production
- [ ] `src/index.ts` — 10 alias deprecati v2.0, help con db-analyze/daily-report/repl/warmup/dashboard
- [ ] SalesNav unification: `salesnav <subcommand>` router
- [ ] L5: utente capisce comandi?

### FASE 14 — Test & CI (ALTA)
Punti TODO: test splittati, security 56 test, e2e-api, e2e-dashboard, CI coverage
- [ ] Conteggio test totale (target: ~109+, file vitest: 11)
- [ ] `src/tests/security.vitest.ts` — 56 test state machine
- [ ] `src/tests/e2e-api.vitest.ts` — 3 test E2E
- [ ] `src/tests/e2e-dashboard.vitest.ts` — 5 test E2E
- [ ] `.github/workflows/ci.yml` — coverage 50%, dependabot, CodeQL
- [ ] L1: tutti i test passano? Coverage threshold?

### FASE 15 — Documentazione & Coerenza (BASSA)
Punti TODO: SECURITY.md, README, GUIDA_ANTI_BAN, CONFIG_REFERENCE
- [ ] `SECURITY.md` — 18 stealth patches, AI guardrail, auth bootstrap
- [ ] `README.md` — rollback docs, v2.0.0-beta.1, link a docs/
- [ ] `GUIDA_ANTI_BAN.md` — profilo caldo documentato
- [ ] `docs/CONFIG_REFERENCE.md` — variabili nuove presenti
- [ ] L6: documentazione coerente con implementazione?

### FASE 16 — Secondo sweep blind spot
Riesaminare le aree delle fasi precedenti solo mappate o lette parzialmente:
- [ ] Anti-ban: invarianti di varianza mantenute? Pattern non degradati?
- [ ] Threat model: `THREAT_MODEL.md` coerente con contromisure reali?
- [ ] Frontend reale: bundle generato corrisponde al sorgente?
- [ ] Test reali: conteggio vs claim (109+)? Tutti verdi?
- [ ] Deploy/container: Dockerfile+compose producono sistema funzionante?
- [ ] Item `parzialmente completato`, `non ora`, `rimandata`: debito documentato?

### FASE 17 — Coerenza documentazione vs implementazione
- [ ] README, SECURITY, THREAT_MODEL, CI non promettano cose smentite dal codice
- [ ] Distinguere promesse valide, claim parziali, documentazione obsoleta, mismatch reali

### FASE 18 — Report finale
- [ ] Matrice completa: claim, evidenze, livelli applicati, rischio, priorità, impatto
- [ ] Evidenziare: problemi critici, falsi completamenti, parti dichiarate chiuse ma parziali
- [ ] Elenco gap reali separato da debito tecnico noto e storico legacy

---

## Discrepanze pre-audit già trovate

### MANCANTE
1. **`.env.example` NON ESISTE** — File non presente nel filesystem. Molti TODO dichiarano variabili documentate lì (VISION_*, EMBEDDING_MODEL, TARGET_TIMEZONE, PROFILE_VIEW_DAILY_CAP). Tutti i riferimenti sono invalidati.

### DISCREPANZE
2. **`parseRollbackSnapshot` non estratta** — Presente solo in `selectors/learner.ts:99`, non in `shared.ts` come previsto (sez.10 TODO).
3. **`commandHelp.ts` incompleto** — `db-analyze`, `daily-report`, `repl` nel `printHelp()` inline ma non in `commandHelp.ts` dettagliato.
4. **`chmodSafe` Windows** — TODO diceva "usare icacls", implementazione fa solo `return`. Scelta intenzionale (commento spiega rischio ZERO ACLs).
5. **`db.ts` RETURNING default** — `options?.returning !== false` → true di default. TODO diceva "default false". Potenziale bug su PK composita.

### VERIFICHE POSITIVE (35+ punti confermati)
- **Security**: redaction.ts (Set + camelCase split, PHONE_PATTERNS multi-formato), totp.ts, filesystem.ts
- **Stealth**: stealthScripts.ts (Notification='default', sez.14/18 [RIMOSSO], _skip Set)
- **Fingerprint**: pool.ts FNV-1a, noiseGenerator.ts 10k valori, launcher.ts Mulberry32+WebGL 12
- **Workers**: registry.ts 7 worker, result.ts visionFallbackUsed, context.ts visitedProfilesToday
- **DB**: normalizeSqlForPg, profileQuery, SQL_CACHE_MAX=500, execFileSync pg_dump
- **API**: /api/v1/export CON auth, /api/health/deep, /metrics, /risk/explain, /risk/what-if
- **Anti-ban**: moodFactor FNV-1a, ratioShift, sessionWarmer 60/40, login jitter, maintenance 03-06
- **Mouse**: cubic Bézier, fractal noise 4 ottave, micro-tremori 8-12Hz, Fitts's Law
- **File eliminati**: emailEnricher.ts, searchExtractor.ts, compare_extras.js, src/services/, src/browser/fingerprint/
- **Docker**: bot-api+bot-worker, USER botuser, log rotation, PG password env, no version
- **CI**: coverage 50%, CodeQL SAST, Docker smoke test

---

## Regole di esecuzione
- **Nessuna modifica codice** in questa fase: solo letture, analisi e comandi diagnostici.
- **Zero assunzioni**: se un punto non è dimostrabile → `non verificabile`.
- **Approccio olistico**: ogni finding valutato per dipendenze, consumatori, performance, test, sicurezza, compatibilità, effetti collaterali.
- Intervento correttivo post-audit partirà da `npm run pre-modifiche`.

## Output atteso
- **Inventario sorgenti/TODO/docs** con priorità di audit.
- **Matrice di verifica TODO** completa, con livelli L1-L6 per item.
- **Secondo sweep documentato** delle aree inizialmente scoperte.
- **Findings P0/P1/P2** con prove concrete.
- **Elenco gap reali** separato da debito tecnico noto, storico legacy e output generati.
