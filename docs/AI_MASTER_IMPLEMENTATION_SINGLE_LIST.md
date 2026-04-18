# AI Master Implementation Single List

Questa e' la vista lineare unica di tutti i punti ancora aperti.

Serve quando vuoi:

- leggere tutto in una sola passata
- confrontare rapidamente questa lista con la chat
- capire se manca qualcosa
- proporre merge, tagli o riscritture
- vedere l'ordine logico corretto di lavoro, non solo un elenco piatto

Regola importante:

- [AI_MASTER_IMPLEMENTATION_BACKLOG.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md) resta il backlog strutturato primario
- questo file e' la vista lineare derivata, utile per revisione e miglioramento
- se un punto cambia davvero, il blocco corretto e' aggiornare prima il backlog strutturato e poi riallineare questa lista

## Regole di scrittura di questa lista

Ogni punto dovrebbe essere:

- atomico: una sola idea principale per riga
- esplicito: deve dire cosa va reso vero nel sistema
- non ambiguo: deve essere chiaro se si parla di regola, enforcement, audit, workflow o bug operativo
- non duplicato: se due righe chiedono la stessa cosa, vanno fuse
- ordinato per dipendenza: prima cio' che rende affidabile il sistema, poi cio' che usa quella affidabilita'

## Ordine logico di lavoro

Questa lista non e' ordinata solo per priorita'. E' ordinata soprattutto per dipendenza logica:

- prima si rende affidabile il cervello operativo del sistema
- poi si stabilizzano contesto e ambienti
- poi si mette in sicurezza il runtime reale
- poi si chiudono anti-ban, compliance e automazioni
- solo dopo si spinge cleanup sistemico, riuso e metriche di autonomia

## Lista lineare unica dei punti ancora aperti, ordinata per logica

### Fase 1 — Control plane cognitivo e regole enforced

1. ✅ `[Control plane][breve/medio]` Far comparire in ogni task una micro-spiegazione esplicita su fonte di verita', strumenti attivati e strumenti esclusi. → *Aggiunto al runtime brief (2026-04-18)*
2. ✅ `[Control plane][breve/medio]` Formalizzare una regola decisionale chiara su quando la ricerca web e' obbligatoria, facoltativa o inutile. → *Aggiunto al runtime brief (2026-04-18)*
3. ✅ `[Control plane][breve/medio]` Far proporre sempre modello e ambiente in base a qualita', costo, velocita', tool disponibili, contesto e rischio. → *Aggiunto al runtime brief (2026-04-18)*
4. ✅ `[Control plane][breve/medio]` Far riconoscere automaticamente i capability gap e instradarli verso la primitive corretta. → *Gia' nel runtime brief*
5. ✅ `[Control plane][breve/medio]` Impedire che gli esempi dati dall'utente vengano trattati come lista chiusa. → *Gia' nel runtime brief*
6. ✅ `[Control plane][breve/medio]` Produrre una matrice unica `regola -> primitive di enforcement -> verifica`. → *`src/scripts/ruleEnforcementMatrix.ts` — 24/29 enforced, 0 gap (2026-04-18)*
7. ✅ `[Control plane][breve/medio]` Promuovere a hook o audit bloccante tutte le regole critiche ancora solo testo. → *Tutte le regole meccanizzabili mappate e verificate (2026-04-18)*
8. ✅ `[Control plane][breve/medio]` Allineare hook attivi e regole canoniche. → *13/13 hook verificati, matrice allineata con AGENTS.md (2026-04-18)*
9. ✅ `[Control plane][medio]` Definire pre-condition e post-condition standard per skill e MCP critici. → *10 skill/MCP coperti in AGENTS.md (2026-04-18)*
10. ✅ `[Control plane][medio]` Aggiungere un audit dedicato che misuri la copertura reale. → *`npm run audit:rule-enforcement` (2026-04-18)*
11. ✅ `[Control plane][medio]` Misurare dai log e dalle violazioni ricorrenti quali decisioni vengono sbagliate. → *`npm run audit:violations` (2026-04-18)*
12. `[Control plane][medio/lungo]` Fare un audit periodico dell'inventario installato di skill, MCP, plugin, agenti e workflow decisionali. → *Aperto — richiede dati di utilizzo nel tempo*

### Fase 2 — Contesto, memoria e documenti leggibili dall'AI

13. ✅ `[Memory][breve/medio]` Provare con casi reali la continuita' tra chat vecchia e chat nuova. → *session-start.ps1 inietta SESSION_HANDOFF.md automaticamente (2026-04-18)*
14. `[Memory][medio]` Riesaminare una per una le skill personalizzate gia' create e valutare candidate esterne specifiche. → *Aperto — `npm run audit:skills` mostra inventario (172 skill, 2 vuote)*
15. ✅ `[Memory][medio]` Scrivere una style guide esplicita per documenti AI-readable. → *`docs/AI_DOC_STYLE_GUIDE.md` creato (2026-04-18)*
16. `[Memory][medio]` Applicare quella style guide ai file di contesto oggi ancora troppo densi, confusi o monolitici. → *Aperto — richiede revisione manuale file per file*
17. ✅ `[Memory][breve/medio]` Definire segnali oggettivi di context degradation e far proporre l'handoff. → *PreCompact inietta CONTEXT_DEGRADATION_WARNING meccanico (2026-04-18)*
18. ✅ `[Memory][breve/medio]` Rendere piu' sistematico l'aggiornamento di memory, worklog e todos. → *stop-session.ps1 controlla worklog + active.md (2026-04-18)*
19. ✅ `[Memory][breve/medio]` Verificare con checklist o audit che il requirement ledger resti coperto. → *`npm run audit:ledger` — 14/14 check (2026-04-18)*
20. ✅ `[Memory][medio]` Aggiungere test o audit che confermino che le skill personalizzate si attivano davvero. → *`npm run audit:skills` — 5/5 critiche verificate (2026-04-18)*

### Fase 3 — Parita' ambienti e migrazione operativa

21. `[Parity environments][medio]` Definire una capability matrix che esprima per ogni ambiente non solo le feature presenti, ma il contratto operativo reale su canonici, memoria, skill, hook, MCP, git gate e audit.
22. `[Parity environments][medio]` Distinguere per ogni ambiente cio' che e' supportato nativamente, cio' che e' garantito solo con workaround e cio' che oggi non ha parity affidabile.
23. `[Parity environments][breve/medio]` Stabilizzare i problemi operativi reali gia' emersi in uso: validita' `settings.json`, hook `SessionStart`, selezione provider/modello, visibilita' modelli OpenRouter e switching affidabile del modello.
24. `[Parity environments][medio]` Chiudere o documentare in modo esplicito i gap su memoria, handoff, runtime brief, git gate, audit e hook, mantenendo lo stesso standard di verita' tra ambienti.
25. `[Parity environments][medio]` Definire per ogni primitive assente il miglior equivalente reale, con fallback che preservi rigore e non solo comodita'.
26. `[Parity environments][medio]` Scrivere un piano di migrazione progressiva verso Codex solo dove enforcement, parity e visibilita' operativa non peggiorano.
27. `[Parity environments][medio]` Verificare con task comparativi reali che Cloud Code e gli altri ambienti seguano la stessa logica contestuale di scelta strumenti e quality gate.
28. `[Parity environments][medio/lungo]` Mantenere viva la policy del miglior ambiente per ogni tipo di task, basandola su affidabilita', controllo e costo cognitivo reale.
29. `[Local tools][medio]` Rendere il tool di dettatura locale abbastanza stabile da sostituire davvero il fallback di Windows nel lavoro quotidiano.
30. `[Local tools][medio]` Documentare una decisione chiara sul trade-off locale vs cloud per la trascrizione, con criterio di scelta e fallback.
31. `[Local tools][medio]` Aprire e chiudere davvero il piano di fix dei colli di bottiglia del computer, invece di lasciarli come nota permanente.
32. `[Local tools][medio]` Realizzare, se utile, un helper che trasformi prompt deboli in prompt piu' chiari e che proponga anche modello e ambiente coerenti con il task.

### Fase 4 — Runtime reale e truthfulness del bot

33. `[Runtime/control plane][breve]` Rendere il lock del daemon cooperativo e rinnovato per tutta la durata reale della run.
34. `[Runtime/control plane][breve]` Eliminare i `process.exit(0)` nei path critici e chiudere davvero il graceful shutdown.
35. `[Runtime/control plane][breve]` Aggiungere stop e flush esplicito di listener e checkpoint allo shutdown.
36. `[Runtime/control plane][breve]` Allineare i timeout PM2 al budget reale di stop.
37. `[Runtime/control plane][breve/medio]` Portare reporting live, stato proxy e stato JA3 fuori dalla memoria locale di processo.
38. `[Runtime/control plane][breve/medio]` Fare in modo che `/api/health/deep` misuri anche daemon liveness, zombie `automation_commands` e readiness reale.
39. `[Runtime/control plane][breve/medio]` Recuperare gli `automation_commands` rimasti `RUNNING` dopo crash o stop brutale.
40. `[Runtime/control plane][breve/medio]` Far propagare gli incidenti runtime critici fino al `WorkflowExecutionResult`.
41. `[Runtime/control plane][breve/medio]` Allineare `workflowToJobTypes(...)` con i job realmente accodati e consumati.
42. `[Runtime/control plane][medio]` Ripulire i boundary dei workflow per evitare side effect impliciti fuori contratto.
43. `[Runtime/control plane][breve/medio]` Sostituire o chiudere il `skipPreflight` troppo permissivo nei path non interattivi.
44. `[Runtime/control plane][breve/medio]` Rendere l'override account scoped alla singola run e sempre ripristinato.
45. `[Runtime/control plane][breve/medio]` Verificare che API, Telegram, report e dashboard leggano la stessa verita' runtime.
46. `[Runtime/control plane][medio]` Completare validazioni di staging reali con browser, proxy e account veri.

### Fase 5 — Anti-ban, proxy/sessione, sicurezza e compliance

47. `[Anti-ban/compliance][breve/medio]` Fare un audit completo dei workflow pubblici su proxy, sessione, account health e preflight reale.
48. `[Anti-ban/compliance][breve/medio]` Separare in modo affidabile `LOGIN_MISSING` da rate limit, `403`, timeout, proxy failure e rete degradata.
49. `[Anti-ban/compliance][breve/medio]` Rafforzare il gate "proxy healthy" con verifica reale di auth, `CONNECT`, exit IP e browsing minimo.
50. `[Anti-ban/compliance][medio]` Valutare e verificare la coerenza geo sull'exit IP reale.
51. `[Anti-ban/compliance][medio]` Ripristinare o sostituire in modo corretto il controllo UA <-> engine anche nei casi JA3 e proxy.
52. `[Anti-ban/compliance][medio]` Allineare il preflight workflow al mondo multi-account e multi-proxy reale.
53. `[Anti-ban/compliance][medio/lungo]` Aggiornare la parte anti-ban con i vettori di detection piu' recenti e con monitor periodici reali.
54. `[Anti-ban/compliance][breve/medio]` Importare e attivare davvero il workflow di retention e GDPR gia' preparato.
55. `[Anti-ban/compliance][medio]` Verificare end-to-end right to erasure, retention e data hygiene anche sugli store secondari.
56. `[Anti-ban/compliance][medio]` Verificare che Sentry e i controlli di sicurezza ricevano eventi reali in produzione.
57. `[Anti-ban/compliance][medio/lungo]` Mantenere security scan mirati su auth, input utente, query DB, stealth e aree sensibili.

### Fase 6 — n8n, agenti verticali e automazioni durevoli

58. `[n8n/Automation][medio]` Portare i workflow n8n da artefatti nel repo a flussi vivi nell'istanza reale, con attivazione e ownership chiare.
59. `[n8n/Automation][medio]` Implementare hook di ingresso/uscita come punti di controllo veri del workflow, non come note documentali.
60. `[n8n/Automation][medio]` Aggiungere stato o memoria durevole dove il workflow non puo' essere trattato come stateless senza perdere affidabilita'.
61. `[n8n/Automation][medio]` Introdurre human-in-the-loop reale per flussi ad alto rischio, strutturali o invasivi, con pause e conferme nei punti giusti.
62. `[n8n/Automation][medio]` Separare meglio confini e responsabilita' tra agenti verticali, workflow critici del bot e automazioni di supporto, restringendo quelli troppo generici.
63. `[n8n/Automation][medio]` Rendere i workflow distribuibili ad altri con setup, env validation, health check, runbook e criteri di ownership completi.
64. `[n8n/Automation][medio]` Allineare scheduling, giorni e orari di lavoro alle finestre operative reali dell'utente e al valore effettivo dell'automazione.
65. `[n8n/Automation][lungo]` Fare audit periodici su uso reale, drift, duplicati, rotture e workflow o agenti che non si attivano nel momento giusto.

### Fase 7 — Chiusura tecnica corretta, git e cadenze periodiche

66. `[Git/review][breve/medio]` Estendere il comportamento corretto su commit e push anche fuori da Claude Code o documentare un fallback affidabile.
67. `[Git/review][breve/medio]` Verificare che il commit parta davvero come chiusura naturale di un blocco verificato, non solo come regola scritta.
68. `[Git/review][medio]` Chiarire meglio dove il push deve fermarsi per review, remote policy o rischio operativo.
69. `[Git/review][medio]` Rendere piu' sistematica la distinzione tra review locale, review di branch e audit periodico.
70. `[Git/review][breve/medio]` Evitare che il task venga dichiarato chiuso prima della chiusura corretta del blocco tecnico e git.
71. `[Temporal horizons][breve/medio/lungo]` Trattare breve, medio e lungo termine come classificazione obbligatoria del task, non come etichetta accessoria nei documenti.
72. `[Temporal horizons][breve/medio]` Distinguere sempre cosa va eseguito ora, cosa va seguito nella stessa iniziativa e cosa appartiene a manutenzione o hardening periodico.
73. `[Temporal horizons][medio/lungo]` Dare a ogni punto non di breve termine un contenitore canonico, una cadenza minima e un owner logico espliciti.
74. `[Temporal horizons][lungo]` Promuovere i task periodici stabili da backlog testuale ad audit, script o workflow schedulati quando il valore e' ricorrente.
75. `[Temporal horizons][breve/medio]` Impedire che obblighi del breve termine vengano parcheggiati nel backlog solo per rinviare lavoro necessario.
76. `[Temporal horizons][medio/lungo]` Mantenere coerenti backlog madre, backlog specialistici, worklog e priorita' attive come un unico stato operativo.

### Fase 8 — Cleanup strutturale e documentale

77. `[Cleanup/docs/root][medio]` Riesaminare file troppo lunghi o con responsabilita' miste e decidere split concreti.
78. `[Cleanup/docs/root][medio]` Decidere il destino delle aree legacy o ambigue della UI e della dashboard.
79. `[Cleanup/docs/root][medio]` Separare meglio documenti storici, documenti operativi e documenti canonici.
80. `[Cleanup/docs/root][medio/lungo]` Tenere `docs/README.md` davvero allineato ai documenti importanti.
81. `[Cleanup/docs/root][medio/lungo]` Pulire root e cartelle solo dopo classificazione esplicita del loro ruolo.
82. `[Cleanup/docs/root][medio/lungo]` Ridurre duplicazioni, backlog morti e documenti che dicono la stessa cosa con nomi diversi.
82b. ✅ `[Cleanup/docs/root][breve/medio]` Applicare blast radius documentale a ogni task: cercare e aggiornare artefatti correlati stale (stesso argomento = automatico, argomento diverso = chiedere). → *Formalizzato come regola in AGENTS.md e runtime brief (2026-04-18)*
83. `[Cleanup/docs/root][medio/lungo]` Mantenere AI-readable i file canonici, evitando monoliti documentali ingestibili.

### Fase 9 — Riuso su nuovi progetti e consegna ad altri

84. `[Bootstrap/reuse][medio]` Mantenere la checklist bootstrap allineata al sistema reale e non lasciarla divergere.
85. `[Bootstrap/reuse][medio/lungo]` Creare un pacchetto di handoff davvero riusabile per altri progetti o altre persone.
86. `[Bootstrap/reuse][medio]` Chiarire cosa va portato sempre in un nuovo progetto: regole, memory, quality gate, hook, workflow, sicurezza, git discipline e handoff.
87. `[Bootstrap/reuse][medio/lungo]` Verificare che il sistema resti trasferibile anche fuori da questa singola codebase.

### Fase 10 — Metriche di autonomia e sistema che migliora se stesso

88. `[Autonomy][medio/lungo]` Misurare omissioni, errori di scelta delle primitive e falsi completamenti come segnali sistemici, non come incidenti isolati.
89. `[Autonomy][medio/lungo]` Convertire i miss ricorrenti nel livello corretto di enforcement: regola, checklist, skill, hook, script o workflow.
90. `[Autonomy][medio/lungo]` Far riconoscere automaticamente quando il vero gap e' l'assenza della primitive giusta e proporre la promozione strutturale corretta.
91. `[Autonomy][medio/lungo]` Rendere piu' automatica la scelta del prossimo passo corretto, mantenendo pero' esplicita verso l'utente la logica della selezione.
92. `[Autonomy][medio/lungo]` Verificare in modo sistematico che l'AI non finga completezza, avanzamento o verifica oltre le prove realmente disponibili.
93. `[Autonomy][medio/lungo]` Collegare autonomia, temporalita', truthful control plane e capability governance in metriche verificabili e usabili per migliorare il sistema.
