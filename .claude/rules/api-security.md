---
name: api-security
paths:
  - src/api/**
  - src/security/**
  - src/integrations/**
enforcement:
  - pre-edit-secrets.ps1 (blocking)
  - pre-edit-best-practice.ps1 (advisory)
  - skill /security-reviewer
  - audit semgrep su input/query DB
---

# Regole sicurezza API e autenticazione

Si attiva quando l'AI tocca endpoint API, auth, gestione segreti o integrazioni esterne.

## Regole obbligatorie

1. **Mai segreti hardcoded**: chiavi/token/password sempre da env validate via `src/config/env.ts` o secret manager.
2. **Input validation**: ogni endpoint pubblico deve validare via `zod`/`schemas.ts` prima di toccare DB o servizi.
3. **No SQL injection**: query parametrizzate sempre, mai concatenazione stringhe. Repository pattern in `src/core/repositories/`.
4. **Rate limit**: ogni endpoint pubblico ha rate limit + retry policy esplicita.
5. **Audit log**: azioni sensibili (auth, modifica permessi, accesso dati) vanno tracciate in `src/api/helpers/audit.ts`.
6. **CORS scoped**: niente `*` ovunque; origin esplicito per ambiente.
7. **Token TTL**: JWT/session token con expiry corto + refresh, mai `Infinity`.
8. **GDPR**: dato personale identificabile → cifrato a rest, accesso loggato, supporto erasure.

## Controlli pre-merge

Prima di approvare modifica a file in questo glob:

1. Nuovo endpoint? → ha auth check + rate limit + validation schema?
2. Tocca DB? → query parametrizzata + transazione se serve atomicità?
3. Restituisce dato utente? → filtro per ownership + redaction segreti?
4. Integra servizio esterno? → timeout esplicito + circuit breaker?
5. Tocca cookie/session? → secure + httpOnly + sameSite corretti?

Se ambiguo → invocare `/security-reviewer` per review SAST.

## Hook che enforced queste regole

- `~/.claude/hooks/pre-edit-secrets.ps1`: blocca scrittura segreti
- `~/.claude/hooks/pre-edit-best-practice.ps1`: forza dichiarazione best practice
- Semgrep MCP per SAST mirato

## Fonti di verità

- `AGENTS.md` (regole canoniche)
- `docs/GDPR_ART30_REGISTER.md` (data flow personale)
- OWASP Top 10 (web search se serve refresh)
