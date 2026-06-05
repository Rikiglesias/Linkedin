# AI Master Implementation Backlog

Questo file e' il backlog madre unico dei punti ancora da completare rispetto a `docs/AI_MASTER_SYSTEM_SPEC.md`.

Serve a rispondere a una sola domanda:

**"Quali sono tutti i punti ancora aperti del sistema AI globale, con sottopunti espliciti, primitive corrette, ordine logico, criterio di done e verifiche?"**

## Scope corretto

Questo documento contiene solo il sistema AI globale:

- regole, memoria, runtime brief, handoff e trasferimento contesto
- hook, audit, script, skill, MCP, plugin, agenti, workflow e loro routing
- modelli, provider, ambiente migliore, fonte di verita' e web/docs
- loop di completamento, no false completion, anti-compiacenza e autonomia
- parity tra Claude Code, Codex, Cloud Code e altri ambienti
- manutenzione periodica, cleanup AI-readable, bootstrap nuovi progetti e riuso

Questo documento non contiene backlog applicativo LinkedIn:

- runtime reale del bot, proxy, JA3, account health, browser LinkedIn, dashboard, staging account reali, preflight applicativo e anti-ban operativo del bot stanno fuori scope qui
- quei punti vanno mantenuti nei backlog specialistici dedicati, non ampliati in questo documento
- se un punto LinkedIn-specifico compare qui come item aperto, e' un bug documentale da correggere

## Relazione con gli altri canonici

Questo file non sostituisce:

- `docs/AI_MASTER_SYSTEM_SPEC.md` = sistema AI desiderato completo
- `docs/AI_OPERATING_MODEL.md` = stato, roadmap e ordine corretto di implementazione
- `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md` = vista lineare derivata degli stessi punti AI, utile per review ma non seconda autorita'
- `docs/LINKEDIN_IMPLEMENTATION_LIST.md` = backlog separato LinkedIn-specifico, fuori scope per questa lista AI
- `todos/active.md` = priorita' correnti
- `docs/tracking/ENGINEERING_WORKLOG.md` = storico delle analisi, verifiche e decisioni operative reali

Regola di governance:

- se un punto aperto AI compare solo in backlog locali o in chat, il sistema non e' abbastanza ordinato
- i backlog specialistici possono dettagliare l'esecuzione di dominio, ma non devono introdurre temi AI globali nuovi fuori da questo file
- questo documento deve restare la vista unica e completa del "cosa manca ancora"
- i completati restano sintetici, ma devono dichiarare prova reale o limite residuo

## Come leggere ogni punto

- `Status`: `PARZIALE`, `NON AVVIATO`, `OPERATIVO MA NON ENFORCED`, `DA VERIFICARE`
- `Orizzonte`: `breve`, `medio`, `lungo`
- `Problema reale`: perche' il punto esiste e quale fallimento deve evitare
- `Stato attuale`: cosa c'e' gia' e cosa manca davvero
- `Trigger operativo`: quando il punto deve attivarsi o essere considerato
- `Output atteso`: cosa deve produrre in modo osservabile
- `Limiti / non-goals`: cosa non deve fare o non deve promettere
- `Primitive corrette`: skill, hook, audit, script, MCP, plugin, workflow, memoria o documento canonico da usare
- `Ordine logico`: sequenza corretta per chiudere il punto senza creare caos
- `Sottopunti operativi`: lavoro residuo concreto
- `Criterio done`: condizioni minime per dire chiuso davvero
- `Verifiche richieste`: prove automatiche o manuali da eseguire

## Baseline gia' presenti

Questi blocchi sono gia' abbastanza formalizzati da poter fungere da base. Non sono "chiusi per sempre", ma non sono il collo di bottiglia principale adesso:

- verita' operativa, no hallucination e anti-compiacenza di base
- ragionamento non letterale, interpretazione semantica del dettato vocale e comprensione dell'intento
- esempi dell'utente come pattern, non come lista chiusa
- blast radius, contesto diretto/indiretto e verifica multi-dominio come regole canoniche
- requirement ledger e gestione dei prompt lunghi come regola esplicita
- modello a 9 livelli e loop finale di completezza come baseline operativa
- L1 e L7-L9 hanno enforcement meccanico reale; L2-L6 sono regole testuali senza enforcement dedicato completo, da promuovere solo dove i miss ricorrenti lo giustificano
- memoria di base, runtime brief e handoff come meccanismi gia' presenti

---

## 1. Completezza della lista AI e separazione dello scope

Status: STRUTTURALMENTE COMPLETO — manutentivo a ogni nuovo item AI
Orizzonte: breve

Problema reale:

La lista e' stata mescolata piu' volte con backlog applicativi LinkedIn. Questo crea due danni: la nuova chat non capisce cosa deve implementare sul sistema AI, e i punti sembrano completi anche quando sono solo descritti in modo generico.

Stato attuale:

Esistono spec, backlog madre e vista lineare globale, ma il backlog madre conteneva ancora sezioni LinkedIn-specifiche e la vista lineare aveva completati dentro la sezione aperti.

Trigger operativo:

Ogni volta che viene aggiunto, spostato o chiuso un punto del sistema AI globale, oppure quando una nuova chat deve capire cosa manca senza leggere tutta la storia.

Output atteso:

Lista AI-only con punti aperti uniformi, fonte madre chiara, vista lineare derivata e audit che impedisce regressioni strutturali.

Limiti / non-goals:

Non deve diventare backlog applicativo LinkedIn, roadmap prodotto o raccolta di idee generiche non trasformate in punti verificabili.

Primitive corrette:

- documento canonico
- vista lineare derivata
- audit `audit:ai-list-completeness`
- worklog
- todos attivi

Ordine logico:

1. separare esplicitamente AI globale da backlog applicativo LinkedIn
2. rendere ogni punto AI aperto uniforme e non generico
3. aggiungere audit che fallisce se la lista degrada
4. aggiornare todos e worklog

Sottopunti operativi:

- [x] impedire che runtime bot, proxy, JA3, dashboard e anti-ban applicativo rientrino nel backlog AI globale — `checkLinkedInScope` in `audit:ai-list-completeness`
- [x] mantenere `AI_MASTER_IMPLEMENTATION_BACKLOG.md` come fonte madre del mancante AI
- [x] mantenere `AI_IMPLEMENTATION_LIST_GLOBAL.md` come vista lineare derivata, non come seconda autorita'
- [x] controllare che nessun punto aperto AI sia privo di problema, stato, primitive, ordine, sottopunti, done e verifiche — `checkMasterSections` + `checkGlobalOpenItems`
- [x] distinguere falsi completati da meccanismi presenti ma non validati end-to-end — `checkContextTransferOpen` esempio canonico

Criterio done:

- una nuova chat puo' leggere solo backlog madre + vista lineare globale e capire cosa va fatto sul sistema AI senza chiedere "cosa intendi?"
- nessun punto LinkedIn-specifico resta nella lista AI come item aperto
- l'audit di completezza lista passa e viene incluso nel control plane AI

Verifiche richieste:

- `npm run audit:ai-list-completeness`
- `npm run audit:ai-control-plane`
- controllo manuale su `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md` e `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md`

## 2. Orchestrator Layer e selezione autonoma di fonte, modello, ambiente e strumenti

Status: PARZIALE
Orizzonte: breve + medio

Problema reale:

L'utente non puo' specificare ogni volta fonte corretta, modello, skill, MCP, web/docs e ordine di esecuzione. Serve un Orchestrator Layer che decida come lavorare prima dell'esecuzione: normalizza input, classifica task, sceglie fonte, capability, modello, ambiente, piano, loop, handoff e verifiche.

Stato attuale:

Sono gia' presenti regole su fonte di verita', web/docs, modello, ambiente e routing. Esistono `AI_CAPABILITY_ROUTING.json`, `AI_ADK_CAPABILITY_GOVERNANCE.json`, runtime brief e hook advisory `skill-activation.ps1`. Il comportamento pero' e' ancora soprattutto advisory e distribuito: l'Orchestrator Layer non e' ancora abbastanza esplicito come contratto unico cross-ambiente. Il miss reale emerso e' che una skill non installata localmente e' stata trattata come inesistente invece di attivare discovery esterna.

Trigger operativo:

Ogni prompt non banale, ogni modifica a codice/documenti/workflow e ogni task che dipende da fonte esterna, ambiente, provider, modello o capability specifica.

Output atteso:

Decisione esplicita o mentale ma coerente su input normalizzato, task class, fonte, modello, ambiente, skill, MCP, plugin, hook, script/audit, subagent, web/docs, loop, handoff e verifiche da usare o escludere.

Limiti / non-goals:

Non deve produrre rumore su task banali e non deve trasformare ogni scelta in hook bloccante se il segnale non e' deterministico.

Primitive corrette:

- runtime brief
- hook advisory o bloccanti solo dove deterministici
- registry `AI_CAPABILITY_ROUTING.json`
- registry `AI_ADK_CAPABILITY_GOVERNANCE.json`
- audit `audit:routing`
- audit `audit:adk-capabilities`
- skill-finder / capability finder locale + esterno
- discovery skill esterna: `npx skills find`, `skills.sh`, repository ufficiali o fonti affidabili
- docs ufficiali e web search quando la conoscenza puo' essere cambiata
- MCP o plugin quando servono stato reale o operazioni esterne

Ordine logico:

1. normalizzare input, intento, esempi, vincoli e assunzioni
2. classificare task per dominio, rischio, orizzonte, impatti e fonte di verita'
3. interrogare registry/capability finder quando la primitive non e' ovvia
4. se la skill/capability non e' locale, cercare su internet/cataloghi ufficiali prima di dichiarare gap o crearla
5. scegliere modello, ambiente, skill, MCP, plugin, hook, script/audit, subagent, loop, handoff e verifiche
6. dichiarare esclusioni rilevanti nei task non banali
7. usare docs ufficiali o web quando il dato e' instabile
8. misurare miss e trasformare quelli ricorrenti in audit/hook/skill/workflow

Sottopunti operativi:

- [ ] misurare i miss di selezione strumento/modello/ambiente dai log e dalle sessioni reali
- [ ] definire contratto unico dell'Orchestrator Layer: input, output, stato persistente, confini e failure mode
- [ ] rafforzare la decisione `fonte interna / docs ufficiali / web / MCP / plugin / skill / agente`
- [ ] creare o integrare `skill-finder` / capability finder per cercare skill locali, skill pubbliche (`gh skill search`), duplicati e candidate da migrare
- [ ] obbligare discovery esterna quando la skill/capability manca localmente: `npx skills find`, `skills.sh`, repo ufficiali/affidabili, verifica install count/reputazione/compatibilita'
- [ ] rendere esplicito quando la richiesta dell'utente e' solo un esempio e va generalizzata per pattern
- [ ] impedire che l'AI parta da knowledge cutoff quando il dato e' temporale o provider/API dipendente
- [ ] far dichiarare sempre la scelta tecnica solo quando e' utile, senza creare rumore su task banali

Criterio done:

- task non banali passano sempre da una decisione orchestrata, anche se non sempre verbalizzata
- task instabili o provider-specifici non partono senza fonte aggiornata o MCP corretto
- skill/capability assente localmente non viene dichiarata inesistente senza ricerca web/cataloghi ufficiali
- il sistema sa spiegare perche' usa o non usa skill, web, MCP, plugin, agenti e loop
- i miss ricorrenti di routing hanno owner e primitive di correzione

Verifiche richieste:

- `npm run audit:routing`
- smoke prompt su almeno 5 domini diversi
- review periodica dei log di violazione e dei casi in cui l'utente ha dovuto ricordare una skill/fonte

## 3. Governance di skill, MCP, plugin, agenti e capability installate

Status: PARZIALE
Orizzonte: breve + medio

Problema reale:

Accumulo di skill, MCP, plugin e agenti senza routing chiaro crea confusione. La capability migliore per backend, frontend, documenti, handoff, sicurezza o prompt non deve dipendere dalla memoria dell'utente. Le immagini WhatsApp del 2026-05-06 aggiungono un requisito esplicito: il sistema deve essere trattato come Agent Development Kit a 5 layer, non come lista piatta di tool.

Stato attuale:

Esistono registry machine-readable per routing, livelli L2-L9 e governance ADK. Alcune skill sono verificate, i 33 command hook attivi sono stati auditati, e il registry ADK classifica tutte le capability del routing nei layer corretti. Manca ancora la valutazione qualitativa completa di duplicati, candidate esterne e pacchetto plugin installabile reale.

Trigger operativo:

Quando si aggiunge, installa, duplica, promuove, rimuove o invoca una capability; quando l'utente nomina una skill/tool candidata; quando due strumenti sembrano coprire lo stesso dominio.

Output atteso:

Catalogo capability con layer ADK corretto, trigger, limiti, overlap, decisione keep/merge/remove/promote/demote e stato delle candidate esterne.

Limiti / non-goals:

Non deve installare tool per curiosita', accumulare skill sovrapposte o confondere MCP, skill, hook, plugin e workflow come se fossero equivalenti.

Primitive corrette:

- `AI_CAPABILITY_ROUTING.json`
- `AI_ADK_CAPABILITY_GOVERNANCE.json`
- audit capability
- skill governance
- plugin governance
- subagent governance
- Agent Development Kit 5-layer architecture
- plugin manifest / marketplace / team install
- MCP registry
- worklog decisionale
- eventuali workflow periodici

Ordine logico:

1. classificare il layer corretto: rules/memory, skill, hook, subagent, plugin/distribution, MCP esterno
2. inventariare capability reali installate o disponibili
3. classificare dominio, trigger, output, limiti, overlap e stato
4. decidere keep/merge/remove/promote/demote
5. aggiornare routing e canonici
6. verificare con prompt reali che parta la capability giusta

Sottopunti operativi:

- [x] consolidare inventario unico delle capability operative del control plane in `AI_ADK_CAPABILITY_GOVERNANCE.json`
- [x] formalizzare il modello Agent Development Kit a 5 layer: `CLAUDE.md`/`AGENTS.md` per regole e memoria, `SKILL.md` per conoscenza modulare, hook per guardrail deterministici, subagent per delega isolata, plugin per distribuzione
- [x] distinguere layer globale e layer progetto: cosa vive in `~/.claude/` per tutti i progetti e cosa vive nella repo per regole, skill, hook e contesto specifici
- [x] standardizzare struttura skill: `SKILL.md`, `scripts/`, `templates/`, `assets/`, contesto minimo e trigger descrittivo auto-invocabile
- [x] standardizzare subagent: un job per subagent, contesto proprio, strumenti/permessi propri, risultato unico di ritorno, nessun inquinamento del thread principale
- [x] standardizzare plugin: `plugin.json`/manifest, lista di skill/agenti/hook/comandi inclusi, versione, firma o provenance, installazione team/repo
- [x] decidere per ogni capability nel routing registry se e' migliore come skill, MCP, plugin, hook, audit, script, workflow o fonte esterna
- [x] eliminare o fondere duplicati — `audit:skill-duplicates` (2026-05-14) ha scansionato 197 skill: solo overlap legittimi generator/validator o skill parent/child; nessun duplicato operativo da rimuovere
- [x] registrare candidate esterne Caveman, LeanCTX, SIMDex e Contact Skills come `evaluate-before-install`, senza installazione cieca
- [x] registrare candidate esterne 2026-05-14: Google CodeWiki (Gemini, attendere extension privata), Ruflo (multi-agent orchestrator, alto rischio overlap), Understand-Anything (knowledge graph codebase, overlap da confrontare con code-review-graph MCP)
- [ ] valutare davvero candidate esterne Caveman, LeanCTX, SIMDex, Contact Skills, Google CodeWiki, Ruflo e Understand-Anything prima di installarle
- [ ] distinguere capability backend, frontend, docs, prompt, handoff, sicurezza, testing, review e automazioni
- [ ] creare regole di attivazione chiare per capability con nomi simili
- [ ] documentare gap reali e chiedere conferma all'utente quando serve creare una nuova primitive

Criterio done:

- ogni capability ha dominio, trigger, limiti, owner logico, stato e relazione con capability simili
- ogni capability ha anche un layer corretto nel modello Agent Development Kit e non vive in una cartella casuale
- le capability riusabili per team/progetti possono essere pacchettizzate come plugin versionato invece di essere copiate manualmente
- le candidate esterne non vengono installate per nome, ma solo dopo valutazione di gap reale e overlap
- l'AI puo' scegliere la skill o primitive corretta senza aspettare esempi dell'utente

Verifiche richieste:

- `npm run audit:routing`
- `npm run audit:adk-capabilities`
- `npm run audit:ai-list-completeness`
- audit manuale inventario capability
- test con prompt backend/frontend/docs/handoff/prompt/review
- review manuale su un esempio di skill, un hook, un subagent e un plugin/manifest

## 4. Enforcement reale delle regole critiche

Status: PARZIALE
Orizzonte: breve + medio + lungo

Problema reale:

Una regola critica scritta solo in un documento viene dimenticata. Pero' trasformare tutto in hook bloccante crea falsi positivi e blocca lavoro legittimo. Serve decidere quali regole diventano hook, quali audit, quali skill e quali restano disciplina operativa.

Stato attuale:

Esistono hook `SessionStart`, `UserPromptSubmit`, `PreCompact`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop` e agent team, gate git/quality e audit `audit:rule-enforcement`, `audit:l2-l6`, `audit:hooks`. `audit:hooks` ora verifica 32 hook sempre attivi + 2 hook router condizionali (filtrati in modalita' Anthropic nativo), è condition-aware su `ANTHROPIC_BASE_URL`, e include il controllo che l'auto-commit via trigger non usi `git add .` o `--no-verify`. L2-L6 sono audit-assisted, non blocking completi. Il nuovo hook `post-edit-codebase-hygiene.ps1` rende esplicita dopo ogni edit la valutazione pulizia su file diretti e indiretti.

Trigger operativo:

Quando una regola viene dimenticata piu' volte, quando un audit rileva drift, quando un quality gate puo' essere bypassato o quando una regola critica ha un segnale osservabile robusto.

Output atteso:

Matrice regola -> rischio -> segnale -> primitive corretta, con distinzione tra hook bloccante, advisory, audit, skill e disciplina operativa.

Limiti / non-goals:

Non deve aggiungere hook generici per compensare ragionamento debole e non deve bloccare lavoro legittimo con controlli semantici fragili.

Primitive corrette:

- hook bloccanti solo per condizioni deterministiche
- audit periodici
- script di verifica
- runtime brief
- skill per procedure cognitive
- log violation

Ordine logico:

1. mappare regola -> rischio -> segnale osservabile -> primitive corretta
2. misurare miss reali prima di promuovere a blocker
3. implementare enforcement minimo robusto
4. verificare falsi positivi e falsi negativi
5. aggiornare canonici e audit

Sottopunti operativi:

- [x] decidere il set hook operativo corrente: 33 command hook attivi, nessun nuovo hook da aggiungere senza miss ricorrenti misurati o advisory ad alto valore
- [x] correggere l'hook di auto-commit su trigger per non bypassare gate git o native pre-commit
- [x] mantenere `audit:hooks` allineato a `~/.claude/settings.json` ogni volta che cambia la configurazione — reso condition-aware su `ANTHROPIC_BASE_URL` (2026-05-13)
- [ ] promuovere L2-L6 da audit-assisted a blocking solo dove esiste condizione verificabile
- [ ] coprire best practice di modifica codice: blast radius, contratti, dipendenze, test impattati, file diretti e indiretti
- [ ] coprire cross-domain per ogni file: sicurezza, architettura, performance/timing, compliance, observability e rischio dominio
- [x] aggiungere hook advisory post-edit per codebase hygiene: file diretto corretto, file indiretti coerenti, duplicati/obsoleti/split/rename/delete/follow-up
- [x] impedire falsi completati: meccanismo presente non significa test end-to-end superato — `audit:ai-list-completeness` fail su item privi di prova
- [x] mantenere drift doc-hook-audit come bug operativo, non come nota — fix router hook 2026-05-13 trattato come bug
- [x] introdurre `.claude/rules/` path-scoped: scaffold creato (2026-05-13) con `browser-antiban.md`, `api-security.md`, `scripts-audit.md`. Manca promozione automatica via hook che legge da qui

Criterio done:

- ogni regola critica ha primitive, verifica e limite dichiarato
- nessun blocker si basa su interpretazioni fragili che producono caos
- ogni miss ricorrente viene promosso al livello corretto o motivatamente lasciato come disciplina

Verifiche richieste:

- `npm run audit:hooks`
- `npm run audit:rule-enforcement`
- `npm run audit:l2-l6`
- review manuale dei violation log

## 5. Memoria, handoff e trasferimento contesto in una nuova chat

Status: PARZIALE — prima prova manuale passata il 2026-05-11; migrazione Obsidian avviata 2026-06-02; anti-staleness ora copre `.claude/CONTINUATION.md`, `Resources/continuita` e sync memoria/todos. Validazione periodica resta da fare a ogni cambio strutturale
Orizzonte: breve + medio

Problema reale:

Il sistema sembra avere memoria e handoff, ma se una nuova chat non riparte davvero senza perdita di stato, il meccanismo e' solo teorico. Il trasferimento contesto e' un punto aperto finche' non viene validato end-to-end.

Stato attuale:

Esistono memoria globale/progetto, `AI_RUNTIME_BRIEF.md`, `.claude/CONTINUATION.md`, sync unidirezionale verso Obsidian e vista `Resources/continuita/START-NEXT-CHAT.md`. Una nuova sessione Codex del 2026-05-11 avviata con `resume` ha ricostruito contesto, stato, blocchi e prossimi passi leggendo memoria, handoff e canonici senza chiedere spiegazioni aggiuntive. Il metodo primario nuovo e': `~/memory` + `todos/active.md` + `.claude/CONTINUATION.md` sincronizzato in Obsidian `Resources/continuita`. `SESSION_HANDOFF.md` e `.claude/SESSION_PROMPT.md` restano fallback legacy/storico, non procedura primaria.

Trigger operativo:

Fine sessione lunga, contesto sopra soglia critica, cambio chat/ambiente, compact imminente, lavoro multi-step non chiuso o richiesta esplicita di trasferire contesto.

Output atteso:

Continuita' operativa per nuova chat con stato, decisioni, blast radius, verifiche, blocchi, prossimi passi, git status, file canonici da leggere e nota Obsidian `START-NEXT-CHAT.md`.

Limiti / non-goals:

Non deve essere riassunto narrativo generico e non deve marcare il trasferimento come chiuso senza prova reale in una nuova chat.

Primitive corrette:

- `.claude/CONTINUATION.md`
- sync Obsidian `Resources/continuita`
- `START-NEXT-CHAT.md`
- skill `context-handoff` solo come supporto/manual fallback
- `SESSION_HANDOFF.md` come fallback legacy
- eventuale `SESSION_PROMPT.md` come fallback legacy
- memory files
- `todos/active.md`
- `ENGINEERING_WORKLOG.md`
- audit handoff/continuita'

Ordine logico:

1. aggiornare memoria, `todos/active.md` e worklog quando cambia lo stato reale
2. compilare `.claude/CONTINUATION.md` senza TODO con stato, decisioni, blast radius, verifiche e blocchi
3. sincronizzare Obsidian in `Resources/continuita` e generare `START-NEXT-CHAT.md`
4. far leggere alla nuova chat solo memoria, todos, canonici e vista Obsidian prevista
5. usare `SESSION_HANDOFF.md` / `SESSION_PROMPT.md` solo come fallback legacy se la vista primaria manca
6. verificare se ricostruisce lavoro e prossimi passi senza omissioni
7. correggere template, hook, sync o audit se resta generico

Sottopunti operativi:

- [x] definire contenuto minimo non opzionale di `SESSION_HANDOFF.md` — ora storico/fallback legacy
- [x] creare o standardizzare `.claude/SESSION_PROMPT.md` quando serve passare contesto a nuova chat — ora storico/fallback legacy
- [x] includere stato git, modifiche non committate, verifiche eseguite e verifiche mancanti
- [x] includere blocchi aperti e prossimi passi ordinati logicamente
- [x] validare almeno una nuova chat reale leggendo solo handoff + canonici indicati — prova Codex 2026-05-11
- [x] marcare il punto come completato solo dopo prova reale e gestione anti-staleness, non per presenza dei file — regola seguita: prova Codex 2026-05-11 + `audit:handoff-staleness`
- [x] aggiungere o mantenere controllo anti-staleness sulla continuita' quando una sessione viene ripresa dopo commit nuovi — `src/scripts/handoffStalenessAudit.ts` verifica `.claude/CONTINUATION.md`, Obsidian `Resources/continuita`, memoria e todos
- [x] migrare la procedura primaria a `.claude/CONTINUATION.md` + Obsidian `Resources/continuita/START-NEXT-CHAT.md`, lasciando `SESSION_HANDOFF.md` / `SESSION_PROMPT.md` come fallback legacy

Criterio done:

- una nuova chat riparte senza chiedere all'utente di rispiegare contesto, scope o blocchi
- la vista Obsidian `Resources/continuita` e `START-NEXT-CHAT.md` non e' generica, ma operativa
- `SESSION_HANDOFF.md` e `SESSION_PROMPT.md` non vengono piu' richiesti come fonte primaria
- eventuali omissioni trovate diventano correzioni a skill/template/audit

Verifiche richieste:

- prova manuale con nuova chat — prima prova passata in Codex il 2026-05-11
- `npm run audit:handoff-staleness`
- `npm run audit:ai-control-plane`
- controllo manuale di `.claude/CONTINUATION.md`, `Resources/continuita/START-NEXT-CHAT.md`, `SESSION_HANDOFF.md` e `SESSION_PROMPT.md` se presenti come fallback legacy

## 6. Ragionamento autonomo, esempi come pattern e no false completion

Status: PARZIALE
Orizzonte: breve + medio

Problema reale:

Quando l'utente fa esempi, l'AI non deve trattarli come legge chiusa. Deve partire da una priorita P0: intento reale prima del testo letterale, input utente come ipotesi e non verita' assoluta, esempi come pattern, decomposizione ricorsiva dell'argomento, visione 360/lungo termine, root cause/soluzione migliore, fonte/primitive/verifica, continuita' proattiva e truthful completion. Deve capire il principio, costruire un modello della situazione, trasformare argomento o esempio in albero dell'argomento con sottopunti e sotto-sottopunti, cercare altri casi analoghi, studiare il dominio, usare best practice del dominio e contestare richieste sbagliate. Deve anche prevedere problemi diretti e indiretti, evitare allucinazioni e non dichiarare fatto cio' che non ha verificato. Il punto centrale e' cercare il problema reale/root cause e la soluzione migliore verificabile, non fermarsi alla prima risposta plausibile o al primo workaround.

Stato attuale:

Le regole esistono in `AGENTS.md`, runtime brief e master spec. Il principio madre di ragionamento 360 e' ora esplicito come protocollo operativo: trigger, modello della situazione, gerarchia P0, output minimo, limiti, fonti corrette, internet/docs ufficiali quando servono, esempi come pattern, controllo dei problemi prevedibili e protocollo soluzione migliore. Manca ancora una verifica sistematica del comportamento reale nei task lunghi e multi-dominio.

Trigger operativo:

Prompt lunghi, vocali, densi o incompleti; esempi dell'utente; richieste di miglioramento generiche; task multi-file/multi-dominio; argomenti mutevoli o esterni; rischio di false completion.

Output atteso:

Modello della situazione, gerarchia P0 applicata, albero dell'argomento, requirement ledger, fonti usate o escluse, casi analoghi/correlati, problemi prevedibili, root cause/problema reale, alternative considerate, criterio della soluzione migliore, primitive scelte, verifiche fatte/non fatte, limiti residui e continuita' operativa.

Limiti / non-goals:

Non deve diventare frase motivazionale tipo "pensa meglio" e non deve promettere onniscienza, loop infinito, bypass di gate o completamento senza prove.

Primitive corrette:

- gerarchia P0 runtime
- runtime brief
- requirement ledger
- albero dell'argomento
- decomposizione ricorsiva in sottopunti e sotto-sottopunti
- modello della situazione
- protocollo soluzione migliore
- root cause analysis
- confronto alternative
- loop di completamento
- protocollo di chiusura proattiva
- Stop hook `stop-proactive-next-step.ps1` per reiniettare continuita' operativa alla chiusura
- audit di falsi completati
- code search
- agenti esplorativi quando disponibili e utili
- web/docs ufficiali quando la best practice cambia
- MCP/tool live quando serve stato reale

Ordine logico:

1. normalizzare intento reale prima del testo letterale
2. trattare input utente come ipotesi da verificare, non come verita' assoluta
3. estrarre requisito reale e principio dagli esempi
4. decomporre ricorsivamente argomento o esempio in albero dell'argomento
5. aprire sottopunti e sotto-sottopunti finche' il quadro e' operativo
6. per ogni ramo rivalutare fonte corretta, web/docs/MCP, skill/capability, rischi, verifiche e done criteria
7. generalizzare ai casi analoghi, correlati e indiretti
8. costruire il modello della situazione: obiettivo, contesto, assunzioni, fonti, verificato/non verificato
9. applicare visione 360/lungo termine su impatti, domini, manutenzione futura e failure mode
10. studiare dominio e best practice con repo, internet/docs ufficiali, MCP o tool live secondo fonte corretta
11. identificare root cause/problema reale prima del fix quando il task non e' banale
12. confrontare alternative ragionevoli e scegliere la soluzione migliore per rischio, manutenzione, testabilita' e coerenza sistema
13. prevedere problemi diretti e indiretti specifici dell'argomento
14. trasformare requisiti e rischi in ledger operativo
15. completare tutto il completabile nel turno corrente senza aspettare un nuovo prompt
16. chiudere con prove, continuita' operativa e domanda concreta solo se serve input utente

Sottopunti operativi:

- [ ] rendere obbligatorio il requirement ledger per prompt lunghi, vocali o densi
- [ ] applicare sempre la gerarchia P0 prima di piano, skill, edit o risposta finale
- [ ] trattare input utente come ipotesi da validare quando il task ha rischio, ambiguita' o impatti indiretti
- [ ] rendere esplicito il modello della situazione per task non banali: contesto, fonte, assunzioni, verificato, non verificato, correlazioni e rischi
- [ ] verificare che l'AI usi gli esempi come pattern e cerchi casi analoghi non citati
- [ ] decomporre ogni argomento non banale in albero dell'argomento con sottopunti e sotto-sottopunti
- [ ] per ogni ramo dell'albero rivalutare fonte, web/docs/MCP, skill/capability, rischi, verifiche e done criteria
- [ ] fermare la decomposizione solo quando il ramo e' irrilevante, gia' coperto o abbastanza piccolo da essere eseguito/verificato
- [ ] applicare visione lunga e 360 anche quando l'utente cita solo un esempio locale
- [ ] obbligare studio del dominio con internet/docs ufficiali/MCP/tool live quando il tema non e' interno, stabile o gia' verificato
- [ ] obbligare ricerca root cause/problema reale prima del fix su task non banali
- [ ] obbligare confronto alternative quando esistono piu' soluzioni plausibili
- [ ] impedire workaround superficiali quando esiste una soluzione migliore raggiungibile nel perimetro
- [ ] prevedere problemi diretti e indiretti dello specifico argomento prima di dichiarare il task completo
- [ ] completare nel turno corrente tutto cio' che non richiede nuova conferma o rischio aggiuntivo
- [ ] chiudere ogni risposta operativa con il prossimo passo concreto, un blocco reale o una domanda specifica
- [ ] evitare chiusure passive tipo "fammi sapere" quando esiste un'azione successiva ragionevole
- [x] aggiungere `Stop` hook advisory `stop-proactive-next-step.ps1` per rendere non dimenticabile la continuita' di chiusura
- [ ] introdurre audit o checklist finale contro falsi completati
- [ ] rafforzare il loop Codex: ogni iterazione deve chiedersi se tutto e' completo su file diretti e indiretti
- [ ] far emergere in modo esplicito quando manca una skill/regola/memoria/audit e proporre di crearla
- [ ] impedire esecuzione cieca di ipotesi utente tecnicamente rischiose

Criterio done:

- l'utente non deve elencare ogni sottocaso per ottenere lavoro completo
- l'AI non prende l'input utente come verita' assoluta e non limita il ragionamento agli esempi ricevuti
- l'AI apre argomenti ed esempi in albero dell'argomento e non chiude finche' i rami rilevanti non sono coperti, esclusi o tracciati
- la gerarchia P0 resta visibile nel runtime brief e nel routing hook prima di ogni task non banale
- l'AI sa dichiarare il modello della situazione e i limiti residui invece di fingere controllo totale
- la soluzione scelta e' motivata rispetto a root cause, alternative, best practice, rischio e coerenza del sistema
- ogni chiusura lascia continuita' operativa: prossimo passo autonomo eseguito, prossimo passo da fare o domanda concreta se serve input
- ogni task lungo conserva requisiti, esclusioni, prove e limiti residui
- nessuna verifica viene dichiarata se non e' stata eseguita o motivatamente esclusa

Verifiche richieste:

- `npm run audit:ledger`
- test con prompt denso contenente esempi incompleti
- review manuale di un loop Codex completo

## 7. n8n, agenti e automazioni AI-globali

Status: PARZIALE
Orizzonte: medio + lungo

Problema reale:

Alcuni passaggi devono diventare automazioni durevoli, ma non tutto appartiene a n8n. Se un workflow assorbe logica che dovrebbe essere una skill, un hook o un audit, il sistema diventa fragile.

Stato attuale:

L'abilitante tecnico e' pronto: `n8n-mcp` e' connesso (`claude mcp list` → `✓ Connected`) e l'inventario workflow esiste in `n8n-workflows/` (~20 workflow versionati come JSON; conteggio reale da `n8n-workflows/*.json` + istanza n8n live, non hardcodato qui per evitare drift). Restano aperti i 6 sotto-punti di governance: boundary n8n/skill/hook/script, trigger/input/output/owner/failure mode per workflow, scelta agente verticale vs skill/workflow, human-in-the-loop nei punti ad alto rischio, governo di giorni/orari/condizioni di avvio e trasferibilita' con setup/env validation/runbook. La governance reale su quali automazioni AI-globali devono vivere in n8n, quali in skill, quali in hook e quali in script non e' ancora formalizzata.

Trigger operativo:

Quando un'azione AI diventa ricorrente, deve essere eseguita da altri, richiede scheduling, stato persistente, human-in-the-loop o integrazione tra piu' sistemi.

Output atteso:

Boundary chiaro tra workflow n8n, skill, hook, script, MCP, plugin, agente e intervento umano, con input/output/failure mode per ogni automazione AI globale.

Limiti / non-goals:

Non deve spostare in n8n logica che appartiene a skill, hook o audit e non deve mescolare automazioni AI-globali con workflow applicativi LinkedIn.

Primitive corrette:

- workflow n8n
- agenti verticali
- skill
- hook ingresso/uscita
- audit
- memoria durevole
- runbook

Ordine logico:

1. inventariare automazioni AI-globali esistenti e desiderate
2. decidere boundary tra n8n, skill, hook, script, MCP, plugin e umano
3. rendere vivi solo i workflow con valore durevole
4. aggiungere health check, setup e runbook
5. auditare drift e duplicati

Sottopunti operativi:

- [ ] distinguere workflow AI-globali da workflow applicativi LinkedIn
- [ ] definire trigger, input, output, stato, owner e failure mode per ogni workflow AI
- [ ] decidere quando un agente verticale e' migliore di una skill o di un workflow
- [ ] aggiungere human-in-the-loop nei punti strutturali o ad alto rischio
- [ ] governare giorni, orari e condizioni di avvio come decisione esplicita, non calendario cieco
- [ ] rendere i workflow trasferibili ad altri con setup, env validation e runbook

Criterio done:

- ogni automazione ha sede corretta e motivo esplicito
- n8n non contiene logica che appartiene a hook/skill/audit
- i workflow AI-globali sono deployabili, trasferibili e verificabili

Verifiche richieste:

- audit manuale workflow
- eventuale `npm run audit:routing`
- prova di import/deploy su istanza reale solo quando il workflow e' pronto

## 8. Parita' ambienti: Claude Code, Codex, Cloud Code e altri

Status: PARZIALE — sottopunti operativi CHIUSI e verificati (`audit:codex-hook-parity` 3/3, `audit:codex-hook-smoke` 13/13). Gap residui STRUTTURALI dichiarati non normalizzati: GAP-3 PreCompact opaco, Cloud Code non coperto, switch modello/provider manuale (no router locale in Codex). Resta 1 verifica end-to-end in sessione Codex reale (passo utente).
Orizzonte: medio

Problema reale:

Cambiare ambiente non deve cambiare metodo di lavoro. Se Codex, Claude Code o Cloud Code non hanno gli stessi hook, memoria, MCP o gate, il sistema deve saperlo e adattarsi, non fingere parity.

Stato attuale:

`AGENTS.md` e capability matrix documentano parte della distinzione. Manca verifica comparativa reale e una policy viva sulla migrazione progressiva verso Codex.

Trigger operativo:

Quando si cambia ambiente o modello, quando un task richiede tool non disponibili ovunque, quando si vuole spostare lavoro a Codex/Claude/Cloud Code o quando un gate funziona in un ambiente ma non in un altro.

Output atteso:

Matrice ambiente -> capability -> garanzia reale, con fallback, gap, limiti e decisione su dove eseguire il task.

Limiti / non-goals:

Non deve fingere parity tra ambienti e non deve normalizzare workaround fragili come se fossero equivalenti a enforcement reale.

Primitive corrette:

- capability matrix
- canonici condivisi
- fallback espliciti
- audit parity
- test comparativi
- policy modello/provider

Ordine logico:

1. mappare capability reali per ambiente
2. distinguere nativo, workaround e gap non risolto
3. definire fallback che mantengono lo standard
4. testare task comparativi reali
5. migrare verso Codex solo dove non si perdono garanzie

Stato attuale (2026-06-01): chiuso il grosso del gap Claude Code <-> Codex. Creata `docs/PARITY_MATRIX.md` (matrice ambiente x capability x garanzia + 5 GAP critici documentati + matrice decisionale task->ambiente). Estesi/creati hook Codex: `codex-runtime-context.ps1` (ora inietta P0 + DIPENDENTE + SPINGITI OLTRE + memoria + routing + parity awareness), `codex-edit-gate.ps1` (PreToolUse Edit: anti-ban + secrets + best-practice, chiude GAP-2), `codex-post-edit.ps1` (PostToolUse Edit: size + hygiene + verify L2-L7, chiude GAP-4), `codex-stop-check.ps1` (ora fa sync Obsidian + proactive-next-step, chiude GAP-5). Audit `audit:codex-hook-parity` rafforzato con `checkCodexCapabilityCoverage` che verifica copertura reale (non solo eventi minimi). Cloud Code resta non coperto (gap tracciato).

Sottopunti operativi:

- [x] aggiornare matrice ambiente -> capability -> garanzia reale — `docs/PARITY_MATRIX.md` (2026-06-01)
- [x] verificare memoria, hook, runtime brief, skill, MCP, plugin, git gate e audit per ogni ambiente — matrice completa con stato per capability
- [x] documentare gap senza normalizzarli — 5 GAP critici espliciti in PARITY_MATRIX con impatto/mitigazione/gap residuo
- [x] stabilizzare problemi noti: settings, SessionStart, provider/model switching, visibilita' modelli — documentato in `PARITY_MATRIX.md` sezione "Model/provider switching Codex" (limite STRUTTURALE governato, non bug: Codex non ha router locale, switch manuale by design) + `codex-runtime-context.ps1` sezione CODEX_MODEL
- [x] definire quando usare Opus/Sonnet/Haiku/OpenRouter/Codex in base a rischio e costo — matrice decisionale task->ambiente + sezione model in codex-runtime-context
- [x] trasferire progressivamente lavoro a Codex solo dove il controllo resta equivalente — matrice decisionale task->ambiente in `PARITY_MATRIX.md`; gate Codex provati reali (`audit:codex-hook-smoke` 13/13: anti-ban + secrets + git block effettivi); Linkedin-touch resta Claude Code-only

Criterio done:

- il sistema sceglie ambiente e modello come decisione tecnica, non come abitudine
- nessuna regola critica vive in un solo ambiente senza gap tracciato
- i fallback sono chiari prima di iniziare il task

Verifiche richieste:

- review capability matrix — `docs/PARITY_MATRIX.md` (aggiornata 2026-06-04: GAP-2/4/5 chiusi, GAP-1/3 mitigati con residuo dichiarato)
- smoke task comparativi — `npm run audit:codex-hook-smoke` (13/13, `.codex/smoke-test-hooks.ps1` esercita ogni hook con input simulato e verifica la decisione reale) — CREATO e verde 2026-06-04. Resta la verifica end-to-end in sessione Codex reale (passo utente: aprire Codex, edit LinkedIn-touch, osservare block)
- `npm run audit:codex-hook-parity` (3/3) + `npm run audit:ai-reasoning-hardening` (7/7)
- `npm run audit:ai-control-plane`

## 9. Strumenti personali, dettatura e prompt improvement

Status: PARZIALE
Orizzonte: medio

Problema reale:

Input vocali sporchi, problemi del computer e scelta modello/prompt non devono generare lavoro AI incompleto o frainteso. Il sistema deve supportare il modo reale in cui l'utente lavora.

Stato attuale:

Whisper/dettatura locale e prompt helper esistono come direzione. La stabilita' hardware e il trade-off locale/cloud non sono ancora chiusi.

Trigger operativo:

Prompt vocali sporchi, trascrizione ambigua, problemi macchina, lentezza, tool locale instabile o richiesta che beneficia di prompt/model improvement.

Output atteso:

Input pulito semanticamente, scelta locale/cloud motivata, procedura supporto chiara, modello/prompt migliore quando serve e problemi hardware tracciati.

Limiti / non-goals:

Non deve correggere il dettato cambiando l'intento reale e non deve trattare problemi hardware o di input come colpa dell'utente.

Primitive corrette:

- tool locale
- skill prompt-improver
- checklist supporto
- documentazione operativa
- eventuale automazione locale

Ordine logico:

1. distinguere problema hardware, dettatura, prompt e modello
2. stabilizzare input vocale o definire fallback
3. usare prompt improvement per dettato sporco
4. collegare scelta modello/ambiente al prompt reale
5. documentare procedure ricorrenti

Sottopunti operativi:

- [ ] rendere il tool Whisper/dettatura abbastanza stabile per uso quotidiano
- [ ] decidere trade-off locale vs cloud per trascrizione
- [ ] tracciare e risolvere colli di bottiglia del computer
- [ ] mantenere procedura supporto locale, inclusa gestione alimentatore se rilevante
- [ ] usare prompt helper quando il dettato vocale e' semanticamente denso o sporco
- [ ] proporre modello e prompt migliore quando il task lo richiede

Criterio done:

- l'input vocale non obbliga l'utente a ripetere manualmente tutto
- problemi ricorrenti della macchina hanno tracciamento e soluzione
- prompt e modello vengono migliorati senza perdere intento reale

Verifiche richieste:

- prova pratica di dettatura su prompt lungo
- review manuale di prompt riscritto
- controllo todos/worklog per problemi hardware ancora aperti

## 10. Git, review e chiusura corretta dei blocchi AI

Status: CHIUSO (sottopunti operativi) — auto-commit/push policy, distinzione review locale/branch/audit, fallback fuori Claude Code ed enforcement no-completion cross-ambiente (Claude + Codex) presenti, provati e verificati 2026-06-04. Resta pratica continua, non lavoro residuo.
Orizzonte: breve + medio

Problema reale:

Un blocco AI non e' chiuso solo perche' i file sono stati modificati. Deve avere verifiche verdi, worklog aggiornato, stato git valutato e decisione chiara su commit, push o PR.

Stato attuale:

Esistono gate quality, gate git, `audit:git-automation`, policy commit/push e skill git. Aggiornamento 2026-06-04: distinzione review locale/branch/audit periodico ora documentata in `git-commit-push.md`; fallback fuori Claude Code provato (gate Codex `codex-bash-gate` blocca commit/push senza audit, verificato da `audit:codex-hook-smoke`); enforcement no-completion-con-git-dirty presente in entrambi gli ambienti (`pre-stop-commit-gate.ps1` Claude, `codex-stop-check.ps1` Codex).

Trigger operativo:

Fine di unita' logica verificata, working tree dirty dopo modifiche AI, richiesta di commit/push/PR, o blocco che non puo' essere dichiarato chiuso senza decisione git.

Output atteso:

Gate verdi o blocker esplicito, worklog/todos aggiornati se serve, stato git classificato e decisione motivata su commit, push, PR o stop.

Limiti / non-goals:

Non deve fare commit/push ciechi, non deve mischiare modifiche non correlate e non deve dichiarare completato un blocco con stato git non valutato.

Primitive corrette:

- git hooks
- `audit:git-automation`
- skill `git-commit`
- skill `git-create-pr`
- review locale/branch
- worklog

Ordine logico:

1. completare unita' logica
2. eseguire gate qualita'
3. aggiornare worklog/todos
4. auditare stato git
5. commit se pronto
6. push/PR solo se policy e rischio lo consentono

Sottopunti operativi:

- [x] verificare auto-commit come chiusura naturale solo dopo gate verdi — regola `.claude/rules/git-commit-push.md` "Auto-commit by default" + enforcement `pre-bash-l1-gate.ps1`; `audit:git-automation` classifica READY/REVIEW/BLOCKED (provato 2026-06-04: commit READY)
- [x] chiarire meglio quando push deve fermarsi per review, remote policy o rischio — `git-commit-push.md` "No auto-push se..." + "Precondizioni che ROMPONO il trigger"; provato 2026-06-04 (push BLOCKED per working tree dirty)
- [x] distinguere review locale, review di branch e audit periodico — nuova sezione "Livelli di review: locale / branch / audit periodico" in `git-commit-push.md` (tabella scope/quando/primitive)
- [x] estendere o documentare fallback fuori Claude Code — `git-commit-push.md` sezione "Fallback per ambienti senza hook PowerShell" + gate Codex reali (`codex-bash-gate` git block, provato `audit:codex-hook-smoke`)
- [x] impedire dichiarazioni di completamento se commit/push/PR richiesti restano non valutati — enforcement cross-ambiente: Claude `pre-stop-commit-gate.ps1` (working tree dirty → reinietta al turno successivo), Codex `codex-stop-check.ps1` (working-tree check, provato smoke)

Criterio done:

- l'utente non deve ricordare "committa" dopo un blocco verificato
- se push non avviene, il motivo e il prossimo passo sono espliciti
- review e git closure seguono rischio reale e stato repository

Verifiche richieste:

- `npm run post-modifiche`
- `npm run audit:git-automation`
- `git status --short --untracked-files=all`

## 11. Orizzonti temporali, manutenzione e cadenze periodiche

Status: PARZIALE
Orizzonte: breve + medio + lungo

Problema reale:

Senza orizzonte temporale, il backlog diventa una discarica: obblighi immediati finiscono nel medio/lungo termine, mentre task periodici restano promemoria manuali.

Stato attuale:

La regola esiste nei canonici. Bundle `audit:weekly` e `audit:monthly` definiti in `package.json` (2026-05-14) con doc operativo in `docs/tracking/AI_AUDIT_CADENCES.md`. Schedulazione Windows Task Scheduler documentata ma ancora da configurare lato utente. Classificazione temporale obbligatoria su task non banali resta aperta.

Trigger operativo:

Ogni task non banale, ogni follow-up emerso da audit, ogni ricorrenza di manutenzione e ogni punto che rischia di essere rinviato senza owner.

Output atteso:

Classificazione breve/medio/lungo, contenitore canonico, owner logico, cadenza o prossimo passo esplicito.

Limiti / non-goals:

Non deve usare medio/lungo termine per rinviare obblighi del breve termine e non deve creare backlog senza manutenzione reale.

Primitive corrette:

- todos
- worklog
- audit periodici
- workflow schedulati
- runtime brief
- canonici

Ordine logico:

1. classificare ogni task in breve/medio/lungo
2. separare cio' che va fatto ora da follow-up e manutenzione
3. assegnare sede canonica e owner logico
4. promuovere ricorrenze stabili ad audit o workflow
5. verificare che il backlog non nasconda obblighi immediati

Sottopunti operativi:

- [ ] rendere la classificazione temporale obbligatoria nei task non banali
- [x] definire cadenze minime per memoria, docs, cleanup, capability audit, security review e automazioni — `docs/tracking/AI_AUDIT_CADENCES.md` (2026-05-14): weekly bundle + monthly bundle
- [ ] dare owner logico e contenitore canonico a ogni follow-up
- [x] trasformare ricorrenze utili in audit/script/workflow schedulati — npm scripts `audit:weekly` (miss-metrics + handoff-staleness + violations) e `audit:monthly` (ai-control-plane + adk + rule-enforcement + ledger + skills); schedulazione Windows Task Scheduler documentata
- [ ] auditare backlog per trovare obblighi brevi parcheggiati impropriamente

Criterio done:

- ogni punto aperto ha orizzonte, sede e motivo
- manutenzione periodica non dipende dalla memoria dell'utente
- lavoro corrente e backlog futuro non si confondono

Verifiche richieste:

- review `todos/active.md`
- review `ENGINEERING_WORKLOG.md`
- audit periodico da definire per cadenze

## 12. Cleanup AI-readable, documenti canonici, bootstrap e riuso

Status: PARZIALE
Orizzonte: medio + lungo

Problema reale:

File lunghi, documenti duplicati e root caotica peggiorano il comportamento dell'AI. Se il sistema deve essere riusato in altri progetti o consegnato ad altri, non puo' dipendere da conoscenza implicita.

Stato attuale:

Esistono style guide AI-readable, checklist bootstrap e documenti canonici. Manca una revisione sistematica di monoliti, duplicati, documenti storici, pacchetto di handoff riusabile e pacchetto ADK installabile con manifest/versione per allineare team e nuovi progetti.

Trigger operativo:

File troppo lunghi, documenti duplicati, root caotica, nuovo progetto, passaggio ad altre persone/team, pluginizzazione o drift tra canonici.

Output atteso:

Documenti classificati, duplicati ridotti, indici allineati, bootstrap riusabile e pacchetto ADK/plugin installabile con manifest e confini globali/progetto.

Limiti / non-goals:

Non deve fare pulizia invasiva senza classificazione e non deve creare nuovi documenti se uno canonico esistente puo' essere aggiornato.
La pulizia continua post-edit e' obbligatoria come valutazione, non come cancellazione automatica: ogni modifica deve chiedersi se ha creato duplicati, file obsoleti o incoerenze dirette/indirette.

Primitive corrette:

- docs style guide
- audit architetturale/documentale
- cleanup guidato
- bootstrap checklist
- template handoff
- docs index
- plugin packaging
- `plugin.json`
- manifest/versione/provenance
- marketplace o team install

Ordine logico:

1. classificare documenti canonici, operativi, storici e tracking
2. ridurre duplicati e monoliti AI-unfriendly
3. decidere cosa e' globale, cosa e' progetto-specifico e cosa va distribuito come plugin
4. aggiornare indici e cross-link
5. creare pacchetto bootstrap/riuso e ADK installabile
6. testare trasferibilita' fuori da questa repo

Sottopunti operativi:

- [ ] riesaminare file troppo lunghi o con responsabilita' miste e decidere split concreti
- [ ] applicare a ogni modifica il controllo codebase hygiene: file diretto giusto, file indiretti coerenti, duplicati/obsoleti rilevati, cleanup sicuro o follow-up tracciato
- [ ] separare documenti storici, operativi, canonici e tracking
- [ ] mantenere `docs/README.md` allineato ai documenti importanti
- [ ] pulire root e cartelle solo dopo classificazione esplicita
- [ ] mantenere AI-readable i file canonici con summary, non-goals, cross-link e limiti
- [ ] mantenere `NEW_PROJECT_BOOTSTRAP_CHECKLIST.md` allineata al sistema reale
- [ ] creare pacchetto handoff riusabile per altri progetti o persone
- [ ] creare pacchetto ADK riusabile con regole/memoria, skill, hook, subagent, comandi e manifest di plugin
- [ ] definire schema minimo di `plugin.json`: nome, versione, contenuti inclusi, hook installati, skill incluse, subagent inclusi, provenance, compatibilita' ambiente e strategia update
- [ ] decidere cosa resta globale, cosa resta progetto-specifico e cosa va nel plugin installabile per evitare copie divergenti
- [ ] adottare struttura canonica `.claude/` (reference da community 2026): `hooks/`, `commands/`, `skills/`, `agents/`, `output-styles/`, `plugins/`, `rules/`, `statusline`, `settings.json`, `settings.local.json` — verificare gap rispetto a quanto presente
- [ ] introdurre `.claude/output-styles/` per response format predefiniti (terse, code-only) — utile anche per gestire override Caveman ultra in italiano
- [ ] aggiungere `CLAUDE.local.md` (gitignored) per override personali utente senza inquinare il repo condiviso
- [ ] mantenere `CLAUDE.md` di progetto sotto ~200 righe come convention community (attualmente 161)

Criterio done:

- una nuova sessione capisce dove trovare ogni cosa e perche'
- i documenti non dicono la stessa cosa in posti diversi con nomi diversi
- un nuovo progetto puo' partire con baseline AI senza conoscenza implicita
- un team puo' installare lo stesso pacchetto versionato senza ricostruire a mano regole, skill, hook e agenti

Verifiche richieste:

- review `docs/README.md`
- audit documentale/manuale dei canonici
- prova bootstrap su progetto di test o checklist simulata
- review del manifest/plugin package
- simulazione di installazione in progetto vuoto

## 13. Autonomia, metriche e sistema che migliora se stesso

Status: PARZIALE
Orizzonte: medio + lungo

Problema reale:

Il sistema non deve aspettare che l'utente ripeta sempre le stesse correzioni. Deve misurare omissioni, falsi completati, scelta errata di primitive e gap di capability, poi proporre o costruire la correzione strutturale corretta.

Stato attuale:

Esistono audit e violation log; audit `audit:miss-metrics` (2026-05-13) legge 15 stream di log e distingue **activations** (ogni hit del hook) da **miss veri** (linee con BLOCK/violation/dirty). Refinement 2026-05-14: aggiunto `missPattern` regex per ogni regola; risultato attuale = 0 candidate forti per promozione blocking. Gli advisory hook restano a 0 miss/7d nonostante activations alte (per i conteggi correnti vedi l'output live di `npm run audit:miss-metrics`, non riportati inline qui per evitare drift). Lezione operativa: NON promuovere a blocking sulla base di activations alte se miss veri assenti. Manca ancora collegamento miss -> root cause -> primitive correttiva automatica e un sistema maturo che propone azioni concrete.

Trigger operativo:

Quando l'utente ripete una correzione, quando gli audit trovano lo stesso problema, quando una capability manca, quando una false completion si ripete o quando un tool/regola non viene mai usato.

Output atteso:

Metriche di miss, root cause, primitive correttiva, verifica dell'effetto e rimozione o riduzione di regole/tool inutili.

Limiti / non-goals:

Non deve accumulare automazioni per ansia di completezza e non deve chiamare "autonomia" una serie di decisioni non misurate.

Primitive corrette:

- metriche compliance
- violation log
- audit
- hook
- skill governance
- workflow periodici
- worklog decisionale

Ordine logico:

1. raccogliere miss reali
2. classificarli per root cause
3. decidere primitive corretta
4. implementare correzione minima robusta
5. misurare se il miss sparisce
6. rimuovere o ridurre primitive inutili

Sottopunti operativi:

- [x] misurare omissioni, errori di routing e falsi completati come segnali sistemici — `audit:miss-metrics` (2026-05-13) legge 15 stream `~/memory/*-log.txt` e produce hit count, trend, raccomandazione promozione
- [ ] convertire miss ricorrenti nel livello corretto di automazione o enforcement — i candidati vanno letti dall'output corrente di `npm run audit:miss-metrics` (colonna "Miss 7d" >= soglia 5), non da conteggi inline che diventano stantii; al run del 2026-06-05 nessun advisory supera la soglia (miss 7d = 0 su proactive-next-step / codebase-hygiene / best-practice / skill-precheck)
- [ ] far riconoscere automaticamente quando manca la primitive giusta e proporre creazione con conferma utente
- [ ] collegare autonomia, orizzonti temporali, capability governance e truthful completion in metriche verificabili
- [ ] evitare accumulo di regole o tool che non vengono usati o non risolvono miss reali
- [x] definire audit di salute architetturale/documentale del sistema AI — `audit:ai-control-plane` esteso (2026-06-01) con `docs-size` + `skill-duplicates` + `memory-staleness`: un comando dà struttura+regole+hook+memoria+igiene. Audit di salute fatto a mano in sessione promosso a bundle ripetibile (zero-F).

Criterio done:

- l'utente non fa da memoria esterna o project manager tecnico
- errori ricorrenti producono miglioramento strutturale misurabile
- autonomia significa auto-orchestrazione verificabile, non improvvisazione

Verifiche richieste:

- `npm run audit:violations`
- `npm run audit:rule-enforcement`
- audit periodico metriche autonomia da definire

---

## Ordine corretto di chiusura

Per non automatizzare caos, l'ordine logico e':

1. completezza lista AI e separazione scope
2. routing fonte/modello/ambiente/strumenti
3. governance capability
4. enforcement regole e L2-L6 dove giustificato
5. memoria, handoff e trasferimento nuova chat
6. ragionamento autonomo, loop e no false completion
7. n8n/agenti/automazioni AI-globali
8. parity ambienti e strumenti personali
9. git/review/chiusura tecnica
10. cadenze periodiche, cleanup, bootstrap, riuso e metriche autonomia

## Backlog specialistici che devono restare allineati ma fuori scope qui

- `todos/active.md` = priorita' correnti del momento
- `todos/workflow-architecture-hardening.md` = dettaglio tecnico runtime/bot
- `docs/LINKEDIN_IMPLEMENTATION_LIST.md` = vista lineare LinkedIn-specifica
- `docs/tracking/ENGINEERING_WORKLOG.md` = storico delle analisi e verifiche reali

Regola finale:

se un punto AI globale rilevante esiste in uno di questi file ma non esiste qui, questo backlog madre non e' ancora abbastanza completo. Se invece il punto e' applicativo LinkedIn, deve restare fuori da questo documento.
