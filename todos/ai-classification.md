# AI System Implementation and Strategic Briefing

This briefing document provides a comprehensive synthesis of the current state, strategic direction, and exhaustive implementation requirements for the AI Operating Model. The core objective is to transition the system from "written rules" to "enforced behavior," ensuring absolute source fidelity and operational truthfulness.

## Executive Summary

The AI system is undergoing a transition from an **audit-assisted** state to a **strictly enforced** operational model. While the system currently possesses a strong cognitive foundation (Level 1 and Levels 7-9 of the 9-level model), the intermediate levels (L2-L6) currently rely on advisory hooks rather than blocking enforcement. 

The primary mission is to eliminate "false completions" and "operational hallucinations"—instances where the AI assumes success without technical evidence. The roadmap prioritizes the **Control Plane** and **Runtime Integrity** as the foundation for all subsequent automation, including n8n workflows and environment parity.

---

## Key Insights and Detailed Analysis

### 1. The Shift to Cognitive Enforcement
The documentation emphasizes that textual rules in Markdown files are insufficient for high-reliability tasks. The strategy is to move critical rules into **Hooks** (automatic triggers) and **Audits** (executable checks). 
*   **Advisory to Blocking:** L2-L6 protocols (Impact Analysis, Execution Order, Proactive Implementation, Technical Coherence, Cross-domain Analysis) are being promoted from machine-readable registries to active enforcement points.
*   **Non-Literal Interpretation:** A fundamental rule is established: the AI must interpret the *intent* of the user, acting as a senior engineer rather than a mechanical executor of literal text.

### 2. Runtime Truthfulness and Lifecycle
A major focus is the stability of the bot's runtime environment. 
*   **Graceful Shutdowns:** Eliminating `process.exit(0)` to prevent data corruption and "zombie" processes.
*   **Cross-Process Reporting:** Moving live state data (Proxy, JA3, active status) out of local process memory and into a shared, truthful reporting layer accessible by the API and Dashboard.

### 3. Contextual Integrity and Memory
The system acknowledges that context degradation is a technical failure. 
*   **Context Handoff:** When a session becomes too dense (300k+ tokens) or incoherent, the system is mandated to use the `context-handoff` skill to migrate relevant state to a clean session.
*   **AI-Readable Context:** Moving away from "monolithic" documents toward modular, indexed, and thematic files.

### 4. Anti-Ban and Compliance (LinkedIn Specific)
For the LinkedIn bot, safety is not optional. 
*   **Behavioral Biometrics:** 2026 detection vectors require the simulation of "human hesitation" rather than simple randomized delays.
*   **Proxy Health:** Strengthening the "Proxy Healthy" gate with real authentication checks and exit IP verification to prevent "teleportation" errors.

---

## Critical Quotes and Context

> **"Allucination include: fatti o cause inventate, verifiche dichiarate ma non eseguite, stato del sistema descritto senza evidenza reale."**
*   **Context:** Defines "Operational Hallucination" not just as invented facts, but as "false completions" where the AI claims a check was done when it was bypassed.

> **"File regole corto = AI ricorda tutto."**
*   **Context:** A fundamental design principle for `CLAUDE.md`. Excessively long rule files lead to cognitive drift; critical rules must be offloaded to hooks.

> **"L'AI deve preferire una verita' scomoda a una risposta rassicurante ma falsa."**
*   **Context:** The cornerstone of "Truthful Control Plane" logic—the system must prioritize technical accuracy over user pleasing.

> **"Gli esempi dell'utente non restringono il pensiero dell'AI... deve inferire anche altri controlli, rischi e punti utili."**
*   **Context:** Prevents the AI from treating user examples as an exhaustive list, forcing it to identify the underlying pattern and apply it systemically.

---

## Complete Implementation Classification

The following table classifies all open implementation items from the Global and LinkedIn backlogs, assigned by dominant primitive, time horizon, and enforcement priority.

**Priority Key:** 1: Control Plane | 2: Runtime | 3: Anti-Ban | 4: n8n | 5: Parity | 6: Maintenance

| ID | Title | Dominant Primitive | Horizon | Priority |
| :--- | :--- | :--- | :--- | :--- |
| **G1** | Promote L2-L6 to stronger enforcement | Hook | Med | 1 |
| **G2** | Consolidate capability inventory | Script/Audit | Long | 1 |
| **G3** | Rule: "Interpret intent, not literal text" | Rules | Short | 1 |
| **G4** | Rule: Best Practice Engineering Cycle | Rules | Med | 1 |
| **G5** | Cross-domain impact evaluation | Rules | Med | 1 |
| **G-M3** | Apply AI-readable style guide | Memory | Med | 6 |
| **G-M4** | Skill: `context-handoff` | Skill | Med | 2 |
| **G-P4** | Define Capability Matrix per environment | Checklist | Med | 5 |
| **G-P5** | Document Environment Gaps/Workarounds | Checklist | Med | 5 |
| **G-P6** | Stabilize `settings.json` & SessionStart | Hook | Short | 5 |
| **G-P7** | Migration plan toward Codex | Rules | Med | 5 |
| **G-P8** | Implement Codex loop with full verification | Script/Audit | Med | 5 |
| **G-P9** | Policy: "Best environment for task" | Rules | Long | 5 |
| **G-L9** | Dictation tool stability | Script/Audit | Med | 6 |
| **G-L10** | Local vs Cloud transcription trade-off | Rules | Med | 6 |
| **G-L11** | Fix hardware bottlenecks | Script/Audit | Med | 6 |
| **G-L12** | Prompt Improvement Helper | Skill | Med | 1 |
| **G-G39** | Extend Git behavior outside Claude Code | Hook | Med | 2 |
| **G-G40** | Verify commit as "natural closure" | Checklist | Short | 2 |
| **G-G41** | Define Push-Stop/Review policy | Rules | Med | 2 |
| **G-G42** | Systematic local vs branch review | Script/Audit | Med | 2 |
| **G-T43** | Mandatory Short/Med/Long classification | Rules | Short | 6 |
| **G-T44** | Canonical containers for non-short tasks | Memory | Long | 6 |
| **G-T45** | Promote stable tasks to Scheduled Workflows | n8n Workflow | Long | 4 |
| **G-C46** | Split long files/mixed responsibilities | Rules | Med | 6 |
| **G-C47** | Separate Historical vs Operational docs | Memory | Med | 6 |
| **G-C48** | Keep Canonical files AI-readable | Memory | Long | 6 |
| **G-B54** | Keep Bootstrap checklist aligned | Checklist | Med | 6 |
| **G-B55** | Reusable handoff package | Memory | Long | 6 |
| **G-B56** | Define project-standard transfer items | Rules | Med | 6 |
| **G-B57** | System transferability verification | Script/Audit | Long | 6 |
| **G-A58** | Measure omissions/primitive choice errors | Metrics | Long | 1 |
| **G-A59** | Convert recurring misses to enforcement | Hook | Long | 1 |
| **G-A60** | Auto-recognize primitive gaps | Metrics | Long | 1 |
| **G-A61** | Auto-selection of next correct step | Rules | Long | 1 |
| **G-A62** | Verify AI doesn't "fake" completeness | Script/Audit | Long | 1 |
| **G-A63** | Connect Autonomy/Temporal metrics | Metrics | Long | 1 |
| **L69** | Secure Shutdown Runbook | Checklist | Med | 2 |
| **L13** | Reporting/Proxy/JA3 out of local memory | Script/Audit | Short | 2 |
| **L14** | Close permissive `skipPreflight` | Hook | Short | 2 |
| **L15** | Account-scoped overrides (run-only) | Script/Audit | Short | 2 |
| **L16** | Cross-process Truthfulness (API/Telegram) | Script/Audit | Short | 2 |
| **L17** | Real Staging Validations (Proxy/Browser) | Script/Audit | Med | 2 |
| **L18** | Flush listeners/checkpoints at shutdown | Hook | Short | 2 |
| **L19** | Auto-recovery (Mem leak/n8n alerts) | n8n Workflow | Med | 2 |
| **L20** | Supabase Dashboard Configuration | Script/Audit | Short | 2 |
| **L21** | Workflow/AI Behavior Test Suite | Script/Audit | Med | 2 |
| **LA20** | Audit public workflows for Proxy/Health | Script/Audit | Short | 3 |
| **LA21** | Separate Login vs Rate Limit vs Proxy 403 | Skill | Short | 3 |
| **LA22** | Strengthen "Proxy Healthy" gate | Hook | Short | 3 |
| **LA23** | Exit IP Geo-coherence verification | Script/Audit | Med | 3 |
| **LA24** | Restore UA <-> Engine checks (JA3) | Script/Audit | Med | 3 |
| **LA25** | Multi-account Preflight alignment | n8n Workflow | Med | 3 |
| **LA26** | Update Anti-ban with 2026 vectors | Rules | Long | 3 |
| **LA27** | Skill: `antiban-review` ML update | Skill | Long | 3 |
| **LA28** | Clean workflow boundaries (Contract) | Rules | Short | 3 |
| **LA29** | `windowInputBlock` & Mouse takeover audit | Script/Audit | Short | 3 |
| **LA30** | Verify no direct `page.goto()` teleports | Script/Audit | Med | 3 |
| **LA31** | Decide fate of `inbox_reply` contract | Rules | Med | 3 |
| **LC32** | Activate GDPR/Retention workflows | n8n Workflow | Short | 3 |
| **LC33** | End-to-end data hygiene audit | Script/Audit | Med | 3 |
| **LS34** | Verify Sentry events in Production | Script/Audit | Med | 3 |
| **LS35** | Security scans (Auth/Stealth/DB) | Script/Audit | Long | 3 |
| **LN32** | Port n8n to live instance (ownership) | n8n Workflow | Med | 4 |
| **LN33** | Implement Ingress/Egress hooks | Hook | Med | 4 |
| **LN34** | Durable state for n8n workflows | Memory | Med | 4 |
| **LN35** | Human-in-the-loop (HIIL) for risky flows | n8n Workflow | Med | 4 |
| **LN36** | Cleanup bot/agent responsibilities | Rules | Med | 4 |
| **LN37** | Deployable n8n workflows (env validation) | n8n Workflow | Med | 4 |
| **LN38** | Align scheduling to user active windows | n8n Workflow | Med | 4 |
| **LC47** | Decide legacy UI/Dashboard fate | Rules | Med | 6 |
| **LC48** | Align `docs/README.md` to primary docs | Memory | Long | 6 |
| **LC49** | Clean root/folders after classification | Rules | Long | 6 |
| **LC50** | Reduce doc duplication/dead backlog | Memory | Long | 6 |

---

## Actionable Insights

1.  **Stop Documentation Proliferation:** The strategic work is done. Transition immediately to the "Executive Board" files (`AI_MASTER_IMPLEMENTATION_BACKLOG.md` and `active.md`). Do not create new lists; only update these canonical sources.
2.  **Immediate Enforcement Fixes:** 
    *   Promotion of L2-L6 from "Advisory" to "Audit-Assisted" is the highest priority for the Control Plane.
    *   Fixing the environment parity issues (settings.json, OpenRouter visibility) is essential to reduce daily operational friction.
3.  **The "Primitive Promotion" Rule:** If a task or rule is forgotten more than twice, it must be promoted to a higher primitive (e.g., from a Rule to a Hook or Script).
4.  **Operational Readiness for n8n:** Do not activate advanced automation until Phase B (Runtime/Security) is stable. Automating a fragile runtime will only amplify errors.
5.  **Requirement Ledger Mandate:** For any prompt that is "long or dense," the AI is strictly required to build a **Requirement Ledger** first. This ledger must explicitly separate user examples from inferred controls.