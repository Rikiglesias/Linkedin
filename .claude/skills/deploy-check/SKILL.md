---
name: deploy-check
description: Esegue la PROD READINESS checklist del bot LinkedIn e dice cosa manca prima di andare in produzione. Attivare con /deploy-check o "posso andare in produzione?", "prod readiness", "siamo pronti?".
---

# Deploy / Production Readiness Check

Quando l'utente vuole sapere se il bot è pronto per la produzione:

1. Leggi `C:\Users\albie\.claude\projects\C--Users-albie-Desktop-Programmi-Linkedin\memory\project_next_priorities.md` (sezione PROD READINESS)
2. Per ogni item della checklist, verifica lo stato attuale leggendo il codice se necessario

## Checklist PROD READINESS

| Item | Stato | File/Note |
|------|-------|-----------|
| Graceful shutdown | ✅ | `src/index.ts:81-158` |
| Environment config (dev/staging/prod) | ✅ | `src/config/` |
| Secret management | ✅ | `.env` + `.gitignore` |
| Health check endpoint | [ ] | Da implementare |
| Metrics exporter (Prometheus/Grafana) | [ ] | Da implementare |
| Alerting su failure rate | [ ] | Da implementare |
| Auto-recovery dopo crash | [ ] | systemd/pm2/Task Scheduler |
| Log strutturati JSON con correlation ID | [ ] | `src/telemetry/logger.ts` |
| Database backup automatico | [ ] | `scripts/backup.ts` esiste? |
| Rate limit dashboard real-time | [ ] | Da implementare |
| Error tracking centralizzato | [ ] | Sentry/BugSnag |
| CI/CD pipeline | [ ] | GitHub Actions |

## Output

- Lista item completati ✅
- Lista item mancanti con **priorità suggerita** (cosa blocca davvero la produzione vs nice-to-have)
- Stima impatto di andare live senza ogni item mancante

SQLite in produzione = BLOCCO (A06): usare PostgreSQL obbligatoriamente.
