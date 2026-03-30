#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LinkedIn Bot — Setup VPS per nuovo cliente
# Testato su Ubuntu 22.04 / Debian 12
# Uso: bash setup-vps.sh
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

REPO_URL="${REPO_URL:-https://github.com/Rikiglesias/Linkedin.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/linkedin-bot}"

echo ""
echo "═══════════════════════════════════════════════"
echo "   LinkedIn Bot — Setup VPS                    "
echo "═══════════════════════════════════════════════"
echo ""

# ── 1. Prerequisiti ──────────────────────────────────────────────
log "Controllo prerequisiti..."

if ! command -v docker &>/dev/null; then
  warn "Docker non trovato — installazione in corso..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  log "Docker installato"
fi

if ! docker compose version &>/dev/null; then
  warn "Docker Compose plugin non trovato — installazione..."
  apt-get install -y docker-compose-plugin 2>/dev/null || \
    pip3 install docker-compose 2>/dev/null || \
    err "Impossibile installare Docker Compose. Installalo manualmente."
fi

if ! command -v git &>/dev/null; then
  log "Installazione git..."
  apt-get install -y git
fi

log "Prerequisiti OK"

# ── 2. Clone repo ────────────────────────────────────────────────
if [ -d "$INSTALL_DIR" ]; then
  warn "Directory $INSTALL_DIR già esistente — pull aggiornamenti..."
  cd "$INSTALL_DIR" && git pull
else
  log "Clone repository in $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ── 3. Configurazione .env ───────────────────────────────────────
if [ ! -f "$INSTALL_DIR/.env" ]; then
  log "Creazione .env da template..."
  cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"

  echo ""
  echo "─── Configurazione credenziali ──────────────────"
  echo "Inserisci i valori richiesti (Invio = lascia default)"
  echo ""

  read -rp "PostgreSQL password [generata auto]: " PG_PASS
  PG_PASS="${PG_PASS:-$(openssl rand -hex 16)}"

  read -rp "Dashboard API Key [generata auto]: " API_KEY
  API_KEY="${API_KEY:-$(openssl rand -hex 24)}"

  read -rp "N8N Encryption Key [generata auto]: " N8N_KEY
  N8N_KEY="${N8N_KEY:-$(openssl rand -hex 32)}"

  read -rp "N8N Admin Username [default: admin]: " N8N_USER
  N8N_USER="${N8N_USER:-admin}"
  read -rp "N8N Admin Password [generata auto]: " N8N_PASS
  N8N_PASS="${N8N_PASS:-$(openssl rand -base64 16)}"

  read -rp "Telegram Bot Token: " TG_TOKEN
  read -rp "Telegram Chat ID: " TG_CHAT

  read -rp "OpenRouter API Key (per Claude AI): " OR_KEY
  read -rp "OpenAI API Key (per AI personalization): " OAI_KEY

  # Aggiorna .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PG_PASS|" .env
  sed -i "s|^DASHBOARD_API_KEY=.*|DASHBOARD_API_KEY=$API_KEY|" .env
  sed -i "s|^N8N_ENCRYPTION_KEY=.*|N8N_ENCRYPTION_KEY=$N8N_KEY|" .env
  sed -i "s|^N8N_BASIC_AUTH_USER=.*|N8N_BASIC_AUTH_USER=$N8N_USER|" .env
  sed -i "s|^N8N_BASIC_AUTH_PASSWORD=.*|N8N_BASIC_AUTH_PASSWORD=$N8N_PASS|" .env
  sed -i "s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=$TG_TOKEN|" .env
  sed -i "s|^TELEGRAM_CHAT_ID=.*|TELEGRAM_CHAT_ID=$TG_CHAT|" .env
  [ -n "$OR_KEY" ] && echo "OPENROUTER_API_KEY=$OR_KEY" >> .env
  [ -n "$OAI_KEY" ] && sed -i "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=$OAI_KEY|" .env

  # DATABASE_URL per Docker
  echo "DATABASE_URL=postgres://bot_user:${PG_PASS}@db:5432/linkedin_bot" >> .env
  sed -i "s|^ALLOW_SQLITE_IN_PRODUCTION=.*|ALLOW_SQLITE_IN_PRODUCTION=false|" .env

  log ".env configurato"
else
  warn ".env già esistente — skip configurazione"
fi

# ── 4. Firewall ──────────────────────────────────────────────────
if command -v ufw &>/dev/null; then
  log "Configurazione firewall (ufw)..."
  ufw allow 80/tcp comment "LinkedIn Bot Dashboard" 2>/dev/null || true
  ufw allow 5678/tcp comment "n8n" 2>/dev/null || true
  # NOTA: Docker bypassa UFW per le porte mappate — porta 3000 è vincolata a 127.0.0.1
  # in docker-compose.yml, quindi NON è accessibile dall'esterno nonostante UFW.
  warn "Porta 5678 (n8n) protetta da Basic Auth — credenziali configurate nel .env"
fi

# ── 5. Avvio stack ───────────────────────────────────────────────
log "Build e avvio container (può richiedere 5-10 minuti al primo avvio)..."
cd "$INSTALL_DIR"
docker compose pull --quiet 2>/dev/null || true
docker compose up -d --build

# ── 6. Health check ──────────────────────────────────────────────
log "Attesa avvio servizi (60s max)..."
for i in $(seq 1 12); do
  sleep 5
  if curl -sf http://localhost:3000/api/health &>/dev/null; then
    log "Bot API online!"
    break
  fi
  echo -n "."
done
echo ""

if ! curl -sf http://localhost:3000/api/health &>/dev/null; then
  warn "Bot API non risponde ancora — controlla con: docker compose logs bot-api"
fi

if curl -sf http://localhost:5678/healthz &>/dev/null; then
  log "n8n online!"
else
  warn "n8n non risponde ancora — controlla con: docker compose logs n8n"
fi

# ── 7. Import workflow n8n ───────────────────────────────────────
echo ""
echo "─── Importazione workflow n8n ──────────────────"
warn "Importa manualmente i workflow da n8n UI:"
echo "  1. Apri http://$(curl -sf ifconfig.me 2>/dev/null || echo 'IP_VPS'):5678"
echo "  2. Menu → Workflows → Import"
echo "  3. Importa: n8n-workflows/orchestrator-v2.json"
echo "  4. Importa: n8n-workflows/watchdog.json"
echo "  5. In ogni workflow, sostituisci TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,"
echo "     DASHBOARD_API_KEY, OPENROUTER_API_KEY con i valori reali"
echo "  6. Attiva entrambi i workflow"

# ── 8. Riepilogo ─────────────────────────────────────────────────
PUBLIC_IP=$(curl -sf ifconfig.me 2>/dev/null || echo 'IP_VPS')
DASHBOARD_API_KEY=$(grep ^DASHBOARD_API_KEY "$INSTALL_DIR/.env" | cut -d= -f2)

echo ""
echo "═══════════════════════════════════════════════"
echo "   Setup completato!                           "
echo "═══════════════════════════════════════════════"
echo ""
echo "  Dashboard:  http://$PUBLIC_IP"
echo "  n8n:        http://$PUBLIC_IP:5678"
echo "  Bot API:    http://localhost:3000 (solo locale)"
echo ""
N8N_USER_DISP=$(grep ^N8N_BASIC_AUTH_USER "$INSTALL_DIR/.env" | cut -d= -f2)
echo "  Dashboard API Key: $DASHBOARD_API_KEY"
echo "  n8n Login: $N8N_USER_DISP / (password in .env → N8N_BASIC_AUTH_PASSWORD)"
echo ""
echo "  Comandi utili:"
echo "    docker compose ps           # stato servizi"
echo "    docker compose logs -f      # log in tempo reale"
echo "    docker compose restart      # riavvia tutto"
echo ""
warn "IMPORTANTE: Prima sessione LinkedIn — accedi al bot e fai login manuale:"
echo "    docker compose exec bot-worker node dist/index.js login"
echo ""
