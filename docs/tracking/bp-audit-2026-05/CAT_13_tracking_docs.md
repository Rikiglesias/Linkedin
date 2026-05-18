## Categoria 13 — Tracking docs (`docs/tracking/AI_*.md`)

### Fonti best practice consultate (2026)

- [CommonMark specification](https://spec.commonmark.org/)
- [Diataxis: Reference](https://diataxis.fr/reference/)

### Best practice identificate

Tracking non monolitico, claim numerici contati con tool, audit separato dai fix e heading/link stabili per ripresa tra chat.

### Stato nostro sistema

| File | Stato | Note |
|---|---|---|
| `AI_BEST_PRACTICE_AUDIT_2026-05.md` | ✅ categorie 1-13 completate | oltre soft limit, ma audit storico concentrato |
| `AI_ADK_DISTRIBUTION.md` | ✅ OK | sotto soglie |
| `AI_AUDIT_CADENCES.md` | ✅ OK | sotto soglie |
| `AI_HOOK_ENFORCEMENT_PLAN.md` | ✅ OK | sotto soglie |
| `ENGINEERING_WORKLOG.md` | ✅ fixato | 529 righe dopo split 2026-04 |

### Gap identificati

| # | Gap | Severity | Evidenza |
|---|---|---|---|
| 1 | `AI_BEST_PRACTICE_AUDIT_2026-05.md` oltre soft limit | MEDIUM | audit storico completo; futuro split per categoria |

### Fix applicati in questo turno

- ✅ Completate le sezioni 9-13 del report, con fix applicati e gap futuri separati.
- ✅ Split mensile del worklog: aprile archiviato in `ENGINEERING_WORKLOG_2026-04.md`.

### Fix proposti futuri

1. Valutare split di questo audit in `AI_BEST_PRACTICE_AUDIT_2026-05_PART_*.md` se deve diventare canonico ricorrente.

---

## Nota correttiva commit `7abbf2c` (verifica L9.8 retroattiva)

Nel commit message `7abbf2c` "feat(ai-rules): L1-L9 granulari + hook coverage audit + LinkedIn delta" ho scritto:
- "AGENTS.md cresce da 606 a ~665 righe"

**Verifica reale (wc -l ora)**: AGENTS.md = **646 righe** (non ~665). Sovrastima di 19 righe in commit message immutabile (no force-push su main).

**Lezione**: applicata come sub-check **L9.8** in `~/.claude/CLAUDE.md` — ogni numero in summary/commit message va ri-contato con tool nel turno di scrittura.

---

## Sintesi corrente

| Categoria | Stato | Gap critici | Fix applicati ora | Fix proposti futuro |
|---|---|---|---|---|
| 1. Markdown canonici | ✅ | 1 (`@AGENTS.md`) | 1 | 1 (split AGENTS.md) |
| 2. Hook PowerShell | ✅ audit | 2 medi (StrictMode, ErrorAction) | 0 | 3 (init in `_lib.ps1`, PSScriptAnalyzer, comment-help) |
| 3. Hook Node/MJS | ✅ audit | 1 minor (`node:` prefix), 1 medio (silent catch) | 0 | 2 (`node:` prefix refactor, logging esplicito) |
| 4. Skill SKILL.md | ✅ audit | 1 medio (11/197 filename non canonico) | 0 | 3 (rename, audit script, weekly check) |
| 5. MCP config | ✅ audit | 1 HIGH (path hardcoded `.mcp.json`), 1 MEDIUM (no env var expansion) | 0 | 3 (env var expand, audit:mcp-config, weekly) |
| 6. JSON registry | ✅ audit | 1 HIGH (plugin manifest path errato `.claude/` vs `.claude-plugin/`), 1 MEDIUM (`$schema` sbagliato) | 0 | 4 (move plugin.json, fix schema, audit:json-schemas, weekly) |
| 7. Path-scoped rules | ✅ audit | 1 HIGH (bug Anthropic noti su loading), 1 MEDIUM (coverage parziale 3/~8 path critici) | 0 | 3 (audit:rules-coverage, +3 rules path, fix duplicazione hook) |
| 8. Output styles | ✅ audit | 1 MEDIUM (italian-concise è workaround anti-Caveman) | 0 | 3 (user-scope migration, risolvere Caveman root cause, audit:output-styles) |
| 9. TypeScript audit script | ✅ audit | 1 MEDIUM (audit monolitici), 1 MEDIUM (helper duplicati) | 0 | 3 (auditCore, split aiControlPlane, spawnSync git) |
| 10. Bat wrapper | ✅ audit + fix | 1 LOW (path repo hardcoded) | 3 | 1 (path da env var per ADK distribuito) |
| 11. package.json scripts | ✅ audit | 1 LOW (duplicazione `audit:adk-capabilities` in monthly) | 0 | 1 (dedupe monthly) |
| 12. .gitignore | ✅ audit + fix | 0 bloccanti | 1 | 0 |
| 13. Tracking docs | ✅ audit + fix | 1 MEDIUM (`AI_BEST...` > soft) | 1 | 1 (split audit storico se ricorrente) |
| 13.5 Validazione comandi community | ✅ verifica | 76/89 comandi non confermati ufficialmente | 0 | 1 (colonna source verified) |

**Stato**: modifiche in corso; `pre-modifiche` gia' passato, audit e `post-modifiche` da rieseguire.
