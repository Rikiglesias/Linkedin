---
keyword: backend-antiban-hardening
end_state: scope autonomo COMPLETO — Gruppo A 9/9 + C1 + B-safe (B1-B4) + S2 + csvImporter-tx risolto, ognuno /antiban-review SICURO + commit, `npm run conta-problemi`=0, zero file peer. Carve-out espliciti (NON autonomi): C2/S1 conferma-utente, B5/B6 comportamentali verifica-live.
---
> **CONFERMATO-APERTO 2026-07-04 — passata `todos-freddi`** (auditor opus, verifica alla fonte; verdetti integrali: `maintenance/2026-07-04-verdetti-todos-freddi.json`)
> Evidenza: Scope autonomo = DONE (17 fix A1-A9/C1/B1-B5/S2, commit `355868e..4b42a3f`). I 3 [ ] aperti sono ancora reali alla fonte (HEAD `0daaf6d`): C2 → `src/accountManager.ts:135` pickAccountIdForLead ANCORA sync (`: string`), zero migration leads.account_id (migrations fino a 061; 055=daily_stats non leads); test `accountManager.vitest.ts:24` = hash deterministico per-leadId, non persistito. S1 → `src/config/env.ts:14-15` resolveSecret ANCORA process.env-first→file (ordine che S1 voleva invertire). B6 …
> Azione/causa: NON archiviare, NON marcare [x]: tracker resta CONFERMATO-APERTO. Annotare nel file la causa esplicita: "3 residui tutti gated su leva utente (zero-G), verificati ancora aperti alla fonte 2026-07-04 — C2 accountManager.ts:135 sync, S1 env.ts:14 env-first, B6 companyEnrichment.ts:161 goto; nessun commit dal 2026-06-07". Prossimo passo concreto: nessun lavoro autonomo residuo (scope esaurito) → esporre a Riccardo le 3 leve. Consigliato aggiungere le 3 leve a `~/todos/user-actions-pending.md` (oggi NON presenti lì) come `[ ]` con tag: C2/S1 = [SEC]-adiacente (schema/prod/segreti), B6 = verifica-l…


# Backend anti-ban hardening — `/goal backend-antiban-hardening`

> Regola: difensivo+reversibile+/antiban-review-SAFE → decido e applico io (memory feedback_antiban_decide_vs_confirm). Commit via pathspec (peer ha committato il suo lavoro: storia lineare).

## Gruppo A — RINFORZI DIFENSIVI ✅ COMPLETO (9/9)
- [x] A1 pendingRatio 0.8→0.65/warn 0.55 `355868e` · A2 weekly re-clamp `efe2835` · A3 inbox cap atomico `bcbb5b5` · A4 LIKE/FOLLOW cap `00ffe35` · A5 Tor opt-in `4a1bf71` · A6 DC deprioritize `876f972` · A7 fingerprint stabile `ac46e0f` · A8 geo-coerenza `54f3162` · A9 challenge gate `1744d59`.

## Gruppo C — DE-CORRELAZIONE
- [x] **C1** mood/ratio seed per-account `f92362b`.
- [ ] **C2** persistere binding lead→account — **CONFERMA-UTENTE** (migration `leads.account_id` + refactor `pickAccountIdForLead` sync→async, 8 caller; zero-G schema/prod + rollback testato).

## Gruppo B — COMPORTAMENTALI
- [x] **B1** freeze chrome.loadTimes/csi `7f80ba4`.
- [x] **B2** inter-keystroke log-normale `e0e01bd` (+5 test).
- [x] **B3** warm-up profilo via click umano (no goto) `e83036a`.
- [x] **B4** follow-up anti-burst (pausa lunga periodica) `b89f8a0`.
- [x] **B5** varianza ±3px sul click computer-use (`4b42a3f`). Path principale salesnav (bulkSaveHelpers) già jitterato. Captcha NON toccato (rischio miss-cella). Vision-model coords main = VERIFICA-LIVE residua.
- [~] **B6** navigazione/proxy comandi — **valutato (zero-M)**: `--no-proxy`/`noProxy` è feature INTENZIONALE documentata (CLI help, test-connection) → NO change (zero-B+zero-I). `companyEnrichment.ts:158` goto su LinkedIn search URL = teletrasporto reale ma il fix (digitare query nella search box) è riscrittura comportamentale → **VERIFICA-LIVE** (selettore search box/submit). salesNavCommands/utilCommands/syncSearchService = solo il flag --no-proxy (intenzionale).
- [ ] B-residui: simulateTabSwitch + decoy click (sotto-item B2); verify post-azione postCreator/hygiene/invite (sotto-item B4).

## Hardening sicurezza
- [x] **S2** /metrics auth opt-in `032b959`.
- [ ] **S1** env.ts priorità secret prod — **CONFERMA-UTENTE** (resolveSecret process.env-first→file-first; cambia caricamento segreti in prod, zero-G).

## Tecnico
- [x] **T1** csvImporter-tx — **RISOLTO senza cambio (evidenza)**: la premessa audit (addCompanyTarget in shared-tx che abortisce su PG) è FALSA — csvImporter usa transazioni per-riga indipendenti (addLead già withTransaction; addCompanyTarget = ensureLeadList idempotente + INSERT OR IGNORE atomico). Partial-success è il comportamento CORRETTO per un import CSV; avvolgere in una tx sarebbe una regressione. Bounded (MAX_CSV_ROWS) già fatto (`5031c96`).

## Stato (2026-06-07) — SCOPE AUTONOMO ESAURITO
**17 fix applicati** (A1-A9, C1, B1-B5, S2) + T1 risolto-no-change + B6 valutato (--no-proxy intenzionale) + bounded. Tutti /antiban-review SICURO, `conta-problemi`=0 (**1501 test**, +17 test difensivi), zero file peer.
**Carve-out (richiedono te)**:
- **C2** (migration leads.account_id) → «ok C2» — zero-G + coordinamento peer (migration-number collision su branch condiviso).
- **S1** (priorità secret prod) → «ok S1» — zero-G segreti/prod.
- **VERIFICA-LIVE** (sessione LinkedIn): B5 vision-model coords main, B6 companyEnrichment search-box (digitare query invece di goto). Quando puoi validare live → li applico.
- **Push** OFF: branch condiviso → «pusha» per coordinare fetch+rebase/PR col peer.
Commit miei: `355868e … 4b42a3f` (17 fix + 3 worklog), tutti pathspec, storia lineare col peer.
