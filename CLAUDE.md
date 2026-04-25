# CLAUDE.md

Questo file e' l'adapter per Claude Code.
Le regole operative canoniche del progetto stanno in `AGENTS.md`.

## Ordine di lettura

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/AI_MASTER_SYSTEM_SPEC.md`
4. `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md`
5. `docs/AI_OPERATING_MODEL.md`
6. `todos/active.md`
7. `todos/workflow-architecture-hardening.md`
8. `docs/tracking/README.md`

## Regole Claude Code specifiche

- Usare `Claude Code /loop` solo per polling o babysitting di sessione.
- Per automazioni durevoli preferire `n8n`, task desktop/cloud o workflow persistenti.
- Se serve un comportamento tipo `/loop` in un ambiente che non lo offre nativamente, applicare la regola di loop custom definita in `AGENTS.md`.
- Non mantenere backlog grezzi o liste di desideri in questo file: vanno in `docs/AI_OPERATING_MODEL.md`.
- `docs/AI_RUNTIME_BRIEF.md` non e' una fonte manuale separata: viene reiniettato automaticamente dai hook `SessionStart`, `UserPromptSubmit` e `PreCompact`.
- `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md` e `docs/LINKEDIN_IMPLEMENTATION_LIST.md` sono i backlog lineari per review e pruning; non sono fonti primarie del mancante.
- La scelta contestuale di skill, MCP, web/docs, loop, piano e workflow deve partire automaticamente a ogni prompt e a ogni modifica rilevante, non su sollecito dell'utente.
- Gli esempi dell'utente sono pattern di ragionamento da estendere, mai liste chiuse.
  Da ogni esempio inferire anche altri controlli, rischi e punti coerenti con l'intento.

## Ruoli dei file guida

- `AGENTS.md`: comportamento operativo di progetto.
- `docs/AI_MASTER_SYSTEM_SPEC.md`: lista madre unica del sistema AI desiderato.
- `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md`: backlog strutturato primario del mancante.
- `docs/AI_OPERATING_MODEL.md`: roadmap esplicita su prompt, modelli, skill, agenti, workflow e automazioni.
- `docs/AI_RUNTIME_BRIEF.md`: digest runtime compatto caricato automaticamente dai hook.
- `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md`: lista lineare item AI/globali per review.
- `docs/LINKEDIN_IMPLEMENTATION_LIST.md`: lista lineare item LinkedIn-specifici per review.
- `docs/tracking/`: stato tecnico e verifiche reali.
- `todos/`: priorita' operative correnti.