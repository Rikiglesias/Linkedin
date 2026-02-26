import { config } from '../config';
import { logInfo, logWarn } from '../telemetry/logger';

let isPolling = false;
let lastUpdateId = 0;

export async function startTelegramListener(): Promise<void> {
    if (!config.telegramBotToken) {
        console.warn('[TELEGRAM] Listener non avviato: telegramBotToken mancante.');
        return;
    }
    if (isPolling) return;
    isPolling = true;

    console.log('[TELEGRAM] Long-polling listener avviato per ricezione comandi nel DB.');

    // Esegue in background infinito
    void pollLoop();
}

async function pollLoop(): Promise<void> {
    while (isPolling) {
        try {
            const url = `https://api.telegram.org/bot${config.telegramBotToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
            const response = await fetch(url);
            if (!response.ok) {
                await new Promise(res => setTimeout(res, 5000));
                continue;
            }

            const data = await response.json() as { ok: boolean; result?: Array<{ update_id: number; message?: TelegramMessage }> };
            if (!data.ok || !data.result) {
                await new Promise(res => setTimeout(res, 2000));
                continue;
            }

            for (const update of data.result) {
                lastUpdateId = Math.max(lastUpdateId, update.update_id);
                if (update.message && update.message.text) {
                    await processTelegramMessage(update.message);
                }
            }
        } catch (error) {
            console.error('[TELEGRAM] Errore nel polling:', error);
            await new Promise(res => setTimeout(res, 5000));
        }
    }
}

interface TelegramMessage {
    text?: string;
    chat: {
        id: number | string;
    };
}

async function processTelegramMessage(message: TelegramMessage): Promise<void> {
    const text = (message.text || '').trim();
    if (!text.startsWith('/')) return; // Solo comandi

    // Verifica sicurezza (solo la chat autorizzata)
    if (config.telegramChatId && String(message.chat.id) !== config.telegramChatId) {
        await logWarn('telegram.unauthorized_access', { chatId: message.chat.id, text });
        return;
    }

    const parts = text.split(' ');
    const command = parts[0].substring(1).toLowerCase(); // es. 'pausa'
    const argsRaw = parts.slice(1);

    let accountId: string | null = null;
    let actualArgs = argsRaw.join(' ');

    // Sintassi opzionale: /pausa acc1
    if (argsRaw.length >= 1 && (argsRaw[0] === 'all' || argsRaw[0].startsWith('acc') || /^[0-9]+$/.test(argsRaw[0]))) {
        accountId = argsRaw[0];
        actualArgs = argsRaw.slice(1).join(' ');
    }

    // Inserire usando Supabase supabase-js (lo ricarichiamo globalmente per evitare dipendenze circolari strane in init)
    const { createClient } = await import('@supabase/supabase-js');
    if (config.supabaseSyncEnabled && config.supabaseUrl && config.supabaseServiceRoleKey) {
        const sb = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
        });

        const { error } = await sb.from('telegram_commands').insert({
            account_id: accountId === 'all' ? null : accountId || null,
            command,
            args: actualArgs || null,
            status: 'PENDING',
        });

        if (error) {
            await logWarn('telegram.command.insert_failed', { error: error.message });
            await replyToTelegram(message.chat.id, `❌ Errore Supabase: ${error.message}`);
        } else {
            await logInfo('telegram.command.received', { command, accountId, actualArgs });
            await replyToTelegram(message.chat.id, `✅ Comando /${command} accodato (attendere processing).`);
        }
    } else {
        await logWarn('telegram.command.ignored_no_cloud', { command });
        await replyToTelegram(message.chat.id, `❌ Supabase non configurato. Impossibile accodare /${command}.`);
    }
}

async function replyToTelegram(chatId: string | number, text: string): Promise<void> {
    try {
        await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
            })
        });
    } catch (e) {
        console.error('[TELEGRAM] Errore risposta', e);
    }
}
