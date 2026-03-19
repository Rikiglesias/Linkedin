import { describe, it, expect } from 'vitest';
import { logInfo, logWarn, logError } from '../telemetry/logger';
import { sendTelegramAlert } from '../telemetry/alerts';

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
        // Senza TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID, ritorna silenziosamente
        await expect(sendTelegramAlert('Test alert', 'Test', 'info')).resolves.not.toThrow();
    });

    it('accetta severity info/warn/critical', async () => {
        await expect(sendTelegramAlert('msg', 'title', 'info')).resolves.not.toThrow();
        await expect(sendTelegramAlert('msg', 'title', 'warn')).resolves.not.toThrow();
        await expect(sendTelegramAlert('msg', 'title', 'critical')).resolves.not.toThrow();
    });
});
