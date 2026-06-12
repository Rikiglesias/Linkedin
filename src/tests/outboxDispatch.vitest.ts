import { describe, test, expect, vi, beforeEach } from 'vitest';

// D2: applyOutboxOperation deve ri-applicare l'operazione cloud per topic (upsert idempotenti).
// Follow-up D2: anche cloud.daily_stat, MA solo via incrementCloudDailyStatIdem con
// l'idempotency_key dell'evento (il claim+increment atomico è server-side nella RPC:
// src/sync/migrations/cloud_001_daily_stat_idempotent.sql); senza chiave → no-op legacy.
const mocks = vi.hoisted(() => ({
    upsertCloudLead: vi.fn().mockResolvedValue(undefined),
    updateCloudLeadStatus: vi.fn().mockResolvedValue(undefined),
    updateCloudAccountHealth: vi.fn().mockResolvedValue(undefined),
    incrementCloudDailyStat: vi.fn().mockResolvedValue(undefined),
    incrementCloudDailyStatIdem: vi.fn().mockResolvedValue(undefined),
    eraseCloudLead: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../cloud/supabaseDataClient', () => ({
    upsertCloudLead: mocks.upsertCloudLead,
    updateCloudLeadStatus: mocks.updateCloudLeadStatus,
    updateCloudAccountHealth: mocks.updateCloudAccountHealth,
    incrementCloudDailyStat: mocks.incrementCloudDailyStat,
    incrementCloudDailyStatIdem: mocks.incrementCloudDailyStatIdem,
    eraseCloudLead: mocks.eraseCloudLead,
}));

import { applyOutboxOperation } from '../sync/supabaseSyncWorker';

describe('D2 — applyOutboxOperation dispatch per topic', () => {
    beforeEach(() => vi.clearAllMocks());

    test('cloud.lead.upsert → upsertCloudLead', async () => {
        await applyOutboxOperation('cloud.lead.upsert', { lead: { linkedin_url: 'x' }, error: 'e' });
        expect(mocks.upsertCloudLead).toHaveBeenCalledWith({ linkedin_url: 'x' });
    });

    test('cloud.lead.erase → eraseCloudLead (goal gdpr-erasure-cloud)', async () => {
        await applyOutboxOperation('cloud.lead.erase', { linkedinUrl: 'https://l.in/x', urlHash: 'abc123' });
        expect(mocks.eraseCloudLead).toHaveBeenCalledWith('https://l.in/x', 'abc123');
    });

    test('cloud.lead.erase con payload malformato → THROW fail-loud (mai erasure persa in silenzio)', async () => {
        await expect(applyOutboxOperation('cloud.lead.erase', { linkedinUrl: 'https://l.in/x' })).rejects.toThrow(
            /payload non valido/,
        );
        await expect(applyOutboxOperation('cloud.lead.erase', { urlHash: 'abc' })).rejects.toThrow();
        expect(mocks.eraseCloudLead).not.toHaveBeenCalled();
    });

    test('cloud.lead.status → updateCloudLeadStatus', async () => {
        await applyOutboxOperation('cloud.lead.status', {
            linkedinUrl: 'x',
            status: 'INVITED',
            timestamps: { invited_at: 't' },
        });
        expect(mocks.updateCloudLeadStatus).toHaveBeenCalledWith('x', 'INVITED', { invited_at: 't' });
    });

    test('cloud.account.health → updateCloudAccountHealth', async () => {
        await applyOutboxOperation('cloud.account.health', {
            accountId: 'acc',
            health: 'RED',
            quarantineReason: 'r',
            quarantineUntil: 'u',
        });
        expect(mocks.updateCloudAccountHealth).toHaveBeenCalledWith('acc', 'RED', 'r', 'u');
    });

    test('cloud.daily_stat CON idempotencyKey → incrementCloudDailyStatIdem con la chiave evento', async () => {
        await applyOutboxOperation(
            'cloud.daily_stat',
            { localDate: '2026-06-10', accountId: 'acc', field: 'invites_sent', amount: 2 },
            'cloud.daily_stat:acc:2026-06-10:invites_sent:123',
        );
        expect(mocks.incrementCloudDailyStatIdem).toHaveBeenCalledWith({
            local_date: '2026-06-10',
            account_id: 'acc',
            field: 'invites_sent',
            amount: 2,
            idempotencyKey: 'cloud.daily_stat:acc:2026-06-10:invites_sent:123',
        });
        expect(mocks.incrementCloudDailyStat).not.toHaveBeenCalled(); // mai il path non-idempotente
    });

    test('cloud.daily_stat: re-apply dello stesso evento → STESSA idempotencyKey (dedup server-side)', async () => {
        const payload = { localDate: 'd', accountId: 'a', field: 'replies', amount: 1 };
        await applyOutboxOperation('cloud.daily_stat', payload, 'key-1');
        await applyOutboxOperation('cloud.daily_stat', payload, 'key-1'); // retry del drain
        expect(mocks.incrementCloudDailyStatIdem).toHaveBeenCalledTimes(2);
        const keys = mocks.incrementCloudDailyStatIdem.mock.calls.map((c) => c[0].idempotencyKey);
        expect(keys).toEqual(['key-1', 'key-1']); // la RPC claima la chiave: 2a chiamata = no-op server
    });

    test('cloud.daily_stat SENZA idempotencyKey → no-op (mai increment non-idempotente)', async () => {
        await applyOutboxOperation('cloud.daily_stat', {
            localDate: 'd',
            accountId: 'a',
            field: 'invites_sent',
            amount: 1,
        });
        expect(mocks.incrementCloudDailyStatIdem).not.toHaveBeenCalled();
        expect(mocks.incrementCloudDailyStat).not.toHaveBeenCalled();
    });

    test('cloud.daily_stat con field fuori whitelist o payload invalido → no-op', async () => {
        await applyOutboxOperation('cloud.daily_stat', { localDate: 'd', accountId: 'a', field: 'evil_col' }, 'k');
        await applyOutboxOperation('cloud.daily_stat', { accountId: 'a', field: 'replies' }, 'k'); // manca localDate
        expect(mocks.incrementCloudDailyStatIdem).not.toHaveBeenCalled();
    });

    test('cloud.daily_stat: errore RPC PROPAGATO (l\'evento resta in outbox e si ritenta)', async () => {
        mocks.incrementCloudDailyStatIdem.mockRejectedValueOnce(new Error('rpc missing'));
        await expect(
            applyOutboxOperation('cloud.daily_stat', { localDate: 'd', accountId: 'a', field: 'replies' }, 'k'),
        ).rejects.toThrow('rpc missing');
    });

    test('topic telemetria (risk.*) → no-op (solo cp_events)', async () => {
        await applyOutboxOperation('risk.ban_probability', { score: 50 });
        expect(mocks.upsertCloudLead).not.toHaveBeenCalled();
        expect(mocks.updateCloudLeadStatus).not.toHaveBeenCalled();
        expect(mocks.updateCloudAccountHealth).not.toHaveBeenCalled();
    });

    test('payload invalido → no-op, nessun throw', async () => {
        await expect(applyOutboxOperation('cloud.lead.upsert', null)).resolves.toBeUndefined();
        await applyOutboxOperation('cloud.lead.status', { status: 'X' }); // manca linkedinUrl
        await applyOutboxOperation('cloud.account.health', { accountId: 'a', health: 'PURPLE' }); // health invalida
        expect(mocks.upsertCloudLead).not.toHaveBeenCalled();
        expect(mocks.updateCloudLeadStatus).not.toHaveBeenCalled();
        expect(mocks.updateCloudAccountHealth).not.toHaveBeenCalled();
    });
});
