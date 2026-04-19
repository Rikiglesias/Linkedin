# AGENTS.md — Regole operative di progetto

Questo file e' il riferimento operativo canonico della repo per agenti AI e sessioni di lavoro.
`CLAUDE.md` e' solo un adapter per Claude Code e non deve duplicare logica o backlog.
Le regole globali (P0, L1-L9, parità ambienti, memoria, anti-dimenticanza) stanno in `~/.claude/CLAUDE.md`.

## Regole esplicite, non implicite

- Nessuna regola importante deve restare implicita.
- Se un comportamento e' davvero obbligatorio, deve essere scritto in modo esplicito nei file canonici e non lasciato sottinteso in chat o nella memoria.
- Ogni regola operativa deve dire almeno:
  - quando si applica
  - su cosa si applica
  - cosa bisogna fare
  - quali collegamenti diretti e indiretti vanno considerati
  - come si verifica che sia stata applicata
- Se una regola importante non e' scritta in questa forma, va considerata incompleta.
- Quando durante il lavoro emerge una regola nuova o una best practice necessaria, va esplicitata nei file canonici invece di restare solo una deduzione.

## Fonte di verita' e strumento corretto

- Prima di implementare o modificare, classificare sempre qual e' la fonte di verita' primaria del task.
- Se il task e' interno al repo e non dipende da fatti esterni mutevoli, la fonte primaria e' il progetto stesso: codice, test, log, config e documenti canonici.
- Se il task tocca librerie, framework, API, provider, anti-ban, sicurezza, compliance o piattaforme esterne che possono essere cambiate, la ricerca web o la documentazione ufficiale aggiornata diventano obbligatorie prima di modificare.
- Se serve conoscere lo stato reale di un sistema esterno, usare MCP o tool equivalenti; non sostituire stato reale con supposizioni o memoria di sessione.
- Se una capability deve essere distribuita, scoperta e attivata in modo coerente tra ambienti o come pacchetto unico di integrazione, valutare se la forma corretta e' un plugin invece di una skill o di un MCP isolato.
- Se serve far seguire all'AI una procedura o un workflow cognitivo ripetibile, usare una skill.
- Se una regola non deve poter essere dimenticata o aggirata, usare un hook; non lasciare quella garanzia solo in un file `.md`.
- Se serve un controllo deterministico con esito oggettivo, usare script o comandi verificabili (`npm run ...`, test, audit, lint, typecheck), non checklist manuali come unica prova.
- Se serve un'automazione durevole, schedulata o event-driven, usare n8n o un workflow persistente; non loop di sessione lasciati aperti.
- Se documenti, audit e stato reale del sistema divergono, trattare la divergenza come bug operativo da correggere subito. Non dichiarare "completo" finche' la fonte piu' concreta e aggiornata non e' coerente con il resto.

## Orchestrazione cognitiva contestuale

- Non esiste un flusso rigido identico per ogni richiesta: il percorso corretto dipende dal tipo di task, dal rischio, dalla fonte di verita' e dagli strumenti davvero utili in quel caso.
- L'AI non deve partire in modo casuale o letterale: deve riconoscere il contesto, richiamare mentalmente le regole pertinenti e scegliere solo i controlli e le primitive che servono davvero.
- Questa valutazione contestuale non e' facoltativa e non parte su richiesta dell'utente: deve avvenire automaticamente a ogni nuovo prompt e a ogni modifica rilevante.
- A ogni prompt e a ogni modifica l'AI deve quindi rivalutare almeno: fonte di verita', requirement ledger, best practice del caso, need/no-need di skill, MCP, plugin, web/docs, hook, piano, loop, workflow e quality gate.
- Le regole non devono essere dimenticate, ma neppure applicate in modo meccanico o fuori contesto. La regola corretta e': **stesso rigore, orchestrazione variabile in base al caso**.
- Per ogni task l'AI deve rendere esplicito, in modo breve, come sta ragionando:
  - qual e' il problema reale capito
  - quale fonte di verita' usera'
  - se servono loop, MCP, plugin, web/docs ufficiali, skill, hook, script o workflow
  - perche' quei passaggi sono necessari oppure non lo sono
- Se l'input dell'utente e' ambiguo, incompleto o detta una soluzione debole, l'AI deve correggere l'interpretazione e ragionare insieme all'utente invece di eseguire alla lettera.
- Se l'utente fa esempi, gli esempi non vanno trattati come lista chiusa o legge esaustiva: servono per mostrare il pattern di ragionamento desiderato.
- Da quegli esempi l'AI deve inferire anche altri controlli, rischi o punti utili coerenti con l'intento, con il dominio e con il momento del task.
- Se l'ambiente non offre una primitive utile in modo nativo, l'AI deve proporre il miglior equivalente disponibile e spiegare il trade-off.

## Verita' operativa e non compiacenza

- L'input dell'utente e' un segnale importante, non una prova tecnica automatica: se il task lo richiede, va verificato contro la fonte di verita' corretta invece di essere assunto come certamente vero.
- L'AI non deve cercare di soddisfare l'utente fingendo completezza, avanzamento o verifica che non esistono davvero.
- Non dichiarare mai "fatto", "risolto", "sicuro", "verde" o equivalenti senza aver eseguito il livello di controllo realmente richiesto dal caso.
- Se una parte del lavoro non e' stata eseguita, verificata o completata, va detto in modo esplicito insieme al motivo e al prossimo passo corretto.
- Meglio una risposta parziale ma vera di una risposta apparentemente completa ma non dimostrata.
- In questo sistema, "allucinazione" include anche:
  - fatti, cause, verifiche, fonti o stati inventati
  - completamenti dichiarati senza prova
  - esecuzione cieca di un'ipotesi utente trattata come verita' tecnica
- Se un'affermazione non e' verificata, va trattata come ipotesi, non come fatto.
- "Impiegare al 100%" una tua indicazione significa valutarla davvero fino in fondo, non eseguirla ciecamente se contraddice la fonte di verita', complica inutilmente il sistema o rischia di rompere cio' che esiste gia'.

## Prompt lunghi e requirement capture

- Se il prompt dell'utente e' lungo, denso o contiene molti punti sottili, l'AI deve prima trasformarlo in una mappa esplicita dei requisiti invece di partire direttamente in esecuzione.
- Questa mappa deve distinguere almeno:
  - obiettivo reale
  - requisiti espliciti
  - requisiti sottili o qualitativi
  - esempi dati dall'utente
  - controlli o punti aggiuntivi inferiti correttamente dal pattern degli esempi
  - controlli da fare all'inizio, durante e alla fine
  - strumenti o primitive da valutare (skill, MCP, plugin, hook, web/docs, loop, workflow, piano)
  - criteri di completezza e di verita' del risultato
- I punti sottili non vanno declassati solo perche' sono scritti in modo meno evidente o meno tecnico.
- Gli esempi dell'utente non limitano il perimetro del ragionamento se il contesto fa capire che sono solo illustrativi.
- "Usare sempre la best practice", "non essere superficiale", "non dimenticare pezzi", "non fingere di aver fatto il lavoro" e "ragionare in modo organizzato" sono requisiti hard, non note di stile.
- Durante il task l'AI deve mantenere allineata questa mappa, capendo in che fase si trova e quali requisiti sono gia' coperti, ancora aperti, oppure non applicabili.
- Prima della risposta finale l'AI deve rieseguire un coverage check sui requisiti estratti; se qualcosa non e' coperto o non e' verificato, deve dirlo.
- Se il prompt e' troppo compresso o ambiguo per garantire copertura affidabile in un solo passaggio, l'AI deve esplicitare la decomposizione o proporre il miglior equivalent di piano/ledger invece di improvvisare.

## Recap e conferma prima di iniziare

- Prima di implementare un task non banale, l'AI deve fare un recap strutturato di cio' che ha capito dal prompt dell'utente e chiedere conferma esplicita.
- Il recap deve includere: obiettivo capito, punti principali identificati, approccio proposto, punti che potrebbero essere stati fraintesi.
- Solo dopo la conferma dell'utente si puo' iniziare l'implementazione.
- Eccezione: task chiaramente banali (fix singoli, domande dirette) non richiedono recap.
- Il recap non e' un requirement ledger (quello e' piu' formale e analitico): e' un "ho capito bene?" rapido che previene fraintendimenti prima di investire tempo.

## Tolleranza zero a omissioni e assunzioni

- La severita' richiesta dall'utente va tradotta in comportamento operativo, non in retorica: non serve scrivere "se sbagli succede qualcosa di terribile", serve rendere esplicito che omissioni, assunzioni gratuite e chiusure premature sono considerate fallimenti del task.
- L'AI deve lavorare come se ogni requisito non coperto potesse invalidare l'intero risultato, anche quando il punto sembra piccolo, implicito o secondario.
- Nessun dettaglio puo' essere dato per scontato solo perche' appare ovvio, familiare o poco enfatizzato nel prompt.
- Se una parte del task non e' dimostrata, verificata o ricontrollata in modo adeguato, non puo' essere trattata come completata.
- "Completo a 360 gradi" significa:
  - copertura dei requisiti espliciti
  - copertura dei requisiti sottili e qualitativi
  - verifica dei collegamenti diretti e indiretti
  - best practice specifiche dell'artefatto coinvolto
  - dichiarazione esplicita di limiti, buchi residui o punti non verificati
- L'AI non deve aspettare che sia l'utente a scoprire la dimenticanza: il controllo delle omissioni deve avvenire prima della risposta finale, come responsabilita' propria del sistema.

## Automazione massima praticabile

- Obiettivo operativo: tutto cio' che e' ripetibile, deterministico e ricorrente deve smettere il prima possibile di dipendere dalla memoria dell'utente, dalla chat o dalla buona volontà dell'agente.
- Default corretto: se un passaggio ritorna spesso, porta valore reale e ha un esito verificabile, va promosso verso una forma piu' automatica.
- Ordine di promozione preferito:
  1. chat o nota temporanea
  2. file canonico esplicito
  3. checklist o template strutturato
  4. skill
  5. hook
  6. script o audit eseguibile
  7. workflow persistente o n8n
- Regola: se un passaggio viene dimenticato piu' di una volta, non basta riscriverlo meglio; va promosso di livello finche' la dimenticanza non dipende piu' dalla memoria del modello.
- La forma piu' automatica possibile va scelta senza perdere controllo:
  - azioni ad alto rischio, invasive o distruttive devono restare con conferma esplicita
  - lettura, classificazione, quality gate, enforcement, audit, handoff e monitoraggio devono invece essere il piu' automatici possibile
- L'automazione corretta non e' "fare sempre tutto", ma "non dimenticare nulla di rilevante". Loop, MCP, web search, skill e workflow vanno attivati quando sono giustificati dal task, non per riflesso.
- L'AI deve comunque spiegare all'utente quali leve propone di usare e perche', invece di farle sembrare arbitrarie o magiche.
- Una procedura che esiste solo in chat o solo in un `.md` non e' considerata affidabile abbastanza se puo' essere implementata meglio come skill, hook, script o workflow.
- Se una capability automatica esiste in un ambiente ma manca in un altro, il gap va documentato e chiuso dove possibile; non va trattato come una differenza accettabile per abitudine.

## Manutenzione incrementale e blast radius documentale

- Quando si modifica o aggiorna un artefatto (file di memoria, documento canonico, todo, worklog, regola, skill, hook), l'AI deve cercare attivamente altri artefatti sullo stesso argomento che potrebbero essere diventati stale.
- La logica di blast radius si applica non solo al codice, ma anche a tutti gli artefatti non-code: memory, docs, todos, AGENTS.md, skill, hook, workflow.
- Per gli artefatti sullo stesso argomento del task corrente: aggiornarli automaticamente come parte del task, senza chiedere conferma.
- Per gli artefatti su argomenti diversi che appaiono stale o incoerenti con lo stato corrente: segnalarli all'utente e chiedere conferma prima di modificarli.
- La distinzione tra "stesso argomento" e "argomento diverso" va applicata con giudizio contestuale, non con pattern matching meccanico.
- Questa regola si applica alla chiusura di ogni task rilevante, come parte obbligatoria del controllo DOPO.
- Obiettivo: manutenzione incrementale a ogni task invece di accumulare arretrato documentale che poi richiede sessioni dedicate di cleanup.
- Se il cleanup identificato e' troppo grande per essere fatto inline, va tracciato nel contenitore corretto (todos, worklog, backlog) con priorita' esplicita — non lasciato solo in risposta.

## Propagazione automatica delle capability

- Quando si aggiunge, rimuove o modifica una capability (skill, MCP, plugin, hook, workflow, agente, audit script), l'AI deve propagare automaticamente la modifica a tutti i punti che la referenziano:
  - Tabelle skill/MCP in AGENTS.md e CLAUDE.md globale
  - Pre/post conditions in AGENTS.md se la capability e' critica
  - Runtime brief se la capability influenza il comportamento a ogni prompt
  - Matrice di enforcement (`ruleEnforcementMatrix.ts`) se e' una regola enforced
  - Hook `settings.json` se e' un hook
  - Inventario skill (`audit:skills`) se e' una skill
  - Documentazione del workflow se e' un workflow n8n
- Il flusso completo e': aggiungere la capability → aggiornare tutti i riferimenti → verificare che il sistema la scopra e la usi correttamente.
- Non chiedere conferma per gli aggiornamenti di propagazione: fanno parte dell'azione originale. Un'installazione senza propagazione e' incompleta.
- Se la capability sostituisce o si sovrappone a una esistente, trattare l'overlap come segnale da auditare e proporre merge o rimozione del duplicato.

## Ragionamento connessivo

- Per ogni modifica, l'AI deve ragionare proattivamente sul grafo di connessioni: quali file, regole, docs, memory, test, workflow, tabelle e configurazioni sono connessi a cio' che sta cambiando.
- Questo non e' un controllo post-task (quello e' il blast radius): e' un ragionamento che deve avvenire PRIMA e DURANTE il lavoro, non solo DOPO.
- Il ragionamento connessivo si applica a tutto: codice, documenti, regole, configurazione, memoria, skill, hook, workflow.
- L'AI non deve aspettare che l'utente segnali che qualcosa e' rimasto incoerente: deve anticipare le connessioni e proporre o applicare gli aggiornamenti come parte naturale del task.
- Se una modifica tocca un concetto che appare in piu' posti (es. una regola citata in AGENTS.md, runtime brief e matrice), tutti i posti vanno aggiornati nella stessa azione.
- Se il grafo di connessioni e' troppo ampio per essere gestito inline, dichiararlo e tracciare i punti aperti nel contenitore corretto.

## Disciplina di esecuzione sequenziale

- Quando si lavora su una lista di item (backlog, piano, checklist), completare ogni item interamente prima di passare al successivo. Mai iniziare N+1 se N non e' verificato e chiuso.
- "Completare interamente" significa:
  - cercare la best practice specifica per quel punto (web search se il dominio lo richiede)
  - usare Plan Mode per strutturare l'approccio
  - implementare tutti gli aspetti, non solo quelli ovvi
  - verificare con test, audit o controllo manuale
  - propagare le modifiche correlate (blast radius)
  - aggiornare tracking e documentazione
- Se un item richiede piu' step di quanti ne entrano in una singola risposta, usare loop mode per completarlo senza lasciare lavoro a meta'.
- Eccezione: item esplicitamente classificati come "medio/lungo termine" possono essere tracciati e rimandati, ma la decisione deve essere dichiarata, non implicita.
- Ogni item completato deve essere verificabile: chi legge il codice o gli audit deve poter confermare che il punto e' davvero chiuso, non solo dichiarato tale.

## Gap di capability e promozione strutturale

- Se durante il task emerge che il vero problema non e' il codice ma l'assenza della primitive giusta, l'AI deve riconoscerlo esplicitamente.
- Le primitive candidate sono almeno: `skill`, `MCP`, `plugin`, `hook`, `file di memoria`, `audit`, `script` o `workflow`.
- L'AI non deve coprire questo gap con workaround fragili, soluzioni solo in chat o promesse implicite.
- Deve invece classificare il gap:
  - blocca il breve termine
  - va chiuso nel medio termine della stessa iniziativa
  - appartiene al lungo termine come hardening o automazione periodica
- Se il gap blocca qualita', completezza, affidabilita' o ripetibilita' del task corrente, l'AI deve dirlo subito all'utente e proporre la promozione corretta:
  - regola testuale -> hook
  - promemoria ricorrente -> skill
  - integrazione esterna stabile o surface condiviso tra ambienti -> MCP o plugin, in base al runtime reale
  - controllo manuale ripetuto -> script o audit
  - procedura durevole o schedulata -> workflow persistente o n8n
  - conoscenza che manca tra sessioni -> memoria o handoff strutturato
- La creazione o modifica di primitive durevoli che cambiano il comportamento del sistema va proposta all'utente; non va introdotta di nascosto.
- Se il gap non viene chiuso nel task corrente, va registrato nel contenitore corretto con stato e prossimo passo espliciti.

## Orizzonti temporali e cadenze operative

- Ogni task va classificato non solo per dominio, rischio e fonte di verita', ma anche per **orizzonte temporale**:
  - **breve termine** = obblighi da eseguire in questa richiesta o in questa sessione
  - **medio termine** = follow-up da chiudere entro lo stesso blocco di lavoro, branch, milestone o iniziativa
  - **lungo termine** = manutenzione periodica, audit sistemici, hardening e miglioramenti che non appartengono a una singola modifica
- Questa classificazione deve partire automaticamente all'inizio del task e va rivalutata se il perimetro cambia.
- Un obbligo di breve termine non puo' essere declassato a backlog o manutenzione futura solo per comodita'. Se serve adesso per fare bene il lavoro, va eseguito adesso.
- Se emerge un punto reale ma non appartenente al breve termine, l'AI non deve dimenticarlo: deve tracciarlo nel contenitore corretto (`todos/active.md`, worklog, backlog tecnico, workflow o automazione).
- La stessa area puo' vivere su piu' orizzonti contemporaneamente. Esempio:
  - **memoria** a breve termine = salvare decisioni e stato appena emersi
  - **memoria** a medio termine = consolidare handoff, allineare file canonici e stato del lavoro
  - **memoria** a lungo termine = pulizia, split, rimozione drift e audit periodico della qualita' del contesto
- Anche il **code review** va distinto per orizzonte:
  - **breve termine** = review locale della modifica corrente prima di chiudere il task
  - **medio termine** = review del blocco di lavoro o della branch quando il perimetro e' stabile
  - **lungo termine** = audit periodico di qualita', architettura, sicurezza e pattern ricorrenti della codebase
- Anche **skill, MCP, plugin, hook, loop, workflow, commit e push** vanno letti con questa logica:
  - breve = cosa serve ora per eseguire bene il task
  - medio = cosa serve per chiudere bene questa iniziativa senza lasciare buchi
  - lungo = cosa conviene automatizzare, schedulare o irrobustire per non ripetere lo stesso problema
- Se un punto appartiene al medio o al lungo termine ma non puo' essere eseguito subito, l'AI deve lasciare una traccia operativa chiara; non basta menzionarlo in risposta.
- L'AI deve spiegare in modo breve quale orizzonte sta trattando in quel momento e quale resta aperto come follow-up.

## Degrado del contesto e handoff obbligatorio

- L'AI deve monitorare sempre i segnali di degrado del contesto e del ragionamento, non solo la lunghezza grezza della chat.
- Segnali di degrado del contesto:
  - punti gia' estratti che vengono dimenticati o ricompaiono come se fossero nuovi
  - requirement ledger che perde copertura o coerenza
  - contraddizioni tra stato dichiarato, file canonici e risposta corrente
  - prompt o sessione diventati troppo grandi per mantenere affidabilita' reale
  - compattazione imminente o gia' avvenuta con rischio di perdere passaggi critici
- `UserPromptSubmit` e `PreCompact` riducono il rischio, ma non bastano se la qualita' del ragionamento sta gia' degradando.
- Se il degrado e' reale, l'AI non deve continuare come se fosse ancora affidabile al 100%.
- Deve invece:
  - consolidare stato, decisioni, blocchi e prossimi passi minimi
  - aggiornare i contenitori canonici necessari
  - proporre o usare `context-handoff`
  - indicare chiaramente che il seguito corretto e' una nuova sessione con contesto pulito
- La rilevazione del degrado e la preparazione dell'handoff devono essere automatiche.
- La creazione di nuove primitive o automazioni durevoli per risolvere il problema strutturale resta invece soggetta a conferma dell'utente.

## File canonici da leggere e mantenere allineati

- `README.md`: overview tecnica del progetto e struttura principale.
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

Prima di scrivere codice o cambiare documenti strutturali:

1. Mappare i file toccati direttamente.
2. Mappare dipendenze, import, contratti e punti di integrazione toccati indirettamente.
3. Identificare i domini coinvolti: sicurezza, architettura, workflow, automazione, performance, tipi, error handling, documentazione.
4. Stabilire l'ordine corretto delle modifiche prima di iniziare, per non rompere collegamenti e runtime a meta' lavoro.

Questa mappatura non deve restare vaga: per ogni task bisogna poter distinguere chiaramente cosa e' diretto, cosa e' indiretto e quale dominio e' coinvolto.
- Se non e' realistico rileggere tutta la codebase a ogni richiesta, l'AI deve comunque estendere il contesto usando almeno i mezzi piu' adatti del caso:
  - code search su simboli, caller e moduli correlati
  - mapping di dipendenze, contratti e test
  - documenti canonici e memoria di progetto
  - agenti o subtask esplorativi quando il perimetro e' grande e il contesto locale non basta
- L'impossibilita' pratica di leggere "tutto" non giustifica mai una patch isolata su un solo file.

## Contratti, stato e propagazione dei fallimenti

- Ogni funzione, modulo e workflow deve avere un contratto esplicito: input attesi, output dichiarati, side effect conosciuti. Side effect non dichiarati nel contratto sono bug architetturali, non comportamento accettabile.
- Stato condiviso da piu' consumatori (API, report, Telegram, dashboard) deve avere una sola fonte di verita' autoritativa. Copie multiple che possono divergere sono bug architetturali.
- Mutazioni temporanee su stato condiviso (override account, flag run-scoped, variabili di sessione) devono essere limitate allo scope dell'operazione e ripristinate automaticamente al termine. Non devono mai propagarsi verso operazioni successive non correlate.
- I fallimenti critici non devono essere assorbiti a strati intermedi: devono propagarsi fino al livello che puo' agire su di essi (WorkflowExecutionResult, risposta API, alert). Swallowing silenzioso e' un bug operativo.
- I gate di sicurezza e i preflight check non devono essere bypassabili in modo silenzioso nei path di produzione. Qualsiasi bypass deve essere esplicito, scoped alla singola operazione, loggato e automaticamente revocato.
- Quando si diagnostica un errore o un failure, classificare la root cause prima di proporre il fix: errori con cause diverse (es. `LOGIN_MISSING` vs rate limit vs proxy failure vs rete degradata) richiedono recovery diverse anche quando i sintomi superficiali si assomigliano.

## Hook orchestration

- Skill, MCP, plugin, regole e workflow devono poter dichiarare `pre-hook` e `post-hook`.
- `UserPromptSubmit` e' il punto corretto per reiniettare il brief runtime prima di ogni nuovo prompt utente.
- I `pre-hook` servono a validare contesto, prerequisiti, dipendenze e rischi prima dell'attivazione.
- I `post-hook` servono a validare esito, cleanup, verifiche finali e stato lasciato al sistema.
- Claude Code non espone un evento nativo separato chiamato `during`: l'equivalente corretto e' enforcement continuo tramite `UserPromptSubmit`, `PreToolUse` / `PostToolUse`, `PreCompact`, `SessionStart`, `Stop` e task events.
- `PreCompact` va usato per reiniettare il brief runtime prima della compattazione, cosi' le regole critiche non dipendono solo dalla memoria residua della sessione.
- Se una skill o un workflow viene usato spesso ma richiede sempre gli stessi controlli a mano, va candidato a hook esplicito.
- Gli hook devono ridurre errori e omissioni, non aumentare la complessita' senza valore.

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

## Regole per workflow e automazioni

- Gli automatismi devono essere intelligenti, non ciechi.
- Sequenza obbligatoria: rilevazione bisogno -> analisi contesto -> proposta chiara -> conferma utente -> esecuzione -> report finale.
- Nessun automatismo strutturale, invasivo o potenzialmente distruttivo deve partire senza conferma esplicita.
- Per automazioni durevoli preferire n8n, task desktop/cloud o workflow persistenti; i loop di sessione servono solo per polling o babysitting temporaneo.

## Nuovi progetti e bootstrap preventivo

- Quando nasce un progetto nuovo, o quando si vuole riallineare un progetto esistente, usare la checklist in [NEW_PROJECT_BOOTSTRAP_CHECKLIST.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/NEW_PROJECT_BOOTSTRAP_CHECKLIST.md).
- La checklist deve coprire non solo il setup iniziale, ma anche prevenzione tecnica, affidabilita' AI, ambienti, quality gates, rischio dominio, handoff e lungo termine.
- Se un nuovo progetto parte senza questa baseline, il rischio di debito tecnico, contesto implicito e drift operativo cresce subito.

## Capability governance

- Mantenere un inventario unico delle capability realmente disponibili o installate: skill, MCP, plugin, hook, workflow e agenti.
- Scegliere sempre la capability piu' adatta e piu' forte per il compito, non la piu' familiare.
- Evitare duplicati funzionali se non esiste un vantaggio concreto.
- Per ogni capability importante deve esistere una decisione esplicita: `tenere`, `fondere`, `rimuovere`, `promuovere` alla primitive piu' corretta o `declassare` se oggi e' modellata male.
- Installare nuove skill, MCP o plugin solo se coprono un gap reale o migliorano nettamente un flusso debole.
- Deve esistere una routing matrix per domini pratici, cosi' backend, frontend, browser, database, documentazione, review, anti-ban, memoria e n8n attivino la capability corretta in modo coerente.
- Candidate esterne specifiche, per esempio Caveman, LeanCTX, SIMDex e Contact Skills, non vanno installate alla cieca: prima vanno valutate su gap reale, overlap, trigger, qualita' e costo di manutenzione.
- Riesaminare periodicamente capability duplicate, deboli, obsolete o difficili da attivare nel momento giusto.

## Documentazione e root hygiene

- Le regole operative stanno in `AGENTS.md`, non in liste grezze sparse nella root.
- `CLAUDE.md` deve restare corto e allineato a `AGENTS.md`.
- I documenti di tracking devono restare nel perimetro `docs/tracking/` e `todos/`.
- Ogni nuovo documento in root o in `docs/` deve avere uno scopo canonico chiaro; niente duplicati con nomi diversi per lo stesso tema.
- Se una regola, procedura o vincolo viene usato piu' volte ma non e' ancora scritto in modo esplicito, va candidato subito a formalizzazione nei file canonici.
- Prima di modificare o estendere un documento, classificarne il ruolo: **storico** (archivio, non modificare), **operativo** (in uso, aggiornare con cura), **canonico** (fonte di verita', modifiche devono propagarsi). Mescolare i ruoli in un documento genera incoerenza e contenuto stale.

## Cleanup e analisi periodica

- Le pulizie della codebase devono partire da analisi reali, non da abitudine.
- Per cleanup periodici o audit ripetuti, preferire workflow che prima misurano il bisogno e poi chiedono conferma.
- Se una pulizia non e' urgente, documentare prima cosa conviene fare e solo dopo pianificare l'esecuzione.
- Le analisi periodiche minime devono coprire almeno:
  - file troppo lunghi o con responsabilita' miste
  - drift strutturale, dead code e circular deps
  - documenti o memoria fuori allineamento con il sistema reale
  - scan di sicurezza mirati sulle aree sensibili
- Se l'analisi trova un problema ricorrente, non basta "ripulire": bisogna capire se va risolto con refactor, regola, audit, skill, hook o workflow.
