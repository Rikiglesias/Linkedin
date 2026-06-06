---
name: git-commit-push-linkedin
paths:
  - "**"
enforcement:
  - .githooks/pre-commit (security scan, attivare con npm run setup:git-hooks)
---

# Commit e push — delta LinkedIn (comandi concreti)

> **Principi, enforcement globale (hook `~/.claude`), livelli review, auto-push, fallback** sono nella
> regola UNIVERSALE globale `~/.claude/rules/git-commit-push.md` (attiva su ogni progetto).
> Qui SOLO il **mapping ai comandi concreti di questo repo** (estratto da adk-split T6b).

## Mapping comandi del progetto

| Concetto universale | Comando concreto LinkedIn |
|---|---|
| Quality gate del progetto | `npm run conta-problemi` (typecheck + lint + `test:vitest`); pre/post = `npm run pre-modifiche` / `post-modifiche` |
| Audit git-automation (contesto git) | `npm run audit:git-automation` (+ `:strict:commit`, `:strict:push`, `:json`) → `READY`/`REVIEW`/`BLOCKED`/`NOOP` |
| Security-scan pre-commit nativo | `.githooks/pre-commit` → `scripts/security/check-no-secrets.mjs` (OpenAI/Anthropic/GitHub PAT/Google/AWS/Slack/JWT/PEM); attivare 1× con `npm run setup:git-hooks`; manuale `npm run security:scan` |
| Review di dominio (livello locale) | **`antiban-review`** per file LinkedIn-touch (browser/timing/stealth/fingerprint/proxy) — oltre a `/code-review`/`/simplify` |
| Audit periodici | `npm run audit:weekly` / `audit:monthly`; cadenze in `docs/tracking/AI_AUDIT_CADENCES.md` |

## Note LinkedIn

- Aree ad **alto rischio** che ROMPONO l'auto-push (oltre alle universali): anti-ban, stealth/fingerprint, proxy, migration DB → richiedono review di branch, mai auto-push diretto.
- `npm run conta-problemi` / `npm run audit:git-automation` sono npm script cross-environment (validi anche in Codex/Cloud Code per il fallback manuale dei gate).
