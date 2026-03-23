# Email Inbox Monitoring — Workflow n8n

## Obiettivo
Monitorare l'email dell'account LinkedIn per risposte dei lead in tempo reale.
Response time: da 12-24h (inbox scan periodico) a 0-2h (email notification).

## Setup

### 1. Trigger: IMAP/Gmail ogni 5 minuti
Monitora la casella email collegata all'account LinkedIn per nuove email con subject:
- "X ti ha inviato un messaggio" / "X sent you a message"
- "X ha risposto al tuo messaggio" / "X replied to your message"

### 2. Parser: estrai nome mittente e lead URL
Dal body dell'email LinkedIn, estrai il link al profilo del mittente.

### 3. Match con DB lead
POST http://localhost:3000/api/linkedin-change-alert
```json
{
  "severity": "high",
  "source": "email_monitor",
  "title": "Lead ha risposto via email notification",
  "action": "warn",
  "details": "Lead: [nome] - [url profilo]"
}
```

### 4. Telegram alert immediato
Se il lead è nel DB con status MESSAGED/FOLLOWED_UP → alert Telegram:
"🔥 [Nome] ti ha risposto! Rispondi entro 2h per massimizzare la conversione."

### 5. Auto-reply (opzionale)
Se configurato, il bot può rispondere automaticamente nella prossima sessione
con priorità massima (job priorità 5, prima di tutto il resto).
