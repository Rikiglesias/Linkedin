/**
 * core/services/riskInputCalculator.ts
 * Business logic pura per il calcolo dei risk inputs.
 * Separata dal data access (repository) per testabilità.
 *
 * Pattern: il repository fa le query, il service calcola i ratio.
 * I test possono verificare i calcoli senza DB.
 */

import { RiskInputs } from '../../types/domain';

export interface RiskRawData {
    pendingInvites: number;
    invitedTotal: number;
    totalAttempts24h: number;
    failedAttempts24h: number;
    selectorFailuresToday: number;
    challengeCountToday: number;
    invitesSentToday: number;
    hardInviteCap: number;
}

/**
 * Calcola i risk inputs dai dati grezzi.
 * Funzione pura — nessun DB, nessun side-effect, testabile.
 */
export function calculateRiskInputs(raw: RiskRawData): RiskInputs {
    const pendingRatio = raw.invitedTotal > 0 ? raw.pendingInvites / raw.invitedTotal : 0;

    const errorRate = raw.totalAttempts24h > 0 ? raw.failedAttempts24h / raw.totalAttempts24h : 0;

    const denominator = Math.max(1, raw.totalAttempts24h);
    const selectorFailureRate = raw.selectorFailuresToday / denominator;

    const inviteVelocityRatio = raw.hardInviteCap > 0 ? raw.invitesSentToday / raw.hardInviteCap : 0;

    return {
        pendingRatio,
        errorRate,
        selectorFailureRate,
        challengeCount: raw.challengeCountToday,
        inviteVelocityRatio,
        // Campioni propagati per il gate (contratto bot-operativo C2/C6): prima venivano consumati e buttati.
        invitedTotal: raw.invitedTotal,
        attemptsTotal24h: raw.totalAttempts24h,
    };
}
