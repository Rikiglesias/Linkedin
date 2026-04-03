# Runtime Core + Repository Refactor v1

## Contesto

La codebase del bot LinkedIn ha gia' una struttura parzialmente modularizzata, ma presenta ancora tre problemi sistemici:

1. dipendenze circolari reali tra moduli core
2. confini di layer inconsistenti tra `core`, `browser`, `workers`, `automation` e repository
3. monoliti che rallentano il refactor sicuro e amplificano il rischio di regressioni

L'audit architetturale del 2026-04-01 ha evidenziato in particolare:

- 10 circular dependency reali rilevate con `madge --circular --extensions ts --ts-config tsconfig.json src`
- uso eccessivo del barrel pubblico [repositories.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories.ts)
- falsa separazione nel repository layer: `leadReadOps.ts` e `leadWriteOps.ts` sono oggi facciate sopra [leadsCore.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories/leadsCore.ts)
- coupling non corretto:
  - `core -> workers`
  - `browser -> repositories`
  - `automation/types -> scheduler`
- monoliti critici:
  - [bulkSaveOrchestrator.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/salesnav/bulkSaveOrchestrator.ts)
  - [jobRunner.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/jobRunner.ts)
  - [humanBehavior.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/browser/humanBehavior.ts)
  - [api/server.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/api/server.ts)
  - [db.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/db.ts)
  - [index.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/index.ts)

Questo refactor non e' una riscrittura. E' un refactor incrementale dependency-first che serve a rendere il runtime del bot piu' affidabile, leggibile e governabile nel lungo periodo.

## Obiettivi

- portare le circular dependency a zero
- ridurre il coupling creato dal barrel `core/repositories.ts`
- rendere reale la separazione del repository layer
- ridurre i monoliti piu' pericolosi senza cambiare il comportamento utente
- mantenere invariata la logica anti-ban, il motore workflow e i contratti pubblici gia' stabilizzati

## Non obiettivi

- non rifare il frontend in questa fase
- non decidere ancora il destino finale di `dashboard/`
- non cambiare la strategia di outreach, scoring, anti-ban o scheduling
- non fare una big-bang rewrite
- non cambiare API pubbliche se non dietro facciate compatibili

## Vincoli

- nessun cambiamento funzionale intenzionale nei 4 workflow pubblici
- nessuna regressione anti-ban
- refactor per branch-by-abstraction: prima facciate e confini, poi spostamento interno
- ogni fase deve essere reversibile
- le verifiche L1-L6 sono obbligatorie per ogni blocco

## Stato attuale rilevante

### Aree relativamente sane

- [workflows](C:/Users/albie/Desktop/Programmi/Linkedin/src/workflows)
- [api/routes](C:/Users/albie/Desktop/Programmi/Linkedin/src/api/routes)
- split iniziale di [salesnav](C:/Users/albie/Desktop/Programmi/Linkedin/src/salesnav)

### Aree critiche

- [core/repositories.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories.ts)
- [leadsCore.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories/leadsCore.ts)
- [scheduler.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/scheduler.ts)
- [leadStateService.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/leadStateService.ts)
- [jobRunner.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/jobRunner.ts)
- [api/server.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/api/server.ts)
- [db.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/db.ts)
- [humanBehavior.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/browser/humanBehavior.ts)

## Approccio scelto

Approccio dependency-first, incrementale, con rollback semplice.

Ordine:

1. rompere i cicli
2. stringere i confini tra layer
3. trasformare le facciate finte in moduli reali
4. spezzare i monoliti dopo che i confini sono stabili

Questo ordine minimizza il rischio perche':

- evita refactor larghi su file ancora accoppiati
- riduce il blast radius prima di toccare il runtime piu' delicato
- permette di usare i contratti esistenti come facciata compatibile

## Design architetturale

### Principio 1: tipi neutrali fuori dai moduli con logica

I tipi usati da automation, workflow e scheduler non devono vivere in moduli che portano con se' logica runtime o import pesanti.

Conseguenza:

- estrarre i tipi di workflow selection/shared automation in moduli neutrali sotto `src/types/` o `src/automation/`
- [automation/types.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/automation/types.ts) non deve dipendere da [scheduler.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/scheduler.ts)

### Principio 2: repository import stretti, barrel solo compatibile

Il barrel [repositories.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories.ts) resta come facciata legacy temporanea, ma il nuovo codice e il codice rifattorizzato devono importare da moduli specifici.

Conseguenza:

- i moduli core ad alto rischio smettono di importare dal barrel generale
- il browser layer non deve leggere direttamente il repository layer tramite barrel
- i worker devono importare solo le capability minime necessarie

### Principio 3: separazione fisica reale del repository layer

`leadReadOps.ts` e `leadWriteOps.ts` devono diventare file veri, non re-export.

Conseguenza:

- [leadsCore.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories/leadsCore.ts) viene svuotato per cluster funzionali
- [leads.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories/leads.ts) resta la facciata pubblica compatibile durante la migrazione

### Principio 4: il core dominio non dipende dai worker

Il core deve orchestrare, non conoscere dettagli implementativi di singoli worker quando non e' strettamente necessario.

Conseguenza:

- [scheduler.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/scheduler.ts) non deve importare [postCreatorWorker.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/workers/postCreatorWorker.ts) per contare dati di dominio
- [orchestrator.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/orchestrator.ts) e [jobRunner.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/jobRunner.ts) mantengono solo dipendenze operative giustificate

### Principio 5: composition root sottili

- [api/server.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/api/server.ts) deve comporre middleware e router, non implementare tutto
- [index.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/index.ts) deve fare bootstrap e command dispatch, non contenere logica estesa di lifecycle
- [db.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/db.ts) deve essere separato in manager, migrations e operazioni di backup/health

## Fasi

### Fase 1 — Dependency untangling

#### Obiettivo

Portare a zero i cicli reali e ridurre l'uso del barrel `repositories.ts` nei moduli piu' critici.

#### File target iniziali

- [automation/types.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/automation/types.ts)
- [scheduler.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/scheduler.ts)
- [leadStateService.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/leadStateService.ts)
- [repositories.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories.ts)
- [uiFallback.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/browser/uiFallback.ts)
- [integrationPolicy.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/integrationPolicy.ts)

#### Interventi

- spostare i tipi condivisi in moduli neutrali
- sostituire import dal barrel con import stretti per dominio
- rimuovere dipendenze `browser -> repositories barrel`
- ridurre i punti `core -> workers` non necessari

#### Rollback

- ogni spostamento di tipo o import deve mantenere facciate compatibili
- in caso di errore si puo' ripristinare il modulo neutro o il re-export senza toccare comportamento runtime

### Fase 2 — Repository split reale

#### Obiettivo

Trasformare il repository layer da pseudo-modulare a modulare davvero.

#### File target

- [leadsCore.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories/leadsCore.ts)
- [leadReadOps.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories/leadReadOps.ts)
- [leadWriteOps.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories/leadWriteOps.ts)
- eventuali nuovi moduli:
  - `leadLists.ts`
  - `leadSalesNav.ts`
  - `leadEnrichmentOps.ts`
  - `leadTimelineOps.ts`
  - `leadReviewQueueOps.ts`
  - `leadSearchOps.ts`

#### Interventi

- muovere gruppi omogenei di query/mutation in file reali
- lasciare [leads.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories/leads.ts) come facciata compatibile
- ridurre il peso del barrel generale

#### Rollback

- ogni cluster si sposta con re-export compatibile
- se una fase rompe i caller, si puo' re-esportare dal vecchio punto mentre si sistema il passaggio

### Fase 3 — Composition root runtime

#### Obiettivo

Spezzare i monoliti che governano bootstrap, runtime e API server.

#### File target

- [jobRunner.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/jobRunner.ts)
- [api/server.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/api/server.ts)
- [db.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/db.ts)
- [index.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/index.ts)

#### Interventi

- `jobRunner`: session bootstrap, single-job execution, incident handling, account loop
- `api/server`: auth/session, middleware bootstrap, realtime/SSE, route mounting
- `db`: db managers, migrations, backup/restore, disk/health checks
- `index`: bootstrap/lifecycle, command dispatch, planned restart

### Fase 4 — Monoliti operativi

#### Obiettivo

Ridurre il peso dei moduli piu' grandi e delicati senza cambiare il comportamento.

#### File target

- [bulkSaveOrchestrator.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/salesnav/bulkSaveOrchestrator.ts)
- [humanBehavior.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/browser/humanBehavior.ts)

#### Interventi

- `bulkSaveOrchestrator`: split per login/session recovery, search discovery, page processing, persistence/report
- `humanBehavior`: split per overlay/input block, mouse, typing, reading/dwell, decoy actions

## Blast radius

### Molto alto

- [repositories.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories.ts)
- [scheduler.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/scheduler.ts)
- [jobRunner.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/jobRunner.ts)
- [db.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/db.ts)

### Alto

- [api/server.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/api/server.ts)
- [humanBehavior.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/browser/humanBehavior.ts)
- [bulkSaveOrchestrator.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/salesnav/bulkSaveOrchestrator.ts)
- [leadsCore.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories/leadsCore.ts)

### Medio

- [automation/types.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/automation/types.ts)
- [uiFallback.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/browser/uiFallback.ts)
- [leadStateService.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/leadStateService.ts)

## Safety net

Prima di implementare ogni fase:

- typecheck verde
- suite focalizzate workflow/API/automation verdi
- `madge --circular --extensions ts --ts-config tsconfig.json src`

Durante il refactor:

- facciate compatibili
- piccoli commit atomici
- no cambi di comportamento intenzionali
- diff stretti per cluster

## Verifiche L1-L6

### L1 — Compilazione e test

- `npx tsc -p tsconfig.json --noEmit`
- suite vitest focalizzate su workflow, api e automation
- `npm run lint`
- `npx madge --circular --extensions ts --ts-config tsconfig.json src` deve arrivare a zero

### L2 — Catene dirette

- aggiornare tutti i caller quando si spostano tipi o funzioni
- nessun import rotto
- nessun re-export mancante

### L3 — Runtime profondo

- niente side effect introdotti da init order
- niente perdita di session/bootstrap behavior
- niente regressioni nei path anti-ban e nei fallback di selettori

### L4 — Ragionamento preventivo

- se un modulo neutro viene riaccoppiato a runtime, il ciclo torna
- se il browser continua a leggere dal repository barrel, il boundary resta sporco
- se `core` continua a chiedere dati ai worker, il design non regge

### L5 — Visione prodotto

- refactor trasparente al bot e al futuro frontend
- i workflow devono continuare a restare il contratto pubblico stabile

### L6 — Coerenza sistema e osservabilita'

- il control plane automation deve restare coerente
- incident/reporting non devono perdere eventi
- il nuovo assetto deve essere documentato per sessioni future

## Rischi noti

- falsi positivi: alcuni cicli potrebbero includere type-only import; vanno trattati comunque come odore architetturale
- barrel shrink: puo' rompere moduli legacy se si rimuovono export troppo presto
- split del repository layer: rischio alto di import mismatch se fatto troppo largo in un solo passaggio
- split `jobRunner` e `api/server`: rischio di side effect persi durante il bootstrap

## Decisioni esplicite

- il frontend legacy `dashboard/` resta fuori da v1
- la pulizia del root workspace resta fuori da v1
- i test omnibus non si rifattorizzano in questa fase salvo minima manutenzione necessaria

## Primo blocco implementativo approvato

Il primo blocco da eseguire dopo questa spec e':

1. dependency untangling tra `automation/types`, `scheduler`, `leadStateService`, `repositories`
2. riduzione degli import dal barrel generale nei nodi critici
3. verifica con `madge`, `tsc`, `vitest`, `lint`

Questo e' il blocco con il miglior rapporto impatto/rischio per sbloccare il resto del refactor.
