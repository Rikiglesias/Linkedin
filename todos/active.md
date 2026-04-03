# Active Tasks — LinkedIn Bot

*Aggiorna questo file e fai commit quando cambiano le priorità.*
*Il briefing mattutino remoto legge questo file ogni giorno alle 08:00.*

## 🔧 Sprint tecnico corrente

1. **Workflow + architecture hardening** — usare [workflow-architecture-hardening.md](C:/Users/albie/Desktop/Programmi/Linkedin/todos/workflow-architecture-hardening.md) come backlog operativo canonico
2. **Engineering worklog persistente** — aggiornare [ENGINEERING_WORKLOG.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/tracking/ENGINEERING_WORKLOG.md) a ogni blocco tecnico significativo
3. **AI decision engine** — chiudere il perimetro rimasto (`inbox_reply` + policy finale) dopo strict mode e navigation wiring
4. **Refactor runtime core + repository** — proseguire per blocchi piccoli sulla base della spec [2026-04-01-runtime-core-repository-refactor-design.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/superpowers/specs/2026-04-01-runtime-core-repository-refactor-design.md)

## 🔥 Alta priorità

1. **Importare workflow n8n** — aprire n8n UI e importare `orchestrator-v2.json` + `watchdog.json`, sostituire i placeholder
2. **A04 — 256 empty catch blocks** — aggiungere almeno `logWarn` per non perdere errori silenti in prod
3. **Dashboard todo** — configurare Supabase (schema.sql), impostare .env.local, `npm run dev`

## 📋 Media priorità

4. **A14 — No rollback plan** — aggiungere Docker tag versioned + feature flag minimo
5. **`frontend/`** — decidere se tenere o eliminare (~2500 righe, stato incerto)
6. **Sentry** — verificare che `src/telemetry/sentry.ts` riceva eventi reali in produzione

## ✅ Completati di recente

- Sistema "secondo cervello": memory files + personalità + briefing + dashboard (2026-03-30)
- n8n Docker service + auth obbligatoria (2026-03-30)
- Workflow n8n fix: URL bot-api:3000, sintassi expression (2026-03-30)
- Audit 115/115 + 1368 test verdi (2026-03-28)
- Sentry integration: `src/telemetry/sentry.ts` (2026-03-29)
