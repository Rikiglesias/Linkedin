# AGENTS.md — Regole operative di progetto

Questo file e' il riferimento operativo canonico della repo per agenti AI e sessioni di lavoro.
`CLAUDE.md` e' solo un adapter per Claude Code e non deve duplicare logica o backlog.
Le regole globali (P0, L1-L9, parita' ambienti, memoria, anti-dimenticanza) stanno in `~/.claude/CLAUDE.md`.
Le regole di orchestrazione cognitiva, requirement ledger, orizzonti temporali, blast radius documentale e handoff sono in `docs/AI_RUNTIME_BRIEF.md` (reiniettato automaticamente dai hook a ogni prompt).

## Scope: due livelli distinti

Questa repo contiene due livelli che vanno governati separatamente, anche se condividono lo stesso codebase:

1. **Sistema AI globale (ADK)** — l'AI come **programmatore autonomo riusabile**. Regole, skill, hook, subagent, audit, plugin packaging. Vive principalmente in `~/.claude/` (globale) + `.claude/rules/`, `.claude/plugin.json`, `.claude/output-styles/`, `docs/AI_*.md`, `src/scripts/*Audit.ts` (project-side). E' **portabile su altri progetti** dello stesso utente o di team via `docs/tracking/AI_ADK_DISTRIBUTION.md`. Il backlog di questo livello e' `docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md` (13 item).
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

## Intento non letterale — regola dura

Ogni prompt va interpretato come farebbe un senior engineer con pieno contesto, non eseguito meccanicamente.

**Regola**: quando il testo dice X ma il contesto suggerisce Y, interpretare Y, dichiararlo e procedere.

**Trigger obbligatori**:
- dettato vocale → interpretare semanticamente, ignorare errori fonetic
- richiesta tecnicamente sbagliata → dichiararlo PRIMA, non dopo
- richiesta che contraddice un canonico o una decisione passata → segnalarlo
- richiesta che potrebbe causare ban → rispondere con domanda zero antiban

**Test di conformita'** (verificare su questi scenari):
1. Utente dice "cancella il file X" ma X e' un log critico → dichiarare rischio, chiedere conferma
2. Utente dice "disabilita il delay" → rispondere con antiban check, non eseguire
3. Utente dice "fai quello di prima" senza contesto → chiedere chiarimento, non inventare

## Fallback context degradation — protocollo

Quando il context window supera soglia critica o il ragionamento mostra segnali di degrado:

**Soglie**:
- ctx >70% → attivare `lean-ctx` MCP, ridurre verbosità
- ctx >85% → proporre `context-handoff` prima di compattare
- ctx >95% → fermarsi, eseguire handoff, non continuare

**Procedura handoff** (da eseguire prima della compattazione):
1. `Grep` caller dei moduli toccati — blast radius reale
2. Aggiornare `todos/active.md` con stato corrente
3. Aggiornare `docs/tracking/ENGINEERING_WORKLOG.md`
4. Eseguire skill `context-handoff` → genera `SESSION_HANDOFF.md`
5. Committare se L1 verde

**Segnali di degrado** (oltre ctx%):
- ripetizione di stesse domande già risolte
- dimenticanza di decisioni prese nella stessa sessione
- risposta che ignora constraint dichiarati all'inizio

**Fallback tool**: `context-compression` skill, `lean-ctx` MCP, `latent-briefing` skill per multi-agent.

## Best practice per ogni modifica — regola dura

Ogni modifica al codice deve seguire questo ordine. Nessuna eccezione.

1. **Blast radius prima** — mappare file toccati direttamente e indirettamente
2. **Contratti** — verificare input/output/side-effect di ogni funzione modificata
3. **Dipendenze** — controllare import, export, caller toccati
4. **Test impattati** — identificare e rieseguire i test che coprono il perimetro
5. **Nessuna modifica parziale** — tutto o niente, verificato e completo

**Non dichiarare chiuso** se:
- un caller è stato modificato ma non verificato
- un test impattato non è stato rieseguito
- un contratto è cambiato ma non propagato ai consumer

**Escalation**: se il perimetro è maggiore del previsto → fermarsi, ridisegnare scope, comunicare.

## Cross-domain per ogni file — regola dura

Ogni file toccato deve essere valutato su TUTTI i domini, non solo il tema principale.

**Domini da verificare** (checklist mentale obbligatoria per ogni file):

| Dominio | Domanda |
|---------|---------|
| Sicurezza | Input validato? Auth rispettata? Segreti esposti? |
| Anti-ban | Tocca browser/timing/stealth/LinkedIn? → antiban-review |
| Architettura | Circular deps? SRP rispettata? Contratto pulito? |
| Timing/performance | Timeout? Leak? Busy wait? |
| Compliance | Dati personali? GDPR? Log sensibili? |
| Observability | Log strutturati? Alert dicono cosa fare? |

**Tool**: `antiban-review` per file LinkedIn, `security-reviewer` per auth/input, `silent-failure-hunter` post-refactor.

**Non è sufficiente** verificare solo il dominio principale della modifica.

## Anti-compiacenza — regola dura

L'AI deve contestare richieste sbagliate o rischiose PRIMA di eseguirle.

**Quando contestare obbligatoriamente**:
- richiesta che contraddice un canonico o decisione passata
- richiesta che aumenta rischio ban LinkedIn
- richiesta che disabilita un gate di sicurezza
- richiesta con assunzione tecnica errata evidente
- richiesta di dichiarare "fatto" senza verifica reale

**Come contestare**:
1. Dichiarare il problema in modo esplicito e motivato
2. Proporre alternativa corretta
3. Procedere solo dopo conferma consapevole dell'utente

**Scenari di test**:
1. "Disabilita il delay tra azioni" → bloccare, antiban check, proporre varianza invece
2. "Questo è già testato, skippa i test" → dichiarare rischio, non saltare
3. "Fai il push diretto su main" → dichiarare policy, chiedere conferma esplicita

**NON è anti-compiacenza**: chiedere conferma su ogni cosa banale. Solo su rischi reali.

## Task multi-categoria — proattività proattiva

Quando l'utente dichiara un task con **N categorie/step indipendenti** (es. "audit best practice per 13 categorie file", "chiudi tutti gli item del backlog chiudibili", "fai tutti i fix di sicurezza"), l'AI deve **procedere proattivamente** categoria dopo categoria senza chiedere conferma intermedia ad ogni step.

**Trigger**:
- Task esplicitamente multi-categoria con lista enumerata dall'utente
- Approvazione iniziale dell'approccio (es. "A" o "ok procedi")
- Nessun rischio invasivo per categoria (no destructive, no production)

**Procedura**:
1. Dichiarare brevemente la sequenza ("ora categoria N: X")
2. Eseguire la categoria completa (web search + audit + fix + commit)
3. Passare alla successiva senza chiedere "continuo?"
4. Fermarsi SOLO se:
   - Context window critico (>80% pieno)
   - Errore inaspettato che richiede decisione utente
   - Modifica strutturale invasiva non prevista nel piano iniziale
   - Bug/blocker che richiede chiarimento

**Anti-pattern da evitare**:
- "Vuoi che continui con la prossima?" dopo ogni categoria approvata
- Recap intermedio + domanda quando l'utente ha gia' dato approvazione iniziale
- Fermare proattivita' su task ben definito

**Quando invece chiedere ancora**:
- Categoria che cambia scope (es. da audit a refactor invasivo)
- Trade-off architetturale (es. split AGENTS.md in path-scoped rules)
- Costo / tempo significativamente sopra stima iniziale

## Pazienza vs fretta — regola dura

Preferire **lentezza con verifica** a velocità con omissioni. "Aver fatto qualcosa" ≠ "aver fatto qualcosa verificato".

**Rallenta quando**: task ≥3 step (→ `/goal`); 5+ tool call senza recap (→ "verificato X, resta Y, bloccatori Z"); sensazione di "chiudere il turno" (segnale di fretta); risposta finale lunga (esplicitare per ogni file cosa è verificato e cosa saltato).

**Anti-pattern**: tirare via senza verificare file diretti+indiretti, "fatto visibile" trattato come "fatto verificato", saltare web search "credo di sapere", risposte cumulative che nascondono step saltati, dichiarare DONE solo per dimostrare progresso, saltare classificazione temporale.

**Preferire `/goal`**: end state misurabile sopra 3 turn (`audit X verde + test Y + count Z`). Esempio: `/goal all audit green and commit pushed or stop after 10 turns` invece di "faccio tutto frettolosamente".

**Preferire `/loop`**: task ricorrente con stato che cambia nel tempo (CI, deploy, queue). Esempio: `/loop 30m npm run audit:miss-metrics`.

**Stop intermedi obbligatori**: dopo ogni 5 tool call → recap 1 riga; prima di commit → enumerare staged e perché.

## Classificazione temporale del task — regola dura

Per ogni task non banale, dichiarare orizzonte prima di pianificare:

| Orizzonte | Significato | Esempio |
|---|---|---|
| **breve** | Sessione corrente o entro 1 settimana | Bug fix, feature piccola, docs |
| **medio** | 1-4 settimane, multi-sessione | Refactor area, nuovo modulo, integrazione |
| **lungo** | Mesi, milestone | Riarchitettura, pacchetto, parity ambienti |

**Quando obbligatorio**: task multi-file/multi-dominio, dipendenze esterne, backlog con sub-task, manutenzione ricorrente.

**Regole**:
1. Dichiarare l'orizzonte in 1 riga prima della pianificazione
2. **Non rinviare obblighi brevi nel medio/lungo termine** — task brevi vanno fatti nella sessione o documentati come BLOCKED con motivo
3. Task medio/lungo → spezzare in milestone con orizzonte breve verificabile
4. Manutenzione ricorrente → cadenza esplicita (`audit:weekly`/`audit:monthly` o Task Scheduler)

**Anti-pattern**: usare medio/lungo come parcheggio per task chiudibili oggi.

## Workflow autonomi continui — `/goal`, `/loop`, Stop hook

Regola estratta in `.claude/rules/autonomous-workflows.md` (path-scoped `**`). Contiene: tabella confronto `/goal` vs `/loop` vs Stop hook, quando usare `/goal` (end state misurabile multi-turno), come scrivere condizione efficace (3 componenti + bounded mode), quando NON usare, comportamento operativo, requisiti, combinazione con auto mode. Modifica lì, non duplicare qui.

## Blast radius e ordine di esecuzione

1. Mappare file toccati direttamente e indirettamente (dipendenze, import, contratti, integrazioni).
2. Identificare i domini coinvolti: sicurezza, architettura, workflow, automazione, performance, tipi, error handling, documentazione.
3. Stabilire ordine delle modifiche prima di iniziare, per non rompere collegamenti a meta' lavoro.
4. Se il perimetro e' grande, usare code search, mapping dipendenze/test, memoria e agenti esplorativi.

## Contratti, stato e propagazione dei fallimenti

- Ogni funzione/modulo/workflow: contratto esplicito (input, output, side effect). Side effect non dichiarati = bug architetturale.
- Stato condiviso da piu' consumatori: una sola fonte di verita' autoritativa. Copie divergenti = bug.
- Fallimenti critici: propagarsi fino al livello che puo' agire. Swallowing silenzioso = bug operativo. Root cause diverse richiedono recovery diverse.

## Interpretazione degli esempi: ragionamento per pattern

Quando l'utente fornisce esempi come input:

- gli esempi mostrano il TIPO di ragionamento richiesto, non la lista completa dei casi da coprire
- identificare il principio sottostante all'esempio (non il caso specifico)
- decomporre argomento o esempio in albero dell'argomento: sottopunti, sotto-sottopunti e rami correlati
- per ogni ramo rivalutare fonte corretta, web/docs/MCP, skill/capability, rischi, verifiche e done criteria
- applicare quel principio a TUTTI i casi analoghi — anche quelli non citati esplicitamente dall'utente
- se l'utente porta 2 scenari, chiedersi: quanti altri scenari analoghi tocca lo stesso principio?
- non dichiarare concluso un ragionamento limitandosi ai soli esempi forniti
- questo vale per rischi tecnici, controlli di qualita', pattern documentali e regole operative

### Hook attivi, skill pre/post-conditions, hook n8n futuri

Inventory completo (34 command hook attivi + tabella pre/post-conditions skill/MCP + roadmap hook n8n) in `docs/tracking/AI_HOOK_ENFORCEMENT_PLAN.md`. Pattern file sensibili LinkedIn nei matcher PreToolUse e regole anti-ban in `.claude/rules/browser-antiban.md` + `.claude/rules/workflow-linkedin.md`. Modifica lì, non duplicare qui.

## Workflow obbligatorio per questo progetto

Regola estratta in `.claude/rules/workflow-linkedin.md` (path-scoped `src/**`, `workflows/**`). Contiene: classificazione task (quick fix / bug bot / feature-modifica bot / refactor-infra), 6 passi obbligatori (pre-modifica → review antiban → planning → impl → verifica → commit), estensioni L1-L9 LinkedIn delta (35 sub-check su L1, L3, L4, L5, L6, L7, L8, L9). Modifica lì, non duplicare qui.

## Context Handoff — schema minimo garantito

`SESSION_HANDOFF.md` deve sempre contenere queste sezioni. Nessuna opzionale.

```markdown
## Obiettivi correnti
[cosa stavo cercando di fare — 1-3 bullet]

## Decisioni prese
[decisioni tecniche non ovvie prese in questa sessione]

## Blast radius identificato
[file toccati direttamente + file impattati indirettamente]

## Stato implementazione
[DONE / IN PROGRESS / BLOCKED per ogni blocco di lavoro]

## Verifiche completate
[L1-L9 completati: quali sì, quali no e perché]

## Blocchi aperti
[problemi irrisolti con causa esplicita]

## Prossimi passi
[azioni concrete ordinate per priorità]
```

**Differenza da SESSION_HANDOFF.md automatico**: questo schema è il template minimo verificabile. Il file automatico può aggiungere sezioni ma non togliere queste.

**Quando generare**: ctx >85%, fine sessione lunga, prima di cambio progetto.

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
