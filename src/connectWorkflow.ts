import { runWorkflow } from './core/orchestrator';

export async function runConnectionWorkflow(): Promise<void> {
    await runWorkflow({
        workflow: 'invite',
        dryRun: false,
    });
}

