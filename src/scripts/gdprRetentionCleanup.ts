/**
 * GDPR Retention Cleanup — script manuale/schedulabile
 *
 * NON gira automaticamente. Va invocato esplicitamente:
 *   npx ts-node src/scripts/gdprRetentionCleanup.ts [--dry-run]
 *   npx ts-node src/scripts/gdprRetentionCleanup.ts [--delete-only] [--anonymize-only]
 *
 * Policy di default:
 *   - 180 giorni senza attività → anonimizzazione (PII sostituita con hash SHA-256)
 *   - 365 giorni senza attività → cancellazione completa del lead
 *
 * Eccezioni (non vengono toccati):
 *   - Status ACCEPTED, REPLIED, CONNECTED con attività recente (soglia raddoppiata)
 *   - Lead con gdpr_opt_out = 1 (già segnalati: verifica separata)
 *   - Lead già anonimizzati (anonymized_at NOT NULL) → candidati solo a cancellazione a 365gg
 *
 * Ogni operazione viene loggata in audit_log.
 */

import { createHash } from 'crypto';
import { getDatabase } from '../db';
import { config } from '../config';
import { withTransaction } from '../core/repositories/shared';
import { emitCloudLeadEraseEvent } from '../core/repositories/system';
import { logInfo, logWarn } from '../telemetry/logger';

// ─── Costanti policy ──────────────────────────────────────────────────────────

// T4 preset-profili: soglie env-driven (GDPR_ANONYMIZE_AFTER_DAYS / GDPR_DELETE_AFTER_DAYS,
// default 180/365 in config/domains.ts). delete mai sotto anonymize (clamp difensivo).
const ANONYMIZE_AFTER_DAYS = config.gdprAnonymizeAfterDays;
const DELETE_AFTER_DAYS = Math.max(config.gdprDeleteAfterDays, config.gdprAnonymizeAfterDays);
// Lead in stati "caldi" hanno soglia raddoppiata per non perdere dati di lead attivi
const WARM_STATUSES = ['ACCEPTED', 'REPLIED', 'CONNECTED'];
const WARM_MULTIPLIER = 2;

// ─── Tipi ─────────────────────────────────────────────────────────────────────

interface RetentionLead {
    id: number;
    linkedin_url: string;
    first_name: string;
    last_name: string;
    account_name: string;
    email: string | null;
    phone: string | null;
    about: string | null;
    status: string;
    last_activity_at: string | null;
    anonymized_at: string | null;
    created_at: string;
}

interface RetentionReport {
    scannedTotal: number;
    candidatesAnonymize: number;
    candidatesDelete: number;
    anonymized: number;
    deleted: number;
    skipped: number;
    errors: string[];
    dryRun: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

/**
 * Calcola la "ultima attività" di un lead:
 * max(invited_at, accepted_at, messaged_at, follow_up_sent_at, updated_at, created_at)
 * Aggiornato anche da last_activity_at se già presente in DB.
 */
function computeLastActivity(row: {
    invited_at?: string | null;
    accepted_at?: string | null;
    messaged_at?: string | null;
    follow_up_sent_at?: string | null;
    last_activity_at?: string | null;
    updated_at?: string | null;
    created_at: string;
}): Date {
    const candidates = [
        row.invited_at,
        row.accepted_at,
        row.messaged_at,
        row.follow_up_sent_at,
        row.last_activity_at,
        row.updated_at,
        row.created_at,
    ]
        .filter(Boolean)
        .map((d) => new Date(d as string).getTime())
        .filter((t) => !isNaN(t));

    // Tutte le date assenti/invalide: evita Math.max(...[]) = -Infinity -> Invalid Date.
    // Fallback "adesso": daysInactive ~0 -> il lead viene SALTATO (mai cancellato/anonimizzato
    // su dati corrotti — fail-safe GDPR/anti-perdita-dati).
    if (candidates.length === 0) {
        return new Date();
    }

    return new Date(Math.max(...candidates));
}

function daysSince(date: Date): number {
    return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
}

async function writeAuditLog(
    db: Awaited<ReturnType<typeof getDatabase>>,
    action: string,
    leadId: number | null,
    leadIdentifier: string,
    metadata: Record<string, unknown>,
): Promise<void> {
    await db.run(
        `INSERT INTO audit_log (action, lead_id, lead_identifier, performed_by, metadata_json)
         VALUES (?, ?, ?, 'retention_cleanup', ?)`,
        [action, leadId, leadIdentifier, JSON.stringify(metadata)],
    );
}

// ─── Core operations ──────────────────────────────────────────────────────────

/**
 * Anonimizza un lead: sostituisce i campi PII con hash SHA-256.
 * I dati aggregati (status, list_name, date) vengono mantenuti per analytics.
 * linkedin_url viene hashato ma il valore originale va in audit_log come lead_identifier.
 */
async function anonymizeLead(
    db: Awaited<ReturnType<typeof getDatabase>>,
    lead: RetentionLead,
    dryRun: boolean,
): Promise<void> {
    const originalUrl = lead.linkedin_url;
    const urlHash = sha256(originalUrl);

    if (!dryRun) {
        // Atomicita': UPDATE leads + pulizia PII tabelle collegate + audit in UNA transazione.
        await withTransaction(db, async () => {
            await db.run(
                `UPDATE leads SET
                    first_name     = ?,
                    last_name      = ?,
                    account_name   = ?,
                    email          = NULL,
                    phone          = NULL,
                    about          = NULL,
                    experience     = NULL,
                    business_email = NULL,
                    invite_note_sent   = NULL,
                    last_reply_snippet = NULL,
                    linkedin_url   = ?,
                    anonymized_at  = datetime('now'),
                    updated_at     = datetime('now')
                 WHERE id = ? AND anonymized_at IS NULL`,
                ['[ANONIMIZZATO]', '[ANONIMIZZATO]', '[ANONIMIZZATO]', `anon:${urlHash}`, lead.id],
            );

            // Pulizia PII nelle tabelle collegate. L'anonimizzazione NON cancella la riga padre
            // (a differenza di deleteLead), quindi nessun ON DELETE CASCADE scatterebbe comunque
            // sulle figlie -> pulizia esplicita obbligatoria. Le righe che CONSERVIAMO (no DELETE)
            // vengono ripulite per-colonna dei soli campi PII, tenendo gli aggregati non-PII.
            // lead_enrichment_data: azzera i blob PII (telefoni/social/company), tiene gli aggregati non-PII.
            await db.run(
                `UPDATE lead_enrichment_data
                    SET company_json = NULL, phones_json = NULL, socials_json = NULL, sources_json = NULL,
                        updated_at = datetime('now')
                  WHERE lead_id = ?`,
                [lead.id],
            );
            // message_history: message_text (migration 057) contiene il TESTO integrale del messaggio
            // col nome del lead -> azzera, tenendo content_hash (hash non-PII per il dedup semantico).
            // lead_intents.raw_message: snippet del messaggio analizzato (PII) -> azzera.
            // Senza questi due, dopo l'anonimizzazione a 180gg il testo personale sopravvive (gap P0c).
            await db.run(`UPDATE message_history SET message_text = NULL WHERE lead_id = ?`, [lead.id]);
            await db.run(`UPDATE lead_intents SET raw_message = NULL WHERE lead_id = ?`, [lead.id]);
            // prebuilt_messages: il testo contiene PII personalizzata (nome/azienda) -> rimuovi.
            await db.run(`DELETE FROM prebuilt_messages WHERE lead_id = ?`, [lead.id]);
            // salesnav_list_members (perimetro erasure esteso): keyed su linkedin_url, non lead_id;
            // l'URL ORIGINALE è ancora disponibile qui (l'UPDATE lo riscrive ad anon: ma originalUrl
            // lo conserva) — dopo l'anonimizzazione il link sarebbe perso. DELETE = no PII residua.
            await db.run(`DELETE FROM salesnav_list_members WHERE linkedin_url = ?`, [originalUrl]);

            // Propagazione erasure alla copia cloud (goal gdpr-erasure-cloud): evento outbox
            // nella STESSA transazione (SAVEPOINT: rollback locale ⇒ nessuna emissione),
            // con l'URL ORIGINALE catturato prima del rewrite anon:<hash>.
            await emitCloudLeadEraseEvent(originalUrl);

            await writeAuditLog(db, 'lead_anonymized', lead.id, originalUrl, {
                status: lead.status,
                last_activity_at: lead.last_activity_at,
                days_inactive: Math.floor(daysSince(computeLastActivity(lead))),
            });
        });

        console.log(`[ANONYMIZED] Lead #${lead.id} (urlHash ${urlHash.slice(0, 12)})`);
    } else {
        console.log(`[DRY-RUN] Lead #${lead.id} sarebbe anonimizzato (urlHash ${urlHash.slice(0, 12)})`);
    }
}

/**
 * Cancella un lead e tutta la sua history.
 * L'audit_log conserva il lead_identifier (URL originale o hash se già anonimizzato).
 */
async function deleteLead(
    db: Awaited<ReturnType<typeof getDatabase>>,
    lead: RetentionLead,
    dryRun: boolean,
): Promise<void> {
    const leadIdentifier = lead.linkedin_url; // può essere già `anon:hash` se anonimizzato

    if (!dryRun) {
        // Cancella prima TUTTE le tabelle dipendenti, poi il padre. Le FK NON hanno ON DELETE
        // CASCADE (migration), quindi anche con PRAGMA foreign_keys=ON (attivo, db.ts) la DELETE
        // del padre violerebbe la FK se le figlie esistono ancora -> ordine figli->padre obbligatorio.
        // Atomicita': figli + padre + audit in UNA transazione, cosi' un crash a meta' non lascia
        // il lead parzialmente cancellato e senza riga di audit.
        await withTransaction(db, async () => {
            await db.run(`DELETE FROM message_history WHERE lead_id = ?`, [lead.id]);
            await db.run(`DELETE FROM lead_events WHERE lead_id = ?`, [lead.id]);
            await db.run(`DELETE FROM list_leads WHERE lead_id = ?`, [lead.id]);
            await db.run(`DELETE FROM lead_intents WHERE lead_id = ?`, [lead.id]);
            await db.run(`DELETE FROM lead_enrichment_data WHERE lead_id = ?`, [lead.id]);
            await db.run(`DELETE FROM prebuilt_messages WHERE lead_id = ?`, [lead.id]);
            await db.run(`DELETE FROM salesnav_list_items WHERE lead_id = ?`, [lead.id]);
            // salesnav_list_members (perimetro erasure esteso): keyed su linkedin_url, non lead_id.
            // leadIdentifier = lead.linkedin_url (originale se non anonimizzato; se gia' anon:hash i
            // membri sono gia' stati rimossi dall'anonimizzazione precedente -> qui no-match, safe).
            await db.run(`DELETE FROM salesnav_list_members WHERE linkedin_url = ?`, [leadIdentifier]);
            await db.run(`DELETE FROM ml_feature_store WHERE lead_id = ?`, [lead.id]);
            await db.run(`DELETE FROM challenge_events WHERE lead_id = ?`, [lead.id]);
            await db.run(`DELETE FROM lead_campaign_state WHERE lead_id = ?`, [lead.id]);
            await db.run(`DELETE FROM leads WHERE id = ?`, [lead.id]);

            // Propagazione erasure cloud: se il lead era già anonimizzato (identifier anon:<hash>)
            // l'evento è già stato emesso da quel percorso → l'helper no-opa da solo.
            await emitCloudLeadEraseEvent(leadIdentifier);

            await writeAuditLog(db, 'lead_deleted', null, leadIdentifier, {
                status: lead.status,
                last_activity_at: lead.last_activity_at,
                days_inactive: Math.floor(daysSince(computeLastActivity(lead))),
                was_anonymized: lead.anonymized_at !== null,
            });
        });

        console.log(`[DELETED] Lead #${lead.id}`);
    } else {
        console.log(`[DRY-RUN] Lead #${lead.id} sarebbe cancellato`);
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runGdprRetentionCleanup(opts: {
    dryRun?: boolean;
    anonymizeOnly?: boolean;
    deleteOnly?: boolean;
    anonymizeDays?: number;
    deleteDays?: number;
}): Promise<RetentionReport> {
    const {
        dryRun = false,
        anonymizeOnly = false,
        deleteOnly = false,
        anonymizeDays = ANONYMIZE_AFTER_DAYS,
        deleteDays = DELETE_AFTER_DAYS,
    } = opts;

    const report: RetentionReport = {
        scannedTotal: 0,
        candidatesAnonymize: 0,
        candidatesDelete: 0,
        anonymized: 0,
        deleted: 0,
        skipped: 0,
        errors: [],
        dryRun,
    };

    void logInfo('gdpr_retention', { dryRun, anonymizeDays, deleteDays });

    const db = await getDatabase();

    // Legge tutti i lead con colonne necessarie per calcolare last_activity
    const leads = await db.query<
        RetentionLead & {
            invited_at: string | null;
            accepted_at: string | null;
            messaged_at: string | null;
            follow_up_sent_at: string | null;
            updated_at: string | null;
        }
    >(
        `SELECT id, linkedin_url, first_name, last_name, account_name, email, phone, about,
                status, last_activity_at, anonymized_at, created_at,
                invited_at, accepted_at, messaged_at, follow_up_sent_at, updated_at
         FROM leads`,
    );

    report.scannedTotal = leads.length;

    for (const lead of leads) {
        try {
            const lastActivity = computeLastActivity(lead);
            const daysInactive = daysSince(lastActivity);

            // Determina soglia corretta in base allo status
            const isWarm = WARM_STATUSES.includes(lead.status);
            const effectiveAnonymizeDays = isWarm ? anonymizeDays * WARM_MULTIPLIER : anonymizeDays;
            const effectiveDeleteDays = isWarm ? deleteDays * WARM_MULTIPLIER : deleteDays;

            const shouldDelete = daysInactive >= effectiveDeleteDays;
            const shouldAnonymize = !lead.anonymized_at && daysInactive >= effectiveAnonymizeDays && !shouldDelete;

            if (shouldDelete && !anonymizeOnly) {
                report.candidatesDelete += 1;
                await deleteLead(db, lead, dryRun);
                if (!dryRun) report.deleted += 1;
            } else if (shouldAnonymize && !deleteOnly) {
                report.candidatesAnonymize += 1;
                await anonymizeLead(db, lead, dryRun);
                if (!dryRun) report.anonymized += 1;
            } else {
                report.skipped += 1;
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            void logWarn('gdpr_retention', { leadId: lead.id, error: msg });
            report.errors.push(`lead #${lead.id}: ${msg}`);
        }
    }

    // Aggiorna last_activity_at per tutti i lead ancora presenti (backfill)
    if (!dryRun) {
        await db.run(
            `UPDATE leads
             SET last_activity_at = (
                 SELECT MAX(v)
                 FROM (
                     SELECT invited_at      AS v FROM leads l2 WHERE l2.id = leads.id
                     UNION ALL
                     SELECT accepted_at                            FROM leads l2 WHERE l2.id = leads.id
                     UNION ALL
                     SELECT messaged_at                            FROM leads l2 WHERE l2.id = leads.id
                     UNION ALL
                     SELECT follow_up_sent_at                      FROM leads l2 WHERE l2.id = leads.id
                     UNION ALL
                     SELECT updated_at                             FROM leads l2 WHERE l2.id = leads.id
                 ) t WHERE v IS NOT NULL
             )
             WHERE last_activity_at IS NULL AND anonymized_at IS NULL`,
        );
    }

    void logInfo('gdpr_retention_done', {
        scannedTotal: report.scannedTotal,
        anonymized: report.anonymized,
        deleted: report.deleted,
        skipped: report.skipped,
        errors: report.errors.length,
    });

    return report;
}

// ─── Right to Erasure ─────────────────────────────────────────────────────────

/**
 * Right to Erasure (GDPR Art. 17): anonimizza i dati personali di un lead specifico
 * in TUTTE le tabelle, inclusi audit_log.
 *
 * Uso: npx ts-node src/scripts/gdprRetentionCleanup.ts --erasure <linkedin_url>
 *
 * Copre il caso edge: lead cancellato senza previa anonimizzazione (--delete-only),
 * dove audit_log può conservare l'URL originale come lead_identifier.
 */
export async function runRightToErasure(linkedinUrl: string, dryRun = false): Promise<void> {
    const db = await getDatabase();
    const urlHash = sha256(linkedinUrl);
    const anonIdentifier = `anon:${urlHash}`;

    if (!dryRun) {
        // 0. Risolvi gli id PRIMA di mutare linkedin_url (lo step 1 lo riscrive ad anon:hash),
        //    cosi' la pulizia delle tabelle collegate puo' usare lead_id in modo affidabile.
        const matched = await db.query<{ id: number }>(`SELECT id FROM leads WHERE linkedin_url = ?`, [
            linkedinUrl,
        ]);
        const leadIds = matched.map((r) => r.id);

        // Atomicita': anonimizzazione lead + pulizia PII collegate + audit_log in UNA transazione.
        await withTransaction(db, async () => {
            // 1. Anonimizza il lead se ancora presente
            await db.run(
                `UPDATE leads SET
                    first_name = '[ANONIMIZZATO]', last_name = '[ANONIMIZZATO]',
                    account_name = '[ANONIMIZZATO]',
                    email = NULL, phone = NULL, about = NULL, experience = NULL,
                    business_email = NULL, invite_note_sent = NULL, last_reply_snippet = NULL,
                    linkedin_url = ?,
                    anonymized_at = datetime('now'), updated_at = datetime('now')
                 WHERE linkedin_url = ? AND anonymized_at IS NULL`,
                [anonIdentifier, linkedinUrl],
            );

            // 1b. Pulizia PII nelle tabelle collegate (la riga padre NON viene cancellata ma
            //     anonimizzata -> nessun CASCADE scatterebbe -> pulizia esplicita per-colonna):
            //     lead_enrichment_data (telefoni/social/company) + prebuilt_messages (testo personalizzato)
            //     + message_history.message_text (testo integrale, tieni content_hash) + lead_intents.raw_message
            //     (snippet). Senza gli ultimi due, l'erasure Art.17 on-demand lasciava il testo personale (gap P0c).
            for (const id of leadIds) {
                await db.run(
                    `UPDATE lead_enrichment_data
                        SET company_json = NULL, phones_json = NULL, socials_json = NULL, sources_json = NULL,
                            updated_at = datetime('now')
                      WHERE lead_id = ?`,
                    [id],
                );
                await db.run(`DELETE FROM prebuilt_messages WHERE lead_id = ?`, [id]);
                await db.run(`UPDATE message_history SET message_text = NULL WHERE lead_id = ?`, [id]);
                await db.run(`UPDATE lead_intents SET raw_message = NULL WHERE lead_id = ?`, [id]);
            }

            // 1c. Perimetro erasure esteso a salesnav_list_members (goal gdpr-erasure-cloud):
            //     tabella indipendente da leads (no lead_id, match su linkedin_url) — contiene
            //     PII del membro (profile_name, company, message_text/reply_text dalle migration
            //     042/043). NON la toccava nessun percorso erasure → PII residua dopo Art.17.
            //     DELETE (non anonymize-per-colonna): rimuove TUTTA la PII senza enumerare colonne,
            //     usa l'URL ORIGINALE (i membri non sono mai riscritti ad anon:). Tabella indipendente,
            //     nessun FK rotto. Coerente con la pulizia DELETE di prebuilt_messages sopra.
            await db.run(`DELETE FROM salesnav_list_members WHERE linkedin_url = ?`, [linkedinUrl]);

            // 1d. Propagazione erasure alla copia cloud (goal gdpr-erasure-cloud): evento outbox
            //     in-transaction con l'URL originale (il rewrite anon: è già avvenuto sopra ma
            //     linkedinUrl — il parametro — conserva l'originale).
            await emitCloudLeadEraseEvent(linkedinUrl);

            // 2. Anonimizza lead_identifier in audit_log per questo lead (GDPR Right to Erasure)
            await db.run(`UPDATE audit_log SET lead_identifier = ? WHERE lead_identifier = ?`, [
                anonIdentifier,
                linkedinUrl,
            ]);

            // 3. Scrivi evento erasure in audit_log
            await db.run(
                `INSERT INTO audit_log (action, lead_id, lead_identifier, performed_by, metadata_json)
                 VALUES ('erasure_requested', NULL, ?, 'gdpr_erasure', '{"source":"right_to_erasure"}')`,
                [anonIdentifier],
            );
        });

        console.log(`[ERASURE] Lead ${anonIdentifier} anonimizzato ovunque.`);
    } else {
        console.log(`[DRY-RUN] Erasure per: ${anonIdentifier}`);
    }
}

// ─── CLI entry-point ──────────────────────────────────────────────────────────

if (require.main === module) {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const anonymizeOnly = args.includes('--anonymize-only');
    const deleteOnly = args.includes('--delete-only');
    const erasureIdx = args.indexOf('--erasure');

    if (erasureIdx !== -1 && args[erasureIdx + 1]) {
        const url = args[erasureIdx + 1];
        console.log(`=== GDPR Right to Erasure: anon:${sha256(url).slice(0, 12)} ===`);
        if (dryRun) console.log('[DRY-RUN] Nessuna modifica verrà applicata.');
        runRightToErasure(url, dryRun)
            .then(() => console.log('Erasure completato.'))
            .catch((err) => {
                console.error('Errore:', err);
                process.exit(1);
            });
    } else {
        console.log('=== GDPR Retention Cleanup ===');
        if (dryRun) console.log('[DRY-RUN] Nessuna modifica verrà applicata.');

        runGdprRetentionCleanup({ dryRun, anonymizeOnly, deleteOnly })
            .then((report) => {
                console.log('\n=== Report ===');
                console.log(`Lead scansionati:    ${report.scannedTotal}`);
                console.log(`Candidati anonymize: ${report.candidatesAnonymize}`);
                console.log(`Candidati delete:    ${report.candidatesDelete}`);
                console.log(`Anonimizzati:        ${report.anonymized}`);
                console.log(`Cancellati:          ${report.deleted}`);
                console.log(`Saltati:             ${report.skipped}`);
                if (report.errors.length > 0) {
                    console.log(`\nErrori (${report.errors.length}):`);
                    report.errors.forEach((e) => console.log(`  - ${e}`));
                }
                console.log('\nFatto.');
            })
            .catch((err) => {
                console.error('Errore fatale:', err);
                process.exit(1);
            });
    } // chiude else del blocco erasure
}
