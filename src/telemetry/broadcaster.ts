/**
 * broadcaster.ts – Multi-Channel Notification Hub
 *
 * Centralizes outbound alerts to Discord, Slack, and Telegram.
 * This module is a thin abstraction layer: each channel is independently
 * configurable via environment variables. If a channel is not configured,
 * it is silently skipped so there is zero runtime overhead for disabled channels.
 *
 * Integration strategy:
 *   1. Discord / Slack → Simple HTTP POST to a Webhook URL (no SDK needed).
 *   2. Telegram → Re-uses the existing telegramNotifier helper from cloud/.
 *
 * Usage:
 *   await broadcast({ level: 'CRITICAL', title: 'WEEKLY_LIMIT_REACHED', body: '...' });
 */

import { config } from '../config';
import { logError, logWarn } from './logger';
import { sanitizeForLogs } from '../security/redaction';
import { fetchWithRetryPolicy } from '../core/integrationPolicy';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BroadcastLevel = 'INFO' | 'WARNING' | 'CRITICAL';

export interface BroadcastPayload {
    level: BroadcastLevel;
    title: string;
    body: string;
    metadata?: Record<string, unknown>;
}

// ─── Level Emoji Map ──────────────────────────────────────────────────────────

const LEVEL_EMOJI: Record<BroadcastLevel, string> = {
    INFO: 'ℹ️',
    WARNING: '⚠️',
    CRITICAL: '🚨',
};

// ─── Discord ──────────────────────────────────────────────────────────────────

async function sendToDiscord(payload: BroadcastPayload): Promise<void> {
    const url = config.discordWebhookUrl;
    if (!url) return; // Channel not configured

    const emoji = LEVEL_EMOJI[payload.level];
    const safeMetadata = payload.metadata ? sanitizeForLogs(payload.metadata) : undefined;
    const metaBlock = safeMetadata
        ? '\n```json\n' + JSON.stringify(safeMetadata, null, 2).substring(0, 800) + '\n```'
        : '';

    const discordBody = {
        username: 'LinkedIn Bot',
        embeds: [
            {
                title: `${emoji} [${payload.level}] ${payload.title}`,
                description: payload.body + metaBlock,
                color: payload.level === 'CRITICAL' ? 0xff0000 : payload.level === 'WARNING' ? 0xffa500 : 0x00bfff,
                timestamp: new Date().toISOString(),
            },
        ],
    };

    const response = await fetchWithRetryPolicy(
        url,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(discordBody),
        },
        {
            integration: 'discord.webhook',
            circuitKey: 'notifications.discord',
            timeoutMs: 8_000,
            maxAttempts: 2,
        },
    );

    if (!response.ok) {
        await logWarn(`[broadcaster] Discord webhook returned HTTP ${response.status}`);
    }
}

// ─── Slack ────────────────────────────────────────────────────────────────────

async function sendToSlack(payload: BroadcastPayload): Promise<void> {
    const url = config.slackWebhookUrl;
    if (!url) return; // Channel not configured

    const emoji = LEVEL_EMOJI[payload.level];
    const safeMetadata = payload.metadata ? sanitizeForLogs(payload.metadata) : undefined;
    const metaText = safeMetadata
        ? '\n```' + JSON.stringify(safeMetadata, null, 2).substring(0, 600) + '```'
        : '';

    const slackBody = {
        text: `${emoji} *[${payload.level}] ${payload.title}*\n${payload.body}${metaText}`,
    };

    const response = await fetchWithRetryPolicy(
        url,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(slackBody),
        },
        {
            integration: 'slack.webhook',
            circuitKey: 'notifications.slack',
            timeoutMs: 8_000,
            maxAttempts: 2,
        },
    );

    if (!response.ok) {
        await logWarn(`[broadcaster] Slack webhook returned HTTP ${response.status}`);
    }
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

async function sendToTelegram(payload: BroadcastPayload): Promise<void> {
    const botToken = config.telegramBotToken;
    const chatId = config.telegramChatId;
    if (!botToken || !chatId) return; // Channel not configured

    const emoji = LEVEL_EMOJI[payload.level];
    const safeMetadata = payload.metadata ? sanitizeForLogs(payload.metadata) : undefined;
    const metaText = safeMetadata
        ? '\n<pre>' +
          JSON.stringify(safeMetadata, null, 2).substring(0, 600).replace(/</g, '&lt;').replace(/>/g, '&gt;') +
          '</pre>'
        : '';

    const text = `${emoji} <b>[${payload.level}] ${payload.title}</b>\n${payload.body}${metaText}`;

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetchWithRetryPolicy(
        url,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: 'HTML',
                disable_notification: payload.level === 'INFO',
            }),
        },
        {
            integration: 'telegram.send_message',
            circuitKey: 'notifications.telegram',
            timeoutMs: 8_000,
            maxAttempts: 2,
        },
    );

    if (!response.ok) {
        await logWarn(`[broadcaster] Telegram API returned HTTP ${response.status}`);
    }
}

// ─── Main Broadcast Fan-out ───────────────────────────────────────────────────

/**
 * Fans out the same alert to all configured channels (Discord, Slack, Telegram).
 * Each channel is independently tried; failures in one do not block the others.
 * Non-blocking: this function will not throw, only log errors internally.
 */
export async function broadcast(payload: BroadcastPayload): Promise<void> {
    const promises = [
        sendToDiscord(payload).catch((err: unknown) =>
            logError('[broadcaster] Discord send failed', { error: err instanceof Error ? err.message : String(err) }),
        ),
        sendToSlack(payload).catch((err: unknown) =>
            logError('[broadcaster] Slack send failed', { error: err instanceof Error ? err.message : String(err) }),
        ),
        sendToTelegram(payload).catch((err: unknown) =>
            logError('[broadcaster] Telegram send failed', { error: err instanceof Error ? err.message : String(err) }),
        ),
    ];

    await Promise.allSettled(promises);
}

/**
 * Convenience wrappers for common severity levels.
 * These also never throw.
 */
export function broadcastCritical(title: string, body: string, metadata?: Record<string, unknown>): Promise<void> {
    return broadcast({ level: 'CRITICAL', title, body, metadata });
}

export function broadcastWarning(title: string, body: string, metadata?: Record<string, unknown>): Promise<void> {
    return broadcast({ level: 'WARNING', title, body, metadata });
}

