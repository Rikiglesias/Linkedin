/**
 * Parallel Enrichment Engine
 *
 * Arricchisce lead in parallelo usando solo fonti internet gratuite (zero visite LinkedIn).
 * Pipeline per lead: Domain Discovery → EmailGuesser → PersonDataFinder → WebSearch
 *
 * Concurrency controllata per evitare rate-limiting dalle fonti.
 */

import { getDatabase } from '../db';
import { enrichLeadAuto, EnrichmentResult } from './leadEnricher';
import { bridgeLeadUpsert } from '../cloud/cloudBridge';
import { logInfo, logError, logWarn } from '../telemetry/logger';

export interface ParallelEnrichmentOptions {
    /** Nome lista da arricchire (default: tutte) */
    listName?: string;
    /** Numero massimo di lead da processare */
    limit: number;
    /** Lead paralleli contemporanei (default: 5) */
    concurrency: number;
    /** Callback progresso opzionale */
    onProgress?: (done: number, total: number, lastLead: string) => void;
}

export interface ParallelEnrichmentReport {
    total: number;
    enriched: number;
    emailsFound: number;
    businessEmailsFound: number;
    phonesFound: number;
    failed: number;
    durationMs: number;
}

interface LeadRow {
    id: number;
    first_name: string | null;
    last_name: string | null;
    account_name: string | null;
    website: string | null;
    linkedin_url: string | null;
    company_domain: string | null;
    location: string | null;
}

/**
 * Arricchisce lead in batch paralleli. Non usa browser né LinkedIn.
 */
export async function enrichLeadsParallel(opts: ParallelEnrichmentOptions): Promise<ParallelEnrichmentReport> {
    const db = await getDatabase();
    const startMs = Date.now();

    const listFilter = opts.listName
        ? `AND l.list_name = ?`
        : '';
    const params: unknown[] = opts.listName
        ? [opts.listName, opts.limit]
        : [opts.limit];

    const leads = await db.query<LeadRow>(
        `SELECT l.id, l.first_name, l.last_name, l.account_name, l.website,
                l.linkedin_url, l.company_domain, l.location
         FROM leads l
         LEFT JOIN lead_enrichment_data e ON e.lead_id = l.id
         WHERE l.status IN ('NEW', 'READY_INVITE', 'INVITED', 'ACCEPTED', 'READY_MESSAGE')
           AND l.first_name IS NOT NULL AND TRIM(l.first_name) != ''
           AND (
             e.lead_id IS NULL
             OR (l.business_email IS NULL AND l.account_name IS NOT NULL AND TRIM(l.account_name) != '')
           )
           ${listFilter}
         ORDER BY
           CASE WHEN e.lead_id IS NULL THEN 0 ELSE 1 END,
           l.created_at DESC
         LIMIT ?`,
        params,
    );

    if (leads.length === 0) {
        return { total: 0, enriched: 0, emailsFound: 0, businessEmailsFound: 0, phonesFound: 0, failed: 0, durationMs: 0 };
    }

    await logInfo('parallel_enricher.start', { total: leads.length, concurrency: opts.concurrency });

    const report: ParallelEnrichmentReport = {
        total: leads.length,
        enriched: 0,
        emailsFound: 0,
        businessEmailsFound: 0,
        phonesFound: 0,
        failed: 0,
        durationMs: 0,
    };

    // Processa in batch di N lead paralleli
    let done = 0;
    for (let i = 0; i < leads.length; i += opts.concurrency) {
        const batch = leads.slice(i, i + opts.concurrency);

        const results = await Promise.allSettled(
            batch.map((lead) => enrichSingleLead(db, lead)),
        );

        for (let j = 0; j < results.length; j++) {
            done++;
            const r = results[j];
            const lead = batch[j];
            if (!r || !lead) continue;
            const leadName = `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim();

            if (r.status === 'fulfilled' && r.value) {
                report.enriched++;
                if (r.value.email) report.emailsFound++;
                if (r.value.businessEmail) report.businessEmailsFound++;
                if (r.value.phone) report.phonesFound++;
                opts.onProgress?.(done, leads.length, `✓ ${leadName}`);
            } else {
                report.failed++;
                const reason = r.status === 'rejected' ? String(r.reason) : 'empty';
                await logWarn('parallel_enricher.lead_failed', { leadId: lead.id, reason });
                opts.onProgress?.(done, leads.length, `✗ ${leadName}`);
            }
        }
    }

    report.durationMs = Date.now() - startMs;
    await logInfo('parallel_enricher.done', {
        ...report,
        avgPerLeadMs: leads.length > 0 ? Math.round(report.durationMs / leads.length) : 0,
    });

    return report;
}

/**
 * Arricchisce un singolo lead e persiste i risultati nel DB.
 */
async function enrichSingleLead(
    db: Awaited<ReturnType<typeof getDatabase>>,
    lead: LeadRow,
): Promise<EnrichmentResult | null> {
    try {
        const result = await enrichLeadAuto(lead);

        if (!result.email && !result.phone && !result.companyDomain && !result.jobTitle) {
            // Nessun dato trovato — registra comunque per evitare re-enrichment
            await db.run(
                `INSERT OR REPLACE INTO lead_enrichment_data
                 (lead_id, data_points, confidence, sources_json, enriched_at, updated_at)
                 VALUES (?, 0, 0, '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [lead.id],
            );
            return null;
        }

        // Aggiorna campi core sulla tabella leads
        await db.run(
            `UPDATE leads SET
                email = COALESCE(email, ?),
                phone = COALESCE(phone, ?),
                company_domain = COALESCE(company_domain, ?),
                business_email = COALESCE(business_email, ?),
                business_email_confidence = CASE
                    WHEN business_email IS NOT NULL THEN business_email_confidence
                    WHEN ? IS NOT NULL THEN ?
                    ELSE business_email_confidence
                END,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [
                result.email, result.phone, result.companyDomain,
                result.businessEmail,
                result.businessEmail, result.businessEmailConfidence,
                lead.id,
            ],
        );

        // Registra enrichment completo
        await db.run(
            `INSERT OR REPLACE INTO lead_enrichment_data
             (lead_id, company_json, phones_json, socials_json, seniority, department,
              data_points, confidence, sources_json, domain_source, enriched_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [
                lead.id,
                result.companyName || result.companyDomain || result.industry
                    ? JSON.stringify({ name: result.companyName, domain: result.companyDomain, industry: result.industry })
                    : null,
                result.phone ? JSON.stringify([{ number: result.phone, type: 'work', source: result.source }]) : null,
                result.deepEnrichment?.socialProfiles?.length
                    ? JSON.stringify(result.deepEnrichment.socialProfiles)
                    : null,
                result.seniority,
                result.deepEnrichment?.department ?? null,
                [result.email, result.phone, result.jobTitle, result.companyName, result.location, result.seniority]
                    .filter(Boolean).length,
                result.emailConfidence,
                JSON.stringify(result.enrichmentSources ? Object.entries(result.enrichmentSources).map(([k, v]) => `${k}:${v}`) : [result.source]),
                result.domainSource ?? null,
            ],
        );

        // CC-29: Sync enrichment data verso Supabase (non-bloccante)
        if (lead.linkedin_url) {
            bridgeLeadUpsert({
                linkedin_url: lead.linkedin_url,
                first_name: lead.first_name ?? '',
                last_name: lead.last_name ?? '',
                job_title: '',
                account_name: lead.account_name ?? '',
                website: lead.website ?? '',
                list_name: '',
                status: '',
                email: result.email,
                phone: result.phone,
                company_domain: result.companyDomain ?? null,
                business_email: result.businessEmail ?? null,
                business_email_confidence: result.businessEmailConfidence ?? null,
            });
        }

        return result;
    } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        await logError('parallel_enricher.lead_error', { leadId: lead.id, error: errMsg });
        // CC-23: Registra il tentativo fallito per evitare re-enrichment infinito.
        // data_points = -1 è il flag per "tutti gli enricher hanno fallito" (distingue da "0 risultati trovati").
        try {
            await db.run(
                `INSERT OR REPLACE INTO lead_enrichment_data
                 (lead_id, data_points, confidence, sources_json, enriched_at, updated_at)
                 VALUES (?, -1, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [lead.id, JSON.stringify([`error:${errMsg.slice(0, 200)}`])],
            );
        } catch {
            // best-effort: non bloccare il flusso principale
        }
        throw error;
    }
}
