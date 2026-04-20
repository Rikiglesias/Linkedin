# Setup infrastruttura LinkedIn Bot

> Questo documento copre il setup completo del sistema per chi lo riceve da zero.
> Per l'uso quotidiano del bot → `docs/GUIDA.md`
> Per le variabili di configurazione → `docs/CONFIG_REFERENCE.md`

---

## Prerequisiti

| Componente | Versione minima | Verifica |
|-----------|----------------|---------|
| Node.js | 22+ | `node --version` |
| npm | 10+ | `npm --version` |
| Git | — | `git --version` |
| PM2 | 5+ | `npm install -g pm2` |
| Docker Desktop | 24+ | Per n8n (opzionale ma raccomandato) |

---

## 1. Clone e dipendenze

```bash
git clone <repo-url>
cd Linkedin
npm install
```

---

## 2. Variabili d'ambiente

```bash
cp .env.example .env
```

Aprire `.env` e compilare **tutti** i campi obbligatori:

| Variabile | Obbligatoria | Dove trovarla |
|-----------|-------------|--------------|
| `DATABASE_URL` | ✅ | PostgreSQL locale o cloud (Supabase) |
| `LINKEDIN_EMAIL` | ✅ | Account LinkedIn da automatizzare |
| `LINKEDIN_PASSWORD` | ✅ | — |
| `OXYLABS_USERNAME` | ✅ | Dashboard Oxylabs → Residential Proxies |
| `OXYLABS_PASSWORD` | ✅ | — |
| `TELEGRAM_BOT_TOKEN` | ✅ | BotFather su Telegram → `/newbot` |
| `TELEGRAM_CHAT_ID` | ✅ | `@userinfobot` o `api.telegram.org/bot<TOKEN>/getUpdates` |
| `DASHBOARD_API_KEY` | ✅ | Generare con `openssl rand -hex 32` |
| `ANTHROPIC_API_KEY` | ✅ | console.anthropic.com |
| `SENTRY_DSN` | ⚠️ | Sentry dashboard → onboarding → DSN |
| `NODE_ENV` | ✅ | `production` in prod, `development` in dev |

**Verifica**: `npm run start:dev -- doctor` oppure `.\bot.ps1 doctor` — deve uscire senza errori sulle env vars e sul preflight base.

---

## 3. Database

```bash
# Applica tutte le migration in ordine
npm run db:migrate

# Verifica preflight e stato base
npm run start:dev -- doctor
```

Se usi Supabase: applicare le migration via `mcp__claude_ai_Supabase__apply_migration` o dalla dashboard SQL Editor.

---

## 4. Build TypeScript

```bash
npm run build
```

Deve terminare senza errori (`npx tsc --noEmit` exit 0).

---

## 5. Login LinkedIn (sessione)

```powershell
.\bot.ps1 login
```

- Si apre Firefox. Fai login manualmente su LinkedIn.
- Chiudi il browser quando vedi il feed.
- La sessione dura ~7 giorni. Ripetere allo scadere.

**Verifica**: `.\bot.ps1 doctor` → `"sessionLoginOk": true`

---

## 6. PM2 — process manager

```bash
# Avvia il bot e il daemon
pm2 start ecosystem.config.cjs

# Verifica che girino
pm2 status

# Log in tempo reale
pm2 logs

# Salva la configurazione per il riavvio automatico
pm2 save
pm2 startup
```

**Processi attesi in PM2**:
| Nome | Funzione |
|------|---------|
| `linkedin-bot-api` | API REST + dashboard backend |
| `linkedin-bot-daemon` | Loop principale del bot |
| `n8n` | Workflow automation (se avviato via PM2) |

**Verifica**: `pm2 status` → tutti i processi in `online`.

---

## 7. n8n — workflow automation

### Avvio con Docker (raccomandato)

```bash
docker compose up -d n8n
```

n8n girerà su `http://localhost:5678`.

### Primo accesso

1. Aprire `http://localhost:5678`
2. Creare account admin (email + password)
3. Impostare basic auth: Settings → Users → Change Password

### Variabili d'ambiente n8n

Aggiungere al `docker-compose.yml` (o al file `.env` di n8n):

```env
N8N_BASIC_AUTH_ACTIVE=true
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=<password-sicura>
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_CHAT_ID=<chat-id>
DASHBOARD_API_KEY=<api-key>
ANTHROPIC_API_KEY=<api-key>
```

### Import workflow

Per ogni file in `n8n-workflows/`:

1. n8n UI → **Settings → Import Workflow**
2. Scegliere il file JSON
3. Il workflow si attiva automaticamente se ha un trigger Cron

**Ordine di import consigliato**:
1. `bot-health-check.json` (health monitoring)
2. `orchestrator-v2.json` (orchestrazione tecnica principale)
3. `watchdog.json` (monitoring e recovery)
4. `weekly-lead-report-v2.json` (report settimanale)
5. `gdpr-retention-cleanup.json` (pulizia automatica lunedì)
6. `linkedin-detection-monitor.json`
7. `quality-gate-check.json`
8. `lead-pipeline-health.json`

### Configurare la credenziale Telegram in n8n

1. n8n → **Credentials → New** → scegliere "Telegram"
2. Nome: `Telegram Bot`
3. Token: inserire `TELEGRAM_BOT_TOKEN`
4. I workflow già usano questo credential name — non cambiarlo.

**Verifica**: eseguire manualmente `bot-health-check.json` → ricevere il report su Telegram.

---

## 8. Verifica finale del sistema

```bash
# Typecheck
npx tsc --noEmit

# Test
npm test

# Audit codebase
npm run audit

# Health API
curl http://localhost:3000/api/health
```

**Checklist pre-go-live**:
- [ ] PM2 mostra tutti i processi `online`
- [ ] `.\bot.ps1 doctor` → `sessionLoginOk: true`, proxy ok
- [ ] n8n accessibile su `localhost:5678`
- [ ] Almeno un workflow n8n eseguito con alert Telegram ricevuto
- [ ] `npm run audit` eseguito e findings strutturali triaged nel backlog operativo
- [ ] Nessuna circular dependency (`npx madge --circular src/`)

---

## 9. Credenziali — rotazione e audit

| Credenziale | Scadenza tipica | Azione |
|------------|----------------|--------|
| Sessione LinkedIn | ~7 giorni | `.\bot.ps1 login` |
| `DASHBOARD_API_KEY` | Mai — ma ruotare ogni 90gg | `openssl rand -hex 32` → aggiornare `.env` e n8n |
| `ANTHROPIC_API_KEY` | Mai — ma monitorare usage | console.anthropic.com |
| `OXYLABS_PASSWORD` | Per policy Oxylabs | Dashboard Oxylabs |
| Cert/segreti DB | Dipende da provider | Dashboard provider |

**Verifica periodica (ogni 90 giorni)**:
```bash
# Nessuna credenziale nel codice Git
git grep -rn "password\|secret\|token\|api_key" -- '*.ts' '*.js' '*.json' | grep -vE '\$env\.|process\.env|\.example|test'
```

---

## 10. Troubleshooting rapido

| Sintomo | Causa probabile | Fix |
|---------|----------------|-----|
| `sessionLoginOk: false` | Sessione LinkedIn scaduta | `.\bot.ps1 login` |
| PM2 processo in restart loop | Errore fatale al startup | `pm2 logs linkedin-daemon --lines 100` |
| n8n workflow non esegue | Env var mancante | Pre-hook del workflow mostra l'errore |
| `npx tsc` ha errori | Tipo mancante o import rotto | Leggere output, correggere il file |
| Proxy error 407 | Credenziali Oxylabs scadute | Aggiornare `.env` |
| Nessun alert Telegram | `TELEGRAM_*` non configurate | Verificare in n8n Variables o `.env` |

Per debug profondo: `pm2 logs --lines 500` + `docs/tracking/ENGINEERING_WORKLOG.md`.
