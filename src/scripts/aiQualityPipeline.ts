import { closeDatabase, initDatabase } from '../db';
import { getAiQualitySnapshot, runAiValidationPipeline } from '../core/repositories';

function getOptionValue(args: string[], option: string): string | null {
    const index = args.indexOf(option);
    if (index < 0) return null;
    const value = args[index + 1];
    return value ?? null;
}

function parsePositiveInt(raw: string | null, fallback: number): number {
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function run(): Promise<void> {
    const args = process.argv.slice(2);
    const lookbackDays = parsePositiveInt(getOptionValue(args, '--days'), 30);
    const triggeredBy = getOptionValue(args, '--by') ?? 'cli';

    await initDatabase();
    try {
        const validationRun = await runAiValidationPipeline(triggeredBy);
        const quality = await getAiQualitySnapshot(lookbackDays);

        const payload = {
            validationRun: {
                id: validationRun.id,
                status: validationRun.status,
                startedAt: validationRun.started_at,
                finishedAt: validationRun.finished_at,
                summary: (() => {
                    try {
                        return JSON.parse(validationRun.summary_json);
                    } catch {
                        return {};
                    }
                })(),
            },
            quality,
        };
        console.log(JSON.stringify(payload, null, 2));
    } finally {
        await closeDatabase();
    }
}

run().catch((error) => {
    console.error('[ai-quality-pipeline] failed', error);
    process.exit(1);
});

