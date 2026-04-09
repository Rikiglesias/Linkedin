# Active Tasks — LinkedIn Bot

*Aggiorna questo file e fai commit quando cambiano le priorità.*
*Il briefing mattutino remoto legge questo file ogni giorno alle 08:00.*

## 🔧 Sprint tecnico corrente

1. **Workflow + architecture hardening** — usare [workflow-architecture-hardening.md](C:/Users/albie/Desktop/Programmi/Linkedin/todos/workflow-architecture-hardening.md) come backlog operativo canonico
2. **Engineering worklog persistente** — aggiornare [ENGINEERING_WORKLOG.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/tracking/ENGINEERING_WORKLOG.md) a ogni blocco tecnico significativo
3. **Lifecycle + control plane production blockers** — chiudere lock daemon, graceful shutdown, restart remoto, `automation_commands` zombie e readiness reale
4. **Workflow runtime truthfulness** — far risalire incidenti runtime, allineare job type/contract e togliere side effect impliciti dai workflow orchestrati
5. **Proxy/session classification** — distinguere login mancante da rate limit/proxy failure e rafforzare il gate proxy reale
6. **Refactor runtime core + repository** — proseguire per blocchi piccoli sulla base della spec [2026-04-01-runtime-core-repository-refactor-design.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/superpowers/specs/2026-04-01-runtime-core-repository-refactor-design.md)

## 🔥 Alta priorità

1. **Importare workflow n8n** — aprire n8n UI e importare `orchestrator-v2.json` + `watchdog.json`, sostituire i placeholder
2. ~~**A04 — 256 empty catch blocks**~~ — ANALIZZATO (2026-04-09): falso positivo audit. Tutti i catch hanno handling adeguato (fallback/re-throw/counter/comment best-effort). Nessuna azione.
3. **Dashboard todo** — configurare Supabase (schema.sql), impostare .env.local, `npm run dev`
4. **Reporting cross-process** — allineare daemon PM2 e API/dashboard su eventi live, stato proxy e stato JA3 reali

## 📋 Media priorità

5. ~~**A14 — No rollback plan**~~ — COMPLETATO (2026-04-09): `scripts/docker-release.sh` (build/promote/rollback/list), npm scripts `docker:*`, feature flags già in `src/config/featureFlags.ts`
6. **`frontend/`** — decidere se tenere o eliminare (~2500 righe, stato incerto)
7. **Sentry** — verificare che `src/telemetry/sentry.ts` riceva eventi reali in produzione

## ✅ Completati di recente

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
