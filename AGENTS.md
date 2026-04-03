# AGENTS.md — Regole operative di progetto

Questo file e' il riferimento operativo canonico della repo per agenti AI e sessioni di lavoro.
`CLAUDE.md` e' solo un adapter per Claude Code e non deve duplicare logica o backlog.

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

## Parita' operativa tra ambienti

- Qualsiasi ambiente usato sul progetto deve essere configurato correttamente e portato a una baseline coerente: `Codex`, `Claude Code`, `Cursor`, `Windsurf`, `Trae`, terminali locali e altri IDE/CLI simili.
- L'obiettivo non e' solo l'accesso al repo, ma il comportamento corretto: lettura delle regole, uso dei file canonici, enforcement dei passaggi importanti e disponibilita' dei tool necessari.
- Per ogni ambiente bisogna sapere in modo esplicito:
  - quali file di regole e memoria legge
  - quali skill o comandi equivalenti supporta
  - quali hook o meccanismi di enforcement supporta
  - quali MCP o tool esterni puo' usare davvero
  - quali limiti o differenze ha rispetto agli altri
- Se una capability importante esiste in un ambiente ma manca in un altro, bisogna progettare un sostituto ragionevole: wrapper, checklist, workflow, slash command, skill o automazione equivalente.
- Nessun ambiente deve restare in stato ambiguo o semi-configurato. O viene allineato alla baseline, oppure va trattato come ambiente secondario con limiti espliciti.
- Quando si aggiunge o si cambia una capability importante, verificare sempre l'impatto cross-environment: skill, hook, MCP, memorie, permessi e workflow non devono driftare senza controllo.

## File di memoria e contesto leggibili dall'AI

- I file di memoria, contesto, tracking, backlog e handoff devono essere progettati per essere letti bene dall'AI, non solo da un umano che ricorda gia' il contesto.
- Ogni file di contesto deve avere una responsabilita' chiara. Non mescolare in modo opaco preferenze utente, decisioni, stato lavori, regole, backlog e note temporanee.
- Il requisito corretto non e' "file presente", ma "file leggibile completamente e in modo affidabile dall'AI".
- La struttura deve aiutare l'AI prima, durante e dopo la lettura:
  - prima: apertura che spiega scopo, ambito e dove andare se il tema e' altrove
  - durante: sezioni corte, ordine stabile, heading chiari, niente muri di testo o blocchi misti
  - dopo: riepilogo di stato, decisioni, prossimi passi, blocchi e rimandi ai file canonici collegati
- Ogni file di contesto deve dichiarare in modo esplicito:
  - cosa contiene
  - cosa non contiene
  - quando va aggiornato
  - qual e' il file canonico collegato o sostitutivo
- Le informazioni importanti per sessioni future non devono restare solo in chat. Se servono ancora dopo la sessione corrente, vanno promosse nel file canonico corretto.
- Stato, decisioni e handoff vanno scritti in forma leggibile dall'AI: heading chiari, sezioni stabili, bullet ordinate, motivazioni esplicite, niente dump narrativi confusi.
- Per ogni stato di lavoro rilevante, rendere espliciti almeno:
  - stato attuale
  - decisioni prese
  - motivazioni non ovvie
  - prossimi passi
  - blocchi aperti
  - file o sistemi toccati
- Se un file di contesto cresce troppo, diventa ambiguo o mescola troppi temi, va splittato e indicizzato invece di continuare ad accumulare rumore.
- Non usare mega-file come soluzione di default. Se un file supera una dimensione ragionevole o tratta temi multipli, passare a `indice + file tematici`.
- I file di contesto devono essere facili da recuperare anche con lettura mirata o retrieval: titoli descrittivi, sezioni delimitate, formato testuale semplice, metadati utili, niente strutture opache senza bisogno.
- Nessuna informazione critica deve stare nascosta solo a meta' file senza indice, riepilogo o collegamento dai file canonici principali.
- Quando si aggiorna un file di contesto, bisogna verificare anche i collegamenti diretti e indiretti con gli altri file canonici, per evitare duplicazioni, conflitti o divergenze di stato.

## Meccanismi anti-dimenticanza

- Se un comportamento critico deve avvenire sempre, non deve dipendere solo dalla memoria del modello.
- Per ridurre dimenticanze e salti di passaggi, usare una combinazione di:
  - memoria persistente separata per tipo di informazione
  - retrieval o ricerca mirata sui file canonici invece di lettura cieca di mega-file
  - checklist obbligatorie per i workflow ricorrenti o rischiosi
  - output strutturati quando servono campi o verifiche non saltabili
  - `pre-hook` e `post-hook` per enforcement operativo
  - comandi riusabili, skill o workflow dedicati per i task che ritornano
  - eval periodici per verificare che il sistema segua davvero le regole
- Se un passaggio viene dimenticato piu' di una volta, il fix corretto non e' ripeterlo in chat, ma trasformarlo in meccanismo esplicito.
- Separare la memoria anche per natura dell'informazione:
  - procedurale: regole, checklist, workflow
  - semantica: fatti stabili, preferenze, contesto utente o progetto
  - episodica: stato corrente, decisioni recenti, handoff, blocchi
- Non mischiare queste categorie nello stesso file senza motivo forte.
- Per Claude Code, quando utile, preferire memoria modulare con import, custom slash commands, hooks e subagenti rispetto a un singolo file monolitico.
- Per workflow basati su OpenAI o su altri agenti custom, preferire output schema-driven, tool calling con parametri stretti, retrieval strutturato ed eval sui casi critici.

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

## Triage obbligatorio di ogni richiesta

Quando arriva una richiesta, l'agente deve fare queste scelte in autonomia prima di agire:

1. Tradurre internamente una richiesta grezza in un obiettivo tecnico chiaro.
2. Capire se serve solo risposta, analisi, modifica documentale, modifica codice o workflow.
3. Scegliere skill, agenti, workflow n8n, ricerca web e tool di verifica piu' adatti.
4. Se la richiesta coinvolge strumenti AI diversi, indicare brevemente quale ambiente conviene usare:
   - `Codex` per coding profondo, refactor, analisi repo e lavoro tool-driven.
   - `Claude Code` per workflow e comandi specifici Claude, inclusi task schedulati di sessione.
   - `Codex` dentro `Claude Code` solo se l'orchestrazione Claude porta vantaggio reale.

## Regola madre di esecuzione

- L'agente non deve limitarsi a eseguire il testo letterale del prompt: deve capire l'intento reale.
- L'agente deve ragionare come un ingegnere software professionale, non come un esecutore cieco.
- Ogni modifica deve seguire la best practice specifica del tipo di artefatto toccato, non una best practice generica valida solo per il codice.
- Se il task tocca documenti, config, workflow, migrazioni, API contract, cartelle strutturali o altri artefatti non-code, l'agente deve usare le regole corrette di quel dominio e non trattarli come file qualsiasi.
- Se una modifica tocca un file, l'analisi deve includere anche i file impattati indirettamente.
- Nessuna modifica e' completa se risolve solo il sintomo locale e lascia incoerenze nel resto del sistema.
- Ogni modifica deve reggere anche nel lungo periodo: non deve rompere altre aree, non deve lasciare componenti indietro rispetto al nuovo stato e non deve introdurre debito nascosto che emergera' al cambio successivo.
- Se durante il task emerge una regola che era solo implicita, l'agente deve promuoverla a regola esplicita nei documenti canonici quando e' abbastanza importante da guidare lavori futuri.

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

## Controllo multi-dominio per file

Per ogni file modificato, l'agente deve controllare non solo il motivo principale del cambiamento, ma anche gli altri aspetti che quel file puo' impattare, ad esempio:

- sicurezza
- architettura
- performance
- tipi
- error handling
- automazione
- integrazioni
- osservabilita'

Per ogni file toccato, questo controllo deve essere reale e specifico, non una formula generica ripetuta a fine task.

## Ricerca web e attivazione tool

- Se il task riguarda librerie, framework, API o best practice che possono essere cambiate, la ricerca web e' obbligatoria prima di implementare.
- La ricerca web e' obbligatoria anche quando serve capire la best practice aggiornata del tipo di artefatto che si sta toccando: documentazione tecnica, guida utente, config, workflow, plugin, MCP, API contract, migrazione o altra struttura di progetto.
- La best practice va cercata per la cosa specifica che si sta facendo, non in modo generico. Esempio: modificare un documento operativo richiede best practice di documentazione operativa, non solo "scrivere bene".
- La ricerca non deve fermarsi al file singolo: deve includere anche i file direttamente collegati, quelli impattati indirettamente e i vincoli dei livelli di controllo.
- Skill, workflow, agenti e tool non vanno attivati a caso: vanno scelti nel momento giusto e solo quando portano valore reale.
- Se un processo e' ricorrente, sensibile o facile da sbagliare, valutare se esiste o va creato un workflow n8n dedicato.

## Hook orchestration

- Skill, MCP, regole e workflow devono poter dichiarare `pre-hook` e `post-hook`.
- I `pre-hook` servono a validare contesto, prerequisiti, dipendenze e rischi prima dell'attivazione.
- I `post-hook` servono a validare esito, cleanup, verifiche finali e stato lasciato al sistema.
- Se una skill o un workflow viene usato spesso ma richiede sempre gli stessi controlli a mano, va candidato a hook esplicito.
- Gli hook devono ridurre errori e omissioni, non aumentare la complessita' senza valore.

## Protocollo operativo minimo su ogni modifica

1. Classificare i domini coinvolti.
2. Mappare impatti diretti e indiretti.
3. Definire l'ordine di esecuzione.
4. Implementare con best practice da senior engineer, ma specifiche del tipo di artefatto toccato.
5. Fare controllo tecnico immediato su sintassi, import, tipi e contratti.
6. Fare verifica trasversale tra domini.
7. Rieseguire un controllo finale di completezza.

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

Estensioni LinkedIn ai livelli globali:

- L1: build se serve, `madge --circular` sui moduli core toccati, coverage adeguata per risk/scheduler/auth/stealth
- L3: controllare memory leak, listener, timeout, pattern stealth, busy timeout DB
- L4: scenari multi-giorno, recovery, pause durante invito, aggiornamento selettori LinkedIn
- L5: Telegram e report devono dire cosa fare, non solo cosa e' successo
- L6: verificare il percorso migration -> repository -> API -> frontend -> report

## Loop di completamento

- Un task non va considerato concluso finche' non e' verificato al 100% sui file toccati direttamente e indirettamente.
- Se l'ambiente non offre una funzione nativa di loop, l'agente deve simulare quel comportamento con passaggi iterativi, checklist, workflow o skill dedicate.
- Se il task si ferma per conferma utente, limiti operativi o crediti, l'agente deve lasciare stato, blocco e prossimi passi in modo esplicito.

## Regole per workflow e automazioni

- Gli automatismi devono essere intelligenti, non ciechi.
- Sequenza obbligatoria: rilevazione bisogno -> analisi contesto -> proposta chiara -> conferma utente -> esecuzione -> report finale.
- Nessun automatismo strutturale, invasivo o potenzialmente distruttivo deve partire senza conferma esplicita.
- Per automazioni durevoli preferire n8n, task desktop/cloud o workflow persistenti; i loop di sessione servono solo per polling o babysitting temporaneo.

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
