# .claude/rules/ — Regole path-scoped

> Regole che si caricano automaticamente quando l'AI tocca un certo glob di file.
> Non sostituiscono `AGENTS.md` o il runtime brief: sono **enforcement specifico per dominio**.

## Convention

Ogni file in questa cartella:
- ha un **glob match** nel frontmatter (`paths:`) che dichiara su quali path la regola si attiva
- contiene **regole concrete e azionabili**, non generiche
- punta agli **hook esistenti** che ne fanno l'enforcement (pre-edit-*, post-edit-*)

Quando l'AI riceve un task che tocca un file matchato dal glob, deve:
1. leggere il file della regola
2. applicarla in modo verificabile
3. dichiarare in 1-2 righe quali sub-regole applica

## File presenti

| File | Glob match | Enforcement |
|---|---|---|
| `browser-antiban.md` | `src/browser/**`, `src/risk/**`, `src/salesnav/**` | `pre-edit-antiban.ps1` (blocking), `post-edit-antiban-audit.ps1` |
| `api-security.md` | `src/api/**`, `src/auth/**` | `pre-edit-secrets.ps1`, code review manuale |
| `scripts-audit.md` | `src/scripts/**` | `audit:ai-control-plane`, `audit:hooks` |

## Rapporto con backlog AI

Item 4 del backlog AI: `[Enforcement] introdurre .claude/rules/ path-scoped`.
La presenza di questa cartella + file copre la primitive; manca ancora la promozione automatica a hook che legge da qui (oggi gli hook esistenti hanno le regole hardcoded).
