# ⚠️ Guida Anti-Ban — Regole Operative per l'Utente

Queste sono regole **per te**, non per il codice. Il bot fa la sua parte, ma se l'utente si comporta male, LinkedIn ti becca lo stesso.

---

## 🔴 Regole Critiche (viola queste = ban garantito)

### 1. NON aprire LinkedIn su un altro browser mentre il bot gira
LinkedIn vede **due sessioni attive** dallo stesso account, con fingerprint diversi → red flag immediata. Se devi controllare qualcosa, fallo dal telefono sull'app (IP diverso, fingerprint diverso, è previsto).

### 2. NON usare VPN personali durante il bot
Il bot usa proxy dedicati con IP residenziali/mobile. Se tu contemporaneamente navighi con una VPN, LinkedIn vede lo stesso account da 2 IP diversi nello stesso minuto → sospetto.

### 3. NON modificare manualmente lo stato dei lead nel DB
Il bot traccia ogni transizione di stato. Se cambi `status = 'READY_INVITE'` a mano su un lead già INVITED, il bot lo re-invita → LinkedIn vede invito doppio → flag.

### 4. NON lanciare il bot multiplo (2 istanze)
Una sola istanza per account. Due istanze = due browser = due fingerprint = ban.

---

## 🟡 Regole Importanti

### 5. Rispetta gli orari lavorativi
Lancia il bot durante orari lavorativi del paese target (9:00-18:00). Un umano non manda 25 inviti alle 3 di notte.

### 6. 1 sessione al giorno, massimo 2
Non lanciare il bot 5 volte nello stesso giorno. Un uso realistico è:
- **Mattina**: sessione inviti (20-30 inviti max)
- **Pomeriggio** (opzionale): sessione messaggi per chi ha accettato

### 7. Non superare mai 80-100 inviti a settimana
LinkedIn ha un soft cap a ~100 inviti/settimana. Il bot ha il warmup automatico, ma se forzi i limiti manualmente rischi. Per account nuovi (< 30 giorni), stai sotto i 30/settimana.

### 8. Personalizza le note
Gli inviti senza nota hanno un acceptance rate del 15-20%. Con nota personalizzata sale al 30-40%. Più acceptance = meno pending = meno rischio. **Usa sempre la modalità `ai`**.

### 9. Tieni il profilo attivo "umanamente"
LinkedIn si aspetta che un utente attivo:
- Scorra il feed qualche volta a settimana
- Metta qualche like ogni tanto
- Aggiorni il profilo occasionalmente

Il bot simula decoy actions, ma una vera attività organica è meglio.

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
