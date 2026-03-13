# ─── Stage 1: Builder ────────────────────────────────────────────────────────
ARG PLAYWRIGHT_IMAGE_TAG=v1.58.2-noble
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_IMAGE_TAG} AS builder

WORKDIR /app

# Copia i file di dipendenza prima per sfruttare il layer caching
COPY package.json package-lock.json tsconfig.json ./

# Installa TUTTE le dipendenze (incluse devDependencies per la compilazione)
RUN npm ci

# Copia il codice sorgente
COPY src/ ./src/
COPY public/ ./public/
COPY scripts/ ./scripts/

# Compila TypeScript — exit 1 se fallisce (no || echo)
RUN npm run build

# ─── Stage 2: Runner ─────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:${PLAYWRIGHT_IMAGE_TAG} AS runner

WORKDIR /app

ENV NODE_ENV=production

# Installa solo le dipendenze di produzione
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Installa i browser Playwright
RUN npx playwright install chromium --with-deps

# Copia il codice compilato e i file statici
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/scripts ./scripts

# Crea utente non-root e directory dati con permessi corretti
RUN groupadd -r botuser && useradd -r -g botuser -d /app botuser \
    && mkdir -p data logs plugins \
    && chown -R botuser:botuser /app

# Switch a utente non-root (riduce superficie d'attacco in caso di RCE)
USER botuser

# Avvio bot in modalità autopilot (inviti + check + messaggi + follow-up)
# Per la dashboard: docker run ... node dist/index.js dashboard
# Per entrambi: usare docker-compose con 2 servizi separati
CMD ["node", "dist/index.js", "autopilot"]
