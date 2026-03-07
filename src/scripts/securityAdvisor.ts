import { closeDatabase, initDatabase } from '../db';
import { runSecurityAdvisor } from '../core/securityAdvisor';
import { getOptionValue, hasOption as hasFlag } from '../cli/cliParser';

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const triggeredBy = (getOptionValue(args, '--by') ?? 'script').trim() || 'script';
    const reportDir = getOptionValue(args, '--report-dir');
    const persistRuntimeFlags = !hasFlag(args, '--no-persist-flags');

    await initDatabase();
    try {
        const report = await runSecurityAdvisor({
            triggeredBy,
            reportDir,
            persistRuntimeFlags,
        });
        console.log(JSON.stringify(report, null, 2));
        if (report.status === 'FAILED') {
            process.exitCode = 1;
        }
    } finally {
        await closeDatabase();
    }
}

main().catch((error) => {
    console.error('[SECURITY_ADVISOR_ERROR]', error);
    process.exit(1);
});
