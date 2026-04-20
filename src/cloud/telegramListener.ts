import { config } from '../config';
import { logInfo, logWarn, logError } from '../telemetry/logger';
import { fetchWithRetryPolicy } from '../core/integrationPolicy';
import { getDatabase } from '../db';

let isPolling = false;
let lastUpdateId = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabaseClient: any = null;
let _updatesSinceLastPersist = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSupabaseSingleton(): Promise<any> {
    if (_supabaseClient) return _supabaseClient;
    if (!config.supabaseSyncEnabled || !config.supabaseUrl || !config.supabaseServiceRoleKey) return null;
    const { createClient } = await import('@supabase/supabase-js');
    _supabaseClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    return _supabaseClient;
}

async function loadLastUpdateId(): Promise<void> {
    try {
        const db = await getDatabase();
        const row = await db.get<{ value: string }>(`SELECT value FROM telegram_state WHERE key = 'lastUpdateId'`);
        if (row?.value) {
            const parsed = Number.parseInt(row.value, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                lastUpdateId = parsed;
            }
        }
    } catch {
        // telegram_state table may not exist yet — use in-memory default
    }
}

async function persistLastUpdateId(): Promise<void> {
    try {
        const db = await getDatabase();
        await db.run(
            `INSERT INTO telegram_state (key, value, updated_at) VALUES ('lastUpdateId', ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            [String(lastUpdateId)],
        );
    } catch {
        // Best effort — DB may not have the table yet
    }
}

export async function stopTelegramListener(): Promise<void> {
    isPolling = false;
    await persistLastUpdateId();
    _updatesSinceLastPersist = 0;
    await logInfo('telegram.listener_stopped', { lastUpdateId });
}

export async function startTelegramListener(): Promise<void> {
    if (!config.telegramBotToken) {
        await logWarn('telegram.listener_not_started', { reason: 'missing_bot_token' });
        return;
    }
    if (isPolling) return;
    isPolling = true;

    await loadLastUpdateId();
    await logInfo('telegram.listener_started', { lastUpdateId });

    // Esegue in background infinito
    void pollLoop();
}

async function pollLoop(): Promise<void> {
    while (isPolling) {
        try {
            const url = `https://api.telegram.org/bot${config.telegramBotToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
            const response = await fetchWithRetryPolicy(
                url,
                { method: 'GET' },
                {
                    integration: 'telegram.long_polling',
                    circuitKey: 'telegram.polling',
                    timeoutMs: 35_000,
                    maxAttempts: 2,
                },
            );
            if (!response.ok) {
                await new Promise((res) => setTimeout(res, 5000));
                continue;
            }

            const data = (await response.json()) as {
                ok: boolean;
                result?: Array<{ update_id: number; message?: TelegramMessage }>;
            };
            if (!data.ok || !data.result) {
                await new Promise((res) => setTimeout(res, 2000));
                continue;
            }

            for (const update of data.result) {
                lastUpdateId = Math.max(lastUpdateId, update.update_id);
                if (update.message && update.message.text) {
                    await processTelegramMessage(update.message);
                }
                _updatesSinceLastPersist++;
            }
            if (_updatesSinceLastPersist >= 10) {
                await persistLastUpdateId();
                _updatesSinceLastPersist = 0;
            }
        } catch (error) {
            await logError('telegram.polling_error', { error: error instanceof Error ? error.message : String(error) });
            await new Promise((res) => setTimeout(res, 5000));
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

    const sb = await getSupabaseSingleton();
    if (sb) {
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
        await fetchWithRetryPolicy(
            `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text,
                }),
            },
            {
                integration: 'telegram.reply',
                circuitKey: 'telegram.reply',
                timeoutMs: 8_000,
                maxAttempts: 2,
            },
        );
    } catch (e) {
        await logError('telegram.reply_failed', { error: e instanceof Error ? e.message : String(e) });
    }
}
