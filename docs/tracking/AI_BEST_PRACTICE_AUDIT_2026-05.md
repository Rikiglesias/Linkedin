# AI Best Practice Audit — 2026-05 (INDEX)

> Audit completo dei file del sistema AI globale vs best practice ufficiali 2026.
> Trigger: utente — verificare aderenza best practice web-verified.
> Approccio: 13 categorie file, una sezione per categoria. Web-verified per ogni categoria.
> Status: audit categorie 1-13 completato. Fix futuri tracciati per gli item non chiusi.
>
> **Split 2026-05-18** (/goal 9): documento originale 799 righe splittato in 13 file categoria sotto `bp-audit-2026-05/` per ridurre dimensione e migliorare leggibilità. Questo file è l'indice di navigazione.

## 13 categorie

| # | Categoria | File |
|---|---|---|
| 1 | Markdown canonici (CLAUDE.md, AGENTS.md, runtime brief, master spec) | [`bp-audit-2026-05/CAT_01_markdown.md`](bp-audit-2026-05/CAT_01_markdown.md) |
| 2 | Hook PowerShell (`~/.claude/hooks/*.ps1`) | [`bp-audit-2026-05/CAT_02_hook_powershell.md`](bp-audit-2026-05/CAT_02_hook_powershell.md) |
| 3 | Hook Node/MJS (`~/.claude/scripts/*.mjs`) | [`bp-audit-2026-05/CAT_03_hook_node_mjs.md`](bp-audit-2026-05/CAT_03_hook_node_mjs.md) |
| 4 | Skill SKILL.md (`~/.claude/skills/*/SKILL.md`) | [`bp-audit-2026-05/CAT_04_skill_md.md`](bp-audit-2026-05/CAT_04_skill_md.md) |
| 5 | MCP config (settings.json mcpServers + MCP servers) | [`bp-audit-2026-05/CAT_05_mcp_config.md`](bp-audit-2026-05/CAT_05_mcp_config.md) |
| 6 | JSON registry (AI_CAPABILITY_ROUTING, AI_ADK_CAPABILITY_GOVERNANCE, AI_LEVEL_ENFORCEMENT, plugin.json) | [`bp-audit-2026-05/CAT_06_json_registry.md`](bp-audit-2026-05/CAT_06_json_registry.md) |
| 7 | Path-scoped rules (`.claude/rules/*.md`) | [`bp-audit-2026-05/CAT_07_path_scoped_rules.md`](bp-audit-2026-05/CAT_07_path_scoped_rules.md) |
| 8 | Output styles (`.claude/output-styles/*.md`) | [`bp-audit-2026-05/CAT_08_output_styles.md`](bp-audit-2026-05/CAT_08_output_styles.md) |
| 9 | TypeScript audit script (`src/scripts/*Audit.ts`) | [`bp-audit-2026-05/CAT_09_ts_audit.md`](bp-audit-2026-05/CAT_09_ts_audit.md) |
| 10 | Bat wrapper (`scripts/run-audit-*.bat`) | [`bp-audit-2026-05/CAT_10_bat_wrapper.md`](bp-audit-2026-05/CAT_10_bat_wrapper.md) |
| 11 | `package.json` (npm scripts AI section) | [`bp-audit-2026-05/CAT_11_package_json.md`](bp-audit-2026-05/CAT_11_package_json.md) |
| 12 | `.gitignore` (AI/runtime section) | [`bp-audit-2026-05/CAT_12_gitignore.md`](bp-audit-2026-05/CAT_12_gitignore.md) |
| 13 | Tracking docs (`docs/tracking/AI_*.md`) | [`bp-audit-2026-05/CAT_13_tracking_docs.md`](bp-audit-2026-05/CAT_13_tracking_docs.md) |

## Storico

- 2026-05-15: audit 13 categorie completato in unico file
- 2026-05-18: split in 13 file per ridurre dimensione (audit:docs-size verde)

## Categoria 13.5 — Validazione 89 comandi community

Tracciata separatamente in `/goal 10` (queue): richiede verifica colonna "Source verified" per ognuno dei 89 comandi Claude Code in `CLAUDE_CODE_COMMANDS_REFERENCE.md`.
