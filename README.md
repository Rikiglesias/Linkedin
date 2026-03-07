# LinkedIn Bot — Documentazione Completa

Piattaforma di automazione LinkedIn B2B enterprise-grade. Gestisce l'intero funnel di outreach (invite → accept → message → drip follow-up) con un motore stealth a 14 strati, risk engine adattivo, A/B testing, AI guardian, CAPTCHA solver, e dashboard realtime.

---

## Indice

1. [Architettura](#architettura)
2. [Quick Start](#quick-start)
3. [Comandi CLI](#comandi-cli)
4. [Struttura del progetto](#struttura-del-progetto)
5. [State machine dei lead](#state-machine-dei-lead)
6. [Anti-detection — 14 strati](#anti-detection--14-strati)
7. [Database — SQLite / PostgreSQL](#database--sqlite--postgresql)
8. [Configurazione .env](#configurazione-env)
9. [Multi-account](#multi-account)
10. [Drip campaigns](#drip-campaigns)
11. [Risk Engine](#risk-engine)
12. [Proxy e rete](#proxy-e-rete)
13. [Cloud sync (Supabase)](#cloud-sync-supabase)
14. [Bot Telegram](#bot-telegram)
15. [AI Layer](#ai-layer)
16. [Sicurezza dashboard](#sicurezza-dashboard)
17. [Testing](#testing)
18. [Deploy](#deploy)
19. [CI/CD](#cicd)

---

## Architettura

```
╔══════════════════════════════════════════════════════════════════╗
║                        CONTROL PLANE                            ║
║   Telegram Bot ◄──► Dashboard (Express + Vanilla TS) ◄──► .env  ║
╚══════════════════════════╤═══════════════════════════════════════╝
                           │
╔══════════════════════════▼═══════════════════════════════════════╗
║                      CORE ENGINE                                ║
║                                                                  ║
║  Scheduler ──► Orchestrator ──► JobRunner                       ║
║      │              │               │                            ║
║   Budget         Risk Engine     AI Guardian                     ║
║   SSI/ramp       composite 0-100  OpenAI + heuristic             ║
║   NoBurst        quarantine        pre-run safety                ║
║   BayesianTiming cooldown                                        ║
║      │              │                                            ║
║   ┌──▼──────────────▼─────────────────────────────┐             ║
║   │           WORKERS                              │             ║
║   │  InviteWorker   MessageWorker   AcceptanceW.   │             ║
║   │  FollowUpWorker EnrichWorker    DripCampaign    │             ║
║   └──────────────────────┬──────────────────────── ┘             ║
╚═════════════════════════╤╧══════════════════════════════════════╝
                          │
╔═════════════════════════▼══════════════════════════════════════╗
║                  STEALTH BROWSER (Playwright)                   ║
║                                                                 ║
║  launcher.ts ──► stealth.ts ──► stealthScripts.ts (14 layers)  ║
║       │               │                                         ║
║   fingerprint      WebGL/Canvas      humanBehavior.ts           ║
║   DoH flags        Perlin noise      mouseGenerator.ts          ║
║   proxy inject     JA3/TLS spoof     organicContent.ts          ║
║       │                              bimodal keystroke          ║
║   selfHealingSelectors               tab visibility sim         ║
║   visionCaptchaSolver (LLaVA)                                   ║
╚════════════════════════════════════════════════════════════════╝
                          │
╔═════════════════════════▼══════════════════════════════════════╗
║                    PERSISTENCE LAYER                            ║
║   SQLite (dev) / PostgreSQL (prod)   Supabase (cloud sync)     ║
║   34 migrations auto-applied         non-blocking fire&forget  ║
╚════════════════════════════════════════════════════════════════╝
```

---

## Quick Start

```bash
# 1. Installa dipendenze
npm install

# 2. Configura ambiente
cp .env.example .env
# Edita .env con le tue credenziali LinkedIn e configurazioni

# 3. Crea il profilo browser (login manuale una sola volta)
npm run create-profile
# Si apre Chromium: effettua login, completa eventuali 2FA, chiudi la finestra

# 4. Avvia la dashboard
npm run dashboard:dev
# Dashboard disponibile su http://localhost:3000

# 5. Avvia il bot in loop continuo
npm run start:dev -- run-loop
```

> **Nota proxy**: Prima di avviare in produzione configura `PROXY_URL`, `PROXY_USERNAME`, `PROXY_PASSWORD` nel `.env`. Senza proxy residenziale/mobile il rischio di ban è elevato.

---

## Comandi CLI

### Esecuzione bot

| Comando | Descrizione |
|---------|-------------|
| `npm run start:dev -- run-loop` | Loop continuo: esegue job finché ci sono lead da processare |
| `npm run start:dev -- run-once` | Esegue un singolo ciclo di job e termina |
| `npm run start:dev -- dry-run` | Simulazione completa senza azioni reali su LinkedIn |
| `npm run start:dev -- run-invite` | Solo worker inviti (salta messaggi e follow-up) |
| `npm run start:dev -- run-message` | Solo worker messaggi (solo lead già ACCEPTED) |

### Setup e gestione

| Comando | Descrizione |
|---------|-------------|
| `npm run create-profile` | Crea il profilo browser Chromium con sessione persistente |
| `npm run start:dev -- doctor` | Diagnostica completa: DB, proxy, selettori, config, rete |
| `npm run start:dev -- canary` | Test rapido selettori LinkedIn (verifica se la UI è cambiata) |
| `npm run start:dev -- status` | Stato attuale: lead in coda, budget rimanente, rischio |

### Lead e campagne

| Comando | Descrizione |
|---------|-------------|
| `npm run start:dev -- import-leads <file.csv>` | Importa lead da CSV (nome, url, campagna) |
| `npm run start:dev -- list-leads` | Lista lead con stato corrente |
| `npm run start:dev -- reset-lead <id>` | Resetta lead a stato NEW per retry |
| `npm run start:dev -- drip-status` | Stato delle drip campaigns attive |
| `npm run start:dev -- drip-pause <campaignId>` | Mette in pausa una campagna |
| `npm run start:dev -- drip-resume <campaignId>` | Riprende una campagna in pausa |

### Database e backup

| Comando | Descrizione |
|---------|-------------|
| `npm run db:backup` | Backup SQLite/PostgreSQL con timestamp |
| `npm run db:restore` | Restore dall'ultimo backup |
| `npm run db:restore:drill` | Drill: restore su DB temporaneo per verifica integrità |
| `npm run db:migrate` | Migrazione da SQLite a PostgreSQL |

### Dashboard e monitoraggio

| Comando | Descrizione |
|---------|-------------|
| `npm run dashboard:dev` | Dashboard + REST API su http://localhost:3000 |
| `npm run kpi` | Report KPI aggregati (acceptance rate, reply rate, ROI) |
| `npm run start:dev -- feature-store` | Ispeziona il feature store ML (segmenti, medie) |

### AI e qualità

| Comando | Descrizione |
|---------|-------------|
| `npm run ai:quality` | Pipeline di valutazione qualità messaggi AI (ROUGE, personalizzazione) |
| `npm run start:dev -- ai-guardian-test` | Testa AI guardian su un set di lead sample |

### Sicurezza e rotazione

| Comando | Descrizione |
|---------|-------------|
| `npm run security:advisor` | Report sicurezza: segreti esposti, configurazioni rischiose |
| `npm run secrets:rotate` | Rotazione automatica API keys con intervallo configurabile |

### Daemon (PM2)

| Comando | Descrizione |
|---------|-------------|
| `npm run daemon:start` | Avvia il bot come daemon PM2 |
| `npm run daemon:stop` | Ferma il daemon |
| `npm run daemon:logs` | Segui i log realtime del daemon |
| `npm run daemon:status` | Stato PM2 (uptime, restart, memoria) |

### Developer

| Comando | Descrizione |
|---------|-------------|
| `npm run build` | Compila TypeScript (backend + frontend) |
| `npm run typecheck` | Type-check senza emit |
| `npm run lint` | ESLint su tutto il progetto |
| `npm run format` | Prettier su src/ e public/ |
| `npm run docs` | Genera TypeDoc in docs/ |
| `npm run docs:config` | Genera CONFIG_REFERENCE.md da types.ts |
| `npm test` | Suite completa: vitest + integration + e2e:dry + a11y |
| `npm run ramp-up` | Ramp-up graduale del budget giornaliero |

---

## Struttura del progetto

```
linkedin/
├── src/
│   ├── index.ts                    # Entry point CLI — routing 40+ comandi
│   ├── config/
│   │   ├── index.ts                # Composizione config da .env, helper isWorkingHour
│   │   └── types.ts                # AppConfig interface (295 proprietà tipizzate)
│   ├── db.ts                       # Astrazione DB duale SQLite/PostgreSQL + query builder
│   ├── db/
│   │   └── migrations/             # 34 migration SQL (001–034), applicate all'avvio
│   ├── browser/
│   │   ├── launcher.ts             # Avvio Playwright: fingerprint, proxy, DoH, stealth
│   │   ├── stealth.ts              # Selezione profilo fingerprint + fetch API cloud
│   │   ├── stealthScripts.ts       # 14-layer JS injection (navigator, canvas, WebGL, ...)
│   │   ├── humanBehavior.ts        # Movimento mouse, typing, tab switch, organic feed
│   │   ├── organicContent.ts       # Like/reaction/expand-post su feed decoy
│   │   └── auth.ts                 # Login, cookie persistence, session restore
│   ├── ml/
│   │   ├── mouseGenerator.ts       # Traiettoria Bézier + Perlin noise + ease-out-cubic
│   │   ├── abTesting.ts            # Epsilon-greedy bandit A/B testing
│   │   ├── timingOptimizer.ts      # Ottimizzatore timing Bayesiano per segmento
│   │   └── rampModel.ts            # Modello ramp-up graduale con SSI
│   ├── core/
│   │   ├── orchestrator.ts         # Workflow principale: quarantine→AI guard→job exec
│   │   ├── scheduler.ts            # Allocazione budget, NoBurst planner, adaptive caps
│   │   ├── jobRunner.ts            # Esecuzione job con retry, timeout, circuit breaker
│   │   └── repositories/           # Data access layer (leads, campaigns, logs, system)
│   ├── workers/
│   │   ├── inviteWorker.ts         # Invite flow: navigate→read→challenge→connect→note
│   │   ├── messageWorker.ts        # Message flow: generate→validate→hash→type→send
│   │   ├── acceptanceWorker.ts     # Polling accettazioni, aggiorna stato lead
│   │   ├── followUpWorker.ts       # Follow-up automatico post-connessione
│   │   ├── enrichWorker.ts         # Arricchimento profilo lead (job title, company, ...)
│   │   └── dripCampaignWorker.ts   # Multi-step drip campaign con timing variabile
│   ├── ai/
│   │   ├── openai.ts               # Client OpenAI: note personalizzate, messaggi, scoring
│   │   ├── guardian.ts             # AI Guardian: analisi pre-run, safety check
│   │   ├── sentiment.ts            # Sentiment analysis risposta lead
│   │   ├── leadScoring.ts          # Scoring ML lead (propensity-to-connect)
│   │   └── postGenerator.ts        # Generazione contenuto post LinkedIn
│   ├── risk/
│   │   ├── riskEngine.ts           # Score composito 0–100, cooldown, quarantine, z-score
│   │   ├── incidentManager.ts      # Gestione incidenti: escalation, notifiche, recovery
│   │   └── httpThrottler.ts        # Throttle richieste HTTP in uscita
│   ├── api/
│   │   ├── server.ts               # Express server con auth, CORS, rate limiting, CSRF
│   │   └── routes/                 # REST endpoint per dashboard (leads, stats, config, ...)
│   ├── captcha/
│   │   └── visionSolver.ts         # Risoluzione CAPTCHA visivo con Ollama LLaVA
│   ├── cloud/
│   │   ├── supabase.ts             # Sync non-bloccante Supabase (fire & forget)
│   │   └── telegram.ts             # Bot Telegram: comandi, alert, import lead via /importa
│   ├── sync/
│   │   ├── backpressure.ts         # Backpressure queue per eventi cloud
│   │   └── eventSync.ts            # Sync bidirezionale Supabase/Webhook
│   ├── selectors/
│   │   └── selfHealingSelector.ts  # Auto-repair selettori LinkedIn con confidence score
│   ├── telemetry/
│   │   ├── logger.ts               # logInfo/logWarn/logError con sanitizzazione e DB log
│   │   ├── alerts.ts               # Notifiche Telegram/Discord/Slack
│   │   ├── liveEvents.ts           # SSE/WebSocket per dashboard realtime
│   │   └── dailyReport.ts          # Report giornaliero automatico via Telegram
│   ├── security/
│   │   └── redaction.ts            # Sanitizzazione log: token, password, email
│   ├── plugins/
│   │   └── pluginLoader.ts         # Sistema plugin con manifest e integrity check SHA256
│   ├── scripts/
│   │   ├── rampUp.ts               # Script ramp-up stand-alone
│   │   ├── backupDb.ts             # Backup database
│   │   ├── restoreDb.ts            # Restore database
│   │   ├── securityAdvisor.ts      # Audit sicurezza
│   │   ├── rotateSecrets.ts        # Rotazione segreti
│   │   └── aiQualityPipeline.ts    # Valutazione qualità AI
│   ├── types/
│   │   └── index.ts                # Tipi condivisi (Lead, Campaign, Job, ...)
│   └── tests/
│       ├── unit/                   # Test unitari (vitest)
│       ├── integration.ts          # Test integrazione DB + worker flow
│       ├── e2eDry.ts               # E2E dry run (nessuna azione reale)
│       └── accessibilitySmoke.ts   # Test accessibilità dashboard (a11y)
├── public/                         # Frontend dashboard (Vanilla TS, HTML, CSS)
├── data/                           # SQLite DB, sessioni browser (gitignored)
├── scripts/                        # Script Node standalone (migrate, config-docs)
├── docker-compose.yml              # Servizi: db (PG16), bot, dashboard (nginx)
├── Dockerfile                      # Build multi-stage Node + Playwright
├── ecosystem.config.cjs            # Configurazione PM2 daemon
├── tsconfig.json                   # TypeScript backend
├── tsconfig.frontend.json          # TypeScript frontend
├── .env.example                    # Template variabili d'ambiente
├── CONFIG_REFERENCE.md             # Riferimento completo 180+ variabili .env
└── AUDIT_COMPLETAMENTI_2026.md     # Storico audit task P0–P5
```

---

## State machine dei lead

```
NEW
 │
 ▼  [InviteWorker: navigate → simulate reading → send invite]
READY_INVITE
 │
 ▼  [InviteWorker: click Connect → handle modal → AI note]
INVITED
 │
 ▼  [AcceptanceWorker: polling profilo → detect accept]
ACCEPTED
 │
 ▼  [MessageWorker: AI generate → hash dedup → type → send]
READY_MESSAGE
 │
 ▼  [MessageWorker: confirm delivery]
MESSAGED
 │
 ▼  [DripCampaignWorker: step 2..N con timing variabile]
DRIP_*  ──► REPLIED (sentiment analysis) ──► CRM export
 │
 └──► ERROR / BLOCKED / QUARANTINED (con motivo e timestamp)
```

Ogni transizione viene persistita nel DB con timestamp, worker responsabile, e payload (es. hash del messaggio inviato, link al profilo, score AI).

---

## Anti-detection — 14 strati

Tutti i layer vengono iniettati via `addInitScript` prima che qualsiasi JS della pagina LinkedIn venga eseguito.

| Layer | Nome | Cosa fa |
|-------|------|---------|
| 1 | WebRTC Disable | Blocca `RTCPeerConnection` — previene il leak dell'IP locale |
| 2 | navigator.webdriver | Elimina il flag `webdriver: true` da `navigator` e `chrome.app` |
| 3 | Navigator Plugins | Inietta array plugins/mimeTypes realistici (PDF, QuickTime, ...) |
| 4 | Canvas Fingerprint | Aggiunge rumore bidirezionale ±N a ogni `getImageData` call |
| 5 | AudioContext | Perturbazione sub-millisecondo sul buffer audio (AnalyserNode) |
| 6 | WebGL Fingerprint | Noise su `getParameter` / `readPixels` / `getExtension` |
| 7 | WebGL Vendor/Renderer | Correlato al device profile: Apple GPU / Intel HD / NVIDIA |
| 8 | Permissions API | Overrride `query()` — restituisce `granted` per geolocation, notifications |
| 9 | Battery API | Simulazione drain dinamico: -1% ogni 10 minuti, con charging state |
| 10 | Chrome Object | Inietta `window.chrome` completo (runtime, loadTimes, csi) |
| 11 | Timezone Align | Allinea `Intl.DateTimeFormat` al timezone del proxy |
| 12 | deviceMemory | `navigator.deviceMemory` mockato con valore del device profile |
| 13 | screen.colorDepth | `colorDepth` e `pixelDepth` coerenti con il profilo hardware |
| 14 | Storage Seeds | Pre-popola IndexedDB/LocalStorage con cookie tracker realistici (`_ga`, `_fbp`, `li_sp`) |

### Livello di rete

| Tecnica | Implementazione |
|---------|----------------|
| JA3/TLS spoofing | CycleTLS proxy locale — falsifica il cipher fingerprint TLS |
| DNS-over-HTTPS | `--dns-over-https-servers` Chrome flag con Cloudflare/NextDNS |
| Proxy residenziale | Sticky session per IP coerente con account LinkedIn |

### Livello comportamentale

| Tecnica | Dove |
|---------|------|
| Traiettoria mouse Bézier + Perlin noise | `mouseGenerator.ts` + `humanBehavior.ts` |
| Stato mouse persistente tra azioni (WeakMap) | `humanBehavior.ts` — `pageMouseState` |
| Hover pre-click (80% ratio) | `hoverPreClick()` in `humanBehavior.ts` |
| Bimodal keystroke timing | `humanType()` — distribuzione bimodale (veloce + pensiero) |
| Tab focus/blur simulation | `simulateTabSwitch()` — Page Visibility API mock |
| Interazione organica feed | `organicContent.ts` — like/reazione/expand-post (20% chance) |
| `history.back()` decoy | Navigazione indietro occasionale per pattern credibili |
| Scroll reading simulation | `simulateHumanReading()` — pause variabili, saccades |

---

## Database — SQLite / PostgreSQL

Il sistema usa un'astrazione unificata in `src/db.ts` che supporta entrambi i backend senza modifiche al codice applicativo.

```
DATABASE_URL non impostato  →  SQLite (data/linkedin.db) — zero config, sviluppo
DATABASE_URL=postgres://... →  PostgreSQL — produzione, multi-processo
```

### Migrazioni automatiche

All'avvio vengono applicate automaticamente tutte le 41 migrazioni in ordine:

| Range | Contenuto |
|-------|-----------|
| 001–005 | Schema base: `leads`, `campaigns`, `run_logs`, `daily_stats` |
| 006–010 | A/B testing, feature store, timing optimizer |
| 011–015 | Drip campaigns, multi-step, acceptance tracking |
| 016–020 | Risk engine: incidents, quarantine, cooldown log |
| 021–025 | Multi-account: accounts table, weights, rotation log |
| 026–030 | Plugin manifest, selector confidence, CAPTCHA log |
| 031–034 | Cloud sync queue, Supabase event log, security audit log |

### Backup / Restore

```bash
npm run db:backup          # Crea backup con timestamp in data/backups/
npm run db:restore         # Restore dall'ultimo backup
npm run db:restore:drill   # Verifica integrità su DB temporaneo senza toccare quello live
```

---

## Configurazione .env

Copia `.env.example` in `.env` e configura le variabili. Vedi [CONFIG_REFERENCE.md](CONFIG_REFERENCE.md) per la lista completa (180+).

### Variabili obbligatorie

```bash
# Credenziali LinkedIn
LINKEDIN_EMAIL=tua@email.com
LINKEDIN_PASSWORD=tuapassword

# Database (ometti per SQLite locale)
DATABASE_URL=postgres://user:pass@host:5432/linkedin

# OpenAI (per note e messaggi AI)
OPENAI_API_KEY=sk-...
```

### Variabili raccomandate per produzione

```bash
# Proxy residenziale/mobile (obbligatorio per operare in sicurezza)
PROXY_URL=http://proxy.provider.com:port
PROXY_USERNAME=user-session-nomeutente
PROXY_PASSWORD=password

# Supabase (cloud sync e dashboard remota)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...

# Bot Telegram (alert e controllo remoto)
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=987654321

# Dashboard auth
DASHBOARD_API_KEY=chiave-segreta-lunga
SESSION_SECRET=session-secret-casuale

# Limiti giornalieri (valori conservativi raccomandati)
MAX_INVITES_PER_DAY=15
MAX_MESSAGES_PER_DAY=25
WORKING_HOURS_START=9
WORKING_HOURS_END=18
WORKING_DAYS=1,2,3,4,5

# Fingerprint cloud API (per profili reali)
FINGERPRINT_API_URL=https://your-fingerprint-api.com
FINGERPRINT_API_KEY=...
```

---

## Multi-account

Il bot supporta fino a 2 account LinkedIn in rotazione ponderata.

```bash
ACCOUNT_1_EMAIL=primo@email.com
ACCOUNT_1_PASSWORD=pass1
ACCOUNT_1_WEIGHT=0.7         # 70% dei job

ACCOUNT_2_EMAIL=secondo@email.com
ACCOUNT_2_PASSWORD=pass2
ACCOUNT_2_WEIGHT=0.3         # 30% dei job
```

Ogni account ha sessione browser separata, budget indipendente, e log isolati. Il risk engine monitora ciascun account individualmente.

---

## Drip campaigns

Le drip campaigns automatizzano sequenze di messaggi multi-step post-connessione.

### Configurazione campagna (via dashboard o CSV)

```json
{
  "name": "Outreach SaaS Q1",
  "steps": [
    { "delay_days": 0, "template": "message_welcome" },
    { "delay_days": 3, "template": "message_followup_1" },
    { "delay_days": 7, "template": "message_followup_2" }
  ],
  "ab_variants": ["A", "B"]
}
```

- Ogni step usa un template diverso con variabili dinamiche (`{{firstName}}`, `{{company}}`, `{{jobTitle}}`)
- Il timing tra step viene ottimizzato automaticamente dal `timingOptimizer.ts` Bayesiano
- L'A/B testing epsilon-greedy seleziona automaticamente il variant con più alto reply rate
- Se il lead risponde, la campagna si ferma e il lead viene marcato `REPLIED`

---

## Risk Engine

Il risk engine calcola uno score composito 0–100 che determina se procedere, rallentare, o fermarsi.

### Componenti dello score

| Componente | Peso | Descrizione |
|-----------|------|-------------|
| Velocity ratio | 30% | Azioni/ora vs. baseline storica |
| Error rate | 25% | % di azioni fallite negli ultimi 30 minuti |
| Challenge rate | 20% | % di CAPTCHA / checkpoint LinkedIn rilevati |
| Account age | 10% | Penalità per account giovani (<90 giorni) |
| Off-hours penalty | 10% | Attività fuori orario lavorativo |
| IP reputation | 5% | Score IP dal provider proxy |

### Soglie

| Score | Azione |
|-------|--------|
| 0–30 | Verde — operazione normale |
| 31–60 | Giallo — rallentamento automatico (+50% delay) |
| 61–80 | Arancione — cooldown 30 minuti, alert Telegram |
| 81–100 | Rosso — quarantena, blocco completo, notifica critica |

Il risk engine mantiene anche un **z-score predittivo** che proietta il trend del rischio nelle prossime 2 ore, permettendo di fermarsi preventivamente prima di raggiungere soglie critiche.

---

## Proxy e rete

### Tipologia proxy

| Tipo | Rischio ban | Note |
|------|-------------|------|
| Datacenter | Altissimo | Da evitare assolutamente |
| Residenziale rotante | Medio | OK per scraping, non per account con sessione |
| Residenziale statico | Basso | Buon compromesso per account con storia |
| Mobile 4G/5G | Minimo | Ottimale — IP reali da carrier |

### Sticky session (obbligatorio per account con sessione)

Per mantenere lo stesso IP tra sessioni dello stesso account:

```bash
# Bright Data
PROXY_USERNAME=user-session-nomeutente

# IPRoyal
PROXY_USERNAME=user_nomeutente_session-nomeutente
```

### JA3/TLS spoofing

Il bot avvia un proxy locale CycleTLS che intercetta le connessioni Playwright e le ri-fa con un fingerprint TLS che corrisponde a un browser reale (Chrome 120 su Windows 11). Configurabile via `CYCLETLS_PORT` (default: 8888).

---

## Cloud sync (Supabase)

Ogni evento significativo (invite inviato, messaggio consegnato, lead accettato) viene sincronizzato in modo non-bloccante su Supabase. Il bot non si ferma se Supabase è irraggiungibile.

```bash
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SYNC_ENABLED=true
```

La sync usa una coda con backpressure (`sync/backpressure.ts`) per evitare di saturare l'API Supabase in burst. La dashboard può mostrare dati da Supabase per il monitoraggio remoto.

---

## Bot Telegram

Il bot Telegram permette controllo remoto completo senza aprire la dashboard.

### Comandi disponibili

| Comando | Descrizione |
|---------|-------------|
| `/status` | Stato corrente: risk score, budget rimanente, lead in coda |
| `/pause` | Mette in pausa il bot dopo il job corrente |
| `/resume` | Riprende dopo pausa |
| `/kpi` | KPI del giorno: inviti, messaggi, acceptance rate |
| `/funnel` | Stato funnel CRM: NEW→ACCEPTED→REPLIED |
| `/importa` | Import lead tramite AI — incolla testo grezzo, il bot estrae URL profili |
| `/report` | Report completo (inviato anche automaticamente ogni giorno alle 20:00) |

### Alert automatici

Il bot invia alert automatici per:
- Risk score > 60 (warning) o > 80 (critico)
- Lead accettato (alert CRM)
- Lead che risponde (alert con sentiment)
- Errori critici nel workflow
- Report giornaliero (20:00)

---

## AI Layer

### Generazione messaggi e note invite

Ogni nota invite e ogni messaggio vengono generati da OpenAI con:
- Personalizzazione su job title, company, post recenti del lead
- Varianti A/B per il testing automatico
- Hash SHA-256 per deduplicazione (stesso messaggio non inviato due volte)
- Validazione qualità pre-invio (lunghezza, tono, spam score)

### AI Guardian

Prima di ogni ciclo di job, l'AI guardian analizza:
- Tendenze recenti (spike di errori, challenge rate anomalo)
- Qualità del proxy IP
- Ore/giorni ad alto rischio
- Configurazione potenzialmente pericolosa

Se il guardian valuta rischio elevato, il ciclo viene abortito e viene inviato un alert Telegram con motivazione.

### Lead scoring

`leadScoring.ts` calcola la propensity-to-connect di ogni lead usando:
- Job title e seniority
- Company size e industry
- Attività recente su LinkedIn (post, commenti)
- Overlap con connessioni esistenti

I lead con score alto vengono processati prima (priority queue).

### CAPTCHA solver

`visionSolver.ts` usa Ollama con il modello LLaVA per risolvere CAPTCHA visivi. Richiede Ollama installato localmente con `ollama pull llava`.

---

## Sicurezza dashboard

La dashboard Express implementa:

| Layer | Implementazione |
|-------|----------------|
| Autenticazione | API Key header + Basic Auth + Session Cookie (3 modalità) |
| Rate limiting | 120 req/min globale + limiti per-endpoint |
| CSRF | Validazione `Origin` su tutte le richieste mutanti (POST/PUT/DELETE) |
| Log sanitization | `redaction.ts` — redige automaticamente token, password, email nei log |
| HTTPS | Configurabile con `SSL_CERT_PATH` / `SSL_KEY_PATH` |

```bash
npm run security:advisor   # Audit: cerca segreti in chiaro, config pericolose
npm run secrets:rotate     # Ruota API keys ogni N giorni (default: 7)
```

---

## Testing

```bash
npm test                        # Suite completa
npm run test:vitest             # Solo unit test (vitest)
npm run test:vitest:watch       # Unit test in watch mode
npm run test:vitest:coverage    # Coverage report (soglia: 80%)
npm run test:integration        # Test integrazione DB + workers
npm run test:e2e:dry            # E2E dry run completo (no azioni reali)
npm run test:a11y:smoke         # Accessibilità dashboard (axe-core)
```

### Struttura test

```
src/tests/
├── unit/
│   ├── riskEngine.test.ts
│   ├── scheduler.test.ts
│   ├── abTesting.test.ts
│   ├── mouseGenerator.test.ts
│   └── ...
├── integration.ts       # Flow end-to-end con DB reale (SQLite)
├── e2eDry.ts            # Playwright dry run: naviga LinkedIn senza azioni
└── accessibilitySmoke.ts # Test a11y su tutte le route dashboard
```

---

## Deploy

### Docker (raccomandato per produzione)

```bash
docker-compose up -d
```

Servizi:
- `db` — PostgreSQL 16 con volume persistente
- `bot` — Node.js + Playwright con display virtuale (Xvfb)
- `dashboard` — Nginx reverse proxy con SSL termination

```bash
# Variabili d'ambiente in produzione
cp .env.example .env
# Edita .env con DATABASE_URL postgres, PROXY_*, OPENAI_API_KEY, ecc.

# Build immagini
docker-compose build

# Start
docker-compose up -d

# Log bot
docker-compose logs -f bot

# Stop
docker-compose down
```

### PM2 (alternativa a Docker)

```bash
npm run build                  # Compila TypeScript
npm run daemon:start           # Avvia con PM2 (auto-restart, cluster mode)
npm run daemon:status          # Verifica uptime e memoria
npm run daemon:logs            # Segui i log
npm run daemon:stop            # Stop graceful
```

Configurazione in `ecosystem.config.cjs`:
- Auto-restart su crash con backoff esponenziale
- Limite memoria 512MB (configurable)
- Log rotation automatica

---

## CI/CD

GitHub Actions (`.github/workflows/`):

| Job | Quando | Cosa fa |
|-----|--------|---------|
| `typecheck` | PR + push main | `tsc --noEmit` backend + frontend |
| `lint` | PR + push main | ESLint strict |
| `audit` | PR + push main | `npm audit --audit-level=high` |
| `test` | PR + push main | Suite vitest + integration |
| `build` | Push main | Build TypeScript + Docker image |
| `smoke` | Post-deploy | E2E dry run contro staging |

---

## Note operative

### Limiti consigliati per account nuovo (<90 giorni)

```
Settimana 1–2: max 5 inviti/giorno
Settimana 3–4: max 10 inviti/giorno
Mese 2+:       max 15–20 inviti/giorno
```

Il modello `rampModel.ts` gestisce questo ramp-up automaticamente se `RAMP_UP_ENABLED=true`.

### Orari ottimali

LinkedIn monitora l'attività fuori orario lavorativo. Configura:

```bash
WORKING_HOURS_START=9
WORKING_HOURS_END=18
WORKING_DAYS=1,2,3,4,5   # Lun-Ven
```

### Segnali di detection imminente

Il bot monitora questi indicatori e si ferma automaticamente:
- Comparsa di CAPTCHA / "security verification"
- Redirect verso `/checkpoint/`
- Rate limit HTTP 429
- Risposta "Something went wrong" ripetuta

---

## Licenza

Privato — Tutti i diritti riservati.
