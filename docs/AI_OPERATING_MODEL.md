# AI Operating Model

> **Questo documento è aspirazionale ma tracciato.**
> Ogni sezione ha uno status: ✅ Implementato | ⚠️ Parziale | ❌ Non ancora fatto.
> Le implementazioni concrete stanno in: `~/.claude/CLAUDE.md` (regole globali), `AGENTS.md` (progetto), `~/.claude/skills/` (skill), `~/memory/` (memoria).

Questo documento raccoglie in forma esplicita la roadmap operativa emersa in chat.
Non e' un file di regole runtime come `AGENTS.md`: qui stanno obiettivi, direzioni e automazioni da costruire.

---

## Roadmap di implementazione — ordine obbligatorio per dipendenze

> **Principio meta:** prima di modificare un file di regole o di memoria, eseguire prima il punto che dice di pulirlo/auditarlo. Aggiungere contenuto a un file disorganizzato lo rende peggiore, non migliore.
> Es: `claude-md-management:claude-md-improver` va eseguito PRIMA di estendere CLAUDE.md con nuove sezioni.

### Dipendenze tra i punti ancora ⚠️

```
BLOCCO A — Fondamenta operative (nessuna dipendenza esterna):
  [0] Regole esplicite ✅ → BASE per tutto
  [4-bis] File memoria leggibili ✅ → prerequisito per AI context affidabile
  [4-ter] Anti-dimenticanza ✅ → prerequisito per L9 + hook
  [9] Best practice per artefatto ✅ → prerequisito per ogni implementazione
  [10] Ragionamento umano ✅ → prerequisito per autonomia

BLOCCO B — Sistema di controllo (dipende da A):
  [13] Protocollo multi-livello ✅ → dipende da [0], [9]
  [14] Multi-dominio per file ✅ → dipende da [13]
  [15] Loop finale completezza ✅ → dipende da [13], [14]
  [11] Contesto diretto/indiretto ✅ → dipende da [13]

BLOCCO C — Enforcement automatico (dipende da B):
  [8-bis] Hook system ✅ (2026-04-04) → PreToolUse antiban, PostToolUse quality log, Pre/Post-conditions su antiban-review/loop-codex/context-handoff; n8n hook documentati ma non ancora attivi

BLOCCO D — Orchestrazione (dipende da C):
  [5] n8n orchestratore ✅ (2026-04-08) → 4 workflow DevOps creati con pre/post-hook; importare in n8n quando attivo
  [6] Agenti verticali ✅ (2026-04-08) → 5 workflow verticali creati (antiban-review, campaign-analyzer, pre-production-checklist, codebase-audit, lead-pipeline-health); workflow bot LinkedIn da migliorare

BLOCCO E — Migrazione e ambienti (dipende da A, parzialmente parallelo):
  [3] Codex migration ⚠️ → dipende da Codex autenticato (azione utente)
  [2] Prompt e modelli ⚠️ → dipende da [3]; /prompt-improver già fatto, manca selezione automatica modello
  [3-bis] Parità ambienti ✅ → baseline documentata, verifica Codex dipende da [3]

BLOCCO F — Long-term (dipende da tutto):
  [19] Manutenzione periodica ⚠️ → ongoing, dipende da sistema stabile
  [1] Whisper locale ⚠️ → indipendente, può essere fatto in qualsiasi momento
  [21] Autonomia totale ⚠️ → obiettivo finale, dipende da C + D + E
```

### Ordine d'implementazione consigliato per i prossimi sprint

| Priorità | Punto | Blocco | Prerequisiti | Sblocca |
|----------|-------|--------|-------------|---------|
| 1 | **8-bis Hook system** ✅ | C | Nessuno (8 già fatto) | 5, 6, 21 |
| 2 | **5 n8n orchestratore** ✅ | D | 8-bis | 6 |
| 3 | **6 Agenti verticali** ✅ | D | 5 | 21 parziale |
| 4 | **3 Codex migration** | E | Codex login (utente) | 2 |
| 5 | **2 Prompt/modelli** | E | 3 | 21 parziale |
| 6 | **1 Whisper** | — | Nessuno | qualità input |
| 7 | **19 Manutenzione** | F | Sistema stabile | ongoing |
| ∞ | **21 Autonomia** | F | Tutto | — |

### Regola "pulisci prima di estendere"

Prima di aggiungere nuove sezioni a un file operativo (CLAUDE.md, AGENTS.md, skill):
1. Eseguire `claude-md-management:claude-md-improver` su CLAUDE.md se ha superato le ~300 righe o ci sono sezioni da consolidare
2. Verificare che non esistano già regole simili che vanno aggiornate invece che duplicate
3. Solo dopo: aggiungere il contenuto nuovo

---

## 0. Regole esplicite, non implicite — ✅ Implementato

- Nessun punto importante di questa lista deve restare implicito o affidato al buon senso del momento.
- Ogni punto di questo documento deve essere trasformabile in una regola operativa con almeno questi campi:
  - trigger: quando si applica
  - ambito: su quali file, artefatti, workflow o domini si applica
  - azione: cosa bisogna fare davvero
  - collegamenti: quali file o sistemi diretti e indiretti vanno considerati
  - verifica: come si controlla che la regola sia stata applicata davvero
- Se una regola importante non e' scritta in modo esplicito, va considerata mancante e va aggiunta.
- Se durante il lavoro emerge una nuova regola, eccezione o best practice che serve davvero, va formalizzata nei file canonici e non lasciata solo nella chat.
- Questa regola vale per tutto: codice, documentazione, config, workflow `n8n`, skill, MCP, plugin, migrazioni, cartelle di progetto e controlli finali.
- Ogni punto della lista va sempre letto insieme alle regole di impatto diretto e indiretto, di controllo multi-dominio e di verifica finale.

## 1. Strumenti personali e infrastruttura locale — ⚠️ Parziale

- **Whisper Dictation creato** (2026-04-04): `C:\Users\albie\tools\whisper-dictation\` — hotkey F9 start/stop, testo in clipboard, notifica Windows. Manca test con API key reale. Quando testato e funzionante → aggiornare status a ✅.
- Creare un programma locale di dettatura basato su Whisper via API OpenAI per sostituire `Win+H`, con maggiore precisione e controllo del testo.
- Analizzare e risolvere i problemi attuali del computer per eliminare colli di bottiglia tecnici.
- Tenere una procedura sicura per scollegare il PC e l'alimentatore: spegnimento OS, interruttore su `O`, rimozione della spina prendendo la testa e non il cavo.

## 2. Prompt, modelli e ambiente migliore — ⚠️ Parziale

- Creare una funzione, skill o mini-software che trasformi prompt scritti male in prompt chiari, completi e ben strutturati.
- Far scegliere all'AI il modello piu' adatto per ogni task.
- Far scegliere anche l'ambiente migliore: `Codex`, `Claude Code` o `Codex` dentro `Claude Code`.
- Far spiegare brevemente il perche' della scelta: qualita', velocita', costo, tool disponibili, rischio di errore e disponibilita' di contesto.
- Migliorare anche i prompt del sito e la scelta del modello migliore per ogni workflow o caso d'uso.

## 3. Migrazione operativa su Codex — ⚠️ Parziale

- Spostare progressivamente scrittura, analisi e gestione della codebase su `Codex`.
- Usare altri strumenti solo quando hanno un vantaggio reale.
- Centralizzare su `Codex` il flusso tecnico principale.

## 3-bis. Parita' operativa tra IDE, terminali e CLI — ✅ Implementato

- Fare in modo che ogni ambiente usato per lavorare sul progetto sia configurato correttamente e in modo coerente: `Codex`, `Claude Code`, `Cursor`, `Windsurf`, `Trae`, terminali locali e altri IDE/CLI simili.
- L'obiettivo non e' solo "farli partire", ma farli comportare nel modo giusto e con le stesse regole operative di base.
- Skill, hook, MCP, memorie, file canonici, slash commands o workflow equivalenti devono essere allineati il piu' possibile tra gli ambienti, cosi' da ridurre differenze di comportamento e dimenticanze.
- Per ogni ambiente bisogna definire in modo esplicito almeno:
  - quali file di regole o memoria legge
  - quali tool e MCP supporta davvero
  - quali hook o meccanismi equivalenti supporta
  - quali skill, comandi o workflow riusabili sono disponibili
  - quali limiti o differenze ha rispetto agli altri ambienti
- Se un ambiente non supporta nativamente una capability importante, bisogna progettare un sostituto: wrapper, workflow, checklist, slash command, skill o automazione equivalente.
- Va fatto un audit periodico di drift tra ambienti: se un hook, una skill, un MCP o una regola funziona bene in un ambiente ma manca negli altri, questo gap deve essere reso esplicito e corretto dove possibile.
- Nessun ambiente deve restare in stato "semi-configurato": o viene portato a baseline corretta, oppure va classificato come ambiente secondario con limiti espliciti.
- La baseline corretta deve includere almeno: regole caricate, contesto leggibile, hook o enforcement equivalenti, skill/command set minimo, MCP necessari, permessi/config coerenti e verifiche finali applicabili.

## 4. Passaggio contesto tra chat — ✅ Implementato

- Creare una skill o funzione che trasferisca in una nuova sessione obiettivi, stato, decisioni, file toccati, problemi aperti e prossimi passi.
- Evitare che ogni nuova chat riparta da zero o perda contesto utile.

## 4-bis. File di memoria e contesto leggibili dall'AI — ✅ Implementato

- Migliorare tutti i file che servono da contesto all'AI, cosi' che possano essere letti correttamente senza perdere informazioni importanti tra sessioni.
- Questo vale almeno per: file di memoria utente, regole operative, backlog attivo, tracking tecnico, handoff di sessione, indici documentali e altri file di contesto persistente.
- Ogni file di contesto deve avere una responsabilita' chiara e unica: preferenze utente, decisioni, stato lavori, tracking, regole, backlog o handoff non devono essere mescolati senza controllo.
- Le informazioni importanti non devono restare solo in chat: se servono anche alla prossima sessione, vanno promosse nel file canonico giusto.
- I file di contesto devono essere scritti in una forma leggibile bene dall'AI: sezioni stabili, heading chiari, bullet ordinate, fatti espliciti, niente dump confusi o paragrafi ambigui che mescolano piu' temi.
- L'obiettivo non e' solo che il file "esista", ma che l'AI riesca davvero a leggerlo in modo completo e affidabile prima, durante e dopo la sessione.
- Prima della lettura, ogni file deve orientare subito l'AI con apertura chiara: scopo del file, ambito, cosa aspettarsi e dove guardare se il tema e' altrove.
- Durante la lettura, il file deve ridurre il rischio di perdita di contesto: una sola responsabilita', ordine stabile, sezioni piccole, niente muri di testo e niente mescolanza di decisioni, backlog, preferenze e note temporanee nello stesso blocco.
- Dopo la lettura, il file deve lasciare uno stato recuperabile: riepilogo chiaro di stato, decisioni, prossimi passi, blocchi e rimandi ai file canonici collegati.
- Ogni file di contesto deve dire in modo chiaro almeno:
  - cosa contiene
  - cosa non contiene
  - quando va aggiornato
  - qual e' la sua fonte canonica o il suo legame con altri file canonici
- Per ogni stato di lavoro importante bisogna rendere espliciti almeno: stato attuale, decisioni prese, motivazione non ovvia, prossimi passi, blocchi aperti e file/sistemi toccati.
- Se un file di contesto cresce troppo o mescola troppi temi, va splittato e indicizzato invece di continuare ad accumulare rumore.
- Non bisogna affidarsi a mega-file lunghi con tutto dentro. Se il contesto supera una dimensione ragionevole o contiene piu' temi, la soluzione corretta e' `indice + file tematici`, non un dump unico.
- I file di contesto devono essere facili da chunkare e recuperare anche con strumenti di retrieval o file search: sezioni ben delimitate, titoli descrittivi, metadati utili, encoding testuale standard e assenza di formati opachi quando non servono.
- Quando una base di conoscenza diventa grande, non bisogna pretendere che l'AI legga sempre tutto raw da cima a fondo: bisogna prevedere anche ricerca mirata, retrieval, chunking e filtri sul file giusto.
- Le regole di memoria e contesto devono essere pensate anche per evitare omissioni di lettura: nessuna informazione critica deve stare solo a meta' file senza indice, riepilogo o aggancio da altri canonici.
- La progettazione di questi file deve collegarsi alle altre regole: contesto diretto e indiretto, livelli di controllo, best practice specifiche e loop finale di completezza.
- Va progettato anche un ordine di lettura affidabile dei file di contesto, cosi' che l'AI sappia quali file leggere prima, quali dopo e dove cercare ogni tipo di informazione senza duplicazioni.

## 4-ter. Meccanismi anti-dimenticanza per modelli e agenti — ✅ Implementato

- Non bisogna affidarsi solo alla buona volonta' del modello o alla presenza di un file di regole. Servono meccanismi che riducano davvero le dimenticanze.
- L'obiettivo e' che modelli diversi come `ChatGPT`, `Claude/Sonnet`, `Codex` o altri leggano il contesto giusto, seguano i passaggi obbligatori e saltino meno verifiche.
- I meccanismi da costruire devono essere espliciti e combinati:
  - memoria persistente separata per tipo di informazione: regole/procedure, fatti stabili, decisioni, backlog, stato sessione
  - retrieval o file search sui file giusti quando il contesto e' troppo grande per una lettura raw affidabile
  - checklists obbligatorie e output strutturati per i passaggi che il modello tende a dimenticare
  - `pre-hook` e `post-hook` per forzare controlli prima e dopo attivazioni importanti
  - slash commands, skill o prompt riusabili per workflow ricorrenti
  - subagenti o agenti specializzati quando serve separare il contesto e ridurre rumore
  - eval e trace review per misurare se il sistema segue davvero le regole e dove fallisce
- Per i workflow ad alto rischio, non basta una risposta libera: il modello deve produrre campi obbligatori o una checklist completata, cosi' che omissioni e salti siano visibili.
- Le regole piu' importanti non devono vivere solo in un file lungo di testo, ma anche in punti di enforcement operativi: hook, workflow, comandi riusabili, validazioni e output schema-driven.
- Quando un passaggio viene dimenticato piu' di una volta, non va solo "ricordato meglio": va trasformato in meccanismo, controllo o automazione esplicita.
- La memoria va anche separata per natura dell'informazione:
  - procedurale: regole, workflow, checklist, passaggi obbligatori
  - semantica: fatti stabili su utente, progetto, sistemi e preferenze
  - episodica: stato corrente, decisioni recenti, handoff e blocchi della sessione
- Mescolare queste tre categorie nello stesso posto aumenta il rischio che il modello recuperi il contesto sbagliato o perda quello giusto.
- Per `Claude Code`, valutare in modo esplicito l'uso combinato di:
  - `CLAUDE.md` con import modulari invece di un solo file enorme
  - `/memory` per gestione e manutenzione delle memorie
  - custom slash commands per i workflow ricorrenti
  - hooks per enforcement pre/post tool
  - subagents per task specializzati con contesto separato
- Per i workflow basati su modelli OpenAI o altri agenti custom, valutare in modo esplicito l'uso combinato di:
  - structured outputs o schemi JSON per i passaggi obbligatori
  - tool/function calling con parametri stretti
  - eval regolari sui flussi importanti
  - retrieval strutturato invece di contesto grezzo sempre piu' lungo
- La regola finale e' questa: se un comportamento critico deve avvenire sempre, non deve dipendere solo dalla memoria del modello.

## 5. n8n come orchestratore tecnico — ✅ Implementato (2026-04-08)

- Usare n8n anche come strumento DevOps su attivita' della codebase.
- 4 workflow riusabili creati in n8n-workflows/, pronti per import.
- Trigger collegati a giorni lavorativi e orari reali.
- Pre-hook e post-hook integrati in ogni workflow.

### Workflow creati al 2026-04-08

| File | Trigger | Funzione |
|------|---------|---------|
| quality-gate-check.json | Webhook POST o manuale | Typecheck via bot API, notifica Telegram pass/fail |
| gdpr-retention-cleanup.json | Cron lunedi 9:00 | Dry-run GDPR, attende conferma webhook, esegue cleanup reale |
| bot-health-check.json | Cron 9/13/17 lun-ven | Health API + Snapshot, alert Telegram se down |
| weekly-lead-report-v2.json | Cron venerdi 17:00 | Report inviti/messaggi/reply/risk via Telegram |

**Architettura comune:**
- Pre-hook obbligatorio: valida env vars, filtra weekend, errore se contesto incompleto
- Post-hook obbligatorio: log strutturato timestamp + durata in console n8n
- Variabili env richieste: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, DASHBOARD_API_KEY
- URL bot interno: http://bot-api:3000 (Docker) o http://localhost:3000 (PM2)

**Da fare per attivare:**
1. Avviare n8n (docker-compose up o pm2 start n8n)
2. Importare i 4 JSON in n8n UI (Settings → Import Workflow)
3. Configurare env vars nel container n8n: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, DASHBOARD_API_KEY
4. Attivare i workflow
5. Test quality-gate: POST http://localhost:5678/webhook/quality-gate

## 6. Agenti verticali e workflow riusabili — ✅ Implementato (2026-04-08)

- Creati 5 agenti verticali specializzati come workflow n8n in `n8n-workflows/`, pronti per import.
- Stessa architettura pre-hook/post-hook dei workflow DevOps (punto 5).

### Workflow creati al 2026-04-08

| File | Trigger | Funzione |
|------|---------|----------|
| linkedin-antiban-review.json | Webhook POST o manuale | Riceve lista file modificati, rileva file sensibili, genera checklist anti-ban con 5 domande obbligatorie, notifica Telegram SAFE/REVIEW |
| linkedin-campaign-analyzer.json | Cron lunedi 8:00 o manuale | Query DB metriche campagna 30gg, calcola acceptance/reply/pending rate, alert se pending > 30% o acceptance < 20% |
| pre-production-checklist.json | Webhook POST o manuale | Verifica Health API, Snapshot API, pending ratio, risk action, DB connection; verdetto READY/NOT READY via Telegram |
| codebase-audit.json | Cron domenica 10:00 o manuale | Verifica TypeScript health, report con raccomandazioni per circular deps/TODO/file grandi; notifica Telegram |
| lead-pipeline-health.json | Cron lun-ven 8:00 | Snapshot giornaliero pipeline: alert se pending > 50 o bot inattivo 2gg; silenzioso se tutto ok |

**Credenziali n8n da configurare:**
- , ,  (tutti i workflow)
-  (solo linkedin-campaign-analyzer, nodo Postgres)

**Da fare per attivare:**
1. Importare i 5 JSON in n8n UI (Settings → Import Workflow)
2. Configurare env vars nel container n8n
3. Per linkedin-campaign-analyzer: creare credenziale Postgres in n8n e aggiornare il credential ID nel nodo

## 7. Selezione automatica di skill, agenti, workflow e web search — ✅ Implementato

- Quando arriva una richiesta, l'AI deve fare una classificazione esplicita interna del task prima di agire.
- La classificazione deve dire almeno:
  - che tipo di lavoro e' (`risposta`, `analisi`, `modifica docs`, `modifica codice`, `workflow`, `cleanup`, `review`)
  - quali skill servono
  - quale agente o workflow `n8n` serve
  - se serve ricerca web
  - quale modello o ambiente conviene usare
- Se uno di questi pezzi non viene deciso in modo esplicito, la selezione va considerata incompleta.
- La selezione deve essere automatica e orientata a minimizzare errori, omissioni e attivazioni inutili.

## 8. Audit, qualita' e installazione delle skill — ✅ Implementato

- Fare un audit delle skill presenti per capire quali sono utili, duplicate, deboli o obsolete.
- Scegliere sempre la skill piu' adatta e piu' forte per il compito.
- Evitare duplicati funzionali salvo vantaggio concreto.
- Installare nuove skill solo se coprono un gap reale o migliorano nettamente un flusso debole.
- Mantenere una mappa chiara di cosa fa ogni skill e quando va usata.
- Per ogni skill la mappa deve dire in modo esplicito:
  - trigger di attivazione
  - casi in cui non va attivata
  - dipendenze o tool richiesti
  - output atteso
  - hook o verifiche collegate

## 8-bis. Pre-hook e post-hook per skill, MCP, regole e workflow — ✅ Implementato (2026-04-04)

- Progettare un sistema di `pre-hook` e `post-hook` per attivare in modo coerente skill, regole, MCP, workflow e controlli.
- Ogni skill deve dichiarare almeno:
  - cosa controllare prima dell'attivazione
  - quali dipendenze o tool richiede
  - quali verifiche eseguire a fine esecuzione
- Ogni MCP deve avere hook espliciti per:
  - condizioni di attivazione
  - validazione del contesto minimo
  - cleanup o verifica post-uso se necessario
- Anche le regole operative devono poter attivare hook: ad esempio anti-ban, review di sicurezza, web search obbligatoria, quality gates e loop finale.
- Anche i workflow `n8n` devono prevedere hook in ingresso e in uscita, cosi' da non partire con contesto incompleto e da lasciare stato e verifiche finali coerenti.
- Fare un audit completo di tutte le skill, di tutti gli MCP, delle regole e dei workflow esistenti per definire hook mancanti, hook ridondanti e priorita' di implementazione.
- L'obiettivo non e' solo "attivare piu' cose", ma attivarle nel momento corretto e nell'ordine corretto per ridurre gli errori.

### Implementato al 2026-04-04

- **settings.json `PreToolUse`**: hook bloccante (exit 2) su Edit/Write per file con pattern sensibili LinkedIn (browser, stealth, timing, ecc.) → richiede `/antiban-review` prima di procedere. Log in `memory/antiban-hook-log.txt`.
- **settings.json `PostToolUse`**: hook asincrono su Bash con comandi di qualita' (`npm run`, `npx tsc`, `npx madge`, `vitest`) → log in `memory/quality-hook-log.txt`.
- **settings.json `Stop`**: arricchito con working dir nel log → `memory/session-log.txt`.
- **Skill `antiban-review`**: aggiunta sezione `Pre-conditions` (trigger obbligatori) e `Post-conditions` (azione per ogni verdetto).
- **Skill `loop-codex`**: aggiunta sezione `Pre-conditions` (L1 pulito, task misurabile, scope) e `Post-conditions` (auto-commit, worklog).
- **Skill `context-handoff`**: aggiunta sezione `Pre-conditions` (git status, memoria aggiornata, active.md) e `Post-conditions` (SESSION_HANDOFF.md committato).
- **AGENTS.md "Hook orchestration"**: aggiunta mappa tabellare degli hook attivi, pattern file sensibili, pre/post-conditions skill, hook n8n documentati come prossimi.
- **Mancante (non ancora attivo)**: hook n8n in ingresso/uscita (validazione contesto, log Telegram, aggiornamento `automation_commands`).

## 9. Best practice obbligatorie da ingegnere software — ✅ Implementato

- Ogni modifica deve seguire best practice da ingegnere software professionale.
- Le best practice non vanno applicate in modo generico: per ogni tipo di artefatto bisogna usare la best practice specifica di quel tipo.
- Esempi: codice TypeScript, documento tecnico, guida operativa, file di configurazione, workflow `n8n`, schema API, migrazione DB, file di tracking e cartella di progetto non vanno trattati tutti allo stesso modo.
- Se il task tocca un tipo di artefatto per cui esistono pratiche aggiornabili o convenzioni recenti, l'AI deve cercare anche sul web le best practice di quello specifico artefatto prima di modificare.
- Questa verifica delle best practice specifiche deve collegarsi alle altre regole: file toccati direttamente, file impattati indirettamente, dipendenze, intrecci tra moduli e livelli di controllo.
- L'AI deve leggere le regole giuste, collegarle tra loro, scegliere tool e agire in autonomia.
- Non bisogna lavorare sul singolo file in isolamento, ma sul contesto reale della modifica.
- L'ordine delle modifiche deve essere deciso prima, per non rompere import, tipi, runtime o integrazioni.
- Nessuna modifica e' completa se risolve solo una parte del problema lasciando incoerenze nel sistema.
- Ogni modifica deve essere valutata anche per la sua tenuta nel tempo: non deve rompere altre aree oggi, non deve lasciare debito nascosto domani e non deve lasciare parti del sistema indietro rispetto al nuovo stato.

## 10. Ragionamento umano, non esecuzione cieca — ✅ Implementato

- L'AI deve capire l'intento reale dell'utente e non limitarsi al testo letterale.
- Deve leggere tra le righe, anticipare problemi, prevedere dipendenze e completare il quadro tecnico.
- Deve coprire anche gli aspetti tecnici che l'utente non conosce o non puo' verificare da solo.
- Questo comportamento non deve restare implicito: quando il task e' ambiguo, l'AI deve esplicitare internamente quale problema reale sta risolvendo e quali aspetti aggiuntivi sta coprendo.

## 11. Contesto corretto su file diretti e indiretti — ✅ Implementato

- Ogni modifica riguarda sia i file toccati direttamente sia quelli coinvolti indirettamente.
- L'AI deve considerare dipendenze, import, contratti, integrazioni, moduli dipendenti ed effetti runtime.
- Non deve mai lavorare in modo parziale o isolato.
- Questa regola va applicata in modo esplicito per ogni task: bisogna poter dire quali sono i file diretti, quali gli indiretti e perche' rientrano nel perimetro.

## 12. Ricerca web e attivazione tool nel momento giusto — ✅ Implementato

- Se il task riguarda framework, API, librerie o best practice aggiornabili, l'AI deve cercare sul web prima di implementare.
- Se il task riguarda un artefatto non-code, l'AI deve comunque cercare la best practice aggiornata del suo dominio quando c'e' rischio di usare una struttura debole o superata.
- Anche per documenti, guide, config, workflow, MCP, plugin e file di supporto, la ricerca non deve limitarsi al singolo file ma includere il suo ruolo nel sistema e i collegamenti con gli altri file.
- Skill, workflow e tool vanno attivati quando servono davvero, non troppo tardi e non in modo casuale.

## 13. Protocollo di controllo multi-livello — ✅ Implementato

Applicare sempre un protocollo strutturato che copra:

1. classificazione dei domini coinvolti
2. analisi impatti diretti e indiretti
3. ordine di esecuzione
4. implementazione con best practice specifiche del tipo di artefatto
5. controllo tecnico immediato
6. verifica trasversale tra domini
7. validazione finale per dominio
8. controllo conclusivo anti-errori

## 14. Controllo multi-dominio per ogni file — ✅ Implementato

- Per ogni file modificato, controllare non solo il motivo principale del cambiamento ma anche gli altri aspetti che il file puo' toccare: sicurezza, performance, tipi, error handling, automazione, integrazioni e architettura.
- Questo controllo deve essere dichiarato per ogni file toccato: non basta dire "controllo completo", bisogna sapere quali domini sono stati valutati davvero.

## 15. Loop finale di completezza — ✅ Implementato

- A fine lavoro, l'AI deve rieseguire un controllo finale completo sui file toccati direttamente e indirettamente.
- Il task non va chiuso se restano buchi logici, incoerenze o passaggi dimenticati.

## 16. Loop custom tipo Claude, se Codex non lo offre — ✅ Implementato

- Se `Codex` non offre nativamente una funzione equivalente a `Claude Code /loop`, creare una skill, un workflow o un automatismo che replichi quel comportamento.
- Questa modalita' deve continuare a lavorare, ricontrollare e avanzare di step finche' il task non e' davvero chiuso.
- Se deve fermarsi per conferma utente, limiti o crediti, deve lasciare stato, blocco e prossimi passi in modo chiarissimo.

## 17. Automatismi intelligenti, non ciechi — ✅ Implementato

- Gli automatismi devono prima analizzare e poi proporre l'azione, non eseguirla subito.
- Esempio: per la pulizia periodica della codebase, l'automatismo deve capire se serve davvero cleanup o refactor e poi chiedere conferma.
- Gli automatismi devono attivarsi solo quando portano valore reale.

## 18. Schema obbligatorio degli automatismi — ✅ Implementato

Ogni automatismo deve seguire questa sequenza:

1. rilevazione del bisogno
2. analisi del contesto
3. proposta chiara all'utente
4. conferma
5. esecuzione
6. report finale

Nessun automatismo strutturale o invasivo deve partire senza conferma esplicita.

## 19. Manutenzione periodica e produzione — ⚠️ Parziale

- Fare pulizia periodica della codebase per rimuovere codice inutile e ridurre complessita'.
- Consolidare tutto cio' che serve per andare in produzione in modo ordinato.
- Rendere workflow e infrastruttura abbastanza chiari da poterli passare anche ad altre persone.

## 19-ter. Politica di manutenzione file per tipo di artefatto — ⚠️ Parziale

> Ogni tipo di file ha la sua policy di manutenzione. Non esiste "pulirò quando è il momento" — il trigger deve essere esplicito.

### Codebase (codice)
- **Trigger cleanup**: sezione mal strutturata da toccare → proporre refactoring locale prima di aggiungere; file >300 righe + nuova feature → valutare split
- **Trigger audit**: dead code, funzioni non usate, barrel files cresciuti → `npx madge --circular` + `/kaizen` o `/legacy-modernizer`
- **Chi decide**: AI propone, utente approva prima di eseguire

### File di regole (CLAUDE.md, AGENTS.md)
- **Trigger cleanup**: file supera ~300 righe, o si sta per aggiungere una nuova sezione → eseguire PRIMA `claude-md-management:claude-md-improver`
- **Trigger audit**: regola dimenticata >1 volta, skill nuova installata, nuovo progetto → vedere tabella "Audit skill" in CLAUDE.md
- **Regola fondamentale**: pulire prima di estendere — mai aggiungere contenuto a un file disorganizzato
- **Chi decide**: AI esegue audit autonomamente prima di ogni modifica rilevante a questi file

### File di memoria (~/memory/, .claude/memory/)
- **Trigger cleanup**: memoria contraddice stato attuale, memoria > 6 mesi non toccata, info ora nel codice/docs → eliminare o aggiornare
- **Trigger aggiornamento**: fine sessione significativa, decisione architetturale presa, priorità cambiate
- **Regola**: una memoria sbagliata è peggio di nessuna memoria
- **Chi decide**: AI propone update a fine sessione, esegue se urgente

### Documenti tecnici (AI_OPERATING_MODEL.md, README, ENGINEERING_WORKLOG, docs/)
- **Trigger aggiornamento AI_OPERATING_MODEL.md**: punto implementato → aggiornare status marker; nuovo obiettivo emerso → aggiungere sezione
- **Trigger archivio**: sezione completamente implementata e stabile → aggiungere nota "ARCHIVIATO [data]" e link al file canonico
- **Trigger aggiornamento README**: struttura progetto cambiata, nuovo servizio aggiunto, setup cambiato
- **ENGINEERING_WORKLOG**: aggiornare a ogni blocco tecnico significativo (non ogni singolo commit)
- **Chi decide**: AI aggiorna autonomamente tracking; per README/AI_OPERATING_MODEL chiede solo se cambio strutturale

### Skill (~/.claude/skills/)
- **Trigger cleanup**: skill mai usata in 30gg, skill sovrapponibile a un'altra → candidare a rimozione o merge
- **Trigger aggiornamento**: comportamento skill non corrisponde più alla realtà del progetto
- **Trigger nuova skill**: gap non coperto da nessuna esistente → `/skill-creator`
- **Chi decide**: AI propone, utente approva

### n8n workflow
- **Trigger cleanup**: workflow non eseguito in 14gg, workflow con errori ripetuti → analisi e fix o archivio
- **Trigger review**: modifica al bot che tocca area del workflow → verificare che workflow sia ancora coerente
- **Chi decide**: AI verifica, propone fix, esegue con `n8n-builder` agent

---

## 19-bis. Checklist 360 gradi per nuovi progetti — ✅ Implementato

- Creare e mantenere una checklist riusabile da usare quando nasce un progetto nuovo o quando un progetto esistente va riallineato a una baseline migliore.
- La checklist deve essere abbastanza chiara da poter essere usata sia dall'utente sia da altre persone a cui il progetto viene passato.
- Deve coprire a 360 gradi almeno: struttura codice, regole operative, documentazione canonica, memoria AI, quality gates, ambienti/CLI/IDE, skill, hook, MCP, workflow, sicurezza, osservabilita', test, produzione, handoff e prevenzione del debito tecnico.
- Non deve essere una lista generica vuota: deve essere abbastanza concreta da dire cosa controllare prima che il progetto cresca e cosa sistemare per evitare problemi futuri.
- Deve includere anche controlli preventivi che migliorano il codice e il progetto nel lungo termine: separazione moduli, confini architetturali, validazione config, error handling, logging, rollback, policy dipendenze, audit periodici e readiness per passaggio ad altri.
- La checklist deve poter funzionare anche come template cross-project, non solo per questo repository.

## 20-bis. Policy di sicurezza, anti-ban e conformità legale — ⚠️ Parziale

> Questa sezione copre i vincoli **esterni** al progetto: piattaforme (LinkedIn ToS), legge (GDPR) e rischi operativi. Ogni modifica al bot deve essere valutata anche rispetto a questi vincoli, non solo rispetto alla qualità tecnica.

### Anti-ban / anti-detect LinkedIn

- **Regola zero**: prima di ogni modifica che tocca browser, timing, stealth, volumi o sessione → review anti-ban obbligatoria (skill `antiban-review` se disponibile)
- **Domande obbligatorie** (vedi AGENTS.md "Priorità assoluta: anti-ban"):
  1. Cambia comportamento browser su LinkedIn?
  2. Cambia timing, delay o ordine azioni?
  3. Tocca fingerprint, stealth, cookie, sessione?
  4. Aggiunge azioni LinkedIn (click, navigazione, typing)?
  5. Cambia volumi, budget, cap, limiti?
- **Principi non negoziabili**: varianza su tutto, sessioni credibili, pending ratio controllato, fingerprint coerente, navigazione umana
- **Status**: regole in AGENTS.md ✅; monitoring con alert Telegram ⚠️ (parziale); eval automatico comportamento ❌

### GDPR e trattamento dati personali

- I dati raccolti su lead LinkedIn (nome, azienda, profilo, messaggi) sono **dati personali** ai sensi del GDPR (Reg. UE 2016/679)
- **Obblighi minimi**:
  - Base giuridica esplicita per il trattamento (interesse legittimo B2B o consenso)
  - Periodo di conservazione definito — i dati non vanno tenuti a tempo indeterminato
  - Nessun trasferimento a terzi senza garanzie adeguate
  - Risposta a richieste di cancellazione (diritto all'oblio)
- **Implementato** (2026-04-04):
  - Policy di retention: `src/db/migrations/059_gdpr_retention.sql` — colonne `last_activity_at`, `anonymized_at`, `retention_expires_at`
  - Script retention manuale: `src/scripts/gdprRetentionCleanup.ts` — 180gg anonimizza, 365gg cancella; flag `--dry-run`
  - Audit trail: tabella `audit_log`; `writeAuditEntry` nei worker `messageWorker` e `inviteWorker`
  - Documentazione: `docs/GDPR_POLICY.md`
- **Da implementare ancora**:
  - Scheduling automatico retention cleanup
  - Registro trattamenti ex art. 30 (se scala supera uso personale)
  - Pseudonimizzazione prompt Anthropic API
- **Status**: policy di retention ✅; log messaggi nel DB ✅; audit trail ✅; doc GDPR ✅

### LinkedIn Terms of Service

- L'uso automatizzato di LinkedIn viola i ToS ufficiali — il progetto opera in zona grigia
- **Mitigazioni obbligatorie**: volumi bassi, comportamento umano credibile, no scraping aggressivo, no spam di massa
- **Aggiornamenti ToS**: LinkedIn cambia frequentemente le regole di rilevamento — fare web search periodica su "LinkedIn automation detection [anno]" prima di ogni modifica rilevante al bot
- **Status**: principi in AGENTS.md ✅; web search periodica non schedulata ❌

### Sicurezza dei dati nel sistema

- API keys, token, credenziali: solo in `.env`, mai in codice o log
- DB PostgreSQL: accesso solo da rete interna (docker network), porta 5432 non esposta pubblicamente
- n8n: autenticazione basic auth obbligatoria (già configurata in docker-compose)
- Dashboard: porta 3000 su `127.0.0.1` solo (non pubblica)
- **Status**: architettura sicura ✅; audit periodico credenziali ❌

---

## 20. Verifica continua di regole, skill e workflow — ✅ Implementato

- Controllare periodicamente se le regole si attivano davvero nel momento giusto.
- Verificare se le skill scelte sono le migliori, se ci sono duplicati e se i workflow `n8n` funzionano bene.
- Le regole non devono restare teoriche: devono produrre comportamento reale.
- Se una regola risulta ancora solo implicita, va riscritta in forma esplicita e operativa.

## 21. Autonomia operativa totale — ⚠️ In progress

- L'obiettivo finale e' che l'AI si attivi sempre da sola, ricordi tutte queste regole, scelga in autonomia strumenti, skill, workflow, agenti, ricerca web e ordine di esecuzione.
- Il lavoro deve arrivare a chiusura reale, senza costringere l'utente a fare da project manager tecnico.
- L'autonomia non significa improvvisazione: significa applicare regole esplicite, complete e verificabili senza doverle re-spiegare ogni volta.
