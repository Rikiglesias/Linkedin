import { config } from '../config';

export type AlertSeverity = 'info' | 'warn' | 'critical';

export async function sendTelegramAlert(message: string, title?: string, severity: AlertSeverity = 'info'): Promise<void> {
    if (!config.telegramBotToken || !config.telegramChatId) {
        return;
    }

    const icons: Record<AlertSeverity, string> = {
        info: 'ℹ️',
        warn: '⚠️',
        critical: '🚨'
    };

    const header = title ? `${icons[severity]} *${title}*\n\n` : `${icons[severity]} `;
    const text = `${header}${message}`;

    const endpoint = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
    try {
        await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: config.telegramChatId,
                text: text,
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
            }),
        });
    } catch (error) {
        console.error('[WARN] Invio alert Telegram fallito', error);
    }
}
