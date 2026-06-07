---
name: lead-report
description: Genera un report Telegram-ready sullo stato dei lead: pending ratio, statistiche invite/message, lead per status, alert se pending ratio > 65%. Attivare con /lead-report o "report lead", "stato campagna", "pending ratio".
---

# Lead Report

Quando l'utente vuole un report sullo stato dei lead e delle campagne:

1. Esegui le query SQLite sul DB locale:

```bash
sqlite3 data/linkedin_bot.sqlite "
SELECT
  (SELECT COUNT(*) FROM leads) as totale,
  (SELECT COUNT(*) FROM leads WHERE status='PENDING_INVITE') as pending_invite,
  (SELECT COUNT(*) FROM leads WHERE status='INVITED') as invited,
  (SELECT COUNT(*) FROM leads WHERE status='CONNECTED') as connected,
  (SELECT COUNT(*) FROM leads WHERE status='MESSAGE_SENT') as messaged,
  (SELECT COUNT(*) FROM leads WHERE status='REPLIED') as replied,
  (SELECT COUNT(*) FROM leads WHERE status='BLOCKED') as blocked,
  (SELECT COUNT(*) FROM leads WHERE status='REVIEW_REQUIRED') as review;
"
```

2. Calcola **pending ratio** = invited / (invited + connected) × 100

3. Genera report in formato Telegram (testo plain, emoji, max 300 char per sezione):

```
📊 LEAD REPORT — [data]

👥 Totale: X lead
📤 Invitati (pending): X
✅ Connessi: X
💬 Messaggiati: X
↩️ Risposte: X

📈 Pending ratio: X%
[🟢 OK | 🟡 Attenzione | 🔴 CRITICO >65%]

⚠️ Da rivedere: X
```

4. Se pending ratio > 65%: aggiungi alert con azione consigliata (ritira inviti più vecchi di 21gg).
5. Se > 0 lead in REVIEW_REQUIRED: segnala con count.

Se il DB non è accessibile o il path è diverso, chiedi all'utente il path corretto.
