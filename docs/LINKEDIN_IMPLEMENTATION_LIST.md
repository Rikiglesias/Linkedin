# LinkedIn Implementation List

Questa lista raccoglie i punti di implementazione specifici per questo progetto bot LinkedIn: runtime, anti-ban, proxy, compliance, n8n, workflow e cleanup LinkedIn-specifico.

Scopo: leggere tutto in una sola passata, confrontare con la chat, capire cosa manca a livello di bot e infrastruttura LinkedIn.

Nota: questo file e' il backlog primario per i punti LinkedIn-specifici. Il backlog strutturato con sottopunti, primitive corrette e done criteria sta in `AGENTS.md`, `docs/AI_OPERATING_MODEL.md` e `todos/workflow-architecture-hardening.md`.

Regola di aggiornamento: quando si chiude un item, spostarlo nella sezione Completati con data e riferimento all'intervento.

---

## Classificazione enforcement

Tutti gli item di questa lista sono **`[usr]`** — sono task di implementazione, feature, audit o decisioni da attivare su iniziativa esplicita dell'utente.

Le regole di comportamento AI automatico (recap, cross-domain check, anti-compiacenza, ecc.) sono in `AI_IMPLEMENTATION_LIST_GLOBAL.md` nella tabella `[auto]`.

---

## Aperti

### Fase 4 — Runbook sistema

69. `[Local tools][medio]` Documentare e testare il runbook di spegnimento sicuro del sistema (bot, PM2, DB, dashboard, n8n) prima di staccare l'alimentatore o riavviare il computer, per evitare corruzione dati, lock file rimasti o daemon zombie.

### Fase 5 — Runtime reale e truthfulness del bot

13. `[Runtime][breve/medio]` Portare reporting live, stato proxy e stato JA3 fuori dalla memoria locale di processo.

14. `[Runtime][breve/medio]` Sostituire o chiudere il `skipPreflight` troppo permissivo nei path non interattivi.

15. `[Runtime][breve/medio]` Rendere l'override account scoped alla singola run e sempre ripristinato.

16. `[Runtime][breve/medio]` Verificare che API, Telegram, report e dashboard leggano la stessa verita' runtime e chiudere i failure mode specifici che ancora non propagano tutti lo stesso `WorkflowExecutionResult`.

17. `[Runtime][medio]` Completare validazioni di staging reali con browser, proxy e account veri.

18. `[Runtime][breve/medio]` Completare stop/flush esplicito durante lo shutdown. **Chi**: modificare `lifecycle.ts`. **Cosa**: cleanup esplicito per `telegramListener.destroy()`, checkpoint Supabase, connessioni dashboard WebSocket. **Test**: scenari stop/restart/crash. **Criterio done**: zero zombie processes post-shutdown + `/api/health/deep` segnala shutdown pulito.

19. `[Runtime][medio]` Implementare recovery automatico per i casi noti: memory leak → PM2 restart, traffic spike → backoff + alert Telegram, workflow n8n non eseguito 14gg → alert manutenzione.

70. `[Runtime][breve]` Configurare Supabase per la dashboard: applicare schema.sql, impostare .env.local, avviare `npm run dev` e verificare connessione reale ai dati live.

71. `[Runtime][medio]` Consolidare una suite di test focalizzata su workflow + AI + browser behavior: contract tests AI decisionale, characterization tests sui path di fallback, test di lifecycle stop/restart/crash/lock, smoke test daemon/API su processi separati per il reporting cross-process.

### Fase 6 — Anti-ban, proxy/sessione, sicurezza e compliance

20. `[Anti-ban][breve/medio]` Fare un audit completo dei workflow pubblici su proxy, sessione, account health e preflight reale.

21. `[Anti-ban][breve/medio]` Separare in modo affidabile `LOGIN_MISSING` da rate limit, `403`, timeout, proxy failure e rete degradata.

22. `[Anti-ban][breve/medio]` Rafforzare il gate "proxy healthy" con verifica reale di auth, `CONNECT`, exit IP e browsing minimo.

23. `[Anti-ban][medio]` Valutare e verificare la coerenza geo sull'exit IP reale.

24. `[Anti-ban][medio]` Ripristinare o sostituire in modo corretto il controllo UA <-> engine anche nei casi JA3 e proxy.

25. `[Anti-ban][medio]` Allineare il preflight workflow al mondo multi-account e multi-proxy reale.

26. `[Anti-ban][medio/lungo]` Aggiornare la parte anti-ban con i vettori di detection piu' recenti e con monitor periodici reali.

27. `[Anti-ban][medio/lungo]` Aggiornare la skill `antiban-review` con i vettori di detection ML 2026: ritmo account, hesitation simulation, eliminazione delay matematicamente precisi.

72. `[Anti-ban][breve/medio]` Ripulire i boundary dei workflow orchestrati: eliminare inbox scan/follow-up impliciti fuori dal contratto e path residui che non usano ancora lo stesso standard click/input del core.

73. `[Anti-ban][breve/medio]` Audit di `windowInputBlock` e protezione dal takeover del mouse da parte dell'utente durante le sessioni browser attive.

74. `[Anti-ban][medio]` Verificare che non restino teletrasporti di navigazione (`page.goto()` diretto su profili LinkedIn) nei path laterali fuori dal core.

75. `[Anti-ban][medio]` Decidere se implementare davvero `inbox_reply` come capability completa oppure rimuovere il contratto morto dalla codebase.

76. `[Runtime][breve/medio]` Avviare lo sprint di refactoring del runtime core: separare orchestratore, dispatcher, lifecycle e state store in moduli con responsabilita' singola, eliminare lo stato condiviso implicito tra di essi, e definire i contratti di interfaccia espliciti. **Criterio done**: `npx madge --circular` = 0 sul modulo runtime; ogni modulo ha un unico file di entry con contratto dichiarato.

77. `[Runtime][medio]` Implementare la capability di restart remoto del bot: endpoint API autenticato `/api/control/restart` che esegua graceful shutdown + PM2 restart, con log strutturato dell'evento e notifica Telegram al completamento. Utile per recovery da mobile senza accesso SSH.

28. `[Compliance][breve/medio]` Importare e attivare davvero il workflow di retention e GDPR gia' preparato.

29. `[Compliance][medio]` Verificare end-to-end right to erasure, retention e data hygiene anche sugli store secondari.

30. `[Security][medio]` Verificare che Sentry e i controlli di sicurezza ricevano eventi reali in produzione.

31. `[Security][medio/lungo]` Mantenere security scan mirati su auth, input utente, query DB, stealth e aree sensibili.

### Fase 7 — n8n, agenti verticali e automazioni durevoli

32. `[n8n][medio]` Portare i workflow n8n da artefatti nel repo a flussi vivi nell'istanza reale, con attivazione e ownership chiare.

33. `[n8n][medio]` Implementare hook di ingresso/uscita come punti di controllo veri del workflow, non come note documentali.

34. `[n8n][medio]` Aggiungere stato o memoria durevole dove il workflow non puo' essere trattato come stateless senza perdere affidabilita'.

35. `[n8n][medio]` Introdurre human-in-the-loop reale per flussi ad alto rischio, strutturali o invasivi, con pause e conferme nei punti giusti.

36. `[n8n][medio]` Ripulire boundary e responsabilita' tra workflow critici del bot, agenti verticali e automazioni di supporto, evitando side effect impliciti fuori contratto e restringendo quelli troppo generici. *(Fuso da ex item 42, 62)*

78. `[n8n][medio]` Separare esplicitamente i workflow n8n in due categorie — **core bot** (connection request, message, follow-up, health check, recovery) vs **DevOps/support** (alert Telegram, cleanup, manutenzione DB, anti-ban news monitor) — con ownership, trigger e criteri di failure diversi. Documentare la matrice in `docs/WORKFLOW_MAP.md`.

79. `[Runtime][medio]` Definire e implementare la routing matrix per dominio del bot: per ogni area (browser/Playwright, Supabase DB, anti-ban/proxy, memoria/handoff, n8n workflow) indicare quale agente specializzato, quale skill, quale MCP e quale fonte di verita' si usa. Codificare in `AI_CAPABILITY_ROUTING.json` come dominio LinkedIn e verificare con `npm run audit:capability-routing`.

37. `[n8n][medio]` Rendere i workflow distribuibili ad altri con setup, env validation, health check, runbook e criteri di ownership completi.

38. `[n8n][medio]` Allineare scheduling, giorni e orari di lavoro alle finestre operative reali dell'utente e al valore effettivo dell'automazione.

### Fase 10 — Cleanup strutturale e documentale (LinkedIn)

47. `[Cleanup][medio]` Decidere il destino delle aree legacy o ambigue della UI e della dashboard.

49. `[Cleanup][medio/lungo]` Tenere `docs/README.md` davvero allineato ai documenti importanti.

50. `[Cleanup][medio/lungo]` Pulire root e cartelle solo dopo classificazione esplicita del loro ruolo.

51. `[Cleanup][medio/lungo]` Ridurre duplicazioni, backlog morti e documenti che dicono la stessa cosa con nomi diversi.

---

## Completati

### Fase 5 — Runtime reale

- ✅ Rendere il lock del daemon cooperativo e rinnovato per tutta la durata reale della run. → *`loopCommand.ts`: acquire + heartbeat + release; `lifecycle.ts`: shutdown callbacks (2026-04-19)* *(ex 33)*
- ✅ Eliminare `process.exit(0)` nei path critici e chiudere il graceful shutdown. → *`performGracefulShutdown` in `src/index.ts` (2026-04-19)* *(ex 34)*
- ✅ Allineare timeout PM2 al budget reale di stop. → *`ecosystem.config.cjs`: daemon 10s→35s, API 5s→15s (2026-04-19)* *(ex 36)*
- ✅ `/api/health/deep` misura daemon liveness, runtime lock, zombie `automation_commands` e readiness reale. → *`health.ts`: `runtime_locks` + zombie checks (2026-04-19)* *(ex 38)*
- ✅ Recuperare `automation_commands` rimasti `RUNNING` dopo crash o stop brutale. → *`recoverStaleAutomationCommands(15)` (2026-04-19)* *(ex 39)*
- ✅ Aggiungere fallback strutturato `WORKFLOW_ERROR` per incidenti runtime non gestiti. → *`dispatcher.ts`: try/catch con `WORKFLOW_ERROR` strutturato (2026-04-19)* *(ex 40)*
- ✅ Allineare `workflowToJobTypes(...)` con i job realmente accodati e consumati. → *`scheduler.ts`: `INTERACTION` in `'all'` (2026-04-19)* *(ex 41)*
