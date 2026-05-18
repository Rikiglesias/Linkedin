## Categoria 6 — JSON registry

### Fonti best practice consultate (2026)

- [Anthropic Claude Code: Create plugins](https://code.claude.com/docs/en/plugins)
- [anthropics/claude-plugins-official repo](https://github.com/anthropics/claude-plugins-official)
- [Building Your First Claude Code Plugin — Plugin Hub](https://www.claudepluginhub.com/learn/building-plugins)
- [marketplace.json schema reference](https://github.com/anthropics/claude-plugins-official/blob/main/.claude-plugin/marketplace.json)

### Best practice ufficiali identificate

| BP | Cosa dice Anthropic 2026 | Severity |
|---|---|---|
| Path plugin manifest | `.claude-plugin/plugin.json` (NON `.claude/plugin.json`) | **HIGH** |
| Campi richiesti | `name`, `description`, `version` | HIGH |
| Campi opzionali | `author`, `homepage`, `repository`, `license` | LOW |
| Directory plugin | `.claude-plugin/` contiene SOLO plugin.json. Funzionali (commands/, agents/, skills/, hooks/, .mcp.json) al plugin root | MEDIUM |
| Naming namespace | `name` definisce namespace skill (es. `quality-review-plugin:hello`) | MEDIUM |
| Reserved names | Bloccati: `claude-code-marketplace`, `anthropic-marketplace`, `claude-plugins-official`, ecc. | LOW |
| JSON valid | Sintassi corretta verificabile con `jq` o JSON.parse | HIGH |
| Tracking JSON custom | Schema interno consistente, no contraddizione con audit script | MEDIUM |

### Stato nostro sistema — count verificato L9.8

| File | Righe (verificate `wc -l`) | JSON valid (verificato `python3 json.load`) | Schema usato |
|---|---|---|---|
| `.claude/plugin.json` | 146 | ✅ | `package` JSON schema (NON Anthropic plugin) |
| `docs/tracking/AI_CAPABILITY_ROUTING.json` | 462 | ✅ | Custom interno |
| `docs/tracking/AI_ADK_CAPABILITY_GOVERNANCE.json` | 683 | ✅ | Custom interno |
| `docs/tracking/AI_LEVEL_ENFORCEMENT.json` | 142 | ✅ | Custom interno |
| **Totale** | **1433** | 4/4 valid | — |

### Gap identificati

| # | Gap | Severity | Evidenza |
|---|---|---|---|
| 1 | Plugin manifest path errato | **HIGH** | File in `.claude/plugin.json` invece di `.claude-plugin/plugin.json` (path canonico Anthropic). Conseguenza: il plugin non è installabile come Anthropic plugin standard, è solo metadata locale |
| 2 | Schema dichiarato è `package` invece di plugin Anthropic | MEDIUM | `"$schema": "https://json.schemastore.org/package"` → schema sbagliato per file plugin |
| 3 | Campi custom non-standard | LOW | `compatibility`, `contents`, `provenance`, `installation`, `supportedEnvironments` — metadata utile ma non riconosciuto dal framework Anthropic |
| 4 | Nessun `audit:json-schemas` per validare strutture custom contro JSON Schema | LOW | gap futuro |
| 5 | `plugin.json` cita "32 hook sempre attivi + 2 router condizionali" — verificato coerente | OK | `ls *.ps1 \| wc -l` = 32 ✅ |

### Verifica conformità

- ✅ Tutti i 4 JSON sintatticamente validi
- ✅ Naming non in reserved list
- ❌ Plugin manifest path NON canonico
- ❌ Schema dichiarato sbagliato per il tipo file
- ⚠️ Custom registry coerenti internamente ma senza schema validation automatica

### Fix proposti — NON applicati in questo turno

**Rationale Pazienza vs fretta**: spostare `plugin.json` da `.claude/` a `.claude-plugin/` ha blast radius: registry, audit, hook che cercano il file in `.claude/` vanno aggiornati. Va fatto con grep preventivo dei reference.

**Proposta operativa** (futura):
1. Audit reference: `grep -r ".claude/plugin.json"` per trovare tutti i caller
2. Spostare in `.claude-plugin/plugin.json`
3. Aggiornare `$schema` o rimuoverlo (Anthropic non ha ancora pubblicato JSON Schema ufficiale per plugin.json)
4. Aggiungere `audit:json-schemas` TypeScript che verifica:
   - Sintassi JSON (parse)
   - Campi richiesti presenti
   - Custom registry coerenti con audit script che li leggono

**Risk**: medio. Rename file con caller. Conferma utente richiesta prima.

---

