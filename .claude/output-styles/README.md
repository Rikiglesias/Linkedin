# Output styles

> Questo progetto non mantiene piu' definizioni output-style locali.
> Gli style riusabili vivono a livello utente in `C:\Users\albie\.claude\output-styles\`, coerente con la documentazione Claude Code.

## Stili globali disponibili

| File | Quando usare |
|---|---|
| `C:\Users\albie\.claude\output-styles\terse.md` | Risposte code-only, no prose. Utile per coding session lunghe |
| `C:\Users\albie\.claude\output-styles\italian-concise.md` | Risposte italiane brevi; override utile quando Caveman ultra spinge verso tono inglese/iper-sintetico |

## Quando definire un nuovo stile

- Riccardo nota miss ricorrente di tone/format del modello su task specifico
- Compatibilita' Caveman ultra non gestita per lingua/contesto
- Distribuzione team: stile uniforme per il progetto

## Cosa NON è uno output-style

- Skill (vive in `~/.claude/skills/` o `.claude/skills/`)
- Hook (vive in `~/.claude/hooks/`)
- Regola path-scoped (vive in `.claude/rules/`)
- Runtime brief (vive in `docs/AI_RUNTIME_BRIEF.md`)
