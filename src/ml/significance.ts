export interface TwoProportionResult {
    pValue: number | null;
    significant: boolean;
}

function erf(x: number): number {
    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const t = 1 / (1 + p * absX);
    const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
    return sign * y;
}

function normalCdf(x: number): number {
    return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function computeTwoProportionSignificance(
    baselineSuccess: number,
    baselineTotal: number,
    candidateSuccess: number,
    candidateTotal: number,
    alpha: number,
): TwoProportionResult {
    if (baselineTotal <= 0 || candidateTotal <= 0) {
        return { pValue: null, significant: false };
    }
    const pooled = (baselineSuccess + candidateSuccess) / (baselineTotal + candidateTotal);
    const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / baselineTotal + 1 / candidateTotal));
    if (!Number.isFinite(standardError) || standardError === 0) {
        return { pValue: null, significant: false };
    }
    const baselineRate = baselineSuccess / baselineTotal;
    const candidateRate = candidateSuccess / candidateTotal;
    const zScore = (candidateRate - baselineRate) / standardError;
    const pValue = 1 - normalCdf(zScore);
    return {
        pValue,
        significant: Number.isFinite(pValue) ? pValue < alpha : false,
    };
}
