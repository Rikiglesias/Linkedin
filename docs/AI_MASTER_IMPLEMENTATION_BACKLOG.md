# AI Master Implementation Backlog

Questo file e' il backlog madre unico dei punti ancora da completare rispetto a [AI_MASTER_SYSTEM_SPEC.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_MASTER_SYSTEM_SPEC.md).

Serve a rispondere a una sola domanda:

**"Quali sono tutti i punti ancora aperti, con sottopunti espliciti, primitive corrette e criterio di done?"**

Questo file non sostituisce:

- [AI_MASTER_SYSTEM_SPEC.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_MASTER_SYSTEM_SPEC.md) = sistema AI desiderato completo
- [AI_OPERATING_MODEL.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_OPERATING_MODEL.md) = stato, roadmap e ordine corretto di implementazione
- [AI_IMPLEMENTATION_LIST_GLOBAL.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_IMPLEMENTATION_LIST_GLOBAL.md) + [LINKEDIN_IMPLEMENTATION_LIST.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/LINKEDIN_IMPLEMENTATION_LIST.md) = vista lineare derivata degli stessi punti aperti (split per dominio), utile per review ma non seconda autorita'
- [active.md](/C:/Users/albie/Desktop/Programmi/Linkedin/todos/active.md) = priorita' correnti
- [workflow-architecture-hardening.md](/C:/Users/albie/Desktop/Programmi/Linkedin/todos/workflow-architecture-hardening.md) = backlog tecnico specialistico su bot/runtime

Regola di governance:

- se un punto aperto compare solo in backlog locali o in chat, il sistema non e' abbastanza ordinato
- i backlog specialistici possono dettagliare l'esecuzione, ma non devono introdurre temi nuovi fuori da questo file
- questo documento deve restare la vista unica e completa del "cosa manca ancora"

## Come leggere questo file

- `Status`: `PARZIALE`, `NON AVVIATO`, `OPERATIVO MA NON ENFORCED`, `DA VERIFICARE`
- `Orizzonte`: `breve`, `medio`, `lungo`
- `Primitive corrette`: leve principali da usare per chiudere davvero il punto
- `Done`: condizioni minime per poter dire che il punto e' chiuso davvero

## Baseline gia' presenti e non trattate qui come blocker primari

Questi blocchi sono gia' abbastanza formalizzati da poter fungere da base. Non sono "chiusi per sempre", ma non sono il collo di bottiglia principale adesso:

- verita' operativa e anti-compiacenza di base
- ragionamento non letterale e comprensione dell'intento
- blast radius, contesto diretto/indiretto e multi-dominio come regole canoniche
- requirement ledger e gestione dei prompt lunghi come regola esplicita
- modello a 9 livelli e loop finale di completezza come baseline operativa (nota: L1 e L7-L9 hanno enforcement meccanico reale; L2-L6 sono regole testuali senza enforcement dedicato — da costruire)
- memoria di base, handoff e runtime brief come meccanismi gia' presenti

## 1. Selezione autonoma di strumenti, modello, ambiente e fonte di verita'

Status: PARZIALE
Orizzonte: breve + medio
Primitive corrette: hook runtime, skill governance, plugin governance, audit script, documentazione ufficiale, MCP, canonici

Gia' presente:

- regole esplicite su fonte di verita', web/docs, orchestrazione contestuale e scelta degli strumenti
- runtime brief reiniettato in Claude Code prima dei prompt e prima della compattazione
- tabella modelli/ambienti gia' presente in [AI_OPERATING_MODEL.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_OPERATING_MODEL.md)
- registro machine-readable [AI_CAPABILITY_ROUTING.json](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/tracking/AI_CAPABILITY_ROUTING.json) con domini, capability e policy `sourceOfTruth` / `webPolicy`
- advisory hook `UserPromptSubmit -> skill-activation.ps1` che emette `PROJECT_ROUTING_DECISION`
- audit dedicato `npm run audit:routing`

Da completare:

- [ ] misurare i miss ricorrenti di selezione strumento per trasformarli in enforcement reale
- [ ] consolidare l'inventario unico delle capability installate o disponibili: skill, MCP, plugin, hook, workflow e agenti, con dominio, trigger, overlap, costo cognitivo e stato reale
- [ ] decidere per ogni capability se va tenuta, fusa, rimossa o spostata nella primitive piu' corretta, invece di accumulare tool che fanno casino
- [ ] riesaminare periodicamente skill duplicate, deboli o obsolete e chiarire quale sia la skill "migliore" per ogni dominio pratico
- [ ] riesaminare periodicamente anche agenti e workflow decisionali, non solo skill, per capire quali sono troppo deboli, troppo generici o superati dal caso d'uso reale
- [ ] valutare in modo esplicito candidate esterne come Caveman, LeanCTX, SIMDex e Contact Skills prima di installarle o scartarle, sulla base di gap reale, overlap, trigger, qualita' e costo di manutenzione

Done:

- l'AI spiega sempre, in modo breve, perche' ha scelto o non scelto skill, MCP, web/docs, loop e workflow rilevanti
- i task che richiedono stato esterno o best practice aggiornate non partono senza la fonte corretta
- i miss ricorrenti non restano note in chat ma vengono promossi in primitive strutturali
- il catalogo delle capability installate ha una decisione esplicita `tenere / fondere / rimuovere / promuovere / declassare`
- skill, MCP e plugin candidati non vengono accumulati per moda ma solo dopo valutazione esplicita e routing chiaro per dominio

## 2. Enforcement reale delle regole che non devono essere dimenticate

Status: PARZIALE
Orizzonte: breve + medio + lungo
Primitive corrette: hook, script, audit, runtime brief, canonici

Gia' presente:

- hook `SessionStart`, `UserPromptSubmit`, `PreCompact`, `PreToolUse`, `PostToolUse`, `Stop`
- gate quality e gate git gia' attivi in Claude Code per i blocker principali
- regole canoniche forti in [AGENTS.md](/C:/Users/albie/Desktop/Programmi/Linkedin/AGENTS.md)
- matrice enforcement gia' misurata da `npm run audit:rule-enforcement`
- protocollo machine-readable [AI_LEVEL_ENFORCEMENT.json](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/tracking/AI_LEVEL_ENFORCEMENT.json) per `L2-L6`
- audit dedicato `npm run audit:l2-l6`
- `UserPromptSubmit -> skill-activation.ps1` ora espone focus `L2-L6` in forma advisory

Da completare:

- [ ] promuovere dove serve i controlli `L2-L6` da `audit-assisted` a `blocking`, senza introdurre deny hook fragili o puramente cosmetici
- [ ] chiudere i gap tra hook attivi e regole dichiarate nei canonici
- [ ] estendere fuori da Claude Code i blocker minimi gia' enforced localmente, oppure documentare un fallback reale dove la parity non e' possibile
- [ ] controllare periodicamente il drift tra runtime brief, hook e documenti canonici

Done:

- nessuna regola critica resta affidata solo alla memoria del modello se puo' essere enforced meglio
- esiste una mappa verificabile regola -> primitive -> verifica
- il drift tra documento, hook e comportamento reale viene trattato come bug operativo

## 3. Memoria, contesto lungo, degrado del contesto e skill personalizzate

Status: PARZIALE
Orizzonte: breve + medio + lungo
Primitive corrette: memory files, skill `context-handoff`, audit, worklog, todos, runtime brief

Gia' presente:

- memoria personale e di progetto
- regole su handoff e degrado del contesto
- brief runtime reiniettato dai hook

Da completare:

- [ ] testare davvero in scenari reali la continuita' tra chat vecchia e chat nuova, non solo dichiararla nei documenti
- [ ] riesaminare e migliorare le skill personalizzate gia' create, non solo installare skill nuove
- [ ] rendere tutti i file di contesto ancora troppo densi piu' piccoli, tematici, indicizzati e leggibili dall'AI
- [ ] formalizzare una style guide esplicita per documenti AI-readable: un tema per file, scopo dichiarato, limiti di lunghezza, summary iniziale, non-goals, cross-link e sezione "cosa non contiene"
- [ ] far scattare in modo piu' affidabile il riconoscimento del degrado del contesto e la proposta di handoff
- [ ] aggiornare in modo piu' sistematico memoria, worklog e todos quando cambia lo stato reale del lavoro
- [ ] verificare che il requirement ledger resti coperto durante task lunghi e prompt molto compressi
- [ ] definire test o audit che confermino che le skill personalizzate si attivano quando dovrebbero

Done:

- una nuova sessione puo' ripartire con obiettivi, stato, decisioni, blocchi e prossimi passi senza perdita significativa
- le skill personalizzate non sono "presenti" soltanto: sono verificate, manutenute e utili davvero
- il degrado del contesto viene intercettato prima che il ragionamento crolli

## 4. n8n, agenti verticali e automazioni durevoli

Status: PARZIALE
Orizzonte: medio + lungo
Primitive corrette: workflow n8n, agenti verticali, hook ingresso/uscita, memoria workflow, human-in-the-loop

Gia' presente:

- JSON workflow gia' preparati
- guida setup e parte della documentazione operativa
- principio canonico "analisi -> proposta -> conferma -> esecuzione -> report"

Da completare:

- [ ] spostare n8n da "workflow JSON presenti nel repo" a "workflow vivi governati nell'istanza reale", distinguendo chiaramente design, deployment e controllo operativo
- [ ] definire per ogni automazione il boundary corretto tra workflow persistente, skill di sessione, hook, script locale e intervento umano, cosi' n8n non assorbe compiti che appartengono a primitive diverse
- [ ] attivare davvero workflow e hook di ingresso/uscita previsti, cosi' i controlli non restano documentati solo nei file ma esistono anche nel sistema reale
- [ ] aggiungere memoria o stato durevole nei flussi che non possono essere trattati come stateless senza perdita di affidabilita' o contesto
- [ ] distinguere gli agenti verticali per responsabilita', trigger, limiti e criterio di scelta, sostituendo o restringendo quelli troppo generici, ridondanti o difficili da attivare nel momento giusto
- [ ] imporre human-in-the-loop reale per flussi ad alto rischio, strutturali o invasivi, con pause e conferme nei punti decisionali giusti
- [ ] allineare scheduling, giorni/orari e condizioni di avvio al contesto reale dell'utente, cosi' l'automazione parte quando porta valore e non per semplice calendario cieco
- [ ] rendere i workflow trasferibili ad altri con setup, env validation, health check, runbook e ownership espliciti
- [ ] introdurre audit periodici su uso reale, drift, duplicati, rotture e agenti/workflow che esistono ma non vengono scelti correttamente dal sistema

Done:

- i workflow esistono come sistema operativo reale, non come artefatti pronti ma inattivi
- ogni flusso ha confini chiari tra automazione, controllo umano e stato durevole
- la qualita' degli agenti viene giudicata dal loro uso corretto nel contesto, non dalla sola presenza nel catalogo

## 5. Parita' ambienti: Claude Code, Codex, Cloud Code e altri IDE/CLI

Status: PARZIALE
Orizzonte: medio
Primitive corrette: matrice di capability, canonici condivisi, fallback espliciti, eventuali script di parity

Gia' presente:

- [AGENTS.md](/C:/Users/albie/Desktop/Programmi/Linkedin/AGENTS.md) come riferimento operativo di progetto
- distinzione di massima tra Claude Code e Codex gia' documentata

Da completare:

- [ ] definire una capability matrix che non dica solo "cosa esiste", ma quale contratto operativo reale offre ogni ambiente su canonici, memoria, skill, hook, MCP, git gate e audit
- [ ] distinguere per ogni ambiente cio' che e' supportato nativamente, cio' che e' ottenibile solo con workaround e cio' che oggi non ha parity affidabile
- [ ] chiudere o rendere espliciti i gap su memoria, handoff, runtime brief, git gate, audit e hook, con fallback che mantengano lo stesso standard di verita' invece di soluzioni solo comode
- [ ] stabilizzare i failure mode operativi gia' emersi in uso reale (`settings.json`, `SessionStart`, provider/model switching, modelli OpenRouter visibili o meno) invece di trattarli come incidenti scollegati
- [ ] verificare con task comparativi reali che Cloud Code e gli altri ambienti seguano la stessa logica contestuale di selezione strumenti e quality gate
- [ ] mantenere una policy viva sul miglior ambiente per ogni tipo di lavoro, basata su enforcement, visibilita', affidabilita' e costo cognitivo reale
- [ ] portare avanti la migrazione progressiva verso Codex solo dove il risultato non perde garanzie operative rispetto agli altri ambienti
- [ ] impedire che una regola critica viva in un solo ambiente: se una capability non e' portabile, il gap va tracciato come debito operativo e non normalizzato

Done:

- il cambio di ambiente non cambia il metodo di lavoro, ma solo la primitive disponibile
- limiti, fallback e garanzie di ciascun ambiente sono confrontabili in modo esplicito
- la scelta dell'ambiente e' una decisione tecnica motivata, non un'abitudine o un bug operativo

## 6. Strumenti personali e supporto locale

Status: PARZIALE
Orizzonte: medio
Primitive corrette: software locale, script, documentazione operativa, checklist di supporto

Gia' presente:

- base di Whisper/dettatura locale gia' impostata
- procedura alimentatore formalizzata

Da completare:

- [ ] rendere il tool di dettatura locale abbastanza stabile da sostituire davvero il fallback di Windows nel workflow quotidiano
- [ ] decidere e documentare meglio il trade-off locale vs cloud per la trascrizione
- [ ] risolvere i problemi del computer che oggi restano colli di bottiglia operativi
- [ ] creare, se serve, un assistente o un workflow che aiuti a riscrivere prompt mal formulati in prompt piu' chiari e strutturati
- [ ] collegare in modo affidabile il suggerimento su modello/ambiente al prompt reale dell'utente

Done:

- input vocale, prompt improvement e scelta ambiente non restano lavori manuali improvvisati
- i problemi ricorrenti della macchina non restano note sparse ma hanno tracciamento e risoluzione

## 7. Runtime reale, production truthfulness e control plane del bot

Status: PARZIALE
Orizzonte: breve + medio
Primitive corrette: refactor runtime, script di audit, test, health endpoint, backlog specialistico, worklog

Riferimento specialistico corrente:

- [workflow-architecture-hardening.md](/C:/Users/albie/Desktop/Programmi/Linkedin/todos/workflow-architecture-hardening.md)

Gia' presente:

- lock del daemon cooperativo con heartbeat durante la run e release su shutdown
- percorso centrale di graceful shutdown nel daemon
- timeout PM2 riallineati al budget reale di stop
- `/api/health/deep` con daemon liveness via `runtime_locks` e zombie `automation_commands`
- recovery degli `automation_commands` `RUNNING` rimasti dopo crash/stop
- fallback strutturato `WORKFLOW_ERROR` per incidenti runtime non gestiti
- `workflowToJobTypes(...)` allineato ai job reali, incluso `INTERACTION`

Da completare:

- [ ] aggiungere stop/flush esplicito di listener e checkpoint allo shutdown
- [ ] portare reporting live, stato proxy e stato JA3 fuori dalla memoria locale di processo
- [ ] ripulire i boundary dei workflow per evitare side effect impliciti fuori contratto
- [ ] sostituire o chiudere il `skipPreflight` troppo permissivo nei path non interattivi
- [ ] rendere l'override account scoped alla singola run e sempre ripristinato
- [ ] verificare che API, Telegram, report e dashboard leggano la stessa verita' runtime e che i failure mode specifici propaghino tutti lo stesso `WorkflowExecutionResult`
- [ ] completare validazioni di staging reali con browser, proxy e account veri

Done:

- il control plane descrive lo stesso stato che esiste davvero nel runtime
- shutdown, restart e recovery non lasciano stato incoerente
- workflow, API, dashboard e report non divergono sui fatti critici

## 8. Anti-ban, proxy/sessione, sicurezza e compliance

Status: PARZIALE
Orizzonte: breve + medio + lungo
Primitive corrette: skill antiban, hook, security scan mirati, workflow periodici, docs ufficiali, test, staging

Da completare:

- [ ] audit completo dei workflow pubblici su proxy, sessione, account health e preflight reale
- [ ] separare in modo affidabile `LOGIN_MISSING` da rate limit, `403`, timeout, proxy failure e rete degradata
- [ ] rafforzare il gate "proxy healthy" con verifica reale di auth, `CONNECT`, exit IP e browsing minimo
- [ ] valutare e verificare la coerenza geo sull'exit IP reale
- [ ] ripristinare o sostituire in modo corretto il controllo UA <-> engine anche nei casi JA3/proxy
- [ ] allineare il preflight workflow al mondo multi-account e multi-proxy reale
- [ ] aggiornare la parte anti-ban con i vettori di detection piu' recenti e con monitor periodici reali
- [ ] importare e attivare davvero il workflow di retention/GDPR gia' preparato
- [ ] verificare end-to-end right to erasure, retention e data hygiene anche sugli store secondari
- [ ] verificare che Sentry e i controlli di sicurezza ricevano eventi reali in produzione
- [ ] mantenere security scan mirati su auth, input utente, query DB, stealth e aree sensibili

Done:

- il sistema distingue correttamente i failure mode piu' critici
- le difese anti-ban non restano solo documentali ma sono osservabili e verificate
- gli obblighi di compliance non restano "parzialmente pronti" ma girano anche come automazioni reali

## 9. Commit, push, review e chiusura corretta dei blocchi di lavoro

Status: PARZIALE
Orizzonte: breve + medio
Primitive corrette: hook git, audit git, skill `git-commit`, skill `git-create-pr`, review discipline

Gia' presente:

- gate quality e gate git in Claude Code
- audit contestuale `audit:git-automation`
- policy esplicita in [AGENTS.md](/C:/Users/albie/Desktop/Programmi/Linkedin/AGENTS.md)

Da completare:

- [ ] estendere il comportamento corretto su commit/push anche fuori da Claude Code o documentare un fallback affidabile
- [ ] verificare che il commit parta davvero come chiusura naturale di un blocco verificato, non solo come regola scritta
- [ ] chiarire meglio dove il push deve fermarsi per review, remote policy o rischio operativo
- [ ] rendere piu' sistematica la distinzione tra review locale, review di branch e audit periodico
- [ ] evitare che il task venga dichiarato chiuso prima della chiusura corretta del blocco tecnico e git

Done:

- commit e push non dipendono da promemoria manuali dell'utente
- review e chiusura del blocco seguono il rischio reale e non l'abitudine
- l'AI non lascia blocchi verificati senza sapere se devono essere committati, pushati o mandati in PR

## 10. Orizzonti temporali, cadenze periodiche e backlog di manutenzione

Status: PARZIALE
Orizzonte: breve + medio + lungo
Primitive corrette: canonici, todos, worklog, audit periodici, workflow schedulati

Da completare:

- [ ] trattare breve, medio e lungo termine come classificazione obbligatoria del task, non come nota descrittiva separata
- [ ] distinguere sempre cosa va eseguito ora, cosa va chiuso come follow-up della stessa iniziativa e cosa appartiene a manutenzione o hardening periodico
- [ ] dare a ogni punto non di breve termine una sede canonica precisa, cosi' nulla resta sospeso in chat o nella memoria volatile
- [ ] formalizzare cadenze minime e owner logico di code review, memoria, documenti, cleanup, sicurezza, capability audit e automazioni
- [ ] promuovere le ricorrenze stabili da backlog testuale ad audit, script o workflow schedulati quando il valore e' realmente periodico
- [ ] impedire che obblighi del breve termine vengano spostati nel backlog solo per rinviare lavoro necessario nella sessione corrente
- [ ] mantenere backlog madre, backlog specialistici, worklog e priorita' attive come facce coerenti dello stesso stato operativo

Done:

- ogni punto aperto ha orizzonte, contenitore e motivo chiari
- il backlog non diventa discarica di obblighi che dovevano essere eseguiti subito
- manutenzione periodica e lavoro corrente non si confondono

## 11. Pulizia della codebase, dei documenti e della root

Status: PARZIALE
Orizzonte: medio + lungo
Primitive corrette: audit, cleanup guidato, code search, worklog, docs index, backlog strutturale

Da completare:

- [ ] riesaminare file troppo lunghi o con responsabilita' miste e decidere split concreti
- [ ] decidere il destino delle aree legacy o ambigue della UI/dashboard
- [ ] separare meglio documenti storici, documenti operativi e documenti canonici
- [ ] tenere `docs/README.md` davvero allineato ai documenti importanti
- [ ] pulire root e cartelle solo dopo classificazione esplicita del loro ruolo
- [ ] ridurre duplicazioni, backlog morti e documenti che dicono la stessa cosa con nomi diversi
- [ ] mantenere AI-readable i file canonici, evitando monoliti documentali ingestibili

Done:

- il progetto ha meno ambiguita' strutturale
- la documentazione non costringe l'AI o l'utente a cercare lo stesso tema in piu' posti
- la root e i documenti non accumulano caos destinato a essere amplificato dall'AI

## 12. Nuovi progetti, riuso e consegna ad altre persone

Status: PARZIALE
Orizzonte: medio + lungo
Primitive corrette: checklist bootstrap, template, setup guide, documentazione di handoff

Gia' presente:

- [NEW_PROJECT_BOOTSTRAP_CHECKLIST.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/NEW_PROJECT_BOOTSTRAP_CHECKLIST.md)

Da completare:

- [ ] mantenere la checklist bootstrap allineata al sistema reale e non lasciarla divergere
- [ ] creare un pacchetto di handoff davvero riusabile per altri progetti o altre persone
- [ ] chiarire cosa va portato sempre in un nuovo progetto: regole, memory, quality gate, hook, workflow, sicurezza, git discipline, handoff
- [ ] verificare che il sistema resti trasferibile anche fuori da questa singola codebase

Done:

- un nuovo progetto non parte da conoscenza implicita
- il sistema puo' essere riusato o consegnato senza perdere i pezzi fondamentali

## 13. Autonomia totale e sistema che migliora se stesso

Status: PARZIALE
Orizzonte: medio + lungo
Primitive corrette: audit, hook, skill governance, metriche di compliance, workflow periodici

Da completare:

- [ ] misurare omissioni, errori di scelta delle primitive e falsi completamenti come segnali di sistema, non come episodi isolati
- [ ] convertire i miss ricorrenti nel livello corretto di automazione o enforcement: regola, checklist, skill, hook, script o workflow
- [ ] far riconoscere automaticamente quando il problema reale e' l'assenza della primitive giusta e proporre la promozione strutturale corretta
- [ ] rendere piu' automatica la scelta del prossimo passo corretto, mantenendo pero' esplicita verso l'utente la logica di selezione
- [ ] verificare sistematicamente che l'AI non finga completezza, avanzamento o verifica oltre le prove davvero disponibili
- [ ] collegare autonomia, orizzonti temporali, truthful control plane e capability governance in metriche verificabili e confrontabili nel tempo
- [ ] usare quelle metriche per decidere dove intervenire su regole, hook, skill, workflow e documenti, invece di aggiungere pezzi a intuito

Done:

- il sistema impara dai propri errori ricorrenti e li trasforma in enforcement migliore
- l'utente non fa da memoria esterna o project manager tecnico
- autonomia significa auto-orchestrazione verificabile, non liberta' di improvvisare

## Ordine corretto di chiusura

Per non amplificare caos o automazioni premature, l'ordine corretto resta questo:

1. control plane cognitivo, scelta strumenti e enforcement delle regole
2. runtime reale, production truthfulness e control plane del bot
3. anti-ban, proxy/sessione, sicurezza e compliance
4. n8n, agenti verticali e automazioni durevoli
5. parity ambienti e strumenti personali
6. manutenzione periodica, cleanup, riuso su nuovi progetti e metriche di autonomia

## Backlog specialistici che devono restare allineati

- [active.md](/C:/Users/albie/Desktop/Programmi/Linkedin/todos/active.md) = priorita' correnti del momento
- [workflow-architecture-hardening.md](/C:/Users/albie/Desktop/Programmi/Linkedin/todos/workflow-architecture-hardening.md) = dettaglio tecnico runtime/bot
- [ENGINEERING_WORKLOG.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/tracking/ENGINEERING_WORKLOG.md) = storico delle analisi e delle verifiche reali

Regola finale:

se un punto aperto rilevante esiste in uno di questi file ma non esiste qui, questo backlog madre non e' ancora abbastanza completo.
