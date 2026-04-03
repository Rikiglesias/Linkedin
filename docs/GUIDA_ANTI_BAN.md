# ⚠️ Guida Anti-Ban — Regole Operative e Protezioni

> Stato documento: guida operativa per l'operatore umano.
> Per dettagli tecnici di implementazione usare `ARCHITECTURE_ANTIBAN_GUIDE.md`.
> Per il modello di minaccia formale usare `THREAT_MODEL.md`.

Questa guida spiega le regole da seguire per evitare blocchi e illustra i meccanismi invisibili che il bot usa per proteggere il tuo account.

---

## 🛡️ Come il bot ti protegge in modo invisibile

Il bot v2.0 è dotato di un motore *stealth* a 19 strati. Non devi configurarli, funzionano in background:

1. **IP Reputation Pre-Check**: Prima di lanciare il browser, il bot interroga AbuseIPDB. Se l'IP del tuo proxy risulta "sporco" (usato da spammer o bot in passato), il bot si ferma prima ancora di aprire LinkedIn. Questo evita di bruciare l'account connettendosi da un IP già segnalato.
2. **Behavioral Fingerprint (Profilo Comportamentale)**: Il bot assegna al tuo account un "profilo umano" unico (velocità di scroll, latenza nei click, preferenze di lettura). Questo profilo rimane costante: il bot si comporterà sempre con lo stesso stile per il tuo account, evitando cambi bruschi che i sistemi anti-bot (ML) usano per individuare le automazioni.
3. **Coerenza TLS (JA3)**: Quando usi un proxy normale, il bot fa in modo che la firma del tuo browser (Chrome, Mac, Windows) combaci perfettamente con il modo in cui i pacchetti di rete vengono cifrati (Chromium TLS). LinkedIn e Cloudflare non possono distinguere la connessione da un browser reale.
4. **Tempi di reazione Log-Normali**: Il bot non aspetta mai un tempo fisso (es. "3 secondi"). Usa una distribuzione statistica *Log-Normale*: risponde per lo più velocemente, ma a volte ha pause più lunghe (simulando una distrazione umana o la lettura di una notifica).
5. **Circuit Breaker per Fallimenti**: Se il proxy muore o LinkedIn risponde con troppi errori (429 Too Many Requests), il bot interrompe immediatamente la sessione e va in pausa. Niente pattern di *reconnect* furiosi.

---

## 🚨 Come gestire gli avvisi del Pre-Flight

Quando avvii un workflow, il sistema esegue un "Pre-Flight Check". Non ignorare mai i warning rossi (`[!!!]`):

- **`Proxy IP <IP> BLACKLISTED`**: L'IP che stai per usare è segnalato come malevolo. **Azione**: Riavvia il bot o il router/proxy finché non ottieni un IP pulito. Non forzare la partenza.
- **`Nessuna sessione LinkedIn trovata` / `Sessione scaduta`**: Il cookie di login è vuoto o invalidato. **Azione**: Esegui il comando `npm run create-profile` o `npm run start:dev -- run-login` per accedere di nuovo manualmente.
- **`Budget inviti esaurito`**: Il cap giornaliero è rigido e garantito atomicamente dal DB. Se è esaurito, forzare il sistema non funzionerà: il bot si rifiuterà di cliccare "Connect".

---

## 🔴 Regole Critiche (viola queste = ban garantito)

### 1. Attenzione all'IP "Teletrasporto" (Uso parallelo browser)
Puoi tenere aperto LinkedIn sul tuo telefono o sul tuo PC personale mentre il bot gira, **MA** devi fare attenzione agli IP. Se il bot usa un proxy a Milano, e tu apri LinkedIn dal PC connesso a una VPN a Tokyo, LinkedIn vede il tuo account connesso da Milano e Tokyo nello stesso secondo. Questo è un "teletrasporto" impossibile per un umano e causa blocchi o richieste di ri-autenticazione. 
*Se usi il bot senza proxy, usa LinkedIn dal PC normalmente.*
*Se usi il bot con un proxy estero, evita di usare LinkedIn dal PC contemporaneamente.*

### 2. VPN Personali vs Proxy del Bot
Se nel `.env` hai configurato un `PROXY_URL` (es. Oxylabs), il bot instrada tutto il suo traffico direttamente lì. La tua VPN personale sul PC (es. NordVPN) **non influenza il bot**. 

### 3. NON modificare manualmente lo stato dei lead nel DB
Il bot traccia ogni transizione di stato atomicamente. Se cambi `status = 'READY_INVITE'` a mano su un lead già INVITED, il bot tenterà di re-invitarlo → LinkedIn bloccherà l'azione perché l'invito esiste già → il bot andrà in errore. Usa solo l'apposita interfaccia di recovery.

### 4. NON lanciare due istanze del bot contemporaneamente
Non lanciare mai due finestre terminale con `npm run start:dev` sullo stesso account. Questo corrompe il database locale (database locked), crea collisioni nel profilo del browser Chromium e raddoppia i ritmi delle azioni rendendo il bot rilevabile.

---

## 🟡 Regole Importanti

### 5. Lascia che il bot gestisca il ritmo (Run-Loop)
Non serve spezzare le attività in "sessioni" manuali. Il comando `run-loop` è progettato per girare in background tutto il giorno. Spalma gli inviti e i messaggi con pause lunghe (2-5 minuti) e fa finte attività organiche in mezzo. Avvialo la mattina e lascialo fare.

### 6. Non superare mai i 100 inviti a settimana
LinkedIn ha un limite assoluto di ~100 inviti a settimana. Il bot ha un limite di sicurezza impostato a 70. Non forzare l'invio manuale oltre questa soglia, altrimenti scattano le penalità. Per account nuovi (< 3 mesi), non superare i 30/settimana.

### 8. Personalizza le note (Usa l'AI)
Gli inviti senza nota hanno un acceptance rate del 15-20%. Con la nota AI (GPT-5.4) che estrae il contesto del profilo (about/experience), sale al 30-40%. Più acceptance = meno inviti pending = meno rischio che LinkedIn classifichi il tuo account come spammer. **Usa sempre la modalità `ai`**.

### 9. Tieni il profilo attivo "umanamente"
LinkedIn si aspetta che un utente attivo:
- Scorra il feed qualche volta a settimana
- Metta qualche like ogni tanto (il bot simula il dwell time per questo)
- Aggiorni il profilo occasionalmente

Il bot simula *decoy actions* (azioni organiche finte per nascondere il pattern di automazione), ma una vera attività organica è l'ideale.

---

## 🟢 Best Practice

### 10. Account warmup per nuovi profili

**PRIMA di lanciare il bot su un account nuovo**, fai almeno 1 settimana di attività manuale:
- Completa il profilo al 100% (foto, headline, about, experience, education)
- Scorra il feed 10-15 min/giorno
- Metti 5-10 like a post rilevanti
- Connettiti manualmente con 3-5 colleghi reali
- Pubblica 1-2 post originali

Il `GROWTH_MODEL_ENABLED=true` gestisce il ramp-up automatico del bot, ma LinkedIn è molto più sospettoso di account che passano da 0 attività a bot attivo. Un profilo "freddo" che improvvisamente invia 20 inviti/giorno è un red flag immediato.

**Dopo la settimana manuale**, lancia il bot con gradualità:
- **Settimana 1-2**: Solo 5-10 inviti/giorno, con nota personalizzata
- **Settimana 3-4**: Sali a 15-20/giorno
- **Da settimana 5**: Budget pieno (il bot ha il warmup automatico, basta non forzarlo)

### 11. Monitora il pending ratio
Se hai > 70% di inviti ancora in pending (non accettati), sei a rischio. Significa che stai invitando persone a caso. **Segmenta meglio la lista.** Il risk engine del bot ti blocca automaticamente, ma è meglio non arrivarci.

### 12. Non ripristinare il DB dopo un ban temporaneo
Se LinkedIn ti limita per una settimana, **aspetta davvero** una settimana. Non cancellare il DB e ricominciare — LinkedIn traccia lato server.

### 13. Proxy: usa quelli di qualità
Proxy residenziali > datacenter. Il bot supporta escalation mobile automatica. Non usare proxy gratuiti — sono in blacklist.

### 14. Un account = un proxy "sticky"
Non cambiare IP ogni 5 minuti. Un umano ha un IP stabile per ore. Il bot gestisce questo automaticamente, ma assicurati di non riconfigurare i proxy durante una sessione.

---

## 🚨 Segnali di Pericolo — Fermati Subito

| Segnale | Cosa fare |
|---------|-----------|
| "Verifica la tua identità" (CAPTCHA, SMS) | Risolvilo manualmente, poi pausa 48h |
| "Hai raggiunto il limite settimanale di inviti" | Pausa 7 giorni completi |
| Molti profili "Impossibile trovare il bottone Connect" | I selettori sono cambiati → apri una issue |
| Acceptance rate < 10% | Ferma tutto, rivedi il targeting della lista |
| Account temporaneamente limitato | Pausa 1 settimana, abbassa i limiti del 50% al rientro |

---

## 📋 Checklist Pre-Sessione

- [ ] Nessun altro browser ha LinkedIn aperto
- [ ] VPN personale spenta
- [ ] Orario lavorativo del paese target
- [ ] Primera sessione della giornata (no spam)
- [ ] Proxy configurati e funzionanti
- [ ] Ultima sessione > 8 ore fa
