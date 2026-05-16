---
name: autonomous-workflows
paths:
  - "**"
enforcement:
  - native /goal slash command
  - native /loop slash command
  - stop-proactive-next-step.ps1 (advisory)
---

# Workflow autonomi continui — `/goal`, `/loop`, Stop hook

> Path-scoped rule estratta da AGENTS.md. Attiva sempre (`**`).

## Tre meccanismi

Claude Code offre tre meccanismi per tenere la sessione attiva tra prompt senza che l'utente debba scrivere ogni turno. Scegliere in base a **quando deve iniziare il turno successivo** e **quando deve fermarsi**.

| Approccio | Inizio turno successivo | Stop quando |
|---|---|---|
| **`/goal <condizione>`** | Subito dopo il turno precedente | Un evaluator (Haiku) conferma che la condizione è soddisfatta |
| **`/loop <intervallo>`** | Dopo intervallo temporale (es. 5 minuti) | L'utente ferma, o il modello decide che il lavoro è finito |
| **Stop hook** (`stop-proactive-next-step.ps1`) | Subito dopo il turno precedente | Logica deterministica nello script |

## Quando usare `/goal`

Per lavoro sostanziale con **end state verificabile** sopra più turni:
- Migrazione modulo a nuova API fino a quando tutti i call site compilano e i test passano
- Implementazione design doc fino a quando tutti i criteri di accettazione tengono
- Split file grande in moduli focalizzati fino a quando ogni file è sotto soglia
- Lavoro su backlog labeled fino a quando la queue è vuota

**Esempio operativo**:
```text
/goal all tests in test/auth pass and `npm run conta-problemi` exits 0 and `audit:ai-control-plane` returns 25/25
```

Il modello continua a lavorare finché non è davvero fatto. L'evaluator separato (Haiku, costo trascurabile) verifica ogni turn. Niente false completion.

## Come scrivere una condizione efficace

Tre componenti obbligatori:
1. **End state misurabile**: test result, build exit code, audit verde, file count, queue vuota
2. **Check dichiarato**: come provarlo, es. "`npm test` exits 0" o "`git status` is clean"
3. **Constraint che contano**: cose che non devono cambiare strada facendo, es. "no other test file is modified"

**Bounded mode**: per evitare loop infiniti, includere clausola `or stop after N turns`. Esempio: `/goal CHANGELOG.md has an entry for every PR merged this week or stop after 15 turns`.

## Quando NON usare `/goal`

- Quick fix < 30 min: overhead inutile
- Task ambiguo senza condizione misurabile
- Decisione architetturale che richiede input utente
- Quando ti basta `/loop` (re-run periodico) o Stop hook (logica deterministica)

## Comportamento operativo

- Setting `/goal` parte subito con la condizione come direttiva (no prompt separato)
- Indicator `◎ /goal active` mostra durata
- L'evaluator non chiama tool: giudica solo quanto Claude ha già mostrato in conversazione
- Goal cancellato a sessione end → restored su `--resume`, ma turn count/timer/token spend resettati
- `/goal clear` per cancellare prima che la condizione sia soddisfatta

## Requisiti

`/goal` richiede workspace trusted (trust dialog accettato). Non funziona se `disableAllHooks` o `allowManagedHooksOnly` sono settati. In tal caso il comando lo dice esplicitamente.

## Combinazione con auto mode

`/goal` + auto mode = ogni turn del goal gira senza prompt per-tool. Compatibili.
