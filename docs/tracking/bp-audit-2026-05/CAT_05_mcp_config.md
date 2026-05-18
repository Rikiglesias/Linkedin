## Categoria 5 — MCP config

### Fonti best practice consultate (2026)

- [Anthropic Claude Code: MCP](https://code.claude.com/docs/en/mcp)
- [Claude Code MCP Setup 2026 — Nimbalyst](https://nimbalyst.com/blog/claude-code-mcp-setup/)
- [Configuring MCP Tools in Claude Code — Scott Spence](https://scottspence.com/posts/configuring-mcp-tools-in-claude-code)
- [Complete Guide MCP Config Files 2026 — MCP Playground](https://mcpplaygroundonline.com/blog/complete-guide-mcp-config-files-claude-desktop-cursor-lovable)

### Best practice ufficiali identificate

| BP | Cosa dice Anthropic / 2026 | Severity |
|---|---|---|
| Scope hierarchy | local (`~/.claude.json` per progetto) > project (`.mcp.json` repo root, committato) > user (`~/.claude.json` globale) | HIGH |
| Transport | `stdio` per server locali, `http`/`sse` per remoti | MEDIUM |
| Server count | 5-6 server ottimali, prune oltre 20 (focus context modello) | MEDIUM |
| Env var expansion | `${VAR}` o `${VAR:-default}` in `.mcp.json` per credenziali/path machine-specific | HIGH |
| Path binari | absolute path o `command` resolvable da PATH; NO path hardcoded utente-specific in file condivisi | HIGH |
| Security | secret MAI in `.mcp.json` committato; usare env var expansion + `.env` gitignored | HIGH |
| Reload | restart Claude Code o `/mcp` disconnect/reconnect dopo edit | LOW |
| Debug failure | jq sintassi, absolute path resolution, run server manuale per stderr | LOW |

### Stato nostro sistema

| Sorgente | Tracked? | Server reali (count verificato) | Note |
|---|---|---|---|
| `.mcp.json` repo | **sì** (committato) | 4: code-review-graph, lean-ctx, symdex, claude-peers | Path utente hardcoded |
| `~/.claude.json` root `mcpServers` | no (file utente) | 1: n8n-mcp | Verificato via JSON parse |
| `~/.claude.json` projects-scoped `mcpServers` | no | 1: claude-context (project LinkedIn) | Verificato via JSON parse |
| Hosted Anthropic claude.ai (account-level) | n/a (web app) | ~10: Booking, Canva, Gamma, Gmail, Calendar, Drive, Hugging Face, Spotify, Supabase, Supabase_2 | NON in file locali, provisioned via claude.ai |
| Built-in | n/a | 1: ide | Built-in Claude Code |
| Plugin scope | n/a | 1: plugin_playwright | Via plugin install |
| `.claude/settings.local.json` | no | — | Permission overrides, `bypassPermissions` mode |

**Totale MCP runtime visibili**: ~18 server (sotto soglia 20 raccomandata, vicino al limite) ⚠️

**Distinzione importante**: la spec Anthropic sui "5-6 server ottimali" si applica ai **server con tool surface ricca** caricati nel context del modello. Hosted come Booking/Canva/Gamma hanno tool list grande (visto in /context: Canva 35 tool, Gmail 13, Supabase 23, ecc.).

### Gap identificati

| # | Gap | Severity | Evidenza |
|---|---|---|---|
| 1 | `.mcp.json` committato ha path hardcoded utente-specific | **HIGH** | `C:\\Users\\albie\\AppData\\Local\\lean-ctx\\lean-ctx.exe`, `C:\\Users\\albie\\.bun\\bin\\bun.exe` |
| 2 | Nessun env var expansion usato | MEDIUM | Tutti i path letterali, no `${VAR}` |
| 3 | `.gitignore` non lista esplicitamente `settings.local.json`/`.mcp.json.local` | LOW | grep negativo; tracked by convention non da gitignore |
| 4 | Nessun audit script che verifica MCP config sanity (jq, path resolution) | LOW | gap futuro |
| 5 | Server "personal" (Booking, Canva, Spotify) caricati in contesto progetto LinkedIn — rumore tool list | LOW | provider personali utente, mitigabile via project-scope override |

### Verifica conformità

- ✅ Scope hierarchy rispettata: project `.mcp.json` per server condivisi, user `~/.claude.json` per personali
- ✅ Transport corretto: tutti stdio per locali
- ✅ Server count 14 < 20
- ❌ Env var expansion: assente, path hardcoded
- ✅ Security: nessun secret in `.mcp.json` (solo path eseguibili)
- ⚠️ Portabilità: `.mcp.json` rotto se clonato da altro utente (path utente-specific)

### Fix proposti — NON applicati in questo turno

**Rationale Pazienza vs fretta**: modificare `.mcp.json` cambia entry point degli MCP server. Se rotto, perdo lean-ctx/symdex/claude-peers nella prossima sessione → blast radius alto, va testato con restart Claude Code.

**Proposta operativa** (futura):
1. Rimpiazzare path hardcoded con env var expansion:
   ```json
   "command": "${LEAN_CTX_PATH:-C:\\Users\\albie\\AppData\\Local\\lean-ctx\\lean-ctx.exe}"
   "command": "${BUN_PATH:-C:\\Users\\albie\\.bun\\bin\\bun.exe}"
   ```
2. Aggiungere `audit:mcp-config` script TypeScript che:
   - Valida JSON con jq-like
   - Verifica path eseguibili esistono (Test-Path)
   - Conferma transport coerente con tipo server
3. Aggiungere a `audit:weekly`

**Risk**: medio. Va testato con `/mcp` reconnect prima di committare. Conferma utente raccomandata.

---

