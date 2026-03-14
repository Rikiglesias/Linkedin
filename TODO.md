# TODO — Operations & Future Steps

> Lista aggiornata: 2026-03-14 (sessione implementazione TODO)
> Tutte le implementazioni codice (Sprint A-D, Anti-Ban, Firefox) sono state completate e verificate (EXIT 0).
> Questa lista contiene solo i prossimi step operativi e le future implementazioni.

---

## 1. LUNEDÌ MATTINA (Step Operativi)
Da fare in orario lavorativo (9:00 - 19:00).

- [x] **Build del progetto** (`npm run build`) — EXIT 0, backend + frontend
- [ ] **Pulizia sessione Chromium** (`Remove-Item -Recurse -Force data\session\*` — elimina profilo Chromium vecchio, Firefox ne crea uno nuovo)
- [ ] **Login account Europa** (`.\bot.ps1 login` — necessario perché siamo passati a Firefox)
- [ ] **Scoprire liste SalesNav** (`.\bot.ps1 salesnav lists`)
- [ ] **Importare lead da SalesNav** (`.\bot.ps1 sync-list --list "NOME"`)
- [ ] **Dry-run test** (`.\bot.ps1 send-invites --dry-run` — verifica che tutto giri senza inviare)
- [ ] **Primo run reale** (`.\bot.ps1 autopilot --cycles 1` — invia i primi 10 inviti)
- [ ] **Verifica Alert Telegram** (controllare che arrivi la notifica durante il run reale)

---

## 2. QUESTA SETTIMANA / PROSSIMI GIORNI
Azioni da fare dopo che il bot è partito stabilmente.

- [ ] **Inserire template messaggi follow-up** (in inglese, per l'account Europa)
- [ ] **Testare Enrichment** (verificare che Apollo funzioni: `.\bot.ps1 enrich-fast`)
- [x] **Verifica 360° Configurazioni e Tool Esterni** — completata con 6 livelli di controllo:
  - **OpenAI**: cloud GPT-5.4 configurato, fallback Ollama locale, providerRegistry con chain OpenAI→Ollama→template ✅
  - **Proxy Oxylabs**: mobile IP italiano, sticky session 30min, rotation ogni 5 job/15min (session rotation con singolo proxy) ✅
  - **IP Reputation**: AbuseIPDB key configurata, max abuse score 25 ✅
  - **Telegram**: alerts con rate limiter (10/min), daily report ore 20, comandi via chat, broadcaster multi-canale ✅
  - **Apollo**: API key configurata, enrichment disponibile via `enrich-fast` ✅
  - **Database & Sync**: SQLite locale + Supabase cloud + Webhook n8n (127.0.0.1:5678) — tutti configurati ✅
  - **Validation config**: 78+ regole verificate, 0 errori, 1 warning atteso (JA3 gap — non critico con Firefox)
- [ ] **Attivare Inbox Auto-Reply** (`INBOX_AUTO_REPLY_ENABLED=true` nel `.env` per far rispondere l'AI)
- [x] **Ottimizzare .env stealth** — applicati 3 fix con verifica L1-L6:
  - `SESSION_WIND_DOWN_PCT=0.20` aggiunto (wind-down più graduale a fine sessione) ✅
  - `MESSAGE_SCHEDULE_MIN/MAX_DELAY_HOURS`: corretto da 1-4h a 48-120h (2-5 giorni post-accettazione, anti-ban critico) ✅
  - `POST_CREATION_DEFAULT_TONE`: corretto da `thought_leadership` (invalido) a `professional` ✅
  - Già OK: `RANDOM_ACTIVITY=true/0.20`, `INTER_JOB=120-180s`, `NO_BURST=25-75s`, `PROXY_ROTATE=5job/15min`
  - ⚠️ Confermato: `WARMUP_ENABLED=false` (account maturi), `INVITE_WITH_NOTE=false` (decisione utente)
- [ ] **Creare campagna drip post-accettazione**: via dashboard (`npm run dashboard`) o API REST (`POST /api/v1/campaigns`). Il sistema campaigns + campaign_steps + lead_campaign_state esiste già (migrazione 030). Struttura: Step 1 = Invite → Step 2 = Wait accettazione → Step 3 = Messaggio follow-up dopo N giorni
- [x] **Configurare messaggi post-accettazione**: `MESSAGE_SCHEDULE_MIN_DELAY_HOURS=48` e `MAX=120` (2-5 giorni) — compromesso tra naturalezza e velocità outreach

---

## 3. PIÙ AVANTI (Futuro & Scaling)
Decisioni e implementazioni rimandate a quando il volume sarà più alto o ci sarà necessità.

- [ ] **Account 2 (Italia)**: configurare proxy, sessione e lingua
- [ ] **Camoufox/Patchright**: valutare e implementare se si scala oltre i 50 inviti/giorno (attualmente NON implementato nella codebase)
- [ ] **Dashboard Ban Probability**: aggiungere card dedicata al risk score nella UI della dashboard
- [ ] **Watchdog Esterno**: script separato che avvisa su Telegram se il processo del bot muore inaspettatamente
- [ ] **Attivare Post Creator** (`POST_CREATION_ENABLED=true`): il `postCreatorWorker.ts` esiste già nel codice per creare post LinkedIn automatici e generare inbound. Utile dopo che l'outreach è stabile.
- [ ] **Integrazione n8n + Webhook**: importare `n8n/workflow_bot_events.json` in n8n, configurare `WEBHOOK_SYNC_ENABLED=true` + `WEBHOOK_SYNC_URL` + `WEBHOOK_SYNC_SECRET` + `EVENT_SYNC_SINK=WEBHOOK` per aggiornamento CRM automatico via webhook. Non necessario per partire.

---

## Completato in questa sessione (Archivio)
- `npm run build` (fatto ma da rifare lunedì per sicurezza)
- Pulizia regole/memoria codebase (completata)
- Creazione `GUIDA.md` utente 360° (completata)
- Attivazione Daily Report (ore 20:00)
- Configurazione: 10 inviti/giorno, senza nota, NO sabato/domenica, Firefox attivato
- Telegram verificato funzionante
- Note: Variazione messaggi AI e Nota con invito sono stati scartati per ora per decisione utente.

### Sessione 2026-03-14 (implementazione TODO)
- `npm run build` EXIT 0 (backend + frontend)
- Fix .env: `MESSAGE_SCHEDULE` da 1-4h a 48-120h (anti-ban critico)
- Fix .env: `POST_CREATION_DEFAULT_TONE` da `thought_leadership` (invalido) a `professional`
- Aggiunto: `SESSION_WIND_DOWN_PCT=0.20` (wind-down più graduale)
- Verifica 360° tool esterni completata (OpenAI, Proxy, Telegram, Apollo, Supabase, Webhook, IP Reputation)
- 6 livelli di controllo completati (L1-L6)
- `npm run pre-modifiche` EXIT 0 → modifiche → `npm run post-modifiche` EXIT 0 (204 test, 0 errori, 0 warning)
