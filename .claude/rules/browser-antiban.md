---
name: browser-antiban
paths:
  - src/browser/**
  - src/risk/**
  - src/salesnav/**
  - src/captcha/**
  - src/workers/**
enforcement:
  - pre-edit-antiban.ps1 (blocking)
  - post-edit-antiban-audit.ps1 (advisory)
  - skill /antiban-review
---

# Regole anti-ban LinkedIn (path-scoped)

Si attiva quando l'AI tocca codice browser/sessione/timing/stealth LinkedIn.

## Regole obbligatorie

1. **Varianza naturale**, mai delay precisi: niente `await sleep(2000)`. Usare distribuzioni con jitter (es. `humanDelay(min, max, distribution: 'gamma')`).
2. **Hesitation, non delay**: pause umane = esitazione contestuale (scroll, mouse jitter, re-read), non solo timeout fissi.
3. **Sessioni credibili**: niente azioni durante orari implausibili (notte profonda 02:00-06:00 UTC del fuso utente). Rispettare la finestra ramp-up.
4. **Pending ratio**: non superare la soglia di invitations pending configurata in `riskEngine`. Mai bypass.
5. **Navigazione umana**: prima di azionare bottoni, leggere la pagina (mouse move, hover, scroll naturale). Non click ciechi a coordinate fisse.
6. **Fingerprint stabile per sessione**: niente cambi UA/viewport/timezone mid-session.
7. **Cookie/session**: non resettare cookie senza motivo. Una volta loggati, mantenere la sessione per le run brevi.

## 5 domande pre-merge (obbligatorie)

Prima di approvare modifica a file in questo glob, rispondere a:

1. Aumenta il rischio di detection?
2. Riduce la varianza dei pattern azione?
3. Introduce delay precisi o azioni a coordinate fisse?
4. Tocca pending ratio / quota / scheduling?
5. Modifica fingerprint, UA, viewport, JA3 o cookie session?

Se anche una risposta è ambigua, invocare `/antiban-review` per audit dedicato.

## Hook che enforced queste regole

- `~/.claude/hooks/pre-edit-antiban.ps1`: blocca Edit/Write su `src/browser/*`, `src/risk/*`, `src/salesnav/*` senza dichiarazione anti-ban
- `~/.claude/hooks/post-edit-antiban-audit.ps1`: traccia possibili miss dopo il commit

## Fonti di verità

- `docs/AI_RUNTIME_BRIEF.md` (regola compatta)
- `AGENTS.md` (regole canoniche)
- Audit `audit:violations` (log miss)
