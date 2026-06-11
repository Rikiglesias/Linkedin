# n8n Workflows

Workflow JSON importabili in n8n. Non sono prova di stato live: un workflow e' operativo solo dopo import, credenziali collegate, validazione e run manuale riuscito.

## Morning Briefing

File: `morning-briefing.json`

- Stato intenzionale: `active:false` fino a validazione manuale in n8n.
- Trigger: ogni giorno alle 08:00.
- Input: `C:\Users\albie\todos\active.md` + `C:\Users\albie\memory\decisions.md`.
- Output: bozza Gmail verso `albieri.riccardo02@gmail.com`, non invio automatico.
- Credenziale richiesta in n8n: `Gmail (Riccardo)` (`gmailOAuth2`). Il JSON non contiene ID finti: dopo import va associata la credenziale reale nell'UI n8n.
- Validazione MCP: struttura valida (`valid:true`). Warning residui attesi finche' il workflow non e' importato con credenziale reale e senza error workflow dedicato.
- Stato live locale: non importato automaticamente in questa sessione; `n8n` CLI assente, `N8N_BASE_URL`/`N8N_API_KEY` non configurati, `127.0.0.1:5678` non raggiungibile.

## Check prima di attivare

1. Importare il JSON in n8n.
2. Collegare la credenziale `Gmail (Riccardo)`.
3. Eseguire run manuale e verificare che venga creata una bozza Gmail.
4. Solo dopo attivare il workflow.

## LinkedIn Detection Sentinel

File: `linkedin-detection-sentinel.json`

Sentinella **detection-news**: ogni giorno alle 06:30 raccoglie ~20 fonti pubbliche su cambiamenti nei sistemi di detection/anti-automation di LinkedIn (vendor di automazione, community Reddit/HN, issue tracker di tool unofficial, status page, vendor anti-bot, fonti legali, ToS LinkedIn), le filtra, deduplica gli item già visti, le fa classificare da Claude per `severity`/`impact` e — solo se ci sono segnali — invia un digest Telegram **e** notifica il bot via webhook.

**Cosa NON fa (vincolo di prodotto):** non modifica MAI i parametri del bot. L'unica azione automatica è una **pausa difensiva** del bot quando un segnale è `critical` (riduce il rischio, non lo aumenta). Tutto il resto è solo segnalazione: la decisione resta umana.

- Stato intenzionale: `active:false` fino a validazione manuale in n8n.
- Trigger: cron `30 6 * * *` (ogni giorno 06:30).
- Validazione MCP n8n: `valid:true` (0 errori; i warning residui sono falsi positivi — nodi generatori, ramo `false` di IF, long-chain).
- Anti-ban: **SICURO** — non tocca browser/timing/fingerprint/sessione del bot; fa solo fetch HTTP anonimi di pagine pubbliche, fuori dalle sessioni LinkedIn del bot (`/antiban-review` verdetto nel binding `~/todos/detection-news.md`).
- Fonti verificate vive il 2026-06-11 (workflow di ricerca `wf_c13bbb76-897`): l'elenco completo + riserva + scartate è nel binding del goal.

### Endpoint ricevente (già nel bot)

Il webhook `POST /api/linkedin-change-alert` (`src/api/routes/linkedinChangeAlert.ts`) esiste già: valida con zod, registra un incident + outbox event, e mappa `action` → `pause` (≤120 min) / `warn` (alert) / `log`. La sentinella è il **produttore** che mancava.

### Env vars richieste in n8n

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — digest.
- `ANTHROPIC_API_KEY` — classificazione AI (news pubbliche = zero PII → cloud ok).
- `DASHBOARD_API_KEY` — header `X-Api-Key` verso il webhook locale (stesso valore di `DASHBOARD_API_KEY` del bot; il middleware è fail-closed).
- `SENTINEL_AI_MODEL` (opzionale) — default `claude-sonnet-4-6`; impostare `claude-haiku-4-5-20251001` per ridurre i costi.

### Runbook di attivazione

1. Importare `linkedin-detection-sentinel.json` in n8n.
2. Collegare la credenziale `Telegram Bot` (stessa degli altri workflow).
3. Impostare le 4 env vars sopra nell'istanza n8n (NON nel JSON: zero segreti versionati).
4. Avviare il bot (deve esporre `http://localhost:3000` con `DASHBOARD_API_KEY` configurata).
5. **Test end-to-end in sicurezza**: eseguire un **run manuale**. Al primo run il dedup è vuoto → arrivano molti item; verificare che (a) il digest Telegram arrivi, (b) gli eventuali POST al bot creino incident (`action=log`/`warn` non mettono in pausa; solo `critical` → pause). Se si vuole un primo giro a impatto zero sul bot, lasciare `DASHBOARD_API_KEY` non configurata in n8n: i POST falliranno (gestiti da `onError: continueRegularOutput`) ma il digest Telegram funziona comunque.
6. Solo dopo un run pulito → attivare il workflow.

> Il vecchio `linkedin-detection-monitor.json` è stato rinominato `weekly-safety-reminder.json`: era (ed è) solo un **promemoria statico** settimanale, non un monitor — il nome induceva in errore. La sentinella sopra è il monitoraggio reale.
