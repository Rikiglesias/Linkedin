---
name: git-commit-push-linkedin
paths:
  - "**"
enforcement:
  - .githooks/pre-commit (security scan, attivare con npm run setup:git-hooks)
---

# Commit e push — delta LinkedIn (comandi concreti)

> **Principi, enforcement globale (hook `~/.claude`), livelli review, auto-push, fallback** sono nella
> regola UNIVERSALE globale `~/.claude/on-demand/git-commit-push.md` (lettura on-demand quando si committa/pusha).
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

- Aree ad **alto rischio** (anti-ban, stealth/fingerprint, proxy, migration DB) → NON delegare il controllo all'utente: l'AI esegue una **review approfondita PRIMA del push** — `antiban-review` con verdetto SICURO + quality gate verde + (rischio alto/ultracode) review indipendente multi-lente sul diff (Workflow fan-out). Review verde → l'AI **pusha** (repo personale non condiviso). Review con problema reale → l'AI lo risolve, non lo rimanda. Conferma utente SOLO se il branch è condiviso o serve una decisione di business. (Principio canonico: `~/.claude/on-demand/git-commit-push.md` §"Alto rischio".)
- `npm run conta-problemi` / `npm run audit:git-automation` sono npm script cross-environment (validi anche in Codex/Cloud Code per il fallback manuale dei gate).
