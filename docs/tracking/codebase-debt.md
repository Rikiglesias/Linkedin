# Codebase Technical Debt — Tracking

> Snapshot del 2026-04-08. Aggiornare con `npm run audit` quando si lavora su questi file.
> **Regola**: quando si tocca un file in questa lista → proporre split SRP come parte del task (non rimandare).

## Score attuale: ~20/100 (80 file >300 righe)

---

## Priorità 🔴 (>1000 righe — split urgente al prossimo tocco)

| File | Righe | Responsabilità sospette |
|------|-------|------------------------|
| `src/salesnav/bulkSaveOrchestrator.ts` | 1840 | Orchestrazione + parsing + storage + retry logic |
| `src/browser/humanBehavior.ts` | 1423 | Comportamento umano + timing + click + scroll + typing |
| `src/core/repositories/leadsCore.ts` | 1417 | CRUD leads + analytics + filtering + export |
| `src/core/jobRunner.ts` | 1415 | Job scheduling + execution + retry + reporting |
| `src/integrations/personDataFinder.ts` | 1301 | Data enrichment + API calls + caching + parsing |
| `src/cli/commands/loopCommand.ts` | 1136 | Loop control + display + state management + export |
| `src/cli/commands/adminCommands.ts` | 1102 | Admin CRUD + batch ops + reporting |
| `src/core/repositories/stats.ts` | 1059 | Stats calculation + aggregation + KPI + export |
| `src/core/scheduler.ts` | 1058 | Scheduling + execution + concurrency + error handling |
| `src/core/repositories/system.ts` | 1056 | System config + health + metrics + log |

## Priorità 🟠 (600-1000 righe — split al prossimo tocco)

| File | Righe |
|------|-------|
| `src/api/server.ts` | 969 |
| `src/core/salesNavigatorSync.ts` | 952 |
| `src/core/repositories/leadsLearning.ts` | 900 |
| `src/browser/launcher.ts` | 848 |
| `src/proxyManager.ts` | 838 |
| `src/cli/commands/utilCommands.ts` | 836 |
| `src/db.ts` | 802 |
| `src/core/repositories/aiQuality.ts` | 785 |
| `src/workers/inviteWorker.ts` | 760 |

## Regola di split (da CLAUDE.md)

Quando si tocca un file in questa lista:
1. Identificare le responsabilità multiple nel file (ogni sezione logica separata = SRP violation)
2. Proporre il refactoring locale prima di aggiungere nuova funzionalità
3. Schema tipico per repository grandi: `leadsCore.ts` → `leadsRead.ts` + `leadsWrite.ts` + `leadsMutations.ts`
4. Schema tipico per worker grandi: estrarre la logica di business in un service separato, tenere solo orchestrazione nel worker

## Come verificare progressi

```bash
npm run audit          # report completo con score
npm run audit:json     # output JSON (per integrazione CI)
```

Il workflow n8n `codebase-audit.json` (domenica 10:00) chiama `GET /api/controls/codebase-audit` e invia il report su Telegram.
