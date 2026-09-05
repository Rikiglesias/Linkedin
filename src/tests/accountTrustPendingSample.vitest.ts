/**
 * accountTrustPendingSample.vitest.ts — C5 ⑥ del contratto `bot-operativo`: il trust score (`risk/accountBehaviorModel.ts`,
 * moltiplicatore del budget) tratta il pending sotto campione come NEUTRO — nessuna penalità di trust/budget dal
 * primo invito — e `getAccountTrustInputs` (`core/repositories/stats.ts`) espone `invitedTotal` reale
 * (`invited_at IS NOT NULL`). Produttore che dimentica il campione → fail-closed = penalità odierna, mai un bypass.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { calculateAccountTrustScore } from '../risk/accountBehaviorModel';
import { getAccountTrustInputs } from '../core/repositories';
import { getDatabase } from '../db';

const N = 20;
const base = { ssiScore: 60, ageDays: 365, acceptanceRatePct: 30, challengesLast7d: 0 };

beforeAll(async () => {
    const { config } = await import('../config');
    config.pendingRatioMinInvited = N;
});

describe('C5 ⑥ — pending sotto campione = neutro', () => {
    it('1 pending / 1 invitato → stesso score e stesso budget di un account senza inviti', () => {
        const primoInvito = calculateAccountTrustScore({ ...base, pendingRatio: 1, invitedTotal: 1 });
        const senzaInviti = calculateAccountTrustScore({ ...base, pendingRatio: 0, invitedTotal: 0 });
        expect(primoInvito.score).toBe(senzaInviti.score);
        expect(primoInvito.budgetMultiplier).toBe(senzaInviti.budgetMultiplier);
        expect(primoInvito.factors.pendingRatio).toBe(100);
    });

    it('N-1 tutti pending → neutro; N tutti pending → penalità odierna (factor 0, score più basso)', () => {
        expect(calculateAccountTrustScore({ ...base, pendingRatio: 1, invitedTotal: N - 1 }).factors.pendingRatio).toBe(
            100,
        );
        const pieno = calculateAccountTrustScore({ ...base, pendingRatio: 1, invitedTotal: N });
        expect(pieno.factors.pendingRatio).toBe(0);
        expect(pieno.score).toBeLessThan(
            calculateAccountTrustScore({ ...base, pendingRatio: 0, invitedTotal: N }).score,
        );
    });

    it('sopra campione lo snapshot è quello odierno: ratio 0.4 su N+1 → factor 100 - 0.4 × 150 = 40', () => {
        const result = calculateAccountTrustScore({ ...base, pendingRatio: 0.4, invitedTotal: N + 1 });
        expect(result.factors.pendingRatio).toBe(40);
    });

    it('campione assente → fail-closed: penalità come oggi', () => {
        const result = calculateAccountTrustScore({ ...base, pendingRatio: 1 });
        expect(result.factors.pendingRatio).toBe(0);
    });

    it('sotto campione il pending non blocca l accelerazione: il prerequisito pendingRatio < 0.5 legge il valore gated', () => {
        const maturo = { ssiScore: 90, ageDays: 1000, acceptanceRatePct: 50, challengesLast7d: 0 };
        const primoInvito = calculateAccountTrustScore({ ...maturo, pendingRatio: 1, invitedTotal: 1 });
        const senzaInviti = calculateAccountTrustScore({ ...maturo, pendingRatio: 0, invitedTotal: 0 });
        expect(senzaInviti.budgetMultiplier).toBeGreaterThan(1);
        expect(primoInvito.budgetMultiplier).toBe(senzaInviti.budgetMultiplier);
    });
});

describe('C5 ⑥ — getAccountTrustInputs espone il campione reale', () => {
    const LIST = '__c5_trust_sample__';

    it('invitedTotal = COUNT(invited_at IS NOT NULL) del DB, ≥ 1 dopo un lead invitato', async () => {
        const db = await getDatabase();
        await db.run(`DELETE FROM leads WHERE list_name = ?`, [LIST]);
        try {
            await db.run(
                `INSERT INTO leads (linkedin_url, status, list_name, invited_at) VALUES (?, 'INVITED', ?, CURRENT_TIMESTAMP)`,
                [`https://www.linkedin.com/in/c5-trust-${Date.now()}`, LIST],
            );
            // Il DB di test è condiviso fra i worker: altri file inseriscono/cancellano lead con `invited_at` nello
            // stesso momento → il conteggio si confronta con la finestra [prima, dopo], non con un solo istante.
            const conta = async () =>
                Number(
                    (
                        await db.get<{ total: number }>(
                            `SELECT COUNT(*) as total FROM leads WHERE invited_at IS NOT NULL`,
                        )
                    )?.total ?? -1,
                );
            const prima = await conta();
            const inputs = await getAccountTrustInputs(50, 365);
            const dopo = await conta();
            expect(inputs.invitedTotal).toBeGreaterThanOrEqual(1);
            expect(inputs.invitedTotal).toBeGreaterThanOrEqual(Math.min(prima, dopo));
            expect(inputs.invitedTotal).toBeLessThanOrEqual(Math.max(prima, dopo));
        } finally {
            await db.run(`DELETE FROM leads WHERE list_name = ?`, [LIST]);
        }
    });
});
