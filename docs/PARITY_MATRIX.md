# Matrice Parità Ambienti

> Documento operativo per parità tra ambienti AI: Claude Code, Codex, Cloud Code.
> Aggiornato: 2026-06-04. Fonte di verità per decisioni di ambiente.

## Scopo

Risponde a tre domande ogni volta che si sceglie un ambiente:

1. **Cosa garantisce questo ambiente?** (hook, memoria, modelli, tool)
2. **Cosa manca** rispetto agli altri? (gap espliciti, non normalizzati)
3. **Quando usare cosa?** (risk/costo trade-off)

## Stato (2026-06-04)

Il grosso del gap Claude Code ↔ Codex è chiuso e **verificato**. Hook Codex implementati e registrati in `.codex/hooks.json`; audit `npm run audit:codex-hook-parity` = 3/3; smoke test `npm run audit:codex-hook-smoke` = 13/13 (esercita ogni hook con input simulato e verifica la decisione reale). Cloud Code resta non coperto (gap tracciato). GAP-2, GAP-4, GAP-5 chiusi; GAP-1, GAP-3 mitigati con gap residuo dichiarato.

## Ambiente → capability → garanzia reale

| Capability                                                                                             | Claude Code                                                                                          | Codex (desktop)                                                                                      | Cloud Code                               | Note criticità                                                   |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| **Hook SessionStart** (carica memoria+digest)                                                          | 5 hook, caricamento `~/memory/` completo                                                             | ✅ 1 hook (codex-runtime-context: brief+contract+memoria annunciata, NON auto-letta)                | ❌ nessuno                               | Codex annuncia i file memoria ma il modello deve leggerli        |
| **Hook UserPromptSubmit** (P0+DIPENDENTE+SPINGITI_OLTRE+routing)                                       | 10 hook con rinforzi cognitivi completi                                                              | ✅ 1 hook (codex-runtime-context: principi+routing+model guidance, no suggerimento modello adattivo) | ❌ nessuno                               | Codex ha framing comportamentale; manca model-switch adattivo    |
| **Hook PreToolUse Bash** (git state)                                                                   | 2 hook (L1 quality + git state)                                                                      | ✅ 1 hook (codex-bash-gate: block su commit/push senza audit)                                        | ❌ nessuno                               | Codex ha il git gate, nessuna L1 quality check                   |
| **Hook PreToolUse Edit** (anti-ban, secrets, best-practice)                                            | 3 hook completi                                                                                      | ✅ 1 hook (codex-edit-gate: anti-ban + secrets block + best-practice advisory) — **GAP-2 CHIUSO**    | ❌ 0 hook                                | LinkedIn-touch e secrets ora bloccati anche in Codex             |
| **Hook PostToolUse Edit** (size, hygiene, verify)                                                      | 7 hook                                                                                               | ✅ 1 hook (codex-post-edit: size + hygiene + verify L2-L7) — **GAP-4 CHIUSO**                        | ❌ 0 hook                                | Codex ora controlla le modifiche fatte                           |
| **Hook PostToolUse Bash** (review/log)                                                                 | 4 hook (quality log, git audit, package change, handoff invalidate)                                  | ⚠️ 1 hook (codex-post-tool-review: review advisory effetti diretti/indiretti)                       | ❌ nessuno                               | Manca invalidazione handoff post-commit                          |
| **Hook PostToolUse WebSearch**                                                                         | 1 hook (log query+risultati)                                                                         | ❌ nessuno                                                                                           | ❌ nessuno                               | WebSearch non tracciata in Codex                                 |
| **Hook PreCompact** (runtime brief+pre-compact handoff)                                                | 2 hook + block-auto-compact                                                                          | ❌ nessuno (Codex compatta autonomamente) — **GAP-3**                                                | ❌ nessuno                               | Codex non ha equivalente compact handoff                         |
| **Hook Stop** (session log, commit gate, proactive, completeness, sync Obsidian)                       | 6 hook completi                                                                                      | ✅ 1 hook (codex-stop-check: working-tree check + sync Obsidian + proactive) — **GAP-5 CHIUSO**      | ❌ nessuno                               | Codex non fa completeness/auto-track come Claude                 |
| **MCP servers**                                                                                        | 10 (Supabase, Playwright, Semgrep, n8n, Gmail, Calendar, Drive, lean-ctx, symdex, code-review-graph) | ⚠️ 2 (code-review-graph, symdex)                                                                     | Varies                                   | Codex ha il 20% dei tool                                         |
| **Memoria globale `~/memory/`**                                                                        | Caricata tutta a SessionStart, 20+ file                                                              | ⚠️ Annunciata da codex-runtime-context, NON auto-letta — **GAP-1**                                  | ❌ NON caricata                          | Codex conosce i path; il modello deve leggerli prima di agire    |
| **Memoria project `~/.claude/projects/`**                                                              | Auto-memory caricata                                                                                 | ❌ NON caricata                                                                                      | ⚠️ Parziale (se repo ha `.codex/memory`) | Auto-memory non trasferibile                                     |
| **Routing modello** (alias AN/OR, live switch)                                                         | Completo via hook + CLI router locale                                                                | ❌ switch manuale nell'app Codex (no router locale)                                                  | ⚠️ Parziale (selezioni manuali)          | Vedi sezione "Model/provider switching Codex"                    |
| **Skill** (~200, 10 dominanti)                                                                         | Tutte via Skill tool                                                                                 | ❌ Nessuna skill Claude Code (serve reimplementare in Codex)                                         | ❌ Nessuna skill                         | Skill sono un'astrazione non portabile                           |
| **Audit** (37 npm scripts)                                                                             | Tutti via `npm run`                                                                                  | ✅ Tutti via `npm run`                                                                               | ✅ Tutti via `npm run`                   | Gli audit sono portabili — unica garanzia cross-ambiente reale   |
| **Sync Obsidian**                                                                                      | Hook Stop auto-sync memoria+canonici                                                                 | ✅ codex-stop-check best-effort (skip se Obsidian chiuso)                                            | ❌ non configurato                       | Sync vault ora funziona anche in Codex                           |

## Quando usare cosa — matrice decisionale

| Task type                      | Ambiente consigliato         | Motivazione                                  |
| ------------------------------ | ---------------------------- | -------------------------------------------- |
| Bug investigati                | Claude Code                  | Memoria + reasoning completo                 |
| Feature >3 file                | Claude Code                  | Hook anti-ban + blast radius + L2-L9         |
| Modifica LinkedIn-touch        | **Claude Code OBBLIGATORIO** | anti-ban hook completi; Codex ha solo il block edit-gate come rete di sicurezza |
| Refactor grande                | Claude Code                  | Hook hygiene + skill verification-protocol   |
| Review/audit                   | Codex                        | Audit portabili via npm, ambiente più pulito |
| Bulk noioso/migrazione         | Codex                        | Costo token più basso                        |
| Quick fix <30min, non LinkedIn | Codex OK                     | edit-gate + post-edit coprono il minimo      |
| Ricerca web/docs               | Claude Code                  | Hook WebSearch tracing                       |
| Memoria/handoff/organizzazione | Claude Code                  | Hook Stop + Obsidian sync completi           |
| Lavoro da mobile/VPS           | Cloud Code                   | Se necessario (gap: nessun hook)             |

## Model/provider switching Codex (problema noto — limite strutturale, non bug)

In Claude Code il modello/provider si cambia a runtime via router locale (`/anthropic`, `/or:<alias>`, `switch-claude-backend.mjs`) e gli hook reiniettano la guidance. **In Codex questo meccanismo non esiste**: il modello si seleziona nell'app Codex e il provider è quello configurato. Non è un gap da "chiudere" con codice — è strutturale.

Governance esplicita (così il problema è stabilizzato, non ambiguo):

- `codex-runtime-context.ps1` sezione `CODEX_MODEL` inietta la guidance: Opus per ragionamento/architettura/audit multi-dominio, Sonnet per coding/bug/feature media, Haiku per lookup/bulk, Gemini (OpenRouter) per multimodale.
- Lo switch è **manuale**: l'utente cambia modello nell'app prima del task. Il modello dichiara comunque, a inizio task non banale, quale modello sarebbe adatto (regola `model-selection.md`).
- Per task ad alto rischio (anti-ban, sicurezza, DB) → **migrare a Claude Code**, dove il provider Anthropic è tracciabile e gli hook anti-ban sono completi.
- "Visibilità modelli": in Codex la lista dipende dall'app, non dal router. Non assumere disponibilità di alias OpenRouter in Codex.

## Gap critici documentati (non normalizzati)

### GAP-1: Caricamento memoria `~/memory/` in Codex — MITIGATO (gap residuo)

- **Impatto**: Codex parte senza sapere chi è l'utente, decisioni prese, feedback ricevuti.
- **Mitigazione**: `codex-runtime-context.ps1` sezione `CODEX_MEMORY` annuncia il path e i file disponibili (user/personality/preferences/decisions) e impone di leggerli prima di agire.
- **Gap residuo**: i file non vengono letti automaticamente nel contesto; il modello deve aprirli esplicitamente. Non equivale al caricamento automatico di Claude Code.

### GAP-2: PreToolUse Edit in Codex — CHIUSO (2026-06-01, verificato 2026-06-04)

- **Impatto**: LinkedIn-touch, file con segreti, file >300 righe modificabili senza gate.
- **Mitigazione**: `codex-edit-gate.ps1` IMPLEMENTATO — 1 hook × 3 gate (anti-ban block + secrets block + best-practice advisory). Verificato da `audit:codex-hook-smoke` (deny su browser/anti-ban e su `.env`, advisory su file neutro).
- **Gap residuo**: nessuno sul blocco edit; resta assente la L1 quality check pre-bash.

### GAP-3: PreCompact handoff in Codex — APERTO (limite nativo)

- **Impatto**: Codex che compatta senza generare CONTINUATION.md perde stato.
- **Mitigazione**: nessuna equivalente nativa in Codex.
- **Gap residuo**: il compact di Codex è opaco. Mitigazione operativa: compilare `.claude/CONTINUATION.md` manualmente prima di sessioni lunghe.

### GAP-4: PostToolUse Edit hygiene in Codex — CHIUSO (verificato 2026-06-04)

- **Impatto**: Modifiche in Codex non controllate (size, duplicate, dead code, verify L2-L7).
- **Mitigazione**: `codex-post-edit.ps1` IMPLEMENTATO — file-size (L1.6) + codebase hygiene + verify checklist L2-L7. Verificato da `audit:codex-hook-smoke`.

### GAP-5: Sync Obsidian in Codex Stop — CHIUSO (verificato 2026-06-04)

- **Impatto**: Vault non aggiornato dopo sessioni Codex.
- **Mitigazione**: `codex-stop-check.ps1` esteso — chiama `sync-memory-to-obsidian.mjs` best-effort (skip silenzioso se Obsidian chiuso) + proactive next step. Verificato da `audit:codex-hook-smoke`.

## Come verificare parità

Esegui dopo ogni cambiamento infrastrutturale:

```bash
npm run audit:codex-hook-parity   # copertura capability Codex (gap critici PARITY_MATRIX) — atteso 3/3
npm run audit:codex-hook-smoke    # esercita ogni hook con input simulato — atteso 13/13
npm run audit:ai-control-plane    # stato globale del control plane AI
```

Manuale (per task critici):

```
# Confronta hook tra ambienti
diff <(ls ~/.claude/hooks/) <(ls .codex/hooks/)
```

**Limite degli smoke test**: provano che gli hook scattano e decidono correttamente quando invocati. NON provano che l'app Codex li invochi davvero ad ogni evento: quella è una verifica end-to-end che richiede una sessione Codex reale (aprire Codex sul repo, fare un edit LinkedIn-touch e osservare il block). Resta il passo manuale finale del punto 8.

## Regola operativa

**Prima di scegliere ambiente**: consulta questa matrice. Se il task tocca un'area dove ci sono GAP critici (anti-ban, memoria, compact), non usare Codex/Cloud Code senza mitigazioni esplicite. I gap non sono un'aspirazione — sono limiti operativi reali.

**Dopo ogni modifica a hook/canonici**: verificare che la matrice resti attuale (eseguire i due audit sopra). Aggiornare prima di committare. Drift matrice ↔ hook = bug operativo.
