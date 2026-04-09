#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# LinkedIn Bot — Docker Release Script
# A14: Versioned build + tag per rollback immediato
#
# Uso:
#   bash scripts/docker-release.sh              # build + tag versione corrente
#   bash scripts/docker-release.sh promote      # promuovi versione corrente a :stable
#   bash scripts/docker-release.sh rollback     # rollback a ultima :stable
#   bash scripts/docker-release.sh list         # mostra versioni disponibili
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info() { echo -e "${BLUE}[i]${NC} $1"; }

IMAGE_NAME="${DOCKER_IMAGE:-linkedin-bot}"
PKG_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")
GIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "nogit")
GIT_CLEAN=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
TIMESTAMP=$(date +%Y%m%d-%H%M)

VERSIONED_TAG="${IMAGE_NAME}:v${PKG_VERSION}-${GIT_HASH}"
LATEST_TAG="${IMAGE_NAME}:latest"
STABLE_TAG="${IMAGE_NAME}:stable"

CMD="${1:-build}"

case "$CMD" in
  build)
    echo ""
    echo "═══════════════════════════════════════════════"
    echo "  LinkedIn Bot — Docker Build"
    echo "  Version : v${PKG_VERSION}"
    echo "  Git     : ${GIT_HASH}"
    echo "  Image   : ${VERSIONED_TAG}"
    echo "═══════════════════════════════════════════════"
    echo ""

    if [ "$GIT_CLEAN" != "0" ]; then
      warn "Working tree non è pulito ($GIT_CLEAN file modificati) — la build includerà modifiche non committate."
      warn "Per una build pulita: git commit prima di eseguire questo script."
    fi

    log "Building Docker image..."
    docker build \
      --build-arg PLAYWRIGHT_IMAGE_TAG=v1.58.2-noble \
      --label "version=${PKG_VERSION}" \
      --label "git-hash=${GIT_HASH}" \
      --label "built-at=${TIMESTAMP}" \
      -t "${VERSIONED_TAG}" \
      -t "${LATEST_TAG}" \
      .

    log "Build completata: ${VERSIONED_TAG}"
    info "Per promuovere a stable: bash scripts/docker-release.sh promote"
    info "Per rollback a stable:   bash scripts/docker-release.sh rollback"

    # Salva l'hash della versione appena buildata
    echo "${VERSIONED_TAG}" > .docker-current-tag
    echo "Buildata il ${TIMESTAMP}: ${VERSIONED_TAG}" >> .docker-release-history.txt
    log "Tag salvato in .docker-current-tag"
    ;;

  promote)
    CURRENT_TAG=$(cat .docker-current-tag 2>/dev/null || echo "")
    if [ -z "$CURRENT_TAG" ]; then
      err "Nessun tag corrente trovato. Eseguire prima: bash scripts/docker-release.sh build"
    fi

    log "Promuovendo ${CURRENT_TAG} → ${STABLE_TAG}"
    docker tag "${CURRENT_TAG}" "${STABLE_TAG}"

    # Salva la versione stable
    echo "${CURRENT_TAG}" > .docker-stable-tag
    echo "STABLE promosso il ${TIMESTAMP}: ${CURRENT_TAG}" >> .docker-release-history.txt
    log "Stable aggiornato: ${STABLE_TAG} → ${CURRENT_TAG}"
    ;;

  rollback)
    STABLE_TAG_SRC=$(cat .docker-stable-tag 2>/dev/null || echo "")
    if [ -z "$STABLE_TAG_SRC" ]; then
      err "Nessuna versione stable trovata. Usa 'promote' su una versione verificata prima."
    fi

    warn "ROLLBACK: PM2/container verrà riavviato con ${STABLE_TAG_SRC}"
    info "Versione corrente: $(cat .docker-current-tag 2>/dev/null || echo 'unknown')"
    info "Versione stable:   ${STABLE_TAG_SRC}"
    echo ""
    read -r -p "Confermi rollback? [y/N] " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
      warn "Rollback annullato."
      exit 0
    fi

    docker tag "${STABLE_TAG_SRC}" "${LATEST_TAG}"
    echo "ROLLBACK al ${TIMESTAMP}: ${STABLE_TAG_SRC}" >> .docker-release-history.txt

    log "Rollback completato. Riavvio servizi..."
    if command -v docker-compose &>/dev/null; then
      docker-compose down && docker-compose up -d
      log "docker-compose riavviato"
    else
      warn "docker-compose non trovato. Riavvia manualmente i container."
    fi
    ;;

  list)
    echo ""
    echo "═══ Docker Image History ═══"
    docker images "${IMAGE_NAME}" --format "{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}" 2>/dev/null || echo "(nessuna immagine trovata)"
    echo ""
    echo "═══ Release History ═══"
    cat .docker-release-history.txt 2>/dev/null || echo "(nessuna release storicizzata)"
    echo ""
    echo "Current : $(cat .docker-current-tag 2>/dev/null || echo 'n/a')"
    echo "Stable  : $(cat .docker-stable-tag 2>/dev/null || echo 'n/a')"
    ;;

  *)
    echo "Uso: bash scripts/docker-release.sh [build|promote|rollback|list]"
    exit 1
    ;;
esac
