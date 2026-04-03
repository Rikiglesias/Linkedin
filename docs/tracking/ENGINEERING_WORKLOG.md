# Engineering Worklog

Questo file tiene traccia dei blocchi tecnici realmente analizzati, provati o verificati nel repo.

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
