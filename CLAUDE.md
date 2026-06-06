# CLAUDE.md

@AGENTS.md

Questo file e' l'adapter per Claude Code. Importa `AGENTS.md` (regole operative canoniche) tramite la sintassi `@` raccomandata da Anthropic 2026: il contenuto viene caricato automaticamente nel contesto a session start.

## Ordine di lettura aggiuntivo (oltre AGENTS.md gia' importato sopra)

1. `docs/README.md`
2. `todos/active.md`
3. `todos/workflow-architecture-hardening.md`
4. `docs/tracking/README.md`

> Spec del sistema AI (master spec, backlog ADK, operating model) NON sono più in questo repo: estratte in `AI-Control-Plane/spec/` + `~/.claude` (adk-split). Questo repo è il bot applicativo.

## Regole Claude Code specifiche

- Usare `Claude Code /loop` solo per polling o babysitting di sessione.
- Per automazioni durevoli preferire `n8n`, task desktop/cloud o workflow persistenti.
- Se serve un comportamento tipo `/loop` in un ambiente che non lo offre nativamente, applicare la regola di loop custom definita in `AGENTS.md`.
- Non mantenere backlog grezzi o liste di desideri in questo file: il backlog applicativo è `docs/LINKEDIN_IMPLEMENTATION_LIST.md`; il backlog ADK universale è in `AI-Control-Plane/spec/`.
- `docs/AI_RUNTIME_BRIEF.md` non e' una fonte manuale separata: viene reiniettato automaticamente dai hook `SessionStart`, `UserPromptSubmit` e `PreCompact`.
- `docs/LINKEDIN_IMPLEMENTATION_LIST.md` è il backlog lineare LinkedIn per review e pruning; non è fonte primaria del mancante.
- La scelta contestuale di skill, MCP, web/docs, loop, piano e workflow deve partire automaticamente a ogni prompt e a ogni modifica rilevante, non su sollecito dell'utente.
- Gli esempi dell'utente sono pattern di ragionamento da estendere, mai liste chiuse.
  Da ogni esempio inferire anche altri controlli, rischi e punti coerenti con l'intento.

## Ruoli dei file guida

- `AGENTS.md`: comportamento operativo di progetto.
- `docs/AI_RUNTIME_BRIEF.md`: digest runtime compatto del progetto caricato automaticamente dai hook.
- `docs/LINKEDIN_IMPLEMENTATION_LIST.md`: lista lineare item LinkedIn-specifici per review.
- `docs/tracking/`: stato tecnico e verifiche reali.
- `todos/`: priorita' operative correnti.
- Spec del sistema AI universale (master spec, backlog ADK, operating model, orchestrator contract) → `AI-Control-Plane/spec/` + `~/.claude` (estratte via adk-split, non più in questo repo).