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

## Fase 5: Infrastruttura e Muri Portanti (Active)

| ID | Priority | Area | Task | Owner | Status | Dependencies |
|---|---|---|---|---|---|---|
| P5-01 | P1 | DevOps | **Containerizzazione (Docker)**: Isolare il bot e il database. Facilita i backup e previene problemi di ambiente. | AI | todo | Nessuna |
| P5-02 | P1 | Database | **Migrazione Graduale PostgreSQL**: Creare lo scivolo per abbandonare SQLite prima che diventi un bottleneck. | AI | todo | Nessuna |
| P5-03 | P1 | Core | **Protezione Memory Leak**: Refactoring della gestione lifecycle di Playwright/Browser (riavvii programmati, browser.close() forzato). | AI | todo | Nessuna |
| P5-04 | P2 | Core | **Gestione Fine Rate Limit**: Coda con backoff esponenziale reale per evitare stalli drastici. | AI | todo | Nessuna |
| P5-05 | P2 | DevOps | **Auto-backup e Restore policy**: Script automatizzati per backup conservativi. | AI | todo | Nessuna |

---

## Fase 6: Automazione Core e Sicurezza Operativa (Planned)

| ID | Priority | Area | Task | Owner | Status | Dependencies |
|---|---|---|---|---|---|---|
| P6-01 | P2 | Security | **Farming Account Strutturato**: Progressione automatica per "scaldare" nuovi account proxy. | AI | todo | P5 completata |
| P6-02 | P2 | Autopilot| **Gestione Dead Letter**: Worker per analizzare e riciclare i job falliti. | AI | todo | P5 completata |
| P6-03 | P2 | UI | **Euristiche UI Fallback**: Rilevamento anti-rottura selettori DOM per minor downtime. | AI | todo | Nessuna |
| P6-04 | P3 | Alerts | **Notifiche Multi-canale**: Slack, Discord, Email per supporto team. | AI | todo | Nessuna |

---

## Fase 7: Growth e Follow-up B2B (Planned)

- Follow-up Automatico / Calendly
- Arricchimento API (Apollo/Clearbit) e Estrazione Post
- Analisi Semantica Profonda per Intent B2B
- Dashboard UI Frontend (React/Vue)

---

## Fase 8: AI Predittiva ed Espansione (Planned)

- Modelli Predittivi Orizzonti Temporali (Best time to act)
- A/B Testing Dinamico (Bandit Algorithm)
- Integrazione CRM Enterprise e Recruiter Avanzato

---

## Completati / Archivio

<details>
<summary>Vedi i task storici completati (P0, P1, P2, P3, P4)</summary>

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
- `P0-11` Add Dashboard/API auth guard (done)
- `P0-12` Add doctor compliance gate for conservative limits (done)
- `P0-13` Disable profile context scraping by default via config flag (done)
- `P0-14` Extend privacy retention cleanup and default 90 days (done)
- `P0-15` Apply Supabase MCP hardening migration (RLS + FK indexes + function search_path fix) (done)

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

### Phase 4: Long-Term Enhancements

- `P4-01` **Daemon Mode**: Implement background service mode (PM2) (done)
- `P4-02` **A/B Testing Engine**: Aggiungere metriche e routing dinamico (A/B) sui messaggi e note (done)
- `P4-03` **Dashboard Phase 2**: Visualizzazione risultati A/B Test su PM2 proxy (done)
- `P2-09` Monthly review of official + community signals (todo - spostato o integrato in altri flussi)

</details>
