# LinkedIn Bot Control Room

Piattaforma di automazione LinkedIn B2B con dashboard realtime, risk engine adattivo, A/B testing, e drip campaigns.

## Architettura

```
┌─────────────┐    ┌──────────────┐    ┌───────────────┐
│  Dashboard   │◄──►│  Express API │◄──►│   SQLite/PG   │
│  (Vanilla TS)│    │  (server.ts) │    │   (db.ts)     │
└─────────────┘    └──────┬───────┘    └───────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
   ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
   │ Orchestrator │ │  Risk Engine │ │  AI Layer   │
   │ (scheduler,  │ │ (throttler,  │ │ (OpenAI,    │
   │  jobRunner)  │ │  incidents)  │ │  sentiment) │
   └──────┬──────┘ └─────────────┘ └─────────────┘
          │
   ┌──────▼──────┐
   │  Playwright  │
   │  (stealth,   │
   │   workers)   │
   └─────────────┘
```

## Quick Start

```bash
# 1. Installa dipendenze
npm install

# 2. Configura
cp .env.example .env
# Modifica .env con le tue credenziali

# 3. Crea il profilo browser (login manuale una tantum)
npm run create-profile

# 4. Avvia la dashboard
npm run dashboard:dev

# 5. Oppure avvia il bot in loop
npm run start:dev -- run-loop
```

## Comandi principali

| Comando | Descrizione |
|---------|-------------|
| `npm run dashboard:dev` | Dashboard + API su <http://localhost:3000> |
| `npm run start:dev -- run-loop` | Bot in loop continuo |
| `npm run start:dev -- dry-run` | Simulazione senza azioni reali |
| `npm run start:dev -- doctor` | Diagnostica completa del sistema |
| `npm test` | Esegue tutti i test (unit + integration + e2e + a11y) |
| `npm run lint` | ESLint |
| `npm run format` | Formattazione Prettier |
| `npm run db:backup` | Backup database |

## Struttura progetto

```
src/
├── ai/          # OpenAI, sentiment, lead scoring, post generation
├── api/         # Express server, routes, middleware
├── browser/     # Playwright, stealth, fingerprint, auth
├── captcha/     # VisionSolver (Ollama/LLaVA)
├── cli/         # Comandi CLI
├── cloud/       # Supabase, Telegram
├── config/      # Configurazione da .env
├── core/        # Orchestrator, scheduler, jobRunner, repositories
├── db/          # Database abstraction (SQLite + PostgreSQL)
├── ml/          # A/B testing, timing optimizer, ramp model
├── plugins/     # Sistema plugin con manifest e integrity check
├── risk/        # Risk engine, incident manager, HTTP throttler
├── selectors/   # Self-healing selector learner
├── sync/        # Backpressure, event sync (Supabase/Webhook)
├── telemetry/   # Logger, alerts (Telegram/Discord/Slack), daily report
├── tests/       # Unit, integration, e2e, accessibility
├── workers/     # Invite, message, acceptance, follow-up, enrichment
└── index.ts     # Entry point
```

## Database

Supporta sia **SQLite** (sviluppo) che **PostgreSQL** (produzione).

- SQLite: automatico, zero config, file `data/linkedin.db`
- PostgreSQL: impostare `DATABASE_URL=postgres://...` nel `.env`
- Migrazioni: `src/db/migrations/` (001-034), applicate automaticamente all'avvio

## Docker

```bash
docker-compose up -d
```

Servizi: `db` (PostgreSQL 16), `bot` (Node + Playwright), `dashboard` (Nginx reverse proxy).

## Anti-Detection & Rete (Bright Data / IPRoyal)

Il bot integra difese avanzate contro le AI di LinkedIn. **La configurazione del Proxy è obbligatoria per operare in sicurezza.**

### 1. Scelta del Proxy

- **Vietati**: Proxy Datacenter (ban immediato).
- **Consigliati**: Proxy Mobile 4G/5G (ProxyEmpire, IPRoyal) o Residenziali Statici (Bright Data).

### 2. Gestione IP (La Regola d'Oro)

- **Account Esistente (Sticky Session)**: Se il bot gestisce un account con cui ha fatto Login (cookie vivo), usa *sempre* lo stesso IP o perlomeno la stessa region. In Bright Data/IPRoyal, aggiungi `-session-nomeaccount` alla stringa del `PROXY_USERNAME` nel `.env` reale per ottenere un IP persistente.
- **Scraping Anonimo**: Se fai scrape puro senza account, rimuovi il `session-id` per far ruotare l'IP nativamente lato provider ed evitare il `Rate Limit HTTP 429`.

### 3. Allineamento Fingerprint (Gestito dal Bot)

Il nostro file `stealthScripts.ts` gestisce già:

- **Timezone Leak**: Allinea il fuso orario di Node.js a quello del Proxy.
- **WebRTC Leak**: Disabilita l'esposizione del vero IP locale disattivando WebRTC nel launcher.
- **Hardware/Canvas Spoofer**: Inietta rumore in Canvas, AudioContext e WebGL per ingannare i track JS.
- **TLS/JA3**: Falsifica il cipher in uscita per farsi riconoscere come vero browser da Cloudflare.

## Sicurezza

- Autenticazione dashboard: API Key, Basic Auth, Session Cookie
- Rate limiting: globale (120 req/min) + per-endpoint
- CSRF: Origin validation su richieste mutanti
- Log sanitization: redazione automatica di token, password, email
- Secret rotation: `npm run secrets:rotate`
- Security Advisor: `npm run security:advisor`

## CI/CD

GitHub Actions: typecheck, ESLint, npm audit, test suite completa, build Docker, smoke test.

## Configurazione

Vedi [CONFIG_REFERENCE.md](CONFIG_REFERENCE.md) per tutte le 180+ variabili d'ambiente configurabili.

## Licenza

Privato — Tutti i diritti riservati.
