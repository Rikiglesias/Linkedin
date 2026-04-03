import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getRuntimeAccountProfiles: vi.fn(),
    askConfirmation: vi.fn(),
    getRuntimeFlag: vi.fn(),
}));

vi.mock('../accountManager', () => ({
    getRuntimeAccountProfiles: mocks.getRuntimeAccountProfiles,
}));

vi.mock('../cli/stdinHelper', () => ({
    askConfirmation: mocks.askConfirmation,
}));

vi.mock('../core/repositories', () => ({
    getRuntimeFlag: mocks.getRuntimeFlag,
}));

import { runAntiBanChecklist } from '../workflows/preflight/antiBanChecklist';

describe('preflight antiBanChecklist', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getRuntimeAccountProfiles.mockReturnValue([{ id: 'acc-1' }]);
        mocks.getRuntimeFlag.mockResolvedValue(null);
    });

    test('fallisce subito se il browser non è pronto', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mocks.askConfirmation.mockResolvedValue(false);

        const result = await runAntiBanChecklist('send-invites');

        expect(result).toBe(false);
        expect(mocks.askConfirmation).toHaveBeenCalledTimes(1);
        logSpy.mockRestore();
    });

    test('fallisce se la sessione è troppo recente e l utente non forza', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mocks.askConfirmation.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        mocks.getRuntimeFlag.mockResolvedValue(new Date(Date.now() - 30 * 60 * 1000).toISOString());

        const result = await runAntiBanChecklist('send-messages', {
            totalLeads: 10,
            byStatus: { INVITED: 6, ACCEPTED: 0, READY_MESSAGE: 0 },
            byList: {},
            withEmail: 2,
            withoutEmail: 8,
            withScore: 3,
            withJobTitle: 4,
            withPhone: 0,
            withLocation: 2,
            lastSyncAt: null,
            trend: null,
        });

        expect(result).toBe(false);
        expect(mocks.askConfirmation).toHaveBeenCalledTimes(2);
        logSpy.mockRestore();
    });

    test('passa e mostra i tips quando non ci sono blocchi', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mocks.askConfirmation.mockResolvedValue(true);

        const result = await runAntiBanChecklist('send-invites', {
            totalLeads: 20,
            byStatus: { READY_INVITE: 5, INVITED: 2 },
            byList: {},
            withEmail: 10,
            withoutEmail: 10,
            withScore: 7,
            withJobTitle: 8,
            withPhone: 2,
            withLocation: 6,
            lastSyncAt: new Date().toISOString(),
            trend: null,
        });

        expect(result).toBe(true);
        expect(mocks.askConfirmation).toHaveBeenCalledTimes(1);
        expect(logSpy).toHaveBeenCalled();
        logSpy.mockRestore();
    });
});
