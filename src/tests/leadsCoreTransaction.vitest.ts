import { describe, test, expect, vi, beforeEach } from 'vitest';

// T3: le scritture multiple di applyControlPlaneCampaignConfigs / upsertSalesNavigatorLead devono
// essere atomiche (withTransaction). Verifichiamo che (a) le scritture avvengano DENTRO una
// transazione e (b) un errore a meta' propaghi (cosi' il rollback reale di withTransaction scatta).
// Mock-based: il rollback SQL vero e' coperto da PostgresManager.withTransaction (db.ts).

const mocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));
vi.mock('../db', () => ({ getDatabase: mocks.getDatabase }));

import { applyControlPlaneCampaignConfigs } from '../core/repositories/leadsCore';

function makeDb(overrides: Record<string, unknown> = {}) {
    return {
        // shared.withTransaction(db, cb) chiama db.withTransaction(() => cb())
        withTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
        get: vi.fn().mockResolvedValue(undefined),
        run: vi.fn().mockResolvedValue({ changes: 1, lastID: 1 }),
        ...overrides,
    };
}

const cfg = [{ name: 'Lista A', isActive: true, priority: 1, dailyInviteCap: null, dailyMessageCap: null }];

describe('leadsCore atomicità transazionale (T3)', () => {
    beforeEach(() => vi.clearAllMocks());

    test('applyControlPlaneCampaignConfigs esegue le scritture dentro withTransaction', async () => {
        const db = makeDb();
        mocks.getDatabase.mockResolvedValue(db);

        const result = await applyControlPlaneCampaignConfigs(cfg);

        expect(db.withTransaction).toHaveBeenCalledTimes(1);
        expect(db.run).toHaveBeenCalled(); // INSERT del nuovo lead_list
        expect(result.created).toBe(1);
    });

    test('errore a meta transazione propaga (rollback reale scatterebbe), non swallowed', async () => {
        const db = makeDb({ run: vi.fn().mockRejectedValue(new Error('boom')) });
        mocks.getDatabase.mockResolvedValue(db);

        await expect(applyControlPlaneCampaignConfigs(cfg)).rejects.toThrow('boom');
        // la scrittura fallita era comunque avvenuta dentro la transazione
        expect(db.withTransaction).toHaveBeenCalledTimes(1);
    });
});
