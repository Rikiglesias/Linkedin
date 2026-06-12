# Registro dei Trattamenti — Art. 30 GDPR

> Registro delle attività di trattamento ai sensi dell'art. 30 del Reg. UE 2016/679 (GDPR).
> Titolare del trattamento: Riccardo (uso personale / professionale B2B).
> Aggiornato: 2026-06-07

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
| **Destinatari** | Trattamento locale di default. **Se configurati** (API key presenti) provider di enrichment terzi ricevono nome/cognome/dominio/URL LinkedIn: Apollo.io (US), Hunter.io (IE/US), Clearbit·HubSpot (US) via `leadEnricher`; GitHub e Gravatar via `personDataFinder`; motori di ricerca (DuckDuckGo) via `webSearchEnricher`. **Senza le rispettive API key NON vengono contattati** (gate per-provider). Gate `gdpr_opt_out` applicato (H17): nessun enrichment per soggetti che hanno esercitato l'opposizione |
| **Trasferimenti extra-UE** | Anthropic API (US, **solo se `AI_PROVIDER=anthropic` configurato**): riceve ESCLUSIVAMENTE feature pseudonimizzate (enum categoriali segment/industry/seniority, booleani, numeri, regione coarse — MAI nome/email/telefono/URL/azienda/testo libero del lead o delle chat) per il decision engine, più task senza dati lead (risk assessment aggregato, decoy terms, post warmup). Enforcement MECCANICO (F0.5, 2026-06-11): guard zero-PII in `providerRegistry` (purpose PII mai instradati a cloud) + pseudonimizzazione in `leadPseudonymizer`/`buildDecisionPrompt` + test sentinella + audit log `ai_text.cloud_dispatch` e warn `ai_text.cloud_pii_suspect`. La generazione messaggi/scoring/sentiment resta LOCALE (Ollama). Oxylabs (proxy): solo metadati sessione, nessun PII. OpenAI (US): screenshot vision per captcha/anomalie — invio **bloccato** se `redactScreenshots=true` finché la redaction reale non è implementata (H19). Provider di enrichment US/extra-UE (Apollo/Hunter/Clearbit/Gravatar) **solo se configurati**. ⚠️ **DA FORMALIZZARE (azione del titolare):** base giuridica + meccanismo di trasferimento (SCC/decisione di adeguatezza) + DPA firmato per ciascun processor extra-UE che riceva dati personali; le feature pseudonimizzate inviate ad Anthropic sono progettate per restare FUORI dal perimetro del dato personale |
| **Termini di cancellazione** | 180gg inattività → anonimizzazione; 365gg → cancellazione completa. Lead opt-out → cancellazione immediata su richiesta. **L'erasure si propaga automaticamente alla copia cloud** (vedi § Mirror cloud) |
| **Misure di sicurezza** | DB PostgreSQL su rete interna docker (porta 5432 non esposta); credenziali solo in `.env`; audit trail su ogni azione rilevante in `audit_log`; anonimizzazione SHA-256 post-retention; mirror cloud con RLS attiva su tutte le tabelle + revoca ruoli pubblici (verifica 2026-06-12: advisor Supabase = 0 finding) |
| **Strumento di enforcement** | `src/scripts/gdprRetentionCleanup.ts`; migrazione `059_gdpr_retention.sql`; workflow n8n `gdpr-retention-cleanup.json` (cron lunedì 9:00); endpoint `/api/controls/gdpr-cleanup`; propagazione cloud via outbox `cloud.lead.erase` → `eraseCloudLead` |

### Mirror cloud Supabase — propagazione erasure (aggiunto 2026-06-12, goal gdpr-erasure-cloud)

Il bot mantiene una **copia cloud** dei lead su Supabase (PostgreSQL gestito) per monitoring,
analytics e Control Plane (tabelle: `leads`, `salesnav_list_members`, `lead_enrichment_data`,
`cp_events` e operative). Supabase agisce da **responsabile del trattamento (processor)**.
⚠️ Azione del titolare: verificare la region del progetto sul dashboard e, se extra-UE,
formalizzare il meccanismo di trasferimento (SCC/adeguatezza) come per gli altri processor.

| Aspetto | Implementazione |
|---------|-----------------|
| **Propagazione erasure (Art. 17)** | OGNI percorso locale di anonimizzazione/cancellazione (anonymize 180gg, delete 365gg, right-to-erasure puntuale, purge lead stale) emette in-transazione un evento outbox `cloud.lead.erase` con l'URL catturato prima del rewrite. Il consumer `eraseCloudLead` anonimizza la riga cloud (UPDATE-only, perimetro completo incluse email/phone/business_email), CANCELLA i membri SalesNav, azzera i blob PII di enrichment e **redige lo storico eventi** (`cp_events`: payload e chiavi che contenevano l'URL) |
| **Fail-loud** | Un errore di propagazione NON è mai silenzioso: retry automatico → dead-letter + alert Telegram (obbligo legale, non best-effort). Se il sink cloud è disattivato, l'emissione lascia traccia durevole in `audit_log` (`cloud_erase_sink_inactive`) |
| **Sicurezza copia cloud** | RLS attiva su 18/18 tabelle, policy esplicite `service_role`, revoca `anon`/`authenticated` (le tabelle non sono più visibili negli schemi API/GraphQL pubblici). Verifica 2026-06-12: Supabase security advisor = 0 finding (prima: 58) |
| **Backup / PITR (beyond use)** | I backup gestiti da Supabase non sono riscrivibili puntualmente: per i dati erased si applica il pattern **"beyond use"** (ICO): il dato nel backup non è più utilizzato né utilizzabile dall'applicazione, decade col ciclo di retention dei backup del provider, e in caso di restore la propagazione erasure è ri-applicabile (eventi idempotenti) |
| **Log eventi (cp_events)** | Le idempotency key e i payload storici che incorporavano l'URL del lead vengono riscritti a `anon:<sha256>` al momento dell'erasure; i NUOVI eventi erase nascono già redatti (hash-only) |

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
| 2026-06-12 | Goal gdpr-erasure-cloud: § Mirror cloud Supabase (propagazione erasure outbox, fail-loud, RLS 18/18 + revoke, beyond-use backup, redazione cp_events). Perimetro erasure locale esteso (salesnav_list_members, invite_note_sent, last_reply_snippet); migration cloud_001/cloud_002 applicate, advisor = 0 finding |
