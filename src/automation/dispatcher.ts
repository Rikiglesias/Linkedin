import { runWorkflow } from '../core/orchestrator';
import { executeSendInvitesWorkflow } from '../workflows/services/sendInvitesService';
import { executeSendMessagesWorkflow } from '../workflows/services/sendMessagesService';
import { executeSyncListWorkflow } from '../workflows/services/syncListService';
import { executeSyncSearchWorkflow } from '../workflows/services/syncSearchService';
import type {
    AutomationCommandExecutionResult,
    AutomationCommandPayloadMap,
    ParsedAutomationCommandRecord,
} from './types';

export async function dispatchAutomationCommand(
    command: ParsedAutomationCommandRecord,
): Promise<AutomationCommandExecutionResult> {
    try {
        return await dispatchAutomationCommandInner(command);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        return {
            workflow: command.kind,
            success: false,
            blocked: { reason: 'WORKFLOW_ERROR', message },
            summary: { status: 'FAILED' },
            errors: [message],
            nextAction: 'Incidente runtime non gestito. Controlla i log del loop per lo stack trace completo.',
            details: { error: message, ...(stack ? { stack } : {}) },
        };
    }
}

async function dispatchAutomationCommandInner(
    command: ParsedAutomationCommandRecord,
): Promise<AutomationCommandExecutionResult> {
    switch (command.kind) {
        case 'sync-search': {
            const payload = command.payload as AutomationCommandPayloadMap['sync-search'];
            return executeSyncSearchWorkflow({
                ...payload,
                dryRun: false,
                skipPreflight: true,
            });
        }
        case 'sync-list': {
            const payload = command.payload as AutomationCommandPayloadMap['sync-list'];
            return executeSyncListWorkflow({
                ...payload,
                dryRun: false,
                interactive: false,
                skipPreflight: true,
            });
        }
        case 'send-invites': {
            const payload = command.payload as AutomationCommandPayloadMap['send-invites'];
            return executeSendInvitesWorkflow({
                ...payload,
                dryRun: false,
                skipPreflight: true,
            });
        }
        case 'send-messages': {
            const payload = command.payload as AutomationCommandPayloadMap['send-messages'];
            return executeSendMessagesWorkflow({
                ...payload,
                dryRun: false,
                skipPreflight: true,
            });
        }
        case 'workflow-all':
        case 'workflow-check':
        case 'workflow-warmup': {
            const payload = command.payload as AutomationCommandPayloadMap['workflow-all'];
            const outcome = await runWorkflow({
                workflow: payload.workflow,
                dryRun: false,
            });
            if (outcome.status === 'blocked' && outcome.blocked) {
                return {
                    workflow: command.kind,
                    success: false,
                    blocked: outcome.blocked,
                    summary: {
                        workflow: payload.workflow,
                    },
                    errors: [],
                    nextAction: outcome.blocked.message,
                    details: {
                        workflow: payload.workflow,
                        status: outcome.status,
                    },
                };
            }
            return {
                workflow: command.kind,
                success: true,
                blocked: null,
                summary: {
                    workflow: payload.workflow,
                    status: outcome.status,
                },
                errors: [],
                nextAction: `Workflow legacy ${payload.workflow} completato`,
                details: {
                    workflow: payload.workflow,
                    status: outcome.status,
                },
            };
        }
        default: {
            const unreachable: never = command.kind;
            throw new Error(`Automation command kind non supportato: ${String(unreachable)}`);
        }
    }
}
