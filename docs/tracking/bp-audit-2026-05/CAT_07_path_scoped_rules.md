## Categoria 7 — Path-scoped rules

### Fonti best practice consultate (2026)

- [Anthropic Claude Code: Memory & rules](https://code.claude.com/docs/en/memory)
- [Claude Code Rules Directory: Modular Instructions That Scale](https://claudefa.st/blog/guide/mechanics/rules-directory)
- [How Claude Code rules actually work — Parreo Garcia](https://joseparreogarcia.substack.com/p/how-claude-code-rules-actually-work)
- [GitHub issues #16853, #16299, #23478, #21858, #13905 (bug noti path-scoped)](https://github.com/anthropics/claude-code/issues)

### Best practice ufficiali identificate

| BP | Cosa dice Anthropic 2026 | Severity |
|---|---|---|
| Posizione | `.claude/rules/*.md` project-scope, `~/.claude/rules/*.md` user-scope | HIGH |
| Frontmatter `paths:` | YAML con array di glob pattern, attiva il rule quando Claude legge file matching | HIGH |
| Trigger | Path-scoped rules caricate quando Claude **legge** file matching, NON su Write | MEDIUM (bug #23478) |
| Senza paths | Rule caricato globalmente al launch, priorità come `CLAUDE.md` | LOW |
| YAML syntax | `paths:` come lista YAML (`- pattern`), NO inline array (`paths: [a, b]`) per evitare bug parser | MEDIUM (bug #13905) |
| Bug user-level | `~/.claude/rules/` frontmatter `paths:` ignorato — solo project-scope funziona affidabilmente | MEDIUM (bug #21858) |
| Contenuto | Regole concrete azionabili, non generiche | MEDIUM |

### Stato nostro sistema — count verificato L9.8

| File | Frontmatter `paths:` | YAML valid (head + grep) |
|---|---|---|
| `api-security.md` | ✅ | OK |
| `browser-antiban.md` | ✅ | OK |
| `scripts-audit.md` | ✅ | OK |
| `README.md` | ❌ (è documentazione) | n/a |

**Totale file rules**: 4 (3 con paths frontmatter + 1 README descrittivo) — verificato `ls | wc -l`

### Gap identificati

| # | Gap | Severity | Evidenza |
|---|---|---|---|
| 1 | Bug Anthropic NOTI su path-scoped loading | **HIGH** | Issue #16853, #23478: rule potrebbero NON caricarsi su Write/Edit. Nostro sistema usa anche hook PowerShell come backup → mitigation parziale |
| 2 | Solo 3 rules path-scoped attive | MEDIUM | Coprono: api/auth/security, browser/risk/salesnav, scripts/hooks. NON coperti: `src/scheduler/`, `src/messaging/`, `src/proxy/`, `src/migrations/` |
| 3 | Campo custom `enforcement:` in frontmatter | LOW | Utile metadata interno, ma non Anthropic-recognized (parser ignora) |
| 4 | README `.claude/rules/` cita "manca promozione automatica a hook che legge da qui (oggi gli hook esistenti hanno le regole hardcoded)" | MEDIUM | Riconosciuto come work-in-progress: regole nel .md + regole nei .ps1 = duplicazione potenziale |
| 5 | Nessun audit script che verifica YAML frontmatter validity + coerenza glob vs file esistenti | LOW | gap futuro |

### Verifica conformità

- ✅ 3 rules con `paths:` frontmatter come array YAML (sintassi corretta evita bug #13905)
- ✅ Project-scope `.claude/rules/` (no user-scope dove `paths:` è ignorato — bug #21858)
- ⚠️ Affidamento a hook PowerShell come backup per enforcement (regola → hook hardcoded)
- ❌ Coverage parziale: 3 rules su ~7-8 path critici teorici
- ❌ Nessun audit di consistenza glob

### Fix proposti — NON applicati in questo turno

1. **Audit script** `audit:rules-coverage.ts` che verifica:
   - YAML frontmatter parse OK
   - Glob pattern punta a file esistenti
   - Mapping rule → hook enforcement coerente
2. **Aggiungere rules path-scoped per**:
   - `scheduler-rules.md` → `src/scheduler/**`, `src/risk/**` (anti-ban timing critico)
   - `messaging-rules.md` → `src/messaging/**`, `src/inbox/**`
   - `proxy-rules.md` → `src/proxy/**` (sticky session, residential vs DC)
3. **Risolvere duplicazione regola .md vs hook hardcoded**: hook leggono da `.md` (single source of truth) invece di hardcoded list

**Risk**: basso. Aggiungere rules non rompe nulla. Conferma utente per scope completo.

---

