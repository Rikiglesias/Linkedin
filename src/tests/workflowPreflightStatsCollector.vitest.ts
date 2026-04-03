import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getDatabase: vi.fn(),
    getLocalDateString: vi.fn(),
}));

vi.mock('../db', () => ({
    getDatabase: mocks.getDatabase,
}));

vi.mock('../config', () => ({
    getLocalDateString: mocks.getLocalDateString,
}));

import { collectDbStats } from '../workflows/preflight/statsCollector';

describe('preflight statsCollector', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getLocalDateString.mockReturnValue('2026-04-01');
    });

    test('raccoglie statistiche e trend quando esiste attività il giorno precedente', async () => {
        const db = {
            get: vi
                .fn()
                .mockResolvedValueOnce({ total: 100 })
                .mockResolvedValueOnce({ total: 40 })
                .mockResolvedValueOnce({ total: 55 })
                .mockResolvedValueOnce({ total: 20 })
                .mockResolvedValueOnce({ total: 70 })
                .mockResolvedValueOnce({ total: 60 })
                .mockResolvedValueOnce({ last_synced_at: '2026-03-29T10:00:00Z' })
                .mockResolvedValueOnce({
                    invites_sent: 3,
                    messages_sent: 2,
                    acceptances: 1,
                    challenges_count: 1,
                })
                .mockResolvedValueOnce({ cnt: 12 })
                .mockResolvedValueOnce({ cnt: 5 }),
            query: vi
                .fn()
                .mockResolvedValueOnce([
                    { status: 'READY_INVITE', cnt: 22 },
                    { status: 'INVITED', cnt: 7 },
                ])
                .mockResolvedValueOnce([
                    { list_name: 'lista-a', cnt: 50 },
                    { list_name: 'lista-b', cnt: 30 },
                ]),
        };
        mocks.getDatabase.mockResolvedValue(db);

        const result = await collectDbStats('lista-a');

        expect(result).toEqual({
            totalLeads: 100,
            byStatus: {
                READY_INVITE: 22,
                INVITED: 7,
            },
            byList: {
                'lista-a': 50,
                'lista-b': 30,
            },
            withEmail: 40,
            withoutEmail: 60,
            withScore: 70,
            withJobTitle: 55,
            withPhone: 20,
            withLocation: 60,
            lastSyncAt: '2026-03-29T10:00:00Z',
            trend: {
                invitesYesterday: 3,
                messagesYesterday: 2,
                acceptancesYesterday: 1,
                challengesYesterday: 1,
                leadsDelta: 7,
            },
        });
    });

    test('ritorna trend null quando ieri non ci sono segnali utili', async () => {
        const db = {
            get: vi
                .fn()
                .mockResolvedValueOnce({ total: 10 })
                .mockResolvedValueOnce({ total: 4 })
                .mockResolvedValueOnce({ total: 2 })
                .mockResolvedValueOnce({ total: 1 })
                .mockResolvedValueOnce({ total: 3 })
                .mockResolvedValueOnce({ total: 6 })
                .mockResolvedValueOnce({ last_synced_at: '2026-03-30T10:00:00Z' })
                .mockResolvedValueOnce({
                    invites_sent: 0,
                    messages_sent: 0,
                    acceptances: 0,
                    challenges_count: 2,
                }),
            query: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]),
        };
        mocks.getDatabase.mockResolvedValue(db);

        const result = await collectDbStats('lista-a');

        expect(result.trend).toBeNull();
    });
});
