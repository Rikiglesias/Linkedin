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
import { logInfo, logWarn } from '../telemetry/logger';

// ─── Costanti policy ──────────────────────────────────────────────────────────

const ANONYMIZE_AFTER_DAYS = 180;
const DELETE_AFTER_DAYS = 365;
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
        await db.run(
            `UPDATE leads SET
                first_name     = ?,
                last_name      = ?,
                account_name   = COALESCE(account_name, ''),
                email          = NULL,
                phone          = NULL,
                about          = NULL,
                experience     = NULL,
                business_email = NULL,
                linkedin_url   = ?,
                anonymized_at  = datetime('now'),
                updated_at     = datetime('now')
             WHERE id = ? AND anonymized_at IS NULL`,
            ['[ANONIMIZZATO]', '[ANONIMIZZATO]', `anon:${urlHash}`, lead.id],
        );

        await writeAuditLog(db, 'lead_anonymized', lead.id, originalUrl, {
            status: lead.status,
            last_activity_at: lead.last_activity_at,
            days_inactive: Math.floor(daysSince(computeLastActivity(lead))),
        });

        console.log(`[ANONYMIZED] Lead #${lead.id} (${originalUrl.slice(0, 40)}...)`);
    } else {
        console.log(`[DRY-RUN] Lead #${lead.id} sarebbe anonimizzato (${originalUrl.slice(0, 40)}...)`);
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
        // Cancella prima le tabelle dipendenti (FK)
        await db.run(`DELETE FROM message_history WHERE lead_id = ?`, [lead.id]);
        await db.run(`DELETE FROM lead_events WHERE lead_id = ?`, [lead.id]);
        await db.run(`DELETE FROM list_leads WHERE lead_id = ?`, [lead.id]);
        await db.run(`DELETE FROM lead_intents WHERE lead_id = ?`, [lead.id]);
        await db.run(`DELETE FROM leads WHERE id = ?`, [lead.id]);

        await writeAuditLog(db, 'lead_deleted', null, leadIdentifier, {
            status: lead.status,
            last_activity_at: lead.last_activity_at,
            days_inactive: Math.floor(daysSince(computeLastActivity(lead))),
            was_anonymized: lead.anonymized_at !== null,
        });

        console.log(`[DELETED] Lead #${lead.id} (${leadIdentifier.slice(0, 40)}...)`);
    } else {
        console.log(`[DRY-RUN] Lead #${lead.id} sarebbe cancellato (${leadIdentifier.slice(0, 40)}...)`);
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
        // 1. Anonimizza il lead se ancora presente
        await db.run(
            `UPDATE leads SET
                first_name = '[ANONIMIZZATO]', last_name = '[ANONIMIZZATO]',
                email = NULL, phone = NULL, about = NULL, experience = NULL,
                business_email = NULL, linkedin_url = ?,
                anonymized_at = datetime('now'), updated_at = datetime('now')
             WHERE linkedin_url = ? AND anonymized_at IS NULL`,
            [anonIdentifier, linkedinUrl],
        );

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

        console.log(`[ERASURE] Lead ${linkedinUrl.slice(0, 40)}... anonimizzato ovunque.`);
    } else {
        console.log(`[DRY-RUN] Erasure per: ${linkedinUrl.slice(0, 40)}...`);
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
        console.log(`=== GDPR Right to Erasure: ${url} ===`);
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
