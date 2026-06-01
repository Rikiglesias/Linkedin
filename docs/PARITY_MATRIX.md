# Matrice Parità Ambienti

> Documento operativo per parità tra ambienti AI: Claude Code, Codex, Cloud Code.
> Aggiornato: 2026-06-01. Fonte di verità per decisioni di ambiente.

## Scopo

Risponde a tre domande ogni volta che si sceglie un ambiente:

1. **Cosa garantisce questo ambiente?** (hook, memoria, modelli, tool)
2. **Cosa manca** rispetto agli altri? (gap espliciti, non normalizzati)
3. **Quando usare cosa?** (risk/costo trade-off)

## Ambiente → capability → garanzia reale

| Capability                                                                                             | Claude Code                                                                                          | Codex (desktop)                                                                                      | Cloud Code                               | Note criticità                                                   |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| **Hook SessionStart** (carica memoria+digest)                                                          | 5 hook, caricamento `~/memory/` completo                                                             | ✅ 1 hook (context-only, carica runtime brief+contract, NON memoria completa)                        | ❌ nessuno                               | Codex senza memoria = parte da zero ogni volta                   |
| **Hook UserPromptSubmit** (P0+P0+DIPENDENTE+SPINGITI_OLTRE+routing)                                    | 10 hook con rinforzi cognitivi completi                                                              | ⚠️ 1 hook testuale (orchestrator solo, no framing comportamentale, no suggerimento modello adattivo) | ❌ nessuno                               | Codex "senza cervello comportamentale" in questo momento         |
| **Hook PreToolUse Bash** (L1 gate, git state)                                                          | 2 hook (L1 quality + git state)                                                                      | ✅ 1 hook (block su commit/push senza audit)                                                         | ❌ nessuno                               | Codex ha solo il git gate, nessuna L1 check                      |
| **Hook PreToolUse Edit** (anti-ban, secrets, best-practice, PATH CRITICO)                              | 3 hook completi                                                                                      | ❌ 0 hook                                                                                            | ❌ 0 hook                                | **GAP CRITICO**: LinkedIn-touch modificabili in Codex senza gate |
| **Hook PostToolUse Edit** (size, hygiene, verify, prettier, auto-commit)                               | 7 hook                                                                                               | ❌ 0 hook                                                                                            | ❌ 0 hook                                | Codex non controlla modifiche fatte                              |
| **Hook PostToolUse Bash** (quality log, git audit, package change, handoff invalidate)                 | 4 hook                                                                                               | ⚠️ 1 hook (log solo)                                                                                 | ❌ nessuno                               | Manca invalidazione handoff post-commit                          |
| **Hook PostToolUse WebSearch**                                                                         | 1 hook (log query+risultati)                                                                         | ❌ nessuno                                                                                           | ❌ nessuno                               | WebSearch non tracciata in Codex                                 |
| **Hook PreCompact** (runtime brief+pre-compact handoff)                                                | 2 hook + block-auto-compact                                                                          | ❌ nessuno (Codex compatta autonomamente)                                                            | ❌ nessuno                               | **GAP**: Codex non ha equivalente compact handoff                |
| **Hook Stop** (session log, commit gate, proactive-next-step, completeness, auto-track, sync Obsidian) | 6 hook completi                                                                                      | ⚠️ 1 hook (solo continuation+git status check)                                                       | ❌ nessuno                               | Codex non sincronizza il vault, non fa proactive continuation    |
| **MCP servers**                                                                                        | 10 (Supabase, Playwright, Semgrep, n8n, Gmail, Calendar, Drive, lean-ctx, symdex, code-review-graph) | ⚠️ 2 (code-review-graph, symdex)                                                                     | Varies                                   | Codex ha il 20% dei tool                                         |
| **Memoria globale `~/memory/`**                                                                        | Caricata tutta a SessionStart, 20+ file                                                              | ❌ NON caricata                                                                                      | ❌ NON caricata                          | **GAP CRITICO**: Codex non conosce il profilo utente             |
| **Memoria project `~/.claude/projects/`**                                                              | Auto-memory caricata                                                                                 | ❌ NON caricata                                                                                      | ⚠️ Parziale (se repo ha `.codex/memory`) | Auto-memory non trasferibile                                     |
| **Routing modello** (alias AN/OR, live switch)                                                         | Completo via hook + CLI                                                                              | ❌ nessuno                                                                                           | ⚠️ Parziale (selezioni manuali)          | Codex non switcha modello via prompt                             |
| **Skill** (~200, 10 dominanti)                                                                         | Tutte via Skill tool                                                                                 | ❌ Nessuna skill Claude Code (serve reimplementare in Codex)                                         | ❌ Nessuna skill                         | Skill sono un'astrazione non portabile                           |
| **Audit** (36 npm scripts)                                                                             | Tutti via `npm run`                                                                                  | ✅ Tutti via `npm run`                                                                               | ✅ Tutti via `npm run`                   | Gli audit sono portabili — unica garanzia cross-ambiente reale   |
| **Skill Obsidian sync**                                                                                | Hook Stop auto-sync memoria+canonici                                                                 | ❌ non configurato                                                                                   | ❌ non configurato                       | Sync vault funziona solo in Claude Code                          |
| **PreCompact handoff**                                                                                 | Genera CONTINUATION.md automatico                                                                    | ❌ no equivalent                                                                                     | ❌ no equivalent                         | Codex non salva stato prima di compattare                        |

## Quando usare cosa — matrice decisionale

| Task type                      | Ambiente consigliato         | Motivazione                                  |
| ------------------------------ | ---------------------------- | -------------------------------------------- |
| Bug investigati                | Claude Code                  | Memoria + reasoning completo                 |
| Feature >3 file                | Claude Code                  | Hook anti-ban + blast radius + L2-L9         |
| Modifica LinkedIn-touch        | **Claude Code OBBLIGATORIO** | anti-ban hook assenti altrove                |
| Refactor grande                | Claude Code                  | Hook hygiene + skill verification-protocol   |
| Review/audit                   | Codex                        | Audit portabili via npm, ambiente più pulito |
| Bulk noioso/migrazione         | Codex                        | Costo token più basso                        |
| Quick fix <30min, non LinkedIn | Codex OK                     | Non serve memoria completa                   |
| Ricerca web/docs               | Claude Code                  | Hook WebSearch tracing                       |
| Memoria/handoff/organizzazione | Claude Code                  | Hook Stop + Obsidian sync                    |
| Lavoro da mobile/VPS           | Cloud Code                   | Se necessario                                |

## Gap critici documentati (non normalizzati)

### GAP-1: Caricamento memoria `/memory/` in Codex

- **Impatto**: Codex parte senza sapere chi è l'utente, decisioni prese, feedback ricevuti.
- **Mitigazione**: `codex-runtime-context.ps1` SessionStart inietta un context-only che punta ai file
- **Gap residuo**: il file non è letto automaticamente, deve essere richiesto esplicitamente

### GAP-2: PreToolUse Edit in Codex

- **Impatto**: LinkedIn-touch, file con segreti, file >300 righe modificabili senza gate
- **Mitigazione**: `codex-edit-gate.ps1` (da implementare)
- **Gap residuo**: nessuno, se implementato

### GAP-3: PreCompact handoff in Codex

- **Impatto**: Codex che compatta senza generare CONTINUATION.md perde stato
- **Mitigazione**: Nessuna equivalente nativa in Codex
- **Gap residuo**: il compact di Codex è opaco

### GAP-4: PostToolUse Edit hygiene in Codex

- **Impatto**: Modifiche in Codex non controllate (size, duplicate, dead code)
- **Mitigazione**: `codex-post-edit.ps1` (da implementare)

### GAP-5: Sync Obsidian in Codex Stop

- **Impatto**: Vault non aggiornato dopo sessioni Codex
- **Mitigazione**: Estensione `codex-stop-check.ps1` con chiamata sync Obsidian

## Come verificare parità

Esegui dopo ogni cambiamento infrastrutturale:

```bash
npm run audit:codex-hook-parity  # verifica copertura Codex minima
npm run audit:ai-control-plane    # verifica stato globale
```

Manuale (per task critici):

```
# Confronta hook tra ambienti
diff <(ls ~/.claude/hooks/) <(ls .codex/hooks/)
```

## Regola operativa

**Prima di scegliere ambiente**: consulta questa matrice. Se il task tocca un'area dove ci sono GAP critici, non usare Codex/Cloud Code senza mitigazioni esplicite. I gap non sono un'aspirazione — sono limiti operativi reali.

**Dopo ogni modifica a hook/canonici**: verificare che la matrice resti attuale. Aggiornare prima di committare.
