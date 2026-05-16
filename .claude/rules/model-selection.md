---
name: model-selection
paths:
  - "**"
enforcement:
  - user-prompt-model-suggestion.ps1 (advisory)
  - ensure-claude-model-router.ps1 (config)
---

# Regole selezione modello AI per task

> Path-scoped rule estratta da AGENTS.md per ridurre dimensione canonico.
> Attiva sempre (paths `**`) perché il check va fatto su ogni task.

## Principio

L'AI deve **dichiarare proattivamente** quale modello e provider è più adatto al task corrente **prima di iniziare**, e suggerire uno switch quando il task non è allineato al modello attivo. Non aspettare che l'utente lo chieda.

## Contesto router locale

`ANTHROPIC_BASE_URL=http://127.0.0.1:4319` risolve sia alias Anthropic (`opus`, `sonnet`, `haiku`, `opusplan`) sia alias OpenRouter (`kimi`, `glm`, `qwen`, `gemini`, `deepseek`, `gpt`). Lo `settings.model` corrente non determina il provider: serve consultare statusline (AN/OR) o `switch-claude-backend.mjs status`.

## Matrice task → modello consigliato

Default ragionevoli, non assoluti.

| Tipo task | Modello primario | Fallback / alternativa | Perché |
|-----------|------------------|------------------------|--------|
| Plan Mode, decisione architetturale, refactor cross-file, blast radius ampio | `opus` (Anthropic) o `opusplan` | `gemini` (OpenRouter) per long context | Reasoning profondo, contesto lungo |
| Coding standard, bug fix, feature media, edit mirati | `sonnet` (Anthropic) | `deepseek` (OpenRouter) per code-gen pesante | Default solido, costo/qualità bilanciato |
| Lookup veloce, file map, comando shell, risposta secca | `haiku` (Anthropic) | `kimi` o `glm` (OpenRouter) | Latenza/costo minimi |
| Bulk noioso, conversione formati, migrazione boilerplate, batch | `glm` o `qwen` (OpenRouter) | `kimi` (OpenRouter) | Costo basso, qualità sufficiente per ripetitivo |
| Multimodale (immagini, screenshot, OCR, Playwright debug) | `gemini` (OpenRouter) | `sonnet` (Anthropic) | Vision nativa di qualità |
| Anti-ban LinkedIn, sicurezza, migration DB, codice production-critical | `opus` o `sonnet` (Anthropic) | **mai** OpenRouter senza esplicita autorizzazione | Reasoning + tracciabilità provider su area ad alto rischio |
| Loop autonomo lungo, polling, babysitting | `haiku` o `glm`/`kimi` (OpenRouter) | — | Costo per iterazione basso |
| Documentazione, scrittura prosa, traduzione, regole canoniche | `sonnet` (Anthropic) | `qwen` (OpenRouter) | Coerenza linguistica IT/EN |

## Quando suggerire uno switch

- Task corrente classificato in cella diversa dal modello attivo → dichiarare lo scarto e proporre `/model <alias>`
- Task ad alto rischio (anti-ban, sicurezza, DB) su modello OpenRouter → fermarsi e raccomandare switch a Anthropic prima di procedere
- Task bulk/ripetitivo lungo su Opus/Sonnet → suggerire downgrade a OpenRouter per costo, dichiarando il trade-off
- Plan Mode attivato ma modello non è Opus/opusplan → suggerire switch

## Formato raccomandazione

Breve, in cima alla risposta quando applicabile: `Modello attivo: X. Per questo task consiglio: Y. Motivo: Z.` Se il modello attivo è già adeguato, non serve dichiarare nulla.

## Anti-pattern

**No raccomandazione cieca**: la matrice è un default. Se il contesto del task ha vincoli specifici (esempio: utente ha appena chiesto OpenRouter perché su quota Anthropic, oppure ha esplicitamente forzato un modello), rispettare il vincolo e dichiarare di aver letto il segnale.
