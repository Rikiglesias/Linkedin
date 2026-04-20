# AI Operating Model

> **Questo documento è aspirazionale ma tracciato.**
> Ogni sezione ha uno status: ✅ Implementato | ⚠️ Parziale | ❌ Non ancora fatto.
> Le implementazioni concrete stanno in: `~/.claude/CLAUDE.md` (regole globali), `AGENTS.md` (progetto), `~/.claude/skills/` (skill), `~/memory/` (memoria).

**Obiettivo centrale**: un sistema AI che ragiona bene, non dimentica nessuna regola rilevante, non assume che l'input dell'utente sia automaticamente corretto e non dichiara mai "fatto" senza aver verificato davvero tutto. L'obiettivo non e' un flusso fisso uguale per ogni task, ma un'orchestrazione cognitiva capace di capire il caso e scegliere il metodo corretto.

Per la lista madre unica, esplicita e non duplicata del sistema desiderato, vedere anche [AI_MASTER_SYSTEM_SPEC.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_MASTER_SYSTEM_SPEC.md).
Per il backlog madre unico dei punti ancora da chiudere, vedere [AI_MASTER_IMPLEMENTATION_BACKLOG.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_MASTER_IMPLEMENTATION_BACKLOG.md).
Per le viste lineari per review e pruning: [AI_IMPLEMENTATION_LIST_GLOBAL.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/AI_IMPLEMENTATION_LIST_GLOBAL.md) e [LINKEDIN_IMPLEMENTATION_LIST.md](/C:/Users/albie/Desktop/Programmi/Linkedin/docs/LINKEDIN_IMPLEMENTATION_LIST.md).

Nota di stato da tenere fissa nei canonici: il modello canonico resta di 9 livelli; l'enforcement meccanico attuale copre L1 e L7-L9; L2-L6 restano definiti ma ancora da promuovere a enforcement `blocking`; nel frattempo L2-L6 audit-assisted tramite registri machine-readable + advisory hook + audit dedicati.

---

## Stato rapido

| # | Punto | Status |
|---|-------|--------|
| 1 | Ragionamento e contesto completo | ✅ |
| 2 | Loop e verifica sistematica | ⚠️ (`L2-L6` audit-assisted; ancora non blocking sul task specifico) |
| 3 | Selezione autonoma degli strumenti | ⚠️ (routing operativo advisory implementato; parity e metrica miss ancora aperte) |
| 4 | Regole che non si dimenticano | ⚠️ (audit verde: snapshot 29/42 enforced, 0 gap meccanizzabili) |
| 5 | Contesto e memoria tra sessioni | ✅ |
| 6 | Sistema hook pre/post | ✅ |
| 7 | n8n e agenti verticali | ⚠️ |
| 8 | Parità ambienti | ⚠️ |
| 9 | Strumenti personali e ambienti | ⚠️ |
| 10 | Manutenzione e produzione | ⚠️ |
| 11 | Sicurezza e compliance | ⚠️ → ✅ parziale (2026-04-09) |
| 12 | Autonomia totale | ⚠️ |
| 13 | Orizzonti temporali e periodicita' | ⚠️ |

---

## Ordine corretto di implementazione (non numerico)

La lista non va implementata in ordine 1, 2, 3. Va implementata in ordine di dipendenze e riduzione del rischio:

### Fase A — Base cognitiva e truthful control plane

Punti coinvolti: **3, 4, 6, 12**

Prima di aggiungere altra automazione bisogna rendere piu' affidabile il cervello operativo del sistema:
- scelta strumenti davvero contestuale e spiegata bene
- regole critiche trasformate in enforcement reale dove serve
- hook e audit truthful
- riduzione del gap tra "esiste una capability" e "l'AI la riconosce e la propone quando serve"

Se questa fase resta debole, tutto il resto viene implementato su una base che continua a dimenticare o a scegliere male.

### Fase B — Runtime reale, sicurezza operativa e produzione

Punti coinvolti: **10, 11**

Subito dopo viene il sistema reale:
- lifecycle daemon, shutdown, restart, zombie state
- runtime truthfulness tra bot, API, dashboard e reporting
- classificazione proxy/session/login
- compliance e anti-ban con riscontro concreto sul runtime

Questa fase viene prima di n8n avanzato e prima della parity ambienti, perche' mette in sicurezza il cuore del bot.

### Fase C — n8n e agenti verticali su base stabile

Punti coinvolti: **7**

Solo quando il runtime e i gate sono piu' affidabili conviene spingere davvero n8n:
- import workflow mancanti
- hook ingresso/uscita n8n
- memoria nei workflow dove serve
- human-in-the-loop vero per i casi ad alto rischio
- miglioramento dei workflow bot, non solo di quelli di supporto

Far crescere n8n prima della Fase B amplifica automazione su stato ancora troppo fragile.

### Fase D — Parita' ambienti e strumenti personali

Punti coinvolti: **8, 9**

Poi si chiudono i gap tra ambienti e tool:
- Codex parity reale
- capability equivalenti tra Claude Code e Codex dove possibile
- problemi computer residui
- rifinitura strumenti personali e ambiente operativo

Questa fase e' importante, ma viene dopo la stabilizzazione del sistema centrale.

### Fase E — Consolidamento e metriche di autonomia

Punti coinvolti: **4, 12**

Infine si chiude il loop meta-operativo:
- metriche vere di compliance
- conversione sistematica dei miss ricorrenti in hook/skill/workflow
- audit periodici automatici
- riduzione progressiva del carico di project management sull'utente

Questa e' la fase che rende il sistema non solo funzionante, ma anche sempre meno dipendente da correzioni manuali.

### Punti gia' abbastanza maturi da non trattare come blocker iniziali

Punti coinvolti: **1, 2, 5**

Questi punti sono gia' abbastanza solidi da fungere da base:
- ragionamento e contesto completo
- loop e verifica sistematica
- memoria e handoff tra sessioni

Non sono "chiusi per sempre", ma non sono il collo di bottiglia principale oggi.

---

## 1. Ragionamento e contesto completo — ✅ Implementato

**Concetto**: l'AI non esegue il testo letterale. Capisce il problema reale, lavora sempre sul contesto completo e non lavora mai su un file in isolamento.

- L'AI capisce l'intento reale dell'utente, non solo le parole. Se la richiesta è ambigua, dettata a voce o incompleta, interpreta semanticamente e dichiara internamente quale problema reale sta risolvendo.
- L'AI non tratta ogni affermazione dell'utente come tecnicamente certa: la usa come segnale importante, ma la verifica contro la fonte di verita' giusta quando il task lo richiede.
- Se il prompt e' lungo o denso, l'AI deve prima estrarre e organizzare i requisiti invece di inseguire solo il punto piu' evidente.
- Se l'utente fa esempi, l'AI non li tratta come lista chiusa: li usa per capire il pattern di ragionamento e inferire altri controlli coerenti con l'obiettivo reale.
- In questo sistema, allucinare non significa solo "inventare un fatto": significa anche dichiarare verifiche non fatte, trattare come certo cio' che e' solo ipotesi o eseguire ciecamente un'idea dell'utente senza verificarne l'impatto reale.
- La severita' richiesta dall'utente va tradotta in standard operativi: zero omissioni tollerate, zero assunzioni gratuite, zero chiusure dichiarate senza copertura reale. Non serve retorica drammatica; servono controlli espliciti.
- Ogni modifica riguarda sia i file toccati direttamente sia quelli coinvolti indirettamente: dipendenze, import, contratti, integrazioni, moduli dipendenti, effetti runtime. L'AI mappa questo perimetro prima di scrivere codice.
- Per ogni file modificato, l'AI controlla automaticamente tutti i domini che quel file può toccare — non solo il motivo principale del cambiamento. I domini sono: sicurezza, performance, tipi, error handling, automazione, integrazioni, architettura, osservabilità. Questo controllo viene dichiarato esplicitamente per ogni file.
- Se non puo' rileggere tutta la codebase, l'AI usa code search, mapping dipendenze/test, documenti canonici, memoria e, quando serve, agenti esplorativi per evitare patch locali cieche.
- Le best practice seguite non sono generiche: dipendono dal tipo di artefatto. Codice TypeScript, documento tecnico, config, workflow n8n, schema API, migrazione DB, file di tracking — ognuno ha le sue regole specifiche. L'AI le applica senza che l'utente le debba specificare.
- L'ordine delle modifiche viene deciso prima di iniziare, così da non rompere import, tipi, runtime o integrazioni. Nessuna modifica è completa se risolve solo una parte lasciando incoerenze nel resto del sistema.
**Implementato in**: P0 Step A, L0 blast radius, L7, L8 in `~/.claude/CLAUDE.md`.

---

## 2. Loop e verifica sistematica — ⚠️ Parziale

**Concetto**: l'AI non dichiara mai "fatto" senza verifica sistematica. Il loop non va acceso per riflesso su tutto: va riconosciuto e usato quando serve davvero per evitare false completion, buchi logici o controlli mancanti.

Stato corrente da non contraddire:

- il modello canonico resta di 9 livelli
- enforcement meccanico attuale copre L1 e L7-L9
- L2-L6 sono audit-assisted tramite `AI_LEVEL_ENFORCEMENT.json`, advisory hook e `audit:l2-l6`
- L2-L6 non sono ancora blocking sul task specifico

- **Uso corretto del loop**: l'AI deve valutare se serve un loop esplicito o un re-check piu' leggero in base a complessita', rischio e possibilita' di lasciare indietro pezzi.
- **Quando il loop e' tipicamente necessario**: task multi-step, refactor con impatti indiretti, debugging con causa non chiara, task dove il primo risultato puo' sembrare plausibile ma non ancora completo.
- **Quando puo' bastare una verifica piu' semplice**: richieste informative stabili, micro-fix locali con blast radius piccolo, modifiche meccaniche gia' coperte da controlli oggettivi.
- **Fonte di verita' prima della modifica**: prima di implementare, l'AI sceglie la fonte piu' affidabile, aggiornata e concreta per quel task. Se il task riguarda framework, API, librerie, provider, policy esterne, best practice aggiornabili o qualsiasi artefatto il cui dominio puo' essere cambiato, web search e documentazione ufficiale diventano obbligatorie. Se il task e' interno puro, repo, test e log restano la fonte primaria. Se documenti e realta' divergono, la divergenza va trattata come bug operativo da correggere prima di dichiarare chiuso il lavoro.
- **L1-L9 su ogni modifica** — applicati automaticamente, proporzionali al task:
  - L1: compilazione + test — bloccante, deve passare prima di procedere
  - L2: catene dirette — tutti i caller dei simboli modificati
  - L3: runtime profondo — null/undefined, memory leak, transazioni DB
  - L4: ragionamento preventivo — "e se null?", "e se fallisce a metà?", "e se chiamato 2 volte?"
  - L5: visione prodotto — UX, accessibilità da UI, performance 200ms, coerenza
  - L6: coerenza sistema — env, migration idempotenti, dato end-to-end
  - L7: multi-dominio per file — 8 domini, dichiarato per ogni file toccato
  - L8: coerenza cross-file — contratti, tipi, import, data flow
  - L9: loop finale — condizioni DONE verificate; se non tutte verdi → riparte; max 3 iterazioni poi BLOCKED con causa esplicita
  - Proporzionalità: quick fix → L1-L4; feature/refactor → L1-L9
- **Auto-commit quando L9=DONE** e exit code 0 — senza aspettare input dell'utente. Eccezioni (chiedere prima): push remote, force push, infrastruttura condivisa.
- **Automatismi**: ogni automatismo segue la sequenza — rileva bisogno → analizza contesto → propone all'utente → attende conferma → esegue → report finale. Nessun automatismo invasivo parte senza conferma esplicita. Quelli di sola lettura o monitoring partono autonomamente.
**Stato attuale**: modello a 9 livelli definito nei canonici; enforcement meccanico attivo su L1 e L7-L9 in `~/.claude/CLAUDE.md`; `L2-L6` promossi a protocollo `audit-assisted` tramite `docs/tracking/AI_LEVEL_ENFORCEMENT.json`, `UserPromptSubmit` advisory hook e `npm run audit:l2-l6`.

---

## 3. Selezione autonoma degli strumenti — ⚠️ Parziale

**Concetto**: l'AI classifica ogni task prima di agire e sceglie gli strumenti necessari senza dipendere da prompt meccanici dell'utente. Questa valutazione deve partire automaticamente a ogni nuovo prompt e a ogni modifica rilevante, ma deve anche spiegare in modo breve il perche' della scelta e, quando serve, ragionare con l'utente sulla mossa giusta.

- Prima di ogni azione, e di nuovo quando il contesto cambia, l'AI classifica internamente il task: tipo di lavoro, skill necessarie, agente o workflow n8n da attivare, se serve ricerca web, quale modello o ambiente è più adatto. Se uno di questi pezzi non viene deciso, la selezione è incompleta.
- Questa classificazione non deve dipendere da un promemoria dell'utente. Deve essere una fase automatica del ragionamento, resa piu' affidabile da runtime brief, hook e canonici.
- La skill più adatta viene scelta dalla mappa in CLAUDE.md — non per abitudine ma per corrispondenza al dominio del task. Se esiste una skill più forte per quel dominio, viene usata quella.
- MCP (Supabase, Playwright, Semgrep, n8n, Gmail, Calendar) vengono attivati quando portano valore reale, nel momento giusto, non in modo casuale o tardivo.
- L'AI raccomanda il modello e l'ambiente migliori per il task (qualità, velocità, costo, tool disponibili, contesto, rischio di errore) e spiega brevemente perché — la decisione finale spetta all'utente prima di aprire la sessione.
- **Criterio corretto**: l'utente non deve dover conoscere il nome della primitive corretta, ma deve poter vedere il ragionamento con cui l'AI propone di usare web/docs, skill, MCP, hook, script, loop o workflow.
- La disponibilita' di slash command o skill manuali non basta: l'AI deve saper riconoscere da sola quando potrebbero servire, e dirlo.
- Se il vero blocco non e' il task in se' ma un gap reale di capability, l'AI deve riconoscerlo e proporre la primitive corretta da creare o rafforzare: skill, hook, memoria, audit, script o workflow.
- Audit continuo del catalogo installato: skill, MCP, plugin, agenti e workflow non usati, duplicati o deboli vengono candidati a rimozione, merge o riclassificazione nella primitive corretta. Nuove capability solo se coprono un gap reale.
- Deve esistere anche una routing matrix per domini pratici, cosi' backend, frontend, browser, DB, documentazione, review, anti-ban, memoria e n8n attivino la capability giusta senza dipendere dall'intuito del momento.
- Base implementata: `docs/tracking/AI_CAPABILITY_ROUTING.json` + `UserPromptSubmit -> skill-activation.ps1` producono un blocco advisory compatto con source of truth, web/docs, capability da usare/escludere, preferred environment e focus `L2-L6`.
- Candidate esterne specifiche, per esempio Caveman, LeanCTX, SIMDex e Contact Skills, vanno trattate come capability da valutare su gap reale, overlap, trigger, qualita' e costo di manutenzione prima di installarle.
**Implementato in**: P0 Step B, tabella skill in `~/.claude/CLAUDE.md`, `docs/tracking/AI_CAPABILITY_ROUTING.json`, `~/.claude/hooks/skill-activation.ps1`, `npm run audit:routing`.
**Gap aperto**: rendere il routing meno dipendente da Claude Code, misurare i miss ricorrenti e trasformare l'advisory in enforcement piu' forte solo dove ha senso.

---

## 4. Regole che non si dimenticano — ⚠️ Parziale

**Concetto**: le regole scritte in un file di testo vengono dimenticate. Le regole critiche devono diventare hook — enforcement duro che non dipende dalla memoria dell'AI. Il file delle regole deve restare corto perché più è lungo, più regole vengono dimenticate.

- Ogni regola deve avere: trigger (quando si applica), ambito (su cosa), azione (cosa fare), collegamenti (file/sistemi diretti e indiretti), verifica (come controllare che sia stata applicata). Se manca uno di questi, la regola è incompleta.
- **Hook-first per le regole critiche**: se una regola è abbastanza importante da non poter essere dimenticata, deve diventare un hook in `settings.json` — non può restare solo testo in CLAUDE.md. Testo = può essere dimenticato. Hook = viene sempre eseguito.
- **File regole corto = AI ricorda tutto**: CLAUDE.md deve restare abbastanza compatto da poter essere letto e tenuto in contesto affidabilmente in una sessione. Più cresce, più regole vengono dimenticate. Prima di aggiungere → eseguire `claude-md-management:claude-md-improver` per pulire. Mai aggiungere a un file disorganizzato.
- **Audit periodico delle regole**: verificare che le regole si attivino davvero nel momento giusto — non solo che siano scritte. Regole che non producono comportamento reale → convertire in hook o rimuovere. Regole dimenticate più di una volta → diventano hook obbligatoriamente.
- **Controlli truthful**: audit automatici, hook log, checklist e script di conformità devono essere allineati al formato reale corrente di hook, skill, config e workflow. Un controllo che produce falsi verdi o falsi rossi è debito operativo, non una semplice imperfezione.
- Non affidarsi solo alla memoria del modello: usare memoria persistente separata per tipo (procedurale, semantica, episodica), checklist obbligatorie, output strutturati, subagenti specializzati.
**Implementato**: hook antiban ✅, hook qualità ✅, pre/post-conditions skill ✅, `permissionDecision: "deny"` hook antiban ✅, audit conformità hook ✅ (`npm run audit:hooks`), audit statico canonici/control plane ✅ (`npm run audit:ai-control-plane`), violations-tracker PostToolUse hook ✅ (logga miss antiban in `rule-violations-log.txt`) (2026-04-09), skill `/audit-rules` ✅ (legge log, propone conversioni in hook) (2026-04-09), registri machine-readable di routing e `L2-L6` ✅ (`AI_CAPABILITY_ROUTING.json`, `AI_LEVEL_ENFORCEMENT.json`), advisory hook di routing ✅ (`skill-activation.ps1`), `audit:rule-enforcement` verde con snapshot `29/42`, `0` gap meccanizzabili (2026-04-19).
**Mancante**: metrica automatica percentuale compliance ❌ (richiede dataset di almeno 2-4 settimane di violations log prima di essere significativa).

---

## 5. Contesto e memoria tra sessioni — ✅ Implementato

**Concetto**: nessuna sessione riparte da zero. Il contesto viene trasferito automaticamente e i file di memoria sono progettati per essere letti bene dall'AI, non solo dall'umano.

- **`/context-handoff`**: skill che trasferisce in una nuova sessione obiettivi, stato, decisioni, file toccati, problemi aperti e prossimi passi. Va usata automaticamente a fine ogni sessione significativa.
- Ogni file di memoria ha una responsabilità unica: preferenze utente, decisioni, stato lavori, tracking, regole, backlog e handoff non vanno mescolati nello stesso file.
- Ogni file di contesto dice: cosa contiene, cosa non contiene, quando va aggiornato, a quale file canonico è collegato. Apertura chiara, sezioni piccole, riepilogo finale di stato/decisioni/prossimi passi/blocchi.
- File troppo grande o con troppi temi → split in indice + file tematici. Mai mega-file con tutto dentro.
- Le informazioni importanti non restano solo in chat: se servono alla prossima sessione, vengono promosse nel file canonico giusto prima di chiudere.
- La memoria va gestita su tre orizzonti:
  - breve termine = salvare subito decisioni e stato appena emersi
  - medio termine = consolidare handoff e backlog operativo dello stesso blocco
  - lungo termine = pulizia, dedup e audit periodico dei file memory
- **Degrado del contesto e nuova sessione**: se il requirement ledger perde copertura, ricompaiono omissioni, aumentano le contraddizioni o la sessione diventa troppo grande per restare affidabile, l'AI deve preparare `context-handoff` e proporre la continuazione in una nuova chat invece di forzare il ragionamento in stato degradato.

**Implementato in**: `~/.claude/skills/context-handoff/`, sistema `~/memory/`, `MEMORY.md`.

---

## 6. Sistema hook pre/post — ✅ Implementato (rafforzato 2026-04-15)

**Concetto**: l'enforcement non dipende dalla memoria dell'AI ma da meccanismi che partono automaticamente prima e dopo ogni azione critica.

- **Pre-hook**: valida contesto, prerequisiti, dipendenze e rischi prima che l'azione avvenga. Se le condizioni non sono soddisfatte, blocca.
- **Post-hook**: verifica esito, esegue cleanup, registra log, lascia il sistema in stato coerente.
- **Durante**: Claude Code non espone un evento separato chiamato "during". Il pattern corretto e' enforcement continuo su ogni tool use tramite `PreToolUse`/`PostToolUse`, piu' `SessionStart`, `Stop` e task events.
- **Implementato in `settings.json`**:
  - `SessionStart` carica memoria globale, todos e indice memoria progetto nel contesto iniziale
  - `PreToolUse` bloccante su Edit/Write per file LinkedIn sensibili (browser, stealth, timing, playwright, fingerprint, sessione) → forza `/antiban-review` prima di procedere
  - `PreToolUse` bloccante su Bash per `git commit` → richiede quality gate recente e stato commit-ready
  - `PreToolUse` bloccante su Bash per `git push` → richiede repo push-ready e blocca branch condivisi / repo sporco / divergenza
  - `PostToolUse` asincrono su Bash con comandi qualità (`tsc`, `madge`, `vitest`, `npm run`) → log in `memory/quality-hook-log.txt`
  - `PostToolUse` asincrono su Bash per `post-modifiche`, `conta-problemi`, `git commit`, `git push` → audit git automatico e log in `memory/git-hook-log.txt`
  - `Stop` con log working dir → `memory/session-log.txt`
- **Skill con pre/post-conditions**:
  - `antiban-review`: pre (quando invocarla obbligatoriamente), post (azione per ogni verdetto SAFE/REVIEW/BLOCK)
  - `loop-codex`: pre (L1 pulito, task misurabile, scope definito), post (auto-commit se DONE, worklog)
  - `context-handoff`: pre (git status, memoria aggiornata, active.md), post (SESSION_HANDOFF.md committato)
- **Gap residui**: hook in ingresso/uscita per workflow n8n (richiedono n8n attivo) ⚠️; parity di enforcement fuori da Claude Code ❌

---

## 7. n8n e agenti verticali — ⚠️ Parziale

**Concetto**: n8n non è solo automazione del bot — è l'orchestratore tecnico dell'intero sistema. I workflow girano automaticamente nei giorni e orari giusti, senza intervento manuale.

### Workflow DevOps (in `n8n-workflows/`)

| File | Trigger | Funzione |
|------|---------|---------|
| `quality-gate-check.json` | Webhook / manuale | Typecheck + lint → Telegram pass/fail |
| `gdpr-retention-cleanup.json` | Cron lunedì 9:00 | Dry-run GDPR → conferma → esegue |
| `bot-health-check.json` | Cron 9/13/17 lun-ven | PM2 + dashboard health → alert se down |
| `weekly-lead-report-v2.json` | Cron venerdì 17:00 | Stats settimana → Telegram |

### Agenti verticali LinkedIn (in `n8n-workflows/`)

| File | Trigger | Funzione |
|------|---------|---------|
| `linkedin-antiban-review.json` | Webhook / manuale | Analizza file modificati, checklist 5 domande, SAFE/REVIEW |
| `linkedin-campaign-analyzer.json` | Cron lunedì 8:00 | Acceptance/reply/pending rate, alert se soglie superate |
| `pre-production-checklist.json` | Webhook / manuale | Gate READY/NOT READY pre-deploy |
| `codebase-audit.json` | Cron domenica 10:00 | Circular deps / TODO / file >300 righe |
| `lead-pipeline-health.json` | Cron lun-ven 8:00 | Alert se pending >50 o bot inattivo; silenzioso se ok |

**Architettura comune**: pre-hook (valida env vars, filtra weekend), post-hook (log timestamp + durata + esito).

**Per attivare**: avviare n8n → importare JSON in `Settings → Import Workflow` → configurare `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DASHBOARD_API_KEY`, credenziale Postgres.

**Gap**:
- Workflow bot LinkedIn (inviteWorker, messageWorker, sequenze follow-up) non ancora migliorati ❌
- Guida setup completa per passare il sistema ad altri ✅ `docs/SETUP.md` (2026-04-09)
- Hook n8n in ingresso/uscita non ancora attivi ⚠️ (richiedono n8n online)

---

## 8. Parità ambienti — ⚠️ Parziale

**Concetto**: ogni ambiente usato per lavorare sul progetto si comporta in modo coerente — stesse regole, stessi file canonici, stessi meccanismi di enforcement.

- Claude Code: full capability — CLAUDE.md, memoria, hook, MCP, skill, agenti ✅
- Codex: usa per coding profondo e analisi codebase; AGENTS.md come file canonico; non ha memoria persistente né MCP nativi → complementare a Claude Code, non sostituto ⚠️
- Cursor/Windsurf/Trae: ambienti secondari con limiti espliciti ❌
- Per ogni ambiente: definire quali file di regole legge, quali tool/MCP supporta, quali hook o equivalenti ha, quali skill/comandi sono disponibili, quali limiti ha.
- Se una capability manca in un ambiente → progettare un sostituto: wrapper, workflow, checklist, slash command.
- Audit periodico di drift: se un hook o skill funziona in Claude Code ma manca in Codex → gap documentato e corretto dove possibile.

---

## 9. Strumenti personali e ambienti — ⚠️ Parziale

**Concetto**: strumenti che migliorano la qualità dell'input all'AI e l'ambiente di lavoro quotidiano.

- **Whisper dictation** ✅ creato in `C:\Users\albie\tools\whisper-dictation\`
  - F9 start/stop → testo in clipboard → notifica Windows
  - Per attivare: `pip install keyboard` + API key in `.env` + `start.bat` come admin
  - Sostituisce Win+H con maggiore precisione e controllo
  - **Alternativa matura 2026**: [OpenWhispr](https://github.com/OpenWhispr/openwhispr) — cross-platform, offline + cloud, meeting auto-detection, 100+ lingue, privacy-first. Se il tool custom dà problemi → valutare migrazione a OpenWhispr.
  - **Modello migliore**: `whisper-large-v3` (Hugging Face) per qualità massima locale; API OpenAI `gpt-4o-transcribe` per velocità cloud. Latenza target: <500ms.
- **Procedura alimentatore** ✅: spegnimento OS → interruttore su O → rimozione spina prendendo la testa, non il cavo
- **Problema computer** ⚠️: documentato in `~/memory/computer.md`, non ancora risolto
- **Modello e ambiente** ✅ (2026-04-09): tabella di riferimento qui sotto. La scelta finale spetta all'utente prima di aprire la sessione.
- **Codex**: da autenticare (`! codex login`) e configurare con AGENTS.md come file canonico ⚠️

### Quale modello/ambiente per quale task

| Task | Modello consigliato | Ambiente | Perché |
|------|-------------------|----------|--------|
| Coding profondo, refactor multi-file, analisi codebase | Claude Opus 4.6 (Plan mode) | Claude Code | Massima capacità di ragionamento + tool completi |
| Bug fix singolo, feature 1-3 file | Claude Sonnet 4.6 | Claude Code | Velocità/costo bilanciati, full tool access |
| Review rapida, domanda veloce | Claude Sonnet 4.6 | Claude Code | Default session |
| Coding isolato senza UI, analisi repo grandi | Codex (Claude Sonnet 4.6) | Terminale | Non blocca sessione principale; buono per repo scan |
| Workflow n8n (crea/modifica/valida) | Sonnet 4.6 + `n8n-builder` agent | Claude Code | MCP n8n disponibile solo qui |
| DB query/migration | Sonnet 4.6 + MCP Supabase | Claude Code | MCP Supabase disponibile solo qui |
| Debug visivo UI/browser | Sonnet 4.6 + MCP Playwright | Claude Code | MCP Playwright disponibile solo qui |
| Security scan | Sonnet 4.6 + MCP Semgrep | Claude Code | MCP Semgrep disponibile solo qui |
| Task lunghi/automatici overnight | Opus 4.6 in background | Claude Code remote trigger | Qualità massima; l'utente non deve seguire |

**Quando usare Plan mode** (`/model opusplan`): architettura, refactor significativo, feature >5 file, decisione con trade-off profondi — Opus 4.6 pianifica, Sonnet 4.6 esegue.

---

## 10. Manutenzione e produzione — ⚠️ Parziale

**Concetto**: ogni tipo di artefatto ha trigger espliciti di manutenzione — non "pulirò quando è il momento" ma regole concrete che scattano automaticamente.

### Trigger per tipo di artefatto

| Tipo | Trigger cleanup | Trigger aggiornamento |
|------|----------------|----------------------|
| **Codice** | File >300 righe + nuova feature; area mal strutturata da toccare | Dead code rilevato; circular deps > 0 |
| **Regole (CLAUDE.md, AGENTS.md)** | File >300 righe o nuova sezione → `claude-md-management:claude-md-improver` prima | Regola dimenticata >1 volta → hook; nuova skill installata |
| **Memoria** | Memoria contraddice stato attuale; >6 mesi non toccata | Fine sessione significativa; decisione architetturale; priorità cambiate |
| **Documenti tecnici** | — | Punto implementato → aggiorna status; struttura progetto cambiata → README |
| **Skill** | Skill non usata 30gg; sovrapposta ad altra | Comportamento non riflette più realtà progetto |
| **Workflow n8n** | Non eseguito 14gg; errori ripetuti | Modifica bot tocca area del workflow |

### Cadenze periodiche minime da rendere sistemiche

| Tema | Breve termine | Medio termine | Lungo termine |
|---|---|---|---|
| **Code review** | review locale del delta corrente | review del blocco/branch stabile | audit periodico architettura, sicurezza, performance |
| **Memoria** | update immediato di decisioni/stato | handoff e allineamento canonici | pulizia drift, split file, dedup |
| **Documenti** | aggiornare il canonico toccato | riallineare overview e tracking del blocco | cleanup periodico dei documenti e della root |
| **Automazione** | scegliere bene skill/MCP/web/loop/hook ora | chiudere i gap ricorrenti della stessa iniziativa | promuovere verso script, audit, workflow persistenti o n8n |
| **Git** | commit corretto del blocco verificato | review della branch / PR readiness | audit periodico del flusso commit/push e delle policy |

Questa matrice serve a evitare due errori opposti:
- trattare tutto come urgente e immediato
- rimandare a "manutenzione futura" obblighi che servono per chiudere bene il task corrente

**Baseline minima dei controlli periodici di salute della codebase**:
- file >300 righe o con responsabilita' miste
- drift strutturale, naming debole e dead code
- circular deps e contratti cross-file fragili
- documenti, memoria e checklist fuori allineamento
- security check mirati sulle aree sensibili

### Produzione e handoff
- Guida setup completa (n8n + bot + PM2 + credenziali) per passare il sistema ad altri ✅ `docs/SETUP.md`
- Checklist 360 riusabile ✅ creata in `docs/360-checklist.md` (119 check, 15 aree)
- Workflow bot LinkedIn (inviteWorker, messageWorker, sequenze follow-up) da migliorare ❌

---

## 11. Sicurezza e compliance — ⚠️ Parziale

**Concetto**: ogni modifica viene valutata anche rispetto a vincoli esterni — piattaforma, legge, sicurezza. Non è opzionale.

### Anti-ban LinkedIn
- Prima di ogni modifica che tocca browser, timing, stealth, volumi o sessione → review anti-ban obbligatoria automatica (hook PreToolUse attivo ✅)
- 5 domande obbligatorie: cambia comportamento browser? timing/delay? fingerprint/stealth/cookie/sessione? aggiunge azioni LinkedIn? cambia volumi/budget/cap?
- Principi non negoziabili: varianza su tutto, sessioni credibili, pending ratio controllato, navigazione umana
- **Status**: hook ✅; 6a domanda behavioral biometrics ✅; monitoring Telegram ⚠️; eval automatico comportamento ❌; web search periodica schedulata ✅ (linkedin-detection-monitor.json)

**Nuovi vettori di detection 2026** (da aggiornare nella skill antiban-review):
- **Behavioral biometrics ML**: LinkedIn usa ML per analizzare il "ritmo" dell'account — se i delay sono matematicamente precisi (es. esattamente 45s ogni azione), flagga automaticamente. La randomizzazione deve simulare hesitation umana, non solo range numerico.
- **VPN detection**: i VPN vengono rilevati dal pattern di cifratura del traffico; gli IP datacenter sono già in blacklist. Preferire IP residenziali o 4G. Il nostro setup Oxylabs (proxy residenziali) è corretto.
- **Limite safe confermato**: 80 azioni/giorno è il threshold usato da piattaforme anti-ban professionali — non superare.
- **GDPR Right to Erasure in DB**: quando un lead richiede cancellazione, la purge deve coprire anche i database di automazione (non solo il DB principale). La nostra migration 059 copre leads ma verificare audit_log e eventuali cache. ⚠️

### GDPR
- Dati lead LinkedIn sono dati personali (Reg. UE 2016/679)
- **Implementato** (2026-04-08): retention policy ✅ (migration 059, 180gg anonimizza/365gg cancella); audit trail ✅ (auditLog.ts in messageWorker + inviteWorker); `docs/GDPR_POLICY.md` ✅
- Cleanup manuale: `npx ts-node src/scripts/gdprRetentionCleanup.ts --dry-run`
- **Mancante**: scheduling automatico cleanup ❌ (workflow JSON pronto in `n8n-workflows/gdpr-retention-cleanup.json`, da importare manualmente in n8n UI); registro trattamenti art. 30 ✅ creato `docs/GDPR_ART30_REGISTER.md` (2026-04-09)
- **Right to Erasure** ✅ (2026-04-08): `runRightToErasure(url)` anonimizza anche `audit_log.lead_identifier` — caso edge del `--delete-only` coperto

### Sicurezza sistema
- Credenziali solo in `.env`, mai in codice o log ✅
- DB PostgreSQL: rete interna docker, porta 5432 non esposta ✅
- n8n: basic auth configurata ✅
- Dashboard: porta 3000 su `127.0.0.1` ✅
- Audit periodico credenziali ⚠️: procedura manuale in `docs/SETUP.md` sezione 9; `npm run secrets:rotate` per rotazione automatica

---

## 12. Autonomia operativa totale — ⚠️ Obiettivo finale

**Concetto**: l'AI si attiva da sola su tutto il precedente senza che l'utente faccia da project manager tecnico. Non è improvvisazione — è applicazione sistematica e automatica di regole esplicite.

### Automation-first fino al confine di sicurezza

L'obiettivo non e' "piu' automazione possibile in assoluto", ma **piu' affidabilita' possibile senza trasformare tutto in un rituale fisso o in un'automazione cieca**.

**Principio guida**:
- tutto cio' che e' ripetibile, ricorrente e verificabile deve essere automatizzato il prima possibile
- tutto cio' che e' invasivo, irreversibile o ad alto rischio deve restare confermato esplicitamente dall'utente
- automatico significa non dimenticare i controlli rilevanti, non eseguire sempre gli stessi passaggi a prescindere dal caso

**Scala di promozione dell'automazione**:
1. nota in chat o osservazione temporanea
2. regola esplicita in file canonico
3. checklist o template strutturato
4. skill
5. hook
6. script, audit o quality gate eseguibile
7. workflow persistente o n8n

**Regola pratica**:
- se un passaggio viene dimenticato o ri-spiegato piu' volte, non va lasciato allo stesso livello
- va promosso di uno step nella scala sopra finche' non dipende piu' dalla memoria del modello o dell'utente
- se una capability automatica esiste solo in un ambiente, il sistema non e' ancora abbastanza automatico: c'e' un gap di parity da chiudere
- se l'AI continua a non riconoscere quando servono loop, MCP, web search o altri controlli, la capability non e' ancora abbastanza robusta e va migliorata
- se l'AI non distingue cosa appartiene al breve termine, cosa al medio termine e cosa al lungo termine, il sistema resta ancora troppo dipendente dal project management manuale dell'utente
- esiste ora un audit statico del control plane che misura coerenza minima tra canonici, hook e skill chiave; non misura ancora da solo la qualita' del ragionamento runtime
- commit e push devono essere governati in modo esplicito: commit come chiusura naturale di un blocco verificato, push solo quando il contesto remote lo rende sicuro e corretto
- esiste ora anche un audit git contestuale (`npm run audit:git-automation`) che misura in modo eseguibile se il repository e' in stato `READY`, `REVIEW`, `BLOCKED` o `NOOP` per commit e push

**Da automatizzare per default**:
- memoria delle regole rilevanti
- reiniezione di un brief runtime compatto prima dei nuovi prompt e prima della compattazione
- classificazione task
- classificazione per orizzonte temporale
- scelta fonte di verita'
- rilevazione dei capability gap e proposta della promozione corretta
- quality gate e verifiche oggettive
- rilevazione del degrado del contesto con preparazione dell'handoff
- handoff e aggiornamento stato
- audit periodici e monitoraggio drift
- commit di unita' logiche gia' verificate

**Da decidere caso per caso con ragionamento esplicito**:
- uso del loop
- uso di MCP specifici
- uso della ricerca web/docs ufficiali quando il confine del task non e' ancora chiaro
- uso di workflow, agenti o skill non ovvi
- push su remote o apertura PR
- creazione di nuove primitive durevoli (skill, hook, workflow persistenti, automazioni strutturali)

**Da non automatizzare senza conferma**:
- deploy strutturali
- modifiche distruttive o irreversibili
- cleanup invasivi
- operazioni con impatto su dati, produzione o rischio dominio alto
- push su branch protetti/condivisi o integrazioni remote non chiare

**L'AI è autonoma quando**:
- L'AI non dimentica di classificare il task, richiamare le regole rilevanti e scegliere la fonte di verita' ✓
- L'AI non finge completezza o verifica quando il lavoro non e' stato davvero eseguito e controllato ✓ come requisito, ⚠️ ancora da misurare meglio in modo automatico
- L'AI decompone i prompt lunghi in requisiti espliciti e non perde i punti sottili ⚠️ requisito ora esplicitato, enforcement ancora da rafforzare
- L'AI tratta omissioni e assunzioni non verificate come failure del task invece di aspettare che le scopra l'utente ⚠️ requisito ora esplicitato, enforcement ancora da rafforzare
- Un `UserPromptSubmit` hook e un `PreCompact` hook reiniettano il runtime brief del progetto prima dei prompt e prima del compact ✓ (Claude Code)
- L'AI sa riconoscere quando proporre loop, MCP, web search o workflow, senza aspettare che l'utente glielo scriva ❌
- L'AI spiega in modo breve perche' propone o non propone certe primitive ❌
- L'AI riconosce quando manca la primitive corretta e propone la creazione o l'upgrade giusto ⚠️ requisito esplicitato, enforcement ancora da rafforzare
- L'AI rileva degrado del contesto e propone `context-handoff` o nuova sessione prima che la qualita' crolli ⚠️ requisito esplicitato, enforcement ancora da rafforzare
- Il modello a 9 livelli e' definito nei canonici e non viene ridotto per comodita' ✓, ma l'enforcement meccanico oggi copre solo L1 + L7-L9 ⚠️
- Skill, MCP, agente, workflow vengono scelti o proposti senza essere indicati ⚠️ ancora parziale
- Il commit parte come chiusura naturale di un blocco verificato ⚠️ → enforced in Claude Code per i blocker noti
- Il push viene deciso correttamente in base a branch policy, upstream, review e rischio ⚠️ → enforced in Claude Code per i blocker locali, non ancora cross-ambiente
- Esiste un audit eseguibile che rende oggettiva la readiness git di commit/push ✅
- Le regole critiche sono tutte in hook (non solo testo) ❌ (parziale)
- Il progetto espone un `AI_RUNTIME_BRIEF.md` derivato dai canonici e caricato meccanicamente nei punti giusti ✓
- Un sistema misura quali regole vengono dimenticate e le converte in hook ❌
- I workflow n8n girano in autonomia nei giorni e orari giusti ❌ (n8n da attivare)
- Nessuna "false completion" — il task non si chiude senza il livello di verifica giusto per quel caso ✓ (implementato)

**Dipende da**: punti 4 (hook-first completo) + 7 (n8n attivo) + 10 (produzione) completati.
