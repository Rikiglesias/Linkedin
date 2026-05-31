# AI_RULES_DIGEST.md

> Indice compatto delle regole AI operative del progetto LinkedIn bot.
> Non e' fonte primaria — per dettagli leggere canonici completi.

## 3 Momenti

INIZIO (SessionStart): memoria+digest+routing. DURANTE (UserPromptSubmit+Pre/PostToolUse): routing,L1gate,antiban,audit. FINE (Stop): worklog+active.md.

## 9 Livelli

Definizione canonica: `~/.claude/L_LEVELS.md` (splittato da CLAUDE.md per leggibilità). Non ridefinire qui.
Proporzione: Quick=L1-L4 | Bug=L1-L6 | Feature=L1-L9.

## 10 Regole zero (canoniche globali)

Definizione canonica completa: `~/.claude/ZERO_RULES.md`. Sintesi tabellare in `~/.claude/CLAUDE.md`.

- **zero-A**: cerca prima, costruisci dopo (skill/MCP/web prima di reinventare)
- **zero-B**: ragionamento oggettivo, posizione ferma con evidenza
- **zero-C**: metodo migliore per OGNI task, 360°, mettiti alla prova
- **zero-D**: contesto totale + pulizia obbligatoria prima di creare/modificare
- **zero-E**: dettaglio massimo, esplicito + implicito
- **zero-F**: auto-evoluzione (proporre regole/skill/hook quando serve)
- **zero-G**: domande proattive (generali / dominio / task type)
- **zero-H**: light ogni volta vs deep periodico
- **zero-I**: simplicity first / surgical changes (counterbalance overengineering)
- **zero-J**: completamento totale 360°, mai chiusura "abbastanza"

## Checklist operativa

Distillato cosa fare SEMPRE + per task type + per dominio + dichiarazione finale: `~/.claude/CHECKLIST.md`.

## 9 Regole operative LinkedIn-specifiche (non duplicate con globali)

Le 13 regole storiche che duplicavano zero-A/B/C/D/E/F/G/H/I/J, L_LEVELS.md, `.claude/rules/git-commit-push.md`, `.claude/rules/model-selection.md`, `meta-reasoning.md` sono state rimosse e ora risiedono nei canonici globali. Restano solo le 9 regole specifiche al bot:

### 5. Fonte di verita' (mapping specifico bot)

Stabile→repo/test/canonici. Esterno→docs+web ufficiali. Reale→MCP (Supabase/Playwright). Divergenza→bug operativo.

### 6. Web/docs obbligatori

Framework/API/anti-ban/stealth/sicurezza/policy/compliance LinkedIn recenti. Knowledge obsoleta≠aggiornata.

### 9. Esecuzione intelligente

Classificare task. Chiarire: problema/rischio/fonte/strumenti/ordine. Nessuna chiusura senza verifica.

### 12. Loop e lavoro incrementale

Task troppo grande → Scomponi in parti, loop su ciascuna, verifica ogni pezzo. Meglio 3 pezzi verificati che 5 mezze+rotte. `/loop` per iterazione automatica. Verifica L1-L4 ad ogni giro.

### 15. n8n + agenti

n8n=orchestratore primario. Workflow riusabili/leggibili. Trigger=contesto reale. HITL per operazioni rischiose.

### 19. Nuovi progetti

Checklist bootstrap: setup/gate/tooling/memoria/ambienti/sicurezza/handoff/manutenzione. Vedi `docs/NEW_PROJECT_BOOTSTRAP_CHECKLIST.md`.

### 20. Strumenti personali

Whisper stabile per voice dictation. Codex quando ha senso (non-LLM task). Problemi→tracciare+risolvere.

## Anti-Ban LinkedIn (specifico al dominio)

Varianza su tutto | Sessioni credibili | Pending ratio sotto controllo | Navigazione umana | Biometrics: hesitation non delay precisi | Fingerprint coerente | Azioni sicure verify pre/post | Monitoring attivo con alert chiari

## Domini + Source (mapping bot)

anti-ban→repo | stato→MCP Supabase | librerie→web docs ufficiali | browser→Playwright MCP | DB→Supabase | git→audit | memoria→files | n8n→live | debug→repo | test→vitest | review→diff | codice→search
