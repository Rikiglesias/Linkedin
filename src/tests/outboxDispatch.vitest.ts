import { describe, test, expect, vi, beforeEach } from 'vitest';

// D2: applyOutboxOperation deve ri-applicare l'operazione cloud per topic (upsert idempotenti),
// ed ESCLUDERE cloud.daily_stat (increment non idempotente → doppio-conteggio al retry).
const mocks = vi.hoisted(() => ({
    upsertCloudLead: vi.fn().mockResolvedValue(undefined),
    updateCloudLeadStatus: vi.fn().mockResolvedValue(undefined),
    updateCloudAccountHealth: vi.fn().mockResolvedValue(undefined),
    incrementCloudDailyStat: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../cloud/supabaseDataClient', () => ({
    upsertCloudLead: mocks.upsertCloudLead,
    updateCloudLeadStatus: mocks.updateCloudLeadStatus,
    updateCloudAccountHealth: mocks.updateCloudAccountHealth,
    incrementCloudDailyStat: mocks.incrementCloudDailyStat,
}));

import { applyOutboxOperation } from '../sync/supabaseSyncWorker';

describe('D2 — applyOutboxOperation dispatch per topic', () => {
    beforeEach(() => vi.clearAllMocks());

    test('cloud.lead.upsert → upsertCloudLead', async () => {
        await applyOutboxOperation('cloud.lead.upsert', { lead: { linkedin_url: 'x' }, error: 'e' });
        expect(mocks.upsertCloudLead).toHaveBeenCalledWith({ linkedin_url: 'x' });
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

    test('cloud.daily_stat → NON ri-applicato (increment non idempotente, evita doppio-conteggio)', async () => {
        await applyOutboxOperation('cloud.daily_stat', {
            localDate: 'd',
            accountId: 'a',
            field: 'invites_sent',
            amount: 1,
        });
        expect(mocks.incrementCloudDailyStat).not.toHaveBeenCalled();
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
