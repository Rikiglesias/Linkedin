## 2026-04-17 — Formalizzata la policy anti-allucinazione piena e il contesto codebase esteso

### Obiettivo

Rendere espliciti tre concetti che erano presenti ma ancora non abbastanza netti:

- l'allucinazione non e' solo "inventare fatti", ma anche dichiarare verifiche non fatte o eseguire ciecamente ipotesi dell'utente
- considerare al 100% una tua indicazione non significa obbedire ciecamente se la fonte di verita' o l'impatto tecnico dicono altro
- una modifica locale non puo' mai restare locale per definizione: va estesa al blast radius reale della codebase usando i migliori strumenti disponibili

### Interventi completati

- Aggiornato [AGENTS.md](C:/Users/albie/Desktop/Programmi/Linkedin/AGENTS.md)
  - definizione piu' forte di allucinazione
  - regola esplicita contro l'obbedienza cieca al testo utente
  - regola esplicita sul fatto che il limite pratico di contesto non giustifica patch isolate
- Aggiornato [AI_RUNTIME_BRIEF.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_RUNTIME_BRIEF.md)
  - aggiunta anti-allucinazione esplicita nel digest runtime
  - chiarito che l'input utente va trattato come segnale, non come comando cieco
  - esplicitato l'uso di code search, mapping dipendenze/test, memoria e agenti per estendere il contesto
- Aggiornato [AI_MASTER_SYSTEM_SPEC.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_MASTER_SYSTEM_SPEC.md)
  - definizione piena di allucinazione
  - chiarita la differenza tra prendere sul serio una richiesta e obbedirle ciecamente
  - esplicitato il dovere di estendere la modifica locale alla codebase reale
- Aggiornato [AI_OPERATING_MODEL.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_OPERATING_MODEL.md)
  - aggiunta definizione operativa di allucinazione dentro il punto 1
  - esplicitato che se non si puo' leggere tutta la codebase si devono usare strumenti e contesto sostitutivi, non patch locali cieche
- Aggiornato [360-checklist.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/360-checklist.md)
  - nuovo check anti-allucinazione piena
  - nuovo check sul blast radius reale della modifica locale
- Aggiornato [aiControlPlaneAudit.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/scripts/aiControlPlaneAudit.ts)
  - l'audit statico ora pretende anche questi punti nei canonici

### Verifica

- `npm run pre-modifiche`
- `npm run audit:ai-control-plane`
- `npm run post-modifiche`

### Esito

Verde.

- `npm run pre-modifiche` passato
- `npm run audit:ai-control-plane` passato (`18/18`)
- `npm run post-modifiche` passato
- typecheck, lint e suite Vitest verdi (`136/136` file test, `1421/1421` test)

## 2026-04-17 — Esplicitata la regola sugli esempi illustrativi dell'utente

### Obiettivo

Chiudere un altro punto sottile emerso dalla chat: l'AI non deve prendere gli esempi dell'utente come legge esaustiva, ma come pattern di ragionamento da estendere con altri controlli utili coerenti con il contesto.

### Interventi completati

- Aggiornato [AGENTS.md](C:/Users/albie/Desktop/Programmi/Linkedin/AGENTS.md)
  - gli esempi dell'utente sono ora esplicitamente trattati come pattern illustrativi
  - il requirement capture deve distinguere tra esempi dati e controlli aggiuntivi inferiti
- Aggiornato [AI_RUNTIME_BRIEF.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_RUNTIME_BRIEF.md)
  - il ledger runtime ora include esempi utente e controlli inferiti
- Aggiornato [AI_MASTER_SYSTEM_SPEC.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_MASTER_SYSTEM_SPEC.md)
  - chiarito che gli esempi non sono elenco esaustivo e che l'AI deve estendere il pattern
- Aggiornato [AI_OPERATING_MODEL.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_OPERATING_MODEL.md)
  - il punto 1 ora rende esplicito che dagli esempi vanno inferiti altri controlli coerenti
- Aggiornato [360-checklist.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/360-checklist.md)
  - nuovo check dedicato sugli esempi illustrativi
- Aggiornato [aiControlPlaneAudit.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/scripts/aiControlPlaneAudit.ts)
  - l'audit statico ora pretende anche questo comportamento nei canonici

### Verifica

- `npm run pre-modifiche`
- `npm run audit:ai-control-plane`
- `npm run post-modifiche`

### Esito

Verde.

- `npm run pre-modifiche` passato
- `npm run audit:ai-control-plane` passato (`18/18`)
- `npm run post-modifiche` passato
- typecheck, lint e suite Vitest verdi (`136/136` file test, `1421/1421` test)

## 2026-04-17 — Formalizzati capability gap e degrado del contesto

### Obiettivo

Rendere esplicite nei canonici due regole che erano solo parzialmente implicite:

- riconoscere quando manca la primitive corretta (`skill`, `hook`, `memoria`, `audit`, `workflow`) e proporre la promozione giusta
- fermarsi e usare `context-handoff` o nuova sessione quando il contesto degrada davvero

### Interventi completati

- Aggiornato [AGENTS.md](C:/Users/albie/Desktop/Programmi/Linkedin/AGENTS.md)
  - nuova sezione `Gap di capability e promozione strutturale`
  - nuova sezione `Degrado del contesto e handoff obbligatorio`
  - esplicitati i controlli periodici minimi su codebase, documenti, memoria e sicurezza
- Aggiornato [AI_RUNTIME_BRIEF.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_RUNTIME_BRIEF.md)
  - aggiunti capability gap, distinzione tra automazione e conferma utente, degrado del contesto e handoff
- Aggiornato [AI_MASTER_SYSTEM_SPEC.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_MASTER_SYSTEM_SPEC.md)
  - resa esplicita la gestione dei capability gap
  - reso esplicito l'obbligo di handoff quando il contesto non e' piu' affidabile
  - estesi i controlli periodici di salute della codebase
- Aggiornato [AI_OPERATING_MODEL.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_OPERATING_MODEL.md)
  - aggiunti gap di capability, handoff per degrado del contesto e baseline dei controlli periodici
- Aggiornato [360-checklist.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/360-checklist.md)
  - nuovi check su capability gap, automazione vs conferma, degrado del contesto e code health periodica
- Aggiornato [active.md](C:/Users/albie/Desktop/Programmi/Linkedin/todos/active.md)
  - nuovo item di sprint su capability gap e context degradation
- Aggiornato [aiControlPlaneAudit.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/scripts/aiControlPlaneAudit.ts)
  - l'audit statico ora richiede anche i nuovi punti nei canonici

### Verifica

- `npm run pre-modifiche`
- `npm run audit:ai-control-plane`
- `npm run post-modifiche`

### Esito

Verde.

- `npm run pre-modifiche` passato
- `npm run audit:ai-control-plane` passato (`18/18`)
- `npm run post-modifiche` passato
- typecheck, lint e suite Vitest verdi (`136/136` file test, `1421/1421` test)

## 2026-04-17 — Formalizzati gli orizzonti temporali del ragionamento AI

### Obiettivo

Chiudere un altro gap emerso dalla chat: il sistema aveva gia' regole forti su fonte di verita', hook, loop, memoria e automazione, ma mancava una distinzione esplicita tra:

- cosa va fatto subito nel task corrente
- cosa va chiuso entro la stessa iniziativa o branch
- cosa appartiene invece alla manutenzione periodica o al miglioramento sistemico

Questo mancato asse temporale poteva produrre due errori opposti:

- trattare tutto come urgente e immediato
- rimandare a "poi" controlli che invece servono per chiudere bene il task corrente

### Interventi completati

- Aggiornato [AGENTS.md](C:/Users/albie/Desktop/Programmi/Linkedin/AGENTS.md)
  - nuova sezione `Orizzonti temporali e cadenze operative`
  - regola esplicita su breve, medio e lungo termine
  - chiarita la differenza tra obblighi immediati, follow-up della stessa iniziativa e manutenzione periodica
  - aggiunto controllo in chiusura: nessun obbligo di breve termine puo' essere degradato impropriamente a backlog
- Aggiornato [AI_MASTER_SYSTEM_SPEC.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_MASTER_SYSTEM_SPEC.md)
  - aggiunta sezione dedicata agli orizzonti temporali e ai task periodici
  - esplicitati esempi trasversali su memoria, code review e automazione
- Aggiornato [AI_OPERATING_MODEL.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_OPERATING_MODEL.md)
  - nuovo asse trasversale breve/medio/lungo termine
  - matrice operativa per distinguere dove chiudere i vari tipi di lavoro
  - aggiunta cadenza periodica minima per code review, memoria, documenti, automazione e git
- Aggiornato [AI_RUNTIME_BRIEF.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_RUNTIME_BRIEF.md)
  - il digest runtime ora impone anche la classificazione per orizzonte temporale
- Aggiornato [360-checklist.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/360-checklist.md)
  - nuovi check su orizzonte temporale, memoria multi-orizzonte e cadenze periodiche
- Aggiornato [aiControlPlaneAudit.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/scripts/aiControlPlaneAudit.ts)
  - l'audit statico ora controlla anche la presenza del nuovo asse temporale nei canonici
- Aggiornato [active.md](C:/Users/albie/Desktop/Programmi/Linkedin/todos/active.md)
  - aperto un gap operativo esplicito: trasformare queste cadenze in enforcement reale e non solo documentale

### Verifica eseguita

- `npm run pre-modifiche`

### Esito

Il sistema distingue ora meglio:

- task da chiudere nel breve termine
- follow-up della stessa iniziativa
- manutenzione periodica e hardening di lungo periodo

Resta aperto il passaggio successivo: spingere una parte di queste cadenze in automazioni, audit o workflow veri, cosi' da non lasciarle solo come disciplina documentale.

## 2026-04-17 — Creata lista madre unica del sistema AI e resa esplicita la regola anti-compiacenza

### Obiettivo

Chiudere un gap rimasto aperto nella documentazione: i contenuti della chat e delle checklist erano gia' quasi tutti presenti, ma distribuiti tra piu' file. Serviva una lista madre unica, dettagliata, non duplicata e abbastanza esplicita da far emergere anche un principio chiave richiesto dall'utente: l'AI non deve assumere che tutto cio' che dice l'utente sia certamente corretto e non deve mai fingere di aver completato o verificato lavoro che non ha davvero eseguito.

### Interventi completati

- Creato [AI_MASTER_SYSTEM_SPEC.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_MASTER_SYSTEM_SPEC.md)
  - unifica in una sola lista esplicita i requisiti del sistema AI
  - copre verita' operativa, ragionamento, contesto, fonte di verita', web search, tool selection, memoria, protocolli di controllo, hook, n8n, prompt/modello, commit/push, cleanup, nuovi progetti e strumenti locali
  - rende esplicito il principio "no compiacenza, no false completion"
- Aggiornato [AGENTS.md](C:/Users/albie/Desktop/Programmi/Linkedin/AGENTS.md) con la sezione `Verita' operativa e non compiacenza`
- Aggiornato [AI_OPERATING_MODEL.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_OPERATING_MODEL.md) per:
  - includere il principio che l'input utente non e' automaticamente verita' tecnica
  - collegare il modello operativo alla nuova lista madre
  - esplicitare uno standard operativo "zero omissioni / zero assunzioni gratuite" invece di affidarsi a formule vaghe
- Aggiornato [docs/README.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/README.md) per classificare il nuovo documento come canonico
- Creato [AI_RUNTIME_BRIEF.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_RUNTIME_BRIEF.md)
  - digest runtime compatto derivato dai canonici
  - pensato per essere caricato meccanicamente dai hook senza iniettare ogni volta file troppo lunghi

### Verifica eseguita

- `npm run pre-modifiche`

### Esito

Il sistema ha ora anche un documento madre unico che riduce il rischio di perdere pezzi nella lettura distribuita dei canonici.
Resta comunque vero che la lista, da sola, non basta: i punti critici continuano a richiedere conversione progressiva in hook, script, audit e workflow perche' non dipendano solo dalla lettura del documento.

### Estensione successiva dello stesso blocco

Su richiesta dell'utente e' stata resa esplicita anche una regola prima solo implicita:

- quando il prompt e' lungo o molto denso, l'AI non deve seguire solo il punto piu' visibile
- deve prima decomporre il prompt in una mappa dei requisiti, inclusi i punti sottili e qualitativi
- deve sapere in che fase del task si trova (inizio, lavoro in corso, chiusura)
- deve rieseguire un controllo di copertura prima di rispondere
- omissioni, assunzioni non verificate e chiusure premature vanno trattate come failure del task

Questo e' stato formalizzato in:

- [AGENTS.md](C:/Users/albie/Desktop/Programmi/Linkedin/AGENTS.md)
- [AI_MASTER_SYSTEM_SPEC.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_MASTER_SYSTEM_SPEC.md)
- [AI_OPERATING_MODEL.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_OPERATING_MODEL.md)

### Estensione successiva: enforcement hook della memoria operativa per-prompt

Per ridurre la dipendenza dalla sola lettura iniziale dei documenti e dalla memoria del modello:

- `session-start.ps1` ora carica anche `AI_RUNTIME_BRIEF.md`
- e' stato aggiunto un hook globale `UserPromptSubmit` che reinietta il runtime brief prima di ogni nuovo prompt
- e' stato aggiunto un hook globale `PreCompact` che reinietta il runtime brief prima della compattazione
- gli audit `audit:hooks` e `audit:ai-control-plane` ora controllano anche questa parte del control plane

Questo non garantisce ancora perfezione assoluta, ma chiude un gap importante: le regole operative critiche non vengono piu' affidate solo al primo caricamento di sessione.

### Estensione successiva: selezione contestuale automatica resa esplicita

Su richiesta dell'utente e' stato reso ancora piu' esplicito un punto importante:

- la selezione di skill, MCP, web/docs, loop, piano, workflow e quality gate non deve partire solo quando l'utente lo chiede
- deve partire automaticamente a ogni nuovo prompt e a ogni modifica rilevante
- questa rivalutazione deve stare nei canonici, nel runtime brief e negli audit, non solo come interpretazione implicita

### Estensione successiva: riallineati anche i documenti guida non canonici stretti

Verificati anche file fuori dal nucleo canonico stretto per evitare drift documentale:

- `README.md`
- `CLAUDE.md`
- `docs/360-checklist.md`
- overview dei file in `todos/`, `docs/`, `dashboard/`, `n8n/`, `plugins/`, `scripts/`

Correzioni applicate:

- root `README.md` ora include anche `AI_MASTER_SYSTEM_SPEC.md` nell'ordine di lettura e chiarisce che `AI_RUNTIME_BRIEF.md` e' runtime, non fonte primaria manuale
- `CLAUDE.md` ora richiama anche `AI_MASTER_SYSTEM_SPEC.md`, chiarisce il ruolo di `AI_RUNTIME_BRIEF.md` e rende esplicita l'automaticita' della selezione contestuale
- `docs/360-checklist.md` ora include anche:
  - selezione contestuale automatica a ogni prompt/modifica
  - `UserPromptSubmit`
  - `PreCompact`
  - runtime brief nel sistema hook

## 2026-04-15 — Chiusura gap tra regole git scritte e enforcement hook reale

### Obiettivo

Chiudere il buco rimasto aperto dopo l'introduzione dell'audit git: le regole su commit/push e quality gate erano scritte bene, ma non ancora rese meccaniche via hook. Inoltre chiarire in modo esplicito che Claude Code non offre un evento separato `during`, quindi il controllo continuo corretto va modellato tramite tool-use hooks.

### Interventi completati

- Creato hook globale [pre-bash-git-gate.ps1](C:/Users/albie/.claude/hooks/pre-bash-git-gate.ps1)
  - blocca `git commit` se il working tree non e' commit-ready
  - blocca `git push` se il repository non e' push-ready
  - applica enforcement su branch condivisi, repo sporco, upstream/divergenza e file sensibili
- Creato hook globale [post-bash-git-audit.ps1](C:/Users/albie/.claude/hooks/post-bash-git-audit.ps1)
  - esegue audit automatico dopo `post-modifiche`, `conta-problemi`, `git commit`, `git push`
  - logga lo stato git reale in `C:\Users\albie\memory\git-hook-log.txt`
  - marca automaticamente i casi `AUTOCOMMIT_CANDIDATE` quando quality gate e stato git sono entrambi verdi
- Aggiornato [settings.json](C:/Users/albie/.claude/settings.json) per agganciare i nuovi hook Bash pre/post
- Aggiornato [AGENTS.md](C:/Users/albie/Desktop/Programmi/Linkedin/AGENTS.md) per:
  - chiarire che non esiste un evento nativo `during`
  - dichiarare il pattern corretto `SessionStart` + `PreToolUse` + `PostToolUse` + `Stop`
  - rendere esplicito l'enforcement git ora attivo
- Aggiornato [AI_OPERATING_MODEL.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_OPERATING_MODEL.md) per riallineare la sezione hook al comportamento reale
- Aggiornato [360-checklist.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/360-checklist.md) con check specifici su session-start, git gates e git hook log
- Rafforzati gli audit repo:
  - [hooksConformityAudit.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/scripts/hooksConformityAudit.ts) ora verifica anche `pre-bash-l1-gate`, `pre-bash-git-gate`, `post-bash-git-audit`
  - [aiControlPlaneAudit.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/scripts/aiControlPlaneAudit.ts) ora verifica anche gli script git di audit e la presenza dei git hooks in `settings.json`

### Verifica eseguita

- `npm run audit:hooks`
- `npm run audit:ai-control-plane`
- `npm run post-modifiche`

### Esito

Il sistema resta ancora parziale sulla parity cross-environment e su n8n ingress/egress hooks, ma non e' piu' corretto dire che commit/push o il controllo "durante" siano solo scritti nei documenti:

- i blocker git principali sono ora enforced via hook
- lo stato git viene ri-audito automaticamente durante il lavoro nei momenti giusti
- la documentazione canonica ora dichiara esplicitamente anche il limite reale del modello eventi di Claude Code

## 2026-04-15 — Audit eseguibile della readiness commit/push

### Obiettivo

Trasformare il punto commit/push da sola policy documentale a controllo git eseguibile, cosi' da distinguere in modo oggettivo quando il sistema puo' chiudere un blocco con commit assistito e quando invece deve fermarsi o chiedere review prima del remote.

### Interventi completati

- Creato [gitAutomationAudit.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/scripts/gitAutomationAudit.ts)
  - legge stato branch/upstream/origin
  - calcola ahead/behind
  - rileva working tree sporco, scope troppo ampio, file sensibili e operazioni git in corso
  - produce un verdetto separato per `commit` e `push`: `READY`, `REVIEW`, `BLOCKED`, `NOOP`
  - supporta `--json` e modalita' `--strict=commit` / `--strict=push` per futuri hook o workflow
- Esposto il controllo in [package.json](C:/Users/albie/Desktop/Programmi/Linkedin/package.json) come `npm run audit:git-automation`
- Aggiunti anche script npm dedicati per evitare ambiguita' di forwarding nel terminale:
  - `npm run audit:git-automation:json`
  - `npm run audit:git-automation:strict:commit`
  - `npm run audit:git-automation:strict:push`
- Aggiornato [AGENTS.md](C:/Users/albie/Desktop/Programmi/Linkedin/AGENTS.md) per collegare la policy commit/push a un audit deterministicamente eseguibile
- Aggiornato [AI_OPERATING_MODEL.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_OPERATING_MODEL.md) per rendere questo audit parte della strategia di autonomia contestuale

### Verifica eseguita

- `npm run pre-modifiche`
- `npm run audit:git-automation`

### Esito

Il sistema non e' ancora a "push cieco automatico", e non deve esserlo. Pero' non dipende piu' solo da testo e memoria del modello:

- il commit puo' essere valutato con un audit oggettivo del working tree
- il push viene bloccato o promosso in base a branch, upstream, divergenza e stato locale
- l'automazione git resta quindi contestuale, ma ora e' anche misurabile

## 2026-04-14 — Esplicitazione della policy commit/push nel sistema AI

### Obiettivo

Chiudere un gap rimasto implicito nella lista: distinguere chiaramente cosa del flusso git deve essere automatico davvero e cosa invece deve restare governato dal contesto.

### Interventi completati

- Aggiornato [AGENTS.md](C:/Users/albie/Desktop/Programmi/Linkedin/AGENTS.md) con una sezione esplicita `Commit e push — policy operativa esplicita`
- Formalizzato che:
  - il commit deve essere la chiusura naturale di un blocco verificato
  - l'auto-commit e' desiderato by default quando i gate sono verdi
  - il push non va automatizzato in modo cieco
  - il push puo' essere automatico solo se branch, upstream, remote state e review policy sono chiari e sicuri
  - se il sistema si ferma al commit, l'AI deve spiegare il motivo e il prossimo passo corretto
- Aggiornato [AI_OPERATING_MODEL.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_OPERATING_MODEL.md) per rendere commit/push parte esplicita del punto autonomia totale
- Aggiornata [360-checklist.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/360-checklist.md) con due check specifici su commit e push

### Verifica eseguita

- review statica dei canonici e delle skill git esistenti (`git-commit`, `git-create-pr`)

### Esito

Il sistema non era "senza copertura" su commit e push, ma il comportamento era distribuito tra skill e regole sparse. Ora la policy e' esplicita:

- commit = automatizzabile e desiderato come default dopo verifiche verdi
- push = contestuale, non cieco, subordinato a branch policy e rischio operativo

## 2026-04-14 — Cleanup mirato della documentazione e riduzione del rumore operativo

### Obiettivo

Ridurre il rischio di drift documentale senza comprimere forzatamente documenti con ruoli diversi: archiviare il piano 360 ormai storico, chiarire l'indice e rendere piu' leggibili i documenti ancora vivi.

### Interventi completati

- Aggiornato [docs/README.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/README.md):
  - chiarito che [A16_LINKEDIN_DEPENDENCY_PLAN.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/A16_LINKEDIN_DEPENDENCY_PLAN.md) e [AI_QUALITY_PIPELINE.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_QUALITY_PIPELINE.md) sono documenti specialistici, non backlog vivi
  - aggiunto [codebase-debt.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/tracking/codebase-debt.md) come snapshot di supporto
  - aggiunto in archivio il riferimento al piano 360 storico
- Aggiornato [docs/tracking/README.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/tracking/README.md) per rendere esplicito il ruolo di [codebase-debt.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/tracking/codebase-debt.md) come file di supporto al tracking
- Normalizzato [docs/GUIDA.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/GUIDA.md) rimuovendo il titolo troppo specifico "Rise Against Hunger" e riportandolo a guida operativa generale
- Normalizzato [ARCHITECTURE_ANTIBAN_GUIDE.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/ARCHITECTURE_ANTIBAN_GUIDE.md) con un vero titolo di primo livello coerente con gli altri documenti
- Aggiornato [A16_LINKEDIN_DEPENDENCY_PLAN.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/A16_LINKEDIN_DEPENDENCY_PLAN.md) con una nota esplicita che lo declassa da possibile backlog implicito a documento analitico specialistico
- Archiviato il piano storico [360-analysis-plan.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/archive/360-analysis-plan-2026-04-04.md), rimuovendolo dal backlog vivo in `todos/`

### Verifica eseguita

- controllo statico dei link principali e dell'indice documentale
- review dei cluster canonici, specialistici, sidecar e archive

### Esito

La documentazione resta ampia ma piu' governata:

- il nucleo canonico resta separato e chiaro
- il piano 360 non resta piu' tra i TODO attivi come falso backlog vivo
- i documenti specialistici sono piu' esplicitamente classificati
- il debt snapshot e' visibile senza promuoverlo a canonico improprio

## 2026-04-14 — Audit del control plane AI e riallineamento canonici vs runtime operativo

### Obiettivo

Trasformare la Fase A da semplice documentazione a verifica oggettiva: controllare che repo canonici, control plane globale Claude e skill chiave siano davvero coerenti tra loro.

### Interventi completati

- Creato [aiControlPlaneAudit.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/scripts/aiControlPlaneAudit.ts):
  - verifica che [AGENTS.md](C:/Users/albie/Desktop/Programmi/Linkedin/AGENTS.md) contenga i blocchi canonici della fase A
  - verifica che [AI_OPERATING_MODEL.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_OPERATING_MODEL.md) contenga ordine corretto di implementazione e orchestrazione contestuale
  - verifica che [active.md](C:/Users/albie/Desktop/Programmi/Linkedin/todos/active.md) tenga aperto il backlog giusto
  - verifica che il `CLAUDE.md` globale usi davvero l'orchestrazione cognitiva contestuale e non il vecchio flusso rigido
  - verifica che il `SessionStart` hook carichi davvero memoria globale, todos e indice memoria progetto
  - verifica che le skill globali `context-handoff`, `loop-codex` e `audit-rules` esistano e contengano i requisiti minimi dichiarati
- Aggiunto script npm canonico:
  - `npm run audit:ai-control-plane`
- Eseguito riallineamento del file globale `C:\Users\albie\.claude\CLAUDE.md`:
  - rimosso il blocco rigido `PRIMA — DURANTE — DOPO (ogni richiesta, sempre, automaticamente)`
  - sostituito con `Orchestrazione cognitiva contestuale`

### Verifica eseguita

- `npm run pre-modifiche`
- `npm run audit:hooks`
- `npm run audit:ai-control-plane`

### Esito

Verde sulla parte meta-operativa della Fase A:

- la baseline repo e' confermata verde
- il control plane globale non promette piu' un flusso rigido in conflitto con i canonici del repo
- esiste ora un audit dedicato che misura la coerenza minima tra documenti canonici, hook e skill chiave

Resta aperto il lavoro piu' difficile della Fase A: far riconoscere all'agente quando proporre davvero loop, MCP, web search o workflow in modo affidabile e non solo documentato.

## 2026-04-14 — Allineamento operating model, scelta strumenti e truthful audit

### Obiettivo

Chiudere il blocco meta-operativo prima di continuare con feature LinkedIn: rendere piu' esplicita la scelta tra hook, skill, MCP, web, script e n8n; unire i punti della lista in un sistema coerente; correggere audit e documenti che potevano guidare male.

### Interventi completati

- Aggiornato [AGENTS.md](C:/Users/albie/Desktop/Programmi/Linkedin/AGENTS.md) con una sezione esplicita su:
  - fonte di verita' primaria del task
  - quando la ricerca web/docs ufficiali e' obbligatoria
  - quando usare hook, skill, MCP, script, n8n e memoria
  - come trattare le divergenze tra documenti, audit e stato reale
- Aggiornato [AI_OPERATING_MODEL.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_OPERATING_MODEL.md) con un meta-principio trasversale:
  - i punti non sono indipendenti ma interconnessi
  - la scelta corretta non e' "internet sempre", ma "fonte di verita' piu' affidabile e aggiornata"
  - mappa esplicita scenario -> fonte primaria -> primitive corretta -> intersezioni obbligatorie
  - aggiunta regola sui controlli truthful per evitare falsi verdi/falsi rossi
- Aggiornata [360-checklist.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/360-checklist.md) per includere:
  - classificazione della fonte di verita'
  - uso corretto di skill vs MCP vs hook
  - obbligo di web/docs ufficiali sui task esterni o mutevoli
  - requirement che self-audit e checklist siano truthful
- Aggiornata [NEW_PROJECT_BOOTSTRAP_CHECKLIST.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/NEW_PROJECT_BOOTSTRAP_CHECKLIST.md) per rendere riusabile anche nei nuovi progetti la stessa sequenza cognitiva obbligatoria:
  - PRIMA -> DURANTE -> DOPO su ogni richiesta
  - scelta esplicita della fonte di verita' primaria
  - distinzione tra web/docs ufficiali, skill, MCP, hook, script e workflow
  - loop o equivalente obbligatorio quando serve per evitare false completion
- Rafforzati [AGENTS.md](C:/Users/albie/Desktop/Programmi/Linkedin/AGENTS.md) e [AI_OPERATING_MODEL.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_OPERATING_MODEL.md) con una policy esplicita di automazione:
  - automation-first fino al confine di sicurezza
  - scala di promozione chat -> file canonico -> checklist -> skill -> hook -> script/audit -> workflow persistente
  - principio che i passaggi dimenticati o ri-spiegati piu' volte non devono restare allo stesso livello
  - distinzione esplicita tra cio' che va automatizzato per default e cio' che richiede sempre conferma umana
- Rafforzata la definizione di "automatico" nei file canonici:
  - l'utente non deve dover scrivere "leggi le regole", "usa il loop", "controlla su internet" o "attiva la skill giusta" per ottenere il comportamento corretto
  - slash command, skill manuali e richieste esplicite di primitive restano override/debug, non prerequisito di qualita'
  - la sequenza cognitiva deve attivarsi in tre momenti: ingresso task, rivalutazione durante il task, controllo finale prima della risposta
- Aggiornati [360-checklist.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/360-checklist.md), [NEW_PROJECT_BOOTSTRAP_CHECKLIST.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/NEW_PROJECT_BOOTSTRAP_CHECKLIST.md) e [todos/active.md](C:/Users/albie/Desktop/Programmi/Linkedin/todos/active.md) per trasformare questo punto da principio astratto a gap operativo esplicito.
- Riallineati i canonici dopo correzione di rotta:
  - rimosso il messaggio implicito di "stesso flusso sempre"
  - sostituito con "orchestrazione cognitiva contestuale"
  - esplicitato che loop, MCP, web search e workflow vanno riconosciuti e proposti caso per caso
  - esplicitato che l'AI deve ragionare con l'utente in modo visibile, non solo attivare primitive in silenzio
- Corretto lo stato rapido di [AI_OPERATING_MODEL.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_OPERATING_MODEL.md) per allinearlo meglio allo stato reale:
  - parita' ambienti da ✅ a ⚠️
  - strumenti personali e ambienti da ✅ a ⚠️
  - manutenzione e produzione da ✅ a ⚠️
- Aggiunta in [AI_OPERATING_MODEL.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_OPERATING_MODEL.md) una sezione esplicita con l'ordine corretto di implementazione per dipendenze:
  - Fase A: base cognitiva e truthful control plane
  - Fase B: runtime reale, sicurezza operativa e produzione
  - Fase C: n8n e agenti verticali
  - Fase D: parity ambienti e strumenti personali
  - Fase E: consolidamento e metriche di autonomia
- Riallineata [SETUP.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/SETUP.md) al repo reale:
  - `db:migrate` al posto di script inesistenti
  - `ecosystem.config.cjs` al posto di `ecosystem.config.js`
  - nomi PM2 reali (`linkedin-bot-api`, `linkedin-bot-daemon`, `n8n`)
  - ordine import n8n coerente con i file realmente presenti
  - rimosso il gate falso `audit > 80/100` come requisito binario di go-live
- Corretto [hooksConformityAudit.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/scripts/hooksConformityAudit.ts):
  - ora legge il formato reale degli hook Claude (`matcher` + `hooks[]`)
  - verifica i command path reali (`pre-edit-antiban.ps1`, `post-bash-quality-log.ps1`, `file-size-check.ps1`, `stop-session.ps1`)
  - controlla il vero enforcement antiban leggendo lo script globale e cercando `Write-HookDecision -Decision deny`

### Verifica eseguita

- `npm run audit:hooks`
- `npm run pre-modifiche`
- `npm test`

### Esito

Verde sul piano meta-operativo:

- l'audit hook torna a misurare il sistema reale invece di un formato vecchio
- la regola "fonte di verita' + strumento corretto" e' ora esplicita nei file canonici
- la guida setup non richiama piu' comandi e file inesistenti
- il significato di "automatico" e' stato corretto: non flusso fisso sempre uguale, ma memoria delle regole + scelta contestuale delle primitive + ragionamento esplicito con l'utente

Resta aperto il debito strutturale gia' noto del repo (monoliti, runtime truthfulness, lifecycle/control plane, staging reale), che non viene chiuso da questo blocco documentale/di audit.

## 2026-04-04 — GDPR Retention Policy & Audit Trail (punto 20-bis)

### Obiettivo

Implementare retention policy GDPR e audit trail per i dati personali dei lead LinkedIn.

### Interventi completati

- Migrazione `059_gdpr_retention.sql`: aggiunte colonne `last_activity_at`, `anonymized_at`, `retention_expires_at` su `leads`; creata tabella `audit_log` con indici appropriati
- Script `src/scripts/gdprRetentionCleanup.ts`: job manuale/schedulabile che anonimizza (180gg) e cancella (365gg) lead inattivi; flag `--dry-run`, `--anonymize-only`, `--delete-only`; backfill automatico di `last_activity_at`
- Repository `src/core/repositories/auditLog.ts`: `writeAuditEntry`, `getAuditEntriesForLead`, `getAuditEntriesForLeadId`, `getAuditSummary`
- `domainIndex.ts`: aggiunto namespace `auditLogOps`
- `messageWorker.ts` e `inviteWorker.ts`: aggiunto `void writeAuditEntry(...)` non-bloccante dopo ogni messaggio/invito inviato
- `docs/GDPR_POLICY.md`: documentazione dati raccolti, retention, diritto all'oblio, query SQL
- `docs/AI_OPERATING_MODEL.md`: aggiornato punto 20-bis — status da ❌/⚠️ a ✅

### Verifica eseguita

- `npx tsc --noEmit` → nessun errore
- `npx madge --circular src/` → 0 circular deps

### Esito

Verde. La retention policy non gira automaticamente — va invocata manualmente o schedulata. L'audit trail è attivo sui worker principali (messaggio, invito). Il tipo di dato rimane SQLite-compatibile (DATETIME, TEXT, INTEGER).

---

## 2026-04-01 — Human-click hardening sui workflow core

### Obiettivo

Ridurre i path di click troppo diretti nei workflow principali e consolidare il comportamento umanoide nei punti core di UI automation.

### Interventi completati

- Consolidati gli helper di click in [humanClick.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/browser/humanClick.ts)
- Allineati i fallback UI in [uiFallback.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/browser/uiFallback.ts)
- Portati sui path umani i click critici in:
  - [inviteWorker.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/workers/inviteWorker.ts)
  - [messageWorker.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/workers/messageWorker.ts)
  - [navigationContext.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/browser/navigationContext.ts)
  - moduli Sales Navigator e percorsi eccezionali correlati
- Chiusi problemi di pause/resume e click-through non exception-safe

### Verifica eseguita

- `npx tsc -p tsconfig.json --noEmit`
- suite Vitest focalizzate sui workflow core
- `npm run lint`

### Esito

Verde. Il comportamento runtime resta equivalente, ma i click core passano attraverso helper condivisi piu' umani e controllabili.

### Nota importante

Questo blocco migliora il profilo anti-ban, ma non equivale a una validazione definitiva di produzione senza run reali su browser/proxy/account veri.

---

## 2026-04-01 — Audit architetturale runtime core + repository

### Finding principali trovati

- 10 circular dependency reali nel grafo `src`
- uso eccessivo del barrel [repositories.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories.ts)
- falsa separazione del repository layer: [leadReadOps.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories/leadReadOps.ts) e [leadWriteOps.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories/leadWriteOps.ts) erano facciate sopra [leadsCore.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories/leadsCore.ts)
- confini di layer inconsistenti:
  - `automation/types -> scheduler`
  - `core -> workers`
  - `browser -> repositories`
- monoliti critici ancora aperti:
  - [scheduler.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/scheduler.ts)
  - [jobRunner.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/jobRunner.ts)
  - [api/server.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/api/server.ts)
  - [db.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/db.ts)
  - [humanBehavior.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/browser/humanBehavior.ts)

### Documento di design creato

- [2026-04-01-runtime-core-repository-refactor-design.md](C:/Users/albie/Desktop/Programmi/Linkedin/docs/superpowers/specs/2026-04-01-runtime-core-repository-refactor-design.md)

---

## 2026-04-01 — Fase 1 del refactor architetturale completata

### Obiettivo

Spezzare i cicli e stringere i confini con cambi minimi e verificabili.

### Interventi completati

- Estratto `WorkflowSelection` in [workflowSelection.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/workflowSelection.ts)
- Aggiornati i consumer tipizzati in:
  - [scheduler.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/scheduler.ts)
  - [automation/types.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/automation/types.ts)
  - [orchestrator.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/orchestrator.ts)
  - [workflowEntryGuards.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/workflowEntryGuards.ts)
  - [guardian.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/ai/guardian.ts)
  - [cliParser.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/cli/cliParser.ts)
  - [loopCommand.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/cli/commands/loopCommand.ts)
- Rimosso import largo da barrel in [leadStateService.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/leadStateService.ts)
- Spostato `countTodayPosts` nel repository layer in [stats.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/repositories/stats.ts)
- Introdotto [selectorLearning.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/selectorLearning.ts) per togliere la dipendenza diretta `browser -> repositories`

### Verifica eseguita

- `npx tsc -p tsconfig.json --noEmit`
- `npx madge --circular --extensions ts --ts-config tsconfig.json src`
- Vitest focalizzati su scheduler/orchestrator/workflow/API
- Vitest focalizzati su lead state, selector learning e unit path correlati
- `npm run lint`

### Esito

- `madge`: **0 circular dependency**
- Vitest focalizzati: **110/110** verdi
- Vitest boundary/selector/lead-state: **38/38** verdi
- lint verde

### Impatto

Questo blocco non cambia il comportamento intenzionale del bot. Migliora i confini architetturali e rende piu' sicuri i refactor successivi.

---

## 2026-04-01 — Audit separato su AI decisionale e motore fisico

### Distinzione confermata

- Il **cervello AI** decide se procedere, saltare, rimandare o chiedere intervento umano
- Il **motore fisico** esegue mouse, dwell, scroll, typing e click con logica umanoide controllata dal codice

### Finding principali

- Il decision engine e' opzionale e di default non attivo: [domains.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/config/domains.ts) imposta `AI_PERSONALIZATION_ENABLED=false`
- Il decision engine e' oggi **fail-open**: timeout, parse error o errore AI finiscono in `PROCEED` tramite `mechanicalFallback` in [aiDecisionEngine.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/ai/aiDecisionEngine.ts)
- I decision point realmente cablati sono 3 su 5:
  - `pre_invite`
  - `pre_message`
  - `pre_follow_up`
- I decision point `navigation` e `inbox_reply` esistono nel contratto, ma non risultano cablati nei caller attivi
- Esiste un disallineamento nominale tra strategia AI e strategia runtime:
  - AI: `search_organic` / `feed_organic`
  - navigation runtime: `organic_search` / `organic_feed`
- Il motore fisico non e' demandato a un LLM. Usa modelli deterministici/euristici locali:
  - [mouseGenerator.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/ml/mouseGenerator.ts)
  - [timingModel.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/ml/timingModel.ts)
  - [typoGenerator.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/ai/typoGenerator.ts)
- [launcher.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/browser/launcher.ts) conferma che `humanize` del browser e' disabilitato per usare il motore mouse controllato dal progetto

### Verifica eseguita

- `observeAndDecision.vitest.ts`
- `humanBehavior.vitest.ts`
- `typoAndMouse.vitest.ts`
- `mouseGeneratorAdvanced.vitest.ts`
- `mouseGeneratorPaths.vitest.ts`
- `timingModel.vitest.ts`
- `timingModelAdvanced.vitest.ts`

### Esito

**67/67** test verdi.

### Conclusione

Il motore fisico e' gia' una base buona. Il cervello AI invece non e' ancora una policy forte e autoritativa: va portato da opzionale/fail-open a decision layer piu' rigoroso sui punti critici.

---

## 2026-04-03 — Re-test dei comandi sospetti che avevano coinciso con il crash del PC

### Obiettivo

Verificare se i batch PowerShell pesanti che in precedenza avevano coinciso con un crash del computer riescono ancora a riprodurre il problema.

### Comandi rilanciati

Batch parallelo:

- `Get-ChildItem -Force C:\Users\albie\.cursor | Select-Object Name, FullName, PSIsContainer | Format-Table -AutoSize`
- `Get-ChildItem -Force C:\Users\albie\.windsurf | Select-Object Name, FullName, PSIsContainer | Format-Table -AutoSize`
- `Get-ChildItem -Path C:\Users\albie\Desktop\Programmi\Linkedin -Recurse -Force -File -Include AGENTS.md,CLAUDE.md,mcp.json,settings.json,*.mdc,copilot-instructions.md,.cursorrules,.windsurfrules | Select-Object FullName | Sort-Object FullName | Format-Table -HideTableHeaders`

Secondo rilancio della scan ricorsiva:

- `Get-ChildItem -Path C:\Users\albie\Desktop\Programmi\Linkedin -Recurse -Force -File -Include AGENTS.md,CLAUDE.md,.cursorrules,.windsurfrules,*.mdc,copilot-instructions.md | Select-Object FullName | Sort-Object FullName | Format-Table -HideTableHeaders`

### Esito osservato

- Il PC **non** e' crashato durante questo re-test
- Le scansioni ricorsive sul repo hanno restituito alcuni risultati ma si sono fermate con `Access denied` su queste directory:
  - `data\.pm2`
  - `data\restore-drill`
  - `data\security-advisor`
  - `data\session_bot`

### Interpretazione

Il re-test non conferma il crash in modo riproducibile. Pero' non e' una replica perfetta del carico originale, perche' la scan e' stata interrotta da permessi negati in alcune directory del repo e quindi potrebbe aver percorso meno file rispetto al caso precedente.

### Implicazione pratica

Se si vuole una prova piu' affidabile, il prossimo livello sarebbe ripetere gli stessi batch con una scansione che attraversi davvero tutte le directory coinvolte, ma quello aumenta di nuovo il rischio di freeze/crash e va considerato come test deliberatamente aggressivo.

### Aggiornamento successivo dello stesso giorno

Gli stessi batch sono stati rilanciati anche fuori sandbox, con il massimo livello di permessi disponibile dalla sessione agente.

Esito:

- nessun crash del PC osservato
- stesso comportamento della scan ricorsiva: elenco parziale dei file e stop su `Access denied`
- il collo di bottiglia non sembra il sandbox dell'agente ma gli ACL Windows su alcune sottodirectory `data\...`

Conclusione aggiornata:

Il crash non e' stato riprodotto nemmeno con il rilancio fuori sandbox. Resta aperta la possibilita' che il crash originale dipendesse da una combinazione piu' pesante di scansioni concorrenti, stato del sistema, o accesso riuscito a directory che oggi vengono fermate dai permessi.

---

## 2026-04-03 — Baseline ripristinata + hardening decision engine AI/navigation

### Problema iniziale trovato

- `npm run pre-modifiche` non era verde per un test fragile in [strategyPlannerAdvanced.vitest.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/tests/strategyPlannerAdvanced.vitest.ts)
- Il test assumeva che in qualunque giorno lavorativo `inviteFactor + messageFactor > 0`, ma il runtime di [strategyPlanner.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/risk/strategyPlanner.ts) porta correttamente i fattori a `0` nel wind-down del venerdi' sera

### Fix baseline

- Reso deterministico il test usando fake timers su una mattina feriale
- Nessuna modifica alla logica runtime di `strategyPlanner`

### Hardening completato sul decision engine

- Introdotto un contratto canonico per `navigationStrategy` in [navigationStrategy.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/navigationStrategy.ts)
- Allineati AI e runtime sui valori:
  - `search_organic`
  - `feed_organic`
  - `direct`
- Aggiunta normalizzazione backward-compatible dei nomi legacy `organic_search` / `organic_feed`
- Reso il decision engine meno fail-open quando l'AI e' **attiva** e il caller richiede `strict`
- In `strict`:
  - `pre_invite`, `pre_message`, `pre_follow_up`, `navigation` degradano a `DEFER`
  - `inbox_reply` degrada a `NOTIFY_HUMAN`
- Mantenuta la compatibilita' storica quando `AI_PERSONALIZATION_ENABLED=false`: fallback ancora permissivo

### Cablaggio runtime completato

- Il decision point `navigation` ora e' cablato davvero nei worker principali:
  - [inviteWorker.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/workers/inviteWorker.ts)
  - [messageWorker.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/workers/messageWorker.ts)
  - [followUpWorker.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/workers/followUpWorker.ts)
- Le preferenze di strategia AI vengono passate a [navigationContext.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/browser/navigationContext.ts)
- La strategia `direct` resta anti-ban-safe: usa comunque la pagina risultati search e click umano, mai `goto` diretto al profilo

### Test aggiunti/aggiornati

- Nuova suite: [aiDecisionEngine.vitest.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/tests/aiDecisionEngine.vitest.ts)
- Estesa: [navigationContext.vitest.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/tests/navigationContext.vitest.ts)
- Fix baseline: [strategyPlannerAdvanced.vitest.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/tests/strategyPlannerAdvanced.vitest.ts)

### Verifica eseguita

- `npm run pre-modifiche`
- `npx tsc -p tsconfig.json --noEmit`
- `npx vitest run src/tests/aiDecisionEngine.vitest.ts src/tests/navigationContext.vitest.ts src/tests/observeAndDecision.vitest.ts`
- `npx madge --circular --extensions ts --ts-config tsconfig.json src`
- `npm run post-modifiche`

### Esito

- baseline repo di nuovo verde
- `madge`: **0 circular dependency**
- test completi: **136/136 file** e **1421/1421 test** verdi

### Nota anti-ban

Questo blocco non aggiunge nuovi click LinkedIn pericolosi e non introduce teletrasporti al profilo. Cambia il layer decisionale e rende piu' rigoroso il comportamento quando l'AI e' attiva, mantenendo il motore fisico e la policy anti-teleport coerenti con il runtime esistente.

---

## 2026-04-04 — Audit statico end-to-end per production readiness del bot

### Obiettivo

Capire cosa manca davvero tra avvio del bot, esecuzione workflow, control plane, browser/proxy/sessione, reporting e spegnimento, con focus esplicito su collegamenti diretti e indiretti del runtime.

### Perimetro analizzato

- entrypoint CLI e bootstrap: [index.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/index.ts)
- loop daemon e run manuale: [loopCommand.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/cli/commands/loopCommand.ts)
- orchestrazione workflow: [orchestrator.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/orchestrator.ts), [scheduler.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/scheduler.ts), [jobRunner.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/core/jobRunner.ts)
- ingress automation/API e read model: [dispatcher.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/automation/dispatcher.ts), [automationReadModel.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/api/helpers/automationReadModel.ts), [server.ts](C:/Users/albie/Desktop/Programmi/Linkedin/src/api/server.ts)
- browser/proxy/sessione/reporting: moduli `browser/`, `proxy/`, `telemetry/`, `cloud/telegramListener.ts`
- process management: [ecosystem.config.cjs](C:/Users/albie/Desktop/Programmi/Linkedin/ecosystem.config.cjs), script `package.json`

### Blocker P0 emersi

- Il lock del daemon puo' scadere durante una run ancora attiva, aprendo la porta a due executor concorrenti sullo stesso bot
- Lo shutdown non e' cooperativo: `process.exit(0)` puo' troncare i `finally` di loop e job runner, lasciando lock, metriche e stato runtime sporchi
- Il restart remoto via Telegram/cloud bypassa il graceful shutdown e puo' lasciare stato incoerente
- Il reporting live non attraversa i processi PM2: daemon e API non condividono davvero eventi live, stato proxy o stato JA3
- Il contratto di esito workflow non propaga gli incidenti runtime critici: il bot puo' auto-pausarsi/quarantinarsi e il workflow risultare comunque `completed`
- Lo scheduler accoda `INTERACTION`, ma il workflow engine non lo consuma nella stessa run
- L'ingresso automation/non-interattivo forza `skipPreflight` e salta davvero gran parte del preflight a 6 livelli
- L'override account e' globale di processo e non viene ripristinato dopo la run
- `checkLogin()` confonde rate limit, `403`, timeout e problemi proxy con "login mancante", quindi puo' innescare remediation sbagliate
- Il gate "proxy healthy" e' troppo debole: controlla apertura TCP, non credenziali, `CONNECT`, uscita reale o browsing effettivo

### Gap P1 importanti

- I boundary dei workflow non sono ancora puliti: le run orchestrate eseguono anche inbox scan e follow-up fuori dal contratto nominale del workflow
- `automation_commands` puo' restare zombie in `RUNNING` dopo crash o stop brutale
- Una coda automation rumorosa puo' affamare il workflow principale del loop
- I report `send-invites` e `send-messages` stimano l'outcome con delta su contatori globali, non con esito runtime isolato della singola run
- Lo snapshot scheduler/report sottostima il lavoro reale pianificato: non rappresenta bene `HYGIENE`, `POST_CREATION`, `ENRICHMENT`
- `/api/health/deep` non rappresenta la readiness reale di produzione: non copre daemon liveness, proxy reale, JA3/session freshness o zombie automation command
- Dashboard/API non hanno un vero graceful drain di HTTP, SSE e WebSocket
- PM2 ha timeout di stop incompatibili con il budget di shutdown dichiarato dall'app
- Telegram alert/listener hanno buchi di affidabilita': `response.ok` non verificato e checkpoint updates non flushato allo shutdown
- Sentry non copre bene i crash che contano di piu' nel path `unhandledRejection` / `uncaughtException`

### Cose giudicate gia' sane

- Le entry guard workflow sono centralizzate e richiamate in modo coerente
- Il boot ha gia' un preflight serio su proxy e JA3 prima dei comandi browser
- La coda automation ha claim transazionale e idempotency key
- Il grafo `src` e' ancora a `0` circular dependency dopo il refactor architetturale precedente

### Verifica eseguita

- `npm run pre-modifiche`
- Nota operativa: in sandbox `vitest` falliva con `spawn EPERM`; il rerun fuori sandbox ha confermato che il repo e' verde e che il problema era del contesto di esecuzione, non della codebase
- Nessuna modifica runtime in questo blocco: audit statico soltanto

### Esito

Il bot ha gia' un percorso end-to-end leggibile e un runtime significativo, ma non e' ancora production-ready come sistema unico e affidabile da "start" a "stop". I blocker veri non sono piu' "manca il workflow", ma:

- lifecycle concorrente e shutdown non robusto
- control plane/reporting non allineato al runtime reale
- workflow result troppo ottimistico rispetto agli incidenti reali
- proxy/auth/session health classificati in modo troppo debole o ambiguo
- divergenza ancora aperta tra motore workflow orchestrato e workflow Sales Navigator tipizzati

### Cosa resta da analizzare davvero

Sul piano statico, il quadro utile e' ormai sufficiente. Le verifiche mancanti non sono altri grep o altre letture, ma test dinamici mirati:

- run staging reali con browser/proxy/account veri
- verifica cross-process reale tra daemon PM2 e API dashboard
- prove di stop/restart forzato durante run attiva
- prove su login degradato, proxy auth failure, rate limit e session cookie stale
- verifica di liveness/readiness osservata dal control plane mentre il daemon e' fermo, bloccato o concorrente

