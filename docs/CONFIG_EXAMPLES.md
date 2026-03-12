# Esempi di Configurazione

Scenari comuni con le variabili `.env` raccomandate. Copia il blocco e adatta ai tuoi valori.

---

## Scenario 1: Singolo Account — Setup Minimo

Configurazione base per iniziare con un solo account LinkedIn, senza proxy, senza AI.

```env
# Runtime
TIMEZONE=Europe/Rome
HEADLESS=false
HOUR_START=9
HOUR_END=18
DB_PATH=./data/linkedin_bot.sqlite
SESSION_DIR=./data/session

# Budget conservativo (primo mese)
SOFT_INVITE_CAP=10
HARD_INVITE_CAP=15
SOFT_MSG_CAP=10
HARD_MSG_CAP=20
WEEKLY_INVITE_LIMIT=60

# Compliance
COMPLIANCE_ENFORCED=true
COMPLIANCE_MAX_HARD_INVITE_CAP=20
COMPLIANCE_MAX_WEEKLY_INVITE_LIMIT=100

# Warmup (raccomandata per account nuovi)
WARMUP_ENABLED=true
WARMUP_START_DATE=2026-03-01
WARMUP_MAX_DAYS=30
WARMUP_MIN_ACTIONS=5
RAMPUP_ENABLED=true
RAMPUP_DAILY_INCREASE=0.05

# Telegram alert (opzionale ma raccomandato)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
DAILY_REPORT_AUTO_ENABLED=true
```

---

## Scenario 2: Singolo Account — Con Proxy Residenziale

Aggiunge un proxy residenziale per mascherare l'IP. Raccomandata per uso continuativo.

```env
# ... (tutto da Scenario 1) ...

# Proxy residenziale (es. BrightData)
PROXY_URL=http://user-country-it-session-123:password@zproxy.lum-superproxy.io:22225
PROXY_TYPE_DEFAULT=residential
PROXY_FAILURE_COOLDOWN_MINUTES=30
PROXY_ROTATE_EVERY_JOBS=5
PROXY_ROTATE_EVERY_MINUTES=15
PROXY_HEALTH_CHECK_TIMEOUT_MS=5000
PROXY_MOBILE_PRIORITY_ENABLED=true

# Quality check proxy
PROXY_QUALITY_CHECK_ENABLED=true
PROXY_QUALITY_CHECK_INTERVAL_MINUTES=60
PROXY_QUALITY_MIN_SCORE=50

# JA3 / CycleTLS (raccomandata se disponibile)
USE_JA3_PROXY=false
# Abilita solo se hai CycleTLS in esecuzione:
# USE_JA3_PROXY=true
# JA3_PROXY_PORT=8080
```

---

## Scenario 3: Multi-Account (2 Account)

Due account LinkedIn con proxy dedicati e budget separati.

```env
# Multi-account
MULTI_ACCOUNT_ENABLED=true

# Account 1
ACCOUNT_1_ID=sales_team_1
ACCOUNT_1_SESSION_DIR=./data/session_acc1
ACCOUNT_1_PROXY_URL=http://user1:pass@proxy1.example.com:8080
ACCOUNT_1_PROXY_TYPE=residential
ACCOUNT_1_INVITE_WEIGHT=1
ACCOUNT_1_MESSAGE_WEIGHT=1

# Account 2
ACCOUNT_2_ID=sales_team_2
ACCOUNT_2_SESSION_DIR=./data/session_acc2
ACCOUNT_2_PROXY_URL=http://user2:pass@proxy2.example.com:8080
ACCOUNT_2_PROXY_TYPE=residential
ACCOUNT_2_INVITE_WEIGHT=1
ACCOUNT_2_MESSAGE_WEIGHT=1

# Budget (per account, dimezzato rispetto a singolo)
SOFT_INVITE_CAP=8
HARD_INVITE_CAP=12
SOFT_MSG_CAP=8
HARD_MSG_CAP=15
WEEKLY_INVITE_LIMIT=50

# Fairness: max job per run per account
ACCOUNT_MAX_JOBS_PER_RUN=60
```

---

## Scenario 4: Produzione Completa — Con AI + CRM + Monitoring

Setup completo per produzione con AI, integrazioni CRM, monitoring Prometheus.

```env
# Runtime
TIMEZONE=Europe/Rome
HEADLESS=true
HOUR_START=9
HOUR_END=18
DB_PATH=./data/linkedin_bot.sqlite
# PostgreSQL raccomandato in produzione:
# DATABASE_URL=postgresql://user:pass@host:5432/linkedin_bot
SESSION_DIR=./data/session
PROCESS_MAX_UPTIME_HOURS=24

# Dashboard auth (obbligatorio in produzione)
DASHBOARD_AUTH_ENABLED=true
DASHBOARD_API_KEY=tuo-api-key-sicuro-qui
DASHBOARD_BASIC_USER=admin
DASHBOARD_BASIC_PASSWORD=password-sicura

# Budget produzione
SOFT_INVITE_CAP=15
HARD_INVITE_CAP=25
SOFT_MSG_CAP=20
HARD_MSG_CAP=35
WEEKLY_INVITE_LIMIT=80

# AI personalizzazione
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
AI_ALLOW_REMOTE_ENDPOINT=true
AI_PERSONALIZATION_ENABLED=true
AI_SENTIMENT_ENABLED=true
INVITE_WITH_NOTE=true
INVITE_NOTE_MODE=ai

# CRM (opzionale)
HUBSPOT_API_KEY=pat-...
# SALESFORCE_INSTANCE_URL=https://yourorg.salesforce.com
# SALESFORCE_CLIENT_ID=...
# SALESFORCE_CLIENT_SECRET=...

# Proxy pool (file con lista)
PROXY_LIST=./data/proxy_list.txt
PROXY_TYPE_DEFAULT=residential
PROXY_MOBILE_PRIORITY_ENABLED=true
PROXY_QUALITY_CHECK_ENABLED=true

# Monitoring
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_CHAT_ID=-100123456789
DAILY_REPORT_AUTO_ENABLED=true
DAILY_REPORT_HOUR=20

# Supabase sync (opzionale)
SUPABASE_SYNC_ENABLED=true
SUPABASE_URL=https://yourproject.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

---

## Formato File Proxy List

Il file `PROXY_LIST` supporta più formati. Uno per riga:

```
# Formato URL standard
http://user:pass@proxy1.example.com:8080
http://user:pass@proxy2.example.com:8080

# Formato host:port:user:pass
proxy3.example.com:8080:user:pass

# Con prefisso tipo (raccomandata)
residential|http://user:pass@proxy1.example.com:8080
mobile|http://user:pass@proxy2.example.com:8080
residential|proxy3.example.com:8080:user:pass

# Le righe con # sono ignorate
# I duplicati vengono rimossi automaticamente
```

---

## Verifica Configurazione

Dopo aver configurato il `.env`, verifica con:

```bash
# Valida configurazione + proxy + JA3
npm start -- config-validate

# Report JSON completo
npm start -- config-validate | jq .

# Solo il summary
npm start -- config-validate | jq .summary

# Check salute sistema
npm start -- diagnostics

# Status proxy pool
npm start -- proxy-status
```
