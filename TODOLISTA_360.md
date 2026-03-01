# TODOLISTA 360 - Backend + Frontend + Platform

Obiettivo: trasformare il progetto in una piattaforma stabile, sicura, scalabile e manutenibile nel lungo termine.

## Regole operative

- Eseguire i task in ordine di priorita (P0 -> P3).
- Ogni task va chiuso con evidenza: commit, test, note di verifica.
- Nessun merge senza passaggio `typecheck + lint + test`.
- Ogni modifica a schema DB deve avere migration dedicata.

## Legenda

- `P0` blocco critico / rischio alto
- `P1` alta priorita (stabilita e sicurezza)
- `P2` media priorita (struttura e UX avanzata)
- `P3` evoluzione (ottimizzazione e crescita)

---

## P0 - Blocchi critici (fare subito)

1. `P0-01` Allineare schema DB vs integrazioni CRM/enrichment
- [x] Mappare tutte le query che usano colonne non presenti (`email`, `full_name`, `company_name`, `source`).
- [x] Decidere strategia unica:
  - [x] Opzione A: aggiornare query alle colonne reali (`first_name`, `last_name`, `account_name`, ecc).
  - [ ] Opzione B: aggiungere migration per colonne mancanti.
- [x] Correggere `src/integrations/crmBridge.ts`.
- [x] Correggere `src/integrations/leadEnricher.ts`.
- [x] Aggiungere test integrazione specifici per questi flussi.
- DoD: nessuna query runtime su colonne assenti; test verdi.

2. `P0-02` Correggere gating AI incoerente
- [x] Unificare i gate AI su flag corretti (`AI_PERSONALIZATION_ENABLED`, `AI_GUARDIAN_ENABLED`, eventuale nuovo `AI_SENTIMENT_ENABLED`).
- [x] Rimuovere dipendenza impropria da `INVITE_NOTE_MODE` nella sentiment analysis.
- [x] Supportare in modo consistente endpoint locale AI senza key quando consentito.
- [x] Aggiornare `.env.example` e validazioni config.
- DoD: comportamento AI prevedibile e coerente in tutte le feature.

3. `P0-03` Allineare runtime Docker Playwright
- [x] Portare immagine Docker Playwright alla versione compatibile con dependency usata.
- [x] Verificare build e smoke test container.
- DoD: nessun drift tra runtime container e libreria `playwright`.

4. `P0-04` Hardening segreti e backup env
- [x] Estendere `.gitignore` a `.env.*` e file backup sensibili.
- [x] Verificare che nessun file segreto sia tracciato.
- [x] Aggiornare runbook sicurezza con checklist leak response.
- DoD: nessun secret file committabile accidentalmente.

5. `P0-05` Rendere CI coerente con quality gate reale
- [x] Aggiungere `test:integration` e `test:e2e:dry` in workflow CI.
- [x] Mantenere `typecheck`, `lint`, `audit` e build Docker.
- [x] Separare job veloci/lenti con report chiaro.
- DoD: CI riproduce i controlli locali completi.

---

## P1 - Stabilita, sicurezza, operativita

6. `P1-01` Session management dashboard robusto
- [x] Sostituire sessioni in-memory con store persistente (es. Redis o DB table dedicata).
- [x] Gestire revoke/logout e rotation token.
- [x] Aggiungere rate-limit e lockout specifico per auth endpoint.
- DoD: sessioni stabili su restart e multi-instance.

7. `P1-02` Sicurezza plugin system
- [x] Definire policy plugin (firma, allowlist path, permessi minimi).
- [x] Evitare `require` non controllato su file arbitrari.
- [x] Aggiungere validazione manifest plugin.
- DoD: caricamento plugin sicuro e auditabile.

8. `P1-03` Error handling e retry standardizzati
- [x] Uniformare retry/backoff/timeouts per tutte le integrazioni esterne.
- [x] Centralizzare policy errori transient vs terminal.
- [x] Aggiungere circuit-breaker per endpoint critici.
- DoD: riduzione error burst e fallback controllati.

9. `P1-04` Observability operativa
- [x] Definire metriche tecniche (queue lag, error rate, selector failures, challenge count).
- [x] Aggiungere dashboard operativa con soglie/alert.
- [x] Tracciare eventi chiave con correlation id.
- DoD: incident diagnosis rapida e misurabile.

10. `P1-05` Hardening lock e concorrenza
- [x] Riesaminare lock acquisition/heartbeat/release su carichi reali.
- [x] Aggiungere test race-condition su job lock e runtime lock.
- [x] Introdurre metriche lock contention.
- DoD: no doppia esecuzione workflow in condizioni concorrenti.

---

## P2 - Refactor strutturale e qualita codice

11. `P2-01` Smontare `src/core/repositories/legacy.ts` per bounded context
- [x] Estrarre modulo `leads`.
- [x] Estrarre modulo `jobs`.
- [x] Estrarre modulo `system`.
- [x] Estrarre modulo `incidents`.
- [x] Lasciare solo barrel export pulito.
- DoD: nessun file repository monolitico > 800 linee.

12. `P2-02` Ridurre query fragili e `SELECT *`
- [x] Rendere esplicite colonne su query principali.
- [x] Migliorare portabilita SQLite/Postgres.
- [x] Misurare query hot path e indici mancanti.
- DoD: query piu stabili a evoluzioni schema.

13. `P2-03` Modularizzare `config.ts`
- [x] Separare config per domini (ai, risk, sync, browser, dashboard).
- [x] Validazione schema unica (zod/io-ts o equivalente).
- [x] Generare doc config da sorgente.
- DoD: configurazione piu leggibile, testabile e meno fragile.

14. `P2-04` Uniformare runtime strategy (PM2 vs Docker)
- [x] Definire un solo modello di produzione (compiled JS preferred).
- [x] Allineare script npm, PM2, Docker, documentazione.
- DoD: runbook unico, niente divergenza operativa.

---

## P2 - Frontend avanzato (dashboard professionale)

15. `P2-05` Migrazione frontend a stack typed e modulare
- [x] Passare da JS monolitico a frontend TypeScript modulare.
- [x] API client typed + validazione response.
- [x] Separare componenti UI, store stato e servizi rete.
- DoD: codice frontend manutenibile e testabile.

16. `P2-06` Eliminare inline handlers e rendering string-based rischioso
- [x] Rimuovere `onclick` inline.
- [x] Ridurre uso diretto di `innerHTML` dove evitabile.
- [x] Introdurre component rendering sicuro.
- DoD: superficie XSS ridotta e codice UI piu solido.

17. `P2-07` UX operativa di livello enterprise
- [x] Timeline eventi real-time con filtri per account/lista.
- [x] Incident center con drill-down e azioni batch.
- [x] Review queue con priorita e risoluzione guidata.
- [x] KPI board con comparazione giorno/settimana.
- DoD: dashboard adatta a operativita quotidiana intensa.

18. `P2-08` Design system e accessibilita
- [x] Definire design token (colori, spacing, typography, stati).
- [x] Migliorare contrasto e keyboard navigation.
- [x] Aggiungere test a11y smoke.
- DoD: UI consistente, accessibile, professionale.

19. `P2-09` Performance frontend
- [x] Bundle locale asset critici (no dipendenze CDN non necessarie).
- [x] Ottimizzare polling/SSE e rendering tabelle grandi.
- [x] Cache e lazy loading dove utile.
- DoD: UX fluida anche con dataset ampio.

---

## P3 - Data platform, AI quality, scaling

20. `P3-01` Completare migrazione progressiva PostgreSQL
- [ ] Definire data migration ufficiale SQLite -> Postgres.
- [ ] Testare rollback e disaster recovery.
- [ ] Smettere fallback SQLite in produzione.
- DoD: Postgres come backend unico in prod.

21. `P3-02` Strategia backup/restore completa
- [ ] Policy retention per DB e artifact runtime.
- [ ] Restore drill periodico documentato.
- [ ] Alert su backup failure.
- DoD: RPO/RTO definiti e verificati.

22. `P3-03` AI quality pipeline
- [x] Dataset di validazione per invite/message/sentiment.
- [x] Metriche qualità (similarity, acceptance/reply lift, false positive intent).
- [x] A/B analysis con significativita minima.
- DoD: decisioni AI guidate da metriche, non da impressioni.

23. `P3-04` Governance sicurezza e compliance
- [x] Threat model aggiornato per superfici web/API/plugin/cloud.
- [x] Rotazione segreti e controllo scadenze.
- [x] Audit trail piu ricco su azioni critiche.
- DoD: postura sicurezza verificabile e ripetibile.

24. `P3-05` Evoluzione architettura per multi-account vero
- [x] Isolamento forte per account/session/proxy.
- [x] Scheduling fairness e quote per account.
- [x] Alerting per account health separato.
- DoD: scalabilita orizzontale senza cross-impact tra account.

---

## Sequenza esecutiva consigliata (macro)

1. Chiudere tutti i task `P0`.
2. Procedere con `P1` (stabilita e sicurezza runtime).
3. Eseguire `P2` backend refactor + frontend modernization.
4. Completare `P3` (scaling, quality AI, governance).

## Gate di rilascio per ogni fase

- [x] Typecheck, lint, test completi verdi.
- [ ] Nessuna regressione sui comandi core (`run`, `run-loop`, `autopilot`, `dashboard`).
- [x] Aggiornamento documentazione operativa (`SECURITY.md`, integrazioni, runbook).
- [ ] Verifica manuale dashboard e comandi critici.
