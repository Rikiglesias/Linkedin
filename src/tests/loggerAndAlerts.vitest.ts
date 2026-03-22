import { describe, it, expect, vi } from 'vitest';
import { logInfo, logWarn, logError } from '../telemetry/logger';
import { sendTelegramAlert } from '../telemetry/alerts';

// Mock fetchWithRetryPolicy per evitare chiamate HTTP reali a Telegram durante i test.
// Senza questo mock, i test inviano 4 messaggi reali al bot Telegram ad ogni esecuzione.
vi.mock('../core/integrationPolicy', () => ({
    fetchWithRetryPolicy: vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('') }),
}));

describe('telemetry/logger', () => {
    it('logInfo non lancia', async () => {
        await expect(logInfo('test.info', { key: 'value' })).resolves.not.toThrow();
    });

    it('logWarn non lancia', async () => {
        await expect(logWarn('test.warn', { key: 'value' })).resolves.not.toThrow();
    });

    it('logError non lancia', async () => {
        await expect(logError('test.error', { key: 'value' })).resolves.not.toThrow();
    });

    it('logInfo con payload vuoto', async () => {
        await expect(logInfo('test.empty')).resolves.not.toThrow();
    });
});

describe('telemetry/alerts — sendTelegramAlert', () => {
    it('non lancia senza config Telegram', async () => {
        await expect(sendTelegramAlert('Test alert', 'Test', 'info')).resolves.not.toThrow();
    });

    it('accetta severity info/warn/critical', async () => {
        await expect(sendTelegramAlert('msg', 'title', 'info')).resolves.not.toThrow();
        await expect(sendTelegramAlert('msg', 'title', 'warn')).resolves.not.toThrow();
        await expect(sendTelegramAlert('msg', 'title', 'critical')).resolves.not.toThrow();
    });
});
