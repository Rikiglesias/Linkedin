import type { IPlugin } from '../src/plugins/IPlugin';
import { runRandomLinkedinActivity } from '../src/workers/randomActivityWorker';
import { config } from '../src/config';
import { logInfo, logWarn } from '../src/telemetry/logger';

const plugin: IPlugin = {
    name: 'fake-activity',
    version: '1.0.0',

    async onIdle(event) {
        if (!config.randomActivityEnabled) return;
        if (Math.random() > 0.4) return;

        try {
            const report = await runRandomLinkedinActivity({
                accountId: config.salesNavSyncAccountId || undefined,
                maxActions: Math.max(1, Math.min(2, config.randomActivityMaxActions)),
                dryRun: false,
            });
            await logInfo('plugin.fake_activity.executed', {
                cycle: event.cycle,
                workflow: event.workflow,
                actionsExecuted: report.actionsExecuted,
                errors: report.errors,
            });
        } catch (error) {
            await logWarn('plugin.fake_activity.failed', {
                cycle: event.cycle,
                workflow: event.workflow,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    },
};

export default plugin;

