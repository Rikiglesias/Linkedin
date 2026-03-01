# n8n Workflows (Import)

File disponibili:
- `workflow_bot_events.json`
- `workflow_news_intel.json`

## 1) Import
1. In n8n vai su `Workflows -> Import from File`.
2. Importa entrambi i file.
3. Apri il workflow e salva.

## 2) Variabili ambiente n8n richieste
- `WEBHOOK_SYNC_SECRET` (deve combaciare con `.env` del bot)
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

## 3) Mapping bot -> n8n
Nel bot (`.env`):
- `EVENT_SYNC_SINK=WEBHOOK`
- `WEBHOOK_SYNC_ENABLED=true`
- `WEBHOOK_SYNC_URL=http://127.0.0.1:5678/webhook/linkedin-events`
- `WEBHOOK_SYNC_SECRET=<stesso segreto di n8n>`

## 4) Attivazione
1. Attiva prima `LinkedIn Bot Events (Webhook Ingest)`.
2. Lancia nel bot: `npm start -- sync-run-once`.
3. Verifica che arrivi almeno un evento in n8n.
4. Attiva poi `LinkedIn News Intelligence (RSS Watch)`.

## Note operative
- Il workflow eventi include verifica firma HMAC (`x-signature-sha256`) e dedup.
- Il workflow news gira ogni 60 minuti, filtra keyword e invia solo novità non già viste.
- Modifica feed/keyword direttamente nel node `Filter + Summarize`.
