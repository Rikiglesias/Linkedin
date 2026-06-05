# AGENTS.md — Regole operative di progetto

Questo file e' il riferimento operativo canonico della repo per agenti AI e sessioni di lavoro.
`CLAUDE.md` e' solo un adapter per Claude Code e non deve duplicare logica o backlog.
Le regole globali (P0, L1-L9, parita' ambienti, memoria, anti-dimenticanza) stanno in `~/.claude/CLAUDE.md`.
Le regole di orchestrazione cognitiva, requirement ledger, orizzonti temporali, blast radius documentale e handoff sono in `docs/AI_RUNTIME_BRIEF.md` (reiniettato automaticamente dai hook a ogni prompt).

## Scope: due livelli distinti

Questa repo contiene due livelli che vanno governati separatamente, anche se condividono lo stesso codebase:

1. **Sistema AI globale (ADK)** — l'AI come **programmatore autonomo riusabile**. Regole, skill, hook, subagent, audit, plugin packaging e output styles user-scope. Vive principalmente in `~/.claude/` (globale) + `.claude/rules/`, `.claude-plugin/plugin.json`, `docs/AI_*.md`, `src/scripts/*Audit.ts` (project-side). Gli output styles riusabili vivono in `~/.claude/output-styles/`. E' **portabile su altri progetti** dello stesso utente o di team via `docs/tracking/AI_ADK_DISTRIBUTION.md`. Il backlog di questo livello e' `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md` (13 item).
2. **LinkedIn Bot applicativo** — il runtime del bot (browser, risk engine, antiban, scheduler, proxy, dashboard, n8n workflow). Vive in `src/` (eccetto `src/scripts/*Audit.ts`). E' **specifico di questo dominio**. Il backlog applicativo e' `docs/LINKEDIN_IMPLEMENTATION_LIST.md` + `todos/workflow-architecture-hardening.md`.

**Implicazione per le decisioni**:
- Tool/skill/capability candidato → valutarlo contro **entrambi i livelli** prima di scartare. Una risorsa "fuori scope LinkedIn" puo' essere ottima per il sistema AI globale (es. usabile su altri progetti) e va tracciata come candidate-out-of-current-repo, non scartata.
- Best practice canoniche → vivono nel livello AI globale, applicate ovunque.
- Anti-ban / proxy / LinkedIn-specific → restano nel livello applicativo, non inquinano l'AI globale.
- Audit cross-domain L7 → verifica che ogni file tocchi entrambi i livelli correttamente.

L'utente puo' usare lo stesso sistema AI globale anche su progetti non-LinkedIn (es. chatbot personale, content automation, altri bot/agenti). Quel caso d'uso resta legittimo e va considerato nelle decisioni di capability governance.

## Fonte di verita' e routing strumenti

- Fatto interno stabile → codice, test, log, config, documenti canonici del repo.
- Libreria, API, provider, anti-ban, piattaforma esterna → web/docs ufficiali obbligatori prima di modificare.
- Stato reale sistema esterno → MCP o tool equivalenti; mai supposizioni.
- Procedura cognitiva ripetibile → skill. Regola non dimenticabile → hook. Controllo deterministico → script/test/lint. Automazione durevole → n8n/workflow persistente.
- Documenti, audit e stato reale divergono → bug operativo da correggere subito.
- Best practice non autoreferenziale: "fatto da noi" non significa "migliore possibile". Regole, metodi, capability, hook, skill, MCP, workflow e architetture vanno confrontati periodicamente con fonti ufficiali/recenti prima di dichiararli best practice; tracciare fonte, gap, decisione e verifica.

## Automazione: ordine di promozione

Se un passaggio viene dimenticato piu' di una volta, va promosso:
1. chat/nota → 2. file canonico → 3. checklist/template → 4. skill → 5. hook → 6. script/audit → 7. workflow/n8n.
Azioni ad alto rischio: conferma esplicita. Lettura, quality gate, enforcement, audit, monitoraggio: il piu' automatici possibile.
Se una capability manca in un ambiente, documentare il gap e chiuderlo; non accettarlo per abitudine.

## File canonici da leggere e mantenere allineati

- `README.md`: overview tecnica del progetto e struttura principale.
- `docs/AI_MASTER_SYSTEM_SPEC.md`: sistema AI desiderato completo.
- `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md`: backlog strutturato primario del mancante.
- `docs/AI_IMPLEMENTATION_LIST_GLOBAL.md`: lista lineare item AI/globali per review e pruning.
- `docs/LINKEDIN_IMPLEMENTATION_LIST.md`: lista lineare item LinkedIn-specifici per review e pruning.
- `docs/AI_OPERATING_MODEL.md`: roadmap esplicita su prompt, modelli, skill, agenti, workflow e automazioni.
- `docs/AI_RUNTIME_BRIEF.md`: digest runtime compatto usato dai hook per reiniettare le regole davvero critiche. Non sostituisce i canonici; deve restare allineato a loro.
- `docs/tracking/AI_ORCHESTRATOR_CONTRACT.md`: contratto auditabile per ragionamento AI, capability routing, hook coverage, continuation e truthful completion.
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

## Commit e push — policy operativa esplicita

Regola estratta in `.claude/rules/git-commit-push.md` (path-scoped `**`). Contiene: principi auto-commit/no-auto-push, verifica `audit:git-automation`, enforcement Claude Code + git nativo, trigger auto-push post-commit con precondizioni cumulative, fallback per ambienti senza hook PowerShell (Codex/Cloud Code/Cursor). Modifica lì, non duplicare qui.

## Selezione modello AI per task — regola dura

Regola estratta in `.claude/rules/model-selection.md` (path-scoped `**`). Contiene: principio dichiarazione proattiva, contesto router locale, matrice task → modello, condizioni di switch, formato raccomandazione, anti-pattern. Modifica lì, non duplicare qui.

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

## Meta-reasoning — interpretazione, verifica, proattività

Le 11 meta-regole comportamentali (intento non letterale, fallback context degradation, best practice modifica, cross-domain per file, anti-compiacenza, task multi-categoria, pazienza vs fretta, classificazione temporale, blast radius/ordine, contratti/propagazione fallimenti, interpretazione esempi come pattern) sono estratte in `.claude/rules/meta-reasoning.md` (path-scoped `**`). Modifica lì, non duplicare qui.

## Workflow autonomi continui — `/goal`, `/loop`, Stop hook

Regola estratta in `.claude/rules/autonomous-workflows.md` (path-scoped `**`). Contiene: tabella confronto `/goal` vs `/loop` vs Stop hook, quando usare `/goal` (end state misurabile multi-turno), come scrivere condizione efficace (3 componenti + bounded mode), quando NON usare, comportamento operativo, requisiti, combinazione con auto mode. Modifica lì, non duplicare qui.

### Hook attivi, skill pre/post-conditions, hook n8n futuri

Inventory completo (command hook attivi — conteggio derivato dal canonico `MANAGED_ROUTER_HOOKS` in `~/.claude/scripts/model-router-config.mjs`, non hardcodato — + tabella pre/post-conditions skill/MCP + roadmap hook n8n) in `docs/tracking/AI_HOOK_ENFORCEMENT_PLAN.md`. Pattern file sensibili LinkedIn nei matcher PreToolUse e regole anti-ban in `.claude/rules/browser-antiban.md` + `.claude/rules/workflow-linkedin.md`. Modifica lì, non duplicare qui.

## Workflow obbligatorio per questo progetto

Regola estratta in `.claude/rules/workflow-linkedin.md` (path-scoped `src/**`, `n8n-workflows/**`). Contiene: classificazione task (quick fix / bug bot / feature-modifica bot / refactor-infra), 6 passi obbligatori (pre-modifica → review antiban → planning → impl → verifica → commit), estensioni L1-L9 LinkedIn delta (35 sub-check su L1, L3, L4, L5, L6, L7, L8, L9). Modifica lì, non duplicare qui.

## Cambio chat e continuita' — Obsidian come vista operativa

Fonte primaria per ripartire in nuova chat:

1. `C:\Users\albie\memory\` = memoria vera.
2. `C:\Users\albie\todos\active.md` = priorita correnti.
3. `.claude/CONTINUATION.md` = stato operativo del progetto corrente.
4. Obsidian `C:\Users\albie\Desktop\AI brain\Resources\continuita\START-NEXT-CHAT.md` = vista navigabile di ripartenza.

`SESSION_HANDOFF.md` e `.claude/SESSION_PROMPT.md` sono fallback legacy/storico. Non sono piu' la procedura primaria e non vanno rigenerati come passaggio obbligatorio se `CONTINUATION.md` + Obsidian sono freschi.

`.claude/CONTINUATION.md` deve sempre contenere queste sezioni. Nessuna opzionale.

```markdown
## PROBLEMA CHE STAVAMO RISOLVENDO
[problema reale, non solo task tecnico]

## COSA E STATO COMPLETATO
[punti precisi, con verifica eseguita o mancante]

## DECISIONI CHIAVE (non derivabili dal codice)
[decisioni motivate, non ovvieta]

## DA NON RIPETERE
[tentativi falliti, errori corretti dall'utente, approcci scartati]

## STATO TECNICO ESATTO
[file/stato/git/test/verifiche]

## PROSSIMO PASSO ESATTO
[azione concreta con comando/file/verifica]

## CORREZIONI UTENTE QUESTA SESSIONE
[feedback operativo da salvare o "nessuno"]
```

**Regola di sync**: prima di cambiare chat, aggiornare memoria/todos/worklog se serve, compilare `CONTINUATION.md` senza TODO e sincronizzare Obsidian (`node C:\Users\albie\.claude\scripts\sync-memory-to-obsidian.mjs --verbose`).

**Quando generare/aggiornare**: ctx >85%, fine sessione lunga, compact imminente, cambio progetto/tema, soglie costo-token superate o prima di nuova chat.

**Verifica**: `npm run audit:handoff-staleness` deve passare. Se fallisce, non dichiarare la continuita' pronta.

## Loop di completamento

- Un task non va considerato concluso finche' non ha superato L9 (loop finale di completezza) sui file toccati direttamente e indirettamente — vedi definizione in `~/.claude/CLAUDE.md`.
- Se il task si ferma per conferma utente, limiti operativi o crediti, l'agente deve lasciare stato, blocco e prossimi passi in modo esplicito.
- Alla fine di ogni blocco operativo, completare tutto il completabile nel turno corrente e lasciare sempre continuita' operativa: prossimo passo concreto, blocco reale o domanda specifica. Niente chiusure passive se esiste un'azione successiva ragionevole.
- Prima di chiudere il task l'AI deve anche verificare che nessun obbligo di breve termine sia stato spinto impropriamente su medio/lungo termine e che i follow-up reali siano stati tracciati in modo esplicito.
- A fine ogni blocco tecnico significativo: aggiornare `docs/tracking/ENGINEERING_WORKLOG.md` con data, tema, interventi effettuati e verifica finale.

## Nuovi progetti e bootstrap preventivo

- Quando nasce un progetto nuovo, o quando si vuole riallineare un progetto esistente, usare la checklist in [docs/NEW_PROJECT_BOOTSTRAP_CHECKLIST.md](docs/NEW_PROJECT_BOOTSTRAP_CHECKLIST.md).
- La checklist deve coprire non solo il setup iniziale, ma anche prevenzione tecnica, affidabilita' AI, ambienti, quality gates, rischio dominio, handoff e lungo termine.
- Se un nuovo progetto parte senza questa baseline, il rischio di debito tecnico, contesto implicito e drift operativo cresce subito.
