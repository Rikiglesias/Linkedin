/**
 * riskInputsPostgresCounts.vitest.ts — review blocco 2 (2026-09-05): su Postgres (DB di produzione) COUNT(*)/SUM(int)
 * sono int8 e node-pg li consegna come STRINGHE. Il gate a campione (`risk/sampleGate`, `Number.isFinite`) le scartava
 * come invalide → fail-closed = il deadlock del primo invito restava intatto in produzione. Difesa primaria: parser INT8
 * in `src/db.ts`; difesa al bordo: `Number()` nei repository che alimentano il risk engine. Qui il DB è mockato per
 * restituire stringhe, come farebbe node-pg senza parser.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const mocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));

vi.mock('../db', () => ({ getDatabase: mocks.getDatabase }));

import {
    countLeadsByStatuses,
    getAccountTrustInputs,
    getLeadInvitedTotalsForLists,
    getLeadStatusCountsForLists,
    getRiskInputs,
} from '../core/repositories';
import { evaluateRisk } from '../risk/riskEngine';

/** Simula node-pg senza type parser: ogni conteggio/somma arriva come stringa. */
function postgresLikeDb() {
    return {
        get: vi.fn(async (sql: string) => {
            if (sql.includes('invited_at IS NOT NULL')) return { total: '1' };
            if (sql.includes('FROM leads WHERE status IN')) return { total: '1' };
            if (sql.includes('job_attempts') && sql.includes('success = 0')) return { total: '0' };
            if (sql.includes('job_attempts')) return { total: '3' };
            if (sql.includes('FROM daily_stats WHERE date = ?')) {
                return { selector_failures: '0', challenges_count: '0', invites_sent: '1' };
            }
            if (sql.includes('SUM(invites_sent)')) return { invites: '1', acceptances: '0' };
            if (sql.includes('SUM(challenges_count)')) return { total: '0' };
            return { total: '0' };
        }),
        query: vi.fn(async (sql: string) => {
            if (sql.includes('invited_at IS NOT NULL')) return [{ list_name: 'lista', invited_total: '2' }];
            return [{ list_name: 'lista', status: 'INVITED', total: '2' }];
        }),
    };
}

beforeAll(async () => {
    const { config } = await import('../config');
    config.pendingRatioMinInvited = 20;
    config.riskMinAttemptsSample = 5;
    config.pendingRatioWarn = 0.55;
    config.pendingRatioStop = 0.65;
    config.riskWarnThreshold = 30;
    config.riskStopThreshold = 60;
    config.lowActivityEnabled = false;
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDatabase.mockResolvedValue(postgresLikeDb());
});

describe('conteggi come stringhe (Postgres senza parser) → number al bordo del repository', () => {
    test('getRiskInputs: campioni e rapporti sono number, e 1 pending su 1 invitato resta NORMAL', async () => {
        const inputs = await getRiskInputs('2026-09-05', 10);

        expect(typeof inputs.invitedTotal).toBe('number');
        expect(inputs.invitedTotal).toBe(1);
        expect(inputs.attemptsTotal24h).toBe(3);
        expect(inputs.pendingRatio).toBe(1);
        expect(inputs.errorRate).toBe(0);
        expect(inputs.challengeCount).toBe(0);
        expect(inputs.inviteVelocityRatio).toBeCloseTo(0.1, 6);
        expect(evaluateRisk(inputs).action).toBe('NORMAL');
    });

    test('countLeadsByStatuses restituisce un number', async () => {
        expect(await countLeadsByStatuses(['INVITED'])).toBe(1);
    });

    test('getLeadInvitedTotalsForLists e getLeadStatusCountsForLists restituiscono totali number', async () => {
        const invited = await getLeadInvitedTotalsForLists(['lista']);
        expect(invited).toEqual([{ list_name: 'lista', invited_total: 2 }]);
        expect(typeof invited[0]?.invited_total).toBe('number');

        const statuses = await getLeadStatusCountsForLists(['lista']);
        expect(statuses[0]?.total).toBe(2);
        expect(typeof statuses[0]?.total).toBe('number');
    });

    test('getAccountTrustInputs: campione e contatori sono number', async () => {
        const inputs = await getAccountTrustInputs(50, 365);
        expect(inputs.invitedTotal).toBe(1);
        expect(typeof inputs.invitedTotal).toBe('number');
        expect(inputs.challengesLast7d).toBe(0);
        expect(inputs.acceptanceRatePct).toBe(0);
        expect(inputs.pendingRatio).toBe(1);
    });
});

describe('difesa primaria: parser INT8 nel pool Postgres', () => {
    test('src/db.ts registra il type parser per int8 (sentinella di presenza)', () => {
        const source = readFileSync(path.resolve(__dirname, '..', 'db.ts'), 'utf8');
        expect(source).toContain('setTypeParser(pgTypes.builtins.INT8');
    });
});
