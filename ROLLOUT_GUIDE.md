# LinkedIn Bot: Canary Rollout Guide

Questa guida descrive la procedura operativa per il rilascio in sicurezza ("Canary Rollout") e la scalata progressiva dei volumi (Ramp-Up).

## 1. Preparazione Iniziale (Giorno 0)

1. Assicurarsi che nel database/Supabase ci sia **UNA SOLA** lista segnata come attiva (`isActive = true`).
2. Impostare i limiti iniziali molto bassi (es. `dailyInviteCap = 5`, `dailyMessageCap = 5`), pari al **Giorno 1** della policy.
3. Lasciare che il bot giri con il job scheduler abilitato.

## 2. Monitoraggio Giornaliero (Dashboard)

Ogni mattina, aprire la Dashboard locale (`npm run dashboard`) e validare i seguenti KPI del giorno precedente:

- **Error Rate**: Deve rimanere sotto il 5%
- **Selector Failures**: Ideale 0
- **Pending Ratio**: Sotto la soglia di Warning
- **Challenge Count**: Rigorosamente 0 (Nessun blocco/captcha di LinkedIn)

## 3. Esecuzione Step di Ramp-Up

Se i KPI del giorno precedente e la "Valutazione Rischio Attuale" sono positivi (`Azione: NORMAL`), aumentare i limiti per il giorno corrente utilizzando lo script:

### Aumento Automatico (Consigliato)

Cerca la lista attiva e la porta allo step di schedule immediatamente superiore a quello attuale:

```bash
npm run ramp-up "Nome Della Lista" auto
```

### Aumento Manuale

Per forzare un giorno specifico (es. Giorno 3):

```bash
npm run ramp-up "Nome Della Lista" 3
```

*Lo script controllerà comunque il Risk Engine. Se il rischio è in WARN o STOP, lo script fallirà intenzionalmente bloccando lo scaling.*

## 4. Estensioni del Rollout (Giorno 7+)

Arrivati al Giorno 7 (`day: 7, inviteCap: 40, messageCap: 50`), la singola campagna ("Canary") si definirà a regime.
A questo punto:

1. Validare i KPI mensili.
2. Iniziare una seconda campagna ripetendo il processo sopra dal Giorno 1, verificando le performance combinate tramite la Dashboard.
