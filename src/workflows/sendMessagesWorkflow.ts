/**
 * Workflow 3: send-messages — adapter CLI sottile sopra il service tipizzato.
 */

import { formatWorkflowExecutionResult, sendWorkflowExecutionTelegramReport } from './reportFormatter';
import { executeSendMessagesWorkflow } from './services/sendMessagesService';
import type { SendMessagesWorkflowRequest, WorkflowExecutionResult } from './types';

export interface SendMessagesOptions extends Omit<SendMessagesWorkflowRequest, 'workflow'> {}

function printMessagePreview(result: WorkflowExecutionResult): void {
    const extra = result.artifacts?.extra;
    const previewMessage = extra?.['previewMessage'];
    if (
        !previewMessage ||
        typeof previewMessage !== 'object' ||
        typeof (previewMessage as { source?: unknown }).source !== 'string' ||
        typeof (previewMessage as { message?: unknown }).message !== 'string'
    ) {
        return;
    }

    const typedPreview = previewMessage as { source: string; message: string };
    console.log(`\n  Preview messaggio (${typedPreview.source}):`);
    console.log('  ┌──────────────────────────────────────────────');
    for (const line of typedPreview.message.split('\n')) {
        console.log(`  │ ${line}`);
    }
    console.log('  └──────────────────────────────────────────────\n');
}

function printNoWorkHint(result: WorkflowExecutionResult): void {
    if (result.blocked?.reason !== 'NO_WORK_AVAILABLE') {
        return;
    }
    const listName = typeof result.blocked.details?.['listName'] === 'string' ? result.blocked.details['listName'] : null;
    if (listName) {
        console.log(`\n  Nessun lead ACCEPTED/READY_MESSAGE disponibile nella lista "${listName}".\n`);
        return;
    }
    console.log('\n  Nessun lead ACCEPTED/READY_MESSAGE disponibile al momento.\n');
}

export async function runSendMessagesWorkflow(opts: SendMessagesOptions): Promise<void> {
    const result = await executeSendMessagesWorkflow(opts);

    printMessagePreview(result);
    printNoWorkHint(result);
    console.log(formatWorkflowExecutionResult(result));
    await sendWorkflowExecutionTelegramReport(result);
}
