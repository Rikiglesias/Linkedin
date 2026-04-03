# CLAUDE.md

Questo file e' l'adapter per Claude Code.
Le regole operative canoniche del progetto stanno in `AGENTS.md`.

## Ordine di lettura

1. `AGENTS.md`
2. `docs/AI_OPERATING_MODEL.md`
3. `todos/active.md`
4. `todos/workflow-architecture-hardening.md`
5. `docs/tracking/README.md`

## Regole Claude Code specifiche

- Usare `Claude Code /loop` solo per polling o babysitting di sessione.
- Per automazioni durevoli preferire `n8n`, task desktop/cloud o workflow persistenti.
- Se serve un comportamento tipo `/loop` in un ambiente che non lo offre nativamente, applicare la regola di loop custom definita in `AGENTS.md`.
- Non mantenere backlog grezzi o liste di desideri in questo file: vanno in `docs/AI_OPERATING_MODEL.md`.

## Ruoli dei file guida

- `AGENTS.md`: comportamento operativo di progetto.
- `docs/AI_OPERATING_MODEL.md`: roadmap esplicita su prompt, modelli, skill, agenti, workflow e automazioni.
- `docs/tracking/`: stato tecnico e verifiche reali.
- `todos/`: priorita' operative correnti.
