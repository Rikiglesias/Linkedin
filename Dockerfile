# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.42.0-jammy AS builder

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
FROM mcr.microsoft.com/playwright:v1.42.0-jammy AS runner

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

# Crea directory dati con permessi corretti
RUN mkdir -p data logs && chmod 700 data && chmod 700 logs

# Healthcheck via API
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -sf http://localhost:3000/api/health || exit 1

# Avvio dal codice compilato (non ts-node in produzione)
CMD ["node", "dist/index.js"]
