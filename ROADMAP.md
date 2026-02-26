# LinkedIn Bot Roadmap

## Objective

Build a safer, more reliable, and measurable end-to-end automation flow:

- Source lists from DB/control-plane
- Execute invite/check/message workflows with strict safeguards
- Keep LinkedIn state and local DB in sync
- Reduce operational risk with adaptive policies and incident controls

## Status Legend

- `todo`: not started
- `in_progress`: currently being implemented
- `done`: completed and verified
- `blocked`: waiting on external input/decision

## Owners

- `YOU`: business decisions, account operation, approvals
- `AI`: implementation in codebase
- `JOINT`: requires both

## Priority Roadmap

| ID | Priority | Area | Task | Owner | Status | Dependencies | Done Criteria |
|---|---|---|---|---|---|---|---|
| P0-01 | P0 | Security | Rotate `SUPABASE_SERVICE_ROLE_KEY` and update `.env` | YOU | todo | None | Old key revoked, new key active, bot works |
| P0-02 | P0 | Security | Verify no secrets in logs/outbox payloads | AI | done | P0-01 | No sensitive token appears in runtime logs |
| P0-03 | P0 | Security | Confirm private permissions on DB/session folders | AI | done | None | `data` paths protected and documented |
| P0-04 | P0 | Runtime Safety | Add global single-runner lock (no dual bot) | AI | done | None | Second process exits with lock message |
| P0-05 | P0 | Runtime Safety | Add lock heartbeat and stale-lock recovery | AI | done | P0-04 | Crashed lock auto-recovers safely |
| P0-06 | P0 | Runtime Safety | Run `doctor` automatically before each loop cycle | AI | done | None | Loop skips if health check fails |
| P0-07 | P0 | Risk Engine | Implement adaptive caps per list/account | AI | done | None | Budgets auto-adjust from recent KPIs |
| P0-08 | P0 | Risk Engine | Implement auto cooldown engine (48h/72h policy) | AI | done | P0-07 | Cooldown triggers after risk anomalies |
| P0-09 | P0 | Risk Engine | Enforce no-burst pacing policy | AI | done | P0-07 | No clustered spikes in job execution |
| P0-10 | P0 | Session Safety | Add session/IP/device consistency guard + auto-pause | AI | done | None | Context drift triggers pause and incident |

| ID | Priority | Area | Task | Owner | Status | Dependencies | Done Criteria |
|---|---|---|---|---|---|---|---|
| P1-01 | P1 | Workflow | Schedule daily `site-check --fix` from autopilot | AI | done | P0-04 | Daily reconciliation runs automatically |
| P1-02 | P1 | Workflow | Improve LinkedIn-vs-DB state reconciliation rules | AI | done | P1-01 | Mismatch false positives reduced |
| P1-03 | P1 | Workflow | Add `REVIEW_REQUIRED` lead state for ambiguous cases | AI | todo | P1-02 | Unsafe transitions blocked for review |
| P1-04 | P1 | Workflow | Add pending invite hygiene policy (age-based) | JOINT | todo | P1-02 | Old pending invites handled by policy |
| P1-05 | P1 | Control Plane | Upgrade Supabase from sink-only to control-plane | AI | todo | P0-01 | Campaign config can be managed remotely |
| P1-06 | P1 | Control Plane | Implement bidirectional sync (Supabase <-> local) | AI | todo | P1-05 | Config/data parity verified |
| P1-07 | P1 | Observability | Add dashboard KPIs (funnel, risk, pending, acceptance) | AI | todo | P1-05 | KPI panel populated from live data |
| P1-08 | P1 | Lead Quality | Add lead scoring before invite scheduling | AI | todo | P0-07 | Low-score leads filtered/deprioritized |
| P1-09 | P1 | Enrichment | Add confidence score + review queue for enrichment | AI | todo | P1-03 | Low-confidence matches not auto-sent |
| P1-10 | P1 | Messaging | Add semantic similarity anti-duplication checks | AI | todo | None | Repetitive messages auto-blocked |
| P1-11 | P1 | Integrations | Add selectable event-sync sink (`SUPABASE`/`WEBHOOK`) for n8n/Make/Pipedream | AI | done | None | `sync-status` mostra sink attivo; `sync-run-once` supporta webhook |
| P1-12 | P1 | Workflow | Add automatic post-run state sync (invite/accept/message reconciliation) | AI | done | P1-02 | DB state auto-updated each run from site signals |
| P1-13 | P1 | AI | Add optional AI message personalization with template fallback | AI | done | None | Messages can be AI-personalized without blocking flow |
| P1-14 | P1 | AI | Add optional AI guardian for preemptive risk pause/watch decisions | AI | done | P0-07 | Guardian emits decision and can auto-pause on critical |

| ID | Priority | Area | Task | Owner | Status | Dependencies | Done Criteria |
|---|---|---|---|---|---|---|---|
| P2-01 | P2 | Audit | Add `campaign_runs` table and run-by-run telemetry | AI | todo | None | Every loop writes run summary |
| P2-02 | P2 | Alerts | Expand alerting on challenge/quarantine/backlog bursts | AI | todo | P2-01 | Alerts fire with actionable context |
| P2-03 | P2 | Incident Ops | Create incident runbook with auto actions | JOINT | todo | P2-02 | Clear SOP for pause/recover/resume |
| P2-04 | P2 | Reporting | Add automated daily summary report | AI | todo | P2-01 | Daily report produced reliably |
| P2-05 | P2 | Testing | Add tests for lock/cooldown/adaptive caps/reconcile | AI | todo | P0-04, P0-08, P1-02 | New tests pass in CI/local |
| P2-06 | P2 | Testing | Run realistic e2e dry-run scenarios | AI | todo | P2-05 | Dry-run validates full orchestration |
| P2-07 | P2 | Rollout | Canary rollout on one list for 7 days | JOINT | todo | P0 and P1 complete | Stable KPIs, no major incidents |
| P2-08 | P2 | Rollout | Controlled ramp-up policy with stop thresholds | JOINT | todo | P2-07 | Scaled traffic without safety regressions |
| P2-09 | P2 | Intelligence | Monthly review of official + community signals | JOINT | todo | None | Risk policy updated monthly |

## Execution Sequence

1. Complete all `P0` tasks first.
2. Enable `P1` control-plane and workflow intelligence.
3. Stabilize with `P2` testing, reporting, and rollout governance.

## Immediate Next Actions

1. `YOU`: rotate Supabase service key (`P0-01`).
2. `AI`: add `REVIEW_REQUIRED` guardrail state for ambiguous reconciliation (`P1-03`).
3. `AI`: add automatic post-run state sync tests, audit `campaign_runs` (`P2-01`).
