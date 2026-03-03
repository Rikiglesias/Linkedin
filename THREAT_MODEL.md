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

## Incident Response Playbook (Severity-Based)

### Severity Matrix
| Severity | Trigger examples | Initial response target | Business impact |
|---|---|---|---|
| `SEV-1` | unauthorized control access, confirmed secret leak, data exfiltration suspicion, repeated challenge/risk stop across accounts | <= 15 minutes | Critical: automation suspended, potential trust/security impact |
| `SEV-2` | sync outage with growing backlog, repeated circuit-open on integrations, elevated run errors with partial degradation | <= 60 minutes | High: partial service disruption, delayed operations |
| `SEV-3` | isolated worker regression, single-list selector drift, non-critical plugin/runtime warning | <= 4 hours | Medium/Low: localized degradation |

### Ownership and Escalation
| Function | Primary owner | Backup owner | Responsibilities |
|---|---|---|---|
| Runtime & queue | Platform owner | Operations backup | Pause/resume, queue triage, lock contention checks |
| Integrations (Supabase/Webhook/CRM) | Integrations owner | Platform owner | Circuit/backpressure remediation, endpoint validation |
| Security/compliance | Security owner | Platform owner | Incident classification, secret rotation, evidence preservation |
| Data/privacy | Data owner | Security owner | Retention/privacy actions, report validation |

### Standard Runbook
1. Detect and classify: use `doctor`, `status`, `diagnostics`, observability API, and audit logs.
2. Contain: pause automation and quarantine affected scope (account/list/workflow) when required.
3. Eradicate root cause: fix config/runtime/dependency/integration faults; rotate secrets if relevant.
4. Recover gradually: resume in controlled mode, monitor SLO/risk/backlog, confirm stability before full throughput.
5. Post-incident: update controls/tests/docs, resolve incident records, and register remediation backlog.

### Evidence and Traceability Requirements
- Every incident must include: severity, owner, timeline, impacted components, customer impact, root cause, remediation.
- Preserve correlation IDs and relevant records (`security_audit_events`, `outbox_events`, sync logs, account health snapshots).
- Incidents are closed only after objective checks pass (`typecheck`, integration tests, operational diagnostics).

## Review Cadence
- Weekly: review security audit events and account health snapshots.
- Monthly: refresh threat model and secret inventory rotation state.
- After every incident: post-incident update of controls and this document.
- Monthly advisor run: execute `security-advisor` and track remediation backlog from generated report.
