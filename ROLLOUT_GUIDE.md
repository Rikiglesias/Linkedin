# LinkedIn Bot: Canary Rollout Guide

Questa guida descrive la procedura operativa per il rilascio in sicurezza ("Canary Rollout") e la scalata progressiva dei volumi (Ramp-Up).

## 0. MCP Security Baseline (Supabase)

Prima del rollout, eseguire un controllo security/performance via MCP sul progetto Supabase `Linkedin` (`project_id: ukgxmkwubcrbcvvovcto`).

- Migrazione MCP applicata: `harden_public_rls_and_fk_indexes_v2` (27 Febbraio 2026)
- Scope:
  - RLS abilitata su: `accounts`, `campaigns`, `leads`, `prompt_variants`, `jobs_cloud`, `daily_stats_cloud`, `proxy_ips`, `telegram_commands`
  - Policy `service_role` create per le tabelle sopra (default-deny per altri ruoli)
  - Fix `search_path` su funzione `public.set_updated_at`
  - Indici FK aggiunti: `campaigns(account_id)`, `daily_stats_cloud(account_id)`, `jobs_cloud(lead_id)`, `telegram_commands(account_id)`
- Esito post-check MCP:
  - Security advisors: `0` findings
  - Performance advisors: restano solo `INFO` su indici non usati (nessun `ERROR`)

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
