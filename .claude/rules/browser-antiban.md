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
3. **Sessioni credibili e CORTE**: durata 5-45 min con varianza, niente maratone meccaniche; niente azioni durante orari implausibili (notte profonda 02:00-06:00 UTC del fuso utente). Rispettare la finestra ramp-up.
4. **Pending ratio**: non superare la soglia di invitations pending configurata in `riskEngine`. Mai bypass.
5. **Navigazione umana**: prima di azionare bottoni, leggere la pagina (mouse move, hover, scroll naturale). Non click ciechi a coordinate fisse.
6. **Fingerprint stabile per sessione**: niente cambi UA/viewport/timezone mid-session.
7. **Cookie/session**: non resettare cookie senza motivo. Una volta loggati, mantenere la sessione per le run brevi.
8. **Azioni sicure con verify pre/post**: ogni azione LinkedIn verifica lo stato prima e dopo (mai click ciechi su esito assunto).
9. **Monitoring attivo con alert chiari**: ogni nuovo failure mode ha log + alert attivabile (WHAT/WHY/DO), mai silent.
10. **Ramo-che-decide: dichiara dove cade il DEFAULT** (2026-08-05, da errore reale). Se aggiungi una guardia, un flag o un early-return che decide **se** una capability si usa, verifica e dichiara — con evidenza, risolvendo i default reali e non leggendo il sorgente — **in quale ramo cade la configurazione di default**. Le due risposte da escludere sono «mai» (guardia inutile) e «sempre» (**capability uccisa in silenzio**, zero-Q). Un test che asserisce le *stringhe* del file non distingue i due casi: una guardia che non scatta mai e una che scatta sempre lo superano identiche. Caso reale: una guardia sul viewport sembrava proteggere il fallback vision e invece lo disattivava del tutto, perché `headless` è `false` di default e in non-headless `viewportSize()` è sempre `null` (ledger `verificata-la-rappresentazione-invece-della-cosa`, 2ª occ.).

## 6 domande pre-codice e pre-merge (obbligatorie — lista UNICA, fonde le ex "5 domande" di AGENTS.md)

Prima di scrivere/approvare modifiche a file in questo glob, rispondere a:

1. Aumenta il rischio di detection?
2. Riduce la varianza dei pattern azione?
3. Introduce delay precisi, timing fissi, azioni a coordinate fisse o cambia l'ORDINE delle azioni?
4. Tocca pending ratio / quota / volumi / cap / scheduling?
5. Modifica fingerprint, UA, viewport, JA3, cookie, stealth o sessione?
6. Cambia il comportamento browser o aggiunge azioni LinkedIn nuove (click, navigazione, typing)?

Se anche una risposta è ambigua, invocare `/antiban-review` per audit dedicato.

## Hook che enforced queste regole

- `~/.claude/hooks/pre-edit-antiban.ps1`: blocca Edit/Write su `src/browser/*`, `src/risk/*`, `src/salesnav/*` senza dichiarazione anti-ban
- `~/.claude/hooks/post-edit-antiban-audit.ps1`: traccia possibili miss dopo il commit

## Fonti di verità

- `docs/AI_RUNTIME_BRIEF.md` (regola compatta)
- `AGENTS.md` (regole canoniche)
- Audit `audit:violations` (log miss)
