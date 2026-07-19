# residui-audit — findings APERTI dei 3 audit del bot (non ancora risolti) — /goal binding

> **CONFERMATO-APERTO 2026-07-04 — passata `todos-freddi`** (auditor opus, verifica alla fonte; verdetti integrali: `maintenance/2026-07-04-verdetti-todos-freddi.json`)
> Evidenza: R1/R2 gia' [x] (R1=commit df91413; R2 escluso-con-motivo). R3: src/browser/missclick.ts creato MA humanBehavior.ts:16 importa solo shouldAccidentalNav/performAccidentalNavigation -> performMissclick MAI cablato; computeSafeMissclickPoint (missclick.ts:125) offset 8-25px da centro con solo isNearDangerousElement, NON garantisce offset fuori bbox target (fix geometria R3 assente). R5: typoGenerator.ts:191 ancora `return 0.7` (voluto 0.8). R6: nessun hook blocca push su glob anti-ban (enforcement s…
> Azione/causa: NON archiviare; mantenere aperto. (1) In cima a residui-audit.md aggiungere nota datata 2026-07-04 con stato verificato per-residuo: R3 modulo missclick.ts esiste ma performMissclick non cablato + computeSafeMissclickPoint senza guardia bbox -> RISCHIOSO, aperto; R5 cap ancora 0.7 (typoGenerator.ts:191), aperto; R6 nessun push-block su glob anti-ban, superato-da-policy/pre-edit-gate; R4 timing gia' jitterato (readingSimulation.ts:58 500-1300ms) -> candidato ESCLUSIONE ok; R7/R8 = leva utente. (2) Registrare R7 (demo invite reale headed in orario 9-18 con lead qualificati) e R8 (unquarantine ac…


> Creato 2026-06-08. La classe "valori ciechi" (bot-intelligente) è CHIUSA (A/B/C/D).
> Questo binding raccoglie i residui APERTI degli altri due audit: comportamentale (wf_307f39ee)
> e sicurezza/flusso/proxy (wf_2ad7b6c2, 6 agent). Fonte: ~/todos/workflow-runthrough-2026-06-08.md.
> Quasi tutti GATED anti-ban → /antiban-review SAFE + flag PRIMA di ogni Edit (regola fasi: il /goal
> dev'essere lanciato dall'utente PRIMA delle modifiche al codice vivo anti-ban).

## END-STATE (misurabile)
Tutti i residui sotto: o RISOLTI (gate verde `conta-problemi` exit 0 + antiban-review SAFE) o
ESCLUSI con motivo verificato alla fonte (zero-M). Anti-ban-first.

## Residui ordinati (priorità anti-ban-first)

- [x] **R1 🔴 launchBrowser FAIL-OPEN → FAIL-CLOSED** (commit df91413). NUOVO browser/proxyLaunchPlan.ts buildProxyLaunchPlan() pura+testabile: managed-proxy + nessun proxy disponibile → throw AB-24, mai IP diretto. Casi diretti legittimi (explicit/!managed) intatti. +7 test. Gate verde 1573 test. antiban SAFE.

- [x] **R2 🔴 dry-run preflight — ESCLUSO con motivo (coperto da R1, verificato zero-M)**. Il rischio reale (dry-run→launchBrowser→IP diretto) è chiuso da R1: con managed-proxy il launchPlan non contiene MAI undefined (chain vuota→throw AB-24; proxy morti→prova/throw lastError). Il preflight saltato in dry-run resta solo early-warning anticipato (costo rete in preview sproporzionato; R1 dà già errore chiaro al launch). Non si aggiunge codice (zero-I).

> ⚠️ NOTA (zero-M): i path/righe di R3-R5 nel binding venivano dall'audit e sono RISULTATI IMPRECISI alla
> verifica (3° caso, come R7-lingua). Path CORRETTI sotto. Ri-localizzare SEMPRE alla fonte prima di editare.

- [ ] **R3 🟡 MISSCLICK non cablato** (`src/browser/humanClick.ts` — verificare nome reale di shouldMissclick/performMissclick/computeSafeMissclickPoint con grep). PRIMA fixare computeSafeMissclickPoint: l'offset può cadere DENTRO il target = click sbagliato reale. RISCHIOSO (geometria) → attenzione dedicata, non a contesto carico.
  - DONE: offset garantito FUORI dal bounding box (test geometria) → poi cablare rate ~0.02. VERIFY: test + conta-problemi + antiban-review SAFE.

- [ ] **R4 🟡 SCROLL pause inter-step** (`src/browser/humanBehavior.ts`). I range del binding (300-800/500-2000/15%) NON combaciano col codice reale → localizzare la funzione di reading-scroll vera (candidate: waitForTimeout a :855/:928/:933/:943, ma sono già 200-1300ms, forse già OK). VERIFICARE se serve davvero ridurre o se è già "ventenne svelto".
  - DONE: se i range sono effettivamente lunghi → ridurli con varianza; altrimenti ESCLUDERE (già ok). VERIFY: conta-problemi + antiban-review SAFE.

- [ ] **R5 🟡 TYPING flow-state cap** (path REALE: `src/ai/typoGenerator.ts`, NON src/browser/). Cercare il cap flow-state 0.7→0.8 con grep. Edit banale 1-char una volta localizzato.
  - DONE: cap 0.8. VERIFY: conta-problemi + antiban-review SAFE.

- [ ] **R6 🟡 hook auto-push NON enforce anti-ban** (infra hook globale `~/.claude`). `git-commit-push.md` dice che src/browser|risk|salesnav|captcha|workers + proxy + migration ROMPONO l'auto-push → ma l'hook ha pushato 94fcd96 (anti-ban) lo stesso.
  - DONE: hook auto-push rompe (no push) se il commit tocca un glob anti-ban → richiede push manuale/review. VERIFY: commit di prova su file gated → hook NON pusha.

- [ ] **R7 ⚪ pipeline NEW→READY_INVITE + demo invite E2E** (serve LEVA UTENTE: orario 9-18 + lead qualificati). 250 lead tutti NEW, 0 READY_INVITE → budget invite 0 (corretto, non bug).
  - DONE: capita la pipeline di qualificazione (enrichment+scoring/site-check) READ-ONLY; poi un invite reale headed in orario salva la riga in SQLite (leads stato + daily_stats).
  - VERIFY: query SQLite mostra lead READY_INVITE + riga invito salvata. (Richiede utente: orario + osservazione.)

- [ ] **R8 ⚪ quarantena account** (leva utente). sync_state.account_quarantine=true dal 30/03 (SELECTOR_CANARY_FAILED, NON ban). Outreach bloccato.
  - DONE: ri-eseguito selector canary su DOM attuale → se OK `unquarantine`; se selettori stale → fixarli PRIMA. NON unquarantine alla cieca.
  - VERIFY: canary verde + outreach non più bloccato dal preflight.

## Note
- R1+R2 sono la priorità (anti-ban critico, fail-open reale). R3-R6 igiene anti-ban + infra. R7-R8 richiedono leva utente.
- Fix gated: /antiban-review SAFE → flag in ~/.claude/state/antiban-approved.txt PRIMA di ogni Edit.
- R7/R8 NON sono "bug": sono comportamenti corretti (budget 0 fuori orario, quarantena protettiva) che richiedono azione utente per la demo reale.
