/**
 * Workflow 2: sync-search — adapter CLI sottile sopra il service tipizzato.
 */

import { formatFinalReport } from '../core/salesNavigatorSync';
import { formatWorkflowExecutionResult, sendWorkflowExecutionTelegramReport } from './reportFormatter';
import { executeSyncSearchWorkflow } from './services/syncSearchService';
import type { SyncSearchWorkflowRequest } from './types';

export interface SyncSearchOptions extends Omit<SyncSearchWorkflowRequest, 'workflow'> {}

export async function runSyncSearchWorkflow(opts: SyncSearchOptions): Promise<void> {
    const result = await executeSyncSearchWorkflow(opts);
    const syncReport = result.artifacts?.extra?.['syncReport'];

    if (syncReport && typeof syncReport === 'object') {
        console.log(formatFinalReport(syncReport as Parameters<typeof formatFinalReport>[0]));
    }

    console.log(formatWorkflowExecutionResult(result));
    await sendWorkflowExecutionTelegramReport(result);
}
