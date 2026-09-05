# Guida Operativa LinkedIn Bot

> Stato documento: guida operativa per usare il bot.
> Per overview tecnica usare `README.md`.
> Per regole anti-ban usare `GUIDA_ANTI_BAN.md`.
> Per tutte le variabili e gli esempi di configurazione usare `CONFIG_REFERENCE.md`.

Guida passo-passo per usare il bot. Ogni step spiega COSA fare, PERCHÉ, e COME verificare che abbia funzionato.

---

## Prima volta in assoluto (setup iniziale)

### 1. Requisiti
- Node.js 22+ installato
- `npm install` eseguito
- File `.env` configurato (copia da `.env.example` e compila)

### 2. Primo login
```powershell
.\bot.ps1 login
```
- Si apre un browser Firefox
- Fai login su LinkedIn manualmente (email + password + eventuale 2FA)
- Quando vedi il feed LinkedIn, chiudi il browser
- Il bot ha salvato i cookie — non serve più fare login finché la sessione non scade (~7 giorni)

**Come verificare**: `.\bot.ps1 doctor` → deve mostrare `"sessionLoginOk": true`

### 3. Importare i lead
I lead vanno importati da Sales Navigator nel database del bot.

**Opzione A — Da liste SalesNav (consigliato):**
```powershell
# Vedere le liste disponibili
.\bot.ps1 salesnav lists

# Importare una lista specifica
.\bot.ps1 sync-list --list "NOME_DELLA_LISTA"
```

**Opzione B — Da ricerche salvate SalesNav:**
```powershell
.\bot.ps1 sync-search --search-name "NOME_RICERCA" --list "nome-lista-destinazione"
```

**Opzione C — Da file CSV:**
```powershell
.\bot.ps1 import --file leads.csv --list "nome-lista"
```

**Come verificare**: `.\bot.ps1 funnel` → mostra quanti lead hai per stato (NEW, READY_INVITE, ecc.)

### 4. Primo invito (percorso guidato, un lead alla volta)

La promozione automatica dei lead NEW è **spenta** (`AUTO_PROMOTE_NEW_LEADS_ENABLED=false`, valore predefinito): il bot
non promuove più da solo decine di lead a READY_INVITE, quindi il primo invito lo scegli tu, un lead per volta.

1. Scegli un lead NEW e approvalo a mano (il comando verifica l'eleggibilità, poi lo porta NEW → READY_INVITE):
```powershell
.\bot.ps1 lead-approve <id>
```
Gli id li vedi con `.\bot.ps1 funnel` o dalla dashboard. Se il lead non è eleggibile il comando esce con codice 1 e dice
quale filtro lo ferma (lista vuota, lista non attiva, opt-out GDPR, campagna attiva, score sotto soglia) e come sanarlo.
Anche `.\bot.ps1 send-invites` con 0 lead READY_INVITE ti stampa il comando `lead-approve <id>` esatto da lanciare.

2. Controlla il `.env` del primo run (poi `npm run build`):
```ini
# .env del primo run: anti-ban prima di tutto
CHALLENGE_AUTO_RESOLVE_ENABLED=false
AI_PERSONALIZATION_ENABLED=false
INVITE_WITH_NOTE=false
REQUIRE_PROXY_FOR_AUTH=true
PROXY_BLOCK_DATACENTER=true
USE_JA3_PROXY=false
AUTO_PROMOTE_NEW_LEADS_ENABLED=false
# WEEKLY_INVITE_LIMIT: non sopra il limite dinamico dell'account
# NON portare HARD_INVITE_CAP a 1: satura il rapporto di velocità degli inviti e il risk engine frena.
# L'unicità del primo invito si impone con --limit 1 (sotto).
```

3. Anteprima senza inviare nulla, poi l'invio vero a schermo (browser visibile, orario 10-17 feriale):
```powershell
.\bot.ps1 send-invites --list "<lista>" --limit 1 --note none --no-enrich --dry-run
.\bot.ps1 send-invites --list "<lista>" --limit 1 --note none --no-enrich
```
`--no-enrich` sempre al primo run: l'enrichment manda i dati del lead a servizi esterni (Apollo/Hunter).

Quando il primo invito è andato bene e vuoi i volumi normali, riattiva la promozione automatica:
`AUTO_PROMOTE_NEW_LEADS_ENABLED=true` nel `.env`, poi `npm run build`.

**Come verificare**: `.\bot.ps1 funnel` → il lead approvato è READY_INVITE; dopo l'invio reale è INVITED.

---

## Uso quotidiano

### Inviare inviti (10 al giorno)
```powershell
# Test senza inviare nulla (verifica che tutto funzioni)
.\bot.ps1 send-invites --dry-run

# Invio reale
.\bot.ps1 send-invites
```
Il bot fa: warmup (feed, notifiche) → inviti con pause umane → wind-down → report.

### Tutto automatico (inviti + check accettazioni + messaggi)
```powershell
# Un ciclo completo
.\bot.ps1 autopilot --cycles 1

# Loop continuo (si ferma da solo fuori orario 9-19)
.\bot.ps1 autopilot
```

### Controllare lo stato
```powershell
.\bot.ps1 status          # Stato generale
.\bot.ps1 funnel          # Funnel lead per stato
.\bot.ps1 diagnostics     # Diagnostica completa
.\bot.ps1 doctor          # Check salute sistema
```

### Fermare il bot (MOLTO IMPORTANTE)
- **Modo corretto**: Premi `Ctrl+C` nel terminale.
- Il bot farà uno "shutdown graceful": se sta guardando un profilo, tornerà al feed (per sembrare umano) e poi chiuderà i browser salvando lo stato.
- **NON CHIUDERE LA FINESTRA DEL TERMINALE**: se chiudi la X in alto a destra, Windows uccide il processo all'istante. LinkedIn vedrà una disconnessione anomala brutale mentre stavi guardando un profilo. Questo è un forte segnale bot (zombie process trace). Usa sempre `Ctrl+C` e aspetta il messaggio "Database chiuso".
- Al termine ricevi alert Telegram "Bot Spento".

---

## Telegram

Il bot ti manda automaticamente:
- **"Bot Avviato"** — quando parte
- **"Bot Spento"** — quando si ferma
- **"🤝 X ha accettato l'invito!"** — quando qualcuno accetta
- **"💬 X ti ha risposto!"** — quando ricevi una risposta
- **"🔥 Lead caldo: X"** — quando un lead risponde con intent positivo
- **"📊 Daily Report"** — ogni sera alle 20:00 con tutti i KPI
- **"🚨 Allarmi"** — challenge LinkedIn, proxy morto, rischio ban

### Comandi Telegram
Puoi controllare il bot da Telegram:
- `pausa` o `pause` — mette in pausa il bot
- `riprendi` o `resume` — riprende
- `status` o `funnel` — mostra stato e KPI
- `restart` — riavvia il bot

---

## Cosa fa il bot quando lo lanci

1. **Working Hours Guard** — se fuori orario (9-19) non fa nulla, aspetta
2. **Doctor check** — verifica login, compliance, proxy
3. **Warmup** — naviga feed, notifiche (simula umano che apre LinkedIn)
4. **Inviti** — invia connessioni ai lead con pause umane, scroll, azioni organiche
5. **Check accettazioni** — verifica chi ha accettato
6. **Messaggi** — invia follow-up a chi ha accettato (se configurato)
7. **Wind-down** — torna al feed prima di chiudere
8. **Report** — invia riepilogo via Telegram

---

## Giorni della settimana

| Giorno | Inviti | Messaggi | Note |
|--------|--------|----------|------|
| Lunedì | 120% budget | 80% | Ramp-up graduale mattina |
| Martedì | 100% | 120% | |
| Mercoledì | 100% | 100% | |
| Giovedì | 70% | 130% | Focus messaggi |
| Venerdì | 50% → 0% | 50% → 0% | Cala dalle 14:00 |
| Sabato | 0% | 0% | Riposo |
| Domenica | 0% | 0% | Riposo |

---

## Problemi comuni

### "Il bot non fa nulla"
1. Sei fuori orario (9-19)? → Aspetta o cambia HOUR_START/HOUR_END
2. Il login è scaduto? → `.\bot.ps1 doctor` → se `sessionLoginOk: false` → `.\bot.ps1 login`
3. Il proxy è morto? → Controlla Telegram per alert "Proxy Morto"
4. L'account è in quarantine? → `.\bot.ps1 unquarantine` (quarantena globale) o `.\bot.ps1 unquarantine --account <id>` (singolo account; lo stato è in `.\bot.ps1 status` → `quarantinedAccounts`)

### "Non ricevo Telegram"
1. Verifica TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID nel .env
2. Il bot deve essere in esecuzione (run-loop o autopilot) per mandare alert
3. Apri la chat col bot su Telegram e manda /start

### "Errore proxy"
1. Se 1-2 volte: il bot riprova dopo 15 minuti
2. Se 3+ volte consecutive: il bot si ferma e ti avvisa su Telegram
3. Verifica credenziali proxy nel .env → `.\bot.ps1 resume` per riprendere

### "Challenge LinkedIn"
1. Il bot si ferma automaticamente
2. Vai su LinkedIn manualmente e risolvi il challenge
3. `.\bot.ps1 resume` per riprendere

---

## Configurazione (.env)

Le impostazioni principali:

| Impostazione | Valore | Cosa fa |
|-------------|--------|---------|
| HARD_INVITE_CAP | 10 | Max inviti al giorno |
| HOUR_START / HOUR_END | 9 / 19 | Orario lavorativo |
| BROWSER_ENGINE | firefox | Browser usato (firefox = anti-detect migliore) |
| HEADLESS | false | Browser visibile sullo schermo |
| WEEKLY_INVITE_LIMIT | 50 | Max inviti a settimana |
| AUTO_PROMOTE_NEW_LEADS_ENABLED | false | Promozione automatica NEW → READY_INVITE (spenta: il primo invito passa da `lead-approve <id>`) |
| WITHDRAW_INVITES_ENABLED | true | Ritira inviti non accettati dopo 21 giorni |
| DAILY_REPORT_AUTO_ENABLED | true | Report Telegram automatico alle 20:00 |
| TELEGRAM_BOT_TOKEN | (tuo token) | Token del bot Telegram |
| TELEGRAM_CHAT_ID | (tuo chat id) | ID della chat Telegram |

Per cambiare un valore: modifica il `.env`, poi `npm run build`.

Per il dettaglio completo della configurazione non usare questa guida come reference primaria:

- [CONFIG_REFERENCE.md](CONFIG_REFERENCE.md)
