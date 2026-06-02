# .claude/rules/ — Regole path-scoped

> Regole che si caricano automaticamente quando l'AI tocca un certo glob di file.
> Non sostituiscono `AGENTS.md` o il runtime brief: sono **enforcement specifico per dominio**.

## Convention

Ogni file in questa cartella:

- ha un **glob match** nel frontmatter (`paths:`) che dichiara su quali path la regola si attiva
- contiene **regole concrete e azionabili**, non generiche
- punta agli **hook esistenti** che ne fanno l'enforcement (pre-edit-_, post-edit-_)

Quando l'AI riceve un task che tocca un file matchato dal glob, deve:

1. leggere il file della regola
2. applicarla in modo verificabile
3. dichiarare in 1-2 righe quali sub-regole applica

## File presenti

| File                      | Glob match                                                   | Enforcement                                                                                              |
| ------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `browser-antiban.md`      | `src/browser/**`, `src/risk/**`, `src/salesnav/**`           | `pre-edit-antiban.ps1` (blocking), `post-edit-antiban-audit.ps1`                                         |
| `api-security.md`         | `src/api/**`, `src/auth/**`                                  | `pre-edit-secrets.ps1`, code review manuale                                                              |
| `scripts-audit.md`        | `src/scripts/**`                                             | `audit:ai-control-plane`, `audit:hooks`                                                                  |
| `model-selection.md`      | `**` (sempre attiva)                                         | `user-prompt-session-advisor.ps1` (advisory: modello + chat-nuova), `switch-claude-backend.mjs` (config) |
| `git-commit-push.md`      | `**` (sempre attiva)                                         | `pre-bash-l1-gate.ps1` (blocking), `pre-bash-git-gate.ps1` (blocking), `post-bash-git-audit.ps1` (async) |
| `autonomous-workflows.md` | `**` (sempre attiva)                                         | native `/goal`, `/loop`, `stop-proactive-next-step.ps1` (advisory)                                       |
| `meta-reasoning.md`       | `**` (sempre attiva)                                         | reminder cognitivi tramite UserPromptSubmit hooks (advisory)                                             |
| `scheduler-rules.md`      | `src/workers/**`, `src/risk/**`, `src/automation/**`         | `pre-edit-antiban.ps1` (blocking), `antiban-review` skill                                                |
| `messaging-rules.md`      | `src/workers/messageWorker.ts` e affini, `src/automation/**` | `pre-edit-antiban.ps1` (blocking), `security-reviewer`                                                   |
| `proxy-rules.md`          | `src/proxy/**`                                               | `pre-edit-antiban.ps1` (blocking), `antiban-review` skill                                                |
| `workflow-linkedin.md`    | `src/**`, `n8n-workflows/**`                                 | `pre-edit-antiban.ps1` (blocking), `pre-bash-l1-gate.ps1`, `audit:hooks`                                 |

## Rapporto con backlog AI

Item 4 del backlog AI: `[Enforcement] introdurre .claude/rules/ path-scoped`.
La presenza di questa cartella + file copre la primitive; manca ancora la promozione automatica a hook che legge da qui (oggi gli hook esistenti hanno le regole hardcoded).
