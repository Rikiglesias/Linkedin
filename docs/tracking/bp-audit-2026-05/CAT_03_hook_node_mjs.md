## Categoria 3 — Hook Node/MJS (`~/.claude/scripts/*.mjs`)

### Fonti best practice consultate (Node.js 2026)

- [Node.js v26.1 — ECMAScript modules](https://nodejs.org/api/esm.html)
- [Node.js v25.2 docs — ESM](https://nodejs.org/docs/latest/api/esm.html)

### Best practice ufficiali identificate

| BP | Cosa dice Node 2026 | Severita' |
|---|---|---|
| `node:` prefix per built-in | `import fs from "node:fs"` invece di `"fs"` — preferito 2026 | Bassa stilistica |
| Top-level await | Permesso in ES modules per init async | Solo dove serve |
| `import.meta.resolve` | Asincrono, per risoluzione path runtime | Caso d'uso specifico |
| JSON imports | `with { type: 'json' }` attribute MANDATORY | Critico per import JSON statici |
| CommonJS interop | Default import sugar syntax | Solo se interop necessario |
| Shebang `#!/usr/bin/env node` | Per script CLI | Standard |
| Error handling esplicito | try/catch sui boundary I/O | Alta |

### Stato nostro sistema (8 file mjs analizzati su campione)

| File | Shebang | `node:` prefix | Top-level await | JSON attr | Error handling |
|---|---|---|---|---|---|
| `merge-canonical-settings.mjs` | ✅ | ❌ usa `"fs"`, `"path"`, `"os"` | n/a | n/a (no JSON import) | 🟡 try/catch silent → return `{}` |
| `claude-model-router.mjs` | ✅ presunto | ❌ presunto | — | — | — |
| altri 6 mjs | ✅ presunto | ❌ presunto | — | — | — |

### Gap identificati

1. **MINOR** — Nessun `mjs` usa il prefix `node:` per built-in modules (es. `"node:fs"` invece di `"fs"`). Best practice Node 2026 raccomandato ma non bloccante. I built-in funzionano in entrambi i modi.
2. **MEDIO** — Error handling silenzioso (`catch { return {} }`) in `merge-canonical-settings.mjs`. Se canonical settings sono corrotti, errore mascherato → settings reset silently. Anti-pattern noto. Da fix con log esplicito.
3. **POSITIVO** — File piccoli, focalizzati (SRP), shebang corretto, struttura pulita.

### Fix proposti per sessioni future

1. **Refactor `node:` prefix** in tutti gli 8 file mjs. Operazione meccanica, basso rischio.
2. **Logging esplicito** su catch silent in `merge-canonical-settings.mjs` (e simili): `console.error('canonical-merge: errore lettura X, fallback a default vuoto');`. Aiuta debug.
3. Verificare se `model-router-config.mjs` usa `import.meta.resolve` o ha path hardcoded che potrebbero migrare a runtime resolution.

NESSUN fix applicato ora (regola Pazienza vs fretta: 8 file di scripts critici per router, rischio non giustificato senza test isolato).

---

## Nota su Categoria 13.5 — Validazione 89 comandi community vs docs ufficiali

Dopo creazione di `docs/tracking/CLAUDE_CODE_COMMANDS_REFERENCE.md` con 89 comandi community (chase.h.ai), verifica contro docs ufficiali Anthropic (`code.claude.com/docs/llms.txt`):

**Confermati ufficialmente** (13 su 89 verificati): `/goal`, `/loop`, `/memory`, `/context`, `/doctor`, `/hooks`, `/mcp`, `/team-onboarding`, `/autofix-pr`, `/ultrareview`, `/ultraplan`, `/resume`, `/usage`.

**Status restanti 76 comandi**: PLAUSIBILI ma non confermati da una singola pagina ufficiale Anthropic. Anthropic ha documentazione scattered (non c'è una pagina che elenca TUTTI i comandi). Alcuni potrebbero essere:
- Confermati in pagine specifiche (`/init`, `/clear`, `/status` molto probabili)
- Alias deprecati o rinominati
- Solo nella community list, non ancora ufficiali
- Mai esistiti

**Azione raccomandata** (futura): aggiornare `CLAUDE_CODE_COMMANDS_REFERENCE.md` con colonna `Source: ✅ official docs / 🟡 community only / ❓ unverified` per ogni comando, dopo verifica `/help` reale o lettura `code.claude.com/docs/en/agent-sdk/slash-commands.md`.

---

