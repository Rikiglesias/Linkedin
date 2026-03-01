# Security & Privacy Hardening

## What is already hardened
- No stealth/evasion browser plugins in runtime dependencies.
- No fingerprint-evasion runtime patch injected into browser pages.
- Automatic pause/quarantine on risk bursts.
- Sensitive log redaction (`token`, `key`, `cookie`, JWT-like values).
- Local session and DB storage created with private-permission best effort.
- Privacy retention cleanup command to reduce stored historical data.
- AI integration is fail-safe: if AI API fails, bot falls back to local template/heuristics.
- Security audit trail for critical operations (auth, controls, incidents).
- Secret rotation inventory with CLI governance commands.
- Per-account health snapshots for multi-account runtime.

## Threat model
- Full model: [THREAT_MODEL.md](/c:/Users/albie/Desktop/Programmi/Linkedin/THREAT_MODEL.md)
- Review cadence: weekly checks + monthly update + post-incident review.

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

## AI key hygiene (if enabled)
- Keep `OPENAI_API_KEY` only in local `.env` (never in repository files).
- Rotate key periodically and after any suspected leak.
- Keep `AI_PERSONALIZATION_ENABLED=false` / `AI_GUARDIAN_ENABLED=false` until dry-run validation is complete.
- Keep `AI_ALLOW_REMOTE_ENDPOINT=false` for local-first AI and explicit privacy control.
- If you need cloud AI (`api.openai.com`), set `AI_ALLOW_REMOTE_ENDPOINT=true` intentionally.

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
- Dashboard frontend is served from local compiled assets (`/public/assets`) with strict CSP (`script-src 'self'`, `style-src 'self'`).
