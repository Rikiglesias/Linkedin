---
name: scheduler-rules
paths:
  - "src/workers/**"
  - "src/risk/**"
  - "src/automation/**"
enforcement:
  - antiban-review skill (raccomandata)
  - pre-edit-antiban.ps1 (blocking su file LinkedIn-touch)
  - post-edit-antiban-audit.ps1 (advisory)
---

# Scheduler & timing rules — workers/risk/automation

> Path-scoped rule per scheduler, queue worker, risk engine, throttling, dispatcher.
> Si attiva quando l'AI tocca `src/workers/**`, `src/risk/**`, `src/automation/**`.

## Domini critici

Lo scheduler decide **quando** un'azione LinkedIn parte. Errore qui = pattern meccanico = ban.

## Regole obbligatorie

1. **Varianza sui delay**: mai `setTimeout(fn, N)` con N fisso. Sempre `N ± 30%+` di jitter, distribuzione realistica (non uniforme).
2. **Pending ratio**: prima di ogni invio/azione, verificare il pending ratio dell'account. Sopra soglia → pause automatica + alert.
3. **Sessioni credibili**: durata sessione 5-45 min con varianza, non maratone meccaniche.
4. **Burst protection**: no N azioni in M secondi anche se cap globale non superato. Spacing minimo per azione type.
5. **Backpressure**: queue worker hanno limite massimo, no unbounded buffer. Listener registrati hanno cleanup.
6. **Timeout esplicito**: ogni I/O (Playwright, DB, HTTP) ha timeout esplicito. No default infinito.
7. **State recovery**: dopo crash, scheduler riprende dal punto corretto senza re-eseguire azioni già completate (idempotenza).
8. **Risk threshold**: account flaggato `high-risk` → degradazione automatica (volumi ridotti, sessioni più corte), non halt brusco.

## Pre-edit check

Prima di modificare file in questi path:
- Tocchi timing/delay? → declarare varianza usata
- Aumenti throughput? → check pending ratio + risk threshold
- Aggiungi nuova action LinkedIn? → antiban-review skill obbligatoria
- Modifichi worker queue? → check backpressure + state recovery

## Failure mode da prevenire

- Burst di azioni dopo pause/crash recovery (rate limit trigger)
- Delay fissi prevedibili (pattern detection)
- Pending senza decay (account ban progressivo)
- Sessione 8h continua (signal non-umano)
- Worker che svuota la queue senza pause (flood)
