# AGENTS.md — Regole operative di progetto

Questo file e' il riferimento operativo canonico della repo per agenti AI e sessioni di lavoro.
`CLAUDE.md` e' solo un adapter per Claude Code e non deve duplicare logica o backlog.
Le regole globali (P0, L1-L9, parita' ambienti, memoria, anti-dimenticanza) stanno in `~/.claude/CLAUDE.md`.
Le regole di orchestrazione cognitiva, requirement ledger, orizzonti temporali, blast radius documentale e handoff sono in `docs/AI_RUNTIME_BRIEF.md` (reiniettato automaticamente dai hook a ogni prompt).

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

- Il commit non deve dipendere dalla memoria dell'utente: quando un'unita' logica di lavoro e' davvero verificata, il sistema deve arrivare al commit in modo predefinito.
- **Auto-commit by default**: dopo verifiche verdi (`post-modifiche` + `conta-problemi` a zero) l'AI deve proporre o attivare il commit come chiusura naturale del blocco, non lasciarlo come passaggio implicito.
- **No commit automatico cieco** se:
  - il lavoro e' ancora a meta'
  - ci sono modifiche non correlate mescolate nello stesso working tree
  - il task e' bloccato o richiede ancora conferma sostanziale
  - i gate non sono verdi
- Il **push non e' automatico in assoluto**: va trattato come azione contestuale, perche' tocca remote condivisi, branch policy, review e rischio operativo.
- **Auto-push consentito** solo quando tutte queste condizioni sono vere:
  - branch e destinazione sono chiari
  - upstream gia' configurato oppure strategia di push esplicita
  - nessuna divergenza o conflitto remoto
  - il flusso corretto non richiede PR o review preventiva
  - l'utente non ha chiesto di fermarsi prima del remote
- **No auto-push** se il branch e' protetto/condiviso, se serve PR, se il remote e' divergente, se la policy di integrazione non e' chiara o se il task tocca aree ad alto rischio che richiedono review.
- Se il sistema arriva al commit ma non al push, l'AI deve dirlo in modo esplicito e motivato: cosa ha fatto, perche' si e' fermata e qual e' il prossimo step corretto.
- Verifica deterministica disponibile: `npm run audit:git-automation`
  - classifica il repository in `READY` / `REVIEW` / `BLOCKED` / `NOOP` per commit e push
  - espone anche script affidabili per futuri hook o workflow: `audit:git-automation:strict:commit`, `audit:git-automation:strict:push`, `audit:git-automation:json`
  - non sostituisce `post-modifiche` e `conta-problemi`: governa il contesto git, non la qualita' del codice
- Enforcement meccanico attivo in Claude Code:
  - `pre-bash-l1-gate.ps1` blocca `git commit` senza quality gate recente
  - `pre-bash-git-gate.ps1` blocca `git commit` / `git push` se il repository non e' nel giusto stato operativo
  - `post-bash-git-audit.ps1` logga automaticamente la readiness git dopo quality gate e operazioni git rilevanti
- Primitive correnti:
  - commit/push intelligente via skill `git-commit`
  - PR via skill `git-create-pr`
  - audit contestuale git via `audit:git-automation`
  - gate git via hook globali Claude Code
  - il comportamento desiderato e' quindi **meccanicamente enforced in Claude Code** per i blocker noti; il push resta comunque contestuale sul remote

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
- applicare quel principio a TUTTI i casi analoghi — anche quelli non citati esplicitamente dall'utente
- se l'utente porta 2 scenari, chiedersi: quanti altri scenari analoghi tocca lo stesso principio?
- non dichiarare concluso un ragionamento limitandosi ai soli esempi forniti
- questo vale per rischi tecnici, controlli di qualita', pattern documentali e regole operative

### Hook attivi (aggiornato al 2026-04-15)

| Evento | Tipo | Trigger | Azione | File log |
|--------|------|---------|--------|----------|
| `SessionStart` | sync | Inizio sessione | Carica memoria globale, todos, indice memoria progetto e `AI_RUNTIME_BRIEF.md` in `additionalContext` | n/a |
| `UserPromptSubmit` | sync | Ogni nuovo prompt utente | Reinietta `AI_RUNTIME_BRIEF.md` prima che Claude elabori il prompt | n/a |
| `PreToolUse` | bloccante (permissionDecision: deny) | Edit/Write su file sensibili LinkedIn | Avvisa e blocca: richiede `/antiban-review` prima di procedere | `memory/antiban-hook-log.txt` |
| `PreToolUse` | bloccante | Bash con `git commit` | Richiede quality gate recente prima del commit | `memory/rule-violations-log.txt` |
| `PreToolUse` | bloccante | Bash con `git commit` / `git push` | Blocca operazioni git se il repository non e' nello stato corretto | `memory/rule-violations-log.txt` |
| `PreCompact` | sync | Prima della compattazione contesto | Reinietta `AI_RUNTIME_BRIEF.md` per non perdere le regole critiche nel compact | n/a |
| `PostToolUse` | async | Bash con `npm run`, `npx tsc`, `npx madge`, `vitest` | Loga i comandi di qualita' eseguiti | `memory/quality-hook-log.txt` |
| `PostToolUse` | async | Bash con `post-modifiche`, `conta-problemi`, `git commit`, `git push` | Esegue audit git automatico "durante" il lavoro e logga la readiness reale | `memory/git-hook-log.txt` |
| `PostToolUse` | async | Edit/Write su file sensibili LinkedIn senza antiban-review oggi | Logga possibile miss regola antiban | `memory/rule-violations-log.txt` |
| `PostToolUse` | async | Edit/Write su file >300 righe | Logga avviso file troppo grande per valutare split | `memory/file-size-log.txt` |
| `Stop` | async | Fine sessione | Suono notifica + log sessione con working dir + avviso se ENGINEERING_WORKLOG non aggiornato | `memory/session-log.txt` |
| `TeammateIdle` | async | Agent team idle | Log teams | `memory/teams-log.txt` |
| `TaskCreated` | async | Agent team task creato | Log teams | `memory/teams-log.txt` |
| `TaskCompleted` | async | Agent team task completato | Log teams | `memory/teams-log.txt` |

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

Estensioni LinkedIn ai livelli globali (vedi L1-L9 in `~/.claude/CLAUDE.md` per i livelli completi):

- L1: build se serve, `madge --circular` sui moduli core toccati, coverage adeguata per risk/scheduler/auth/stealth
- L3: controllare memory leak, listener, timeout, pattern stealth, busy timeout DB
- L4: scenari multi-giorno, recovery, pause durante invito, aggiornamento selettori LinkedIn
- L5: Telegram e report devono dire cosa fare, non solo cosa e' successo
- L6: verificare il percorso migration -> repository -> API -> frontend -> report

## Loop di completamento

- Un task non va considerato concluso finche' non ha superato L9 (loop finale di completezza) sui file toccati direttamente e indirettamente — vedi definizione in `~/.claude/CLAUDE.md`.
- Se il task si ferma per conferma utente, limiti operativi o crediti, l'agente deve lasciare stato, blocco e prossimi passi in modo esplicito.
- Prima di chiudere il task l'AI deve anche verificare che nessun obbligo di breve termine sia stato spinto impropriamente su medio/lungo termine e che i follow-up reali siano stati tracciati in modo esplicito.
- A fine ogni blocco tecnico significativo: aggiornare `docs/tracking/ENGINEERING_WORKLOG.md` con data, tema, interventi effettuati e verifica finale.

## Nuovi progetti e bootstrap preventivo

- Quando nasce un progetto nuovo, o quando si vuole riallineare un progetto esistente, usare la checklist in [docs/NEW_PROJECT_BOOTSTRAP_CHECKLIST.md](docs/NEW_PROJECT_BOOTSTRAP_CHECKLIST.md).
- La checklist deve coprire non solo il setup iniziale, ma anche prevenzione tecnica, affidabilita' AI, ambienti, quality gates, rischio dominio, handoff e lungo termine.
- Se un nuovo progetto parte senza questa baseline, il rischio di debito tecnico, contesto implicito e drift operativo cresce subito.
