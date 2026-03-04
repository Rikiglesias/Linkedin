import { WorkerContext } from './context';
import { WorkerExecutionResult, workerResult } from './result';
import { getEmailEnricher } from '../services/emailEnricher';
import { getDatabase } from '../db';
import { logError, logInfo } from '../telemetry/logger';

export interface EnrichmentJobPayload {
    leadId: number;
    campaignStateId?: number;
}

export async function processEnrichmentJob(payload: EnrichmentJobPayload, context: WorkerContext): Promise<WorkerExecutionResult> {
    const enricher = getEmailEnricher();
    const db = await getDatabase();

    // Recupera informazioni principali richieste dal context proxy
    const lead = await db.get<{ first_name: string; last_name: string; account_name: string; website: string }>(
        `SELECT first_name, last_name, account_name, website FROM leads WHERE id = ?`,
        [payload.leadId]
    );

    if (!lead) {
        await logError('enrichment.worker.missing_lead', { leadId: payload.leadId });
        return workerResult(0, [{ leadId: payload.leadId, message: 'Dati anagrafici del Lead non trovati a Database' }]);
    }

    if (context.dryRun) {
        console.log(`[DRY RUN] Simulo recupero Email e Telefono per lead ID ${payload.leadId}`);
        return workerResult(1);
    }

    try {
        await enricher.enrichLeadContactData(
            payload.leadId,
            lead.first_name,
            lead.last_name,
            lead.account_name,
            lead.website
        );

        await logInfo('enrichment.worker.success', { leadId: payload.leadId, accountId: context.accountId });
        return workerResult(1);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await logError('enrichment.worker.error', { leadId: payload.leadId, error: message });
        return workerResult(0, [{ leadId: payload.leadId, message }]);
    }
}
