---
auto-tracked: true
description: Findings strutturati estratti automaticamente da pattern AI nelle risposte di chiusura sessione (Stop/SubagentStop/SessionEnd hook). Manual entry permessa sotto sezione "## Manuali", auto-entry vanno sotto "## Auto-tracked".
schema:
  - timestamp_iso
  - session_id
  - hash_sha256
  - source_hook
  - pattern_matched
  - content
---

# Session findings — auto-tracked

> File popolato automaticamente da `~/.claude/hooks/stop-auto-track.ps1` quando una risposta AI contiene pattern strutturati (TODO futuro, Fix tracciato, Sprint dedicato, BLOCKED, Decisione).
>
> **Schema entry**: ogni entry ha timestamp ISO 8601, session_id (UUID), hash SHA-256 dei primi 256 char della risposta, source hook (Stop/SubagentStop/SessionEnd), pattern matched, content estratto.
>
> **Dedupe**: hash + pattern usati come chiave per evitare duplicati su rerun.
>
> Validazione: `npm run audit:auto-track`.

## Auto-tracked

Formato entry generato (esempio in code block per non confondere parser):

```text
### [2026-05-18T01:23:45Z] pattern=TODO_FUTURO session=abc123 hash=<sha256> source=stop
> content estratto dalla risposta AI
```

(Nessun finding auto-tracciato ancora — il hook viene attivato solo su pattern espliciti nelle risposte finali.)

## Manuali

(Findings inseriti manualmente. Mantenere separati dagli auto-tracked.)
