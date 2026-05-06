# AI Runtime Brief

> Documento runtime compatto caricato dai hook.
> Regole complete: ~/.claude/CLAUDE.md e AGENTS.md. Non ridefinire qui.

## Fonti di verita'

- `AGENTS.md`, `docs/AI_MASTER_SYSTEM_SPEC.md`, `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md`
- `docs/AI_OPERATING_MODEL.md`, `docs/tracking/AI_CAPABILITY_ROUTING.json`, `docs/tracking/AI_LEVEL_ENFORCEMENT.json`

## Obiettivo operativo

Nessuna omissione. Nessuna assunzione gratuita. Nessuna false completion.
Se non e' verificato, non puo' essere dichiarato completo.

## Livelli L1-L9

Definizione canonica: ~/.claude/CLAUDE.md sezione "## L1-L9".
Proporzione: Quick-fix=L1-L4 | Bug=L1-L6 | Feature/refactor=L1-L9.
Stato enforcement: L1 bloccante. L2-L6 audit-assisted. L7-L9 via /verification-protocol.

## Repo LinkedIn — estensioni locali

- Modifiche su browser, timing, delay, stealth, fingerprint, sessione o volumi: valutare sempre impatto anti-ban (`antiban-review`).
- L1: `madge --circular` sui moduli core toccati + coverage adeguata per risk/scheduler/auth/stealth.
- L3: memory leak, listener, timeout, pattern stealth, busy timeout DB.
- L4: scenari multi-giorno, recovery, pause durante invito, aggiornamento selettori LinkedIn.
- L5: Telegram e report devono dire cosa fare, non solo cosa e' successo.
- L6: percorso migration → repository → API → frontend → report.
- Commit solo dopo L1 verde. Push solo se branch/upstream/rischio OK.
