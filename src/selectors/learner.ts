import {
    listOpenSelectorFailures,
    listSelectorFallbackAggregates,
    markSelectorFailuresResolved,
    upsertDynamicSelector,
} from '../core/repositories';
import { logInfo, logWarn } from '../telemetry/logger';

export interface SelectorLearnerReport {
    scannedFailures: number;
    promotedSelectors: number;
    resolvedGroups: number;
    dryRun: boolean;
}

export interface SelectorLearnerOptions {
    minSuccess?: number;
    limit?: number;
    dryRun?: boolean;
}

export async function runSelectorLearner(options: SelectorLearnerOptions = {}): Promise<SelectorLearnerReport> {
    const minSuccess = Math.max(2, options.minSuccess ?? 3);
    const limit = Math.max(1, options.limit ?? 100);
    const dryRun = options.dryRun === true;

    const [openFailures, fallbackAggregates] = await Promise.all([
        listOpenSelectorFailures(limit),
        listSelectorFallbackAggregates(minSuccess, limit),
    ]);

    let promotedSelectors = 0;
    let resolvedGroups = 0;
    const promotedLabels = new Set<string>();

    for (const aggregate of fallbackAggregates) {
        const confidence = Math.min(0.95, 0.45 + Math.min(0.5, aggregate.success_count / 20));
        if (!dryRun) {
            await upsertDynamicSelector(aggregate.action_label, aggregate.selector, confidence, 'fallback_learner');
        }
        promotedSelectors += 1;
        promotedLabels.add(aggregate.action_label);
    }

    for (const label of promotedLabels) {
        const hasOpenForLabel = openFailures.some((failure) => failure.action_label === label);
        if (!hasOpenForLabel) continue;
        if (!dryRun) {
            await markSelectorFailuresResolved(label);
        }
        resolvedGroups += 1;
    }

    const report: SelectorLearnerReport = {
        scannedFailures: openFailures.length,
        promotedSelectors,
        resolvedGroups,
        dryRun,
    };

    if (promotedSelectors > 0) {
        await logInfo('selector_learner.promoted', { ...report });
    } else {
        await logWarn('selector_learner.no_promotions', { ...report });
    }

    return report;
}
