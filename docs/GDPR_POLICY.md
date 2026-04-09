# GDPR Policy — LinkedIn Automation Bot

> Documento di riferimento per la gestione dei dati personali raccolti dal bot.
> Base legale: Reg. UE 2016/679 (GDPR).
> Aggiornato: 2026-04-04

---

## 1. Dati raccolti e base giuridica

| Dato | Fonte | Base giuridica |
|------|-------|----------------|
| Nome, cognome, job title | Sales Navigator / profilo LinkedIn | Interesse legittimo B2B (art. 6.1.f) |
| URL profilo LinkedIn | Sales Navigator / ricerca LinkedIn | Interesse legittimo B2B |
| Azienda, sito web | Sales Navigator / profilo LinkedIn | Interesse legittimo B2B |
| Descrizione profilo (about, experience) | Profilo LinkedIn | Interesse legittimo B2B |
| Email, telefono | Enrichment esterno (se abilitato) | Interesse legittimo B2B |
| Messaggi inviati | Generati dal bot | Necessario per l'esecuzione del servizio |
| Timestamp inviti/messaggi | DB locale | Necessario per compliance e audit |

**Nota**: la colonna `consent_basis` nella tabella `leads` traccia la base giuridica per ogni lead.
Il campo `gdpr_opt_out = 1` indica che il lead ha esercitato il diritto di opposizione.

---

## 2. Retention policy

Implementata in `src/scripts/gdprRetentionCleanup.ts` e nella migrazione `059_gdpr_retention.sql`.

| Scenario | Soglia | Azione |
|----------|--------|--------|
| Lead inattivo (no interazioni) | **180 giorni** | Anonimizzazione: nome/cognome → `[ANONIMIZZATO]`, email/phone/about → NULL, linkedin_url → `anon:{sha256}` |
| Lead inattivo (no interazioni) | **365 giorni** | Cancellazione completa dal DB (inclusa message_history, lead_events) |
| Lead in stato ACCEPTED/REPLIED/CONNECTED | 360 / 730 giorni | Soglia raddoppiata — lead "caldo" conservato più a lungo |
| Lead opt-out (`gdpr_opt_out = 1`) | Immediato (su richiesta) | Cancellazione su richiesta tramite query manuale |

**"Inattività"** = nessuno tra: `invited_at`, `accepted_at`, `messaged_at`, `follow_up_sent_at`, `updated_at`.

---

## 3. Audit trail

Ogni azione rilevante viene loggata in `audit_log`:

| Action | Evento |
|--------|--------|
| `connection_request` | Invito LinkedIn inviato |
| `message_sent` | Messaggio iniziale inviato |
| `follow_up_sent` | Follow-up inviato (campaign-driven) |
| `lead_anonymized` | Lead anonimizzato per policy di retention |
| `lead_deleted` | Lead cancellato definitivamente |
| `opt_out_recorded` | Opt-out registrato manualmente |

Il campo `lead_identifier` in `audit_log` conserva l'URL LinkedIn originale anche dopo cancellazione del lead (per prova di compliance). Dopo anonimizzazione il campo mostra l'hash `anon:{sha256}`.

---

## 4. Diritto all'oblio (cancellazione su richiesta)

Se un lead richiede la cancellazione dei propri dati, eseguire:

```sql
-- Step 1: verifica esistenza
SELECT id, first_name, last_name, linkedin_url, status, created_at
FROM leads
WHERE linkedin_url LIKE '%/in/nome-cognome%';

-- Step 2: registra opt-out nell'audit log
INSERT INTO audit_log (action, lead_id, lead_identifier, performed_by, metadata_json)
VALUES ('opt_out_recorded', <lead_id>, '<linkedin_url>', 'manual', '{"reason":"user_request"}');

-- Step 3: cancella (nell'ordine corretto per FK)
DELETE FROM message_history WHERE lead_id = <lead_id>;
DELETE FROM lead_events WHERE lead_id = <lead_id>;
DELETE FROM list_leads WHERE lead_id = <lead_id>;
DELETE FROM lead_intents WHERE lead_id = <lead_id>;
DELETE FROM leads WHERE id = <lead_id>;
```

In alternativa, usare lo script con flag `--delete-only` e filtrare manualmente (vedi sotto).

---

## 5. Diritto di accesso (cosa abbiamo su di te)

Per vedere tutte le azioni registrate per un URL LinkedIn:

```sql
SELECT action, performed_at, performed_by, metadata_json
FROM audit_log
WHERE lead_identifier = '<linkedin_url>'
ORDER BY performed_at ASC;
```

Per vedere il record completo del lead:

```sql
SELECT * FROM leads WHERE linkedin_url = '<linkedin_url>';
SELECT * FROM message_history WHERE lead_id = <lead_id>;
SELECT * FROM lead_events WHERE lead_id = <lead_id>;
```

---

## 6. Come eseguire il retention cleanup manualmente

```bash
# Dry-run — mostra cosa verrebbe fatto senza modificare nulla
npx ts-node src/scripts/gdprRetentionCleanup.ts --dry-run

# Esegue anonimizzazione e cancellazione secondo policy di default (180/365 giorni)
npx ts-node src/scripts/gdprRetentionCleanup.ts

# Solo anonimizzazione (salta cancellazione)
npx ts-node src/scripts/gdprRetentionCleanup.ts --anonymize-only

# Solo cancellazione lead già scaduti i 365gg
npx ts-node src/scripts/gdprRetentionCleanup.ts --delete-only
```

Lo script NON gira automaticamente. Va programmato manualmente (cron, task scheduler, n8n) o eseguito a richiesta.

---

## 7. Trasferimento a terzi

- **Oxylabs** (proxy): vede solo IP/UA della sessione, non i dati lead
- **Supabase** (se cloudBridge attivo): riceve status update e daily stats — nessun dato PII sincronizzato per design
- **Telegram** (alert): solo incident type/severity, mai dati lead
- **n8n** (orchestratore): locale/self-hosted, nessun dato esce
- **Anthropic API**: riceve il contesto del profilo per generare messaggi — considerare pseudonimizzazione del prompt se scala supera uso personale

---

## 8. Limiti e cosa manca ancora

- [x] Registro dei trattamenti ex art. 30 GDPR → `docs/GDPR_ART30_REGISTER.md` (2026-04-09)
- [ ] Privacy notice da mostrare ai lead (applicabile se il bot opera su larga scala)
- [ ] Pseudonimizzazione dei prompt inviati ad Anthropic API
- [ ] Scheduling automatico del retention cleanup → workflow JSON pronto `n8n-workflows/gdpr-retention-cleanup.json`, da importare in n8n UI
- [ ] Interfaccia dashboard per consultare audit_log senza SQL
