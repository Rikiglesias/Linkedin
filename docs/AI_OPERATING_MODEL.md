# AI Operating Model

> **Questo documento è aspirazionale ma tracciato.**
> Ogni sezione ha uno status: ✅ Implementato | ⚠️ Parziale | ❌ Non ancora fatto.
> Le implementazioni concrete stanno in: `~/.claude/CLAUDE.md` (regole globali), `AGENTS.md` (progetto), `~/.claude/skills/` (skill), `~/memory/` (memoria).

**Obiettivo centrale**: un sistema AI che si attiva da sola, ragiona in autonomia, non dimentica nessuna regola e non dichiara mai "fatto" senza aver verificato davvero tutto — senza che l'utente debba guidarla ogni volta.

---

## Stato rapido

| # | Punto | Status |
|---|-------|--------|
| 1 | Ragionamento e contesto completo | ✅ |
| 2 | Loop automatico e verifica sistematica | ✅ |
| 3 | Selezione autonoma degli strumenti | ✅ |
| 4 | Regole che non si dimenticano | ⚠️ |
| 5 | Contesto e memoria tra sessioni | ✅ |
| 6 | Sistema hook pre/post | ✅ |
| 7 | n8n e agenti verticali | ⚠️ |
| 8 | Parità ambienti | ✅ |
| 9 | Strumenti personali e ambienti | ✅ |
| 10 | Manutenzione e produzione | ✅ |
| 11 | Sicurezza e compliance | ⚠️ → ✅ parziale (2026-04-09) |
| 12 | Autonomia totale | ⚠️ |

---

## 1. Ragionamento e contesto completo — ✅ Implementato

**Concetto**: l'AI non esegue il testo letterale. Capisce il problema reale, lavora sempre sul contesto completo e non lavora mai su un file in isolamento.

- L'AI capisce l'intento reale dell'utente, non solo le parole. Se la richiesta è ambigua, dettata a voce o incompleta, interpreta semanticamente e dichiara internamente quale problema reale sta risolvendo.
- Ogni modifica riguarda sia i file toccati direttamente sia quelli coinvolti indirettamente: dipendenze, import, contratti, integrazioni, moduli dipendenti, effetti runtime. L'AI mappa questo perimetro prima di scrivere codice.
- Per ogni file modificato, l'AI controlla automaticamente tutti i domini che quel file può toccare — non solo il motivo principale del cambiamento. I domini sono: sicurezza, performance, tipi, error handling, automazione, integrazioni, architettura, osservabilità. Questo controllo viene dichiarato esplicitamente per ogni file.
- Le best practice seguite non sono generiche: dipendono dal tipo di artefatto. Codice TypeScript, documento tecnico, config, workflow n8n, schema API, migrazione DB, file di tracking — ognuno ha le sue regole specifiche. L'AI le applica senza che l'utente le debba specificare.
- L'ordine delle modifiche viene deciso prima di iniziare, così da non rompere import, tipi, runtime o integrazioni. Nessuna modifica è completa se risolve solo una parte lasciando incoerenze nel resto del sistema.
- **Spec-driven development** (best practice 2026): spec e design diventano un contratto tra utente e AI. File come `AI_OPERATING_MODEL.md`, `AGENTS.md`, `CLAUDE.md` fungono da spec a cui l'AI fa riferimento continuamente — non li legge una volta sola. Se la spec manca o è ambigua, l'AI rileva l'insufficienza del contesto prima di procedere, non dopo.
- **Context engineering** come disciplina: rendere espliciti intent, convenzioni e decisioni architetturali del progetto come artefatti di prima classe — non commenti sparsi. Il contesto strutturato riduce la deriva dell'AI nelle sessioni lunghe.

**Implementato in**: P0 Step A, L0 blast radius, L7, L8 in `~/.claude/CLAUDE.md`.

---

## 2. Loop automatico e verifica sistematica — ✅ Implementato

**Concetto**: l'AI non dichiara mai "fatto" senza verifica sistematica. Il loop parte automaticamente ad ogni task. L1-L9 e la ricerca web non sono opzioni — sono il modo normale di lavorare.

- **Loop automatico**: ogni task parte con loop — l'AI non si ferma dopo il primo risultato ma continua a verificare fino a chiusura reale. Non è l'utente a dire "usa il loop": parte sempre.
- **Ricerca web obbligatoria prima di implementare**: se il task riguarda framework, API, librerie, best practice aggiornabili, o qualsiasi artefatto il cui dominio può essere cambiato, l'AI cerca su internet prima di scrivere codice. Vale per codice e per artefatti non-code (config, workflow, regole, documenti). Non è opzionale.
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
- **Shift-right validation** (best practice 2026): la verifica non finisce al deploy. I difetti rilevati in produzione vengono alimentati nei pipeline automatici come input per il ciclo successivo. L9 è la porta d'uscita della sessione, ma il vero loop di qualità è continuo: dev → deploy → produzione → feedback → dev.
- **Quality gates per codice AI** (best practice 2026): i gate devono includere soglie di complessità ciclomatica e scan OWASP, non solo build+lint. Configurare questi check come bloccanti nei hook PostToolUse.

**Implementato in**: P0 Step B, L1-L9 in `~/.claude/CLAUDE.md`; `/loop-codex` skill per Codex.

---

## 3. Selezione autonoma degli strumenti — ✅ Implementato

**Concetto**: l'AI classifica ogni task prima di agire e sceglie da sola tutti gli strumenti necessari — senza che l'utente debba dire "usa la skill X" o "attiva l'MCP Y".

- Prima di ogni azione, l'AI classifica internamente il task: tipo di lavoro, skill necessarie, agente o workflow n8n da attivare, se serve ricerca web, quale modello o ambiente è più adatto. Se uno di questi pezzi non viene deciso, la selezione è incompleta.
- La skill più adatta viene scelta dalla mappa in CLAUDE.md — non per abitudine ma per corrispondenza al dominio del task. Se esiste una skill più forte per quel dominio, viene usata quella.
- MCP (Supabase, Playwright, Semgrep, n8n, Gmail, Calendar) vengono attivati quando portano valore reale, nel momento giusto, non in modo casuale o tardivo.
- L'AI raccomanda il modello e l'ambiente migliori per il task (qualità, velocità, costo, tool disponibili, contesto, rischio di errore) e spiega brevemente perché — la decisione finale spetta all'utente prima di aprire la sessione.
- Audit continuo delle skill: quelle non usate da 30 giorni, duplicate o deboli vengono candidate a rimozione o merge. Nuove skill solo se coprono un gap reale. Mappa con trigger, casi in cui NON usarle, dipendenze, output atteso, hook collegati.
- **Tool Search on-demand** (best practice 2026): caricare le definizioni degli strumenti solo quando servono al task corrente (non tutto upfront). Anthropic ha misurato +25% di accuracy (da 49% a 74% su Opus 4) con tool libraries grandi usando questo pattern. Implicazione: la mappa skill in CLAUDE.md deve essere ordinata per frequenza d'uso, non alfabeticamente.
- **Architettura strumenti** (best practice 2026): Skills = layer di conoscenza procedurale (30-50 token l'una, caricate on-demand). MCP = sistema nervoso per integrazioni esterne (50k+ token). Hooks = garanzia di esecuzione. Aggiungere nell'ordine giusto: prima MCP per integrazione primaria, poi Skills per procedure ripetute, poi Hooks per enforcement.

**Implementato in**: P0 Step B, tabella skill in `~/.claude/CLAUDE.md`.

---

## 4. Regole che non si dimenticano — ⚠️ Parziale

**Concetto**: le regole scritte in un file di testo vengono dimenticate. Le regole critiche devono diventare hook — enforcement duro che non dipende dalla memoria dell'AI. Il file delle regole deve restare corto perché più è lungo, più regole vengono dimenticate.

- Ogni regola deve avere: trigger (quando si applica), ambito (su cosa), azione (cosa fare), collegamenti (file/sistemi diretti e indiretti), verifica (come controllare che sia stata applicata). Se manca uno di questi, la regola è incompleta.
- **Hook-first per le regole critiche**: se una regola è abbastanza importante da non poter essere dimenticata, deve diventare un hook in `settings.json` — non può restare solo testo in CLAUDE.md. Testo = può essere dimenticato. Hook = viene sempre eseguito.
- **File regole corto = AI ricorda tutto**: CLAUDE.md deve restare abbastanza compatto da poter essere letto e tenuto in contesto affidabilmente in una sessione. Più cresce, più regole vengono dimenticate. Prima di aggiungere → eseguire `claude-md-management:claude-md-improver` per pulire. Mai aggiungere a un file disorganizzato.
- **Audit periodico delle regole**: verificare che le regole si attivino davvero nel momento giusto — non solo che siano scritte. Regole che non producono comportamento reale → convertire in hook o rimuovere. Regole dimenticate più di una volta → diventano hook obbligatoriamente.
- Non affidarsi solo alla memoria del modello: usare memoria persistente separata per tipo (procedurale, semantica, episodica), checklist obbligatorie, output strutturati, subagenti specializzati.
- **Dato empirico 2026**: i modelli migliori seguono meno del 30% delle istruzioni perfettamente in scenari agentici quando il numero di istruzioni cresce. Il compliance cala linearmente con il numero di regole. **Implicazione diretta**: CLAUDE.md corto non è una preferenza estetica — è una necessità tecnica per compliance >30%. Ogni regola aggiunta ne fa dimenticare un'altra.
- **Hook con deny permanente** (best practice 2026): un hook che restituisce `permissionDecision: "deny"` blocca l'azione anche in modalità `--dangerously-skip-permissions` e `bypassPermissions`. Le regole critiche devono usare questo pattern — non il semplice exit 2 che può essere aggirato.

**Implementato**: hook antiban ✅, hook qualità ✅, pre/post-conditions skill ✅, `permissionDecision: "deny"` hook antiban ✅, audit conformità hook ✅ (`npm run audit:hooks`), violations-tracker PostToolUse hook ✅ (logga miss antiban in `rule-violations-log.txt`) (2026-04-09), skill `/audit-rules` ✅ (legge log, propone conversioni in hook) (2026-04-09).
**Mancante**: metrica automatica percentuale compliance ❌ (richiede dataset di almeno 2-4 settimane di violations log prima di essere significativa).

---

## 5. Contesto e memoria tra sessioni — ✅ Implementato

**Concetto**: nessuna sessione riparte da zero. Il contesto viene trasferito automaticamente e i file di memoria sono progettati per essere letti bene dall'AI, non solo dall'umano.

- **`/context-handoff`**: skill che trasferisce in una nuova sessione obiettivi, stato, decisioni, file toccati, problemi aperti e prossimi passi. Va usata automaticamente a fine ogni sessione significativa.
- Ogni file di memoria ha una responsabilità unica: preferenze utente, decisioni, stato lavori, tracking, regole, backlog e handoff non vanno mescolati nello stesso file.
- Ogni file di contesto dice: cosa contiene, cosa non contiene, quando va aggiornato, a quale file canonico è collegato. Apertura chiara, sezioni piccole, riepilogo finale di stato/decisioni/prossimi passi/blocchi.
- File troppo grande o con troppi temi → split in indice + file tematici. Mai mega-file con tutto dentro.
- Le informazioni importanti non restano solo in chat: se servono alla prossima sessione, vengono promosse nel file canonico giusto prima di chiudere.
- **Memory consolidation / Auto Dream** (best practice 2026): Anthropic ha aggiunto in Claude Code una capability di consolidamento automatico della memoria tra sessioni (Auto Dream). Le sessioni significative producono un riassunto compresso che viene promosso a memoria di lungo termine. Il sistema `~/memory/` + `MEMORY.md` implementa questo pattern manualmente — da verificare se Auto Dream è attivabile in modo nativo per ridurre il lavoro manuale.
- **Gerarchia memoria** (best practice 2026): User Memory (fatti cross-sessione stabili), Session Memory (contesto a breve termine), Agent Memory (conoscenza specifica dell'agente). Il nostro sistema attuale copre User e Session — Agent Memory (per skill specializzate) non è ancora separato.

**Implementato in**: `~/.claude/skills/context-handoff/`, sistema `~/memory/`, `MEMORY.md`.

---

## 6. Sistema hook pre/post — ✅ Implementato (2026-04-08)

**Concetto**: l'enforcement non dipende dalla memoria dell'AI ma da meccanismi che partono automaticamente prima e dopo ogni azione critica.

- **Pre-hook**: valida contesto, prerequisiti, dipendenze e rischi prima che l'azione avvenga. Se le condizioni non sono soddisfatte, blocca.
- **Post-hook**: verifica esito, esegue cleanup, registra log, lascia il sistema in stato coerente.
- **Implementato in `settings.json`**:
  - `PreToolUse` bloccante (exit 2) su Edit/Write per file LinkedIn sensibili (browser, stealth, timing, playwright, fingerprint, sessione) → forza `/antiban-review` prima di procedere
  - `PostToolUse` asincrono su Bash con comandi qualità (`tsc`, `madge`, `vitest`, `npm run`) → log in `memory/quality-hook-log.txt`
  - `Stop` con log working dir → `memory/session-log.txt`
- **Skill con pre/post-conditions**:
  - `antiban-review`: pre (quando invocarla obbligatoriamente), post (azione per ogni verdetto SAFE/REVIEW/BLOCK)
  - `loop-codex`: pre (L1 pulito, task misurabile, scope definito), post (auto-commit se DONE, worklog)
  - `context-handoff`: pre (git status, memoria aggiornata, active.md), post (SESSION_HANDOFF.md committato)
- **Gap**: hook in ingresso/uscita per workflow n8n (richiedono n8n attivo) ⚠️
- **permissionDecision deny** (best practice 2026): hook antiban convertito da `exit 2` a `permissionDecision: "deny"` + `exit 0` — blocca anche `--dangerously-skip-permissions` ✅.
- **Thread-based enforcement** (best practice 2026): separare la governance policy (quando serve review) dall'enforcement meccanico (hook che blocca). Il file regole dice il "quando", l'hook esegue il "blocca" — senza passare per il ragionamento dell'AI.

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

**Best practice 2026 applicate/da applicare**:
- **Modular design**: usare il nodo Execute Workflow per richiamare sotto-workflow riusabili — no mega-workflow da 50 nodi ✅ (già seguito)
- **Memory nodes obbligatori** (2026: "stateless automation is dead"): ogni workflow che gestisce stato o conversazione deve includere Redis Chat Memory o equivalente — il bot fa già un tracking su DB, ma i workflow n8n mancano di memoria interna ❌
- **API keys mai nel JSON del workflow**: usare variabili d'ambiente n8n o un secrets manager esterno — verificato (2026-04-09): tutti i 22 workflow usano `$env.VAR` o credenziale n8n dedicata, zero hardcoded ✅
- **Human-in-the-loop con Wait Node**: per azioni ad alto rischio (GDPR cleanup, deploy) usare il pattern pause → Telegram approval → resume ⚠️ solo gdpr-retention lo fa già
- **Dedup alert via staticData** (2026-04-09): `linkedin-campaign-analyzer.json` aggiornato con nodo Dedup Alert Check + IF — evita Telegram duplicati se le metriche non cambiano settimana su settimana ✅

**Gap**:
- Workflow bot LinkedIn (inviteWorker, messageWorker, sequenze follow-up) non ancora migliorati ❌
- Guida setup completa per passare il sistema ad altri ✅ `docs/SETUP.md` (2026-04-09)
- Hook n8n in ingresso/uscita non ancora attivi ⚠️ (richiedono n8n online)

---

## 8. Parità ambienti — ✅ Implementato

**Concetto**: ogni ambiente usato per lavorare sul progetto si comporta in modo coerente — stesse regole, stessi file canonici, stessi meccanismi di enforcement.

- Claude Code: full capability — CLAUDE.md, memoria, hook, MCP, skill, agenti ✅
- Codex: usa per coding profondo e analisi codebase; AGENTS.md come file canonico; non ha memoria persistente né MCP nativi → complementare a Claude Code, non sostituto ⚠️
- Cursor/Windsurf/Trae: ambienti secondari con limiti espliciti ❌
- Per ogni ambiente: definire quali file di regole legge, quali tool/MCP supporta, quali hook o equivalenti ha, quali skill/comandi sono disponibili, quali limiti ha.
- Se una capability manca in un ambiente → progettare un sostituto: wrapper, workflow, checklist, slash command.
- Audit periodico di drift: se un hook o skill funziona in Claude Code ma manca in Codex → gap documentato e corretto dove possibile.
- **Industry convergence** (best practice 2026): Claude Code, Codex, Copilot, Gemini, Cursor e Devin stanno convergendo sugli stessi primitive architetturali. Mantenere la parity non è lottare contro la corrente — è seguire lo standard che emerge. Agent control plane unificato (kick off da un punto, esegue ovunque) è il prossimo passo.
- **Consistency come metrica**: la qualità in ambiente multiplo si misura — stessa task in Claude Code e Codex deve produrre stesso risultato. Se diverge → gap documentato, non ignorato.

---

## 9. Strumenti personali e ambienti — ✅ Implementato

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

## 10. Manutenzione e produzione — ✅ Implementato

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

### Produzione e handoff
- Guida setup completa (n8n + bot + PM2 + credenziali) per passare il sistema ad altri ❌
- Checklist 360 riusabile ✅ creata in `docs/360-checklist.md` (101 check, 15 aree)
- Workflow bot LinkedIn (inviteWorker, messageWorker, sequenze follow-up) da migliorare ❌

### Self-healing (best practice 2026)
Pattern da implementare per il bot:
- Memory leak rilevato → PM2 restart automatico (già parziale via PM2 max_memory_restart)
- Traffic spike / rate limit → backoff automatico con alert Telegram
- Failed deployment → rollback automatico all'ultimo commit stabile
- Workflow n8n non eseguito da 14gg → alert manutenzione

Orchestrazione multi-agente enterprise richiede: lifecycle management (deploy/monitor/update/rollback), resource allocation, inter-agent communication, **centralized logging con distributed tracing** — il nostro sistema attuale ha logging locale ma non tracing correlato tra bot + n8n + dashboard.

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

**L'AI è autonoma quando**:
- Il loop parte automaticamente su ogni task ✓ (implementato in CLAUDE.md)
- La ricerca web è automatica prima di ogni implementazione ✓ (implementato)
- L1-L9 vengono applicati senza essere chiesti ✓ (implementato)
- Skill, MCP, agente, workflow vengono scelti senza essere indicati ✓ (implementato)
- Le regole critiche sono tutte in hook (non solo testo) ❌ (parziale)
- Un sistema misura quali regole vengono dimenticate e le converte in hook ❌
- I workflow n8n girano in autonomia nei giorni e orari giusti ❌ (n8n da attivare)
- Nessuna "false completion" — il loop si chiude solo quando L9 è verde ✓ (implementato)

**Self-evolving agent pattern** (best practice 2026 — OpenAI Cookbook):
Il sistema migliora in autonomia seguendo il ciclo: **percezione → ragionamento → azione → feedback**.
1. Percezione: l'AI rileva un errore ricorrente o una regola dimenticata
2. Ragionamento: identifica la causa (regola solo in testo, hook mancante, skill assente)
3. Azione: converte la regola in hook, o crea una skill, o aggiorna CLAUDE.md
4. Feedback: misura se il comportamento è migliorato nel ciclo successivo

Questo loop è attualmente manuale (l'utente segnala → Claude aggiorna). **Obiettivo**: rendere il rilevamento automatico tramite hook PostToolUse che tracciano violazioni → alert → proposta di fix.

**Dipende da**: punti 4 (hook-first completo) + 7 (n8n attivo) + 10 (produzione) completati.
