import {
    completeSelectorLearningRun,
    countOpenSelectorFailuresByActionLabels,
    createSelectorLearningRun,
    getDynamicSelectorState,
    getLatestPromotedSelectorLearningRun,
    listOpenSelectorFailures,
    listSelectorFallbackAggregates,
    markSelectorFailuresResolved,
    recordSelectorLearningRunEvaluation,
    restoreDynamicSelectorSnapshots,
    upsertDynamicSelector,
} from '../core/repositories';
import type { SelectorLearningRollbackSnapshotEntry } from '../core/repositories';
import { logInfo, logWarn } from '../telemetry/logger';

const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_FAILURE_DEGRADE_RATIO = 0.35;
const DEFAULT_FAILURE_DEGRADE_MIN_DELTA = 2;

export interface SelectorModelDegradationInput {
    baselineOpenFailures: number;
    currentOpenFailures: number;
    degradeRatio: number;
    degradeMinDelta: number;
}

export interface SelectorModelDegradationDecision {
    degraded: boolean;
    absoluteIncrease: number;
    requiredIncrease: number;
    baselineOpenFailures: number;
    currentOpenFailures: number;
}

export interface SelectorLearnerRollbackReport {
    evaluatedRunId: number | null;
    evaluatedLabels: number;
    baselineOpenFailures: number;
    currentOpenFailures: number;
    degraded: boolean;
    rolledBack: boolean;
    restoredSelectors: number;
    deletedSelectors: number;
    reason: string | null;
}

export interface SelectorLearnerReport {
    runId: number | null;
    status: 'PROMOTED' | 'NO_OP' | 'ROLLBACK_ONLY' | 'DRY_RUN';
    sourceTag: string;
    lookbackDays: number;
    scannedFailures: number;
    promotedSelectors: number;
    resolvedGroups: number;
    baselineOpenFailures: number;
    promotedLabels: string[];
    rollback: SelectorLearnerRollbackReport | null;
    dryRun: boolean;
}

export interface SelectorLearnerOptions {
    minSuccess?: number;
    limit?: number;
    lookbackDays?: number;
    failureDegradeRatio?: number;
    failureDegradeMinDelta?: number;
    autoRollback?: boolean;
    skipPromotionOnRollback?: boolean;
    triggeredBy?: string;
    dryRun?: boolean;
}

function buildRunSourceTag(): string {
    const nowToken = Date.now().toString(36);
    const randToken = Math.floor(Math.random() * 0xffffff).toString(36);
    return `selector_learner.run:${nowToken}:${randToken}`;
}

function parsePromotedLabels(summaryJson: string): string[] {
    try {
        const parsed = JSON.parse(summaryJson) as unknown;
        if (!parsed || typeof parsed !== 'object') return [];
        const candidate = (parsed as { promotedLabels?: unknown }).promotedLabels;
        if (!Array.isArray(candidate)) return [];
        return Array.from(new Set(
            candidate
                .filter((entry): entry is string => typeof entry === 'string')
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0)
        ));
    } catch {
        return [];
    }
}

function parseRollbackSnapshot(raw: string): SelectorLearningRollbackSnapshotEntry[] {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
            .map((entry) => ({
                actionLabel: typeof entry.actionLabel === 'string' ? entry.actionLabel : '',
                selector: typeof entry.selector === 'string' ? entry.selector : '',
                existedBefore: entry.existedBefore === true,
                previousConfidence: typeof entry.previousConfidence === 'number' ? entry.previousConfidence : null,
                previousSource: typeof entry.previousSource === 'string' ? entry.previousSource : null,
                previousActive: typeof entry.previousActive === 'number' ? entry.previousActive : null,
                previousSuccessCount: typeof entry.previousSuccessCount === 'number' ? entry.previousSuccessCount : null,
                previousLastValidatedAt: typeof entry.previousLastValidatedAt === 'string' ? entry.previousLastValidatedAt : null,
            }))
            .filter((entry) => entry.actionLabel.length > 0 && entry.selector.length > 0);
    } catch {
        return [];
    }
}

function computePromotionConfidence(successCount: number): number {
    const safeSuccess = Math.max(0, successCount);
    return Math.min(0.97, 0.45 + Math.min(0.5, safeSuccess / 20));
}

export function assessSelectorModelDegradation(input: SelectorModelDegradationInput): SelectorModelDegradationDecision {
    const baselineOpenFailures = Math.max(0, Math.floor(input.baselineOpenFailures));
    const currentOpenFailures = Math.max(0, Math.floor(input.currentOpenFailures));
    const degradeRatio = Math.max(0, input.degradeRatio);
    const degradeMinDelta = Math.max(1, Math.floor(input.degradeMinDelta));
    const absoluteIncrease = Math.max(0, currentOpenFailures - baselineOpenFailures);
    const requiredIncrease = baselineOpenFailures <= 0
        ? degradeMinDelta
        : Math.max(degradeMinDelta, Math.ceil(baselineOpenFailures * degradeRatio));
    return {
        degraded: absoluteIncrease >= requiredIncrease,
        absoluteIncrease,
        requiredIncrease,
        baselineOpenFailures,
        currentOpenFailures,
    };
}

export async function runSelectorLearner(options: SelectorLearnerOptions = {}): Promise<SelectorLearnerReport> {
    const minSuccess = Math.max(2, options.minSuccess ?? 3);
    const limit = Math.max(1, options.limit ?? 100);
    const lookbackDays = Math.max(1, options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS);
    const failureDegradeRatio = Math.max(0, options.failureDegradeRatio ?? DEFAULT_FAILURE_DEGRADE_RATIO);
    const failureDegradeMinDelta = Math.max(1, Math.floor(options.failureDegradeMinDelta ?? DEFAULT_FAILURE_DEGRADE_MIN_DELTA));
    const autoRollback = options.autoRollback !== false;
    const skipPromotionOnRollback = options.skipPromotionOnRollback !== false;
    const triggeredBy = (options.triggeredBy ?? 'selector_learner').trim() || 'selector_learner';
    const dryRun = options.dryRun === true;
    const sourceTag = buildRunSourceTag();

    let runId: number | null = null;
    if (!dryRun) {
        const createdRunId = await createSelectorLearningRun({
            triggeredBy,
            sourceTag,
            lookbackDays,
            minSuccess,
        });
        runId = createdRunId > 0 ? createdRunId : null;
    }

    const [openFailures, fallbackAggregates] = await Promise.all([
        listOpenSelectorFailures(limit),
        listSelectorFallbackAggregates(minSuccess, limit),
    ]);

    let promotedSelectors = 0;
    let resolvedGroups = 0;
    let baselineOpenFailures = 0;
    const promotedLabels = new Set<string>();
    const rollbackSnapshot: SelectorLearningRollbackSnapshotEntry[] = [];
    const openFailureLabels = new Set(openFailures.map((failure) => failure.action_label));

    const rollback: SelectorLearnerRollbackReport = {
        evaluatedRunId: null,
        evaluatedLabels: 0,
        baselineOpenFailures: 0,
        currentOpenFailures: 0,
        degraded: false,
        rolledBack: false,
        restoredSelectors: 0,
        deletedSelectors: 0,
        reason: null,
    };

    if (!dryRun && autoRollback) {
        const latestPromotedRun = await getLatestPromotedSelectorLearningRun();
        if (latestPromotedRun) {
            const promotedLabelsFromRun = parsePromotedLabels(latestPromotedRun.summary_json);
            rollback.evaluatedRunId = latestPromotedRun.id;
            rollback.evaluatedLabels = promotedLabelsFromRun.length;
            rollback.baselineOpenFailures = Math.max(0, latestPromotedRun.baseline_open_failures);
            if (promotedLabelsFromRun.length > 0) {
                rollback.currentOpenFailures = await countOpenSelectorFailuresByActionLabels(
                    promotedLabelsFromRun,
                    lookbackDays
                );
                const degradation = assessSelectorModelDegradation({
                    baselineOpenFailures: rollback.baselineOpenFailures,
                    currentOpenFailures: rollback.currentOpenFailures,
                    degradeRatio: failureDegradeRatio,
                    degradeMinDelta: failureDegradeMinDelta,
                });
                rollback.degraded = degradation.degraded;
                rollback.reason = degradation.degraded
                    ? `open_failures_delta_${degradation.absoluteIncrease}_threshold_${degradation.requiredIncrease}`
                    : null;

                if (degradation.degraded) {
                    const snapshotEntries = parseRollbackSnapshot(latestPromotedRun.rollback_snapshot_json);
                    const restored = await restoreDynamicSelectorSnapshots(snapshotEntries);
                    rollback.rolledBack = (restored.restored + restored.deleted) > 0;
                    rollback.restoredSelectors = restored.restored;
                    rollback.deletedSelectors = restored.deleted;
                    await recordSelectorLearningRunEvaluation(latestPromotedRun.id, {
                        evaluationOpenFailures: rollback.currentOpenFailures,
                        degraded: true,
                        rollbackApplied: rollback.rolledBack,
                        rollbackReason: rollback.reason,
                    });
                } else {
                    await recordSelectorLearningRunEvaluation(latestPromotedRun.id, {
                        evaluationOpenFailures: rollback.currentOpenFailures,
                        degraded: false,
                        rollbackApplied: false,
                        rollbackReason: null,
                    });
                }
            }
        }
    }

    const stopPromotionBecauseRollback = rollback.rolledBack && skipPromotionOnRollback;

    if (!stopPromotionBecauseRollback) {
        for (const aggregate of fallbackAggregates) {
            const confidence = computePromotionConfidence(aggregate.success_count);
            const actionLabel = aggregate.action_label.trim();
            const selector = aggregate.selector.trim();
            if (!actionLabel || !selector) continue;

            if (!dryRun) {
                const previous = await getDynamicSelectorState(actionLabel, selector);
                rollbackSnapshot.push({
                    actionLabel,
                    selector,
                    existedBefore: !!previous,
                    previousConfidence: previous?.confidence ?? null,
                    previousSource: previous?.source ?? null,
                    previousActive: previous?.active ?? null,
                    previousSuccessCount: previous?.success_count ?? null,
                    previousLastValidatedAt: previous?.last_validated_at ?? null,
                });
                await upsertDynamicSelector(actionLabel, selector, confidence, sourceTag);
            }

            promotedSelectors += 1;
            promotedLabels.add(actionLabel);
        }
    }

    for (const label of promotedLabels) {
        const hasOpenForLabel = openFailureLabels.has(label);
        if (!hasOpenForLabel) continue;
        if (!dryRun) {
            await markSelectorFailuresResolved(label);
        }
        resolvedGroups += 1;
    }
    if (promotedLabels.size > 0) {
        baselineOpenFailures = dryRun
            ? 0
            : await countOpenSelectorFailuresByActionLabels(Array.from(promotedLabels), lookbackDays);
    }

    const status: SelectorLearnerReport['status'] = dryRun
        ? 'DRY_RUN'
        : (stopPromotionBecauseRollback ? 'ROLLBACK_ONLY' : (promotedSelectors > 0 ? 'PROMOTED' : 'NO_OP'));

    if (!dryRun && runId) {
        await completeSelectorLearningRun(runId, {
            status,
            scannedFailures: openFailures.length,
            promotedCount: promotedSelectors,
            promotedLabelsCount: promotedLabels.size,
            baselineOpenFailures,
            summary: {
                sourceTag,
                triggeredBy,
                lookbackDays,
                minSuccess,
                limit,
                failureDegradeRatio,
                failureDegradeMinDelta,
                promotedLabels: Array.from(promotedLabels),
                rollback,
            },
            rollbackSnapshot,
        });
    }

    const report: SelectorLearnerReport = {
        runId,
        status,
        sourceTag,
        lookbackDays,
        scannedFailures: openFailures.length,
        promotedSelectors,
        resolvedGroups,
        baselineOpenFailures,
        promotedLabels: Array.from(promotedLabels),
        rollback: rollback.evaluatedRunId !== null ? rollback : null,
        dryRun,
    };

    if (rollback.rolledBack) {
        await logWarn('selector_learner.rollback_applied', { ...report });
    }

    if (promotedSelectors > 0 && !stopPromotionBecauseRollback) {
        await logInfo('selector_learner.promoted', { ...report });
    } else if (!rollback.rolledBack) {
        await logWarn('selector_learner.no_promotions', { ...report });
    }

    return report;
}
