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
    }>(
        `SELECT id, first_name, last_name, account_name, website FROM leads WHERE id = ?`,
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

        if (result.email) {
            await db.run(
                `UPDATE leads SET email = COALESCE(email, ?), phone = COALESCE(phone, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [result.email, result.phone, payload.leadId],
            );
        }

        await logInfo('enrichment.worker.done', {
            leadId: payload.leadId,
            accountId: context.accountId,
            source: result.source,
            emailFound: !!result.email,
        });
        return workerResult(1);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await logError('enrichment.worker.error', { leadId: payload.leadId, error: message });
        return workerResult(0, [{ leadId: payload.leadId, message }]);
    }
}
