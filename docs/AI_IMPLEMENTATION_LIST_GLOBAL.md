# AI Implementation List — Global

Questa lista raccoglie i punti di implementazione che riguardano il sistema AI indipendentemente dal progetto specifico: control plane, memoria, parity ambienti, tool locali, git discipline, orizzonti temporali, cleanup sistemico, bootstrap riuso e metriche di autonomia.

Scopo: leggere tutto in una sola passata, confrontare con la chat, capire cosa manca a livello di infrastruttura AI.

Nota: questo file e' il backlog primario per i punti AI/globali. Il backlog strutturato con sottopunti, primitive corrette e done criteria sta in `AGENTS.md` e `docs/AI_OPERATING_MODEL.md`.

Regola di aggiornamento: quando si chiude un item, spostarlo nella sezione Completati con data e riferimento all'intervento.

---

## Classificazione enforcement

**`[auto]`** — comportamento AI: deve scattare automaticamente su ogni prompt/task rilevante, senza che l'utente lo richieda esplicitamente. Se non scatta, e' un miss operativo.

**`[usr]`** — task a iniziativa utente: implementazione, audit periodico, decisione strategica, tool da costruire. Default implicito per tutti gli item senza marcatura specifica.

| Categoria | Item `[auto]` | Comportamento atteso |
|-----------|--------------|----------------------|
| Intent | 64 | Interpreta intento reale, non testo letterale |
| Best practice | 65 | Verifica dipendenze, contratti e test a ogni modifica |
| Cross-domain | 66 | Valuta TUTTI i domini su ogni file toccato |
| Recap | 80 | Riepilogo strutturato prima di qualsiasi modifica multi-file |
| Anti-compiacenza | 73 | Contesta richieste sbagliate/rischiose prima di eseguire |
| Context fallback | 71 | Attiva fallback (code search, agenti) se contesto degrada |
| Loop check | 68 | Verifica completa a ogni iterazione di loop Codex |
| Selezione ambiente | 8 | Propone modello/ambiente migliore per ogni task |
| Commit naturale | 40 | Commit solo come chiusura verificata, mai prima |
| Orizzonte temporale | 43 | Classifica ogni task come breve/medio/lungo prima di agire |
| Capability gap | 60 | Riconosce gap e costruisce la primitive corretta |
| Prossimo passo | 61 | Sceglie il prossimo passo corretto e lo dichiara |
| No false completion | 62 | Non finge verifica o completamento senza prove reali |

Tutti gli altri item sono `[usr]`.

---

## Aperti

### Fase 1 — Control plane cognitivo e regole enforced

1. `[Control plane][breve/medio]` Promuovere L2-L6 da `audit-assisted` a blocking dove i dati lo giustificano — senza introdurre deny hook fragili. **Strumenti**: `AI_LEVEL_ENFORCEMENT.json` (registro stati), `skill-activation.ps1` (advisory hook), `npm run audit:violations` (metriche miss). **Condizione di promozione**: miss ricorrente sullo stesso controllo in piu' sessioni di lavoro. **Chi**: audit periodico via `/audit-rules` skill. **Stato attuale**: L1 e L7-L9 = enforcement meccanico reale; L2-L6 = advisory.

2. `[Control plane][medio/lungo]` Consolidare e auditare periodicamente l'inventario installato di skill, MCP, plugin, agenti e workflow decisionali partendo dal registro machine-readable di routing, riesaminando candidate esterne (Caveman, LeanCTX, SIMDex, Contact Skills e simili) e valutando duplicati, rotture e mancate attivazioni. *(Fuso da ex item 12, 14, 65)*

64. `[Control plane][breve/medio]` Rendere esplicita e tracciata la regola "interpreta l'intento, non il testo letterale": ogni prompt va ragionato come farebbe un ingegnere esperto che conosce il contesto, non eseguito meccanicamente — anche quando il testo dice X ma l'obiettivo reale e' Y.

65. `[Control plane][medio]` Definire e codificare una regola fondamentale di best practice ingegnere per ogni modifica al codice: ordine delle operazioni, verifica delle dipendenze dirette e indirette, imports, contratti, test impattati, e nessuna modifica parziale o "a meta'" — tutto o niente, verificato e completo.

66. `[Control plane][medio]` Aggiungere un livello di controllo cross-domain per ogni modifica: valutare esplicitamente TUTTI i domini che un file tocca (sicurezza, architettura, timing, anti-ban, compliance, osservabilita') e non solo il tema principale della modifica in corso. Implementare usando agenti specializzati (es. `antiban-review`, `code-reviewer`) e memoria di progetto come canale di propagazione del contesto cross-dominio — non solo come dichiarazione di principio.

80. `[Control plane][breve]` Rafforzare la regola "recap strutturato prima di agire": su qualsiasi prompt che richiede modifiche a piu' file o task non banale, l'AI deve produrre un riassunto esplicito di cio' che ha capito (obiettivo, file coinvolti, approccio scelto) e attendere conferma PRIMA di iniziare qualsiasi modifica. La regola attuale e' in AGENTS.md come testo advisory — non viene applicata in modo affidabile. Convertire in check esplicito L2 o hook `PreToolUse` che blocchi il primo `Edit`/`Write` finche' l'utente non approva il recap. **Criterio done**: 0 sessioni in cui si parte senza recap su task complessi, verificato su 3 sessioni consecutive.

73. `[Control plane][medio]` Formalizzare e rendere operativa la regola di anti-compiacenza attiva: quando l'utente formula una richiesta tecnicamente sbagliata o rischiosa, l'AI deve contestarla con motivazione concreta invece di eseguirla ciecamente. Codificare in AGENTS.md come regola dura con esempi concreti, non solo come nota nel runtime brief. Verificare con test espliciti di scenario (richiesta pericolosa anti-ban, richiesta con assunzione errata, richiesta che contraddice un canonical doc).

75. `[Control plane][breve/medio]` Completare l'inventario delle skill installate rispetto a `SKILL_TABLE.md`: identificare le skill presenti in tabella ma non ancora installate in `~/.claude/skills/`, creare o installare quelle ad alto impatto (es. token efficiency, LinkedIn-specific patterns, Playwright debugging avanzato, DB migration safety, context-handoff). Aggiornare SKILL_TABLE.md e routing registry dopo ogni installazione.

77. `[Control plane][breve]` Gap analysis skill mancanti per migliorare la performance: ricercare le skill che farebbero la differenza piu' alta nella qualita' delle risposte su task frequenti (TypeScript avanzato, testing critico, architettura, gestione contesto, anti-ban specifico), installarle e registrarle. **Criterio done**: SKILL_TABLE.md riflette lo stato reale installato; nessun dominio frequente senza skill dedicata.

### Fase 2 — Contesto, memoria e documenti leggibili dall'AI

3. `[Memory][medio]` Applicare la style guide AI-readable ai file di contesto oggi ancora troppo densi, confusi o monolitici.

67. `[Memory][medio]` Creare una skill `context-handoff` invocabile dall'utente che porti interattivamente il contesto rilevante di una chat lunga a una nuova sessione pulita, oltre al SESSION_HANDOFF.md gia' iniettato automaticamente.

71. `[Memory][medio]` Definire il protocollo di fallback operativo quando il contesto si avvicina al limite: code search sistematico dei caller, mapping dipendenze impattate, spawn agenti specializzati per estendere il contesto alla codebase reale, aggiornamento minimo dei contenitori (memory, todos, plan) prima della compattazione. Codificare come procedura in AGENTS.md e come check L5 nel registro livelli.

72. `[Memory][medio]` Definire uno schema minimo garantito del Context Handoff State: obiettivi correnti, decisioni prese, blast radius identificato, blocchi aperti, verifiche completate, prossimi passi. Distinguere da SESSION_HANDOFF.md (contenuto automatico) rispetto allo schema strutturato (template riproducibile e verificabile). Implementare come template in `context-handoff` skill.

### Fase 3 — Parita' ambienti

4. `[Parity][medio]` Definire capability matrix per ogni ambiente: contratto operativo reale su canonici, memoria, skill, hook, MCP, git gate e audit.

5. `[Parity][medio]` Distinguere per ogni ambiente cio' che e' supportato nativamente, garantito solo con workaround o senza parity affidabile. Chiudere o documentare i gap espliciti su memoria, handoff, runtime brief, git gate, audit e hook con fallback che preservino rigore. *(Fuso da ex item 22, 24, 25)*

6. `[Parity][breve/medio]` Stabilizzare i problemi operativi reali gia' emersi: validita' `settings.json`, hook `SessionStart`, selezione provider/modello, visibilita' modelli OpenRouter e switching affidabile.

7. `[Parity][medio]` Scrivere un piano di migrazione progressiva verso Codex solo dove enforcement, parity e visibilita' operativa non peggiorano. Verificare con task comparativi reali. *(Fuso da ex item 26, 27)*

68. `[Parity][medio]` Implementare il loop Codex con verifica completa a ogni iterazione: ogni conclusione di blocco tecnico deve passare un check su tutti gli aspetti (diretti, indiretti, multi-dominio) prima di dichiarare il task chiuso e passare al successivo.

8. `[Parity][medio/lungo]` Mantenere viva la policy del miglior ambiente per ogni tipo di task, basata su affidabilita', controllo e costo cognitivo reale.

### Fase 4 — Strumenti locali e supporto personale

9. `[Local tools][medio]` Rendere il tool di dettatura locale abbastanza stabile da sostituire davvero il fallback di Windows nel lavoro quotidiano.

10. `[Local tools][medio]` Documentare una decisione chiara sul trade-off locale vs cloud per la trascrizione, con criterio di scelta e fallback.

11. `[Local tools][medio]` Aprire e chiudere davvero il piano di fix dei colli di bottiglia del computer, invece di lasciarli come nota permanente.

12. `[Local tools][medio]` Realizzare, se utile, un helper che trasformi prompt deboli in prompt piu' chiari e che proponga anche modello e ambiente coerenti con il task.

### Fase 8 — Git, review e chiusura corretta

39. `[Git][breve/medio]` Estendere il comportamento corretto su commit e push anche fuori da Claude Code o documentare un fallback affidabile.

40. `[Git][breve/medio]` Verificare che il commit parta davvero come chiusura naturale di un blocco verificato e che il task non venga dichiarato chiuso prima della chiusura corretta del blocco tecnico git. *(Fuso da ex item 67, 70)*

41. `[Git][medio]` Chiarire meglio dove il push deve fermarsi per review, remote policy o rischio operativo.

42. `[Git][medio]` Rendere piu' sistematica la distinzione tra review locale, review di branch e audit periodico.

### Fase 9 — Orizzonti temporali e cadenze periodiche

43. `[Temporal][breve/medio]` Trattare breve, medio e lungo termine come classificazione obbligatoria del task e impedire che obblighi del breve termine vengano parcheggiati nel backlog per rinviare lavoro necessario. *(Condensato da ex item 71, 72, 75)*

44. `[Temporal][medio/lungo]` Dare a ogni punto non di breve termine un contenitore canonico, una cadenza minima e un owner logico espliciti, mantenendo coerenti backlog madre, specialistici, worklog e priorita' attive. *(Condensato da ex item 73, 76)*

45. `[Temporal][lungo]` Promuovere i task periodici stabili da backlog testuale ad audit, script o workflow schedulati quando il valore e' ricorrente.

### Fase 10 — Cleanup strutturale e documentale (globale)

46. `[Cleanup][medio]` Riesaminare file troppo lunghi o con responsabilita' miste e decidere split concreti.

69. ✅ `[Cleanup][breve]` Risolvere i bug di coerenza repository: file untracked committati, 30+ path assoluti Windows → relativi nei canonici, ordine lettura AI_RUNTIME_BRIEF.md coerente CLAUDE/AGENTS/README. → *6 commit: `663b1e9`* *(2026-04-20)*

48. `[Cleanup][medio]` Separare meglio documenti storici, documenti operativi e documenti canonici.

52. `[Cleanup][medio/lungo]` Mantenere AI-readable i file canonici, evitando monoliti documentali ingestibili.

53. ✅ `[Cleanup][breve/medio]` Ridurre il file CLAUDE.md globale sotto le 200 righe applicando la regola "file regole corto = AI ricorda tutto". → *326→195 righe (2026-04-19)*

### Fase 11 — Riuso su nuovi progetti e consegna ad altri

54. `[Bootstrap][medio]` Mantenere la checklist bootstrap allineata al sistema reale e non lasciarla divergere.

55. `[Bootstrap][medio/lungo]` Creare un pacchetto di handoff davvero riusabile per altri progetti o altre persone.

56. `[Bootstrap][medio]` Chiarire cosa va portato sempre in un nuovo progetto: regole, memory, quality gate, hook, workflow, sicurezza, git discipline e handoff.

57. `[Bootstrap][medio/lungo]` Verificare che il sistema resti trasferibile anche fuori da questa singola codebase.

### Fase 12 — Metriche di autonomia e sistema che migliora se stesso

58. `[Autonomy][medio/lungo]` Misurare omissioni, errori di scelta delle primitive e falsi completamenti come segnali sistemici, non come incidenti isolati.

59. `[Autonomy][medio/lungo]` Convertire i miss ricorrenti nel livello corretto di enforcement: regola, checklist, skill, hook, script o workflow.

60. `[Autonomy][medio/lungo]` Far riconoscere automaticamente quando il vero gap e' l'assenza della primitive giusta e costruire attivamente la primitive strutturale corretta (skill, hook, audit, workflow) — senza aspettare richiesta esplicita dell'utente.

61. `[Autonomy][medio/lungo]` Rendere piu' automatica la scelta del prossimo passo corretto, mantenendo pero' esplicita verso l'utente la logica della selezione.

62. `[Autonomy][medio/lungo]` Verificare in modo sistematico che l'AI non finga completezza, avanzamento o verifica oltre le prove realmente disponibili.

63. `[Autonomy][medio/lungo]` Collegare autonomia, temporalita', truthful control plane e capability governance in metriche verificabili e usabili per migliorare il sistema.

70. `[Autonomy][breve]` Verificare che i task marcati "completati" nella lista siano chiusi davvero nel repository e non solo in locale: in particolare `skill-activation.ps1`, `session-start.ps1` e la configurazione hook in `settings.json` — controllare che siano committati e funzionanti nel repo, non solo presenti sulla macchina di sviluppo.

74. `[Autonomy][lungo]` Definire metriche di salute architetturale automatizzabili: file troppo lunghi (>300 righe), responsabilita' miste, drift doc-codice, dead code, circular deps, disallineamento doc-memory. Implementare come `npm run audit:arch-health` che generi un report prioritizzato con aree di intervento. Usare come input periodico per decidere sprint di cleanup o split.

---

## Completati

### Fase 1 — Control plane cognitivo

- ✅ Far comparire in ogni task micro-spiegazione su fonte di verita', strumenti attivati e strumenti esclusi. → *Runtime brief (2026-04-18)* *(ex 1)*
- ✅ Formalizzare regola decisionale su quando la ricerca web e' obbligatoria, facoltativa o inutile. → *Runtime brief (2026-04-18)* *(ex 2)*
- ✅ Far proporre sempre modello e ambiente in base a qualita', costo, velocita', tool disponibili, contesto e rischio. → *Runtime brief (2026-04-18)* *(ex 3)*
- ✅ Far riconoscere automaticamente i capability gap e instradarli verso la primitive corretta. → *Gia' nel runtime brief* *(ex 4)*
- ✅ Impedire che gli esempi dati dall'utente vengano trattati come lista chiusa: ricavare il principio sottostante e applicarlo a tutti i casi analoghi — anche non citati. → *Runtime brief + AGENTS.md sezione "Interpretazione degli esempi" (2026-04-20)* *(ex 5)*
- ✅ Produrre matrice unica `regola -> primitive di enforcement -> verifica`. → *`src/scripts/ruleEnforcementMatrix.ts` + `audit:rule-enforcement` verde (snapshot 24/37, 0 gap meccanizzabili, 2026-04-19)* *(ex 6)*
- ✅ Promuovere a hook o audit bloccante tutte le regole critiche ancora solo testo. → *Tutte le regole meccanizzabili mappate e verificate (2026-04-18)* *(ex 7)*
- ✅ Allineare hook attivi e regole canoniche. → *13/13 hook verificati, matrice allineata con AGENTS.md (2026-04-18)* *(ex 8)*
- ✅ Definire pre-condition e post-condition standard per skill e MCP critici. → *10 skill/MCP coperti in AGENTS.md (2026-04-18)* *(ex 9)*
- ✅ Aggiungere audit dedicato che misuri la copertura reale. → *`npm run audit:rule-enforcement` (2026-04-18)* *(ex 10)*
- ✅ Misurare dai log e dalle violazioni ricorrenti quali decisioni vengono sbagliate. → *`npm run audit:violations` (2026-04-18)* *(ex 11)*
- ✅ Propagazione automatica capability: aggiornare tabelle, pre/post conditions, matrice e docs quando si aggiunge/modifica skill, MCP, hook o workflow. → *AGENTS.md e runtime brief (2026-04-19)* *(ex 82c)*
- ✅ Disciplina di esecuzione sequenziale: completare item N interamente prima di N+1. → *AGENTS.md e runtime brief (2026-04-19)* *(ex 82d)*
- ✅ Ragionamento connessivo: ragionare proattivamente sul grafo di connessioni e aggiornare tutto cio' che e' connesso. → *AGENTS.md e runtime brief (2026-04-19)* *(ex 82e)*
- ✅ Recap e conferma utente prima di implementare task non banali. → *AGENTS.md e runtime brief (2026-04-19)* *(ex 82f)*
- ✅ Contratti espliciti, SSOT per stato condiviso, propagazione fallimenti al top level, no silent bypass safety gate. → *AGENTS.md (2026-04-19)* *(ex 82g)*
- ✅ Classificazione errori per root cause prima del fix; classificazione documenti per ruolo. → *AGENTS.md + runtime brief (2026-04-19)* *(ex 82h)*
- ✅ Skill-activation hook `UserPromptSubmit`: suggerisce skill in base al contenuto del prompt. → *`skill-activation.ps1` in settings.json (2026-04-19)*

### Fase 2 — Contesto, memoria e documenti

- ✅ Provare con casi reali la continuita' tra chat vecchia e chat nuova. → *session-start.ps1 inietta SESSION_HANDOFF.md (2026-04-18)* *(ex 13)*
- ✅ Scrivere style guide esplicita per documenti AI-readable. → *`docs/AI_DOC_STYLE_GUIDE.md` (2026-04-18)* *(ex 15)*
- ✅ Definire segnali oggettivi di context degradation e far proporre l'handoff. → *PreCompact inietta CONTEXT_DEGRADATION_WARNING (2026-04-18)* *(ex 17)*
- ✅ Rendere piu' sistematico l'aggiornamento di memory, worklog e todos. → *stop-session.ps1 controlla worklog + active.md (2026-04-18)* *(ex 18)*
- ✅ Verificare con audit che il requirement ledger resti coperto. → *`npm run audit:ledger` — 14/14 check (2026-04-18)* *(ex 19)*
- ✅ Aggiungere audit che confermi che le skill personalizzate si attivano davvero. → *`npm run audit:skills` — 5/5 critiche verificate (2026-04-18)* *(ex 20)*

### Fase 10 — Cleanup strutturale

- ✅ Blast radius documentale a ogni task: cercare e aggiornare artefatti correlati stale. → *AGENTS.md e runtime brief (2026-04-18)* *(ex 82b)*
- ✅ AGENTS.md slim-down: rimuovere sezioni duplicate con runtime brief e condensare il file. → *476→199 righe (2026-04-19)*
