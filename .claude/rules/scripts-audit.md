---
name: scripts-audit
paths:
  - src/scripts/**
  - hooks/**
  - .githooks/**
enforcement:
  - audit:hooks
  - audit:ai-control-plane
  - post-edit-codebase-hygiene.ps1
---

# Regole per script di audit e hook

Si attiva quando l'AI tocca script di audit, hook Claude Code o registri canonici del control plane.

## Regole obbligatorie

1. **Drift doc-hook-audit = bug**: se modifico un hook, devo aggiornare `audit:hooks` e `AI_HOOK_ENFORCEMENT_PLAN.md` nello stesso commit.
2. **Audit deve fallire prima di passare**: aggiungere un check con assert `passed: false` per il caso problema, verificare che fallisca, poi sistemare il codice/config, verificare che passi.
3. **Condition-aware**: gli audit che dipendono da stato runtime (`ANTHROPIC_BASE_URL`, modalità router, branch) devono leggere lo stato attuale, non assumere.
4. **No falsi positivi**: meglio un check assente che uno che fallisce per condizioni non deterministiche.
5. **Idempotenza**: ogni audit deve produrre stesso risultato a parità di stato. No side effects.
6. **Exit code corretto**: `0` solo se tutti i check passano; `1` se almeno uno fallisce. Necessario per CI / git gate.

## Controlli pre-merge

1. Modifica audit → aggiornato anche il file canonico che documenta cosa l'audit copre?
2. Aggiunto check → testato sia il caso PASS che il caso FAIL?
3. Modifica hook in `~/.claude/hooks/` → aggiornato `audit:hooks` per riconoscerlo?
4. Aggiunto script in `src/scripts/` → aggiunto npm script in `package.json`?
5. Modifica `AI_CAPABILITY_ROUTING.json` o `AI_LEVEL_ENFORCEMENT.json` → eseguito `audit:routing` / `audit:l2-l6`?

## Hook e audit collegati

- `npm run audit:hooks` — conformità hook
- `npm run audit:ai-control-plane` — composito (docs + hooks + routing + ADK + L2-L6 + list completeness)
- `~/.claude/hooks/post-edit-codebase-hygiene.ps1` — controllo cleanup file diretti/indiretti

## Fonti di verità

- `docs/tracking/AI_HOOK_ENFORCEMENT_PLAN.md` (lista hook attesi e tipo)
- `docs/tracking/AI_CAPABILITY_ROUTING.json` (routing registry)
- `docs/tracking/AI_LEVEL_ENFORCEMENT.json` (livelli L2-L9)
- `docs/tracking/AI_ADK_CAPABILITY_GOVERNANCE.json` (5-layer ADK)
