# TODO — Operations & Future Steps

> Lista aggiornata: 2026-03-14
> Tutte le implementazioni codice (Sprint A-D, Anti-Ban, Firefox) sono state completate e verificate (EXIT 0).
> Questa lista contiene solo i prossimi step operativi e le future implementazioni.

---

## 1. LUNEDÌ MATTINA (Step Operativi)
Da fare in orario lavorativo (9:00 - 19:00).

- [ ] **Build del progetto** (`npm run build`)
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
- [ ] **Verifica 360° Configurazioni e Tool Esterni**: controllare che TUTTI i tool configurati nel `.env` si intreccino correttamente durante il workflow, verificando specificamente:
  - **OpenAI/Ollama**: personalizzazione messaggi, analisi intent, score dei lead e fallback
  - **Proxy Oxylabs & IP Reputation**: rotazione corretta IP, mantenimento sessioni, risoluzione anti-bot, verifica IP tramite **AbuseIPDB** e **Proxy Quality ASN API**
  - **Telegram Bot**: ricezione report puntuale, allarmi attivi, comandi di controllo
  - **Integrazioni Data (Apollo, Clearbit, Hunter)**: risoluzione API key, rate limits e fallback incrociato (es. da Apollo a Email Guesser se API fallisce)
  - **AI / Scraping Interno**: *Person Data Finder*, *Email Guesser*, *Web Search Enricher* funzionanti e silenti
  - **Database & Sync**: consistenza SQLite, sync (opzionale) Supabase
- [ ] **Attivare Inbox Auto-Reply** (`INBOX_AUTO_REPLY_ENABLED=true` nel `.env` per far rispondere l'AI)

---

## 3. PIÙ AVANTI (Futuro & Scaling)
Decisioni e implementazioni rimandate a quando il volume sarà più alto o ci sarà necessità.

- [ ] **Account 2 (Italia)**: configurare proxy, sessione e lingua
- [ ] **Camoufox/Patchright**: valutare implementazione se si scala oltre i 50 inviti/giorno
- [ ] **Dashboard Ban Probability**: aggiungere card dedicata al risk score nella UI della dashboard
- [ ] **Watchdog Esterno**: script separato che avvisa su Telegram se il processo del bot muore inaspettatamente

---

## Completato in questa sessione (Archivio)
- `npm run build` (fatto ma da rifare lunedì per sicurezza)
- Pulizia regole/memoria codebase (completata)
- Creazione `GUIDA.md` utente 360° (completata)
- Attivazione Daily Report (ore 20:00)
- Configurazione: 10 inviti/giorno, senza nota, NO sabato/domenica, Firefox attivato
- Telegram verificato funzionante
- Note: Variazione messaggi AI e Nota con invito sono stati scartati per ora per decisione utente.
