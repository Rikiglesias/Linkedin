import type { RiskSnapshot } from '../types/domain';

export type RampChannel = 'invite' | 'message';

export interface RampModelInput {
    channel: RampChannel;
    currentCap: number;
    hardMaxCap: number;
    baseDailyIncrease: number;
    accountAgeDays: number;
    warmupDays: number;
    riskAction: RiskSnapshot['action'];
    riskScore: number;
    pendingRatio: number;
    errorRate: number;
    healthScore: number;
}

export interface RampModelOutput {
    currentCap: number;
    nextCap: number;
    targetCap: number;
    safetyTargetCap: number;
    curveProgress: number;
    safetyFactor: number;
    riskPenalty: number;
    pendingPenalty: number;
    errorPenalty: number;
    healthFactor: number;
    stepRate: number;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
}

function logisticProgress(ageDays: number, warmupDays: number, steepness: number): number {
    const safeWarmupDays = Math.max(1, Math.floor(warmupDays));
    const normalizedAge = clamp01(ageDays / safeWarmupDays);
    const z = steepness * (normalizedAge - 0.5);
    return 1 / (1 + Math.exp(-z));
}

function riskPenalty(action: RiskSnapshot['action']): number {
    if (action === 'STOP') return 0.2;
    if (action === 'LOW_ACTIVITY') return 0.55;
    if (action === 'WARN') return 0.75;
    return 1;
}

function healthFactor(score: number): number {
    const normalized = clamp((score - 40) / 50, 0, 1);
    return 0.55 + (normalized * 0.45);
}

function pendingPenalty(pendingRatio: number): number {
    const safePending = clamp01(pendingRatio);
    const excess = Math.max(0, safePending - 0.4);
    return clamp(1 - (excess * 1.2), 0.5, 1);
}

function errorPenalty(errorRate: number): number {
    const safeError = clamp01(errorRate);
    return clamp(1 - (safeError * 2), 0.6, 1);
}

function resolveCurveSteepness(channel: RampChannel): number {
    return channel === 'invite' ? 7.5 : 6.5;
}

function computeStepRate(baseDailyIncrease: number, curveProgress: number, safetyFactor: number): number {
    const base = clamp(baseDailyIncrease, 0.01, 0.5);
    const ageBoost = curveProgress * 0.2;
    const safeRate = (base + ageBoost) * clamp(safetyFactor, 0.4, 1);
    return clamp(safeRate, 0.03, 0.45);
}

function computeTargetCap(hardMaxCap: number, curveProgress: number): number {
    const safeMax = Math.max(1, Math.floor(hardMaxCap));
    const minCap = 1;
    const raw = minCap + ((safeMax - minCap) * curveProgress);
    return clamp(Math.round(raw), minCap, safeMax);
}

export function computeNonLinearRampCap(input: RampModelInput): RampModelOutput {
    const safeCurrentCap = Math.max(0, Math.floor(input.currentCap));
    const safeHardMax = Math.max(1, Math.floor(input.hardMaxCap));
    const curveProgress = logisticProgress(
        Math.max(0, input.accountAgeDays),
        Math.max(1, input.warmupDays),
        resolveCurveSteepness(input.channel)
    );
    const targetCap = computeTargetCap(safeHardMax, curveProgress);
    const riskPenaltyFactor = riskPenalty(input.riskAction);
    const pendingPenaltyFactor = pendingPenalty(input.pendingRatio);
    const errorPenaltyFactor = errorPenalty(input.errorRate);
    const healthFactorValue = healthFactor(input.healthScore);
    const safetyFactor = clamp(
        riskPenaltyFactor * pendingPenaltyFactor * errorPenaltyFactor * healthFactorValue,
        0.2,
        1
    );
    const safetyTargetCap = clamp(Math.floor(targetCap * safetyFactor), 1, safeHardMax);
    const stepRate = computeStepRate(input.baseDailyIncrease, curveProgress, safetyFactor);

    const gap = safetyTargetCap - safeCurrentCap;
    let nextCap = safeCurrentCap;

    if (gap > 0) {
        const upStep = Math.max(1, Math.ceil(gap * stepRate));
        nextCap = Math.min(safeHardMax, safeCurrentCap + upStep);
    } else if (gap < 0) {
        // Downscale faster than upscale when signals degrade.
        const downStep = Math.max(1, Math.ceil(Math.abs(gap) * Math.max(0.35, stepRate)));
        nextCap = Math.max(1, safeCurrentCap - downStep);
    }

    if (input.riskAction === 'STOP') {
        nextCap = Math.max(1, Math.min(nextCap, Math.floor(safeHardMax * 0.3)));
    }

    return {
        currentCap: safeCurrentCap,
        nextCap: clamp(nextCap, 1, safeHardMax),
        targetCap,
        safetyTargetCap,
        curveProgress: Number.parseFloat(curveProgress.toFixed(4)),
        safetyFactor: Number.parseFloat(safetyFactor.toFixed(4)),
        riskPenalty: Number.parseFloat(riskPenaltyFactor.toFixed(4)),
        pendingPenalty: Number.parseFloat(pendingPenaltyFactor.toFixed(4)),
        errorPenalty: Number.parseFloat(errorPenaltyFactor.toFixed(4)),
        healthFactor: Number.parseFloat(healthFactorValue.toFixed(4)),
        stepRate: Number.parseFloat(stepRate.toFixed(4)),
    };
}
