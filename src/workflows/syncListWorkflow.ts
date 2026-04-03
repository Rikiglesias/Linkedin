/**
 * Workflow 1: sync-list — adapter CLI sottile sopra il service tipizzato.
 */

import { formatFinalReport } from '../core/salesNavigatorSync';
import { formatWorkflowExecutionResult, sendWorkflowExecutionTelegramReport } from './reportFormatter';
import { executeSyncListWorkflow } from './services/syncListService';
import type { SyncListWorkflowRequest } from './types';

export interface SyncListOptions extends Omit<SyncListWorkflowRequest, 'workflow'> {}

export async function runSyncListWorkflow(opts: SyncListOptions): Promise<void> {
    const result = await executeSyncListWorkflow(opts);
    const syncReport = result.artifacts?.extra?.['syncReport'];

    if (syncReport && typeof syncReport === 'object') {
        console.log(formatFinalReport(syncReport as Parameters<typeof formatFinalReport>[0]));
    }

    console.log(formatWorkflowExecutionResult(result));
    await sendWorkflowExecutionTelegramReport(result);
}
