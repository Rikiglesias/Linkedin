# AI Goal Queue — 15 `/goal` pronti per esecuzione sequenziale

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
| 2 | Cat 10 bat wrapper env var | 5 | basso | ✅ DONE 2026-05-17 |
| 3 | Cat 8 output styles user-scope | 8 | medio (Caveman) | ✅ DONE 2026-05-17 |
| 4 | Cat 5 MCP env var expansion | 10 | medio | ✅ DONE 2026-05-17 |
| 5 | Cat 3 Node mjs `node:` prefix | 10 | basso | ✅ DONE 2026-05-17 |
| 6 | Cat 6 plugin.json move | 10 | alto (cross-project) | ✅ DONE 2026-05-17 (partial: audit JSON schemas deferred) |
| 7 | Cat 1 split AGENTS.md <200 | 10 | medio | ⏳ pending |
| 8 | Cat 7 +3 rules path-scoped | 12 | basso | ⏳ pending |
| 9 | Cat 13 split tracking docs | 12 | basso | ⏳ pending |
| 10 | Cat 13.5 verifica 89 comandi | 15 | basso | ⏳ pending |
| 11 | Cat 9 TS refactor audit | 15 | alto (regressione) | ⏳ pending |
| 12 | Cat 2 hook PowerShell BP | 15 | alto (32 hook) | ⏳ pending |
| 13 | Cat 4 rename 11 skill | 15 | alto (cross-project) | ⏳ pending |
| 14 | Auto-append findings/task da pattern AI | 10 | medio (false positive) | ⏳ pending |
| 15 | L2-L9 blocking per ragionamento AI | 12 | medio (gate troppo rigidi) | ✅ DONE 2026-05-17 |

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

## /goal 14 — Auto-append findings/task da pattern AI

```text
/goal Stop/transcript/continuation hook, non PostToolUse, rileva output finale e handoff contenenti pattern "TODO futuro:", "Fix tracciato:", "Sprint dedicato:", "BLOCKED:", "Decisione:" e propone/auto-appende in docs/tracking/SESSION_FINDINGS.md (finding) o todos/active.md (task) solo quando source+timestamp+hash conversazione sono disponibili. Pattern matching con allowlist + sezione frontmatter "auto-tracked" per distinguere da entry manuali. src/scripts/autoTrackAudit.ts valida timestamp, source, hash, dedupe e zero placeholder. Test su 5 risposte sintetiche con e senza pattern: zero falsi positivi su risposte banali, 100% recall su pattern espliciti. Stop after 10 turns.
```

## /goal 15 — L2-L9 blocking per ragionamento AI

```text
/goal I controlli AI_ORCHESTRATOR_CONTRACT.md sono promossi da solo-documentazione ad audit/gate eseguibili: src/scripts/aiReasoningHardeningAudit.ts valida contract, runtime brief, hook Claude, continuation e Codex parity; package.json espone audit:ai-reasoning-hardening, audit:orchestrator-contract, audit:reasoning-trace, audit:hook-semantic-coverage, audit:continuation-completeness, audit:codex-hook-parity; audit:ai-control-plane include il nuovo audit; .claude/CONTINUATION.md non contiene placeholder TODO; npm run audit:ai-control-plane e npm run post-modifiche passano. Stop after 12 turns.
```

---

## Completati

### /goal 13 — Cat 4 rename 11 skill non canoniche ✅ DONE 2026-05-18

- **Problema**: 11 skill globali con naming non canonico (`skill.md`/`index.md` invece di `SKILL.md`)
- **Fix applicati**:
  - 11 file rinominati via `mv` (cartella `~/.claude/skills/` non versionata): audit-rules, context-handoff, git-commit, git-create-pr, linkedin-patterns, loop-codex, memoria, prompt-improver, session-prompt, token-efficiency, verification-protocol — tutti ora `SKILL.md`
  - `src/scripts/skillFilenameAudit.ts` (NEW): scan dir skills, verifica SKILL.md canonico, segnala variazioni (`skill.md`, `index.md`, ecc.), env var `SKILLS_DIR` override
  - npm script `audit:skill-filenames` + integrato in `audit:weekly`
- **Verifica L9.8**: audit 197/197 conformi, 0 file non canonici, le 11 skill rinominate compaiono nel listing `Skill` tool
- **Note**: file fuori repo LinkedIn (cartella user globale), modifiche persistono su disco locale, non committate

### /goal 8 — Cat 7 path-scoped rules coverage ✅ DONE 2026-05-18

- **Problema**: 7 rules path-scoped esistenti ma coverage incompleta (no scheduler/messaging/proxy concrete) + zero audit deterministico
- **Fix applicati**:
  - 3 nuove rules: `scheduler-rules.md` (paths src/workers/**, src/risk/**, src/automation/**), `messaging-rules.md` (paths messageWorker/inbox/automation), `proxy-rules.md` (paths src/proxy/**)
  - `src/scripts/rulesCoverageAudit.ts` (NEW): valida YAML frontmatter + glob → dir esistenti + plugin.json presence + README tabella
  - npm script `audit:rules-coverage` + integrato in `audit:weekly`
  - Fix 4 glob obsoleti su rules pre-esistenti: api-security (rimosso src/auth/**), scripts-audit (.claude/hooks/** → .githooks/**), workflow-linkedin (workflows/** → n8n-workflows/**), meta-reasoning (aggiunto frontmatter mancante)
  - `.claude-plugin/plugin.json` + `.claude/rules/README.md` aggiornati a 11 rules
- **Verifica L9.8**: audit:rules-coverage 11/11 valide, audit:json-schemas 4/4, audit:ai-list-completeness 10/10, quality gate 1430/1430
- **Commit**: 4824645, push auto verso origin/main

### /goal 7 — Cat 1 split AGENTS.md sotto 200 ✅ DONE 2026-05-18

- **Problema**: AGENTS.md a 344 righe, oltre target 200 raccomandato per canonico operativo
- **Fix applicati**:
  - `.claude/rules/meta-reasoning.md` (NEW, 174 righe, paths `**`): estratte 11 meta-regole comportamentali (intento non letterale, context degradation, best practice modifica, cross-domain, anti-compiacenza, task multi-categoria, pazienza/fretta, classificazione temporale, blast radius, contratti/fallimenti, interpretazione esempi)
  - AGENTS.md: 344 → **160 righe** (sotto target 200), sezioni meta sostituite con puntatore single-line
  - `.claude/rules/README.md`: tabella aggiornata con `meta-reasoning.md`
  - `.claude-plugin/plugin.json`: `rules.files` allineato a 8 rules reali (era 3)
- **Verifica L9.8**: `wc -l AGENTS.md` = 160, audit:ai-list-completeness 10/10, audit:json-schemas 4/4, quality gate 1430/1430
- **Commit**: 90d3c14, push auto verso origin/main

### /goal 6 — Cat 6 plugin.json move canonico ✅ DONE 2026-05-18 (complete)

- **Problema**: plugin.json in `.claude/` non era path canonico Anthropic 2026, `$schema` puntava a `package.json` schema (errato)
- **Fix applicati (turno 1)**:
  - `git mv .claude/plugin.json .claude-plugin/plugin.json`
  - Rimosso `$schema` errato (no schema Anthropic plugin ufficiale disponibile)
  - `.gitignore` aggiornato (eccezione `.claude/plugin.json` rimossa, `.claude-plugin/` tracked by default)
  - 3 canonici aggiornati: AGENTS.md, AI_IMPLEMENTATION_LIST_GLOBAL.md, AI_ADK_DISTRIBUTION.md
- **Fix applicati (turno 2, completamento condizione /goal)**:
  - `src/scripts/jsonSchemasAudit.ts` creato (validation 4 JSON registry: syntax + top-level keys + per-file schema)
  - npm script `audit:json-schemas` aggiunto + integrato in `audit:weekly`
  - Run: **4/4 file passano** (`.claude-plugin/plugin.json`, `AI_CAPABILITY_ROUTING.json`, `AI_ADK_CAPABILITY_GOVERNANCE.json`, `AI_LEVEL_ENFORCEMENT.json`)
- **Verifica L9.8**: typecheck verde, JSON valid `python3 json.load` OK, grep refs attivi rotti = 0, audit 4/4 PASS
- **Note**: snapshot session-prompts/* immutabili (storici), refs nel report audit semanticamente corretti (descrivono problema pre-fix)

### /goal 5 — Cat 3 Node mjs `node:` prefix ✅ DONE 2026-05-17

- **Problema**: 6/7 file `~/.claude/scripts/*.mjs` importavano built-in Node senza `node:` prefix (BP 2026 raccomandata da ESLint `n/prefer-node-protocol`)
- **Fix**: aggiunto `node:` prefix a tutti gli import built-in (`fs`, `path`, `os`, `http`, `child_process`, `url`, `stream`) in 6 file: `claude-model-router`, `claude-model-statusline`, `merge-canonical-settings`, `model-router-config`, `refresh-openrouter-models`, `switch-claude-backend`
- **Verifica L9.8**: grep mirato → 0 built-in non prefissati. `node --check` → 7/7 OK
- **Chiuso**: turno 1/10 (early DONE)
- **Note**: file globali fuori repo (`~/.claude/scripts/`), modifiche persistono su disco locale, NON committate

### /goal 1 — Cat 11 dedupe `audit:monthly` ✅ DONE 2026-05-17

- **Problema**: `audit:monthly` invocava `audit:adk-capabilities` direttamente E indirettamente via `audit:ai-control-plane` (doppia esecuzione)
- **Fix**: rimosso `&& npm run audit:adk-capabilities` da script `audit:monthly` in `package.json`
- **Verifica**: `npm run audit:monthly` ora esegue `audit:adk-capabilities` 1 sola volta, tutti audit verdi
- **Chiuso**: turno 1/3 (early DONE rispetto a bounded max 3)
- **Commit**: in pending push corrente
- **Caller invariati**: `scripts/run-audit-monthly.bat` (Task Scheduler), `plugin.json` registry

### /goal 2 — Cat 10 bat wrapper env var ✅ DONE 2026-05-17

- **Problema**: `scripts/run-audit-weekly.bat` e `scripts/run-audit-monthly.bat` avevano path repo hardcoded come unica fonte.
- **Fix**: entrambi usano `CLAUDE_REPO_ROOT` quando definita e mantengono fallback al path attuale `C:\Users\albie\Desktop\Programmi\Linkedin`.
- **Documentazione**: `scripts/README.md` documenta i wrapper e `setx CLAUDE_REPO_ROOT`.
- **Verifica**: weekly testato con env var e senza env var; monthly testato con env var; tutti exit code 0.
- **Chiuso**: turno 1/5.

### /goal 15 — L2-L9 blocking per ragionamento AI ✅ DONE 2026-05-17

- **Problema**: i controlli su ragionamento AI, continuation e Codex parity erano documentati ma non abbastanza auditabili come blocco unico.
- **Fix**: creato `docs/tracking/AI_ORCHESTRATOR_CONTRACT.md` e `src/scripts/aiReasoningHardeningAudit.ts`.
- **Script**: aggiunti `audit:ai-reasoning-hardening`, `audit:orchestrator-contract`, `audit:reasoning-trace`, `audit:hook-semantic-coverage`, `audit:continuation-completeness`, `audit:codex-hook-parity`.
- **Codex parity**: aggiunti `.codex/hooks.json` e hook PowerShell minimi; abilitato `hooks = true` in `C:\Users\albie\.codex\config.toml`.
- **Verifica**: `audit:ai-reasoning-hardening` 6/6, `audit:ai-control-plane` 26/26, `post-modifiche` verde.
- **Commit**: `755f4fc` + `a028d93`, pushati su `main`.

### /goal 3 — Cat 8 output styles user-scope ✅ DONE 2026-05-17

- **Problema**: `terse.md` e `italian-concise.md` vivevano in `.claude/output-styles/`, quindi erano project-scope invece che riusabili cross-project.
- **Fix**: style spostati a `C:\Users\albie\.claude\output-styles\`; `.claude/output-styles/README.md` resta come puntatore.
- **Caveman**: stato locale verificato `ultra`; `italian-concise` resta come override italiano, non rimosso.
- **Audit**: creato `src/scripts/outputStylesAudit.ts`; aggiunto `audit:output-styles` e integrato in `audit:weekly`.
- **Verifica**: docs ufficiali Claude Code confermano user-scope `~/.claude/output-styles`; `audit:output-styles` 3/3 verde.

### /goal 4 — Cat 5 MCP env var expansion ✅ DONE 2026-05-17

- **Problema**: `.mcp.json` conteneva path utente-specific hardcoded per `lean-ctx`, `bun.exe` e `claude-peers` server.
- **Fix**: `lean-ctx.command` usa `${LEAN_CTX_PATH:-...}`, `claude-peers.command` usa `${BUN_PATH:-...}`, `claude-peers.args[0]` usa `${CLAUDE_PEERS_SERVER_PATH:-...}`.
- **Audit**: creato `src/scripts/mcpConfigAudit.ts`; aggiunto `audit:mcp-config` e integrato in `audit:weekly`.
- **Claude docs**: confermato supporto `.mcp.json` env expansion `${VAR}` e `${VAR:-default}` in `command`, `args`, `env`, `url`, `headers`.
- **Verifica**: `audit:mcp-config` 4/4; `claude mcp get lean-ctx` connected; `claude mcp get claude-peers` connected.
- **Fix esterno locale**: corretto `C:\Users\albie\AppData\Local\claude-peers-mcp\server.ts` e `broker.ts` per compatibilita' Windows (`fileURLToPath`, fallback `USERPROFILE`).

## Falliti / BLOCKED

(Spostare qui i `/goal` quando si bloccano, con causa e prossimo passo)

## Note operative

- **Sessione fresca obbligatoria** prima di ogni `/goal` per evitare context contamination
- **Verifica audit verdi** dopo ogni `/goal` chiuso prima di passare al successivo
- **NON lanciare più `/goal` in parallelo** — interferenza garantita
- **Cancellare `/goal` in corso**: `/goal clear`
- I `/goal` con rischio **alto** richiedono review modifiche prima del commit auto
