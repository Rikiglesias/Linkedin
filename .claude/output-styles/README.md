# .claude/output-styles/

> Custom response format definitions per Claude Code (pattern community 2026).
> Selezionabili via `/output-style <name>` o tramite `.claude/settings.json` → `outputStyle: "<name>"`.

## Stili disponibili

| File | Quando usare |
|---|---|
| `terse.md` | Risposte code-only, no prose. Utile per coding session lunghe |
| `italian-concise.md` | Risposte italiane brevi (workaround per Caveman ultra inglese-specifico) |

## Quando definire un nuovo stile

- Riccardo nota miss ricorrente di tone/format del modello su task specifico
- Compatibilità Caveman ultra non gestita per lingua/contesto
- Distribuzione team: stile uniforme per il progetto

## Cosa NON è uno output-style

- Skill (vive in `~/.claude/skills/` o `.claude/skills/`)
- Hook (vive in `~/.claude/hooks/`)
- Regola path-scoped (vive in `.claude/rules/`)
- Runtime brief (vive in `docs/AI_RUNTIME_BRIEF.md`)
