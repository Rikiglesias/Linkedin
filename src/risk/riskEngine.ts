import { config } from '../config';
import { RiskInputs, RiskSnapshot } from '../types/domain';

function clampScore(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
}

export function evaluateRisk(inputs: RiskInputs): RiskSnapshot {
    const score = clampScore(
        inputs.errorRate * 40 +
        inputs.selectorFailureRate * 20 +
        inputs.pendingRatio * 25 +
        Math.min(30, inputs.challengeCount * 20) +
        inputs.inviteVelocityRatio * 15
    );

    let action: RiskSnapshot['action'] = 'NORMAL';
    if (score >= config.riskStopThreshold || inputs.pendingRatio >= config.pendingRatioStop || inputs.challengeCount > 0) {
        action = 'STOP';
    } else if (
        config.lowActivityEnabled &&
        (
            score >= config.lowActivityRiskThreshold ||
            inputs.pendingRatio >= config.lowActivityPendingThreshold
        )
    ) {
        action = 'LOW_ACTIVITY';
    } else if (score >= config.riskWarnThreshold || inputs.pendingRatio >= config.pendingRatioWarn) {
        action = 'WARN';
    }

    return {
        score,
        pendingRatio: inputs.pendingRatio,
        errorRate: inputs.errorRate,
        selectorFailureRate: inputs.selectorFailureRate,
        challengeCount: inputs.challengeCount,
        inviteVelocityRatio: inputs.inviteVelocityRatio,
        action,
    };
}

export function calculateAccountWarmupMultiplier(ageDays: number, maxDays: number): number {
    if (ageDays >= maxDays) return 1.0;
    // Linear progression from 10% to 100% over maxDays
    const baseline = 0.1;
    const progress = ageDays / maxDays;
    return Math.min(1.0, baseline + (1 - baseline) * progress);
}

export function calculateDynamicBudget(
    softCap: number,
    hardCap: number,
    alreadyConsumed: number,
    riskAction: RiskSnapshot['action']
): number {
    if (alreadyConsumed >= hardCap) {
        return 0;
    }

    let effectiveCap = softCap;

    // We apply warmup from the caller (scheduler) now.

    // Risk policy
    if (riskAction === 'WARN') {
        effectiveCap = Math.floor(effectiveCap * 0.5);
    }
    if (riskAction === 'LOW_ACTIVITY') {
        effectiveCap = Math.max(
            config.lowActivityMinBudget,
            Math.floor(effectiveCap * config.lowActivityBudgetFactor)
        );
    }
    if (riskAction === 'STOP') {
        effectiveCap = 0;
    }

    effectiveCap = Math.min(hardCap, Math.max(0, effectiveCap));
    return Math.max(0, effectiveCap - alreadyConsumed);
}

export interface CooldownDecision {
    activate: boolean;
    tier: 'none' | 'warn' | 'high';
    minutes: number;
    reason: string | null;
}

export function evaluateCooldownDecision(snapshot: RiskSnapshot): CooldownDecision {
    if (!config.cooldownEnabled) {
        return { activate: false, tier: 'none', minutes: 0, reason: null };
    }

    if (snapshot.action !== 'WARN' && snapshot.action !== 'LOW_ACTIVITY') {
        return { activate: false, tier: 'none', minutes: 0, reason: null };
    }

    const high = snapshot.score >= config.cooldownHighScore || snapshot.pendingRatio >= config.cooldownPendingHighThreshold;
    if (high) {
        return {
            activate: true,
            tier: 'high',
            minutes: config.cooldownHighMinutes,
            reason: 'risk_cooldown_high',
        };
    }

    const warn = snapshot.score >= config.cooldownWarnScore || snapshot.pendingRatio >= config.cooldownPendingThreshold;
    if (warn) {
        return {
            activate: true,
            tier: 'warn',
            minutes: config.cooldownWarnMinutes,
            reason: 'risk_cooldown_warn',
        };
    }

    return { activate: false, tier: 'none', minutes: 0, reason: null };
}

export interface PredictiveRiskMetricSample {
    errorRate: number;
    selectorFailureRate: number;
    challengeCount: number;
    inviteVelocityRatio: number;
}

export interface PredictiveRiskAlert {
    metric: keyof PredictiveRiskMetricSample;
    current: number;
    mean: number;
    stdDev: number;
    sigma: number;
    zScore: number;
}

function getMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getStdDev(values: number[], mean: number): number {
    if (values.length < 2) return 0;
    const variance = values
        .map((value) => (value - mean) ** 2)
        .reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(variance);
}

export function evaluatePredictiveRiskAlerts(
    current: PredictiveRiskMetricSample,
    history: PredictiveRiskMetricSample[],
    sigma: number = config.riskPredictiveSigma
): PredictiveRiskAlert[] {
    if (history.length < 3) {
        return [];
    }

    const metrics: Array<keyof PredictiveRiskMetricSample> = [
        'errorRate',
        'selectorFailureRate',
        'challengeCount',
        'inviteVelocityRatio',
    ];

    const alerts: PredictiveRiskAlert[] = [];

    for (const metric of metrics) {
        const historicalValues = history
            .map((sample) => sample[metric])
            .filter((value) => Number.isFinite(value));
        if (historicalValues.length < 3) continue;

        const mean = getMean(historicalValues);
        const stdDev = getStdDev(historicalValues, mean);
        if (stdDev <= 0) continue;

        const currentValue = current[metric];
        const zScore = (currentValue - mean) / stdDev;
        if (zScore >= sigma) {
            alerts.push({
                metric,
                current: currentValue,
                mean,
                stdDev,
                sigma,
                zScore,
            });
        }
    }

    return alerts.sort((a, b) => b.zScore - a.zScore);
}
