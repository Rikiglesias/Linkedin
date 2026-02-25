# Security & Privacy Hardening

## What is already hardened
- No stealth/evasion browser plugins in runtime dependencies.
- No fingerprint-evasion runtime patch injected into browser pages.
- Automatic pause/quarantine on risk bursts.
- Sensitive log redaction (`token`, `key`, `cookie`, JWT-like values).
- Local session and DB storage created with private-permission best effort.
- Privacy retention cleanup command to reduce stored historical data.
- AI integration is fail-safe: if AI API fails, bot falls back to local template/heuristics.

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
