# Workflow + Architecture Hardening Backlog

Questo file e' il backlog tecnico operativo da usare durante i prossimi blocchi di lavoro su workflow, AI decisionale, anti-ban e architettura.

## Stato sintetico

- [x] Circular dependency del `src` portate a zero
- [x] Primo tightening dei confini tra `automation`, `core`, `browser` e repository layer
- [x] Human-click hardening sui path core dei workflow
- [ ] Decision engine AI reso davvero affidabile sui punti critici
- [ ] Split dei monoliti piu' rischiosi ancora da fare
- [ ] Validazione staging reale con browser/proxy/account veri ancora da fare

## P0 — Decision engine e workflow AI

- [x] Rendere il decision engine meno fail-open nei punti critici `pre_invite`, `pre_message`, `pre_follow_up`
- [x] Introdurre una modalita' `strict` o equivalente per le decisioni AI critiche
- [x] Allineare i valori `navigationStrategy` tra [aiDecisionEngine.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/ai/aiDecisionEngine.ts) e [navigationContext.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/browser/navigationContext.ts)
- [x] Cablaggio reale del decision point `navigation`
- [ ] Decidere se implementare davvero `inbox_reply` oppure rimuovere il contratto morto
- [x] Aggiungere test reali del decision engine su:
  - timeout
  - JSON invalido
  - action invalida
  - fallback policy
  - strict vs permissive mode

## P0 — Workflow runtime e anti-ban

- [ ] Audit completo dei 4 workflow pubblici su proxy/session/account health
- [ ] Audit dei path residui fuori dal core che non usano ancora lo stesso standard di click/input
- [ ] Audit di `windowInputBlock` e protezione dal takeover del mouse da parte dell'utente
- [ ] Verifica che non restino teletrasporti di navigazione nei path laterali
- [ ] Verifica che Telegram/report/API consumino sempre lo stesso `WorkflowExecutionResult`

## P1 — Architettura runtime

- [ ] Ridurre ancora l'uso del barrel [repositories.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories.ts) nei moduli ad alto impatto
- [ ] Split reale di [leadsCore.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories/leadsCore.ts)
- [ ] Split di [scheduler.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/scheduler.ts)
- [ ] Split di [api/server.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/api/server.ts)
- [ ] Split di [db.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/db.ts)
- [ ] Split di [humanBehavior.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/browser/humanBehavior.ts)

## P1 — Verifica e safety net

- [ ] Consolidare una suite di test focalizzata su workflow + AI + browser behavior da lanciare a ogni blocco
- [ ] Aggiungere contract tests sul lato AI decisionale
- [ ] Aggiungere characterization tests sui path di fallback dei workflow
- [ ] Preparare un runbook di staging per validare browser/proxy/account senza toccare produzione

## P2 — Pulizia strutturale della codebase

- [ ] Decidere il destino del frontend legacy `dashboard/`
- [ ] Pulire gli artefatti strani nel root workspace
- [ ] Separare meglio i documenti storici da quelli operativi
- [ ] Tenere `TODO.md` come audit storico e usare `todos/` per il lavoro attivo

## Regola operativa

Quando un blocco viene chiuso:

1. aggiornare [ENGINEERING_WORKLOG.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/tracking/ENGINEERING_WORKLOG.md)
2. aggiornare questo backlog
3. aggiornare [active.md](C:/Users/albie/Desktop/Programmi/Linkedin/todos/active.md) se cambia la priorita' corrente
