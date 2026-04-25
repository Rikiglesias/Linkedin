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

1. `[Control plane][breve/medio]` Promuovere L2-L6 → **HOLD** 2026-04-25. Dati audit:violations: solo 2 violation entries in tutta la storia, 0 miss ricorrenti identificati sullo stesso controllo. Condizione di promozione non raggiunta. Reverificare dopo 20+ sessioni di lavoro reale. Strumenti pronti: `AI_LEVEL_ENFORCEMENT.json`, `skill-activation.ps1`, `npm run audit:violations`.

2. ✅ `[Control plane][medio/lungo]` Inventario tool esterni consolidato — aggiornato 2026-04-25. Tool attivi: MCP (code-review-graph, lean-ctx, symdex, claude-peers), skill (autoresearch +9 comandi, paul +20 comandi, context-engineering 5 skill, multi-agent-patterns, memory-systems, latent-briefing, obsidian-* 5 skill, cli-anything +7 skill, ECC agents 6), CLI (codeburn, rtk, dippy, bun), vault (obsidian-mind in Desktop/Brain). Duplicati rimossi: evaluation, database-optimizer, prompt-template-wizard, mcp-builder. AI_CAPABILITY_ROUTING.json aggiornato con 12 nuove capability e 4 nuovi domain. → *(2026-04-25)*

64. ✅ `[Control plane][breve/medio]` Regola intento non letterale codificata in `AGENTS.md` §"Intento non letterale" con trigger obbligatori e 3 scenari di test espliciti. Già presente in `~/.claude/CLAUDE.md` §P0. → *(2026-04-25)*

65. ✅ `[Control plane][medio]` Best practice per ogni modifica codificata in `AGENTS.md` §"Best practice per ogni modifica": ordine obbligatorio in 5 passi, criteri di non-chiusura, escalation. → *(2026-04-25)*

66. ✅ `[Control plane][medio]` Cross-domain per ogni file codificato in `AGENTS.md` §"Cross-domain per ogni file": checklist 6 domini (sicurezza/anti-ban/architettura/timing/compliance/observability) con domanda specifica per ciascuno + tool da usare. → *(2026-04-25)*

80. ✅ `[Control plane][breve]` Hook `multi-file-recap-check.ps1` creato e registrato in `settings.json` UserPromptSubmit: rileva task multi-file/complessi, inietta reminder recap strutturato. File: `hooks/multi-file-recap-check.ps1` + repo `hooks/`. **Nota:** implementazione advisory (non deny hook) — il PreToolUse deny richiederebbe tracking di stato cross-prompt. Da verificare su 3 sessioni consecutive per criterio done completo. → *(2026-04-21)*

73. ✅ `[Control plane][medio]` Anti-compiacenza codificata in `AGENTS.md` §"Anti-compiacenza": trigger obbligatori, procedura in 3 passi, 3 scenari di test espliciti (delay LinkedIn, skip test, push su main). → *(2026-04-25)*

75. ✅ `[Control plane][breve/medio]` Completato inventario skill: 2 skill vuote rimosse (`analyze-issue`, `review-pr`), 2 skill nuove create (`token-efficiency`, `linkedin-patterns`), `context-handoff` verificata. Cross-reference con SKILL_TABLE.md fatto. → *173 skill attive* *(2026-04-21)*

77. ✅ `[Control plane][breve]` Gap analysis skill completata: domini frequenti coperti — TypeScript (`typescript-pro`), testing (`test-master`, `fix-tests`, `webapp-testing`), architettura (`architecture-designer`, `microservices-architect`), gestione contesto (`context-handoff`, `memoria`), anti-ban (`antiban-review`, `linkedin-patterns`), efficienza token (`token-efficiency`), feature dev (`feature-dev`), token compression (`caveman`). SKILL_TABLE.md allineata. → *Nessun dominio frequente senza skill dedicata* *(2026-04-21)*

### Fase 2 — Contesto, memoria e documenti leggibili dall'AI

3. ✅ `[Memory][medio]` Style guide applicata 2026-04-25: `AI_MASTER_SYSTEM_SPEC.md` e `AI_OPERATING_MODEL.md` aggiornati con summary iniziale, "cosa contiene/non contiene", cross-link espliciti. `CAPABILITY_MATRIX.md` creato AI-readable. File rispettano ora la guida in `docs/AI_DOC_STYLE_GUIDE.md`. File ancora sopra soglia per dimensione ma strutturalmente conformi. → *(2026-04-25)*

67. ✅ `[Memory][medio]` Skill `context-handoff` creata e verificata — pre/post conditions, template, attivazione interattiva. → *esistente e funzionante* *(2026-04-21)*

71. ✅ `[Memory][medio]` Protocollo fallback context degradation codificato in `AGENTS.md` §"Fallback context degradation": soglie ctx (70%/85%/95%), procedura handoff 5 passi, segnali di degrado, fallback tool (lean-ctx, context-compression, latent-briefing). → *(2026-04-25)*

72. ✅ `[Memory][medio]` Schema minimo Context Handoff definito in `AGENTS.md` §"Context Handoff" (7 sezioni obbligatorie) e aggiunto alla skill `context-handoff` come tabella schema. Distinzione SESSION_HANDOFF.md automatico vs schema strutturato esplicitata. → *(2026-04-25)*

### Fase 3 — Parita' ambienti

4. ✅ `[Parity][medio]` Capability matrix creata: `docs/tracking/CAPABILITY_MATRIX.md` — contratto operativo per Claude Code / Codex / Cursor su 30+ capability. Regola: Codex solo per task interni puri, tutto il resto Claude Code. → *(2026-04-25)*

5. ✅ `[Parity][medio]` Gap documentati in CAPABILITY_MATRIX.md: Codex manca hook/memoria/MCP/skill. Fallback espliciti per ogni gap. Policy ambiente per tipo task. → *(2026-04-25)*

6. ✅ `[Parity][breve/medio]` Stabilizzati problemi operativi: settings.json valido (JSON corretto, hooks attivi, modello configurato), SessionStart hook funzionante (session-start.ps1 + inject-runtime-brief), skill critiche verificate (antiban-review, context-handoff, loop-codex), plugin `feature-dev` installato, 2 skill vuote rimosse (`analyze-issue`, `review-pr`), 2 nuove skill create (`token-efficiency`, `linkedin-patterns`). OpenRouter switching funzionale (model corrente: qwen/qwen3.6-plus). → *(2026-04-21)*

7. ✅ `[Parity][medio]` Migrazione Codex: decisione 2026-04-25 — NO migrazione attiva. Codex usabile solo per task interni puri (refactor, fix read-only) dove non serve MCP/hook/skill. Documentato in `docs/tracking/CAPABILITY_MATRIX.md` §"Policy ambiente per tipo task". → *(2026-04-25)*

68. ✅ `[Parity][medio]` Loop con verifica completa implementato in skill `loop-codex`: decomposizione obbligatoria, verifica L9 dopo ogni sotto-task, max 3 iterazioni per sotto-task, DONE/BLOCKED esplicito, auto-commit se verde. → *(già esistente, verificato 2026-04-25)*

8. ✅ `[Parity][medio/lungo]` Policy ambiente codificata in `docs/tracking/CAPABILITY_MATRIX.md` — tabella tipo task → ambiente con motivazione. Aggiornare quando cambiano capability. → *(2026-04-25)*

### Fase 4 — Strumenti locali e supporto personale

9. `[Local tools][medio]` Dettatura locale stabile — HOLD. Dipende da setup hardware. Usare `prompt-improver` skill come fallback per input vocali difettosi.

10. `[Local tools][medio]` Trade-off dettatura locale vs Windows — HOLD. Decisione da prendere dopo stabilizzazione hardware.

11. `[Local tools][medio]` Fix colli di bottiglia PC — HOLD. Task separato da pianificare quando si ha tempo dedicato.

12. ✅ `[Local tools][medio]` Prompt helper: skill `prompt-improver` già installata — ripara dettati vocali grezzi, interpreta intento, propone chiarimenti. → *(già presente, verificato 2026-04-25)*

### Fase 8 — Git, review e chiusura corretta

39. ✅ `[Git][breve/medio]` Commit/push fuori Claude Code: Codex ha git nativo, Cursor/Windsurf manuale. Gap documentato in `CAPABILITY_MATRIX.md`. In Claude Code: hook bloccanti `pre-bash-l1-gate.ps1` + `pre-bash-git-gate.ps1` enforced. → *(2026-04-25)*

40. ✅ `[Git][breve/medio]` Commit come chiusura verificata codificato in `AGENTS.md` §"Commit e push": auto-commit by default dopo gate verdi, no commit cieco, condizioni esplicite. Enforcement meccanico attivo. → *(già esistente, verificato 2026-04-25)*

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
