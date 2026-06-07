import { WorkerContext } from './context';
import { WorkerExecutionResult, workerResult } from './result';
import { enrichLeadAuto } from '../integrations/leadEnricher';
import { persistEnrichmentResult } from '../integrations/persistEnrichment';
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
        gdpr_opt_out: number | null;
    }>(
        `SELECT id, first_name, last_name, account_name, website, linkedin_url, company_domain, location, gdpr_opt_out FROM leads WHERE id = ?`,
        [payload.leadId],
    );

    if (!lead) {
        await logError('enrichment.worker.missing_lead', { leadId: payload.leadId });
        return workerResult(0, [{ leadId: payload.leadId, message: 'Lead non trovato in database' }]);
    }

    // H17 fix (GDPR Art.21): se il lead ha esercitato l'opposizione (gdpr_opt_out=1), NON arricchire
    // (nessuna raccolta ne trasferimento PII a processor terzi). Difesa esplicita oltre al gate
    // centrale in enrichLeadAuto: evita anche di caricare/processare il lead per nulla.
    if (lead.gdpr_opt_out) {
        await logInfo('enrichment.worker.skipped_opt_out', { leadId: payload.leadId });
        return workerResult(0, [{ leadId: payload.leadId, message: 'Lead con gdpr_opt_out: enrichment saltato' }]);
    }

    if (context.dryRun) {
        return workerResult(1);
    }

    try {
        const result = await enrichLeadAuto(lead);

        await persistEnrichmentResult({
            leadId: payload.leadId,
            email: result.email,
            phone: result.phone,
            companyDomain: result.companyDomain,
            businessEmail: result.businessEmail,
            businessEmailConfidence: result.businessEmailConfidence,
            emailConfidence: result.emailConfidence,
            companyName: result.companyName,
            industry: result.industry,
            seniority: result.seniority,
            jobTitle: result.jobTitle,
            location: result.location,
            source: result.source,
            domainSource: result.domainSource,
            deepEnrichment: result.deepEnrichment,
        });

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
