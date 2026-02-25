import { config } from '../config';

export async function sendTelegramAlert(message: string): Promise<void> {
    if (!config.telegramBotToken || !config.telegramChatId) {
        return;
    }

    const endpoint = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
    try {
        await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: config.telegramChatId,
                text: message,
                disable_web_page_preview: true,
            }),
        });
    } catch (error) {
        console.error('[WARN] Invio alert Telegram fallito', error);
    }
}

