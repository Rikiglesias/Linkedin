# AI Implementation List — Global

Questa e' la vista lineare dettagliata dei punti aperti del sistema AI globale.

Fonte madre: `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md`.

Scope: solo sistema AI globale. Non include backlog applicativo LinkedIn, runtime bot, proxy, dashboard, staging account reali o anti-ban operativo del bot.

Regola: se una voce aperta non ha problema, stato, trigger, output, limiti, primitive, ordine, sottopunti, done e verifiche, la voce e' incompleta. Se una voce e' completata, deve stare in `## Completati`, non in `## Aperti`.

---

## Aperti

### 1. `[Lista AI][breve]` Completezza lista AI e separazione scope

Problema: la lista AI e' stata mescolata con backlog applicativi LinkedIn, rendendo difficile capire cosa va implementato sul sistema AI globale.

Stato: tutti i 5 sottopunti coperti dagli audit verdi (`audit:ai-list-completeness` 10/10 al 2026-05-13). Il punto resta aperto come manutentivo: ogni nuovo item AI va aggiunto qui, non in backlog applicativi LinkedIn.

Trigger: aggiunta, chiusura o spostamento di punti AI; passaggio contesto a nuova chat; rischio di mescolare AI globale e backlog LinkedIn.

Output: lista AI-only con fonte madre, vista derivata e audit di regressione.

Limiti: non e' backlog applicativo LinkedIn e non e' raccolta generica di idee.

Primitive: documento canonico, vista lineare derivata, audit `audit:ai-list-completeness`, worklog, todos.

Ordine: separare scope -> uniformare punti -> aggiungere audit -> aggiornare todos/worklog.

Sottopunti:

- [x] impedire che runtime bot, proxy, JA3, dashboard, staging account e anti-ban applicativo entrino nella lista AI
- [x] mantenere `AI_MASTER_IMPLEMENTATION_BACKLOG.md` come fonte madre del mancante AI
- [x] mantenere `AI_IMPLEMENTATION_LIST_GLOBAL.md` come vista lineare derivata, non seconda autorita'
- [x] fallire audit se un punto aperto non ha campi operativi minimi
- [x] trattare meccanismo presente ma non testato come aperto, non completato

Done: una nuova chat capisce tutto il backlog AI globale senza chiedere "cosa intendi?", e i punti LinkedIn-specifici restano fuori scope.

Verifiche: `npm run audit:ai-list-completeness`, `npm run audit:ai-control-plane`, review manuale delle due liste AI.

### 2. `[Orchestrator][breve/medio]` Orchestrator Layer e selezione autonoma di fonte, modello, ambiente e strumenti

Problema: l'utente non puo' specificare ogni volta best practice, fonte corretta, modello, skill, MCP, plugin o web/docs. Serve un Orchestrator Layer che decida come lavorare prima dell'esecuzione.

Stato: runtime brief, registry e hook advisory esistono; manca un contratto unico cross-ambiente dell'Orchestrator Layer e una misura sistematica dei miss. Il miss reale emerso e' che una skill non installata localmente puo' essere trattata come inesistente se non parte la discovery esterna.

Trigger: ogni task non banale, task con dato instabile, provider/API/libreria, ambiente o capability specifica.

Output: decisione coerente su input normalizzato, task class, fonte, modello, ambiente, skill, MCP, plugin, hook, script/audit, subagent, web/docs, loop, handoff e verifiche.

Limiti: niente rumore su task banali; niente hook bloccanti se il segnale non e' deterministico.

Primitive: runtime brief, `AI_CAPABILITY_ROUTING.json`, `AI_ADK_CAPABILITY_GOVERNANCE.json`, hook advisory/blocking dove deterministico, audit `audit:routing`, audit `audit:adk-capabilities`, skill-finder / capability finder, discovery esterna skill (`npx skills find`, `skills.sh`, repo ufficiali/affidabili), web/docs ufficiali, MCP, plugin, skill.

Ordine: normalizzare input -> classificare task -> interrogare registry/finder -> se manca locale cercare su web/cataloghi ufficiali -> scegliere fonte/modello/ambiente/capability/verifiche -> dichiarare esclusioni utili -> misurare miss -> promuovere primitive corrette.

Sottopunti:

- [ ] misurare miss di selezione strumento/modello/ambiente
- [ ] definire contratto unico dell'Orchestrator Layer: input, output, stato persistente, confini e failure mode
- [ ] distinguere fonte interna, docs ufficiali, web, MCP, plugin, skill, agente e workflow
- [ ] creare o integrare `skill-finder` / capability finder per skill locali, `gh skill search`, duplicati e migrazioni Codex/Claude
- [ ] obbligare discovery esterna quando la skill/capability manca localmente: `npx skills find`, `skills.sh`, repo ufficiali/affidabili, verifica install count/reputazione/compatibilita'
- [ ] usare web/docs quando il dato e' temporale, provider-specifico o soggetto a cambiamenti
- [ ] generalizzare esempi dell'utente in pattern e casi analoghi
- [ ] dichiarare scelta tecnica senza produrre rumore nei task banali

Done: task non banali passano da una decisione orchestrata, task instabili non partono senza fonte corretta, skill/capability assenti localmente non vengono dichiarate inesistenti senza ricerca web/cataloghi ufficiali e l'AI sa spiegare perche' usa o esclude ogni primitive rilevante.

Verifiche: `npm run audit:routing`, smoke prompt su almeno 5 domini, review violation log.

### 3. `[Capability][breve/medio]` Governance di skill, MCP, plugin, agenti e capability installate

Problema: accumulare capability senza routing chiaro crea confusione e fa scegliere strumenti sbagliati. Le immagini "Agent Development Kit" aggiungono un vincolo esplicito: il sistema AI va governato come stack a 5 layer, non come somma casuale di regole, skill e tool.

Stato: esistono registry machine-readable per routing, livelli L2-L9 e governance ADK. La collocazione corretta nei layer esiste per tutte le capability del routing; restano aperte qualita', overlap, conversione reale e candidate esterne.

Trigger: nuova capability, duplicati, candidate esterne nominate, conversione skill/MCP/plugin/hook/workflow, routing ambiguo.

Output: catalogo capability con layer ADK, trigger, limiti, overlap, decisione e stato candidate.

Limiti: niente installazioni cieche e niente accumulo di tool sovrapposti.

Primitive: `AI_CAPABILITY_ROUTING.json`, `AI_ADK_CAPABILITY_GOVERNANCE.json`, audit capability, skill governance, plugin governance, subagent governance, Agent Development Kit 5-layer architecture, plugin manifest / marketplace / team install, MCP registry, worklog decisionale.

Ordine: classificare layer corretto -> inventariare -> classificare trigger/limiti/overlap -> decidere keep/merge/remove/promote/demote -> aggiornare routing -> testare prompt reali.

Sottopunti:

- [x] consolidare inventario unico delle capability operative del control plane in `AI_ADK_CAPABILITY_GOVERNANCE.json`
- [x] formalizzare il modello Agent Development Kit a 5 layer: `CLAUDE.md`/`AGENTS.md` per regole e memoria, `SKILL.md` per conoscenza modulare, hook per guardrail deterministici, subagent per delega isolata, plugin per distribuzione
- [x] distinguere layer globale e layer progetto: cosa vive in `~/.claude/` per tutti i progetti e cosa vive nella repo per regole, skill, hook e contesto specifici
- [x] standardizzare struttura skill: `SKILL.md`, `scripts/`, `templates/`, `assets/`, contesto minimo e trigger descrittivo auto-invocabile
- [x] standardizzare subagent: un job per subagent, contesto proprio, strumenti/permessi propri, risultato unico di ritorno, nessun inquinamento del thread principale
- [x] standardizzare plugin: `plugin.json`/manifest, lista di skill/agenti/hook/comandi inclusi, versione, firma o provenance, installazione team/repo
- [x] decidere per ogni capability nel routing registry la primitive corretta: skill, MCP, plugin, hook, audit, script, workflow o fonte esterna
- [x] eliminare o fondere duplicati — `audit:skill-duplicates` (2026-05-14) ha scansionato 197 skill: solo 9 overlap nome (tutti legittimi: `<x>-generator`/`<x>-validator` paired, `audit` parent + `audit-rules` child, `react-expert`/`react-native-expert`). Nessun duplicato operativo da rimuovere. Volume alto (100 marketing, 66 web-frontend) viene dai marketplace community, non da installazioni manuali. 9 skill non classificate (debugging-wizard, json-canvas, launch-strategy, ecc.) restano legittime — solo non hanno keyword nel dictionary di dominio.
- [x] registrare Caveman, LeanCTX, SIMDex e Contact Skills come candidate `evaluate-before-install`, senza installazione cieca
- [x] registrare candidate esterne emergenti 2026-05-14: Google CodeWiki (Gemini-powered docs auto-generation, attendere extension privata), Ruflo (multi-agent orchestrator, alto rischio overlap), Understand-Anything (knowledge graph codebase, overlap da valutare con code-review-graph MCP)
- [ ] valutare davvero Caveman, LeanCTX, SIMDex, Contact Skills, Google CodeWiki, Ruflo e Understand-Anything prima di installarle
- [ ] definire routing per backend, frontend, docs, prompt, handoff, sicurezza, testing, review e automazioni
- [ ] creare regole di attivazione per capability simili
- [ ] chiedere conferma quando serve creare una nuova primitive durevole

Done: ogni capability ha dominio, trigger, limiti, stato, relazione con alternative e layer ADK corretto; le capability riusabili per team/progetti possono essere pacchettizzate come plugin versionato; l'AI sceglie la primitive corretta senza aspettare esempi dell'utente.

Verifiche: `npm run audit:routing`, `npm run audit:adk-capabilities`, `npm run audit:ai-list-completeness`, audit manuale inventario capability, review manuale di una skill, un hook, un subagent e un plugin/manifest, test prompt multi-dominio.

### 4. `[Enforcement][breve/medio/lungo]` Enforcement reale delle regole critiche

Problema: regole solo documentali vengono dimenticate, ma hook troppo generici creano falsi positivi.

Stato: hook, quality gate, git gate e audit esistono. `audit:hooks` ora copre 32 hook sempre attivi + 2 hook router condizionali (filtrati in modalita' Anthropic nativo) ed e' condition-aware su `ANTHROPIC_BASE_URL`. Verifica anche che l'auto-commit via trigger non bypassi gate con `git add .` o `--no-verify`. L2-L6 restano audit-assisted e non blocking completi. `post-edit-codebase-hygiene.ps1` reinietta il controllo pulizia su file diretti/indiretti dopo ogni edit.

Trigger: regola dimenticata piu' volte, drift audit-doc-hook, gate bypassabile o miss con segnale deterministico.

Output: mappa regola -> rischio -> segnale -> primitive corretta, con blocker solo dove robusto.

Limiti: niente hook generici che simulano ragionamento AI e niente blocker fragili.

Primitive: hook bloccanti solo deterministici, audit periodici, script, runtime brief, skill, violation log.

Ordine: mappare regola/rischio/segnale -> misurare miss -> implementare enforcement robusto -> verificare falsi positivi/negativi -> aggiornare canonici.

Sottopunti:

- [x] decidere quanti hook servono davvero oggi: 33 command hook attivi, nessun nuovo hook senza miss ricorrenti misurati o advisory ad alto valore
- [x] correggere l'hook di auto-commit su trigger per non bypassare gate git o native pre-commit
- [x] mantenere `audit:hooks` allineato a `~/.claude/settings.json` a ogni cambio configurazione — reso condition-aware su `ANTHROPIC_BASE_URL` (2026-05-13)
- [ ] promuovere L2-L6 a blocking solo dove il segnale e' verificabile
- [ ] coprire blast radius, contratti, dipendenze, test impattati e file diretti/indiretti
- [ ] coprire cross-domain per ogni file: sicurezza, architettura, performance, compliance, observability e rischio dominio
- [x] aggiungere hook advisory post-edit per codebase hygiene: file diretto corretto, file indiretti coerenti, duplicati/obsoleti/split/rename/delete/follow-up
- [x] impedire falsi completati quando esiste solo il meccanismo ma manca test reale — `audit:ai-list-completeness` fail su item senza prova end-to-end
- [x] trattare drift doc-hook-audit come bug operativo — fix router hook 2026-05-13 e' precedente esempio
- [x] introdurre `.claude/rules/` path-scoped: regole che si caricano automaticamente solo quando l'AI tocca un certo glob — scaffold creato (2026-05-13) con `browser-antiban.md`, `api-security.md`, `scripts-audit.md` e README. Manca ancora promozione automatica via hook che legge da qui

Done: ogni regola critica ha primitive, verifica e limite dichiarato; i blocker non si basano su interpretazioni fragili.

Verifiche: `npm run audit:hooks`, `npm run audit:rule-enforcement`, `npm run audit:l2-l6`, review violation log.

### 5. `[Memory][breve/medio]` Memoria, handoff e trasferimento contesto in nuova chat

Problema: handoff e memoria sono inutili se una nuova chat non riesce davvero a ripartire senza perdita di stato.

Stato: il metodo primario e' migrato a `~/memory` + `todos/active.md` + `.claude/CONTINUATION.md` sincronizzato in Obsidian `Resources/continuita` con `START-NEXT-CHAT.md`. `SESSION_HANDOFF.md`, skill `context-handoff` e `.claude/SESSION_PROMPT.md` restano fallback legacy/storico. Prima prova end-to-end reale passata in Codex il 2026-05-11 con prompt `resume`: la nuova sessione ha ricostruito contesto, blocchi e prossimi passi senza chiedere spiegazioni all'utente. Anti-staleness coperto da `audit:handoff-staleness`, ora centrato su continuita primaria, sync Obsidian, memoria e todos.

Trigger: fine sessione lunga, compact, cambio chat/ambiente, contesto degradato o richiesta di trasferire contesto.

Output: continuita nuova chat con stato, decisioni, blast radius, verifiche, blocchi, prossimi passi, git status e vista Obsidian `Resources/continuita/START-NEXT-CHAT.md`.

Limiti: non e' riassunto narrativo e non e' completato senza prova reale in nuova chat.

Primitive: `.claude/CONTINUATION.md`, Obsidian `Resources/continuita`, `START-NEXT-CHAT.md`, memory files, `todos/active.md`, `ENGINEERING_WORKLOG.md`, audit handoff/continuita, skill `context-handoff` solo come supporto, `SESSION_HANDOFF.md` e `SESSION_PROMPT.md` come fallback legacy.

Ordine: aggiornare memoria/todos/worklog -> compilare `.claude/CONTINUATION.md` senza TODO -> sincronizzare Obsidian `Resources/continuita` -> far leggere solo fonti previste alla nuova chat -> verificare ricostruzione -> correggere hook/sync/audit.

Sottopunti:

- [x] definire contenuto minimo non opzionale di `SESSION_HANDOFF.md` — ora fallback legacy
- [x] creare o standardizzare `.claude/SESSION_PROMPT.md` per nuova chat — ora fallback legacy
- [x] includere stato git, modifiche non committate, verifiche fatte e mancanti
- [x] includere blocchi aperti e prossimi passi ordinati
- [x] validare una nuova chat reale leggendo solo handoff + canonici indicati — prova Codex 2026-05-11
- [x] non marcare completato finche' anche il rischio staleness della continuita e' gestito — `audit:handoff-staleness`
- [x] proteggere continuita da staleness dopo nuovi commit o working tree cambiato — `src/scripts/handoffStalenessAudit.ts` verifica `.claude/CONTINUATION.md`, `Resources/continuita`, memoria e todos
- [x] migrare procedura primaria a Obsidian `Resources/continuita/START-NEXT-CHAT.md`, con `SESSION_HANDOFF.md` / `SESSION_PROMPT.md` solo fallback legacy

Done: una nuova chat riparte senza chiedere contesto all'utente e senza portarsi dietro blocker stale o punti generici.

Verifiche: prova manuale nuova chat (prima prova Codex 2026-05-11), `npm run audit:handoff-staleness`, `npm run audit:ai-control-plane`, review `.claude/CONTINUATION.md`, `Resources/continuita/START-NEXT-CHAT.md`, `SESSION_HANDOFF.md` e `.claude/SESSION_PROMPT.md` se presenti come fallback legacy.

### 6. `[Reasoning][breve/medio]` Ragionamento autonomo, esempi come pattern e no false completion

Problema: l'AI deve partire da una priorita P0: intento reale prima del testo letterale, input utente come ipotesi e non verita' assoluta, esempi come pattern, decomposizione ricorsiva dell'argomento, visione 360/lungo termine, root cause/soluzione migliore, fonte/primitive/verifica, continuita' proattiva e truthful completion. Deve capire il principio dietro gli esempi, trasformare esempio o argomento in albero dell'argomento con sottopunti e sotto-sottopunti, costruire un modello della situazione, studiare il dominio, applicarlo ai casi analoghi/correlati, prevedere problemi diretti e indiretti, evitare allucinazioni e non dichiarare verifiche non fatte. Deve cercare il problema reale/root cause e la soluzione migliore verificabile, non fermarsi alla prima risposta plausibile o al primo workaround.

Stato: regole presenti in `AGENTS.md`, runtime brief e master spec; il principio madre di ragionamento 360 e' esplicito come protocollo operativo con trigger, gerarchia P0, modello della situazione, output minimo, protocollo soluzione migliore e limiti. 12/22 sub-task ora enforced via hook (P0 reinietta, esempi come pattern, decomposizione ricorsiva, web/docs required, Stop proattivo, audit falsi completati, loop-codex, anti-compiacenza). I 10 residui restano cognitive advisory: modello situazione esplicito, rami albero rivalutati, casi analoghi, visione 360, root cause, alternative, problemi prevedibili, completamento turno. Non meccanizzabili senza generare falsi positivi.

Trigger: prompt lungo/vocale/denso, esempio dell'utente, richiesta generica di miglioramento, task multi-file/multi-dominio, tema esterno o rischio false completion.

Output: gerarchia P0 applicata, modello della situazione, albero dell'argomento, ledger, fonti usate o escluse, casi analoghi/correlati, problemi prevedibili, root cause/problema reale, alternative considerate, criterio della soluzione migliore, primitive scelte, verifiche fatte/non fatte, limiti residui e continuita' operativa.

Limiti: non significa onniscienza, loop infinito, bypass di gate o dichiarare completo senza prove.

Primitive: gerarchia P0 runtime, runtime brief, requirement ledger, albero dell'argomento, decomposizione ricorsiva in sottopunti e sotto-sottopunti, modello della situazione, protocollo soluzione migliore, protocollo di chiusura proattiva, Stop hook `stop-proactive-next-step.ps1`, root cause analysis, confronto alternative, loop di completamento, audit falsi completati, code search, agenti esplorativi, internet/docs ufficiali, MCP/tool live.

Ordine: normalizzare intento reale -> trattare input utente come ipotesi -> estrarre requisito -> usare esempi come pattern -> decomporre in albero dell'argomento -> aprire sottopunti e sotto-sottopunti -> per ogni ramo rivalutare fonte/web/docs/MCP/skill/capability/rischi/verifiche -> generalizzare -> costruire modello situazione -> applicare visione 360/lungo termine -> studiare dominio/fonte/best practice -> identificare root cause -> confrontare alternative -> scegliere soluzione migliore -> prevedere problemi diretti e indiretti -> mantenere ledger -> completare tutto il completabile nel turno corrente -> chiudere con prove e continuita' operativa.

Sottopunti:

- [ ] attivare requirement ledger su prompt lunghi, vocali o densi — regola e audit esistono, ma manca test comportamentale zero-trust su prompt reali recenti
- [ ] applicare sempre gerarchia P0 prima di piano, skill, edit o risposta finale — reiniezione runtime presente, ma resta comportamento cognitivo non blocking
- [ ] trattare input utente come ipotesi da validare quando il task ha rischio, ambiguita' o impatti indiretti — P0 + pre-edit esistono, ma non coprono ogni risposta/task non-edit
- [ ] rendere esplicito il modello della situazione per task non banali
- [ ] trattare esempi utente come pattern, non lista esaustiva — regola esplicita, ma non ancora prova comportamentale/audit dedicato
- [ ] decomporre ogni argomento non banale in albero dell'argomento con sottopunti e sotto-sottopunti — regola esplicita, ma non ancora enforcement o audit comportamentale
- [ ] per ogni ramo dell'albero rivalutare fonte, web/docs/MCP, skill/capability, rischi, verifiche e done criteria
- [ ] fermare la decomposizione solo quando il ramo e' irrilevante, gia' coperto o abbastanza piccolo da essere eseguito/verificato
- [ ] applicare visione lunga e 360 anche quando l'utente cita solo un esempio locale
- [ ] studiare dominio con internet/docs ufficiali/MCP/tool live quando il tema non e' interno, stabile o gia' verificato — hook/log esistono, ma serve regola best-practice esterna periodica e audit su casi reali
- [ ] cercare root cause/problema reale prima del fix su task non banali
- [ ] confrontare alternative quando esistono piu' soluzioni plausibili
- [ ] evitare workaround superficiali quando esiste una soluzione migliore raggiungibile
- [ ] prevedere problemi diretti e indiretti dello specifico argomento
- [ ] completare nel turno corrente tutto cio' che non richiede nuova conferma o rischio aggiuntivo
- [ ] chiudere ogni risposta operativa con il prossimo passo concreto, un blocco reale o una domanda specifica — hook advisory presente, ma non blocca semanticamente ogni finale
- [ ] evitare chiusure passive tipo "fammi sapere" quando esiste un'azione successiva ragionevole — coperto solo in modo advisory dallo Stop hook
- [x] aggiungere `Stop` hook advisory `stop-proactive-next-step.ps1` per rendere non dimenticabile la continuita' di chiusura
- [ ] introdurre checklist/audit finale contro falsi completati — esistono audit strutturali, manca audit comportamentale puntuale per ogni chiusura complessa
- [ ] rafforzare loop Codex sui file diretti e indiretti — skill/hook advisory presenti, ma non equivalgono a enforcement Codex nativo
- [ ] proporre creazione di skill/regola/memoria/audit quando manca la primitive giusta — regola presente, ma comportamento da misurare
- [ ] contestare ipotesi utente tecnicamente sbagliate prima di eseguirle — regola presente, ma non auditata su casi reali

Done: l'utente non deve elencare ogni sottocaso; l'AI non prende l'input utente come verita' assoluta e non limita il ragionamento agli esempi ricevuti; l'AI apre argomenti ed esempi in albero dell'argomento e non chiude finche' i rami rilevanti non sono coperti, esclusi o tracciati; la gerarchia P0 resta visibile nel runtime brief e nel routing hook prima di ogni task non banale; requisiti, esclusioni, modello della situazione, root cause, alternative, criterio della soluzione migliore, problemi prevedibili, prove, limiti e continuita' operativa restano espliciti fino alla chiusura.

Verifiche: `npm run audit:ledger`, test con prompt denso incompleto, review manuale di un loop completo.

### 7. `[Automation][medio/lungo]` n8n, agenti e automazioni AI-globali

Problema: non tutto deve diventare n8n; alcune cose sono skill, hook, audit, script o decisione umana.

Stato: workflow JSON e principi human-in-the-loop esistono, ma manca governance completa delle automazioni AI-globali.

Trigger: azione AI ricorrente, scheduling, stato persistente, integrazione multi-sistema, human-in-the-loop o distribuzione ad altri.

Output: boundary chiaro tra n8n, skill, hook, script, MCP, plugin, agente e umano.

Limiti: non spostare in n8n logica da skill/hook/audit; non mescolare con workflow applicativi LinkedIn.

Primitive: workflow n8n, agenti verticali, skill, hook, audit, memoria durevole, runbook.

Ordine: inventariare automazioni -> decidere boundary -> rendere vivi solo workflow utili -> aggiungere health/runbook -> auditare drift.

Sottopunti:

- [ ] distinguere workflow AI-globali da workflow applicativi LinkedIn
- [ ] definire trigger, input, output, stato, owner e failure mode
- [ ] decidere quando usare agente verticale invece di skill o workflow
- [ ] inserire human-in-the-loop nei punti strutturali o ad alto rischio
- [ ] governare giorni, orari e condizioni di avvio
- [ ] rendere workflow trasferibili con setup, env validation e runbook

Done: ogni automazione ha sede corretta, motivo esplicito, setup trasferibile e verifica.

Verifiche: audit manuale workflow, `npm run audit:routing`, prova import/deploy solo quando pronta.

### 8. `[Parity][medio]` Parita' ambienti: Claude Code, Codex, Cloud Code e altri

Problema: cambiare ambiente non deve far perdere memoria, hook, MCP, gate o metodo di lavoro.

Stato: capability matrix completa e aggiornata (`PARITY_MATRIX.md` 2026-06-04); gate Codex implementati, registrati e provati (`audit:codex-hook-smoke` 13/13). Gap residui strutturali dichiarati. Resta verifica end-to-end in Codex reale.

Trigger: cambio ambiente/modello, tool non disponibile ovunque, migrazione verso Codex/Claude/Cloud Code o gate non equivalente.

Output: matrice ambiente -> capability -> garanzia reale, fallback e gap dichiarati.

Limiti: non fingere parity e non trattare workaround fragili come enforcement.

Primitive: capability matrix, canonici condivisi, fallback espliciti, audit parity, test comparativi, policy modello/provider.

Ordine: mappare capability -> distinguere nativo/workaround/gap -> definire fallback -> testare -> migrare solo dove non si perde controllo.

Sottopunti:

- [x] aggiornare matrice ambiente -> capability -> garanzia reale — `docs/PARITY_MATRIX.md` (2026-06-01)
- [x] verificare memoria, hook, runtime brief, skill, MCP, plugin, git gate e audit per ogni ambiente — matrice completa con stato per capability
- [x] documentare gap senza normalizzarli — gap critici espliciti in `docs/PARITY_MATRIX.md`
- [x] stabilizzare settings, SessionStart, provider/model switching e visibilita' modelli — `PARITY_MATRIX.md` sezione "Model/provider switching Codex" (limite strutturale governato: switch manuale by design, no router locale in Codex)
- [x] definire uso corretto di Opus/Sonnet/Haiku/OpenRouter/Codex per rischio e costo — matrice decisionale task->ambiente + contesto runtime Codex
- [x] spostare lavoro a Codex solo dove le garanzie restano equivalenti — matrice decisionale + gate Codex provati (`audit:codex-hook-smoke` 13/13); Linkedin-touch resta Claude Code-only

Done: ambiente e modello sono scelti tecnicamente; nessuna regola critica vive in un solo ambiente senza gap tracciato. Gap residui strutturali (GAP-3 PreCompact, Cloud Code, switch manuale) dichiarati non normalizzati; resta verifica end-to-end in Codex reale (passo utente).

Verifiche: review capability matrix, `npm run audit:codex-hook-parity` (3/3), `npm run audit:codex-hook-smoke` (13/13), `npm run audit:ai-control-plane`.

### 9. `[Local tools][medio]` Strumenti personali, dettatura e prompt improvement

Problema: dettato vocale sporco, problemi PC o prompt non chiari non devono produrre esecuzione parziale o fraintesa.

Stato: Whisper/dettatura e prompt helper esistono come direzione; hardware e trade-off locale/cloud sono ancora aperti.

Trigger: dettato sporco, prompt ambiguo, problema PC, lentezza o task che richiede prompt/model improvement.

Output: input semanticamente pulito, modello/prompt migliore, trade-off locale/cloud e problemi macchina tracciati.

Limiti: non cambiare intento reale dell'utente e non normalizzare problemi locali ricorrenti.

Primitive: tool locale, skill prompt-improver, checklist supporto, documentazione operativa, automazione locale eventuale.

Ordine: distinguere hardware/dettatura/prompt/modello -> stabilizzare input -> usare prompt helper -> collegare modello al prompt -> documentare procedure.

Sottopunti:

- [ ] stabilizzare Whisper/dettatura per uso quotidiano
- [ ] decidere trade-off locale vs cloud per trascrizione
- [ ] tracciare e risolvere colli di bottiglia computer
- [ ] mantenere procedure supporto locale, inclusa gestione alimentatore se rilevante
- [ ] usare prompt helper su dettati lunghi o sporchi
- [ ] proporre modello e prompt migliore quando il task lo richiede

Done: input vocale e problemi locali non costringono l'utente a ripetere manualmente o correggere l'AI.

Verifiche: prova dettatura lunga, review prompt riscritto, controllo todos/worklog sui problemi hardware.

### 10. `[Git][breve/medio]` Git, review e chiusura corretta dei blocchi AI

Problema: modifiche AI non sono chiuse senza gate verdi, worklog, stato git e decisione su commit/push/PR.

Stato: sottopunti operativi chiusi e verificati 2026-06-04 — auto-commit/push policy, distinzione review locale/branch/audit, fallback Codex provato ed enforcement no-completion cross-ambiente. Resta pratica continua.

Trigger: fine unita' logica, working tree dirty dopo modifiche, richiesta commit/push/PR o blocco da dichiarare chiuso.

Output: gate verdi o blocker, worklog/todos aggiornati se serve, stato git classificato e decisione commit/push/PR/stop.

Limiti: niente commit/push ciechi e niente completamento con git non valutato.

Primitive: git hooks, `audit:git-automation`, skill `git-commit`, skill `git-create-pr`, review locale/branch, worklog.

Ordine: completare unita' -> gate qualita' -> aggiornare worklog/todos -> audit git -> commit -> push/PR se consentito.

Sottopunti:

- [x] verificare auto-commit dopo gate verdi come chiusura naturale — `git-commit-push.md` "Auto-commit by default" + `pre-bash-l1-gate.ps1`; `audit:git-automation` provato READY 2026-06-04
- [x] chiarire quando push deve fermarsi per review, remote policy o rischio — `git-commit-push.md` precondizioni cumulative + ROMPONO il trigger; provato push BLOCKED 2026-06-04
- [x] distinguere review locale, branch review e audit periodico — nuova sezione tabellare in `git-commit-push.md`
- [x] documentare fallback fuori Claude Code — `git-commit-push.md` "Fallback ambienti senza hook PowerShell" + gate Codex provato (`audit:codex-hook-smoke`)
- [x] impedire "completato" se commit/push/PR richiesti non sono valutati — enforcement cross-ambiente: `pre-stop-commit-gate.ps1` (Claude) + `codex-stop-check.ps1` (Codex, provato smoke)

Done: l'utente non deve ricordare commit/push; se il push non avviene, motivo e prossimo passo sono espliciti.

Verifiche: `npm run post-modifiche`, `npm run audit:git-automation`, `git status --short --untracked-files=all`.

### 11. `[Temporal][breve/medio/lungo]` Orizzonti temporali, manutenzione e cadenze periodiche

Problema: senza orizzonte temporale il backlog diventa una discarica e gli obblighi immediati vengono rinviati.

Stato: regole presenti nei canonici; bundle `audit:weekly` e `audit:monthly` definiti in `package.json` (2026-05-14) con doc operativo in `docs/tracking/AI_AUDIT_CADENCES.md`. Schedulazione Windows Task Scheduler documentata ma ancora da configurare lato utente.

Trigger: task non banale, follow-up da audit, manutenzione ricorrente o punto senza owner temporale.

Output: classificazione breve/medio/lungo, sede canonica, owner logico, cadenza o prossimo passo.

Limiti: non rinviare obblighi brevi nel medio/lungo termine.

Primitive: todos, worklog, audit periodici, workflow schedulati, runtime brief, canonici.

Ordine: classificare breve/medio/lungo -> separare ora/follow-up/manutenzione -> assegnare sede -> promuovere ricorrenze -> auditare backlog.

Sottopunti:

- [ ] rendere classificazione temporale obbligatoria nei task non banali — regola presente, ma non ancora meccanismo/audit sufficiente per chiusura zero-trust
- [x] definire cadenze per memoria, docs, cleanup, capability audit, security review e automazioni — `docs/tracking/AI_AUDIT_CADENCES.md` (2026-05-14) con bundle settimanale (miss-metrics + handoff-staleness + violations) e mensile (ai-control-plane + adk + rule-enforcement + ledger + skills)
- [ ] dare owner logico e contenitore canonico a ogni follow-up
- [x] trasformare ricorrenze utili in audit/script/workflow schedulati — npm scripts `audit:weekly` e `audit:monthly` definiti; schedulazione Windows Task Scheduler documentata (da configurare lato utente)
- [ ] trovare obblighi brevi parcheggiati impropriamente nel backlog

Done: ogni punto aperto ha orizzonte, sede e motivo; manutenzione periodica non dipende dalla memoria dell'utente.

Verifiche: review `todos/active.md`, review `ENGINEERING_WORKLOG.md`, audit cadenze da definire.

### 12. `[Docs][medio/lungo]` Cleanup AI-readable, documenti canonici, bootstrap e riuso

Problema: file lunghi, documenti duplicati e root caotica peggiorano il comportamento dell'AI e rendono difficile riusare il sistema. Se il sistema AI deve essere portato in nuovi progetti o dato ad altre persone, deve diventare un pacchetto ADK installabile e non una serie di file copiati a mano.

Stato: style guide e checklist bootstrap esistono; manca revisione sistematica di monoliti, duplicati, documenti storici, pacchetto riusabile e manifest di distribuzione per allineare team/progetti.

Trigger: file lunghi, duplicati, root caotica, nuovo progetto, passaggio a team/altri utenti, pluginizzazione o drift canonici.

Output: documenti classificati, duplicati ridotti, indici allineati, bootstrap e pacchetto ADK/plugin riusabili.

Limiti: niente pulizia invasiva senza classificazione e niente nuovi documenti se esiste un canonico da aggiornare. La codebase hygiene post-edit e' obbligatoria come valutazione, non come cancellazione automatica.

Primitive: docs style guide, audit architetturale/documentale, cleanup guidato, bootstrap checklist, template handoff, docs index, plugin packaging, `plugin.json`, manifest/versione/provenance, marketplace o team install.

Ordine: classificare documenti -> ridurre duplicati/monoliti -> decidere cosa e' globale/progetto/plugin -> aggiornare indici -> creare pacchetto bootstrap/ADK -> testare trasferibilita'.

Sottopunti:

- [ ] riesaminare file troppo lunghi o con responsabilita' miste e decidere split concreti
- [ ] applicare a ogni modifica il controllo codebase hygiene: file diretto giusto, file indiretti coerenti, duplicati/obsoleti rilevati, cleanup sicuro o follow-up tracciato
- [ ] separare documenti storici, operativi, canonici e tracking
- [ ] mantenere `docs/README.md` allineato
- [ ] pulire root e cartelle solo dopo classificazione esplicita
- [ ] mantenere AI-readable i canonici con summary, non-goals, cross-link e limiti
- [ ] mantenere `NEW_PROJECT_BOOTSTRAP_CHECKLIST.md` allineata
- [ ] creare pacchetto handoff riusabile per altri progetti o persone
- [ ] creare pacchetto ADK riusabile con regole/memoria, skill, hook, subagent, comandi e manifest di plugin
- [ ] definire schema minimo di `plugin.json`: nome, versione, contenuti inclusi, hook installati, skill incluse, subagent inclusi, provenance, compatibilita' ambiente e strategia update
- [ ] decidere cosa resta globale, cosa resta progetto-specifico e cosa va nel plugin installabile per evitare copie divergenti
- [ ] adottare struttura canonica `.claude/` (reference da community 2026): `hooks/`, `commands/`, `skills/`, `agents/`, `output-styles/`, `plugins/`, `rules/`, `statusline`, `settings.json`, `settings.local.json`
- [ ] introdurre `.claude/output-styles/` per response format predefiniti
- [ ] aggiungere `CLAUDE.local.md` (gitignored) per override personali utente senza inquinare il repo condiviso
- [ ] mantenere `CLAUDE.md` di progetto sotto ~200 righe come convention community

Done: una nuova sessione capisce dove trovare ogni cosa; un nuovo progetto puo' partire con baseline AI senza conoscenza implicita; un team puo' installare lo stesso pacchetto versionato senza ricostruire a mano regole, skill, hook e agenti.

Verifiche: review `docs/README.md`, audit documentale manuale, prova bootstrap simulata, review del manifest/plugin package, simulazione di installazione in progetto vuoto.

### 13. `[Autonomy][medio/lungo]` Autonomia, metriche e sistema che migliora se stesso

Problema: l'utente non deve ripetere sempre le stesse correzioni; il sistema deve misurare miss e correggersi strutturalmente.

Stato: audit `audit:miss-metrics` (2026-05-13) legge `~/memory/*-log.txt` e distingue **activations** (ogni hit del hook) da **miss veri** (linee con BLOCK/violation/dirty pattern). Aggiornamento 2026-05-14: aggiunto `missPattern` per ogni regola; risultato attuale = **0 candidate forti per promozione**. Compliance advisory hook alta — conteggi live da `npm run audit:miss-metrics` (al run 2026-06-05 nessun advisory supera la soglia: miss 7d=0; numeri non hardcodati per evitare drift). Lezione operativa: NON promuovere a blocking sulla base di activations alte se i miss veri sono assenti — gli advisory funzionano. Manca ancora collegamento miss -> root cause -> primitive correttiva automatica.

Trigger: correzione ripetuta dall'utente, miss ricorrente, false completion, capability mancante o regola/tool inutilizzato.

Output: metrica del miss, root cause, primitive correttiva, verifica dell'effetto e riduzione di regole/tool inutili.

Limiti: non accumulare automazioni non misurate e non chiamare autonomia una decisione improvvisata.

Primitive: metriche compliance, violation log, audit, hook, skill governance, workflow periodici, worklog decisionale.

Ordine: raccogliere miss -> classificare root cause -> scegliere primitive -> implementare correzione minima -> misurare effetto -> rimuovere inutili.

Sottopunti:

- [x] misurare omissioni, routing errato e falsi completati come segnali sistemici — `audit:miss-metrics` legge 15 stream di log e produce hit count 7d/30d/totale
- [ ] convertire miss ricorrenti nel livello corretto di automazione o enforcement — primo set di candidate identificato (proactive-next-step, codebase-hygiene, best-practice, skill-precheck)
- [ ] riconoscere quando manca la primitive giusta e proporre creazione con conferma
- [ ] collegare autonomia, orizzonti temporali, capability governance e truthful completion in metriche
- [ ] evitare accumulo di regole/tool non usati
- [x] definire audit di salute architetturale/documentale del sistema AI — `audit:ai-control-plane` esteso (2026-06-01) con struttura+regole+hook+memoria+igiene

Done: errori ricorrenti producono miglioramento strutturale misurabile e l'utente non fa da memoria esterna.

Verifiche: `npm run audit:violations`, `npm run audit:rule-enforcement`, audit metriche autonomia da definire.

---

## Completati

Regola per leggere questa sezione: un completato non significa che l'intera area sia chiusa per sempre. Significa che quel blocco specifico e' stato implementato, collegato ai canonici e verificato almeno con audit/gate indicati. I limiti residui restano tracciati negli item aperti.

### C1. `2026-04-18` Runtime brief operativo iniziale

Cosa copre: scelta fonte/strumenti, web policy, modello/ambiente, capability gap, no false completion e requisiti runtime minimi che devono essere reiniettati all'AI.

Dove vive: `docs/AI_RUNTIME_BRIEF.md`, `AGENTS.md`, `CLAUDE.md`, hook `SessionStart`, `UserPromptSubmit` e `PreCompact`.

Prova: `audit:ai-control-plane`, `audit:ledger` e successivi `post-modifiche` hanno verificato che il brief sia presente nei canonici e agganciato ai punti runtime.

Limite residuo: il brief rende visibili le regole, ma non garantisce da solo comportamento perfetto; i miss reali vanno ancora misurati e promossi in hook/audit quando deterministici.

### C2. `2026-04-18` Matrice rule enforcement e audit regole

Cosa copre: classificazione delle regole tra testo, skill, hook, audit/script e workflow, con distinzione tra enforcement reale e regola solo documentale.

Dove vive: `src/scripts/ruleEnforcementMatrix.ts`, script `audit:rule-enforcement`, documenti di tracking e worklog.

Prova: `audit:rule-enforcement` ha prodotto snapshot con gap meccanizzabili a zero nel perimetro misurato.

Limite residuo: L2-L6 e molte regole cognitive restano audit-assisted/advisory, non blocking, per evitare hook semantici fragili.

### C3. `2026-04-18` Audit violations, ledger e skill

Cosa copre: controlli specifici per violazioni operative, copertura requirement ledger e coerenza skill/capability critiche.

Dove vive: script `audit:violations`, `audit:ledger`, `audit:skills`, log in `~/memory/` e riferimenti nei canonici.

Prova: gli audit sono stati creati, collegati ai package scripts e usati nei cicli di verifica successivi.

Limite residuo: gli audit statici misurano presenza e copertura documentale; la qualita' del ragionamento runtime richiede test comportamentali su prompt reali.

### C4. `2026-04-18` Style guide AI-readable

Cosa copre: standard per documenti leggibili dall'AI: responsabilita' chiara, sezioni esplicite, nomi stabili, niente mega-file caotici e contenuti separati per scopo.

Dove vive: `docs/AI_DOC_STYLE_GUIDE.md` e richiami nei canonici/documenti di tracking.

Prova: usata come criterio per riorganizzare runtime brief, backlog madre, lista lineare e documenti di tracking.

Limite residuo: non tutti i documenti storici sono stati riscritti; i file lunghi restano accettabili solo se sono storici o canonici, non runtime brief.

### C5. `2026-04-18` SessionStart, UserPromptSubmit e PreCompact collegati al runtime brief

Cosa copre: caricamento automatico di memoria, todos, runtime brief e reminder prima dei momenti critici di sessione e compact.

Dove vive: `~/.claude/settings.json`, `~/.claude/hooks/session-start.ps1`, `~/.claude/hooks/inject-runtime-brief.ps1`, `docs/AI_RUNTIME_BRIEF.md`.

Prova: `audit:hooks` e `audit:ai-control-plane:docs` verificano che i hook siano configurati e puntino a file esistenti.

Limite residuo: il comportamento e' forte in Claude Code; la parity in Codex/Cloud Code resta un punto aperto.

### C6. `2026-04-19` Routing capability e livelli L2-L9 audit-assisted

Cosa copre: registry machine-readable per decidere fonte, capability, web/docs, ambiente e livelli di verifica in base al dominio del task.

Dove vive: `docs/tracking/AI_CAPABILITY_ROUTING.json`, `docs/tracking/AI_LEVEL_ENFORCEMENT.json`, `src/scripts/capabilityRoutingAudit.ts`, `src/scripts/levelEnforcementAudit.ts`.

Prova: `audit:routing` passa su smoke prompt canonici e `audit:l2-l6` verifica la copertura per quick-fix, bug e feature/refactor.

Limite residuo: il routing resta advisory; diventa blocking solo quando il miss e' misurabile senza falsi positivi.

### C7. `2026-04-19` Hook `skill-activation.ps1` su `UserPromptSubmit`

Cosa copre: reminder runtime compatto per fonte di verita', web/docs, capability da usare/escludere, ambiente preferito, focus L2-L9 e ora P0/decomposizione/chiusura proattiva.

Dove vive: `~/.claude/hooks/skill-activation.ps1`, `~/.claude/settings.json`, `docs/tracking/AI_CAPABILITY_ROUTING.json`.

Prova: `audit:hooks` verifica presenza hook; `audit:ai-control-plane:docs` verifica contenuti P0 minimi nel file hook.

Limite residuo: non sostituisce il ragionamento del modello; e' un advisory ad alto valore, non un deny hook.

### C8. `2026-04-19` Slim-down e riallineamento canonici principali

Cosa copre: separazione tra fonte madre, backlog, operating model, runtime brief e adapter, riducendo duplicazioni e conflitti tra AGENTS/CLAUDE/docs.

Dove vive: `AGENTS.md`, `CLAUDE.md`, `docs/AI_MASTER_SYSTEM_SPEC.md`, `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md`, `docs/AI_OPERATING_MODEL.md`, `docs/AI_RUNTIME_BRIEF.md`.

Prova: `audit:ai-control-plane:docs` controlla che i riferimenti canonici esistano e siano coerenti.

Limite residuo: i canonici sono lunghi per natura; il controllo principale e' evitare drift, non renderli tutti brevi.

### C9. `2026-04-21` Skill `context-handoff`

Cosa copre: meccanismo base per trasferire obiettivi, stato, decisioni, file toccati, verifiche, blocchi e prossimi passi a una nuova sessione tramite continuita primaria e fallback legacy.

Dove vive: `~/.claude/skills/context-handoff/`, `.claude/CONTINUATION.md`, Obsidian `Resources/continuita`, `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md` item 5. `SESSION_HANDOFF.md` resta storico/fallback legacy.

Prova: `audit:ai-control-plane:docs` verifica che la skill contenga pre/post-condition minime (`Git status`, `.claude/CONTINUATION.md`, `Resources/continuita`, fallback legacy).

Limite residuo: trasferimento end-to-end con nuova chat reale resta da rivalidare a ogni cambio strutturale; la presenza della skill non basta per marcare chiuso l'item 5.

### C10. `2026-04-25` Capability matrix e policy ambiente/modello

Cosa copre: distinzione tra Claude Code, Codex, Cloud Code e altri ambienti; scelta modello/ambiente in base a rischio, costo, qualita', contesto e tool disponibili.

Dove vive: `docs/tracking/CAPABILITY_MATRIX.md`, `docs/AI_OPERATING_MODEL.md`, `AGENTS.md`, memoria decisioni sul router/modelli.

Prova: `audit:ai-control-plane:docs` e `audit:routing` verificano che modello, ambiente e capability siano parte del control plane.

Limite residuo: la parity completa tra ambienti non e' chiusa; Codex e Cloud Code non hanno tutte le stesse primitive di Claude Code.

### C11. `2026-04-25` Intento non letterale, best practice, cross-domain e anti-compiacenza

Cosa copre: l'AI non deve eseguire ciecamente; deve interpretare semantica, contestare ipotesi rischiose, controllare domini collegati e applicare best practice per artefatto.

Dove vive: `AGENTS.md`, `docs/AI_RUNTIME_BRIEF.md`, `docs/AI_MASTER_SYSTEM_SPEC.md`, `docs/360-checklist.md`.

Prova: presenza protetta da `audit:ai-control-plane:docs` e consolidata negli item aperti su ragionamento autonomo/enforcement.

Limite residuo: comportamento reale da validare su task lunghi e ambigui; alcune parti restano cognitive e non bloccabili con hook.

### C12. `2026-05-07` Hardening hook, runtime brief e handoff

Cosa copre: audit hook aggiornato al formato reale, runtime brief piu' completo, handoff operativo e sicurezza auto-commit/push.

Dove vive: `src/scripts/hooksConformityAudit.ts`, `docs/tracking/AI_HOOK_ENFORCEMENT_PLAN.md`, `docs/AI_RUNTIME_BRIEF.md`, hook git/request-action.

Prova: `audit:hooks` passa su 17/17 check e `audit:ai-control-plane` include hooks, routing, ADK, L2-L6 e lista AI.

Limite residuo: nuova chat reale e auto-push restano vincolati da stato git, branch policy e scope coerente.

### C13. `2026-05-07` Lista sistema AI completata come backlog operativo

Cosa copre: separazione tra lista AI globale e backlog applicativo LinkedIn, schema uniforme per ogni punto aperto, vista lineare derivata e audit anti-lista-generica.

Dove vive: `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md`, `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md`, `src/scripts/aiListCompletenessAudit.ts`.

Prova: `audit:ai-list-completeness` passa su 9/9 check e fallisce se item aperti mancano di problema, stato, primitive, ordine, sottopunti, done o verifiche.

Limite residuo: i punti aperti restano aperti; la lista e' completa come struttura, non come implementazione finale di tutto il sistema AI.

### C14. `2026-05-08` Orchestrator Layer esplicitato

Cosa copre: definizione dell'Orchestrator Layer come control plane che normalizza input, classifica task, sceglie fonte, capability, modello/ambiente, piano, verifiche, handoff e limiti.

Dove vive: `docs/AI_MASTER_SYSTEM_SPEC.md`, `docs/AI_RUNTIME_BRIEF.md`, `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md`, `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md`, `docs/AI_OPERATING_MODEL.md`.

Prova: `audit:ai-list-completeness` e `audit:ai-control-plane:docs` verificano frammenti obbligatori su orchestrator, fonte, capability, modello, ambiente e verifiche.

Limite residuo: manca ancora contratto unico cross-ambiente e metrica sistematica dei miss.

### C15. `2026-05-08` Skill discovery esterna quando manca capability locale

Cosa copre: una skill non installata localmente non va trattata come inesistente; il sistema deve cercare su cataloghi/fonti ufficiali e valutare qualita', reputazione, overlap e compatibilita'.

Dove vive: `docs/AI_RUNTIME_BRIEF.md`, `docs/AI_MASTER_SYSTEM_SPEC.md`, `AI_CAPABILITY_ROUTING.json`, backlog/lista AI, audit control plane.

Prova: `audit:routing` include smoke prompt `capability-discovery`; `audit:ai-control-plane:docs` verifica `npx skills find`, `skills.sh` e discovery esterna.

Limite residuo: non e' ancora installata una skill locale `find-skills`; va deciso se promuoverla a capability stabile.

### C16. `2026-05-08` Agent Development Kit e governance capability a 5 layer

Cosa copre: regole/memoria, skill, hook, subagent, plugin/distribution e MCP esterni come layer distinti, con decisione di placement e riuso.

Dove vive: `docs/tracking/AI_ADK_CAPABILITY_GOVERNANCE.json`, `src/scripts/adkCapabilityGovernanceAudit.ts`, `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md`, `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md`.

Prova: `audit:adk-capabilities` passa su standard layer, placement capability, candidate esterne e coverage layer.

Limite residuo: alcune candidate esterne (Caveman, LeanCTX, SIMDex, Contact Skills) sono da valutare, non da installare alla cieca.

### C17. `2026-05-08` Protocollo root cause e soluzione migliore

Cosa copre: divieto di fermarsi alla prima risposta plausibile o al primo workaround quando esiste una soluzione migliore raggiungibile; richiesta di root cause, alternative e best practice aggiornate.

Dove vive: `docs/AI_MASTER_SYSTEM_SPEC.md`, `docs/AI_RUNTIME_BRIEF.md`, `AI_LEVEL_ENFORCEMENT.json`, backlog/lista AI, checklist.

Prova: `audit:l2-l6`, `audit:ai-list-completeness` e `audit:ai-control-plane:docs` falliscono se spariscono root cause, alternative, soluzione migliore o primo workaround.

Limite residuo: richiede prova comportamentale reale su prompt ambigui dove la prima soluzione plausibile non e' la migliore.

### C18. `2026-05-09` Organizzazione futura e change map sistema AI

Cosa copre: mappa dei file da aggiornare insieme quando cambiano regole, capability, hook, livelli o handoff; ripristino del hook codebase hygiene nel settings reale e nella fonte di autoriparazione.

Dove vive: `docs/tracking/README.md`, `src/scripts/aiControlPlaneAudit.ts`, `~/.claude/settings.json`, `~/.claude/scripts/model-router-config.mjs`.

Prova: `audit:ai-control-plane:docs` include check della change map e `audit:hooks` verifica hook attivi.

Limite residuo: il worklog resta storico e lungo; va usato come tracking, non come runtime brief.

### C19. `2026-05-09` Gerarchia P0 del ragionamento AI

Cosa copre: ordine cognitivo prioritario: intento reale, input utente come ipotesi, esempi come pattern, decomposizione, visione 360, root cause, fonte/primitive/verifica, continuita' e truthful completion.

Dove vive: `docs/AI_RUNTIME_BRIEF.md`, `docs/AI_MASTER_SYSTEM_SPEC.md`, `~/.claude/hooks/skill-activation.ps1`, backlog/lista AI, operating model, checklist.

Prova: `audit:ai-control-plane:docs` verifica P0 nel runtime brief e nel hook; `audit:ai-list-completeness` verifica P0 nella lista AI.

Limite residuo: P0 e' advisory/runtime, non blocking semantico; va validato con prompt reali e miss loggati.

### C20. `2026-05-09` Continuita' proattiva di chiusura

Cosa copre: l'AI deve completare tutto il completabile nel turno corrente, poi lasciare prossimo passo concreto, blocco reale o domanda specifica; niente chiusure passive se esiste un'azione successiva ragionevole.

Dove vive: `docs/AI_RUNTIME_BRIEF.md`, `docs/AI_MASTER_SYSTEM_SPEC.md`, `~/.claude/hooks/skill-activation.ps1`, `~/.claude/hooks/stop-proactive-next-step.ps1`, `~/.claude/settings.json`, `~/.claude/scripts/model-router-config.mjs`, `AGENTS.md`, backlog/lista AI.

Prova: `audit:ai-control-plane:docs` verifica `Chiusura proattiva` e domanda concreta/specifica; `audit:hooks` verifica la presenza del `Stop` hook; `audit:ai-control-plane` verifica script, settings e fonte canonica; `post-modifiche` resta il gate finale sui cambi.

Limite residuo: il hook e' advisory e non puo' leggere semanticamente ogni risposta finale; diventa blocking solo con metrica affidabile di false completion o miss ripetuti.

### C21. `2026-05-09` Decomposizione ricorsiva dell'argomento

Cosa copre: esempio o argomento diventano albero dell'argomento con sottopunti, sotto-sottopunti e rami correlati; per ogni ramo si rivalutano fonte, web/docs/MCP, skill/capability, rischi, verifiche e done criteria.

Dove vive: `docs/AI_RUNTIME_BRIEF.md`, `docs/AI_MASTER_SYSTEM_SPEC.md`, `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md`, `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md`, `~/.claude/hooks/skill-activation.ps1`.

Prova: `audit:ai-control-plane:docs`, `audit:ai-list-completeness`, `audit:hooks`, `audit:ai-control-plane` e `post-modifiche` sono passati dopo l'inserimento.

Limite residuo: la decomposizione resta cognitiva/advisory; va misurata tramite audit ledger e test su prompt densi.
