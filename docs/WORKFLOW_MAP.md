# Mappa Completa dei 5 Workflow

Documento di riferimento con TUTTI i collegamenti, dipendenze, domande utente, config .env, tabelle DB, file sorgente e intrecci tra workflow.

---

## 1. SYNC-LIST

### Comando
```
.\bot.ps1 sync-list --list "Nome" [--url <url>] [--max-pages 10] [--max-leads 500] [--dry-run] [--no-proxy] [--account <id>] [--skip-preflight] [--no-enrich] [--interactive|-i]
```

### Catena File (dall'entry point all'esecuzione)
```
index.ts
  └─ cli/commands/workflowCommands.ts → runSyncListCommand()
      └─ workflows/syncListWorkflow.ts → runSyncListWorkflow()
          ├─ workflows/preflight.ts → runPreflight()
          │   ├─ workflows/types.ts (PreflightDbStats, PreflightConfigStatus, etc.)
          │   ├─ workflows/reportFormatter.ts → formatPreflightSection()
          │   ├─ cli/stdinHelper.ts (readLineFromStdin, askConfirmation, askNumber, askChoice)
          │   ├─ browser/sessionCookieMonitor.ts → checkSessionFreshness()
          │   ├─ proxy/ipReputationChecker.ts → checkIpReputation() [lazy import]
          │   ├─ core/repositories.ts → getDailyStat(), getRuntimeFlag(), countWeeklyInvites()
          │   ├─ accountManager.ts → getRuntimeAccountProfiles()
          │   └─ db.ts → getDatabase(), checkDiskSpace()
          ├─ core/repositories.ts → getAutomationPauseState(), getRuntimeFlag()
          ├─ core/salesNavigatorSync.ts → runSalesNavigatorListSync()
          │   ├─ browser.ts → launchBrowser(), closeBrowser(), checkLogin()
          │   ├─ browser/humanBehavior.ts (humanDelay, humanScroll, etc.)
          │   ├─ browser/stealth.ts (fingerprint, anti-detect)
          │   ├─ browser/navigationContext.ts
          │   ├─ selectors/ (CSS selectors SalesNav)
          │   ├─ integrations/parallelEnricher.ts → enrichLeadsParallel()
          │   │   ├─ integrations/apolloClient.ts
          │   │   ├─ integrations/hunterClient.ts
          │   │   └─ integrations/clearbitClient.ts
          │   ├─ ai/leadScorer.ts → scoreLeads()
          │   ├─ cloud/cloudBridge.ts → bridgeLeadStatus()
          │   └─ core/repositories/ (insert/update leads, lists, stats)
          └─ workflows/reportFormatter.ts → formatWorkflowReport()
```

### Domande Preflight (in ordine)
| # | ID | Prompt | Tipo | Default |
|---|---|---|---|---|
| 1 | `list` | Nome della lista SalesNav (o URL diretto) | string | config `SALESNAV_SYNC_LIST_NAME` |
| 2 | `maxPages` | Quante pagine massimo scansionare? | number | config `SALESNAV_SYNC_MAX_PAGES` |
| 3 | `maxLeads` | Limite lead massimi? | number | config `SALESNAV_SYNC_LIMIT` |
| 4 | `enrichment` | Vuoi enrichment profondo (OSINT)? | boolean | true |

### Checklist Anti-Ban (CHECKLIST_SCRAPING)
1. "Hai chiuso TUTTI gli altri tab/finestre di LinkedIn?" → **BLOCCANTE**
2. "È passata almeno 1 ora dall'ultima sessione su LinkedIn?" → suggerimento
3. "Sai che NON devi interagire con la finestra del browser?" → **BLOCCANTE**
4. "Sai che per chiudere devi usare Ctrl+C (MAI chiudere la finestra)?" → **BLOCCANTE**

### Controlli/Warning Preflight
| Controllo | Livello | Quando scatta |
|---|---|---|
| Proxy non configurato | **CRITICAL** | `PROXY_URL` vuoto (scraping SalesNav senza proxy = alto rischio) |
| Proxy IP blacklisted | **CRITICAL** | IP abuse score alto (check AbuseIPDB) |
| Cookie sessione scaduti | WARN | Account con sessione > `SESSION_COOKIE_MAX_AGE_DAYS` |
| Nessun login registrato | **CRITICAL** | Account mai loggato (lastVerifiedAt null) |
| Apollo/Hunter non configurati | INFO | Nessuna API enrichment |
| AI non configurata | WARN | No `OPENAI_API_KEY` e no `OLLAMA_ENDPOINT` |
| Supabase non configurato | INFO | No cloud sync |
| Risk STOP | **BLOCCA** | Score rischio > 60 |

### Guard Post-Preflight
- **Quarantina** → `getRuntimeFlag('account_quarantine') === 'true'` → BLOCCA
- **Pausa** → `getAutomationPauseState().paused` → BLOCCA

### Config .env Rilevanti
| Variabile | Default | Descrizione |
|---|---|---|
| `SALESNAV_SYNC_LIST_NAME` | `default` | Nome lista SalesNav di default |
| `SALESNAV_SYNC_LIST_URL` | (vuoto) | URL diretto lista SalesNav |
| `SALESNAV_SYNC_MAX_PAGES` | 3 | Pagine max per sync |
| `SALESNAV_SYNC_LIMIT` | 500 | Lead max per lista |
| `SALESNAV_SYNC_ACCOUNT_ID` | (vuoto) | Account specifico per sync |
| `PROXY_URL` | (vuoto) | URL proxy (es. `http://user:pass@host:port`) |
| `PROXY_USERNAME` / `PROXY_PASSWORD` | (vuoto) | Credenziali proxy |
| `APOLLO_API_KEY` | (vuoto) | API key Apollo.io per enrichment |
| `HUNTER_API_KEY` | (vuoto) | API key Hunter.io per email |
| `CLEARBIT_API_KEY` | (vuoto) | API key Clearbit |
| `OPENAI_API_KEY` | (vuoto) | Per scoring AI |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | (vuoto) | Cloud sync |
| `IP_REPUTATION_API_KEY` | (vuoto) | AbuseIPDB per check proxy |
| `SESSION_COOKIE_MAX_AGE_DAYS` | 7 | Soglia cookie scaduti |

### Tabelle DB Coinvolte
| Tabella | Operazione | Descrizione |
|---|---|---|
| `leads` | SELECT, INSERT, UPDATE | Lead principali — insert nuovi, update esistenti |
| `salesnav_lists` | SELECT, INSERT, UPDATE | Liste SalesNav — traccia last_synced_at |
| `daily_stats` | SELECT, INCREMENT | Stats giornaliere (invites_sent, etc.) |
| `runtime_flags` | SELECT | Quarantina, pausa, etc. |
| `lead_campaign_configs` | SELECT | Config per-lista (cap, priorità) |

### Report Finale
```
────────────────────────────────────────────────────────────────
  REPORT: SYNC-LIST
────────────────────────────────────────────────────────────────
  Status:    COMPLETATO / FALLITO
  Durata:    Xm Xs

  Lista                        (nome o "tutte")
  Pagine Visitate              N
  Candidati Trovati            N
  Candidati Unici              N
  Inseriti                     N
  Aggiornati                   N
  Invariati                    N
  Errori                       N
  Enrichment Completati        N
  Promossi Ready Invite        N
  Cloud Sync                   N

  Prossima azione: Esegui 'send-invites --list "X"' per invitare i lead pronti
────────────────────────────────────────────────────────────────
```

### Dipendenze con altri workflow
- **Output → send-invites**: I lead promossi a READY_INVITE sono pronti per send-invites
- **Output → send-messages** (indiretto): Dopo inviti accettati, i lead vanno in ACCEPTED → READY_MESSAGE

---

## 2. SYNC-SEARCH

### Comando
```
.\bot.ps1 sync-search [--search-name "Nome"] --list "Lista Target" [--max-pages 10] [--limit 100] [--dry-run] [--no-proxy] [--account <id>] [--skip-preflight] [--no-enrich]
```

### Catena File
```
index.ts
  └─ cli/commands/workflowCommands.ts → runSyncSearchCommand()
      └─ workflows/syncSearchWorkflow.ts → runSyncSearchWorkflow()
          ├─ workflows/preflight.ts → runPreflight() [stessa catena di sync-list]
          ├─ core/repositories.ts → getAutomationPauseState(), getRuntimeFlag()
          ├─ accountManager.ts → getAccountProfileById()
          ├─ STEP 1: Browser + Bulk Save
          │   ├─ browser.ts → launchBrowser(), closeBrowser(), checkLogin()
          │   └─ salesnav/bulkSaveOrchestrator.ts → runSalesNavBulkSave()
          │       ├─ salesnav/computerUse.ts (click, scroll, type su SalesNav)
          │       ├─ salesnav/searchParser.ts (parsing risultati ricerca)
          │       ├─ browser/humanBehavior.ts
          │       └─ core/repositories/ (checkpoint/resume, insert lead)
          ├─ STEP 2: Sync Lista (enrichment)
          │   └─ core/salesNavigatorSync.ts → runSalesNavigatorListSync()
          │       [stessa catena di sync-list]
          └─ workflows/reportFormatter.ts → formatWorkflowReport()
```

### Domande Preflight
| # | ID | Prompt | Tipo | Default |
|---|---|---|---|---|
| 1 | `searchName` | Ricerche salvate (vuoto = tutte) | string | (vuoto) |
| 2 | `list` | Nome della lista target | string | config `SALESNAV_SYNC_LIST_NAME` |
| 3 | `maxPages` | Pagine massime per ricerca? | number | 10 |
| 4 | `limit` | Limite lead da aggiungere? | number | 100 |
| 5 | `enrichment` | Vuoi enrichment profondo? | boolean | true |

### Checklist Anti-Ban
Stessa di sync-list (CHECKLIST_SCRAPING — 4 domande).

### Controlli/Warning Preflight
| Controllo | Livello | Quando scatta |
|---|---|---|
| Proxy non configurato | **CRITICAL** | Scraping SalesNav senza proxy |
| Proxy IP blacklisted | **CRITICAL** | IP abuse score alto |
| Lista già ha lead | INFO | Lista target già popolata |
| Cookie scaduti | WARN | Sessione vecchia |
| Nessun login | **CRITICAL** | Mai loggato |
| Risk STOP | **BLOCCA** | Score > 60 |

### Guard Post-Preflight
- **Quarantina** → BLOCCA (prima di launchBrowser)
- **Pausa** → BLOCCA (prima di launchBrowser)

### Config .env Rilevanti
Stesse di sync-list, più:
| Variabile | Default | Descrizione |
|---|---|---|
| `SALESNAV_SYNC_ACCOUNT_ID` | (vuoto) | Account per bulk save |

### Tabelle DB Coinvolte
| Tabella | Operazione | Descrizione |
|---|---|---|
| `leads` | SELECT, INSERT, UPDATE | Lead da ricerche salvate |
| `salesnav_lists` | SELECT, INSERT, UPDATE | Lista target |
| `salesnav_searches` | SELECT, INSERT | Ricerche salvate trovate |
| `salesnav_checkpoints` | SELECT, INSERT, UPDATE | Resume dopo interruzione |
| `daily_stats` | SELECT | Stats giornaliere |
| `runtime_flags` | SELECT | Quarantina, pausa |

### Flusso 2-Step
1. **Step 1 — Bulk Save** (con browser aperto):
   - Apre browser → login check → naviga SalesNav → trova ricerche salvate
   - Per ogni ricerca: scansiona pagine → salva profili nella lista target
   - Supporta **checkpoint/resume** (se interrotto, riprende dall'ultimo checkpoint)
   - Chiude browser

2. **Step 2 — Sync Lista** (se Step 1 OK e non dry-run):
   - Chiama `runSalesNavigatorListSync` sulla lista target
   - Usa **maxPages e limit scelti dall'utente** (non i default config)
   - Enrichment + scoring + cloud sync

### Report Finale
Include dati di ENTRAMBI gli step:
- Ricerche trovate, challenge, lead inseriti/aggiornati, enrichment completati, promossi READY_INVITE

### Dipendenze
- **Output → send-invites**: Lead promossi a READY_INVITE
- **Chiamato DA send-invites**: Quando non ci sono READY_INVITE, send-invites propone sync-search come fallback

---

## 3. SEND-INVITES

### Comando
```
.\bot.ps1 send-invites [--list "Nome"] [--note ai|template|none] [--min-score 30] [--limit 10] [--dry-run] [--account <id>] [--skip-preflight]
```

### Catena File
```
index.ts
  └─ cli/commands/workflowCommands.ts → runSendInvitesCommand()
      └─ workflows/sendInvitesWorkflow.ts → runSendInvitesWorkflow()
          ├─ workflows/preflight.ts → runPreflight() [con CHECKLIST_OUTREACH]
          ├─ core/repositories.ts → getAutomationPauseState(), getRuntimeFlag()
          ├─ Pre-enrichment parallelo (zero browser):
          │   └─ integrations/parallelEnricher.ts → enrichLeadsParallel()
          │       ├─ integrations/apolloClient.ts
          │       ├─ integrations/hunterClient.ts
          │       └─ integrations/clearbitClient.ts
          ├─ core/orchestrator.ts → runWorkflow({ workflow: 'invite' })
          │   ├─ risk/riskEngine.ts (ban probability, compliance health, cooldown)
          │   ├─ risk/incidentManager.ts (quarantine, pause)
          │   ├─ ai/guardian.ts → evaluateAiGuardian() [AI preemptive safety]
          │   ├─ core/scheduler.ts → scheduleJobs('invite')
          │   │   ├─ Budget: softInviteCap → hardInviteCap → weeklyLimit → SSI → mood → warmup → trust → growth
          │   │   ├─ core/repositories/ → getLeadsByStatusForList('READY_INVITE')
          │   │   ├─ blacklist check per ogni lead
          │   │   ├─ multi-account deconfliction (30 giorni)
          │   │   ├─ timing optimizer (slot orario ottimale)
          │   │   └─ no-burst planner (delay tra job)
          │   ├─ core/jobRunner.ts → runQueuedJobs()
          │   │   ├─ browser.ts → launchBrowser() per ogni account
          │   │   ├─ browser/sessionCookieMonitor.ts (anomaly detection)
          │   │   ├─ browser/humanBehavior.ts (blockUserInput, humanDelay, humanType)
          │   │   ├─ probeLinkedInStatus() (pre-sessione)
          │   │   ├─ core/sessionWarmer.ts → warmupSession() [nella stessa sessione browser]
          │   │   ├─ workers/inviteWorker.ts → processInviteJob()
          │   │   │   ├─ browser/navigationContext.ts → navigateToProfileForInvite()
          │   │   │   ├─ ai/inviteNotePersonalizer.ts → buildPersonalizedInviteNote()
          │   │   │   │   ├─ Template pool (IT/EN/FR/ES) + AI personalizzazione
          │   │   │   │   ├─ ml/variantSelector.ts (A/B testing varianti)
          │   │   │   │   └─ OpenAI API (se noteMode=ai)
          │   │   │   ├─ browser/humanBehavior.ts (click, type, scroll)
          │   │   │   └─ selectors/ (bottone Connect, modale invito, textbox nota)
          │   │   ├─ workers/followUpWorker.ts (follow-up post-job)
          │   │   ├─ Decoy burst, coffee break, wind-down (anti-pattern)
          │   │   ├─ Session rotation (ogni N job o N minuti)
          │   │   └─ risk/sessionMemory.ts → recordSessionPattern()
          │   ├─ core/audit.ts → runSiteCheck() [post-run state sync]
          │   └─ sync/eventSync.ts → runEventSyncOnce() [push eventi a cloud]
          ├─ core/repositories.ts → getDailyStat(), getListDailyStatsBatch()
          ├─ core/repositories.ts → computeListPerformanceMultiplier()
          └─ workflows/reportFormatter.ts → formatWorkflowReport()
```

### Domande Preflight
| # | ID | Prompt | Tipo | Default |
|---|---|---|---|---|
| 1 | `list` | Da quale lista vuoi invitare? (vuoto = tutte) | string | (vuoto) |
| 2 | `noteMode` | Modalità nota invito | choice: ai/template/none | `ai` |
| 3 | `minScore` | Score minimo per invitare? | number | 30 |
| 4 | `limit` | Limite inviti per questa sessione? | number | config `HARD_INVITE_CAP` |
| 5 | `dryRun` | Dry run (mostra senza invitare)? | boolean | false |

### Checklist Anti-Ban (CHECKLIST_OUTREACH — più rigorosa)
1. "Hai chiuso TUTTI gli altri tab/finestre di LinkedIn?" → **BLOCCANTE**
2. "Sono passate almeno 2 ore dall'ultima sessione manuale su LinkedIn?" → suggerimento
3. "Il VPN/Proxy è lo stesso della sessione precedente?" → suggerimento
4. "Sai che NON devi cliccare nella finestra del browser automatizzato?" → **BLOCCANTE**
5. "Sai che per chiudere devi usare Ctrl+C (MAI chiudere la finestra)?" → **BLOCCANTE**

### Controlli/Warning Preflight
| Controllo | Livello | Quando scatta |
|---|---|---|
| 0 lead READY_INVITE | **CRITICAL** | Nessun lead pronto → propone fallback sync-search |
| Budget giornaliero esaurito | **CRITICAL** | invitesSentToday >= hardInviteCap |
| Budget giornaliero quasi esaurito | WARN | < 5 rimanenti |
| Budget SETTIMANALE esaurito | **CRITICAL** | weeklyInvitesSent >= weeklyInviteLimit |
| Budget settimanale quasi esaurito | WARN | < 10 rimanenti |
| Warmup attivo | INFO | Account in fase warmup |
| AI non configurata + noteMode=ai | WARN | Fallback a template |
| Lead senza job_title | INFO | > 5 lead senza company/job_title |
| Dati obsoleti (> 7 giorni) | WARN | lastSyncAt > 7 giorni fa |
| Nessun sync registrato | INFO | lastSyncAt null |
| Proxy blacklisted | **CRITICAL** | IP abuse score alto |
| Cookie scaduti | WARN | Sessione vecchia |
| Nessun login | **CRITICAL** | Mai loggato |
| Risk STOP | **BLOCCA** | Score > 60 |

### Guard Post-Preflight
- **Quarantina** → BLOCCA (solo se non dry-run)
- **Pausa** → BLOCCA (solo se non dry-run)

### Fallback Automatico
Se 0 lead READY_INVITE e TTY interattivo:
1. Chiede "Vuoi estrarre nuovi lead da SalesNav?"
2. Se sì → chiede nome ricerca + lista target
3. Chiama `runSyncSearchWorkflow()` con skipPreflight=true

### Graceful Degradation
Se pre-enrichment fallisce per > 80% dei lead e noteMode=ai:
- Auto-downgrade: `ai → template`
- Warning visibile all'utente

### Config .env Rilevanti
| Variabile | Default | Descrizione |
|---|---|---|
| `SOFT_INVITE_CAP` | 15 | Budget inviti "soft" (target giornaliero) |
| `HARD_INVITE_CAP` | 25 | Budget inviti "hard" (massimo assoluto) |
| `WEEKLY_INVITE_LIMIT` | 80 | Limite inviti settimanali |
| `INVITE_WITH_NOTE` | false | Inviare inviti con nota |
| `INVITE_NOTE_MODE` | template | Modalità nota (ai/template) |
| `PROXY_URL` | (vuoto) | Proxy |
| `OPENAI_API_KEY` | (vuoto) | Per nota AI personalizzata |
| `AI_MODEL` | llama3.1:8b | Modello AI |
| `APOLLO_API_KEY` | (vuoto) | Pre-enrichment |
| `HUNTER_API_KEY` | (vuoto) | Pre-enrichment |
| `SESSION_COOKIE_MAX_AGE_DAYS` | 7 | Soglia cookie |
| `COMPLIANCE_DYNAMIC_WEEKLY_LIMIT_ENABLED` | false | Budget settimanale dinamico |
| `SSI_DYNAMIC_LIMITS_ENABLED` | false | Cap basato su SSI score |
| `GROWTH_MODEL_ENABLED` | false | Budget per fase account |
| `WARMUP_ENABLED` | false | Riscaldamento graduale |

### Tabelle DB Coinvolte
| Tabella | Operazione | Descrizione |
|---|---|---|
| `leads` | SELECT, UPDATE | Lead READY_INVITE → INVITED |
| `jobs` | INSERT, UPDATE | Job INVITE in coda |
| `job_attempts` | INSERT | Tentativi per job |
| `daily_stats` | SELECT, INCREMENT | invites_sent, run_errors, challenges_count, selector_failures |
| `list_daily_stats` | SELECT, INCREMENT | Stats per-lista |
| `runtime_flags` | SELECT, UPDATE | Quarantina, pausa, browser_session_started_at |
| `outbox_events` | INSERT | Eventi per cloud sync |
| `session_patterns` | INSERT/UPDATE | Memoria sessione per pacing |
| `account_health_snapshots` | INSERT | Health per account |
| `lead_campaign_configs` | SELECT | Config per-lista |
| `blacklist` | SELECT | Check blacklist per lead |
| `incidents` | INSERT | Se challenge o errore grave |

### Pipeline Budget Inviti (ordine di applicazione)
```
1. softInviteCap / hardInviteCap (config statica)
2. × SSI dynamic cap (se SSI_DYNAMIC_LIMITS_ENABLED)
3. × warmup factor (se WARMUP_ENABLED, basato su età account)
4. × growth model (se GROWTH_MODEL_ENABLED, basato su fase)
5. × trust score multiplier (acceptance rate, challenges, pending ratio)
6. min(budget, weeklyRemaining)
7. × hour intensity (fascia oraria lavorativa)
8. × green mode factor (se attivo)
9. × session budget factor (two-session mode)
10. × cookie maturity factor (sessione fresca = budget ridotto)
11. × session pacing factor (basato su storia 7 giorni)
12. × weekly strategy factor (per giorno della settimana)
13. × mood factor (±20% deterministico per data)
14. × ratio shift (sbilancio invite vs message)
15. min(budget, sessionLimit) se specificato
16. Per-lista: × adaptive factor (pending ratio, blocked ratio)
17. Per-lista: × list performance multiplier (acceptance rate storico)
```

### Report Finale
```
  REPORT: SEND-INVITES
  Status:    COMPLETATO / FALLITO
  Inviti Inviati             N
  Budget Utilizzato          N/HARD_CAP
  Budget Rimanente           N
  Score Minimo               30
  Nota Modalita              ai
  Dry Run                    no

  PER-LISTA:
    lista1               inv:5 msg:0 acc:45.2%
    lista2               inv:3 msg:0 acc:12.1% [SOTTO]

  [OK] Risk: GO (score: 15/100)

  Prossima azione: Budget rimanente: N inviti. Esegui 'send-messages'...
```

### Dipendenze
- **Input ← sync-list / sync-search**: Serve lead READY_INVITE
- **Output → send-messages**: Lead INVITED → ACCEPTED → READY_MESSAGE
- **Chiama sync-search**: Come fallback se 0 READY_INVITE

---

## 4. SEND-MESSAGES

### Comando
```
.\bot.ps1 send-messages [--list "Nome"] [--lang en|it|fr|es|nl] [--limit 10] [--dry-run] [--account <id>] [--skip-preflight]
```

### Catena File
```
index.ts
  └─ cli/commands/workflowCommands.ts → runSendMessagesCommand()
      └─ workflows/sendMessagesWorkflow.ts → runSendMessagesWorkflow()
          ├─ workflows/preflight.ts → runPreflight() [CHECKLIST_OUTREACH]
          ├─ core/repositories.ts → getAutomationPauseState(), getRuntimeFlag()
          ├─ core/orchestrator.ts → runWorkflow({ workflow: 'message' })
          │   ├─ [stessa catena di send-invites per orchestrator/scheduler/jobRunner]
          │   ├─ core/scheduler.ts → scheduleJobs('message')
          │   │   ├─ getLeadsByStatusForList('ACCEPTED') → transitionLead → 'READY_MESSAGE'
          │   │   ├─ getLeadsByStatusForList('READY_MESSAGE')
          │   │   ├─ delay post-acceptance (MESSAGE_SCHEDULE_MIN/MAX_DELAY_HOURS)
          │   │   └─ metadata_json con { lang } per ogni job
          │   └─ workers/messageWorker.ts → processMessageJob()
          │       ├─ Priorità generazione messaggio:
          │       │   1. core/repositories/prebuiltMessages.ts → getUnusedPrebuiltMessage()
          │       │   2. ai/messagePersonalizer.ts → buildPersonalizedFollowUpMessage()
          │       │      └─ OpenAI API (con dati lead arricchiti + lang)
          │       │   3. Template fallback (se AI non disponibile)
          │       ├─ validation/messageValidator.ts → validateMessageContent()
          │       │   └─ Check duplicati (hash messaggio ultimi 24h)
          │       ├─ browser/navigationContext.ts → navigateToProfileForMessage()
          │       ├─ browser/humanBehavior.ts (click Message, type, send)
          │       └─ selectors/ (messageButton, messageTextbox, messageSendButton)
          └─ workflows/reportFormatter.ts → formatWorkflowReport()
```

### Domande Preflight
| # | ID | Prompt | Tipo | Default |
|---|---|---|---|---|
| 1 | `list` | Da quale lista vuoi messaggiare? (vuoto = tutte) | string | (vuoto) |
| 2 | `lang` | Lingua preferita | choice: it/en/fr/es/nl | `en` |
| 3 | `limit` | Limite messaggi per questa sessione? | number | config `HARD_MSG_CAP` |
| 4 | `dryRun` | Dry run (mostra senza inviare)? | boolean | false |

### Checklist Anti-Ban
Stessa di send-invites (CHECKLIST_OUTREACH — 5 domande).

### Controlli/Warning Preflight
| Controllo | Livello | Quando scatta |
|---|---|---|
| 0 lead ACCEPTED/READY_MESSAGE | **CRITICAL** | Nulla da messaggiare (contestualizzato se lista filtrata) |
| Budget messaggi esaurito | **CRITICAL** | messagesSentToday >= hardMsgCap |
| Budget messaggi quasi esaurito | WARN | < 5 rimanenti |
| AI non configurata | WARN | Messaggi generici |
| Lead senza job_title (> 30%) | INFO | Messaggi generici per questi |
| Dati obsoleti (> 7 giorni) | WARN | lastSyncAt > 7 giorni fa |
| Proxy blacklisted | **CRITICAL** | IP abuse score alto |
| Cookie scaduti | WARN | Sessione vecchia |
| Nessun login | **CRITICAL** | Mai loggato |
| Risk STOP | **BLOCCA** | Score > 60 |

### Guard Post-Preflight
- **Quarantina** → BLOCCA (solo se non dry-run)
- **Pausa** → BLOCCA (solo se non dry-run)

### Config .env Rilevanti
| Variabile | Default | Descrizione |
|---|---|---|
| `SOFT_MSG_CAP` | 20 | Budget messaggi "soft" |
| `HARD_MSG_CAP` | 35 | Budget messaggi "hard" (massimo assoluto) |
| `MESSAGE_SCHEDULE_MIN_DELAY_HOURS` | 0 | Delay minimo post-acceptance prima del messaggio |
| `MESSAGE_SCHEDULE_MAX_DELAY_HOURS` | 0 | Delay massimo post-acceptance |
| `OPENAI_API_KEY` | (vuoto) | Per messaggi AI personalizzati |
| `AI_MODEL` | llama3.1:8b | Modello AI |
| `PROXY_URL` | (vuoto) | Proxy |
| `FOLLOW_UP_DELAY_DAYS` | 5 | Giorni prima del follow-up |
| `FOLLOW_UP_QUESTIONS_DELAY_DAYS` | 3 | Follow-up con domande |
| `FOLLOW_UP_MAX_PER_DAY` | 5 | Max follow-up al giorno |

### Tabelle DB Coinvolte
| Tabella | Operazione | Descrizione |
|---|---|---|
| `leads` | SELECT, UPDATE | ACCEPTED → READY_MESSAGE → MESSAGED |
| `jobs` | INSERT, UPDATE | Job MESSAGE in coda |
| `job_attempts` | INSERT | Tentativi |
| `daily_stats` | SELECT, INCREMENT | messages_sent |
| `prebuilt_messages` | SELECT, UPDATE | Messaggi pre-generati offline |
| `message_hashes` | SELECT, INSERT | Dedup messaggi (ultimi 24h) |
| `runtime_flags` | SELECT | Quarantina, pausa |
| `outbox_events` | INSERT | Cloud sync |

### Logica Generazione Messaggio
```
1. Cerca prebuilt message (generato offline dal loop, zero latenza)
   └─ Se trovato → usa quello (source: 'ai' o 'template')
2. Se non prebuilt → AI on-the-fly
   └─ buildPersonalizedFollowUpMessage(lead, lang)
       ├─ Dati lead: nome, job_title, company, about, experience
       ├─ Lingua: dal payload metadata_json.lang
       └─ Modello: config AI_MODEL via OpenAI API
3. Se AI fallisce → template statico
   └─ Template generico basato su lingua
4. Validazione messaggio:
   ├─ Lunghezza (min/max caratteri)
   ├─ Contenuto (no spam keywords)
   └─ Dedup (hash vs ultimi 24h)
5. Se validazione fallisce → lead → BLOCKED
```

### Dipendenze
- **Input ← send-invites**: Serve lead ACCEPTED/READY_MESSAGE (post-accettazione invito)
- **Input ← run-loop**: Il message prebuild worker pre-genera messaggi offline

---

## 5. RUN-LOOP / AUTOPILOT

### Comandi
```
.\bot.ps1 run-loop [all|invite|check|message|warmup] [intervalSec] [--cycles N] [--dry-run] [--account <id>]
.\bot.ps1 autopilot [intervalSec] [--cycles N] [--dry-run]
```

### Catena File
```
index.ts
  └─ cli/commands/loopCommand.ts → runLoopCommand() / runAutopilotCommand()
      ├─ Lock distribuito: acquireWorkflowRunnerLock()
      ├─ Telegram: startTelegramListener()
      ├─ Config hot-reload: startConfigWatcher()
      ├─ Login jitter (0-30 min random prima del primo ciclo)
      ├─ Alert Telegram "Bot avviato"
      └─ CICLO WHILE(true):
          ├─ Working Hours Guard (skip se fuori orario)
          ├─ startCampaignRun()
          ├─ buildLoopSubTasks() → lista di 17+ sub-task:
          │
          │   1. lock_heartbeat → heartbeatWorkflowRunnerLock()
          │   2. cloud_commands → processCloudCommands()
          │      └─ cloud/telegramAiImporter.ts
          │   3. control_plane_sync → cloud/controlPlaneSync.ts
          │   4. doctor_gate → core/doctor.ts → runDoctor()
          │      ├─ Check login, quarantina, compliance, DB integrity
          │      └─ Se fallisce → skip intero ciclo
          │   5. session_freshness → browser/sessionCookieMonitor.ts
          │   6. auto_site_check → core/audit.ts → runSiteCheck()
          │   7. salesnav_sync → core/salesNavigatorSync.ts
          │   8. auto_backup → db.ts → backupDatabase()
          │   9. ssi_scrape → browser/ssiScraper.ts
          │  10. dead_letter_queue → workers/deadLetterWorker.ts
          │  11. privacy_cleanup → core/repositories/system.ts
          │  12. daily_report → telemetry/dailyReporter.ts
          │  13. company_enrichment → core/companyEnrichment.ts
          │  14. ramp_up → workers/rampUpWorker.ts
          │  15. selector_learner → selectors/learner.ts
          │  16. campaign_dispatch → core/campaignEngine.ts
          │  17. message_prebuild → workers/messagePrebuildWorker.ts
          │  18. WORKFLOW PRINCIPALE → core/orchestrator.ts → runWorkflow()
          │      [stessa catena di send-invites/send-messages]
          │  19. random_activity → workers/randomActivityWorker.ts
          │  20. plugin_idle → plugins/pluginLoader.ts
          │  21+. Plugin-contributed sub-tasks
          │
          ├─ core/loopOrchestrator.ts → runLoopCycle()
          ├─ finishCampaignRun()
          ├─ Inter-cycle jitter (±20% sull'intervallo)
          └─ sleepWithLockHeartbeat()
```

### Nessun Preflight Interattivo
Il run-loop **NON** ha preflight interattivo. I controlli sono:
- **Mandatory preflight** (in index.ts): `runDoctor()` all'avvio se non `--skip-preflight`
- **Doctor gate**: Ad ogni ciclo, verifica login/quarantina/compliance
- **Working hours**: Skip ciclo se fuori orario

### Config .env Rilevanti
| Variabile | Default | Descrizione |
|---|---|---|
| `WORKFLOW_LOOP_INTERVAL_MS` | 900000 (15 min) | Intervallo base tra cicli |
| `HOUR_START` | 9 | Inizio orario lavorativo |
| `HOUR_END` | 18 | Fine orario lavorativo |
| `TZ` | Europe/Rome | Timezone per orario |
| `PROCESS_MAX_UPTIME_HOURS` | 12 | Auto-restart dopo N ore |
| Tutte le config di send-invites e send-messages | | |
| `SALESNAV_SYNC_ENABLED` | false | Sync automatico SalesNav nel loop |
| `SALESNAV_SYNC_INTERVAL_HOURS` | 24 | Ogni quante ore sync SalesNav |
| `AUTO_SITE_CHECK_ENABLED` | true | Site-check automatico |
| `AUTO_SITE_CHECK_INTERVAL_HOURS` | 12 | Ogni quante ore site-check |
| `RANDOM_ACTIVITY_ENABLED` | true | Attività random LinkedIn |
| `RANDOM_ACTIVITY_PROBABILITY` | 0.3 | Probabilità per ciclo |
| `DAILY_REPORT_AUTO_ENABLED` | true | Report giornaliero auto |
| `DAILY_REPORT_HOUR` | 20 | Ora invio report |
| `TELEGRAM_BOT_TOKEN` | (vuoto) | Per alert + comandi |
| `TELEGRAM_CHAT_ID` | (vuoto) | Chat Telegram |
| `SUPABASE_CONTROL_PLANE_ENABLED` | false | Config remota da Supabase |
| `MULTI_ACCOUNT_ENABLED` | false | Modalità multi-account |

### Tabelle DB Coinvolte
Tutte le tabelle di send-invites + send-messages, più:
| Tabella | Operazione | Descrizione |
|---|---|---|
| `runtime_locks` | INSERT, UPDATE, DELETE | Lock distribuito runner |
| `campaign_runs` | INSERT, UPDATE | Tracciamento cicli |
| `daily_stats` | SELECT (snapshot pre/post) | Delta per ciclo |
| `session_patterns` | INSERT/UPDATE | Memoria sessione |

### Sub-Task e Frequenza
| Sub-Task | Frequenza | Condizione |
|---|---|---|
| lock_heartbeat | ogni ciclo | sempre |
| cloud_commands | ogni ciclo | non dry-run |
| control_plane_sync | ogni ciclo | SUPABASE_CONTROL_PLANE_ENABLED |
| doctor_gate | ogni ciclo | sempre (BLOCCA se fallisce) |
| session_freshness | ogni ciclo | non dry-run |
| auto_site_check | ogni N ore | AUTO_SITE_CHECK_ENABLED |
| salesnav_sync | ogni N ore | SALESNAV_SYNC_ENABLED + workflow invite/all |
| auto_backup | 1/giorno | leader only |
| ssi_scrape | 1/settimana | SSI_DYNAMIC_LIMITS_ENABLED, leader only |
| dead_letter_queue | ogni 6h | leader only |
| privacy_cleanup | 1/giorno | leader only |
| daily_report | 1/giorno all'ora config | DAILY_REPORT_AUTO_ENABLED, leader only |
| company_enrichment | ogni ciclo | COMPANY_ENRICHMENT_ENABLED + workflow invite/all |
| ramp_up | ogni ciclo | RAMP_UP_ENABLED |
| selector_learner | 1/giorno | non dry-run |
| campaign_dispatch | ogni ciclo | non dry-run |
| message_prebuild | ogni ciclo | workflow message/all |
| **workflow** | ogni ciclo | **SEMPRE** (il core) |
| random_activity | probabilistico | RANDOM_ACTIVITY_ENABLED |
| plugin_idle | ogni ciclo | plugin registrati |

### Comandi Telegram
| Comando | Effetto |
|---|---|
| `pausa [minuti]` | Mette in pausa l'automazione |
| `riprendi` / `resume` | Riprende l'automazione |
| `restart` | Riavvia il processo (exit 0) |
| `importa <url>` | AI Extractor su URL |
| `funnel` / `status` | Report stato via Telegram |

### Protezioni Anti-Ban nel Loop
| Protezione | Descrizione |
|---|---|
| Login jitter | 0-30 min random prima del primo ciclo |
| Inter-cycle jitter | ±20% sull'intervallo tra cicli |
| Working hours | Zero attività fuori HOUR_START-HOUR_END |
| Intervallo minimo | 300 secondi (5 min) forzato |
| Session memory | Pacing factor adattivo 7 giorni |
| Mood factor | ±20% budget deterministico per data |
| Two-session mode | 2 sessioni corte vs 1 lunga |
| Wind-down | Rallenta nell'ultimo 20% sessione |
| Coffee break | Pausa random ogni N job |
| Decoy burst | Attività fake random tra job |
| Session rotation | Nuovo browser ogni N job/minuti |
| Memory protection | Max job/durata per sessione (jittered) |

### Dipendenze
- **Contiene TUTTI i workflow**: invite, check, message, warmup, all
- **Contiene sub-task autonomi**: salesnav_sync, site-check, enrichment, backup, etc.
- **Multi-account**: Processa account in sequenza con gap 2-5 min

---

## MAPPA DIPENDENZE TRA WORKFLOW

```
sync-search ──────┐
                   │
sync-list ─────────┤──→ lead READY_INVITE ──→ send-invites
                   │                              │
                   │    ┌─── fallback ◄────────────┘
                   │    │
                   │    └──→ sync-search (se 0 READY_INVITE)
                   │
                   └──→ lead INVITED ──→ [LinkedIn accetta] ──→ ACCEPTED
                                                                   │
                                                           ──→ READY_MESSAGE ──→ send-messages
                                                                                      │
                                                                                      └──→ MESSAGED

run-loop ──→ orchestra TUTTI i workflow + sub-task automatici
```

### Stato Lead (lifecycle)
```
NEW → READY_INVITE → INVITED → ACCEPTED → READY_MESSAGE → MESSAGED → REPLIED
                        │                                              → CONNECTED
                        │         
                        └──→ WITHDRAWN (dopo 30 giorni senza risposta)
                        └──→ BLOCKED (blacklist, validazione, errore)
                        └──→ SKIPPED (filtro score, deconfliction)
                        └──→ DEAD (irrecuperabile)
                        └──→ REVIEW_REQUIRED (dead letter)
```
