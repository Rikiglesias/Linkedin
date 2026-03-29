import { config } from '../config';
import { RiskInputs, RiskSnapshot } from '../types/domain';

function clampScore(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
}

function clampRatio(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, value);
}

function clampPercentage(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
}

export function evaluateRisk(inputs: RiskInputs): RiskSnapshot {
    const errorRate = clampRatio(inputs.errorRate);
    const selectorFailureRate = clampRatio(inputs.selectorFailureRate);
    const pendingRatio = clampRatio(inputs.pendingRatio);
    const inviteVelocityRatio = clampRatio(inputs.inviteVelocityRatio);
    const challengeCount = Math.max(0, Math.floor(Number.isFinite(inputs.challengeCount) ? inputs.challengeCount : 0));

    const score = clampScore(
        errorRate * 40 +
            selectorFailureRate * 20 +
            pendingRatio * 25 +
            Math.min(30, challengeCount * 10) +
            inviteVelocityRatio * 15,
    );

    let action: RiskSnapshot['action'] = 'NORMAL';
    if (
        score >= config.riskStopThreshold ||
        inputs.pendingRatio >= config.pendingRatioStop ||
        inputs.challengeCount > 0
    ) {
        action = 'STOP';
    } else if (
        config.lowActivityEnabled &&
        (score >= config.lowActivityRiskThreshold || inputs.pendingRatio >= config.lowActivityPendingThreshold)
    ) {
        action = 'LOW_ACTIVITY';
    } else if (score >= config.riskWarnThreshold || inputs.pendingRatio >= config.pendingRatioWarn) {
        action = 'WARN';
    }

    return {
        score,
        pendingRatio,
        errorRate,
        selectorFailureRate,
        challengeCount,
        inviteVelocityRatio,
        action,
    };
}

export interface RiskExplanation {
    score: number;
    action: RiskSnapshot['action'];
    factors: Array<{
        name: string;
        rawValue: number;
        weight: number;
        contribution: number;
        threshold: string;
    }>;
    triggers: string[];
    thresholds: {
        riskWarn: number;
        riskStop: number;
        pendingRatioWarn: number;
        pendingRatioStop: number;
    };
}

export function explainRisk(inputs: RiskInputs): RiskExplanation {
    const snapshot = evaluateRisk(inputs);
    const errorContrib = clampRatio(inputs.errorRate) * 40;
    const selectorContrib = clampRatio(inputs.selectorFailureRate) * 20;
    const pendingContrib = clampRatio(inputs.pendingRatio) * 25;
    const challengeContrib = Math.min(30, Math.max(0, Math.floor(inputs.challengeCount ?? 0)) * 10);
    const velocityContrib = clampRatio(inputs.inviteVelocityRatio) * 15;

    const factors = [
        {
            name: 'errorRate',
            rawValue: inputs.errorRate,
            weight: 40,
            contribution: Math.round(errorContrib * 100) / 100,
            threshold: `score += errorRate × 40`,
        },
        {
            name: 'selectorFailureRate',
            rawValue: inputs.selectorFailureRate,
            weight: 20,
            contribution: Math.round(selectorContrib * 100) / 100,
            threshold: `score += selectorFailureRate × 20`,
        },
        {
            name: 'pendingRatio',
            rawValue: inputs.pendingRatio,
            weight: 25,
            contribution: Math.round(pendingContrib * 100) / 100,
            threshold: `WARN ≥ ${config.pendingRatioWarn}, STOP ≥ ${config.pendingRatioStop}`,
        },
        {
            name: 'challengeCount',
            rawValue: inputs.challengeCount,
            weight: 10,
            contribution: Math.round(challengeContrib * 100) / 100,
            threshold: `any challenge > 0 → STOP`,
        },
        {
            name: 'inviteVelocityRatio',
            rawValue: inputs.inviteVelocityRatio,
            weight: 15,
            contribution: Math.round(velocityContrib * 100) / 100,
            threshold: `score += velocity × 15`,
        },
    ];

    const triggers: string[] = [];
    if (inputs.challengeCount > 0) triggers.push(`challengeCount=${inputs.challengeCount} > 0 → STOP`);
    if (inputs.pendingRatio >= config.pendingRatioStop)
        triggers.push(
            `pendingRatio=${(inputs.pendingRatio * 100).toFixed(1)}% ≥ ${(config.pendingRatioStop * 100).toFixed(0)}% → STOP`,
        );
    if (snapshot.score >= config.riskStopThreshold)
        triggers.push(`score=${snapshot.score} ≥ ${config.riskStopThreshold} → STOP`);
    if (snapshot.action === 'WARN')
        triggers.push(
            `score=${snapshot.score} ≥ ${config.riskWarnThreshold} or pendingRatio ≥ ${(config.pendingRatioWarn * 100).toFixed(0)}% → WARN`,
        );

    return {
        score: snapshot.score,
        action: snapshot.action,
        factors,
        triggers,
        thresholds: {
            riskWarn: config.riskWarnThreshold,
            riskStop: config.riskStopThreshold,
            pendingRatioWarn: config.pendingRatioWarn,
            pendingRatioStop: config.pendingRatioStop,
        },
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
    riskAction: RiskSnapshot['action'],
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
        effectiveCap = Math.max(config.lowActivityMinBudget, Math.floor(effectiveCap * config.lowActivityBudgetFactor));
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

    const high =
        snapshot.score >= config.cooldownHighScore || snapshot.pendingRatio >= config.cooldownPendingHighThreshold;
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

export function calculateDynamicWeeklyInviteLimit(
    accountAgeDays: number,
    minWeeklyLimit: number,
    maxWeeklyLimit: number,
    warmupMaxAgeDays: number,
): number {
    const minLimit = Math.max(1, Math.floor(Math.min(minWeeklyLimit, maxWeeklyLimit)));
    const maxLimit = Math.max(1, Math.floor(Math.max(minWeeklyLimit, maxWeeklyLimit)));
    const maxAge = Math.max(1, Math.floor(warmupMaxAgeDays));
    const safeAge = Math.max(0, Math.floor(accountAgeDays));
    if (safeAge >= maxAge) {
        return maxLimit;
    }
    const progress = safeAge / maxAge;
    const computed = minLimit + (maxLimit - minLimit) * progress;
    return Math.max(minLimit, Math.min(maxLimit, Math.round(computed)));
}

export interface ComplianceHealthInputs {
    acceptanceRatePct: number;
    engagementRatePct: number;
    pendingRatio: number;
    invitesSentToday: number;
    messagesSentToday: number;
    weeklyInvitesSent: number;
    dailyInviteLimit: number;
    dailyMessageLimit: number;
    weeklyInviteLimit: number;
    pendingWarnThreshold: number;
}

export interface ComplianceHealthSnapshot {
    score: number;
    baseScore: number;
    acceptanceRatePct: number;
    engagementRatePct: number;
    pendingRatio: number;
    utilizationRatio: number;
    penalty: number;
}

export function evaluateComplianceHealthScore(inputs: ComplianceHealthInputs): ComplianceHealthSnapshot {
    const acceptanceRatePct = clampPercentage(inputs.acceptanceRatePct);
    const engagementRatePct = clampPercentage(inputs.engagementRatePct);
    const pendingRatio = clampRatio(inputs.pendingRatio);
    const baseScore = (acceptanceRatePct + engagementRatePct) / 2;

    const inviteUsage = clampRatio(inputs.invitesSentToday / Math.max(1, inputs.dailyInviteLimit));
    const messageUsage = clampRatio(inputs.messagesSentToday / Math.max(1, inputs.dailyMessageLimit));
    const weeklyUsage = clampRatio(inputs.weeklyInvitesSent / Math.max(1, inputs.weeklyInviteLimit));
    const utilizationRatio = (inviteUsage + messageUsage + weeklyUsage) / 3;

    const utilizationPenalty = utilizationRatio > 1 ? Math.min(30, (utilizationRatio - 1) * 50) : 0;
    const pendingThreshold = Math.max(0.01, inputs.pendingWarnThreshold);
    const pendingPenalty =
        pendingRatio > pendingThreshold ? Math.min(30, ((pendingRatio - pendingThreshold) / pendingThreshold) * 40) : 0;

    const penalty = utilizationPenalty + pendingPenalty;
    const score = clampScore(baseScore - penalty);

    return {
        score,
        baseScore: Number.parseFloat(baseScore.toFixed(2)),
        acceptanceRatePct: Number.parseFloat(acceptanceRatePct.toFixed(2)),
        engagementRatePct: Number.parseFloat(engagementRatePct.toFixed(2)),
        pendingRatio: Number.parseFloat(pendingRatio.toFixed(4)),
        utilizationRatio: Number.parseFloat(utilizationRatio.toFixed(4)),
        penalty: Number.parseFloat(penalty.toFixed(2)),
    };
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
    const variance = values.map((value) => (value - mean) ** 2).reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(variance);
}

export function evaluatePredictiveRiskAlerts(
    current: PredictiveRiskMetricSample,
    history: PredictiveRiskMetricSample[],
    sigma: number = config.riskPredictiveSigma,
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
        const historicalValues = history.map((sample) => sample[metric]).filter((value) => Number.isFinite(value));
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

// ─── Predictive Ban Probability Score (5.4) ──────────────────────────────────

export interface BanProbabilityResult {
    score: number; // 0-100
    level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    factors: Record<string, number>;
    recommendation: string;
}

/**
 * Stima la probabilità di ban 0-100 combinando 4 segnali predittivi:
 *   - Z-score anomalie (peso 30): alert attivi = account sotto osservazione
 *   - Trend acceptance (peso 25): acceptance in calo = targeting scadente
 *   - Frequenza challenge (peso 25): challenge recenti = account flaggato
 *   - Pending ratio (peso 20): pending alto = inviti non accettati = sospetto
 *
 * Score → Livello:
 *   0-20  → LOW (operazioni normali)
 *   21-45 → MEDIUM (monitoraggio attivo)
 *   46-70 → HIGH (ridurre budget, pausa consigliata)
 *   71+   → CRITICAL (stop immediato, rischio ban imminente)
 */
export function estimateBanProbability(
    alerts: PredictiveRiskAlert[],
    acceptanceRatePct: number,
    challengesLast7d: number,
    pendingRatio: number,
): BanProbabilityResult {
    // Factor 1: Z-score anomalie attive — peso 30
    const maxZScore = alerts.length > 0 ? Math.max(...alerts.map((a) => a.zScore)) : 0;
    const anomalyFactor = Math.min(30, Math.floor(Math.min(maxZScore, 5) * 6));

    // Factor 2: Trend acceptance — peso 25
    // acceptance >40% = 0 punti, <40% = crescente fino a 25
    const acceptanceFactor =
        acceptanceRatePct >= 40 ? 0 : Math.min(25, Math.floor((40 - Math.max(0, acceptanceRatePct)) * 0.625));

    // Factor 3: Frequenza challenge — peso 25
    // 0 challenge = 0, 1 = 12, 2 = 25 (cap)
    const challengeFactor = Math.min(25, challengesLast7d * 12.5);

    // Factor 4: Pending ratio — peso 20
    // <30% = 0, 30-65% = crescente, >65% = 20 (red flag LinkedIn)
    const pendingFactor = pendingRatio < 0.3 ? 0 : Math.min(20, Math.floor((pendingRatio - 0.3) * 57));

    const factors: Record<string, number> = {
        anomalyZScore: Math.round(anomalyFactor * 100) / 100,
        acceptanceTrend: Math.round(acceptanceFactor * 100) / 100,
        challengeFrequency: Math.round(challengeFactor * 100) / 100,
        pendingRatio: Math.round(pendingFactor * 100) / 100,
    };

    const score = Math.min(100, Math.round(anomalyFactor + acceptanceFactor + challengeFactor + pendingFactor));

    let level: BanProbabilityResult['level'];
    let recommendation: string;
    if (score <= 20) {
        level = 'LOW';
        recommendation = 'Rischio basso — operazioni normali';
    } else if (score <= 45) {
        level = 'MEDIUM';
        recommendation = 'Rischio medio — monitorare acceptance rate e pending ratio';
    } else if (score <= 70) {
        level = 'HIGH';
        recommendation = 'Rischio alto — ridurre budget del 50%, considerare pausa 24h';
    } else {
        level = 'CRITICAL';
        recommendation =
            'Rischio critico — STOP immediato. Verificare account, ritirare inviti pending, cambiare proxy';
    }

    return { score, level, factors, recommendation };
}
