# Tracking Tecnico

Questa cartella esiste per evitare che audit, tentativi, verifiche e decisioni tecniche restino solo:

- nella chat
- nella memoria esterna
- in file enormi non operativi

## File canonici

- [ENGINEERING_WORKLOG.md](ENGINEERING_WORKLOG.md)
  Log cronologico delle analisi, dei refactor tentati, delle verifiche eseguite e dei risultati.
- [workflow-architecture-hardening.md](../../todos/workflow-architecture-hardening.md)
  Backlog tecnico operativo per workflow, AI decisionale, anti-ban, architettura e hardening.
- [active.md](../../todos/active.md)
  Priorita' correnti ad alto livello.
- [2026-04-01-runtime-core-repository-refactor-design.md](../archive/2026-04-01-runtime-core-repository-refactor-design.md)
  Design del refactor architetturale runtime core + repository (archiviato).

## File di supporto al tracking

- [codebase-debt.md](codebase-debt.md)
  Snapshot del debito tecnico strutturale. Non e' un backlog vivo autonomo: serve a supportare i file canonici sopra.
- [AI_CAPABILITY_ROUTING.json](AI_CAPABILITY_ROUTING.json)
  Registro machine-readable del routing capability/domini del control plane AI.
- [AI_LEVEL_ENFORCEMENT.json](AI_LEVEL_ENFORCEMENT.json)
  Registro machine-readable del protocollo `L2-L6` audit-assisted.
- [AI_ADK_CAPABILITY_GOVERNANCE.json](AI_ADK_CAPABILITY_GOVERNANCE.json)
  Registro machine-readable del layer ADK corretto per ogni capability del control plane AI.
- [AI_ORCHESTRATOR_CONTRACT.md](AI_ORCHESTRATOR_CONTRACT.md)
  Contratto auditabile per ragionamento AI, capability routing, hook coverage, continuation e truthful completion.

## Change map sistema AI

Usare questa mappa quando cambia il control plane AI. L'obiettivo e' evitare modifiche isolate che funzionano oggi ma rompono futuri cambiamenti.

| Cambio | File da aggiornare insieme | Verifica |
| --- | --- | --- |
| Nuova regola/requisito AI globale | `docs/AI_MASTER_SYSTEM_SPEC.md`, `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md`, `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md`, `docs/AI_RUNTIME_BRIEF.md`, `docs/AI_OPERATING_MODEL.md`, `docs/360-checklist.md`, `docs/tracking/ENGINEERING_WORKLOG.md` | `npm run audit:ai-list-completeness` + `npm run audit:ai-control-plane` |
| Nuovo requisito di ragionamento/orchestrazione AI | `docs/tracking/AI_ORCHESTRATOR_CONTRACT.md`, `docs/AI_RUNTIME_BRIEF.md`, `AGENTS.md`, hook Claude/Codex collegati, `docs/tracking/ENGINEERING_WORKLOG.md` | `npm run audit:ai-reasoning-hardening` + `npm run audit:codex-hook-parity` |
| Nuova capability/skill/MCP/plugin/agente | `docs/tracking/AI_CAPABILITY_ROUTING.json`, `docs/tracking/AI_ADK_CAPABILITY_GOVERNANCE.json`, canonici che spiegano trigger/limiti | `npm run audit:routing` + `npm run audit:adk-capabilities` |
| Nuovo hook Claude Code | hook reale in `C:/Users/albie/.claude/hooks/`, `C:/Users/albie/.claude/settings.json`, `C:/Users/albie/.claude/scripts/model-router-config.mjs`, `AGENTS.md`, `docs/tracking/AI_HOOK_ENFORCEMENT_PLAN.md`, `src/scripts/hooksConformityAudit.ts` | `npm run audit:hooks` + `npm run audit:ai-control-plane` |
| Nuovo hook Codex | `.codex/hooks.json`, `.codex/hooks/*.ps1`, `C:/Users/albie/.codex/config.toml`, `docs/tracking/AI_ORCHESTRATOR_CONTRACT.md`, `src/scripts/aiReasoningHardeningAudit.ts` | `npm run audit:codex-hook-parity` |
| Nuovo livello o cambio L2-L9 | `docs/tracking/AI_LEVEL_ENFORCEMENT.json`, `docs/AI_RUNTIME_BRIEF.md`, `docs/AI_OPERATING_MODEL.md`, audit collegati | `npm run audit:l2-l6` + `npm run audit:ai-control-plane` |
| Cambio handoff/cambio chat | `SESSION_HANDOFF.md`, eventuale `SESSION_PROMPT.md`, `todos/active.md`, `docs/tracking/ENGINEERING_WORKLOG.md`, skill `context-handoff` o `session-prompt` se toccate | prova nuova chat + `npm run audit:ai-control-plane` |

## Regole di aggiornamento

Aggiornare questi file quando cambia almeno uno di questi punti:

- viene trovato un finding nuovo non banale
- viene concluso un blocco di refactor o hardening
- una verifica importante passa o fallisce
- cambia la priorita' tecnica del progetto
- si decide esplicitamente di non fare una strada e si sceglie un'alternativa

## Cosa non mettere qui

- dump completi della chat
- checklist generiche senza riferimenti concreti
- dettagli che sono gia' derivabili dal codice o dal `git log`
