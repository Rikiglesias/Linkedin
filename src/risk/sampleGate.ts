/**
 * risk/sampleGate.ts — campione minimo per i rapporti del risk engine (contratto `bot-operativo` C1/C2/C6).
 *
 * Perché esiste: il bot non ha mai completato un invito perché il PRIMO produceva 1 pending / 1 invitato = ratio 1.0
 * ≥ `pendingRatioStop` → STOP → quarantena globale dell'account. Un rapporto ha senso solo sopra un campione minimo.
 *
 * UNICA funzione per tutti i siti che decidono su un pending ratio (riskEngine, scheduler per-lista, riskAssessor,
 * doctor, guardian, trust score, antiBanChecklist): nessun literal fuori da `config/domains.ts`.
 *
 * Rapporto con le chiavi esistenti: `complianceHealthMinInviteSample` e `compliancePendingRatioAlertMinInvited`
 * misurano `invitesSentLookback` (finestra di N giorni del punteggio di salute/alert). Qui il campione è il
 * denominatore ALL-TIME `invited_at IS NOT NULL` del risk engine: denominatori diversi → chiave distinta
 * (`pendingRatioMinInvited`), funzione unica.
 *
 * Fail-closed (C2): campione non finito/negativo, oppure coppia incoerente (campione 0 con rapporto > 0) → il rapporto
 * conta come SOPRA-campione. `0` è il valore sbagliato più probabile (è ciò che un fallback a zeri produrrebbe).
 */
import { config } from '../config';
import type { RiskInputs } from '../types/domain';

export type SampleGateReason =
    | 'sample_ok'
    | 'sample_below_min'
    | 'no_data'
    | 'invalid_sample_fail_closed'
    | 'inconsistent_sample_fail_closed';

export interface SampleGateResult {
    /** true = il rapporto conta (campione sufficiente O fail-closed). */
    sufficient: boolean;
    /** rapporto da usare nello score: 0 sotto campione, il rapporto (clampato a >= 0) altrimenti. */
    effectiveRatio: number;
    sampleSize: number;
    minSample: number;
    reason: SampleGateReason;
}

function isValidCount(value: number): boolean {
    return Number.isFinite(value) && value >= 0;
}

function clampRatio(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function evaluateSample(args: {
    sampleSize: number;
    ratioSignal: number;
    minSample: number;
    effectiveWhenSufficient: number;
}): SampleGateResult {
    const minSample = Math.max(1, args.minSample);
    if (!isValidCount(args.sampleSize)) {
        return {
            sufficient: true,
            effectiveRatio: args.effectiveWhenSufficient,
            sampleSize: args.sampleSize,
            minSample,
            reason: 'invalid_sample_fail_closed',
        };
    }
    if (args.sampleSize === 0) {
        if (args.ratioSignal > 0) {
            return {
                sufficient: true,
                effectiveRatio: args.effectiveWhenSufficient,
                sampleSize: 0,
                minSample,
                reason: 'inconsistent_sample_fail_closed',
            };
        }
        return { sufficient: false, effectiveRatio: 0, sampleSize: 0, minSample, reason: 'no_data' };
    }
    if (args.sampleSize < minSample) {
        return { sufficient: false, effectiveRatio: 0, sampleSize: args.sampleSize, minSample, reason: 'sample_below_min' };
    }
    return {
        sufficient: true,
        effectiveRatio: args.effectiveWhenSufficient,
        sampleSize: args.sampleSize,
        minSample,
        reason: 'sample_ok',
    };
}

/** Campione del pending ratio: invitati all-time (`invited_at IS NOT NULL`) vs `pendingRatioMinInvited`. */
export function pendingRatioSample(args: {
    pendingRatio: number;
    invitedTotal: number;
    minSample?: number;
}): SampleGateResult {
    return evaluateSample({
        sampleSize: args.invitedTotal,
        ratioSignal: clampRatio(args.pendingRatio),
        minSample: args.minSample ?? config.pendingRatioMinInvited,
        effectiveWhenSufficient: clampRatio(args.pendingRatio),
    });
}

/** Campione dei rapporti sui tentativi (errorRate, selectorFailureRate): tentativi 24h vs `riskMinAttemptsSample`. */
export function attemptsSample(args: {
    attemptsTotal24h: number;
    errorRate: number;
    selectorFailureRate: number;
    minSample?: number;
}): SampleGateResult {
    return evaluateSample({
        sampleSize: args.attemptsTotal24h,
        ratioSignal: Math.max(clampRatio(args.errorRate), clampRatio(args.selectorFailureRate)),
        minSample: args.minSample ?? config.riskMinAttemptsSample,
        effectiveWhenSufficient: clampRatio(args.errorRate),
    });
}

/** Un pending ratio è un rapporto pending/invitati: fuori da [0, 1] o non finito = dato corrotto → fail-closed. */
export function isPendingRatioValid(pendingRatio: number): boolean {
    return Number.isFinite(pendingRatio) && pendingRatio >= 0 && pendingRatio <= 1;
}

/**
 * Input da usare quando i risk inputs NON sono leggibili (DB irraggiungibile): rapporti NaN e campioni -1 rendono lo
 * snapshot STOP con trigger `invalid_risk_inputs`, invece di zeri che aprirebbero il gate (C2c).
 */
export const INVALID_RISK_INPUTS_FALLBACK: RiskInputs = {
    pendingRatio: Number.NaN,
    errorRate: Number.NaN,
    selectorFailureRate: Number.NaN,
    challengeCount: 0,
    inviteVelocityRatio: 0,
    invitedTotal: -1,
    attemptsTotal24h: -1,
};
