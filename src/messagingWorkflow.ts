import { runWorkflow } from './core/orchestrator';

export async function runMessagingWorkflow(): Promise<void> {
    await runWorkflow({
        workflow: 'message',
        dryRun: false,
    });
}

