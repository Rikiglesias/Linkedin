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
    endDay: number;           // exclusive upper bound (Infinity for last phase)
    inviteMaxPerDay: number;  // 0 = no invites allowed, Infinity = no model limit
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
    const growthFactor = totalGrowthDays > 0
        ? Math.min(1.0, safeAge / totalGrowthDays)
        : 1.0;

    const daysToNextPhase = phase.endDay === Infinity
        ? 0
        : Math.max(0, Math.ceil(phase.endDay - safeAge));

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
