import { describe, test, expect, vi, beforeEach } from 'vitest';

// T5: processTelegramMessage deve essere FAIL-CLOSED. Se telegramChatId non e' configurato,
// ogni comando va rifiutato (altrimenti chiunque puo' pilotare il bot). Prima il guard era
// `if (config.telegramChatId && id !== chatId)`: con chatId vuoto il guard era falsy -> passava.

const h = vi.hoisted(() => ({
    config: {
        telegramChatId: '',
        supabaseSyncEnabled: false,
        supabaseUrl: '',
        supabaseServiceRoleKey: '',
    },
    logInfo: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
}));

vi.mock('../config', () => ({ config: h.config }));
vi.mock('../telemetry/logger', () => ({ logInfo: h.logInfo, logWarn: h.logWarn, logError: h.logError }));
vi.mock('../core/integrationPolicy', () => ({ fetchWithRetryPolicy: vi.fn() }));
vi.mock('../db', () => ({ getDatabase: vi.fn() }));

import { processTelegramMessage } from '../cloud/telegramListener';

function unauthorizedCalls(): unknown[][] {
    return h.logWarn.mock.calls.filter((c) => c[0] === 'telegram.unauthorized_access');
}

describe('processTelegramMessage authz fail-closed (T5)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.config.telegramChatId = '';
        h.config.supabaseSyncEnabled = false;
        h.logInfo.mockResolvedValue(undefined);
        h.logWarn.mockResolvedValue(undefined);
    });

    test('chatId NON configurato → comando rifiutato (fail-closed)', async () => {
        h.config.telegramChatId = '';
        await processTelegramMessage({ text: '/pausa', chat: { id: 555 } });
        const calls = unauthorizedCalls();
        expect(calls).toHaveLength(1);
        expect(calls[0][1]).toMatchObject({ reason: 'telegramChatId_not_configured' });
    });

    test('chatId configurato ma mittente diverso → rifiutato', async () => {
        h.config.telegramChatId = '123';
        await processTelegramMessage({ text: '/pausa', chat: { id: 999 } });
        expect(unauthorizedCalls()).toHaveLength(1);
    });

    test('chatId configurato e mittente corretto → guard superato (nessun unauthorized)', async () => {
        h.config.telegramChatId = '123';
        await processTelegramMessage({ text: '/pausa', chat: { id: 123 } });
        expect(unauthorizedCalls()).toHaveLength(0);
    });

    test('messaggio non-comando (no slash) → ignorato senza errori', async () => {
        h.config.telegramChatId = '123';
        await processTelegramMessage({ text: 'ciao', chat: { id: 123 } });
        expect(unauthorizedCalls()).toHaveLength(0);
    });
});
