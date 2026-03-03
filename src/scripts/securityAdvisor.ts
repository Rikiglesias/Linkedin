import { closeDatabase, initDatabase } from '../db';
import { runSecurityAdvisor } from '../core/securityAdvisor';

function getOptionValue(args: string[], key: string): string | undefined {
    const index = args.indexOf(key);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) return undefined;
    return value;
}

function hasFlag(args: string[], flag: string): boolean {
    return args.includes(flag);
}

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
