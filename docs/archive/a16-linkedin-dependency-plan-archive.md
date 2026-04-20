# A16 — Piano Diversificazione LinkedIn Dependency Risk

> Stato documento: analisi specialistica sul rischio di dipendenza da LinkedIn.
> Non usare questo file come backlog operativo principale: per le priorita' vive usare `todos/active.md` e `todos/workflow-architecture-hardening.md`.

## Rischio
100% del valore del bot dipende da LinkedIn. Se LinkedIn:
- Cambia UI radicalmente → selettori rotti → bot fermo
- Blocca JA3/fingerprint → detection immediata
- Riduce rate limit a 20/settimana → business non sostenibile
- Implementa device attestation → game over per automazione browser

## Mitigazioni Attive (già implementate)

| Mitigazione | Stato | File |
|---|---|---|
| Selector canary pre-sessione | ✅ | browser/selectorCanary.ts |
| n8n LinkedIn change monitoring | ✅ | .windsurf/workflows/linkedin-monitoring.md |
| Webhook API per alert esterni | ✅ | api/routes/linkedinChangeAlert.ts |
| Fallback vision AI per selettori | ✅ | salesnav/visionNavigator.ts |
| Circuit breaker per liste | ✅ | core/scheduler.ts |
| Heartbeat Telegram | ✅ | core/preventiveGuards.ts |

## Piano Diversificazione (Roadmap)

### Fase 1 — Monitoring Proattivo (COMPLETATA)
- ✅ Workflow n8n monitora 15+ fonti per cambiamenti LinkedIn
- ✅ Webhook pausa automatica su alert CRITICAL
- ✅ Competitor monitoring (PhantomBuster, Dux-Soup changelogs)

### Fase 2 — Graceful Degradation (DA FARE)
- Se selettori rotti → modalità "solo inbox" (leggi risposte, non invitare)
- Se rate limit ridotto → auto-scale budget al nuovo limite
- Se fingerprint detected → pausa + cambio proxy + nuovo fingerprint pool

### Fase 3 — Canali Alternativi (FUTURO)
- Email outreach come canale parallelo (enrichment email già implementato)
- WhatsApp Business API per follow-up (richiede integrazione separata)
- Twitter/X DM per contatto iniziale (meno efficace per B2B)

### Fase 4 — Platform Independence (FUTURO)
- Separare logica outreach dalla piattaforma specifica
- Adapter pattern: LinkedInAdapter, EmailAdapter, WhatsAppAdapter
- Stessa pipeline (discover → qualify → contact → follow-up) su più canali

## KPI di Monitoraggio

| KPI | Soglia Warning | Soglia Critical | Azione |
|---|---|---|---|
| Selector failure rate | >5% | >10% | Alert + canary rerun |
| Challenge frequency | >1/settimana | >3/settimana | Ridurre volume 50% |
| Acceptance rate trend | <20% (7gg) | <10% (7gg) | Review targeting |
| Ban probability score | >45 | >70 | STOP + review |

## Scenario Peggiore: LinkedIn Ban Totale

1. Pausa immediata (già implementato: quarantineAccount)
2. Tutti i dati lead sono nel DB locale → nessuna perdita
3. Enrichment email già disponibile → pivot a email outreach
4. Dashboard mostra storico completo → analytics preservate
