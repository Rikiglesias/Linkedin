# AI Operating Model

> **Questo documento è aspirazionale ma tracciato.**
> Ogni sezione ha uno status: ✅ Implementato | ⚠️ Parziale | ❌ Non ancora fatto.
> Le implementazioni concrete stanno in: `~/.claude/CLAUDE.md` (regole globali), `AGENTS.md` (progetto), `~/.claude/skills/` (skill), `~/memory/` (memoria).

---

## Stato rapido

| Blocco | Punti | Status |
|--------|-------|--------|
| Fondamenta (0, 4-bis, 4-ter, 9, 10) | 5 | ✅ tutti |
| Controllo (11, 12, 13, 14, 15) | 5 | ✅ tutti |
| Enforcement (8-bis, 17, 18) | 3 | ✅ tutti |
| Orchestrazione (5, 6) | 2 | ⚠️ parziale |
| Ambienti (3, 3-bis, 2) | 3 | ⚠️ parziale |
| Long-term (1, 19, 19-ter, 19-bis, 20-bis, 21) | 6 | ⚠️ parziale |
| Sempre attivi (7, 8, 16, 20) | 4 | ✅ tutti |

**Gap aperti prioritari:**
1. Workflow bot LinkedIn migliorati (punto 6)
2. Guida setup per altri / produzione (punti 5 + 19)
3. Selezione automatica modello/ambiente (punto 2)
4. Migrazione Codex (punto 3 — richiede `! codex login`)
5. Pulizia codebase schedulata (punto 19)

---

## Roadmap — ordine di implementazione

```
BLOCCO A — Fondamenta ✅ DONE
  0. Regole esplicite
  4-bis. File memoria leggibili
  4-ter. Anti-dimenticanza
  9. Best practice per artefatto
  10. Ragionamento umano

BLOCCO B — Controllo ✅ DONE
  13. Protocollo multi-livello (L1-L9)
  14. Multi-dominio per file (L7)
  15. Loop finale (L9)
  11. Contesto diretto/indiretto

BLOCCO C — Enforcement ✅ DONE
  8-bis. Hook system → settings.json + skill pre/post-conditions

BLOCCO D — Orchestrazione ⚠️ IN PROGRESS
  5. n8n orchestratore ✅ (4 workflow DevOps)
  6. Agenti verticali ⚠️ (5 agenti monitoring ✅, workflow bot ❌)

BLOCCO E — Ambienti ⚠️ BLOCCATO su utente
  3. Migrazione Codex → richiede ! codex login
  3-bis. Parità ambienti ✅
  2. Prompt/modelli → dipende da 3

BLOCCO F — Long-term ⚠️ ONGOING
  19. Manutenzione e produzione
  1. Whisper (✅ creato, manca API key)
  20-bis. Policy sicurezza/GDPR (✅ parziale)
  21. Autonomia totale → obiettivo finale
```

---

## 0. Regole esplicite, non implicite — ✅ Implementato

Nessuna regola importante deve restare sottintesa. Ogni regola deve dire quando si applica, su cosa si applica, cosa bisogna fare, quali collegamenti diretti e indiretti vanno considerati e come si verifica che sia stata davvero applicata. Se emerge una regola nuova utile, va formalizzata nei file canonici e non lasciata in chat.

---

## 1. Strumenti personali e infrastruttura locale — ⚠️ Parziale

- **Whisper**: ✅ creato in `C:\Users\albie\tools\whisper-dictation\` — manca `pip install keyboard` + API key in `.env`; avviare con `start.bat` come admin, F9 per dettare
- **Problema computer**: ⚠️ documentato in `~/memory/computer.md`, non risolto
- **Procedura alimentatore**: ✅ spegnimento OS → interruttore su O → rimozione spina prendendo la testa, non il cavo

Creare un programma locale di dettatura basato su Whisper via API OpenAI per sostituire Win+H, con maggiore precisione e controllo del testo. Analizzare e risolvere i problemi del computer che rallentano il lavoro. Tenere una procedura sicura per scollegare PC e alimentatore.

---

## 2. Prompt, modelli e ambiente migliore — ⚠️ Parziale

- **`/prompt-improver`**: ✅ skill creata — ripara dettati vocali grezzi
- **Selezione automatica modello**: ❌ da implementare
- **Selezione automatica ambiente**: ❌ da implementare
- **Prompt sito ottimizzati**: ❌ da fare

Creare una funzione, skill o mini-software che trasformi prompt scritti male in prompt chiari, completi e ben strutturati. Far scegliere all'AI il modello più adatto per ogni task. Far scegliere anche l'ambiente migliore tra Codex, Claude Code o Codex dentro Claude Code, spiegando brevemente il perché in termini di qualità, velocità, costo, tool, contesto e rischio di errore. Migliorare anche i prompt del sito e la scelta del modello migliore per ogni workflow.

---

## 3. Migrazione operativa su Codex — ⚠️ Bloccato (richiede login utente)

- **Prerequisito**: `! codex login` nel terminale — azione dell'utente
- **Dopo login**: configurare parità con Claude Code, AGENTS.md come file canonico

Spostare progressivamente scrittura, analisi e gestione della codebase su Codex. Usare gli altri strumenti solo quando hanno un vantaggio reale. Centralizzare su Codex il flusso tecnico principale.

---

## 3-bis. Parità operativa tra IDE, terminali e CLI — ✅ Implementato

- Claude Code: ✅ full capability
- Codex: ⚠️ parziale (dipende da punto 3)
- Cursor/Windsurf/Trae: ❌ secondari, limiti documentati

Tutti gli ambienti usati sul progetto devono essere configurati in modo coerente. Devono leggere le stesse regole, avere accesso ai file canonici giusti, usare skill, hook, MCP e workflow equivalenti dove possibile, e dichiarare in modo esplicito differenze o limiti. Se una capability importante manca in un ambiente, va progettato un sostituto ragionevole.

---

## 4. Passaggio contesto tra chat — ✅ Implementato

- **`/context-handoff`**: ✅ skill creata in `~/.claude/skills/context-handoff/`

Creare una skill o funzione che trasferisca in una nuova sessione obiettivi, stato del lavoro, decisioni, file toccati, problemi aperti e prossimi passi. Nessuna nuova chat dovrebbe ripartire da zero quando esiste già contesto utile.

---

## 4-bis. File di memoria e contesto leggibili dall'AI — ✅ Implementato

Tutti i file di memoria, tracking, backlog, regole e handoff devono essere progettati per essere letti bene dall'AI, non solo da un umano. Ogni file deve avere una responsabilità chiara, dire cosa contiene, cosa non contiene, quando va aggiornato e a quali file canonici è collegato. La struttura deve aiutare l'AI prima, durante e dopo la lettura: apertura chiara, sezioni piccole e ordinate, riepilogo finale di stato, decisioni, blocchi e prossimi passi. Se un file cresce troppo o mescola troppi temi, va spezzato in indice più file tematici.

---

## 4-ter. Meccanismi anti-dimenticanza per modelli e agenti — ✅ Implementato

Non bisogna affidarsi solo alla memoria del modello o alla presenza di un file di regole. Servono memoria persistente separata per tipo di informazione, retrieval o file search sui file giusti, checklist obbligatorie, output strutturati, pre-hook e post-hook, workflow riusabili, subagenti specializzati ed eval periodiche. Le regole critiche non devono vivere solo in testo libero, ma anche in punti di enforcement concreti. Se un passaggio viene dimenticato più volte, va trasformato in meccanismo.

---

## 5. n8n come orchestratore tecnico — ✅ Implementato (2026-04-08)

**Workflow creati** in `n8n-workflows/` (importare in n8n UI):
- `quality-gate-check.json` — typecheck + lint, webhook/manuale
- `gdpr-retention-cleanup.json` — cron lunedì 9:00, dry-run + conferma
- `bot-health-check.json` — cron 9/13/17 lun-ven, PM2 + dashboard
- `weekly-lead-report-v2.json` — cron venerdì 17:00, stats settimana

**Per attivare**: avviare n8n (`pm2 start ecosystem.config.cjs`), importare JSON, configurare `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `DASHBOARD_API_KEY`, credenziale Postgres.

**Gap**: guida setup completa per passare il sistema ad altri ❌

Usare n8n anche come strumento DevOps e di orchestrazione sulla codebase. Prepararlo per la produzione, con workflow chiari, riusabili, distribuibili e passabili ad altre persone. Collegare trigger e automatismi a giorni lavorativi, orari e contesto reale dell'utente.

---

## 6. Agenti verticali e workflow riusabili — ⚠️ Parziale

**Workflow monitoring creati** in `n8n-workflows/`:
- `linkedin-antiban-review.json` — webhook, checklist 5 domande, esito SAFE/REVIEW
- `linkedin-campaign-analyzer.json` — cron lunedì 8:00, acceptance/reply/pending rate
- `pre-production-checklist.json` — webhook, gate READY/NOT READY pre-deploy
- `codebase-audit.json` — cron domenica 10:00, circular deps/TODO/file >300 righe
- `lead-pipeline-health.json` — cron lun-ven 8:00, alert silenzioso se tutto ok

**Gap**: miglioramento workflow bot LinkedIn (inviteWorker, messageWorker, sequenze messaggi) ❌

Creare agenti AI verticali, specializzati per singolo compito o singolo workflow, invece di agenti troppo generici. Migliorare anche i workflow del bot, non solo quelli di supporto. Creare workflow n8n riusabili per task ripetitivi come analisi impatti, cleanup, audit skill, controlli qualità, controlli pre-produzione e verifiche regole. Se una procedura torna spesso, va valutata la trasformazione in workflow stabile.

---

## 7. Selezione automatica di skill, agenti, workflow e web search — ✅ Implementato

Quando arriva una richiesta, l'AI deve classificare internamente il task prima di agire. Deve decidere in modo esplicito che tipo di lavoro è, quali skill servono, quale agente o workflow n8n serve, se serve ricerca web e quale modello o ambiente conviene usare. Se uno di questi pezzi manca, la selezione è incompleta.

---

## 8. Audit, qualità e installazione delle skill — ✅ Implementato

Fare un audit continuo delle skill per capire quali sono utili, duplicate, obsolete o deboli. Scegliere sempre la skill più adatta e più forte per il compito. Installare nuove skill solo se coprono un gap reale o migliorano nettamente un flusso debole. Mantenere una mappa chiara che dica trigger, casi d'uso, limiti, dipendenze, output atteso e verifiche collegate.

---

## 8-bis. Pre-hook e post-hook per skill, MCP, regole e workflow — ✅ Implementato (2026-04-08)

**Implementato**:
- `settings.json`: `PreToolUse` bloccante su Edit/Write file sensibili LinkedIn → forza antiban-review
- `settings.json`: `PostToolUse` asincrono su Bash → log qualità
- `settings.json`: `Stop` con log working dir
- Skill `antiban-review`, `loop-codex`, `context-handoff`: Pre-conditions + Post-conditions aggiunte
- AGENTS.md: mappa completa hook attivi

**Gap**: hook in ingresso/uscita workflow n8n ⚠️

Progettare un sistema coerente di pre-hook e post-hook per skill, regole, MCP e workflow. I pre-hook devono validare contesto, prerequisiti, dipendenze e rischi. I post-hook devono validare esito, cleanup, verifiche finali e stato lasciato al sistema. Anche i workflow n8n devono avere hook di ingresso e uscita per non partire con contesto incompleto e non chiudersi lasciando incoerenze.

---

## 9. Best practice obbligatorie da ingegnere software — ✅ Implementato

Ogni modifica deve seguire best practice professionali, ma specifiche per il tipo di artefatto toccato: codice, documenti tecnici, guide operative, config, workflow, schemi API, migrazioni, file di tracking, struttura cartelle. Se le best practice di quel dominio possono essere cambiate o aggiornate, l'AI deve verificarle anche sul web. L'ordine delle modifiche va deciso prima per non rompere import, tipi, runtime o integrazioni. Ogni modifica va valutata anche per la sua tenuta nel tempo, così da non creare debito nascosto o componenti rimaste indietro.

---

## 10. Ragionamento umano, non esecuzione cieca — ✅ Implementato

L'AI deve capire l'intento reale dell'utente e non limitarsi al testo letterale. Deve leggere tra le righe, anticipare problemi, prevedere dipendenze e coprire anche aspetti tecnici che l'utente non conosce o non può verificare da solo. Nei task ambigui deve esplicitare internamente quale problema reale sta risolvendo.

---

## 11. Contesto corretto su file diretti e indiretti — ✅ Implementato

Ogni modifica riguarda sia i file toccati direttamente sia quelli coinvolti indirettamente. Vanno considerati dipendenze, import, contratti, integrazioni, moduli dipendenti ed effetti runtime. L'AI non deve mai lavorare in modo parziale o isolato, e per ogni task deve saper dire quali sono i file diretti, quali gli indiretti e perché.

---

## 12. Ricerca web e attivazione tool nel momento giusto — ✅ Implementato

Se il task riguarda framework, API, librerie, servizi esterni o best practice aggiornabili, la ricerca web è obbligatoria prima di implementare. Questo vale anche per artefatti non-code, come documenti, config, workflow, plugin e file di supporto. Skill, workflow e tool vanno attivati quando servono davvero, non troppo tardi e non in modo casuale.

---

## 13. Protocollo di controllo multi-livello — ✅ Implementato

Ogni modifica deve passare da un protocollo strutturato che copra: classificazione dei domini coinvolti, analisi impatti diretti e indiretti, ordine di esecuzione, implementazione con best practice corrette, controllo tecnico immediato, verifica trasversale tra domini, validazione finale per dominio e controllo conclusivo anti-errori. Questo protocollo non è facoltativo.

Livelli: L1 (build+test), L2 (catene dirette), L3 (runtime profondo), L4 (ragionamento preventivo), L5 (visione prodotto), L6 (coerenza sistema), L7 (multi-dominio per file), L8 (coerenza cross-file), L9 (loop finale DONE/BLOCKED).
Proporzionalità: quick fix → L1-L4; feature/refactor → L1-L9.

---

## 14. Controllo multi-dominio per ogni file — ✅ Implementato

Per ogni file modificato, l'AI deve controllare non solo il motivo principale del cambiamento, ma anche tutti gli altri aspetti che quel file può toccare, per esempio sicurezza, performance, tipi, error handling, automazione, integrazioni e architettura. Questo controllo deve essere dichiarato in modo reale e specifico per ogni file.

Output: `L7 — {file}: [Sec✓][Perf✓][Type✓][Err✓][Auto-][Int✓][SRP✓][Obs✓]`

---

## 15. Loop finale di completezza — ✅ Implementato

A fine lavoro, l'AI deve rieseguire un controllo finale completo sui file toccati direttamente e indirettamente. Il task non va chiuso se restano buchi logici, passaggi dimenticati o incoerenze.

Condizioni DONE: L1-L8 verdi, worklog aggiornato, nessun TODO aperto, commit eseguito.
Auto-commit quando L9=DONE + exit code 0. BLOCKED = causa esplicita + azione richiesta.

---

## 16. Loop custom tipo Claude, se Codex non lo offre — ✅ Implementato

- **`/loop-codex`**: ✅ skill creata in `~/.claude/skills/loop-codex/`

Se Codex non offre nativamente una funzione equivalente a Claude Code /loop, bisogna creare una skill, un workflow o un automatismo che replichi quel comportamento. Questa modalità deve continuare a lavorare, ricontrollare e avanzare di step in step fino a chiusura reale del task. Se deve fermarsi, deve lasciare blocco, stato e prossimi passi in modo chiarissimo.

---

## 17. Automatismi intelligenti, non ciechi — ✅ Implementato

Gli automatismi devono prima analizzare il bisogno e poi proporre l'azione, non eseguirla subito. Per esempio, per la pulizia periodica della codebase, il sistema deve prima capire se serve davvero cleanup o refactor e solo dopo proporlo all'utente. Gli automatismi devono attivarsi solo quando portano valore reale.

---

## 18. Schema obbligatorio degli automatismi — ✅ Implementato

Ogni automatismo deve seguire la stessa sequenza: rilevazione del bisogno, analisi del contesto, proposta chiara all'utente, conferma, esecuzione e report finale. Nessun automatismo strutturale, invasivo o potenzialmente distruttivo deve partire senza conferma esplicita.

---

## 19. Manutenzione periodica e produzione — ⚠️ Parziale

- Pulizia codebase schedulata: ❌ non ancora automatizzata
- Infrastruttura produzione: ⚠️ parzialmente pronta
- Guida setup per altri (n8n + bot + PM2 + credenziali): ❌ da creare
- Workflow bot LinkedIn migliorati: ❌ da fare

Fare pulizia periodica della codebase per rimuovere codice inutile e ridurre complessità. Consolidare tutto ciò che serve per andare in produzione in modo ordinato. Rendere workflow, infrastruttura e documentazione abbastanza chiari da poterli passare anche ad altre persone senza dipendere da conoscenza implicita.

---

## 19-ter. Politica di manutenzione per tipo di artefatto — ⚠️ Parziale

Policy scritta ✅, automazione trigger ❌.

Ogni tipo di file deve avere trigger espliciti di audit, cleanup e aggiornamento:
- **Codice**: ripulire quando cresce male, mostra dead code o dipendenze circolari
- **File di regole (CLAUDE.md, AGENTS.md)**: pulire prima di estendere — `claude-md-management:claude-md-improver` se >300 righe
- **Memoria**: aggiornare o eliminare se contraddice lo stato attuale; aggiornare a fine sessione significativa
- **Documenti tecnici**: allineare alla realtà del progetto quando un punto cambia status
- **Skill**: riesaminare se non usate o se non riflettono più i workflow reali
- **Workflow n8n**: controllare se non girano più o se l'area del bot è cambiata

---

## 19-bis. Checklist 360 gradi per nuovi progetti — ✅ Implementato

Deve esistere una checklist riusabile per bootstrap e riallineamento di nuovi progetti. Deve coprire struttura codice, regole operative, documentazione canonica, memoria AI, quality gates, ambienti, skill, hook, MCP, workflow, sicurezza, osservabilità, test, produzione, handoff e prevenzione del debito tecnico. Deve funzionare sia per l'utente sia per altre persone a cui il progetto viene passato.

---

## 20-bis. Policy di sicurezza, anti-ban e conformità legale — ⚠️ Parziale

- **Anti-ban**: regole AGENTS.md ✅; hook PreToolUse per file sensibili ✅; monitoring Telegram ⚠️; eval automatico ❌
- **GDPR**: retention policy ✅ (migration 059); audit trail ✅ (auditLog.ts); registro art. 30 ❌
- **LinkedIn ToS**: principi AGENTS.md ✅; web search periodica schedulata ❌
- **Sicurezza sistema**: architettura sicura ✅; audit credenziali periodico ❌

Ogni modifica deve essere valutata anche rispetto a vincoli esterni, non solo rispetto alla qualità tecnica. Per il bot LinkedIn questo include review anti-ban obbligatoria su browser, timing, stealth, volumi e sessioni; principi non negoziabili di comportamento umano credibile; policy GDPR su dati personali, retention, anonimizzazione e audit trail; rispetto pratico dei rischi legati ai ToS LinkedIn; gestione sicura di credenziali, rete, dashboard, database e servizi interni.

---

## 20. Verifica continua di regole, skill e workflow — ✅ Implementato

Controllare periodicamente se le regole si attivano davvero nel momento giusto, se le skill scelte sono le migliori, se ci sono duplicati e se i workflow funzionano come dovrebbero. Le regole non devono restare teoriche: devono produrre comportamento reale. Se una regola resta ancora implicita, va riscritta in forma esplicita.

---

## 21. Autonomia operativa totale — ⚠️ Obiettivo finale

Dipende da: punto 3 (Codex) + punto 2 (modelli) + punto 6 (bot workflows) + punto 19 (produzione) completati.

L'obiettivo finale è che l'AI si attivi sempre da sola, ricordi tutte queste regole, scelga in autonomia strumenti, skill, workflow, agenti, ricerca web e ordine di esecuzione. Il lavoro deve arrivare a chiusura reale senza costringere l'utente a fare da project manager tecnico. L'autonomia non significa improvvisazione, ma applicazione costante di regole esplicite, complete e verificabili.
