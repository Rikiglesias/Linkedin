/**
 * Helper per costruire uno snapshot session REALE per l'AI Decision Engine.
 * Sostituisce i 5 zeri hardcoded che venivano passati prima.
 */
import { config } from '../config';
import { getDailyStat, getRiskInputs } from '../core/repositories';
import { evaluateRisk } from '../risk/riskEngine';
import type { WorkerContext } from './context';

export interface RealSessionData {
    invitesSent: number;
    messagesSent: number;
    riskScore: number;
    pendingRatio: number;
    /** Durata sessione in secondi */
    duration: number;
    challengeCount: number;
}

/**
 * Raccoglie dati session reali da DB + risk engine.
 * 4 query parallele (~2-5ms su SQLite). Se una fallisce, usa 0 come default.
 */
export async function buildSessionSnapshot(context: WorkerContext): Promise<RealSessionData> {
    const [invitesSent, messagesSent, challengeCount, riskInputs] = await Promise.all([
        getDailyStat(context.localDate, 'invites_sent').catch(() => 0),
        getDailyStat(context.localDate, 'messages_sent').catch(() => 0),
        getDailyStat(context.localDate, 'challenges_count').catch(() => 0),
        getRiskInputs(context.localDate, config.hardInviteCap).catch(() => ({
            pendingRatio: 0,
            errorRate: 0,
            selectorFailureRate: 0,
            challengeCount: 0,
            inviteVelocityRatio: 0,
        })),
    ]);

    const riskSnapshot = evaluateRisk(riskInputs);

    const durationSec = context.sessionStartedAtMs ? Math.floor((Date.now() - context.sessionStartedAtMs) / 1000) : 0;

    return {
        invitesSent,
        messagesSent,
        riskScore: riskSnapshot.score,
        pendingRatio: riskInputs.pendingRatio,
        duration: durationSec,
        challengeCount,
    };
}
