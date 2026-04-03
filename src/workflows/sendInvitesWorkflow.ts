/**
 * Workflow 4: send-invites — adapter CLI sottile sopra il service tipizzato.
 */

import { config } from '../config';
import { askConfirmation, isInteractiveTTY, readLineFromStdin } from '../cli/stdinHelper';
import { formatWorkflowExecutionResult, sendWorkflowExecutionTelegramReport } from './reportFormatter';
import { executeSendInvitesWorkflow } from './services/sendInvitesService';
import { runSyncSearchWorkflow } from './syncSearchWorkflow';
import type { SendInvitesWorkflowRequest, WorkflowExecutionResult } from './types';

export interface SendInvitesOptions extends Omit<SendInvitesWorkflowRequest, 'workflow'> {}

function printNoWorkHint(result: WorkflowExecutionResult): void {
    if (result.blocked?.reason !== 'NO_WORK_AVAILABLE') {
        return;
    }

    const extra = result.artifacts?.extra;
    const totalInDb = typeof extra?.['totalInDb'] === 'number' ? extra['totalInDb'] : 0;
    const newCount = typeof extra?.['newCount'] === 'number' ? extra['newCount'] : 0;
    const listName = typeof result.blocked.details?.['listName'] === 'string' ? result.blocked.details['listName'] : null;

    if (newCount > 0) {
        console.log(`\n  ${totalInDb} lead nel DB, ${newCount} ancora in stato NEW.`);
        console.log("  Esegui enrichment o sync-list prima di rilanciare send-invites.\n");
        return;
    }

    if (listName) {
        console.log(`\n  Nessun lead READY_INVITE disponibile nella lista "${listName}".\n`);
        return;
    }

    console.log('\n  Nessun lead READY_INVITE disponibile al momento.\n');
}

async function maybeRunSyncSearchFallback(
    result: WorkflowExecutionResult,
    opts: SendInvitesOptions,
): Promise<void> {
    if (opts.dryRun || result.blocked?.reason !== 'NO_WORK_AVAILABLE' || !isInteractiveTTY()) {
        return;
    }

    const wantSync = await askConfirmation(
        '  Non ci sono lead READY_INVITE disponibili. Vuoi estrarre nuovi lead da una ricerca salvata di Sales Navigator? [Y/n] ',
    );
    if (!wantSync) {
        return;
    }

    const searchName = await readLineFromStdin('  Nome della ricerca salvata (lascia vuoto per farle tutte): ');
    const targetList = await readLineFromStdin(
        `  Nome della lista in cui aggiungere i nuovi lead (default: ${opts.listName || config.salesNavSyncListName || 'default'}): `,
    );
    const selectedAccountId =
        result.artifacts?.preflight?.selectedAccountId && typeof result.artifacts.preflight.selectedAccountId === 'string'
            ? result.artifacts.preflight.selectedAccountId
            : opts.accountId;

    console.log('\n  Passaggio automatico al flow sync-search...\n');
    await runSyncSearchWorkflow({
        searchName: searchName || undefined,
        listName: targetList || opts.listName || config.salesNavSyncListName || 'default',
        enrichment: true,
        dryRun: false,
        accountId: selectedAccountId,
        skipPreflight: true,
    });
}

export async function runSendInvitesWorkflow(opts: SendInvitesOptions): Promise<void> {
    const result = await executeSendInvitesWorkflow(opts);

    printNoWorkHint(result);
    console.log(formatWorkflowExecutionResult(result));
    await sendWorkflowExecutionTelegramReport(result);
    await maybeRunSyncSearchFallback(result, opts);
}
