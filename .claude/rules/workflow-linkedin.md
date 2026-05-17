---
name: workflow-linkedin
paths:
  - src/**
  - workflows/**
enforcement:
  - pre-edit-antiban.ps1 (blocking)
  - pre-bash-l1-gate.ps1 (blocking)
  - npm run audit:hooks
  - npm run audit:ai-control-plane
---

# Workflow obbligatorio per progetto LinkedIn — L1-L9 delta

> Path-scoped rule estratta da AGENTS.md. Attiva su tutti i file `src/**` del progetto LinkedIn Bot.
> Sono **delta sopra** i sub-check globali L1-L9 in `~/.claude/CLAUDE.md`, NON sostituzioni.

## Classificazione task

- **quick fix**: piccolo, locale, non tocca browser o stealth
- **bug bot**: crash, errore runtime o comportamento anomalo
- **feature/modifica bot**: tocca browser, timing, delay, stealth o volumi
- **refactor/infra**: tocca DB, log, config, documentazione o orchestrazione senza toccare il browser

## Passi obbligatori

1. pre-modifica
2. review anti-ban e security se il perimetro lo richiede
3. planning se il task è lungo o l'approccio non è ovvio
4. implementazione
5. verifica
6. commit/push solo dopo verifiche verdi

## L1 LinkedIn (delta su L1 globale)

- L1-LI.1 build progetto exit 0 (frontend + backend se toccati)
- L1-LI.2 `madge --circular` su `src/risk/`, `src/scheduler/`, `src/auth/`, `src/stealth/`, `src/browser/`
- L1-LI.3 coverage adeguata sui moduli critici: risk engine, scheduler, auth, stealth, antiban
- L1-LI.4 nessun file LinkedIn-sensibile (browser, stealth, fingerprint, timing) >300 righe senza split-plan
- L1-LI.5 audit npm di dominio (`npm run audit:hooks`, `audit:ai-control-plane`) verdi se area toccata

## L3 LinkedIn (delta runtime edges)

- L3-LI.1 memory leak: listener Playwright/browser context chiusi, page.close() in ogni branch
- L3-LI.2 timeout esplicito su ogni `clickLocator`, `waitFor`, `goto` (no default infinito)
- L3-LI.3 stealth pattern: nessuna `setTimeout` con valore fisso prevedibile (sempre varianza ±30%+)
- L3-LI.4 transazione DB busy_timeout configurato (no deadlock su SQLite)
- L3-LI.5 selettori CSS/XPath: fallback chain se il principale fallisce, log selettore usato

## L4 LinkedIn worst-case

- L4-LI.1 scenario multi-giorno: state recovery dopo crash, scheduler riprende dal punto corretto
- L4-LI.2 pause durante invito: salvataggio stato + reumana il pickup
- L4-LI.3 aggiornamento selettori: ogni cambio LinkedIn DOM ha selector versioning + alert
- L4-LI.4 pending ratio sale sopra soglia → pause automatica del flusso outbound
- L4-LI.5 fingerprint mutation: cambio coerente non contraddittorio (canvas + UA + lingua + tz)

## L5 LinkedIn — alert e prodotto

- L5-LI.1 alert Telegram strutturato: WHAT (cosa è successo), WHY (causa probabile), DO (azione utente concreta)
- L5-LI.2 report giornaliero include: invii fatti, accept rate, reply rate, pending ratio, alert attivi
- L5-LI.3 dashboard mostra stato real-time (running, paused, error) con timestamp ultima azione
- L5-LI.4 nessun silent failure: ogni eccezione browser propagata fino a livello che genera alert
- L5-LI.5 storico azioni LinkedIn auditabile (chi/quando/cosa/risultato per ogni invio/messaggio)

## L6 LinkedIn — data flow E2E

- L6-LI.1 percorso completo: migration SQL → repository → API → frontend → report
- L6-LI.2 env vars validati: proxy URL, account credentials, Telegram token, Supabase keys
- L6-LI.3 proxy classification: residential vs DC corretto per account, regione coerente con fingerprint
- L6-LI.4 cookie/session storage: persistenza cifrata, no plain text su disco
- L6-LI.5 migration DB: backward-compat se schema cambia (Supabase + SQLite locale)
- L6-LI.6 GDPR compliance: erasure path funzionante, retention configurata

## L7 LinkedIn — cross-domain per file LinkedIn-touch

- L7-LI.1 anti-ban: varianza timing, sessioni credibili, pending ratio, navigazione umana
- L7-LI.2 fingerprint coerenza: no contraddizioni canvas/UA/lingua/tz
- L7-LI.3 proxy stickiness: stesso proxy per stessa session, no rotation in mezzo a action sequence
- L7-LI.4 LinkedIn API rate limit rispettato: no burst, no flood, no parallel su stesso account
- L7-LI.5 selettori multi-locale: IT/EN/FR/DE supportati se file lavora con LinkedIn DOM

## L8 LinkedIn

Dopo modifica risk engine/scheduler/antiban, ri-eseguire test integrazione browser staging reale (non solo unit).

## L9 LinkedIn

Working tree pulito + nessun file LinkedIn-touch lasciato senza `/antiban-review` verdetto se modificato in questo turno.
