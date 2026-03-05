import { config } from '../config';
import { closeDatabase, initDatabase } from '../db';
import { getAiQualitySnapshot, runAiValidationPipeline } from '../core/repositories';
import { runSelectorLearner } from '../selectors/learner';

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

function parseNonNegativeFloat(raw: string | null, fallback: number): number {
    if (!raw) return fallback;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function hasOption(args: string[], option: string): boolean {
    return args.includes(option);
}

async function run(): Promise<void> {
    const args = process.argv.slice(2);
    const lookbackDays = parsePositiveInt(getOptionValue(args, '--days'), 30);
    const triggeredBy = getOptionValue(args, '--by') ?? 'cli';
    const skipValidation = hasOption(args, '--skip-validation');
    const skipSelectorLearning = hasOption(args, '--skip-selector-learning');
    const selectorDryRun = hasOption(args, '--selector-dry-run');

    await initDatabase();
    try {
        const validationRun = skipValidation ? null : await runAiValidationPipeline(triggeredBy);
        const selectorLearning = skipSelectorLearning
            ? null
            : await runSelectorLearner({
                  dryRun: selectorDryRun,
                  triggeredBy,
                  minSuccess: parsePositiveInt(
                      getOptionValue(args, '--selector-min-success'),
                      config.selectorLearningMinSuccess,
                  ),
                  limit: parsePositiveInt(getOptionValue(args, '--selector-limit'), config.selectorLearningLimit),
                  lookbackDays: parsePositiveInt(
                      getOptionValue(args, '--selector-lookback-days'),
                      config.selectorLearningEvaluationWindowDays,
                  ),
                  failureDegradeRatio: parseNonNegativeFloat(
                      getOptionValue(args, '--selector-failure-degrade-ratio'),
                      config.selectorLearningFailureDegradeRatio,
                  ),
                  failureDegradeMinDelta: parsePositiveInt(
                      getOptionValue(args, '--selector-failure-degrade-min-delta'),
                      config.selectorLearningFailureDegradeMinDelta,
                  ),
                  autoRollback: config.selectorLearningAutoRollbackEnabled,
              });
        const quality = await getAiQualitySnapshot(lookbackDays);

        const payload = {
            validationRun: validationRun
                ? {
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
                  }
                : null,
            selectorLearning,
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
