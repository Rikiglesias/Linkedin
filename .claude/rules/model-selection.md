---
name: model-selection
paths:
    - '**'
enforcement:
    - user-prompt-session-advisor.ps1 (advisory: modello + chat-nuova, ogni richiesta)
    - switch-claude-backend.mjs (config)
---

# Regole selezione modello AI per task

> Path-scoped rule estratta da AGENTS.md per ridurre dimensione canonico.
> Attiva sempre (paths `**`) perché il check va fatto su ogni task.

## Principio

L'AI deve **dichiarare proattivamente** quale modello e provider è più adatto al task corrente **prima di iniziare**, e suggerire uno switch quando il task non è allineato al modello attivo. Non aspettare che l'utente lo chieda.

## Contesto provider

Ci sono due modalità distinte:

- **Anthropic nativo**: `ANTHROPIC_BASE_URL` assente in `C:\Users\albie\.claude\settings.json`. In questa modalità il picker `/model` ufficiale mostra solo i modelli abilitati dal piano/account corrente (tipicamente Default, Sonnet, Sonnet 1M, Opus, Haiku; Opus 1M solo se Anthropic lo espone). Per selezionare Anthropic usare il picker nativo, non alias router.
- **OpenRouter/router**: `ANTHROPIC_BASE_URL=http://127.0.0.1:4319`. In questa modalità il router locale risolve gli alias OpenRouter (`kimi`, `glm`, `qwen`, `gemini`, `deepseek`, `gpt`, `or-sonnet-1m`, `or-opus-1m`).

Per verificare lo stato usare `node C:\Users\albie\.claude\scripts\switch-claude-backend.mjs status`. Per tornare ad Anthropic nativo usare `/anthropic` o `node ...\switch-claude-backend.mjs anthropic`. Per OpenRouter usare `/or:<alias>` o `node ...\switch-claude-backend.mjs openrouter <alias>`.

## Matrice task → modello consigliato

Default ragionevoli, non assoluti.

| Tipo task                                                                    | Modello primario                    | Fallback / alternativa                            | Perché                                                     |
| ---------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| Plan Mode, decisione architetturale, refactor cross-file, blast radius ampio | Opus dal picker Anthropic nativo    | `gemini` (OpenRouter) per long context            | Reasoning profondo, contesto lungo                         |
| Coding standard, bug fix, feature media, edit mirati                         | `sonnet` (Anthropic)                | `deepseek` (OpenRouter) per code-gen pesante      | Default solido, costo/qualità bilanciato                   |
| Lookup veloce, file map, comando shell, risposta secca                       | `haiku` (Anthropic)                 | `kimi` o `glm` (OpenRouter)                       | Latenza/costo minimi                                       |
| Bulk noioso, conversione formati, migrazione boilerplate, batch              | `glm` o `qwen` (OpenRouter)         | `kimi` (OpenRouter)                               | Costo basso, qualità sufficiente per ripetitivo            |
| Multimodale (immagini, screenshot, OCR, Playwright debug)                    | `gemini` (OpenRouter)               | `sonnet` (Anthropic)                              | Vision nativa di qualità                                   |
| Anti-ban LinkedIn, sicurezza, migration DB, codice production-critical       | `opus` o `sonnet` (Anthropic)       | **mai** OpenRouter senza esplicita autorizzazione | Reasoning + tracciabilità provider su area ad alto rischio |
| Loop autonomo lungo, polling, babysitting                                    | `haiku` o `glm`/`kimi` (OpenRouter) | —                                                 | Costo per iterazione basso                                 |
| Documentazione, scrittura prosa, traduzione, regole canoniche                | `sonnet` (Anthropic)                | `qwen` (OpenRouter)                               | Coerenza linguistica IT/EN                                 |

## Quando suggerire uno switch

- Task corrente classificato in cella diversa dal modello attivo → dichiarare lo scarto e proporre `/model` se si resta in Anthropic, oppure `/or:<alias>` se serve OpenRouter
- Task ad alto rischio (anti-ban, sicurezza, DB) su modello OpenRouter → fermarsi e raccomandare switch a Anthropic prima di procedere
- Task bulk/ripetitivo lungo su Opus/Sonnet → suggerire downgrade a OpenRouter per costo, dichiarando il trade-off
- Plan Mode attivato ma modello non è Opus → suggerire switch dal picker Anthropic nativo

## Formato raccomandazione

Breve, in cima alla risposta quando applicabile: `Modello attivo: X. Per questo task consiglio: Y. Motivo: Z.` Se il modello attivo è già adeguato, non serve dichiarare nulla.

## Anti-pattern

**No raccomandazione cieca**: la matrice è un default. Se il contesto del task ha vincoli specifici (esempio: utente ha appena chiesto OpenRouter perché su quota Anthropic, oppure ha esplicitamente forzato un modello), rispettare il vincolo e dichiarare di aver letto il segnale.
