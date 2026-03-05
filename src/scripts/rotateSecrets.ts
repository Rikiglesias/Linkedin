import { closeDatabase, initDatabase } from '../db';
import { runSecretRotationWorker } from '../core/secretRotationWorker';

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
    const apply = hasFlag(args, '--apply');
    const intervalDaysRaw = getOptionValue(args, '--interval-days');
    const intervalDays = intervalDaysRaw ? Math.max(1, Number.parseInt(intervalDaysRaw, 10) || 7) : 7;
    const actor = (getOptionValue(args, '--actor') ?? 'secret_rotation_worker').trim() || 'secret_rotation_worker';
    const includeRaw = getOptionValue(args, '--include');
    const includeSecrets = includeRaw
        ? includeRaw
              .split(',')
              .map((value) => value.trim())
              .filter((value) => value.length > 0)
        : undefined;
    const envFilePath = getOptionValue(args, '--env-file');

    await initDatabase();
    try {
        const result = await runSecretRotationWorker({
            apply,
            intervalDays,
            actor,
            includeSecrets,
            envFilePath,
        });
        console.log(JSON.stringify(result, null, 2));
    } finally {
        await closeDatabase();
    }
}

main().catch((error) => {
    console.error('[SECRET_ROTATION_WORKER_ERROR]', error);
    process.exit(1);
});
