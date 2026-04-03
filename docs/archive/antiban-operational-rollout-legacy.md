# Anti-Ban Operational Rollout Legacy

> Estratto storico rimosso da `docs/ARCHITECTURE_ANTIBAN_GUIDE.md` durante il cleanup del 2026-04-03.
> Questo file non e' canonico: contiene una checklist operativa specifica di rollout/campagna e un esempio `.env` molto contestuale.

## Perche' e' stato spostato

Il contenuto sotto era mischiato a una reference tecnica anti-ban. Questo creava tre problemi:

- mescolava architettura con runbook operativo
- introduceva config e procedure troppo specifiche come se fossero regole universali
- rendeva ambiguo il ruolo del documento tecnico principale

## Contenuto storico preservato

### Fase 0 - Preparazione immediata

- backup completo del database
- lettura rapida di `GUIDA_ANTI_BAN.md` e `THREAT_MODEL.md`

### Fase 1 - Setup pulito del lunedi'

- `npm run build`
- pulizia sessione Firefox locale
- login manuale
- discovery liste Sales Navigator
- sync della lista target
- dry-run completo
- primo ciclo `autopilot`
- controllo alert Telegram

### Fase 2 - Esempio `.env` contestuale

Conteneva una configurazione molto specifica per:

- limiti conservativi inviti/messaggi
- random activity e green mode
- rotazione proxy e warmup
- nota invito AI e scheduling messaggi
- sink webhook + sync verso n8n

Questa configurazione non e' stata mantenuta nel documento tecnico principale perche' non e' universale. Gli esempi corretti da mantenere vivi sono:

- [CONFIG_EXAMPLES.md](../CONFIG_EXAMPLES.md)
- [CONFIG_REFERENCE.md](../CONFIG_REFERENCE.md)
- [INTEGRATIONS.md](../INTEGRATIONS.md)

### Fase 3 - Campagna drip commissione

Conteneva una procedura molto contestuale per:

- creare un messaggio prebuilt
- aggiungere uno step drip post-accept
- aspettare 4-7 giorni prima del messaggio warm

### Fase 4 - Collegamento database + n8n

Conteneva una checklist per:

- import workflow in n8n
- configurare webhook `linkedin-events`
- sincronizzare transizioni lead e job verso CRM

### Fase 5 - Avvio definitivo

- lancio `autopilot`
- attivazione inbox auto-reply
- random activity abilitata

### Fase 6 - Checklist quotidiana

- controllo daily report
- controllo risk score
- stop immediato in caso di circuit breaker, proxy morto o session anomaly
- divieto di aumentare i limiti a mano senza analisi

### Fase 7 - Scaling futuro

- account aggiuntivi con proxy separato
- abilitazione di ulteriori worker
- passaggio a setup browser piu' avanzati

## Dove mettere queste cose adesso

- regole universali -> [GUIDA_ANTI_BAN.md](../GUIDA_ANTI_BAN.md)
- reference tecnica -> [ARCHITECTURE_ANTIBAN_GUIDE.md](../ARCHITECTURE_ANTIBAN_GUIDE.md)
- esempi config -> [CONFIG_EXAMPLES.md](../CONFIG_EXAMPLES.md)
- integrazioni operative -> [INTEGRATIONS.md](../INTEGRATIONS.md)
- lavoro corrente -> [../tracking/ENGINEERING_WORKLOG.md](../tracking/ENGINEERING_WORKLOG.md) e [../../todos/active.md](../../todos/active.md)
