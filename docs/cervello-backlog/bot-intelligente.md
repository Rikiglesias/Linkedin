# bot-intelligente — rendere il bot intelligente (no valori preimpostati/ciechi) — /goal binding

> **CONFERMATO-APERTO 2026-07-04 — passata `todos-freddi`** (auditor opus, verifica alla fonte; verdetti integrali: `maintenance/2026-07-04-verdetti-todos-freddi.json`)
> Evidenza: Classe CORE chiusa (riga 44: gruppi A/B/C/D tutti [x], commit 640be08/489768d/6e7817e/c94adca, gate verde, antiban SAFE). MA 2 follow-up [ ] restano, ≥1 verificato REALE alla fonte: inviteNotePersonalizer.ts:122-127 NOTE_TEMPLATES_BY_LANG={it,en,fr,es} → de/nl ASSENTI, :133 fallback ?? NOTE_TEMPLATES(=IT) → lead de/nl ancora nota IT (riga 47). Riga 48 = bundle anti-ban preesistente (missclick "cadere dentro target" / auto-push-hook / Stop-hook loop): src/browser/missclick.ts computeSafeMissclick…
> Azione/causa: NON archiviare né marcare [x] intero. Tenere CONFERMATO-APERTO. Causa: end-state della CLASSE raggiunto e provato, ma 2 follow-up fuori-classe residui (de/nl VERIFICATO aperto; bundle anti-ban non provato chiuso → cautela anti-ban vieta CHIUSO). Prossimo passo concreto: (1) aggiungere NOTE_TEMPLATES_DE/NL in inviteNotePersonalizer.ts e cablarli in NOTE_TEMPLATES_BY_LANG (:122-127); (2) verificare/chiudere i 3 item anti-ban preesistenti riga 48 con /antiban-review. Poi migrare i residui a docs/LINKEDIN_IMPLEMENTATION_LIST.md (copy de/nl) + linkedin-hardening/backend-antiban-hardening.md (bundle…


> Audit wtho10thk (2026-06-08). Classe: il bot CHIEDE/INVENTA/USA valori preimpostati/ciechi invece
> di derivarli dallo STATO REALE. Esempio-modello GIÀ FIXATO: syncListService buildListQuestion (commit 640be08).
> Output completo audit: C:\Users\albie\AppData\Local\Temp\claude\...\tasks\wtho10thk.output (52k char, 22 istanze).

## END-STATE (misurabile)
Tutte le istanze sistemate (derivare dallo stato reale o varianza), gate verde (conta-problemi exit 0) dopo ogni gruppo, `/antiban-review` SAFE sui file gated. Anti-ban-first.

## Sotto-classi
- (A) LISTA fantasma 'default'/'Default' free-text che dovrebbe derivare da listSalesNavLists().
- (B) SCELTE anti-ban a contatore/soglia FISSA o seed cieco (long-break ogni 7, spacing uniforme, account leadId%N, SSI=55, weekend 0.0, pacing a gradini) — gated, alta credibilità.
- (C) lingua/template SEMPRE IT o id%N invece di derivare da lead.location/segmento.

## Fix ordinati (anti-ban-first) — ogni fix: gate verde + antiban-review se gated
### ✅ GRUPPO A — ghost-list 'default'/'Default' (FATTO, commit pending, gate verde 1561 test, antiban SAFE)
- [x] R0 RADICE: domains.ts:423 default 'default'→'' (= null = tutte le liste reali) + validation.ts rimossa regola "list vuoto" (vuoto ora è VALIDO). Semantica verificata: salesNavigatorSync.ts:596/736-739 (listFilter null → targetLists=discovered=tutte); 'default' causava THROW garantito (filter 0 match) dopo aver aperto il browser.
- [x] R1 loopCommand.ts:480 — RISOLTO DALLA RADICE: '' → cleanText→null → tutte le liste reali (non più ghost+onError:skip che sprecava sessione). No edit (zero-I).
- [x] R2 salesNavCommands.ts:332 — RISOLTO DALLA RADICE: riga 345 già normalizza `?.trim() ? : null`. askUserToChooseList è per SAVE/destinazione (forza 1 lista) → semantica errata per sync/sorgente. No edit.
- [x] R5 syncSearchService.ts:93,121 — buildDestinationListDefault (lista DESTINAZIONE più recente by last_synced_at; semantica ≠ sorgente → NO opzione "tutte"). Elimina '?? Default'.
- [x] EXTRA (zero-E.7, non in todo): sendInvitesWorkflow.ts:55/65 `|| 'default'` ghost hardcoded → `|| undefined`/'(tutte le liste)'. adminCommands.ts:208 reporting `|| null`.

### ✅ GRUPPO B — pattern anti-ban temporali FISSI (scheduler) (FATTO, commit 489768d, gate verde, antiban SAFE)
- [x] R3 scheduler.ts long-break `% 7` → STOCASTICO Bernoulli ~1/longBreakEvery (posizione casuale, freq media invariata). Rimosso contatore queuedJobs orfano.
- [x] R4 scheduler.ts spacing UNIFORME randomInt → logNormalDelaySec (nuova gemella di logNormalDelayMs in utils/random.ts). Mediana terzo inferiore, coda destra, floor preservato.
- [x] Le altre 5 righe randomInt (899/932/995/1016/1047) ANALIZZATE → ESCLUSE con motivo (macro-scheduling sparso per-entità, non micro-ritmo; enrichment nemmeno azione browser). NO gold-plating (zero-I).
- [x] Test scheduler.vitest.ts aggiornato al nuovo contratto stocastico (campione 2000, floor + non-periodicità).
### ✅ GRUPPO C — lingua outreach dal paese del lead (FATTO, commit 6e7817e, gate verde 1566 test, antiban SAFE)
- [x] R7: NUOVO ai/leadLanguage.ts resolveLeadLanguage(lead) (paese→lingua, conservativo, fallback it). Cablato: messagePersonalizer:50, messageWorker (default+template), messagePrebuildWorker:56, inviteWorker:182. Implementa messaging-rules #5 (era violata). Dato reale: 130/250 lead stranieri ricevevano IT. +test.
- [x] aiQuality.ts ESCLUSO (lead sintetico, lingua irrilevante). FOLLOW-UP tracciato: NOTE_TEMPLATES_BY_LANG manca de/nl (note de/nl → fallback IT).

### ✅ GRUPPO D — quick-win (FATTO, commit c94adca, gate verde 1566 test, antiban SAFE)
- [x] R6 sendInvitesService noteMode default 'none' → config (inviteWithNote ? inviteNoteMode : 'none'). Default fabbrica invariato.
- [x] R8 utilCommands import --list bucket 'default' → derivato dal nome file CSV.
- [x] R9 salesNavCommands typo sotto-comando → NON apre browser ('salesnav save'); stampa validi + exit 1.

### ✅ Istanze 10-22 — VALUTATE alla fonte (zero-M): NON sono bug della classe
- [x] pickAccountIdForLead leadId%N (accountManager:145): determinismo VOLUTO = coerenza account-lead (randomizzare = peggio). Corretto.
- [x] SSI=55 (domains:362 SSI_DEFAULT_SCORE): fallback neutro config, SSI reale da scraping settimanale. Default legittimo.
- [x] weekend (domains:470 WEEKEND_POLICY_ENABLED=true): bot RISPETTA il weekend = regola anti-ban. Corretto.
- [x] pacing gradini = ramp-up graduale voluto. Corretto.
- → L'audit le flaggava senza distinguere "cieco-sbagliato" da "default/scelta-corretta". Fixarle peggiorerebbe. CLASSE CHIUSA.

## ✅ ESITO: classe "valori ciechi → stato reale/varianza" CHIUSA. 4 gruppi (A/B/C/D) committati, gate verde, antiban SAFE.

## FOLLOW-UP (fuori dalla classe, tracciati)
- [ ] Note invito de/nl: NOTE_TEMPLATES_BY_LANG ha solo it/en/fr/es → lead de/nl ricevono nota IT (msg invece è multilingua). Creare copy note de/nl.
- [ ] (preesistenti) missclick wiring (computeSafeMissclickPoint può cadere dentro target); hook auto-push NON rompe su area anti-ban (regola non enforced); verificare altri Stop hook per loop additionalContext.

## openQuestions (prodotto, utente)
- weekend activity sì/no · account-assignment policy · semantica lista destinazione vs sorgente (sync-search).

## Note
- File gated anti-ban (loop/scheduler/salesNav/workers): /antiban-review SAFE → flag ~/.claude/state/antiban-approved.txt PRIMA di ogni Edit (1 uso/edit).
- VERIFICA blast radius del fix RADICE (R0) PRIMA: tutti i consumer di salesNavSyncListName gestiscono il vuoto→null→discover?
