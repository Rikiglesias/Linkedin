---
name: linkedin-patterns
description: Pattern e best practice canoniche per LinkedIn Bot — anti-ban (varianza timing/click, sessioni credibili, pending ratio), stealth (UA matching, JA3 fingerprint, geo-coerenza), proxy Oxylabs mobile sticky 30min, browser automation Playwright human-like (clickLocatorHumanLike, viewport dwell, no teletrasporti page.goto), workflow n8n via automation_commands queue, Supabase + Postgres prod. Attivare con /linkedin-patterns, "pattern LinkedIn", "best practice bot", "come faccio X su LinkedIn senza ban", "stealth LinkedIn", "proxy bot", "human click LinkedIn".
---

# /linkedin-patterns — LinkedIn Bot Patterns

## Anti-ban (priorita' assoluta)

Ogni modifica che tocca browser, timing, fingerprint o sessione:

- **Domanda zero**: "questa modifica puo' farci bannare?"
- Varianza su tutto — niente pattern fissi di timing/click/navigazione
- Sessioni credibili — niente maratone meccaniche
- Pending ratio sotto controllo — monitorare e limitare
- Fingerprint coerente — browser engine, proxy, geolocalizzazione allineati
- Browsing minimo richiesto pre-connect (JA3 fingerprinting check)
- UA matching con browser engine reale (non spoofing banale)

## Proxy e sessione

- Proxy residentiali/mobili — Oxylabs configurazione attiva
- Geo-coerenza exit IP con UA del browser
- Sessione: no sovrapposizione account diversi, no teletrasporto navigazione
- `windowInputBlock` — protezione da takeover mouse durante sessioni

## Workflow n8n

- Separare core bot (connect, message, follow-up, health, recovery) da DevOps (alert, cleanup, manutenzione)
- Hook ingresso/uscita come check reali, non doc note
- HITL per flussi ad alto rischio
- Stato durevole dove il workflow non e' stateless

## Database + API

- Supabase = SSOT per stato condiviso
- Repository pattern — query incapsulate, business logic separata
- Outbox events per idempotenza e retry
- Migration idempotenti

## Quality gates

- `npm run pre-modifiche` → build + lint + typecheck + test
- `npm run post-modifiche` → stessa verifica post-cambiamenti
- `npm run conta-problemi` → 0 problemi prima del commit
- Hook `PreToolUse` blocca commit senza gate
- Hook `PostToolUse` loga qualita' eseguita

## Runtime

- Daemon lock cooperativo rinnovato per tutta la durata reale
- Graceful shutdown: NO `process.exit(0)` nei path critici
- Recover `automation_commands` rimasti RUNNING dopo crash
- `/api/health/deep` misura daemon liveness, zombie, readiness
