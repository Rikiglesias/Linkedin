# AI ADK Distribution

> Decisione su cosa vive globale, cosa progetto-specifico, cosa nel plugin installabile.
> Aggiornato 2026-05-14.

## Principio madre

**Globale** = riusabile su tutti i progetti dello stesso utente → vive in `~/.claude/`.
**Progetto-specifico** = dipende dal dominio del repo → vive in repo (`.claude/`, `AGENTS.md`, ecc.).
**Plugin** = pacchettizzato per distribuzione team/altri utenti → `.claude/plugin.json` con riferimenti versionati.

## Tabella distribuzione

| Elemento | Globale (`~/.claude/`) | Progetto (repo) | Plugin (`.claude/plugin.json`) | Motivo |
|---|---|---|---|---|
| **Skill universali** (typescript-pro, debugging-wizard, claude-api) | ✅ globale | — | reference in plugin.json | Stesse capabilities ovunque |
| **Skill dominio** (antiban-review, audit, deploy-check) | — | ✅ progetto (in skill global ma triggered da context progetto) | reference critico | Dipendono da regole LinkedIn |
| **Hook PowerShell** (anti-ban, secrets, git gate) | ✅ globale | — | reference + installation steps | Stessi gate ovunque |
| **Path-scoped rules** (`.claude/rules/browser-antiban.md`) | — | ✅ progetto, gitignored eccetto questa cartella | versionato in plugin | Glob match specifici al repo |
| **Output styles** (`.claude/output-styles/`) | — | ✅ progetto | versionato in plugin | Stile risposte può variare per progetto |
| **CLAUDE.md adapter** | — | ✅ progetto, tracked | reference | Adapter Claude Code progetto |
| **CLAUDE.local.md** | — | ✅ progetto, **gitignored** | template fornito (`CLAUDE.local.md.template`) | Override personali utente, non condivisi |
| **AGENTS.md** | — | ✅ progetto, tracked | reference critico | Regole operative repo |
| **`~/.claude/CLAUDE.md` globale** | ✅ globale | — | — | Regole tutti i progetti dello stesso utente |
| **Memoria persona** (`~/memory/`, `~/.claude/projects/.../memory/`) | ✅ globale + progetto | progetto: `~/.claude/projects/<repo>/memory/` | NON inclusa nel plugin | Specifica utente + progetto, privacy |
| **Settings.json hook registry** | ✅ globale (`~/.claude/settings.json`) | — | installation steps | Claude Code legge solo globale |
| **Settings.local.json** | ✅ globale, gitignored | — | NON inclusa nel plugin | Privacy locale macchina |
| **Subagent** | ✅ globale (`~/.claude/agents/`) o progetto (`.claude/agents/`) | preferito progetto se task-specific | reference | Subagent task-specific stanno meglio in progetto |
| **MCP servers** | ✅ globale (Claude Desktop config) | — | reference + install steps | Configurazione client Claude |
| **Audit script TypeScript** | — | ✅ progetto (`src/scripts/`) | versionato in plugin | Audit dipendono da paths/canonici del repo |
| **Backlog canonici** (`docs/AI_*.md`) | — | ✅ progetto, tracked | reference critico | Backlog progetto-specifico |
| **Routing registry** (`AI_CAPABILITY_ROUTING.json`) | — | ✅ progetto | versionato in plugin | Routing dipende da capabilities del progetto |
| **Audit cadences** (`scripts/run-audit-*.bat`) | — | ✅ progetto | versionato + Task Scheduler steps | Cron schedulato per utente |

## Cosa NON deve mai stare nel plugin

- Memoria personale (privacy).
- `CLAUDE.local.md` (override personali, gitignored).
- `settings.local.json` (config locale macchina).
- `.env`, secrets, token, password (ovviamente).
- 6 immagini WhatsApp untracked in root (non rilevanti).
- Log in `~/memory/*-log.txt` (privacy, volume grosso).
- Backup commit (`session-prompts/*.md` storici).

## Pacchetto handoff riusabile per altri persone/progetti

Per dare il sistema AI a un'altra persona o portarlo su un nuovo progetto:

### Step 1: copia globale (una tantum per persona)
- `~/.claude/CLAUDE.md` — regole globali
- `~/.claude/hooks/*` — tutti gli hook PowerShell + script `.mjs`
- `~/.claude/skills/*` (critiche minime: antiban-review, context-handoff, loop-codex, audit-rules, memoria) — il resto installa da marketplace
- `~/.claude/scripts/*` — script support (router modello, ecc.)
- `~/.claude/settings.json` — registry hook + permissions
- `~/.claude/keybindings.json` (opzionale)

### Step 2: bootstrap progetto
Clonare il repo, poi:
1. `npm install`
2. `npm run setup:git-hooks` (native git pre-commit)
3. Verificare `.claude/rules/`, `.claude/plugin.json`, `.claude/output-styles/` presenti
4. Copiare `CLAUDE.local.md.template` in `CLAUDE.local.md` se servono override personali
5. `npm run audit:ai-control-plane` per verifica conformità
6. Registrare Task Scheduler con `scripts/run-audit-weekly.bat` e `scripts/run-audit-monthly.bat` (vedi `docs/tracking/AI_AUDIT_CADENCES.md`)

### Step 3: validazione
1. `npm run conta-problemi` deve essere verde
2. `npm run audit:ai-control-plane` deve essere 25/25
3. `npm run audit:handoff-staleness` per verifica handoff
4. Smoke prompt: chiedere all'AI "che cosa fa questo progetto?" — deve rispondere senza chiedere context

### Step 4: differenza con prima installazione
La prima volta che si installa su una macchina, alcuni hook PowerShell potrebbero richiedere `Set-ExecutionPolicy` permissivo. Documentato in `~/.claude/hooks/README.md`.

## Strategia di update

- Plugin version (`.claude/plugin.json` → `version`): semver, aggiornare su change strutturale (nuovi hook, nuove rules path-scoped, breaking change schema).
- Globale (`~/.claude/`): aggiornare manualmente o tramite `npx skills install`/`npx skills update`.
- Progetto: tracked in git, segue commit history.

## Compatibility status

| Ambiente | Stato | Note |
|---|---|---|
| Claude Code Windows | ✅ supportato | Ambiente primario, tutti gli hook PowerShell attivi |
| Claude Code macOS/Linux | ⚠️ parziale | Hook PowerShell vanno portati a `.sh` equivalenti |
| Codex CLI | ⚠️ parziale | Skill + regole via AGENTS.md; hook PowerShell non attivi nativamente; vedi `AGENTS.md` "Fallback per ambienti senza hook PowerShell" |
| Claude Cloud Code | 🔵 non testato | Da verificare |
| Cursor / Windsurf | 🔵 manuale | Caricamento manuale di AGENTS.md via prompt |

## Mapping con community reference 2026 (Agent Development Kit a 5 layer)

Il community reference 2026 (chase.h.ai, leadgenman, ecc.) propone struttura standard `agent-dev-kit/` con 5 layer. Il nostro sistema e' **funzionalmente allineato**, con varianti stilistiche.

| Layer reference | Reference struttura | Nostro equivalente | Note |
|---|---|---|---|
| **L1 Memory Layer** | `CLAUDE.md/architecture.rules`, `global.md`, `project.md` | `~/.claude/CLAUDE.md` + `CLAUDE.md` repo + `CLAUDE.local.md.template` + `AGENTS.md` | AGENTS.md piu' ricco e funzionale di `architecture.rules` separato |
| **L2 Knowledge Layer** | `skills/SKILL.md`, `scripts/`, `context.md` | `~/.claude/skills/*/SKILL.md` (197 skill) + `src/scripts/` | Niente `context.md` per skill; copertura via runtime brief + capability routing |
| **L3 Guardrail Layer** | `hooks/PreToolUse.sh`, `PostToolUse.sh`, `SessionStart.sh` | 32+2 hook PowerShell frammentati per concern (SRP) | Nostro frammentato = piu' SRP. Reference consolidato = 3 file fan-out. Variante stilistica |
| **L4 Delegation Layer** | `subagents/code-reviewer.md`, `test-runner.md`, `explorer.md` | Skill globali `code-reviewer`, `explorer` + Agent Teams; no `test-runner` dedicato (usiamo `npm run conta-problemi`) | Allineato; test-runner come hook L1 invece di subagent |
| **L5 Distribution Layer** | `plugins/manifest.json`, `marketplace.url`, `team.install` | `.claude/plugin.json` + step bootstrap in questo doc | Niente `marketplace.url`/`team.install` file: opzionali |

**Verdetto**: nessuna implementazione urgente. Differenze sono varianti, non gap funzionali. Documentazione su 89 comandi nativi Claude Code in `docs/tracking/CLAUDE_CODE_COMMANDS_REFERENCE.md`.

## Fonti di verità

- `.claude/plugin.json` — manifest pacchetto
- `AGENTS.md` — regole operative repo
- `docs/AI_OPERATING_MODEL.md` — roadmap operativa
- `docs/AI_RUNTIME_BRIEF.md` — digest runtime
- `docs/tracking/AI_AUDIT_CADENCES.md` — cadenze
- `docs/tracking/CLAUDE_CODE_COMMANDS_REFERENCE.md` — 89 comandi nativi categorizzati
- `~/.claude/CLAUDE.md` — regole globali utente
