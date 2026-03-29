/**
 * risk/accountBehaviorModel.ts
 * ─────────────────────────────────────────────────────────────────
 * Modello di crescita comportamentale per account LinkedIn.
 *
 * Account nuovi che eseguono subito azioni di alto valore (inviti, messaggi)
 * vengono flaggati da LinkedIn. Questo modulo definisce una curva di crescita
 * progressiva a 4 fasi che limita inviti e messaggi in base all'età dell'account.
 *
 * Fase 1 (browse_only):      Solo browsing/feed, 0 inviti, 0 messaggi
 * Fase 2 (soft_outreach):    Pochi inviti, 0 messaggi
 * Fase 3 (moderate_growth):  Inviti moderati, primi messaggi
 * Fase 4 (full_budget):      Budget pieno — nessun limite dal modello
 *
 * Le soglie di ogni fase sono configurabili via env (GROWTH_*).
 * Il modello si compone con il warmup per-account e la session maturity.
 */

import { config } from '../config';

// ─── Types ───────────────────────────────────────────────────────────────────

export type GrowthPhaseLabel = 'browse_only' | 'soft_outreach' | 'moderate_growth' | 'full_budget';

export interface GrowthPhase {
    label: GrowthPhaseLabel;
    endDay: number; // exclusive upper bound (Infinity for last phase)
    inviteMaxPerDay: number; // 0 = no invites allowed, Infinity = no model limit
    messageMaxPerDay: number; // 0 = no messages allowed, Infinity = no model limit
}

export interface AccountGrowthBudget {
    phase: GrowthPhaseLabel;
    ageDays: number;
    inviteMaxPerDay: number;
    messageMaxPerDay: number;
    /** Multiplier 0-1 that represents overall growth progress */
    growthFactor: number;
    /** Days until next phase transition (0 if in full_budget) */
    daysToNextPhase: number;
}

// ─── Phase Resolution ────────────────────────────────────────────────────────

function buildGrowthPhases(): readonly GrowthPhase[] {
    return [
        {
            label: 'browse_only',
            endDay: config.growthBrowseOnlyDays,
            inviteMaxPerDay: 0,
            messageMaxPerDay: 0,
        },
        {
            label: 'soft_outreach',
            endDay: config.growthBrowseOnlyDays + config.growthSoftOutreachDays,
            inviteMaxPerDay: config.growthSoftOutreachInviteMax,
            messageMaxPerDay: 0,
        },
        {
            label: 'moderate_growth',
            endDay: config.growthBrowseOnlyDays + config.growthSoftOutreachDays + config.growthModerateGrowthDays,
            inviteMaxPerDay: config.growthModerateGrowthInviteMax,
            messageMaxPerDay: config.growthModerateGrowthMessageMax,
        },
        {
            label: 'full_budget',
            endDay: Infinity,
            inviteMaxPerDay: Infinity,
            messageMaxPerDay: Infinity,
        },
    ];
}

/**
 * Risolve la fase di crescita corrente per un account con la data età indicata.
 */
export function resolveGrowthPhase(ageDays: number): GrowthPhase {
    const phases = buildGrowthPhases();
    const safeAge = Math.max(0, ageDays);
    for (const phase of phases) {
        if (safeAge < phase.endDay) {
            return phase;
        }
    }
    // Fallback: full budget
    return phases[phases.length - 1];
}

/**
 * Calcola il budget di crescita per un account di una certa età.
 * Restituisce i limiti giornalieri per inviti e messaggi secondo il modello,
 * più un fattore di crescita globale (0-1) utilizzabile come moltiplicatore.
 */
export function getAccountGrowthBudget(ageDays: number): AccountGrowthBudget {
    if (!config.growthModelEnabled) {
        return {
            phase: 'full_budget',
            ageDays: Math.max(0, ageDays),
            inviteMaxPerDay: Infinity,
            messageMaxPerDay: Infinity,
            growthFactor: 1.0,
            daysToNextPhase: 0,
        };
    }

    const phase = resolveGrowthPhase(ageDays);
    const safeAge = Math.max(0, ageDays);

    // Calcola growthFactor: progressione lineare dalla fase corrente alla successiva
    const phases = buildGrowthPhases();
    const phaseIndex = phases.findIndex((p) => p.label === phase.label);
    const totalGrowthDays = phases[phases.length - 2].endDay; // end of moderate_growth
    const growthFactor = totalGrowthDays > 0 ? Math.min(1.0, safeAge / totalGrowthDays) : 1.0;

    const daysToNextPhase = phase.endDay === Infinity ? 0 : Math.max(0, Math.ceil(phase.endDay - safeAge));

    // Intra-phase ramp: within soft_outreach and moderate_growth, ramp up gradually
    let inviteMax = phase.inviteMaxPerDay;
    let messageMax = phase.messageMaxPerDay;

    if (phase.label === 'soft_outreach' && phase.inviteMaxPerDay > 0) {
        const phaseStart = phaseIndex > 0 ? phases[phaseIndex - 1].endDay : 0;
        const phaseDuration = phase.endDay - phaseStart;
        const phaseProgress = phaseDuration > 0 ? (safeAge - phaseStart) / phaseDuration : 1;
        // Ramp from 40% to 100% of phase max
        const rampFactor = 0.4 + 0.6 * phaseProgress;
        inviteMax = Math.max(1, Math.round(phase.inviteMaxPerDay * rampFactor));
    }

    if (phase.label === 'moderate_growth') {
        const phaseStart = phaseIndex > 0 ? phases[phaseIndex - 1].endDay : 0;
        const phaseDuration = phase.endDay - phaseStart;
        const phaseProgress = phaseDuration > 0 ? (safeAge - phaseStart) / phaseDuration : 1;
        // Ramp from 50% to 100% of phase max
        const rampFactor = 0.5 + 0.5 * phaseProgress;
        inviteMax = Math.max(1, Math.round(phase.inviteMaxPerDay * rampFactor));
        if (phase.messageMaxPerDay > 0) {
            messageMax = Math.max(1, Math.round(phase.messageMaxPerDay * rampFactor));
        }
    }

    return {
        phase: phase.label,
        ageDays: safeAge,
        inviteMaxPerDay: inviteMax,
        messageMaxPerDay: messageMax,
        growthFactor: Math.round(growthFactor * 1000) / 1000,
        daysToNextPhase,
    };
}

// ─── AB-3: Trust Score Composito ─────────────────────────────────────────────

export interface AccountTrustInputs {
    ssiScore: number;
    ageDays: number;
    acceptanceRatePct: number;
    challengesLast7d: number;
    pendingRatio: number;
}

export interface AccountTrustResult {
    score: number;
    budgetMultiplier: number;
    factors: Record<string, number>;
}

/**
 * AB-3: Calcola un trust score composito [0, 100] che rappresenta quanto
 * LinkedIn "si fida" di questo account. Combina 5 segnali con pesi diversi.
 *
 * Il budgetMultiplier (0.3-1.0) viene usato dallo scheduler per modulare
 * il budget: account con basso trust → budget ridotto → meno rischio ban.
 *
 * Pesi:
 *   SSI score (30%): LinkedIn premia chi usa la piattaforma "bene"
 *   Account age (25%): account vecchi hanno più credito
 *   Acceptance rate (25%): alto acceptance = inviti rilevanti
 *   Challenge history (10%): challenge recenti = account sotto osservazione
 *   Pending ratio (10%): pending alto = targeting scarso
 */
export function calculateAccountTrustScore(inputs: AccountTrustInputs): AccountTrustResult {
    const ssiNorm = Math.min(100, Math.max(0, inputs.ssiScore));
    const ageNorm = Math.min(100, Math.max(0, inputs.ageDays) / 3.65);
    const acceptanceNorm = Math.min(100, Math.max(0, inputs.acceptanceRatePct));
    const challengeNorm = Math.max(0, 100 - inputs.challengesLast7d * 25);
    const pendingNorm = Math.max(0, 100 - inputs.pendingRatio * 150);

    const factors = {
        ssi: Math.round(ssiNorm * 100) / 100,
        age: Math.round(ageNorm * 100) / 100,
        acceptance: Math.round(acceptanceNorm * 100) / 100,
        challengeHistory: Math.round(challengeNorm * 100) / 100,
        pendingRatio: Math.round(pendingNorm * 100) / 100,
    };

    const score = Math.round(
        ssiNorm * 0.3 + ageNorm * 0.25 + acceptanceNorm * 0.25 + challengeNorm * 0.1 + pendingNorm * 0.1,
    );

    const clampedScore = Math.min(100, Math.max(0, score));

    // A11: Trust-based acceleration — account maturi con trust > 75 possono superare 1.0.
    // Score 0-50: multiplier 0.3-0.8 (riduzione). Score 50-75: 0.8-1.0 (neutro).
    // Score 75-100: 1.0-1.3 (accelerazione). Max +30% per account affidabili.
    // Prerequisiti acceleration: challengesLast7d === 0 AND pendingRatio < 0.50 AND acceptanceRatePct > 25.
    let budgetMultiplier: number;
    if (
        clampedScore >= 75 &&
        inputs.challengesLast7d === 0 &&
        inputs.pendingRatio < 0.5 &&
        inputs.acceptanceRatePct > 25
    ) {
        // Accelerazione: 1.0 + (score - 75) / 25 * 0.30 → da 1.0 a 1.30
        budgetMultiplier = 1.0 + ((clampedScore - 75) / 25) * 0.3;
    } else {
        // Comportamento precedente: 0.3 → 1.0
        budgetMultiplier = Math.max(0.3, Math.min(1.0, 0.3 + (clampedScore / 100) * 0.7));
    }

    return {
        score: clampedScore,
        budgetMultiplier: Math.round(budgetMultiplier * 100) / 100,
        factors,
    };
}

/**
 * Applica il modello di crescita ai budget calcolati dal scheduler.
 * Ritorna i budget eventualmente ridotti (mai aumentati).
 */
export function applyGrowthModel(
    inviteBudget: number,
    messageBudget: number,
    ageDays: number,
): { inviteBudget: number; messageBudget: number; growth: AccountGrowthBudget } {
    const growth = getAccountGrowthBudget(ageDays);

    return {
        inviteBudget: Number.isFinite(growth.inviteMaxPerDay)
            ? Math.min(inviteBudget, growth.inviteMaxPerDay)
            : inviteBudget,
        messageBudget: Number.isFinite(growth.messageMaxPerDay)
            ? Math.min(messageBudget, growth.messageMaxPerDay)
            : messageBudget,
        growth,
    };
}
