# Tracking Tecnico

Questa cartella esiste per evitare che audit, tentativi, verifiche e decisioni tecniche restino solo:

- nella chat
- nella memoria esterna
- in file enormi non operativi

## File canonici

- [ENGINEERING_WORKLOG.md](docs/tracking/ENGINEERING_WORKLOG.md)
  Log cronologico delle analisi, dei refactor tentati, delle verifiche eseguite e dei risultati.
- [workflow-architecture-hardening.md](todos/workflow-architecture-hardening.md)
  Backlog tecnico operativo per workflow, AI decisionale, anti-ban, architettura e hardening.
- [active.md](todos/active.md)
  Priorita' correnti ad alto livello.
- [2026-04-01-runtime-core-repository-refactor-design.md](docs/archive/2026-04-01-runtime-core-repository-refactor-design.md)
  Design del refactor architetturale runtime core + repository (archiviato).

## File di supporto al tracking

- [codebase-debt.md](docs/tracking/codebase-debt.md)
  Snapshot del debito tecnico strutturale. Non e' un backlog vivo autonomo: serve a supportare i file canonici sopra.
- [AI_CAPABILITY_ROUTING.json](docs/tracking/AI_CAPABILITY_ROUTING.json)
  Registro machine-readable del routing capability/domini del control plane AI.
- [AI_LEVEL_ENFORCEMENT.json](docs/tracking/AI_LEVEL_ENFORCEMENT.json)
  Registro machine-readable del protocollo `L2-L6` audit-assisted.

## Regole di aggiornamento

Aggiornare questi file quando cambia almeno uno di questi punti:

- viene trovato un finding nuovo non banale
- viene concluso un blocco di refactor o hardening
- una verifica importante passa o fallisce
- cambia la priorita' tecnica del progetto
- si decide esplicitamente di non fare una strada e si sceglie un'alternativa

## Cosa non mettere qui

- dump completi della chat
- checklist generiche senza riferimenti concreti
- dettagli che sono gia' derivabili dal codice o dal `git log`
