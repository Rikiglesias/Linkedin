import { WorkerContext } from './context';
import { WorkerExecutionResult, workerResult } from './result';
import { enrichLeadAuto } from '../integrations/leadEnricher';
import { persistEnrichmentResult } from '../integrations/persistEnrichment';
import { getDatabase } from '../db';
import { getRuntimeFlag, setRuntimeFlag } from '../core/repositories';
import { logError, logInfo, logWarn } from '../telemetry/logger';

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

        // Fallimento TRANSIENT (proxy integration esausto / timeout / circuit aperto): NON persistere.
        // Scrivere ora un record vuoto in lead_enrichment_data marcherebbe il lead come "arricchito":
        // i lead senza account_name non rientrano nella query di re-enrichment (leadsCore.ts) → persi
        // per sempre. Skip pulito → il lead resta needs-enrichment e lo scheduler lo ri-accoda dopo il
        // recovery del proxy. workerResult(0) senza error = skip (nessun retry-on-error che brucia i tentativi).
        if (result.transientFailure) {
            await logInfo('enrichment.worker.transient_skip', {
                leadId: payload.leadId,
                accountId: context.accountId,
            });
            return workerResult(0);
        }

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

        // Daily-cap fix (M19): incrementa il contatore giornaliero che lo scheduler legge per applicare
        // ENRICHMENT_DAILY_HARD_CAP. Era MAI scritto → il cap non frenava mai (rischio superamento budget
        // query/die). context.localDate = stessa data del reader (loopCommand getLocalDateString, condivisa
        // con buildSchedule). Conta solo i completati: transient/opt-out/dryRun NON consumano cap (b4b551b).
        // Best-effort: un errore qui NON deve far fallire un enrichment già persistito (eviterebbe un retry inutile).
        try {
            const capKey = `enrichment_count:${context.localDate}`;
            const priorCount = parseInt((await getRuntimeFlag(capKey)) ?? '0', 10) || 0;
            await setRuntimeFlag(capKey, String(priorCount + 1));
        } catch (capError) {
            await logWarn('enrichment.worker.cap_increment_failed', {
                leadId: payload.leadId,
                error: capError instanceof Error ? capError.message : String(capError),
            });
        }

        return workerResult(1);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await logError('enrichment.worker.error', { leadId: payload.leadId, error: message });
        return workerResult(0, [{ leadId: payload.leadId, message }]);
    }
}
