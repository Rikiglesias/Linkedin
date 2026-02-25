import { runWorkflow } from './core/orchestrator';

export async function runAcceptanceChecker(): Promise<void> {
    await runWorkflow({
        workflow: 'check',
        dryRun: false,
    });
}

