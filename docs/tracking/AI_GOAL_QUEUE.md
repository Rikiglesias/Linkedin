# AI Goal Queue — 13 `/goal` pronti per esecuzione sequenziale

> Coda di `/goal` derivata da `AI_BEST_PRACTICE_AUDIT_2026-05.md` (28 fix proposti su 13 categorie).
> Ogni `/goal` ha condizione misurabile + bounded mode (stop after N turns) per evitare loop infiniti.
> Lanciare uno per volta in sessione fresca con `/clear` prima.

## Come usare questa coda

1. Apri Claude Code, posizionati in `C:/Users/albie/Desktop/Programmi/Linkedin`
2. `/clear` per sessione pulita
3. Copia-incolla **un singolo blocco `/goal`** sotto
4. Il modello lavora finché Haiku evaluator conferma condizione soddisfatta o raggiunge max turns
5. A fine `/goal`: verifica `git log -3`, sposta entry in "Completati" sotto

## Ordine consigliato (effort crescente, rischio crescente)

| # | Categoria | Turns | Rischio | Stato |
|---|---|---|---|---|
| 1 | Cat 11 dedupe `audit:monthly` | 3 | basso | ✅ DONE 2026-05-17 |
| 2 | Cat 10 bat wrapper env var | 5 | basso | ⏳ pending |
| 3 | Cat 8 output styles user-scope | 8 | medio (Caveman) | ⏳ pending |
| 4 | Cat 5 MCP env var expansion | 10 | medio | ⏳ pending |
| 5 | Cat 3 Node mjs `node:` prefix | 10 | basso | ⏳ pending |
| 6 | Cat 6 plugin.json move | 10 | alto (cross-project) | ⏳ pending |
| 7 | Cat 1 split AGENTS.md <200 | 10 | medio | ⏳ pending |
| 8 | Cat 7 +3 rules path-scoped | 12 | basso | ⏳ pending |
| 9 | Cat 13 split tracking docs | 12 | basso | ⏳ pending |
| 10 | Cat 13.5 verifica 89 comandi | 15 | basso | ⏳ pending |
| 11 | Cat 9 TS refactor audit | 15 | alto (regressione) | ⏳ pending |
| 12 | Cat 2 hook PowerShell BP | 15 | alto (32 hook) | ⏳ pending |
| 13 | Cat 4 rename 11 skill | 15 | alto (cross-project) | ⏳ pending |

---

## /goal 1 — Cat 11 dedupe package.json

```text
/goal package.json npm script audit:monthly NON contiene audit:adk-capabilities duplicato, npm run audit:monthly esegue ogni audit una sola volta verificato con grep, ENGINEERING_WORKLOG aggiornato con check verificato. Stop after 3 turns.
```

## /goal 2 — Cat 10 bat wrapper portabile

```text
/goal scripts/run-audit-weekly.bat e scripts/run-audit-monthly.bat usano %CLAUDE_REPO_ROOT% env var invece di path repo hardcoded, default fallback al path attuale per backward compat, README scripts/ aggiornato documenta come impostare l'env var per ADK distribuito. Stop after 5 turns.
```

## /goal 3 — Cat 8 output styles user-scope

```text
/goal italian-concise.md e terse.md spostati da .claude/output-styles/ a ~/.claude/output-styles/ user-scope per riuso cross-project, Caveman skill verificata se serve davvero (se sì configurata per italiano, se no rimossa risolvendo root cause workaround), src/scripts/outputStylesAudit.ts minimale valida frontmatter+body non vuoto, audit aggiunto a audit:weekly. Stop after 8 turns.
```

## /goal 4 — Cat 5 MCP env var expansion

```text
/goal .mcp.json repo usa ${LEAN_CTX_PATH:-default} e ${BUN_PATH:-default} expansion per i path hardcoded (lean-ctx.exe, bun.exe), src/scripts/mcpConfigAudit.ts creato valida JSON+path resolution+transport coerente con tipo server, audit:mcp-config aggiunto a package.json e integrato in audit:weekly, /mcp reconnect testato senza rotture. Stop after 10 turns.
```

## /goal 5 — Cat 3 Node mjs node prefix

```text
/goal Tutti gli 8 file ~/.claude/scripts/*.mjs usano "node:" prefix sui built-in imports (fs, path, crypto, util, child_process), ogni catch silenzioso "return {}" sostituito con logging esplicito su stderr o file dedicato, node --check exit 0 su tutti gli 8 file. Stop after 10 turns.
```

## /goal 6 — Cat 6 plugin.json move canonico

```text
/goal plugin.json spostato da .claude/ a .claude-plugin/ (path canonico Anthropic 2026), $schema package corretto a schema plugin Anthropic o rimosso se schema non disponibile, grep -rn ".claude/plugin.json" verificato zero reference rotti nel repo, src/scripts/jsonSchemasAudit.ts creato valida tutti i 4 JSON registry. Stop after 10 turns.
```

## /goal 7 — Cat 1 split AGENTS.md sotto 200

```text
/goal AGENTS.md sotto 200 righe verificato con wc -l, sezioni meta-regole comportamentali (Anti-compiacenza, Intento non letterale, Cross-domain, Best practice modifica, Contratti, Blast radius, Interpretazione esempi, Vista 360) estratte in .claude/rules/ con paths "**" oppure compresse mantenendo semantica, audit:ai-list-completeness rimane 10/10 verde, README .claude/rules/ aggiornato. Stop after 10 turns.
```

## /goal 8 — Cat 7 path-scoped rules coverage

```text
/goal Aggiunte 3 path-scoped rules concrete: scheduler-rules.md (paths src/scheduler/**, src/risk/**), messaging-rules.md (paths src/messaging/**, src/inbox/**), proxy-rules.md (paths src/proxy/**). src/scripts/rulesCoverageAudit.ts creato verifica YAML frontmatter parse + glob pattern punta a file esistenti + mapping rule→hook coerente, README .claude/rules/ aggiornato a 10 rules totali. Stop after 12 turns.
```

## /goal 9 — Cat 13 split tracking docs

```text
/goal docs/tracking/AI_BEST_PRACTICE_AUDIT_2026-05.md (799+ righe) splittato in 13 file per categoria (AI_BP_AUDIT_CAT_01_markdown.md ... AI_BP_AUDIT_CAT_13_tracking.md) + AI_BP_AUDIT_INDEX.md, audit:docs-size ritorna verde, link interni nei file modificati aggiornati. Stop after 12 turns.
```

## /goal 10 — Cat 13.5 validazione 89 comandi

```text
/goal docs/tracking/CLAUDE_CODE_COMMANDS_REFERENCE.md ha colonna nuova "Source verified" per ognuno dei 89 comandi (✅ official docs / 🟡 community only / ❓ unverified), verifica fatta su almeno 3 pagine code.claude.com/docs (slash-commands, commands, agent-sdk), 13 comandi già confermati ufficialmente restano ✅. Stop after 15 turns.
```

## /goal 11 — Cat 9 TS audit refactor

```text
/goal Helper duplicati estratti in src/scripts/auditCore.ts (parseMarkdown, readJsonSafe, exec helpers, spawnSync git wrapper), aiControlPlaneAudit.ts splittato in 3 file focalizzati sotto 300 righe ciascuno mantenendo stesso comportamento esterno, audit:ai-control-plane resta 25/25 verde, 1430/1430 test passano. Stop after 15 turns.
```

## /goal 12 — Cat 2 hook PowerShell best practice

```text
/goal Tutti i 32 hook ~/.claude/hooks/*.ps1 hanno Set-StrictMode -Version Latest + $ErrorActionPreference='Stop' iniettati via _lib.ps1 helper Initialize-HookStrictMode chiamato come prima istruzione di ogni hook, PSScriptAnalyzer eseguito con zero warning su almeno 5 hook campione (pre-edit-antiban, pre-edit-secrets, pre-bash-l1-gate, stop-session, post-edit-codebase-hygiene), comment-help <# .SYNOPSIS .DESCRIPTION #> aggiunto agli hook critici, tutti i 32 hook syntax check PSParser::Tokenize OK. Stop after 15 turns.
```

## /goal 13 — Cat 4 rename 11 skill non canoniche

```text
/goal Tutte 11 skill non canoniche (audit-rules/index.md, context-handoff/skill.md, git-commit/skill.md, git-create-pr/skill.md, linkedin-patterns/skill.md, loop-codex/skill.md, memoria/skill.md, prompt-improver/skill.md, session-prompt/index.md, token-efficiency/skill.md, verification-protocol/index.md) rinominate in SKILL.md uppercase con git mv, src/scripts/skillFilenameAudit.ts creato ritorna 197/197 conformi (185 originali + 11 rinominati + 1 nuovo se serve), audit aggiunto a audit:weekly, ogni skill rinominata caricata correttamente in /context. Stop after 15 turns.
```

---

## Completati

### /goal 1 — Cat 11 dedupe `audit:monthly` ✅ DONE 2026-05-17

- **Problema**: `audit:monthly` invocava `audit:adk-capabilities` direttamente E indirettamente via `audit:ai-control-plane` (doppia esecuzione)
- **Fix**: rimosso `&& npm run audit:adk-capabilities` da script `audit:monthly` in `package.json`
- **Verifica**: `npm run audit:monthly` ora esegue `audit:adk-capabilities` 1 sola volta, tutti audit verdi
- **Chiuso**: turno 1/3 (early DONE rispetto a bounded max 3)
- **Commit**: in pending push corrente
- **Caller invariati**: `scripts/run-audit-monthly.bat` (Task Scheduler), `plugin.json` registry

## Falliti / BLOCKED

(Spostare qui i `/goal` quando si bloccano, con causa e prossimo passo)

## Note operative

- **Sessione fresca obbligatoria** prima di ogni `/goal` per evitare context contamination
- **Verifica audit verdi** dopo ogni `/goal` chiuso prima di passare al successivo
- **NON lanciare più `/goal` in parallelo** — interferenza garantita
- **Cancellare `/goal` in corso**: `/goal clear`
- I `/goal` con rischio **alto** richiedono review modifiche prima del commit auto
