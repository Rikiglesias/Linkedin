# Security & Privacy Hardening

> Stato documento: documento canonico di hardening, privacy, controlli e routine di sicurezza.
> Per il threat model formale usare `THREAT_MODEL.md`.
> Per la parte anti-ban orientata all'operatore usare `GUIDA_ANTI_BAN.md`.

## What is already hardened
- Browser stealth layer: 19 runtime patches in `stealthScripts.ts` (WebRTC kill, navigator normalization, plugins mock, headless guards, battery/audio/WebGL spoofing, CDP leak prevention, font enumeration defense, platform consistency for iPhone/Android). Firefox UA gets Firefox-appropriate patches (no Chrome plugins/window.chrome). Patches are configurable: `STEALTH_SKIP_SECTIONS` disables specific sections, `CLOAKBROWSER_ENABLED` delegates to binary-level stealth. Canvas/WebGL noise is deterministic per fingerprint via PRNG Mulberry32 with per-region seed. Audio noise uses pseudo-random sample selection (not fixed interval).
- Fingerprint deterministic selection: same account gets same fingerprint (UA, viewport, WebGL renderer, canvas noise) for ~1 week, then rotates automatically. No random variation between sessions.
- Automatic pause/quarantine on risk bursts.
- Sensitive log redaction (`token`, `key`, `cookie`, JWT-like values).
- Local session and DB storage created with private-permission best effort.
- Privacy retention cleanup command to reduce stored historical data.
- AI integration is fail-safe: if AI API fails, bot falls back to local template/heuristics.
- Security audit trail for critical operations (auth, controls, incidents).
- Secret rotation inventory with CLI governance commands.
- Per-account health snapshots for multi-account runtime.
- PostgreSQL transactions atomiche via `AsyncLocalStorage`: tutte le query in una transazione usano lo stesso client PG. SQLite supporta nested transactions via SAVEPOINT.
- JA3/TLS coherence: fingerprint pool filtrato per coerenza UA↔TLS quando CycleTLS non è attivo. Con CycleTLS, JA3 spoofing reale per ogni browser family.
- IP reputation pre-check via AbuseIPDB: proxy con IP blacklisted scartati prima del lancio browser. Cache 24h per IP.
- SQLite disk space guard: `checkDiskSpace()` al boot e ad ogni ciclo workflow. Sotto 100MB → pausa automazione + alert Telegram.
- daily_stats per-account (migration 055): budget giornaliero isolato per account in setup multi-account.
- Cloud lead sync con outbox fallback: se il sync diretto fallisce, l'evento viene salvato nella outbox per retry automatico.

## Data Privacy & AI Exposure

Il sistema integra l'AI (OpenAI GPT-5.4 o Ollama) per diverse funzionalità. È fondamentale capire **quali dati** vengono esposti a provider esterni quando si usa l'API Cloud (OpenAI):

| Flusso | Dati inviati a OpenAI (Cloud) | Dati trattenuti localmente |
|--------|------------------------------|----------------------------|
| **Lead Scoring** | Nome, Qualifica/Headline, Nome Azienda target. | Email, Telefono, Location, Profilo completo. |
| **Data Cleaning** | Nome grezzo, Qualifica, Azienda, URL profilo. | - |
| **Note Invito** | Nome, Azienda, Qualifica, estratti "About" e "Experience". | - |
| **Messaggi / Follow-up** | Nome, Azienda, Qualifica. | Email, Telefono. |
| **Sentiment Analysis** | Testo del messaggio ricevuto dal lead. | Identità del mittente. |
| **AI Guardian** | Statistiche di rischio aggregate (es. *pending ratio: 0.5*). | Nessun dato personale (PII). |

**Mitigazioni Privacy:**
1. I dati vengono inviati all'AI solo "just-in-time" durante il task specifico.
2. Contatti diretti (email, telefono raccolti da Apollo/Hunter) **non vengono mai inviati a OpenAI**.
3. OpenAI Enterprise (API) ha una policy di **zero data retention** per l'addestramento dei modelli (i dati inviati non vengono usati per trainare GPT).
4. `VISION_REDACT_SCREENSHOTS=true` offusca informazioni sensibili negli screenshot prima di inviarli al Vision provider (per CAPTCHA).

## Threat model
- Full model: [THREAT_MODEL.md](/c:/Users/albie/Desktop/Programmi/Linkedin/THREAT_MODEL.md)
- Review cadence: weekly checks + monthly update + post-incident review.

## Security advisor periodico
- Esecuzione manuale:
  - `.\bot.ps1 security-advisor`
- Opzioni utili:
  - `.\bot.ps1 security-advisor --by monthly_review --report-dir data/security-advisor`
  - `.\bot.ps1 security-advisor --no-persist-flags`
- Scheduling automatico:
  - `run-loop` esegue il controllo in base a `SECURITY_ADVISOR_INTERVAL_DAYS`.
- Configurazione:
  - `SECURITY_ADVISOR_ENABLED`
  - `SECURITY_ADVISOR_INTERVAL_DAYS`
  - `SECURITY_ADVISOR_DOC_MAX_AGE_DAYS`
  - `SECURITY_ADVISOR_AUDIT_LOOKBACK_DAYS`
  - `SECURITY_ADVISOR_MIN_AUDIT_EVENTS`

## Daily operator workflow
1. `.\bot.ps1 doctor`
2. `.\bot.ps1 status`
3. Run jobs only if `sessionLoginOk=true`, `quarantine=false`, `pause.paused=false`.

## Emergency controls
- Pause immediately: `.\bot.ps1 pause 180 suspicious_activity`
- Resume: `.\bot.ps1 resume`
- Remove quarantine after manual checks: `.\bot.ps1 unquarantine`
- Inspect incidents: `.\bot.ps1 incidents`
- Resolve incident: `.\bot.ps1 incident-resolve <id>`

## Incident response playbook (severity-based)

### Severity and SLA
| Severity | Typical trigger | First response SLA | Throughput policy |
|---|---|---|---|
| `SEV-1` | security event, secret leak, unauthorized access suspicion | <= 15 min | Immediate pause + quarantine until closure criteria pass |
| `SEV-2` | sync disruption, repeated circuit-open, sustained error burst | <= 60 min | Backpressure mode + partial pause on impacted flows |
| `SEV-3` | localized regression or non-critical degradation | <= 4 h | Continue with guarded throughput and active monitoring |

### Ownership model
| Area | Primary owner | Backup owner |
|---|---|---|
| Runtime/jobs/queue | Platform | Operations |
| Cloud sync/integrations | Integrations | Platform |
| Security/compliance | Security | Platform |

### Execution checklist
1. Detect and classify severity (`doctor`, `status`, `diagnostics`, `/api/observability`).
2. Contain (`pause`, optional `unquarantine` only after remediation).
3. Preserve evidence (incident record, correlation IDs, relevant logs/audit rows).
4. Remediate root cause (config fix, dependency patch, selector/runtime fix, secret rotation if needed).
5. Recover with controlled ramp (validate SLO/risk/backlog before full speed).
6. Close incident with postmortem and update of `THREAT_MODEL.md` / `SECURITY.md` / tests.

### Exit criteria before `resume`
- `.\bot.ps1 doctor` without critical failures.
- `.\bot.ps1 diagnostics --sections health,queue,sync,selectors` shows no critical alert.
- Integration path stable (`circuitBreakers` not stuck open, backpressure trending down).
- If secrets were involved: rotation completed and inventory updated (`.\bot.ps1 secrets-status`).

## Secret leak response checklist
1. Stop automation immediately: `.\bot.ps1 pause 180 secret_leak_response`.
2. Identify scope: which secret, where it leaked (repo, logs, CI, chat, screenshot), first exposure timestamp.
3. Revoke and rotate affected credentials (`OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, webhook secrets, proxy credentials, dashboard keys/passwords).
4. Replace all leaked values in local `.env`, then verify no secret files are tracked: `git ls-files .env .env.* *.bak`.
5. If a secret was committed, remove it from git history and invalidate old credentials before any new deployment.
6. Review audit logs (provider + application) for suspicious activity between exposure and rotation.
7. Resume only after `doctor/status` checks and post-rotation validation pass.

## Secret rotation governance
- Show current rotation posture:
  - `.\bot.ps1 secrets-status`
- Register a completed rotation:
  - `.\bot.ps1 secret-rotated --name OPENAI_API_KEY --owner platform --expires-days 90 --notes "quarterly rotation"`
- Control thresholds in `.env`:
  - `SECURITY_SECRET_MAX_AGE_DAYS`
  - `SECURITY_SECRET_WARN_DAYS`

## Privacy retention
- Default retention from `.env` via `RETENTION_DAYS` (recommended: `45`).
- Cleanup old operational data:
  - `.\bot.ps1 privacy-cleanup`
  - `.\bot.ps1 privacy-cleanup --days 30`

This cleanup removes only old operational history (`run_logs`, `job_attempts`, `lead_events`, `message_history`, delivered `outbox_events`, resolved incidents).  
It does not delete active leads/jobs.

## Host machine recommendations
- Keep OS and browser updated automatically.
- Use full-disk encryption (BitLocker on Windows).
- Keep a dedicated OS user profile for automation.
- Use a password manager and enable 2FA on LinkedIn and email.
- Restrict remote-access software and unknown browser extensions.

## Dashboard auth bootstrap warning
- The dashboard supports session bootstrap via URL query string (`?api_key=...`). The API key transits in the URL and may be captured by browser history, server access logs, or referer headers. After bootstrap, the key is removed from the URL via `history.replaceState` and a session cookie is created.
- **Recommendation**: use this method only on localhost or trusted networks. For remote access, prefer direct API key header (`x-api-key`) or Basic auth. A form-based login page is planned for a future release.

## AI key hygiene (if enabled)
- Keep `OPENAI_API_KEY` only in local `.env` (never in repository files).
- Rotate key periodically and after any suspected leak.
- **Current deployment**: `AI_PERSONALIZATION_ENABLED=true`, `AI_GUARDIAN_ENABLED=true`, `AI_SENTIMENT_ENABLED=true`, `AI_ALLOW_REMOTE_ENDPOINT=true` with OpenAI GPT-5.4. The `AI_ALLOW_REMOTE_ENDPOINT` flag serves as a guardrail: set to `false` to force Ollama-only local AI. Green mode model (`AI_GREEN_MODEL`) uses Ollama when available.

## Database guardrail
- SQLite is blocked in `NODE_ENV=production` unless `ALLOW_SQLITE_IN_PRODUCTION=true` is set explicitly.
- Recommended production target: PostgreSQL with encrypted storage and managed backups.

## Dependency note
`npm audit` currently reports high advisories related to `sqlite3` build-chain dependencies (`node-gyp` / `tar`) during install tooling.  
The runtime currently requires `sqlite3`; monitor upstream advisories and patch quickly when a safe upgrade path appears.

## Plugin policy (mandatory)
- Every plugin file must have a sibling manifest `<plugin>.manifest.json` with: `name`, `version`, `entry`.
- `PLUGIN_DIR` must stay inside `PLUGIN_DIR_ALLOWLIST` (default `./plugins` only).
- Symlinked plugin files are blocked.
- If `integritySha256` is present in manifest, loader verifies file hash before load.
- Optional `allowedHooks` in manifest restricts which plugin hooks can be exposed.
- TypeScript plugins require explicit opt-in: `PLUGIN_ALLOW_TS=true`.

## Observability and traceability
- API responses expose `x-correlation-id`; provide your own header (`x-correlation-id`) to preserve end-to-end trace.
- Operational telemetry is available via `GET /api/observability` (queue lag, run errors, selector failures, challenge count, lock contention, threshold alerts).
- Outbox events inherit correlation id when available to support cross-system incident tracing.
- Security/governance telemetry:
  - `GET /api/security/audit`
  - `GET /api/accounts/health`
  - `GET /api/backups`

## Runtime model (compiled JS only)
- Production execution model is aligned on compiled output (`dist/`), not `ts-node`.
- Build both backend and dashboard frontend assets with `npm run build` before `npm start` / PM2 startup.
- PM2 runs `dist/index.js` (`run-loop`) via `ecosystem.config.cjs`.
- Dashboard frontend is served from local compiled assets (`/public/assets`) with strict CSP (`script-src 'self'`, `style-src 'self'`). Chart.js is bundled locally via esbuild (no CDN external).
- Dashboard session TTL: 12 hours (`DASHBOARD_SESSION_TTL_MS`), sliding window refreshed on each authenticated request. Sessions stored server-side in DB with SHA-256 hashed token. Brute-force lockout: 5 failures in 15 min → 30 min lockout.
- Export endpoints (`/api/export/*`, `/api/v1/export/*`) are rate-limited to 5 requests/hour and require authentication.
