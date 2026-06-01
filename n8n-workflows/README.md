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
