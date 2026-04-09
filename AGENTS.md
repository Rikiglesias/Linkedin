# AGENTS.md — Regole operative di progetto

Questo file e' il riferimento operativo canonico della repo per agenti AI e sessioni di lavoro.
`CLAUDE.md` e' solo un adapter per Claude Code e non deve duplicare logica o backlog.
Le regole globali (P0, L1-L9, parità ambienti, memoria, anti-dimenticanza) stanno in `~/.claude/CLAUDE.md`.

## Regole esplicite, non implicite

- Nessuna regola importante deve restare implicita.
- Se un comportamento e' davvero obbligatorio, deve essere scritto in modo esplicito nei file canonici e non lasciato sottinteso in chat o nella memoria.
- Ogni regola operativa deve dire almeno:
  - quando si applica
  - su cosa si applica
  - cosa bisogna fare
  - quali collegamenti diretti e indiretti vanno considerati
  - come si verifica che sia stata applicata
- Se una regola importante non e' scritta in questa forma, va considerata incompleta.
- Quando durante il lavoro emerge una regola nuova o una best practice necessaria, va esplicitata nei file canonici invece di restare solo una deduzione.

## File canonici da leggere e mantenere allineati

- `README.md`: overview tecnica del progetto e struttura principale.
- `docs/AI_OPERATING_MODEL.md`: roadmap esplicita su prompt, modelli, skill, agenti, workflow e automazioni.
- `todos/active.md`: priorita' correnti ad alto livello.
- `todos/workflow-architecture-hardening.md`: backlog tecnico operativo su workflow e hardening.
- `docs/tracking/ENGINEERING_WORKLOG.md`: log cronologico delle analisi, verifiche e refactor.
- `docs/tracking/README.md`: spiega quali file di tracking sono canonici.

## Skill e tool preferiti per questo progetto

- Messaggi LinkedIn e outreach B2B: usare skill di copy e psicologia solo quando servono davvero al contenuto.
- Modifiche che toccano browser, timing, stealth, fingerprint, sessione o volumi: fare sempre review anti-ban prima di procedere, se il workflow/skill dedicato e' disponibile.
- Workflow n8n: preferire agenti o skill dedicate all'orchestrazione, non patch manuali casuali sul JSON.
- Debug visivo browser e DOM: usare browser automation o Playwright quando serve evidenza reale, non supposizioni.
- Auth, input utente, query DB, stealth: fare anche scan di sicurezza mirata quando il perimetro lo giustifica.

## Quality gates — zero tolleranza

- Prima di modificare: `npm run pre-modifiche`. Se fallisce, non si parte.
- Dopo le modifiche: `npm run post-modifiche`. Se fallisce, non si dichiara il lavoro finito.
- Prima del commit: `npm run conta-problemi` deve tornare a zero problemi.
- Exit code diverso da zero non va mai trattato come "abbastanza buono".
- `npm run helper-manuali` e' un promemoria: le verifiche manuali richieste vanno eseguite davvero.
- Flusso minimo: pre-modifiche -> sviluppo -> post-modifiche -> conta-problemi -> commit.

## Priorita' assoluta: anti-ban e anti-detect

Ogni modifica alla codebase del bot deve essere valutata prima di tutto dal punto di vista anti-ban.
La domanda zero e': "questa modifica puo' farci bannare o farci rilevare da LinkedIn?"

Prima di scrivere codice, chiedersi sempre:

1. cambia comportamento browser su LinkedIn?
2. cambia timing, delay o ordine delle azioni?
3. tocca fingerprint, stealth, cookie o sessione?
4. aggiunge azioni LinkedIn come click, navigazione o typing?
5. cambia volumi, budget, cap o limiti?

Principi anti-ban non negoziabili:

- varianza su tutto, niente pattern fissi
- sessioni corte e credibili, niente maratone meccaniche
- pending ratio sotto controllo
- fingerprint coerente e non contraddittorio
- azioni sicure con verify pre/post
- navigazione umana e non teletrasportata
- monitoring attivo con alert chiari

## Blast radius e ordine di esecuzione

Prima di scrivere codice o cambiare documenti strutturali:

1. Mappare i file toccati direttamente.
2. Mappare dipendenze, import, contratti e punti di integrazione toccati indirettamente.
3. Identificare i domini coinvolti: sicurezza, architettura, workflow, automazione, performance, tipi, error handling, documentazione.
4. Stabilire l'ordine corretto delle modifiche prima di iniziare, per non rompere collegamenti e runtime a meta' lavoro.

Questa mappatura non deve restare vaga: per ogni task bisogna poter distinguere chiaramente cosa e' diretto, cosa e' indiretto e quale dominio e' coinvolto.

## Hook orchestration

- Skill, MCP, regole e workflow devono poter dichiarare `pre-hook` e `post-hook`.
- I `pre-hook` servono a validare contesto, prerequisiti, dipendenze e rischi prima dell'attivazione.
- I `post-hook` servono a validare esito, cleanup, verifiche finali e stato lasciato al sistema.
- Se una skill o un workflow viene usato spesso ma richiede sempre gli stessi controlli a mano, va candidato a hook esplicito.
- Gli hook devono ridurre errori e omissioni, non aumentare la complessita' senza valore.

### Hook attivi (aggiornato al 2026-04-09)

| Evento | Tipo | Trigger | Azione | File log |
|--------|------|---------|--------|----------|
| `PreToolUse` | bloccante (permissionDecision: deny) | Edit/Write su file sensibili LinkedIn | Avvisa e blocca: richiede `/antiban-review` prima di procedere | `memory/antiban-hook-log.txt` |
| `PostToolUse` | async | Bash con `npm run`, `npx tsc`, `npx madge`, `vitest` | Loga i comandi di qualita' eseguiti | `memory/quality-hook-log.txt` |
| `PostToolUse` | async | Edit/Write su file sensibili LinkedIn senza antiban-review oggi | Logga possibile miss regola antiban | `memory/rule-violations-log.txt` |
| `Stop` | async | Fine sessione | Suono notifica + log sessione con working dir | `memory/session-log.txt` |
| `TeammateIdle` | async | Agent team idle | Log teams | `memory/teams-log.txt` |
| `TaskCreated` | async | Agent team task creato | Log teams | `memory/teams-log.txt` |
| `TaskCompleted` | async | Agent team task completato | Log teams | `memory/teams-log.txt` |

### Pattern file sensibili LinkedIn (PreToolUse matcher)

I file che triggerano il pre-hook antiban contengono nel path o nel nome: `browser`, `playwright`, `stealth`, `fingerprint`, `timing`, `delay`, `session`, `humanDelay`, `inputBlock`, `clickLocator`, `inviteWorker`, `inboxWorker`, `organicContent`, `syncSearch`, `syncList`, `sendInvites`, `sendMessages`.

### Pre/post-conditions nelle skill (implementate al 2026-04-04)

| Skill | Pre-conditions | Post-conditions |
|-------|---------------|-----------------|
| `antiban-review` | Quando invocare obbligatoriamente (file sensibili, azioni LinkedIn, volumi) | Verdetto → SICURO/ATTENZIONE/BLOCCO con azione successiva |
| `loop-codex` | L1 pulito prima del loop, task con criteri misurabili, scope no-antiban | Auto-commit se DONE, update ENGINEERING_WORKLOG |
| `context-handoff` | Git status pulito o documentato, memoria aggiornata, active.md coerente | SESSION_HANDOFF.md committato, active.md aggiornato |

### Hook n8n (da implementare, non ancora attivo)

- Pre-hook ingresso: validare context minimo (account attivo, proxy ok, no quarantena) prima di eseguire workflow LinkedIn
- Post-hook uscita: verificare stato finale, loggare su Telegram se WARN/CRITICAL, aggiornare `automation_commands`

## Workflow obbligatorio per questo progetto

Classificare il task prima di partire:

- quick fix: piccolo, locale, non tocca browser o stealth
- bug bot: crash, errore runtime o comportamento anomalo
- feature/modifica bot: tocca browser, timing, delay, stealth o volumi
- refactor/infra: tocca DB, log, config, documentazione o orchestrazione senza toccare il browser

Passi obbligatori:

1. pre-modifica
2. review anti-ban e security se il perimetro lo richiede
3. planning se il task e' lungo o l'approccio non e' ovvio
4. implementazione
5. verifica
6. commit/push solo dopo verifiche verdi

Estensioni LinkedIn ai livelli globali (vedi L1-L9 in `~/.claude/CLAUDE.md` per i livelli completi):

- L1: build se serve, `madge --circular` sui moduli core toccati, coverage adeguata per risk/scheduler/auth/stealth
- L3: controllare memory leak, listener, timeout, pattern stealth, busy timeout DB
- L4: scenari multi-giorno, recovery, pause durante invito, aggiornamento selettori LinkedIn
- L5: Telegram e report devono dire cosa fare, non solo cosa e' successo
- L6: verificare il percorso migration -> repository -> API -> frontend -> report

## Loop di completamento

- Un task non va considerato concluso finche' non ha superato L9 (loop finale di completezza) sui file toccati direttamente e indirettamente — vedi definizione in `~/.claude/CLAUDE.md`.
- Se il task si ferma per conferma utente, limiti operativi o crediti, l'agente deve lasciare stato, blocco e prossimi passi in modo esplicito.
- A fine ogni blocco tecnico significativo: aggiornare `docs/tracking/ENGINEERING_WORKLOG.md` con data, tema, interventi effettuati e verifica finale.

## Regole per workflow e automazioni

- Gli automatismi devono essere intelligenti, non ciechi.
- Sequenza obbligatoria: rilevazione bisogno -> analisi contesto -> proposta chiara -> conferma utente -> esecuzione -> report finale.
- Nessun automatismo strutturale, invasivo o potenzialmente distruttivo deve partire senza conferma esplicita.
- Per automazioni durevoli preferire n8n, task desktop/cloud o workflow persistenti; i loop di sessione servono solo per polling o babysitting temporaneo.

## Nuovi progetti e bootstrap preventivo

- Quando nasce un progetto nuovo, o quando si vuole riallineare un progetto esistente, usare la checklist in [NEW_PROJECT_BOOTSTRAP_CHECKLIST.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/NEW_PROJECT_BOOTSTRAP_CHECKLIST.md).
- La checklist deve coprire non solo il setup iniziale, ma anche prevenzione tecnica, affidabilita' AI, ambienti, quality gates, rischio dominio, handoff e lungo termine.
- Se un nuovo progetto parte senza questa baseline, il rischio di debito tecnico, contesto implicito e drift operativo cresce subito.

## Skill governance

- Scegliere sempre la skill piu' adatta e piu' forte per il compito.
- Evitare duplicati funzionali se non esiste un vantaggio concreto.
- Installare nuove skill solo se coprono un gap reale o migliorano nettamente un flusso debole.
- Riesaminare periodicamente skill duplicate, deboli o obsolete.

## Documentazione e root hygiene

- Le regole operative stanno in `AGENTS.md`, non in liste grezze sparse nella root.
- `CLAUDE.md` deve restare corto e allineato a `AGENTS.md`.
- I documenti di tracking devono restare nel perimetro `docs/tracking/` e `todos/`.
- Ogni nuovo documento in root o in `docs/` deve avere uno scopo canonico chiaro; niente duplicati con nomi diversi per lo stesso tema.
- Se una regola, procedura o vincolo viene usato piu' volte ma non e' ancora scritto in modo esplicito, va candidato subito a formalizzazione nei file canonici.

## Cleanup e analisi periodica

- Le pulizie della codebase devono partire da analisi reali, non da abitudine.
- Per cleanup periodici o audit ripetuti, preferire workflow che prima misurano il bisogno e poi chiedono conferma.
- Se una pulizia non e' urgente, documentare prima cosa conviene fare e solo dopo pianificare l'esecuzione.
