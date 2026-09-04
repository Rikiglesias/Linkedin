/**
 * schedulerAdaptivePendingSample.vitest.ts — C4 del contratto `bot-operativo`: il ratio per-lista dello scheduler
 * (`evaluateAdaptiveBudgetContext`, `core/scheduler.ts`) usa come denominatore E campione il conteggio REALE
 * `COUNT(invited_at IS NOT NULL)` per lista — non la somma di status, che esclude i lead invitati poi
 * BLOCKED/DEAD/REVIEW_REQUIRED/SKIPPED — e decide col gate condiviso di C1 (`risk/sampleGate.ts`): sotto
 * `pendingRatioMinInvited` nessun `list_pending_*`, ma il ratio grezzo resta esposto per i consumer (guardian, C21).
 * Tabella di confine sul campione N: {0, 1, N-1, N} tutti pending.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { evaluateAdaptiveBudgetContext } from '../core/scheduler';
import { getLeadInvitedTotalsForLists } from '../core/repositories';
import { getDatabase } from '../db';

const N = 20;

beforeAll(async () => {
    const { config } = await import('../config');
    config.adaptiveCapsEnabled = true;
    config.adaptiveCapsPendingStop = 0.65;
    config.adaptiveCapsPendingWarn = 0.45;
    config.adaptiveCapsBlockedWarn = 0.15;
    config.adaptiveCapsMinFactor = 0.2;
    config.adaptiveCapsWarnFactor = 0.7;
    config.lowActivityBudgetFactor = 0.5;
    config.pendingRatioMinInvited = N;
});

describe('C4 — campione per-lista, tutti pending', () => {
    it('N-1 invitati tutti pending → factor 1, nessun reason pending, campione insufficiente, ratio grezzo esposto', () => {
        const ctx = evaluateAdaptiveBudgetContext({ INVITED: N - 1 }, 'NORMAL', { invitedTotal: N - 1 });
        expect(ctx.factor).toBe(1);
        expect(ctx.reasons.filter((reason) => reason.startsWith('list_pending'))).toHaveLength(0);
        expect(ctx.pendingSampleSufficient).toBe(false);
        expect(ctx.pendingInvitedTotal).toBe(N - 1);
        expect(ctx.pendingRatio).toBe(1);
    });

    it('N invitati tutti pending → list_pending_high, factor = adaptiveCapsMinFactor, campione sufficiente', () => {
        const ctx = evaluateAdaptiveBudgetContext({ INVITED: N }, 'NORMAL', { invitedTotal: N });
        expect(ctx.reasons).toContain('list_pending_high');
        expect(ctx.factor).toBe(0.2);
        expect(ctx.pendingSampleSufficient).toBe(true);
        expect(ctx.pendingInvitedTotal).toBe(N);
    });

    it('1 invitato tutto pending → factor 1 come N-1: il primo invito non tocca il budget della lista', () => {
        const ctx = evaluateAdaptiveBudgetContext({ INVITED: 1 }, 'NORMAL', { invitedTotal: 1 });
        expect(ctx.factor).toBe(1);
        expect(ctx.reasons).toHaveLength(0);
    });

    it('0 INVITED, 0 invitati → nessun dato: ratio 0, campione insufficiente, factor 1', () => {
        const ctx = evaluateAdaptiveBudgetContext({}, 'NORMAL', { invitedTotal: 0 });
        expect(ctx.factor).toBe(1);
        expect(ctx.pendingRatio).toBe(0);
        expect(ctx.pendingSampleSufficient).toBe(false);
    });
});

describe('C4 — denominatore = invitati reali, non somma di status', () => {
    it('1 INVITED + 1 invitato-poi-BLOCKED → denominatore 2 (ratio 0.5, non 1)', () => {
        const ctx = evaluateAdaptiveBudgetContext({ INVITED: 1, BLOCKED: 1 }, 'NORMAL', { invitedTotal: 2 });
        expect(ctx.pendingRatio).toBe(0.5);
        expect(ctx.pendingInvitedTotal).toBe(2);
    });

    it('sopra campione il comportamento è quello odierno: 80 INVITED su 90 invitati → list_pending_high', () => {
        const ctx = evaluateAdaptiveBudgetContext({ INVITED: 80, ACCEPTED: 10 }, 'NORMAL', { invitedTotal: 90 });
        expect(ctx.pendingRatio).toBeCloseTo(80 / 90, 4);
        expect(ctx.reasons).toContain('list_pending_high');
        expect(ctx.factor).toBeLessThanOrEqual(0.2);
    });

    it('sopra campione, ratio medio → list_pending_warn come oggi', () => {
        const ctx = evaluateAdaptiveBudgetContext({ INVITED: 55, ACCEPTED: 60 }, 'NORMAL', { invitedTotal: 115 });
        expect(ctx.reasons).toContain('list_pending_warn');
        expect(ctx.factor).toBeLessThanOrEqual(0.5);
    });
});

describe('C4 — fail-closed sul campione (C2 applicato per-lista)', () => {
    it('INVITED > 0 con invitedTotal 0 (coppia incoerente) → il ratio CONTA → list_pending_high', () => {
        const ctx = evaluateAdaptiveBudgetContext({ INVITED: 3 }, 'NORMAL', { invitedTotal: 0 });
        expect(ctx.pendingSampleSufficient).toBe(true);
        expect(ctx.reasons).toContain('list_pending_high');
    });

    it('invitedTotal NaN → fail-closed: conta come sopra-campione', () => {
        const ctx = evaluateAdaptiveBudgetContext({ INVITED: 3 }, 'NORMAL', { invitedTotal: Number.NaN });
        expect(ctx.pendingSampleSufficient).toBe(true);
        expect(ctx.reasons).toContain('list_pending_high');
    });
});

describe('C4/C21 — campione del blockedRatio esposto per il guardian', () => {
    it('1 SKIPPED su una lista senza inviti → blockedRatio 1 ma campione insufficiente', () => {
        const ctx = evaluateAdaptiveBudgetContext({ SKIPPED: 1 }, 'NORMAL', { invitedTotal: 0 });
        expect(ctx.blockedRatio).toBe(1);
        expect(ctx.blockedSampleSufficient).toBe(false);
    });

    it('10 INVITED + 10 BLOCKED → denominatore 20 = campione sufficiente', () => {
        const ctx = evaluateAdaptiveBudgetContext({ INVITED: 10, BLOCKED: 10 }, 'NORMAL', { invitedTotal: 20 });
        expect(ctx.blockedSampleSufficient).toBe(true);
        expect(ctx.reasons).toContain('list_blocked_warn');
    });
});

describe('C4 — query reale accanto a getLeadStatusCountsForLists', () => {
    const LIST = '__c4_pending_sample__';

    it('conta invited_at IS NOT NULL per lista: INVITED + BLOCKED-con-invited_at = 2, NEW escluso, lista vuota assente', async () => {
        const db = await getDatabase();
        const stamp = Date.now();
        await db.run(`DELETE FROM leads WHERE list_name = ?`, [LIST]);
        try {
            await db.run(
                `INSERT INTO leads (linkedin_url, status, list_name, invited_at) VALUES (?, 'INVITED', ?, CURRENT_TIMESTAMP)`,
                [`https://www.linkedin.com/in/c4-invited-${stamp}`, LIST],
            );
            await db.run(
                `INSERT INTO leads (linkedin_url, status, list_name, invited_at) VALUES (?, 'BLOCKED', ?, CURRENT_TIMESTAMP)`,
                [`https://www.linkedin.com/in/c4-blocked-${stamp}`, LIST],
            );
            await db.run(`INSERT INTO leads (linkedin_url, status, list_name) VALUES (?, 'NEW', ?)`, [
                `https://www.linkedin.com/in/c4-new-${stamp}`,
                LIST,
            ]);

            const rows = await getLeadInvitedTotalsForLists([LIST, '__c4_lista_vuota__']);
            const row = rows.find((candidate) => candidate.list_name === LIST);
            expect(row?.invited_total).toBe(2);
            expect(rows.find((candidate) => candidate.list_name === '__c4_lista_vuota__')).toBeUndefined();
            expect(await getLeadInvitedTotalsForLists([])).toEqual([]);
        } finally {
            await db.run(`DELETE FROM leads WHERE list_name = ?`, [LIST]);
        }
    });
});
