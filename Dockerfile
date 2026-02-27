FROM mcr.microsoft.com/playwright:v1.42.0-jammy

WORKDIR /app

# Copy dependency files first to utilize Docker layer caching
COPY package.json package-lock.json ./

# Install explicit dependencies
RUN npm install

# Install Playwright browsers matching the version
RUN npx playwright install chromium

# Copy the rest of the application code
COPY . .

# Run TypeScript compilation if necessary, otherwise assuming it's run via ts-node or similar.
# In our project we typically run directly using ts-node or index.ts.
# Per sicurezza compiliamo prima di avviare.
RUN npm run build || echo "Build non definita, passo all'avvio."

# Impostiamo le environment variables essenziali 
ENV NODE_ENV=production

# The default command runs the built code
CMD ["npm", "start"]
