# AI Best Practice Audit — 2026-05

> Audit completo dei file del sistema AI globale vs best practice ufficiali 2026.
> Trigger: utente — verificare aderenza best practice web-verified.
> Approccio: 13 categorie file, una sezione per categoria. Web-verified per ogni categoria.
> Status: in corso. Ultima sezione completata: Categoria 1 (markdown canonici).

## Indice categorie

1. ✅ Markdown canonici (CLAUDE.md, AGENTS.md, runtime brief, master spec)
2. ⏳ Hook PowerShell (`~/.claude/hooks/*.ps1`)
3. ⏳ Hook Node/MJS (`~/.claude/scripts/*.mjs`)
4. ⏳ Skill SKILL.md (`~/.claude/skills/*/SKILL.md`)
5. ⏳ MCP config (settings.json mcpServers + MCP servers)
6. ⏳ JSON registry (AI_CAPABILITY_ROUTING.json, AI_ADK_CAPABILITY_GOVERNANCE.json, AI_LEVEL_ENFORCEMENT.json, plugin.json)
7. ⏳ Path-scoped rules (`.claude/rules/*.md`)
8. ⏳ Output styles (`.claude/output-styles/*.md`)
9. ⏳ TypeScript audit script (`src/scripts/*Audit.ts`)
10. ⏳ Bat wrapper (`scripts/run-audit-*.bat`)
11. ⏳ package.json (npm scripts AI section)
12. ⏳ .gitignore (AI section)
13. ⏳ Tracking docs (`docs/tracking/AI_*.md`)

---

## Categoria 1 — Markdown canonici

### Fonti best practice consultate (2026)

- [Anthropic Claude Code: Best practices](https://code.claude.com/docs/en/best-practices)
- [Anthropic Claude Code: How Claude remembers your project (CLAUDE.md)](https://code.claude.com/docs/en/claude-md)
- [Anthropic Claude Code: Memory](https://code.claude.com/docs/en/memory.md)
- [Anthropic Claude Code: .claude directory](https://code.claude.com/docs/en/claude-directory)

### Best practice ufficiali identificate

| BP | Cosa dice Anthropic | Source |
|---|---|---|
| Size CLAUDE.md | Target sotto 200 righe per file. Oltre riduce aderenza. | claude-md docs |
| Specificity | "Use 2-space indentation" > "Format code properly" | claude-md docs |
| Structure | Markdown headers + bullets, no dense paragraph | claude-md docs |
| AGENTS.md handling | Claude Code legge solo `CLAUDE.md`. Per AGENTS.md: importarlo con `@AGENTS.md` syntax in CLAUDE.md | claude-md docs |
| Path-scoped rules | Split di istruzioni grandi in `.claude/rules/*.md` con frontmatter `paths:` | claude-md docs |
| User-level | `~/.claude/CLAUDE.md` per preferenze cross-project | claude-md docs |
| Local override | `CLAUDE.local.md` gitignored per preferenze personali progetto | claude-md docs |
| Import recursivo | `@path/to/file` syntax, max 5 hops, paths relative al file importante | claude-md docs |
| HTML comments | `<!-- maintainer notes -->` strippati prima dell'iniezione, non consumano context | claude-md docs |
| Auto memory | `~/.claude/projects/<project>/memory/MEMORY.md` (200 righe / 25KB caricate) | claude-md docs |
| Compaction | CLAUDE.md di project-root sopravvive a `/compact` automaticamente | claude-md docs |

### Stato nostro sistema (verificato 2026-05-15)

| File | Righe | Verdetto | Note |
|---|---|---|---|
| `CLAUDE.md` repo | 39 | ✅ < 200 | Adapter Claude Code |
| `~/.claude/CLAUDE.md` globale | ~165 | ✅ < 200 | User-level instructions |
| `AGENTS.md` repo | 541 | ⚠️ sopra 200 | **Importato in CLAUDE.md** → consuma 541 righe context. Split in path-scoped rules consigliato (futuro). |
| `docs/AI_RUNTIME_BRIEF.md` | 181 | ✅ | Reiniettato via hook, non importato in CLAUDE.md |
| `docs/AI_MASTER_SYSTEM_SPEC.md` | 725 | ✅ canonico spec, non in context per default |
| `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md` | 1018 | ✅ backlog madre, non in context per default |
| `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md` | 644 | ✅ vista lineare derivata |
| `CLAUDE.local.md.template` | esiste | ✅ | + `.gitignore` esclude `CLAUDE.local.md` reale |

### Gap identificati

1. **CRITICO** — `CLAUDE.md` repo elenca file da leggere come "Ordine di lettura" ma NON usa `@AGENTS.md` import syntax. Anthropic raccomanda esplicitamente:
   ```markdown
   @AGENTS.md

   ## Claude Code

   Use plan mode for changes under `src/billing/`.
   ```
   Questo importa AGENTS.md nel contesto automaticamente invece che lasciare al modello l'iniziativa di leggerlo.

2. **MEDIO** — `AGENTS.md` 541 righe consumate come context CLAUDE.md effettivo (quando importato). Anthropic raccomanda < 200 per aderenza. Soluzione strategica: split in path-scoped rules `.claude/rules/<dominio>.md` con `paths:` frontmatter. Già abbiamo 3 rules path-scoped (`browser-antiban.md`, `api-security.md`, `scripts-audit.md`) ma AGENTS.md contiene anche regole generiche non scopabili (anti-compiacenza, classificazione temporale, pazienza vs fretta).

3. **MINOR** — Nessun `~/.claude/rules/` user-level rules. Opzionale.

4. **MINOR** — Mai eseguito `/init` (CLAUDE.md creato manualmente). Non bloccante perché il nostro CLAUDE.md è ragionato.

### Fix applicati in questa sessione

- ✅ Adottato `@AGENTS.md` import syntax in `CLAUDE.md` repo (1 riga, basso costo, alto valore: AGENTS.md ora caricato esplicitamente come da raccomandazione Anthropic).

### Fix proposti per sessioni future

- Split `AGENTS.md` (541 righe) in path-scoped rules per dominio (es. `git`, `model-selection`, `commit-policy`, `anti-compiacenza`, `pazienza-vs-fretta`, `classificazione-temporale`, `workflow-autonomi`). Lasciare in AGENTS.md solo metadata + index. Target: AGENTS.md < 200 righe + 6-8 rules in `.claude/rules/`.
- Valutare `~/.claude/rules/` per preferenze cross-project (es. lingua italiana, voice dictation). Bassa priorita'.

### Audit verdi mantenuti

- `audit:ai-control-plane:docs` ✅ 25/25
- `audit:ai-list-completeness` ✅ 10/10
- `audit:docs-size` 🟡 informativo (AGENTS.md 541 > soft 500, non bloccante)

---

## Categoria 2-13 (in attesa di prossimo turn)

Verranno aggiunte qui sotto man mano che `/goal` (lanciato dall'utente) procede categoria per categoria con web search dedicata per ognuna.

---

## Sintesi corrente

| Categoria | Stato | Gap critici | Fix applicati | Fix proposti |
|---|---|---|---|---|
| 1. Markdown canonici | ✅ | 1 critico (`@AGENTS.md` import) | 1 (adottato `@AGENTS.md`) | 1 (split AGENTS.md) |
| 2-13 | ⏳ | — | — | — |

**Working tree**: pulito.
**Audit**: tutti verdi.
**Quality gate**: ultimo run 1430/1430 test passati.
