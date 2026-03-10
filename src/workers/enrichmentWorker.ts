import { WorkerContext } from './context';
import { WorkerExecutionResult, workerResult } from './result';
import { enrichLeadAuto } from '../integrations/leadEnricher';
import { getDatabase } from '../db';
import { logError, logInfo } from '../telemetry/logger';

export interface EnrichmentJobPayload {
    leadId: number;
    campaignStateId?: number;
}

export async function processEnrichmentJob(
    payload: EnrichmentJobPayload,
    context: WorkerContext,
): Promise<WorkerExecutionResult> {
    const db = await getDatabase();

    const lead = await db.get<{
        id: number;
        first_name: string | null;
        last_name: string | null;
        account_name: string | null;
        website: string | null;
        linkedin_url: string | null;
        company_domain: string | null;
        location: string | null;
    }>(
        `SELECT id, first_name, last_name, account_name, website, linkedin_url, company_domain, location FROM leads WHERE id = ?`,
        [payload.leadId],
    );

    if (!lead) {
        await logError('enrichment.worker.missing_lead', { leadId: payload.leadId });
        return workerResult(0, [
            { leadId: payload.leadId, message: 'Lead non trovato in database' },
        ]);
    }

    if (context.dryRun) {
        return workerResult(1);
    }

    try {
        const result = await enrichLeadAuto(lead);

        // Update core fields on leads table
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
                payload.leadId,
            ],
        );

        // Persist full enrichment result to lead_enrichment_data (prevents re-enrichment)
        await db.run(
            `INSERT OR REPLACE INTO lead_enrichment_data
             (lead_id, company_json, phones_json, socials_json, seniority, department, data_points, confidence, sources_json, domain_source, enriched_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [
                payload.leadId,
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
                JSON.stringify([result.source]),
                result.domainSource ?? null,
            ],
        );

        await logInfo('enrichment.worker.done', {
            leadId: payload.leadId,
            accountId: context.accountId,
            source: result.source,
            emailFound: !!result.email,
            businessEmailFound: !!result.businessEmail,
        });
        return workerResult(1);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await logError('enrichment.worker.error', { leadId: payload.leadId, error: message });
        return workerResult(0, [{ leadId: payload.leadId, message }]);
    }
}
