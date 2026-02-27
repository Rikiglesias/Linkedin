# LinkedIn Bot Roadmap

## Objective

Build a safer, more reliable, and measurable end-to-end automation flow, continuously enhancing capabilities and operational independence.

## Status Legend

- `todo`: not started
- `in_progress`: currently being implemented
- `done`: completed and verified
- `blocked`: waiting on external input/decision

## Owners

- `YOU`: business decisions, account operation, approvals
- `AI`: implementation in codebase
- `JOINT`: requires both

## Phase 4: Long-Term Enhancements (Active)

| ID | Priority | Area | Task | Owner | Status | Dependencies |
|---|---|---|---|---|---|---|
| P4-01 | P1 | Runtime | **Daemon Mode**: Implement background service mode (PM2) | AI | done | Nessuna |
| P4-02 | P1 | Messaging | **A/B Testing Engine**: Aggiungere metriche e routing dinamico (A/B) sui messaggi e note | AI | done | Nessuna |
| P4-03 | P2 | UI/UX | **Dashboard Phase 2**: Visualizzazione risultati A/B Test su PM2 proxy | AI | done | P4-01, P4-02 |
| P2-09 | P2 | Intelligence | Monthly review of official + community signals | JOINT | todo | Nessuna |

---

## Completati / Archivio

<details>
<summary>Vedi i task storici completati (P0, P1, P2, P3)</summary>

### P0: Security & Runtime Safety

- `P0-01` Rotate SUPABASE_SERVICE_ROLE_KEY (done)
- `P0-02` Verify no secrets in logs (done)
- `P0-03` Confirm private permissions on DB/session (done)
- `P0-04` Add global single-runner lock (done)
- `P0-05` Add lock heartbeat and recovery (done)
- `P0-06` Run doctor before cycle (done)
- `P0-07` Implement adaptive caps (done)
- `P0-08` Implement auto cooldown engine (done)
- `P0-09` Enforce no-burst pacing (done)
- `P0-10` Add session/IP/device consistency guard (done)

### P1: Workflow, Control Plane & AI

- `P1-01` Schedule daily site-check from autopilot (done)
- `P1-02` Improve reconciliation rules (done)
- `P1-03` Add REVIEW_REQUIRED lead state (done)
- `P1-04` Add pending invite hygiene policy (done)
- `P1-05` Upgrade Supabase to control-plane (done)
- `P1-06` Implement bidirectional sync (done)
- `P1-07` Add dashboard KPIs (done)
- `P1-08` Add lead scoring (done)
- `P1-09` Add confidence score + review queue (done)
- `P1-10` Add semantic similarity checks (done)
- `P1-11` Add selectable event-sync sink (done)
- `P1-12` Add automatic post-run state sync (done)
- `P1-13` Add AI message personalization (done)
- `P1-14` Add optional AI guardian (done)

### P2 e P3: Testing, Rollout & Web UI

- `P2-01` Add campaign_runs table (done)
- `P2-02` Expand alerting (done)
- `P2-03` Create incident runbook (done)
- `P2-04` Add automated daily summary report (done)
- `P2-05` Add tests for lock/cooldown (done)
- `P2-06` Run realistic e2e scenarios (done)
- `P2-07` Canary rollout on one list (done)
- `P2-08` Controlled ramp-up policy script (done)
- `P3-01` API Server (done)
- `P3-02` Web UI / Local Dashboard (done)
- `P3-03` Web Kill-Switch (done)

</details>
