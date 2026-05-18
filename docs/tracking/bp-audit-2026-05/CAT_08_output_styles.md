## Categoria 8 — Output styles

### Fonti best practice consultate (2026)

- [Anthropic Claude Code: Output styles](https://code.claude.com/docs/en/output-styles)
- [Anthropic Claude Docs: Output styles](https://docs.claude.com/en/docs/claude-code/output-styles)
- [ClaudeLog: Output styles guide](https://claudelog.com/mechanics/output-styles/)
- [Practical guide to output styles — eesel AI](https://www.eesel.ai/blog/output-styles-claude-code)

### Best practice ufficiali identificate

| BP | Cosa dice Anthropic 2026 | Severity |
|---|---|---|
| Struttura | Markdown con YAML frontmatter (`name`, `description`) + body = system prompt instructions | HIGH |
| Posizione user | `~/.claude/output-styles/*.md` per cross-project (canonical da `/output-style:new`) | MEDIUM |
| Posizione project | `.claude/output-styles/*.md` per project-specific | MEDIUM |
| Selection storage | `.claude/settings.local.json` (project) | LOW |
| Built-in styles | Default, Proactive, Explanatory, Learning | n/a |
| Non-default exclude | Output styles non-default escludono istruzioni code-gen/concise built-in di Claude Code | HIGH |
| Token cost | Cached dopo prima request della sessione | LOW |
| Quando usare | Per voice/format consistente, non per regole di progetto (quelle in CLAUDE.md) | MEDIUM |

### Stato nostro sistema — count verificato L9.8

| File | Frontmatter `name + description` | Posizione | Note |
|---|---|---|---|
| `italian-concise.md` | ✅ | `.claude/output-styles/` project | "workaround per Caveman ultra inglese-specifico" |
| `terse.md` | ✅ | `.claude/output-styles/` project | Code-only responses |
| `README.md` | ❌ (descrittivo) | `.claude/output-styles/` project | Documentazione cartella |

**Totale file**: 3 (2 output style + 1 README) — verificato `ls *.md | wc -l = 3`

### Gap identificati

| # | Gap | Severity | Evidenza |
|---|---|---|---|
| 1 | Output styles in project scope `.claude/output-styles/` invece di user-scope `~/.claude/output-styles/` | LOW | Project-scope OK ma non riusabili su altri progetti dell'utente. Per ADK riusabile → user-scope canonical. |
| 2 | `italian-concise` documentato come workaround anti-Caveman, non come output style genuino | MEDIUM | Sintomo: la skill Caveman forza inglese, italian-concise lo bypassa. Root cause migliore: rimuovere Caveman se non serve, o configurarlo per output italiano. |
| 3 | Nessun audit script che verifica YAML frontmatter validity per output styles | LOW | gap futuro |
| 4 | Nessuna dichiarazione esplicita di quale output style è "selected" nel progetto | LOW | Settings local privato, OK per utente singolo |

### Verifica conformità

- ✅ 2 output style con frontmatter `name + description` corretto
- ✅ Body markdown con regole concrete
- ⚠️ Project-scope vs user-scope: scelta consapevole se LinkedIn-specific, ma blocca portabilità ADK
- ⚠️ italian-concise è workaround, non output style architetturale pulito

### Fix proposti — NON applicati in questo turno

1. **Valutare migrazione a user-scope**: spostare `italian-concise.md` e `terse.md` in `~/.claude/output-styles/` per riuso cross-project. Tracciare in `AI_ADK_DISTRIBUTION.md`.
2. **Risolvere root cause Caveman**: verificare se Caveman serve davvero; se sì, configurarlo per italiano; se no, rimuoverlo. `italian-concise` diventa quindi standalone output style, non workaround.
3. **Audit script** `audit:output-styles.ts` minimale che verifica frontmatter parse + body non vuoto.

**Risk**: basso. Output styles non bloccano build/test/run.

---

