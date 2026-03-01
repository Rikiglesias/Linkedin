# Threat Model (Web/API/Plugin/Cloud)

## Scope
- Dashboard/API (`/api/*`, SSE, session auth, control endpoints)
- Worker runtime (LinkedIn automation, scheduler, queue, multi-account execution)
- Plugin loader (`PLUGIN_DIR`, manifests, integrity checks)
- Cloud integrations (Supabase/Webhook/Telegram/OpenAI)
- Secrets handling (`.env`, provider keys, dashboard credentials)

## Trust Boundaries
- Browser <-> Dashboard API
- Runtime process <-> Database
- Runtime process <-> Third-party APIs
- Local plugin code <-> core runtime
- CI/CD and operator workstation

## Main Threats and Controls
1. Unauthorized dashboard/control access  
Control: API key/basic auth, lockout, persisted sessions, trusted IP policy, rate limits, strict CSP, security audit trail (`security_audit_events`).

2. Session abuse/replay  
Control: hashed session tokens, server-side revoke/rotation, expiry refresh, logout invalidation, auth-failure lockout.

3. Privilege misuse on critical operations  
Control: audit logging for pause/resume/quarantine/incident resolution and auth events; correlation IDs for traceability.

4. Plugin supply-chain / arbitrary code execution  
Control: plugin directory allowlist, manifest validation, optional SHA256 integrity, TS plugin explicit opt-in.

5. Secret leakage / stale credentials  
Control: redaction in logs, `.env.*` hardening, secret rotation inventory (`secret_inventory`), CLI checks (`secrets-status`), operator runbook.

6. Account cross-impact in multi-account runtime  
Control: account-specific queues, fairness quota per run (`ACCOUNT_MAX_JOBS_PER_RUN`), per-account health snapshots and alerts.

7. AI quality regressions (silent drift)  
Control: validation dataset + run results (`ai_validation_*`), quality snapshot metrics, A/B significance checks, false-positive intent tracking.

8. Backup/restore failure blindness  
Control: backup run tracking (`backup_runs`), checksum capture, failure alerting.

## Residual Risks
- Browser platform changes may still cause temporary selector degradation.
- Third-party API outages can degrade features even with retries/circuit breaker.
- Local workstation compromise can bypass application-layer controls.

## Review Cadence
- Weekly: review security audit events and account health snapshots.
- Monthly: refresh threat model and secret inventory rotation state.
- After every incident: post-incident update of controls and this document.

