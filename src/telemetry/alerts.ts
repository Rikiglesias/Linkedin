import { config } from '../config';
import { fetchWithRetryPolicy } from '../core/integrationPolicy';

export type AlertSeverity = 'info' | 'warn' | 'critical';

// ─── Rate Limiter (CC-21) ────────────────────────────────────────────────
// Sliding window: max RATE_LIMIT_MAX alert per RATE_LIMIT_WINDOW_MS.
// Previene flooding del bot Telegram durante cascading failures.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const alertTimestamps: number[] = [];

function isRateLimited(): boolean {
    const now = Date.now();
    // Rimuovi timestamp fuori dalla finestra
    while (alertTimestamps.length > 0 && (alertTimestamps[0] ?? 0) < now - RATE_LIMIT_WINDOW_MS) {
        alertTimestamps.shift();
    }
    if (alertTimestamps.length >= RATE_LIMIT_MAX) {
        return true;
    }
    alertTimestamps.push(now);
    return false;
}

export async function sendTelegramAlert(
    message: string,
    title?: string,
    severity: AlertSeverity = 'info',
): Promise<void> {
    if (!config.telegramBotToken || !config.telegramChatId) {
        return;
    }

    if (isRateLimited()) {
        console.warn(`[TELEGRAM] Alert rate-limited (max ${RATE_LIMIT_MAX}/min): ${title ?? message.slice(0, 80)}`);
        return;
    }

    const icons: Record<AlertSeverity, string> = {
        info: 'ℹ️',
        warn: '⚠️',
        critical: '🚨',
    };

    const header = title ? `${icons[severity]} <b>${title}</b>\n\n` : `${icons[severity]} `;
    const text = `${header}${message}`;

    const endpoint = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
    try {
        await fetchWithRetryPolicy(
            endpoint,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: config.telegramChatId,
                    text: text,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                }),
            },
            {
                integration: 'telegram.alert',
                circuitKey: 'notifications.telegram',
                timeoutMs: 8_000,
                maxAttempts: 2,
            },
        );
    } catch (error) {
        console.error('[WARN] Invio alert Telegram fallito', error);
    }
}
