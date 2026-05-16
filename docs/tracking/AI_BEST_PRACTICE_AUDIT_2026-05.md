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

## Categoria 2 — Hook PowerShell (`~/.claude/hooks/*.ps1`)

### Fonti best practice consultate (Microsoft 2026)

- [PSScriptAnalyzer rules and recommendations](https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/rules-recommendations?view=ps-modules)
- [Using PSScriptAnalyzer](https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/using-scriptanalyzer?view=ps-modules)
- [Set-StrictMode documentation](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/set-strictmode?view=powershell-7.6)
- [about_Preference_Variables (ErrorActionPreference)](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_preference_variables?view=powershell-7.6)

### Best practice ufficiali identificate

| BP | Cosa dice Microsoft | Severita' |
|---|---|---|
| `Set-StrictMode -Version Latest` | Genera errore terminating su variabili undefined, indexing fuori range, property non esistenti | Alta — previene bug silenziosi |
| `$ErrorActionPreference = 'Stop'` | Default 'Continue' permette silently failures; 'Stop' = fail-fast | Alta — comportamento prevedibile |
| Verb-Noun + approved verbs (`Get-Verb`) | Consistency con cmdlet built-in | Media |
| `param()` block all'inizio | Standard struttura script | Media |
| Comment-based help `<# .SYNOPSIS .DESCRIPTION #>` | Auto-generated help via `Get-Help` | Bassa stilistica |
| `try/catch` per error handling esplicito | Resilienza | Media |
| Avoid `Write-Host` → preferire `Write-Output` o `Write-Information` | Output redirectable | Media |
| `Out-Null` over `> $null` | Best practice PSScriptAnalyzer | Bassa |
| `CmdletBinding()` per advanced functions | Param validation + `-WhatIf`/`-Confirm` | Media (solo funzioni) |
| PSScriptAnalyzer come lint | CI/CD integration | Strumento |

### Stato nostro sistema (verificato 2026-05-15, 2 hook campione)

| Hook | Righe | Strict | ErrorAction | Naming | param() | Note |
|---|---|---|---|---|---|---|
| `_lib.ps1` | 313 | ❌ | ❌ | ✅ Verb-Noun | n/a | Header comment + API contract eccellente |
| `inject-runtime-brief.ps1` | 58 | ❌ | ❌ | ✅ | ✅ | Encoding UTF-8 forzato (buona pratica Win) |
| 30 altri hook (non letti dettaglio) | varie | ❌ presunto | ❌ presunto | ✅ campione | ✅ campione | Pattern coerente nei 2 campione |

**PSScriptAnalyzer**: NON installato globalmente. Comando `Install-Module PSScriptAnalyzer -Scope CurrentUser` lo aggiungerebbe.

### Gap identificati

1. **MEDIO** — Manca `Set-StrictMode -Version Latest` in tutti i 32 hook. Variabili undefined possono passare inosservate. Rischio: bug silenziosi su edge case (es. campo JSON input mancante).
2. **MEDIO** — Manca `$ErrorActionPreference = 'Stop'` esplicito. Default 'Continue' permette cmdlet di fallire silenziosi e continuare. Rischio: hook che dovrebbero bloccare azione rischiosa potrebbero non farlo se il check fallisce silently.
3. **MINOR** — Comment-based help formale `<# .SYNOPSIS #>` non usato. Solo header comments. Stilistica.
4. **MINOR** — PSScriptAnalyzer non installato per audit periodico hook. Strumento utile in CI.

### Positivi rilevanti

- ✅ API contract di `_lib.ps1` documentato con link a docs ufficiale Anthropic 2026
- ✅ Single source of truth per pattern critico (es. `$ANTIBAN_PATTERN`)
- ✅ Whitelist directory + estensione (.md/.txt/.log/.csv) per evitare falsi positivi anti-ban
- ✅ Encoding UTF-8 forzato `[Console]::InputEncoding` (workaround problema noto Windows)
- ✅ Dot-source di `_lib.ps1` per condividere logica comune (DRY)

### Fix applicati in questa sessione

NESSUNO. Rischio modifica 32 hook = potenziali regressioni. Applicare in sessione dedicata con test.

### Fix proposti per sessioni future

1. **Aggiungere init block in `_lib.ps1`** (1 fix → propagato a tutti gli hook che fanno `. _lib.ps1`):
   ```powershell
   Set-StrictMode -Version Latest
   $ErrorActionPreference = 'Stop'
   ```
   Procedura:
   - (a) test su 1 hook isolato per verificare no regressioni
   - (b) commit con singolo hook modificato + observe per 1 settimana
   - (c) propagare a `_lib.ps1` se nessun fallout
   - (d) per hook che NON dot-source `_lib.ps1`, fix individuale

2. **Installare PSScriptAnalyzer + aggiungere `audit:hooks-static-analysis`** npm script:
   ```powershell
   Install-Module PSScriptAnalyzer -Scope CurrentUser
   Invoke-ScriptAnalyzer -Path "$HOME\.claude\hooks" -Recurse
   ```
   Inserire in bundle `audit:weekly` come check informativo.

3. **Convertire header comments in comment-based help** (`<# .SYNOPSIS .DESCRIPTION .PARAMETER #>`) per i 5 hook piu' complessi. Bassa priorita'.

### Audit verdi mantenuti

- `audit:hooks` ✅ 17/17 (registry conformity)
- Quality gate ✅ 1430/1430 test

---

## Sintesi corrente

| Categoria | Stato | Gap critici | Fix applicati ora | Fix proposti futuro |
|---|---|---|---|---|
| 1. Markdown canonici | ✅ | 1 (`@AGENTS.md`) | 1 | 1 (split AGENTS.md) |
| 2. Hook PowerShell | ✅ audit | 2 medi (StrictMode, ErrorAction) | 0 (rischio regressione su 32 file) | 3 (init in `_lib.ps1`, PSScriptAnalyzer, comment-help) |
| 3-13 | ⏳ | — | — | — |

**Working tree**: pulito.
**Audit**: tutti verdi.
**Quality gate**: ultimo run 1430/1430 test passati.
