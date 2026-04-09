# Registro dei Trattamenti — Art. 30 GDPR

> Registro delle attività di trattamento ai sensi dell'art. 30 del Reg. UE 2016/679 (GDPR).
> Titolare del trattamento: Riccardo (uso personale / professionale B2B).
> Aggiornato: 2026-04-09

---

## Informazioni sul titolare

| Campo | Valore |
|-------|--------|
| **Titolare** | Riccardo (persona fisica) |
| **Attività** | Automazione LinkedIn per outreach B2B |
| **Strumento** | LinkedIn Automation Bot (software locale) |
| **Contatto** | Comunicare via LinkedIn diretto |

---

## Trattamento 1 — Dati di profilo LinkedIn (lead B2B)

| Campo art. 30 | Dettaglio |
|---------------|-----------|
| **Finalità** | Outreach commerciale B2B (lead generation, inviti connessione, messaggi di presentazione) |
| **Categorie di interessati** | Professionisti aziendali (decision maker, manager, founder) |
| **Categorie di dati** | Nome, cognome, job title, azienda, URL profilo LinkedIn, descrizione profilo, messaggi inviati, timestamp interazioni |
| **Base giuridica** | Interesse legittimo B2B — art. 6.1.f GDPR (outreach professionale verso destinatari con ruolo rilevante) |
| **Destinatari** | Nessun destinatario terzo. Dati trattati solo localmente sul dispositivo del titolare |
| **Trasferimenti extra-UE** | Anthropic API (US): contesto profilo per generazione messaggi — pseudonimizzare se scala supera uso personale. Oxylabs (proxy): vede solo metadati sessione, nessun dato PII |
| **Termini di cancellazione** | 180gg inattività → anonimizzazione; 365gg → cancellazione completa. Lead opt-out → cancellazione immediata su richiesta |
| **Misure di sicurezza** | DB PostgreSQL su rete interna docker (porta 5432 non esposta); credenziali solo in `.env`; audit trail su ogni azione rilevante in `audit_log`; anonimizzazione SHA-256 post-retention |
| **Strumento di enforcement** | `src/scripts/gdprRetentionCleanup.ts`; migrazione `059_gdpr_retention.sql`; workflow n8n `gdpr-retention-cleanup.json` (cron lunedì 9:00) |

---

## Trattamento 2 — Audit log

| Campo art. 30 | Dettaglio |
|---------------|-----------|
| **Finalità** | Tracciabilità delle azioni del bot per compliance e debugging operativo |
| **Categorie di interessati** | Lead LinkedIn oggetto di azioni del bot |
| **Categorie di dati** | `lead_identifier` (LinkedIn URL o hash SHA-256 dopo anonimizzazione), tipo azione, timestamp, metadati operativi |
| **Base giuridica** | Interesse legittimo — necessario per compliance GDPR e audit interno |
| **Destinatari** | Nessuno |
| **Trasferimenti extra-UE** | Nessuno |
| **Termini di cancellazione** | `lead_identifier` conservato post-cancellazione lead come prova di compliance (audit storico). Revisione manuale annuale |
| **Misure di sicurezza** | Stesse del Trattamento 1. Post-anonimizzazione: `lead_identifier` diventa `anon:{sha256}` |

---

## Trattamento 3 — Session log e metriche operative

| Campo art. 30 | Dettaglio |
|---------------|-----------|
| **Finalità** | Monitoraggio performance bot, alert anti-ban, health check sistema |
| **Categorie di interessati** | Nessuno (dati tecnici di sistema, non PII lead) |
| **Categorie di dati** | Timestamp sessioni, contatori azioni per tipo, stato proxy, errori sistema |
| **Base giuridica** | Non applicabile — nessun dato personale di terzi |
| **Destinatari** | Telegram (alert): solo tipo/severità incident — mai dati PII |
| **Trasferimenti extra-UE** | Telegram API (US): solo messaggi di alert operativi senza PII |
| **Termini di cancellazione** | Log tecnici: 90gg, poi purge automatica |
| **Misure di sicurezza** | Token Telegram solo in `.env` |

---

## Diritti degli interessati — procedure operative

| Diritto | Come esercitarlo | Procedura interna |
|---------|-----------------|-------------------|
| **Accesso (art. 15)** | Contatto diretto titolare | Query `audit_log` + `leads` per URL LinkedIn — vedi `GDPR_POLICY.md` § 5 |
| **Cancellazione / Oblio (art. 17)** | Contatto diretto titolare | Script `gdprRetentionCleanup.ts --delete-only` o query manuale — vedi `GDPR_POLICY.md` § 4 |
| **Opposizione (art. 21)** | Contatto diretto titolare | Impostare `gdpr_opt_out = 1` sul lead — esclude da tutte le campagne future |
| **Portabilità (art. 20)** | Contatto diretto titolare | Export CSV da tabella `leads` filtrato per URL richiesto |
| **Rettifica (art. 16)** | N/A | Dati originati da profilo LinkedIn pubblico — la rettifica avviene alla fonte |

---

## Valutazione d'impatto (DPIA)

Trattamento B2B a bassa scala su dati pubblici LinkedIn. Non richiede DPIA formale (art. 35 GDPR) perché:
- Nessuna categoria speciale di dati (art. 9)
- Nessuna profilazione sistematica a larga scala
- Uso personale / professionale individuale

Se il volume di lead supera le 5.000 unità attive simultanee → rivalutare la necessità di DPIA.

---

## Note di revisione

| Data | Modifica |
|------|---------|
| 2026-04-09 | Prima stesura — allineato con `GDPR_POLICY.md` e migration `059_gdpr_retention.sql` |
