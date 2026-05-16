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

L'AI deve preferire **lentezza con verifica** a velocità con omissioni. Mostrare di "aver fatto qualcosa" non sostituisce aver fatto qualcosa **verificato**.

**Trigger automatici per rallentare**:
- Task con ≥ 3 step distinti → considerare `/goal <condition>` o decomposizione esplicita in milestone visibili
- Modello ha eseguito 5+ tool call senza fermarsi a verificare un risultato intermedio → fermarsi e dichiarare cosa è già verificato vs cosa resta
- Risposta finale lunga che cita molti file toccati → esplicitare per ogni file: cosa cambia, cosa è verificato, cosa è stato saltato e perché
- Sensazione interna di "voglio chiudere il turno" → segnale di fretta, fermarsi e applicare ledger

**Anti-pattern espliciti**:
- "Tirare via per chiudere il turno" senza verificare ogni file diretto + indiretto toccato
- "Aver fatto qualcosa visibile" trattato come prova di "aver fatto qualcosa verificato"
- Saltare web search "tanto credo di sapere già" su libreria/API/provider potenzialmente cambiata
- Risposte cumulative finali che nascondono step saltati (es. "tutti i sub-task chiusi" senza enumerarli con prova)
- Dichiarare DONE per lo stesso turno solo perché serve dimostrare progresso
- Saltare la classificazione temporale per "fare prima"

**Quando preferire `/goal` invece di rispondere tutto in un turno**:
- End state misurabile esiste (`audit X verde`, `test Y passa`, `queue Z vuota`) e sopra 3 turn previsti
- Esempio: invece di "faccio tutti gli audit + commit + push in questo turno frettolosamente" → `/goal all audit return green and commit pushed and audit:handoff-staleness 6/6 or stop after 10 turns`. L'evaluator Haiku verifica per te, niente false completion.

**Quando preferire `/loop` invece di pretendere di fare tutto subito**:
- Task ricorrente con stato che cambia nel tempo (CI run, deploy, queue), tu non vuoi tenere occupata la sessione
- Esempio: monitor hook activations log → `/loop 30m npm run audit:miss-metrics`

**Trigger di stop intermedio obbligatorio**:
- Dopo ogni gruppo di 5 tool call non triviali → recap di 1 riga: "Verificato X. Da fare ancora Y. Bloccatori: Z."
- Prima di un commit → enumerare cosa è in stage e perché, non assumere

**Scenari di test**:
1. "Fai tutti i punti 1-13 del backlog" → rallentare, classificare quali sono chiudibili oggi vs prerequisiti, non simulare di averli chiusi tutti
2. "Risolvi tutti i bug" → `/goal` con condizione verificabile, non passare a uno nuovo senza prova del precedente
3. Task lungo che attraversa 30 turn → fermarsi a meta', recap, conferma utente prima di proseguire

**Misura indiretta**: il hook `stop-proactive-next-step.ps1` (107 hit/7d) gia' richiede prossimo passo concreto a ogni Stop. Una promozione futura potrebbe contare "sub-step dichiarati saltati" per turn class.

## Classificazione temporale del task — regola dura

Per ogni task non banale, prima di pianificare, **classificare l'orizzonte temporale**:

| Orizzonte | Significato | Esempio |
|---|---|---|
| **breve** | Da chiudere in questa sessione o entro 1 settimana | Bug fix, feature piccola, documentazione |
| **medio** | Da chiudere in 1-4 settimane, multi-sessione | Refactor area, nuovo modulo, integrazione |
| **lungo** | Mesi, milestone, iniziativa | Riarchitettura, pacchetto distribuito, parity ambienti |

**Quando classificare obbligatoriamente**:
- Task multi-file o multi-dominio
- Task che dipendono da decisioni esterne o input utente
- Backlog item con sub-task
- Manutenzione ricorrente (audit, review, cleanup)

**Come usarlo**:
1. Dichiarare l'orizzonte in 1 riga prima della pianificazione: "Orizzonte: breve / medio / lungo"
2. **Non rinviare obblighi brevi nel medio/lungo termine** — i task brevi vanno fatti nella sessione corrente o documentati come blocked con motivo concreto
3. Task medio/lungo → spezzarli in milestone con orizzonte breve verificabile
4. Manutenzione ricorrente → cadenza esplicita (settimanale, mensile) via `audit:weekly` / `audit:monthly` o Windows Task Scheduler

**Scenari di test**:
1. "Aggiungi feature X complessa" → "Orizzonte: medio. Sub-milestone breve: scaffold + test base"
2. "Aggiorna la docs" → "Orizzonte: breve" + fare adesso
3. "Migra tutto a Codex" → "Orizzonte: lungo. Sub-milestone breve: matrice capability + test smoke 1 modulo"

**Anti-pattern**: usare medio/lungo termine come parcheggio per task che potresti fare subito. Se chiudibile oggi → orizzonte breve, fallo.

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

### Hook attivi (aggiornato al 2026-05-09)

Configurazione attiva in `~/.claude/settings.json`: 34 command hook. Non aumentare il numero per abitudine: prima misurare miss reali e promuovere solo controlli deterministici o advisory ad alto valore.

| Evento | Tipo | Trigger | Azione | File log |
|--------|------|---------|--------|----------|
| `SessionStart` | sync | Inizio sessione | `ensure-claude-model-router.ps1` mantiene il router modello pronto | n/a |
| `SessionStart` | sync | Inizio sessione | `merge-canonical-settings.mjs` riallinea settings canonici | n/a |
| `SessionStart` | sync | Inizio sessione | `session-start.ps1` carica memoria globale, todos, indice memoria progetto e `AI_RUNTIME_BRIEF.md` | n/a |
| `SessionStart` | sync | Inizio sessione | `session-start-continuation.ps1` reinietta eventuale continuita' della sessione precedente | n/a |
| `UserPromptSubmit` | sync | Ogni prompt | `ensure-claude-model-router.ps1` mantiene stabile provider/modello | n/a |
| `UserPromptSubmit` | sync | Ogni prompt | `inject-runtime-brief.ps1 UserPromptSubmit` reinietta runtime brief con gerarchia P0 | n/a |
| `UserPromptSubmit` | sync advisory | Ogni prompt | `skill-activation.ps1` propone P0 compatto, fonte, skill/MCP/web/loop e focus L2-L9 | n/a |
| `UserPromptSubmit` | sync advisory | Task multi-file/complesso | `multi-file-recap-check.ps1` richiede recap e blast radius prima delle patch | `memory/recap-check-log.txt` |
| `UserPromptSubmit` | sync advisory | Prompt di fix/correzione | `pre-edit-verify-intent.ps1` richiede lettura codice reale e verifica problema prima di agire | n/a |
| `UserPromptSubmit` | sync advisory | Pending dirty da sessione precedente | `user-prompt-commit-gate.ps1` reinietta obbligo di chiudere o dichiarare il blocco git | n/a |
| `UserPromptSubmit` | sync advisory | Prompt con dominio modello chiaro | `user-prompt-model-suggestion.ps1` suggerisce modello/ambiente corretto | `memory/model-suggestion-log.txt` |
| `PreToolUse` | blocking | Edit/Write/MultiEdit su file sensibili LinkedIn | `pre-edit-antiban.ps1` blocca senza `/antiban-review` | `memory/antiban-hook-log.txt` |
| `PreToolUse` | blocking | Edit/Write/MultiEdit su segreti/file sensibili | `pre-edit-secrets.ps1` blocca secret o path vietati | `memory/rule-violations-log.txt` |
| `PreToolUse` | advisory | Edit/Write/MultiEdit | `pre-edit-best-practice.ps1` inietta best practice e policy web per tipo file | `memory/best-practice-log.txt` |
| `PreToolUse` | blocking | Bash con `git commit` | `pre-bash-l1-gate.ps1` richiede quality gate recente | `memory/rule-violations-log.txt` |
| `PreToolUse` | blocking | Bash con `git commit` / `git push` | `pre-bash-git-gate.ps1` blocca stato git non coerente | `memory/rule-violations-log.txt` |
| `PreToolUse` | blocking/advisory | MCP ad alto impatto | `pre-mcp-guard.ps1` blocca operazioni distruttive e avvisa su azioni rischiose | n/a |
| `PreCompact` | sync | Prima compact | `inject-runtime-brief.ps1 PreCompact` reinietta runtime brief | n/a |
| `PreCompact` | sync advisory | Prima compact | `pre-compact-handoff.ps1` crea `.claude/CONTINUATION.md` e forza handoff operativo | `memory/compact-handoff-log.txt` |
| `PostToolUse` | async | Bash con quality command | `post-bash-quality-log.ps1` logga comandi qualita' | `memory/quality-hook-log.txt` |
| `PostToolUse` | async | Bash con gate/git | `post-bash-git-audit.ps1` logga readiness git | `memory/git-hook-log.txt` |
| `PostToolUse` | async | Edit/Write/MultiEdit su file >300 righe | `file-size-check.ps1` logga avviso split | `memory/file-size-log.txt` |
| `PostToolUse` | async | Edit/Write/MultiEdit su file sensibili LinkedIn | `post-edit-antiban-audit.ps1` logga possibili miss anti-ban | `memory/rule-violations-log.txt` |
| `PostToolUse` | async gated | `.claude/REQUEST_COMMIT` / `.claude/REQUEST_PUSH` | `post-edit-request-action.ps1` esegue commit/push solo dopo `post-modifiche` e `audit:git-automation:strict:*` | `memory/request-action-log.txt` |
| `PostToolUse` | sync advisory | Edit/Write/MultiEdit su codice | `post-edit-verify-checklist.ps1` richiede dichiarazione L2-L6 applicabile | n/a |
| `PostToolUse` | sync advisory | Edit/Write/MultiEdit | `post-edit-codebase-hygiene.ps1` richiede valutazione pulizia file diretto/indiretto, duplicati, sostituzioni, split e follow-up | `memory/codebase-hygiene-log.txt` |
| `PostToolUse` | async | WebSearch | `post-websearch-log.ps1` logga query e risultati principali | `memory/websearch-log.txt` |
| `Stop` | async | Fine sessione | `stop-session.ps1` logga sessione e warning memoria/worklog | `memory/session-log.txt` |
| `Stop` | sync advisory | Fine sessione con working tree dirty | `pre-stop-commit-gate.ps1` scrive pending commit gate per turno successivo | `memory/stop-commit-gate-log.txt` |
| `Stop` | sync advisory | Fine risposta operativa | `stop-proactive-next-step.ps1` reinietta obbligo di prossimo passo concreto, blocco reale o domanda specifica | `memory/proactive-next-step-log.txt` |
| `SubagentStop` | async | Subagent concluso | `subagent-stop.ps1` logga summary subagent | `memory/subagent-log.txt` |
| `TeammateIdle` | async | Agent team idle | `teammate-event.ps1` log teams | `memory/teams-log.txt` |
| `TaskCreated` | async | Agent team task creato | `teammate-event.ps1` log teams | `memory/teams-log.txt` |
| `TaskCompleted` | async | Agent team task completato | `teammate-event.ps1` log teams | `memory/teams-log.txt` |

### Pattern file sensibili LinkedIn (PreToolUse matcher)

I file che triggerano il pre-hook antiban contengono nel path o nel nome: `browser`, `playwright`, `stealth`, `fingerprint`, `timing`, `delay`, `session`, `humanDelay`, `inputBlock`, `clickLocator`, `inviteWorker`, `inboxWorker`, `organicContent`, `syncSearch`, `syncList`, `sendInvites`, `sendMessages`.

### Pre/post-conditions nelle skill e MCP critici

| Skill / MCP | Pre-conditions | Post-conditions |
|-------------|---------------|-----------------|
| `antiban-review` | File sensibile LinkedIn, azione browser, cambio volume | Verdetto SICURO/ATTENZIONE/BLOCCO con azione successiva |
| `loop-codex` | L1 pulito, task con criteri misurabili, scope no-antiban | Auto-commit se DONE, update ENGINEERING_WORKLOG |
| `context-handoff` | Git status pulito o documentato, memoria aggiornata, active.md coerente | SESSION_HANDOFF.md committato, active.md aggiornato |
| `debugging-wizard` | Errore riproducibile o log disponibile, primo tentativo di debug | Root cause identificata o escalation a `systematic-debugging` |
| `verification-protocol` (L7-L9) | Implementazione completata, L1-L6 gia' verificati | Esito DONE o BLOCKED con causa esplicita |
| `typescript-pro` | Task TS con logica non banale, codebase TS presente | Codice conforme a pattern progetto, typecheck pulito |
| `code-review` | PR creata o diff locale significativo, area core/sicurezza/DB | Commenti con severity, no falsi positivi su stile |
| `audit-rules` | Sospetto violazione regole operative o audit periodico | Report gap con azione correttiva |
| MCP Supabase | Query o migrazione DB necessaria, credenziali configurate | Risultato query o migration applicata, tipi aggiornati se serve |
| MCP Playwright | Bug UI non riproducibile da log, pagina accessibile | Screenshot o DOM snapshot, diagnosi visiva |

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

Estensioni LinkedIn ai livelli globali (vedi L1-L9 in `~/.claude/CLAUDE.md` per i livelli completi). Sono **delta sopra** i sub-check globali, non sostituzioni.

**L1 LinkedIn**:
- L1-LI.1 build progetto exit 0 (frontend + backend se toccati)
- L1-LI.2 `madge --circular` su `src/risk/`, `src/scheduler/`, `src/auth/`, `src/stealth/`, `src/browser/`
- L1-LI.3 coverage adeguata sui moduli critici: risk engine, scheduler, auth, stealth, antiban
- L1-LI.4 nessun file LinkedIn-sensibile (browser, stealth, fingerprint, timing) >300 righe senza split-plan
- L1-LI.5 audit npm di dominio (`npm run audit:hooks`, `audit:ai-control-plane`) verdi se area toccata

**L3 LinkedIn**:
- L3-LI.1 memory leak: listener Playwright/browser context chiusi, page.close() in ogni branch
- L3-LI.2 timeout esplicito su ogni `clickLocator`, `waitFor`, `goto` (no default infinito)
- L3-LI.3 stealth pattern: nessuna `setTimeout` con valore fisso prevedibile (sempre varianza ±30%+)
- L3-LI.4 transazione DB busy_timeout configurato (no deadlock su SQLite)
- L3-LI.5 selettori CSS/XPath: fallback chain se il principale fallisce, log selettore usato

**L4 LinkedIn worst-case**:
- L4-LI.1 scenario multi-giorno: state recovery dopo crash, scheduler riprende dal punto corretto
- L4-LI.2 pause durante invito: salvataggio stato + reumana il pickup
- L4-LI.3 aggiornamento selettori: ogni cambio LinkedIn DOM ha selector versioning + alert
- L4-LI.4 pending ratio sale sopra soglia → pause automatica del flusso outbound
- L4-LI.5 fingerprint mutation: cambio coerente non contraddittorio (canvas + UA + lingua + tz)

**L5 LinkedIn — alert e prodotto**:
- L5-LI.1 alert Telegram strutturato: WHAT (cosa è successo), WHY (causa probabile), DO (azione utente concreta)
- L5-LI.2 report giornaliero include: invii fatti, accept rate, reply rate, pending ratio, alert attivi
- L5-LI.3 dashboard mostra stato real-time (running, paused, error) con timestamp ultima azione
- L5-LI.4 nessun silent failure: ogni eccezione browser propagata fino a livello che genera alert
- L5-LI.5 storico azioni LinkedIn auditabile (chi/quando/cosa/risultato per ogni invio/messaggio)

**L6 LinkedIn — data flow E2E**:
- L6-LI.1 percorso completo: migration SQL → repository → API → frontend → report
- L6-LI.2 env vars validati: proxy URL, account credentials, Telegram token, Supabase keys
- L6-LI.3 proxy classification: residential vs DC corretto per account, regione coerente con fingerprint
- L6-LI.4 cookie/session storage: persistenza cifrata, no plain text su disco
- L6-LI.5 migration DB: backward-compat se schema cambia (Supabase + SQLite locale)
- L6-LI.6 GDPR compliance: erasure path funzionante, retention configurata

**L7 LinkedIn — cross-domain per file LinkedIn-touch**:
- L7-LI.1 anti-ban: varianza timing, sessioni credibili, pending ratio, navigazione umana
- L7-LI.2 fingerprint coerenza: no contraddizioni canvas/UA/lingua/tz
- L7-LI.3 proxy stickiness: stesso proxy per stessa session, no rotation in mezzo a action sequence
- L7-LI.4 LinkedIn API rate limit rispettato: no burst, no flood, no parallel su stesso account
- L7-LI.5 selettori multi-locale: IT/EN/FR/DE supportati se file lavora con LinkedIn DOM

**L8-LI**: dopo modifica risk engine/scheduler/antiban, ri-eseguire test integrazione browser staging reale (non solo unit).
**L9-LI**: working tree pulito + nessun file LinkedIn-touch lasciato senza `/antiban-review` verdetto se modificato in questo turno.

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
