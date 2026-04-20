# Active Tasks — LinkedIn Bot

*Aggiorna questo file e fai commit quando cambiano le priorità.*
*Il briefing mattutino remoto legge questo file ogni giorno alle 08:00.*
*Per il sistema AI complessivo, il backlog primario resta [AI_MASTER_IMPLEMENTATION_BACKLOG.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md); le viste lineari di review sono [AI_IMPLEMENTATION_LIST_GLOBAL.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_IMPLEMENTATION_LIST_GLOBAL.md) e [LINKEDIN_IMPLEMENTATION_LIST.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/LINKEDIN_IMPLEMENTATION_LIST.md).*

## 🔧 Sprint tecnico corrente

1. **Workflow + architecture hardening** — usare [workflow-architecture-hardening.md](C:/Users/albie/Desktop/Programmi/Linkedin/todos/workflow-architecture-hardening.md) come backlog operativo canonico
2. **Engineering worklog persistente** — aggiornare [ENGINEERING_WORKLOG.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/tracking/ENGINEERING_WORKLOG.md) a ogni blocco tecnico significativo
3. **Orchestrazione cognitiva contestuale** — consolidare il routing advisory machine-readable e trasformarlo progressivamente in enforcement piu' forte solo dove i miss ricorrenti lo giustificano
4. **Orizzonti temporali del task** — distinguere sempre breve/medio/lungo termine e trasformare le cadenze periodiche di memoria, review e manutenzione in enforcement reale
5. **Gap di capability + context degradation** — partire dai registri `AI_CAPABILITY_ROUTING.json` e `AI_LEVEL_ENFORCEMENT.json` per far riconoscere gap reali, mantenere un catalogo capability ordinato con routing per dominio pratico, e capire quando il contesto va chiuso con `context-handoff`
6. **Lifecycle + control plane production blockers** — completare stop/flush di listener/checkpoint a shutdown e chiudere il reporting runtime cross-process (proxy/JA3/live state)
7. **Workflow runtime truthfulness** — allineare `WorkflowExecutionResult` tra API, Telegram, report e dashboard, completando anche i failure mode specifici ancora non propagati
8. **Proxy/session classification** — distinguere login mancante da rate limit/proxy failure e rafforzare il gate proxy reale
9. **Refactor runtime core + repository** — proseguire per blocchi piccoli sulla base della spec [2026-04-01-runtime-core-repository-refactor-design.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/archive/2026-04-01-runtime-core-repository-refactor-design.md)

## 🔥 Alta priorità

1. **Importare workflow n8n** — aprire n8n UI e importare `orchestrator-v2.json` + `watchdog.json`, sostituire i placeholder
2. ~~**A04 — 256 empty catch blocks**~~ — ANALIZZATO (2026-04-09): falso positivo audit. Tutti i catch hanno handling adeguato (fallback/re-throw/counter/comment best-effort). Nessuna azione.
3. **Dashboard todo** — configurare Supabase (schema.sql), impostare .env.local, `npm run dev`
4. **Reporting cross-process** — allineare daemon PM2 e API/dashboard su eventi live, stato proxy e stato JA3 reali
5. **`skipPreflight` + account override** — chiudere i bypass troppo permissivi e ripristinare sempre l'override account scoped alla singola run

## 📋 Media priorità

5. ~~**A14 — No rollback plan**~~ — COMPLETATO (2026-04-09): `scripts/docker-release.sh` (build/promote/rollback/list), npm scripts `docker:*`, feature flags già in `src/config/featureFlags.ts`
6. **`frontend/`** — decidere se tenere o eliminare (~2500 righe, stato incerto)
7. **Sentry** — verificare che `src/telemetry/sentry.ts` riceva eventi reali in produzione

## ✅ Completati di recente

- Routing operativo advisory + registri machine-readable `AI_CAPABILITY_ROUTING.json` / `AI_LEVEL_ENFORCEMENT.json` + audit `audit:routing` / `audit:l2-l6` (2026-04-19)
- AI Operating Model punti 4/7/9/10/11: setup guide, hooks audit, model table (2026-04-08)
- GDPR art.30 register: `docs/GDPR_ART30_REGISTER.md` (2026-04-09)
- Violations-tracker hook in `settings.json` — rileva miss antiban (2026-04-09)
- Skill `/audit-rules` — analisi compliance regole da log (2026-04-09)
- Campaign-analyzer: dedup alert via staticData (evita Telegram duplicati) (2026-04-09)
- Sistema "secondo cervello": memory files + personalità + briefing + dashboard (2026-03-30)
- n8n Docker service + auth obbligatoria (2026-03-30)
- Workflow n8n fix: URL bot-api:3000, sintassi expression (2026-03-30)
- Audit 115/115 + 1368 test verdi (2026-03-28)
- Sentry integration: `src/telemetry/sentry.ts` (2026-03-29)
