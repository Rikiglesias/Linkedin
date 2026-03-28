/**
 * Estrae gli ultimi N messaggi da un thread chat LinkedIn aperto.
 * Read-only DOM scraping — non-blocking, ritorna [] su errore.
 */
import type { Page } from 'playwright';
import { logWarn } from '../telemetry/logger';

/**
 * Legge gli ultimi messaggi da una chat LinkedIn aperta.
 * @returns Array di stringhe "THEM: ..." / "ME: ..." oppure [] se fallisce.
 */
export async function extractRecentChatMessages(
    page: Page,
    maxMessages: number = 5,
): Promise<string[]> {
    try {
        // LinkedIn messaging: ogni messaggio e' in un list item con classe msg-s-event-listitem
        const msgItems = page.locator('.msg-s-message-list-content .msg-s-event-listitem');
        const count = await msgItems.count().catch(() => 0);
        if (count === 0) return [];

        const messages: string[] = [];
        const startIdx = Math.max(0, count - maxMessages);

        for (let i = startIdx; i < count; i++) {
            const item = msgItems.nth(i);
            const bodyEl = item.locator('.msg-s-event-listitem__body');
            const text = (await bodyEl.innerText().catch(() => '')).trim();
            if (!text) continue;

            // LinkedIn aggiunge una classe specifica ai messaggi inviati da noi
            const classList = await item.getAttribute('class').catch(() => '');
            const isMe = classList?.includes('msg-s-message-list__event--last-outgoing')
                || (await item.locator('.msg-s-message-group--outgoing').count().catch(() => 0)) > 0;

            const prefix = isMe ? 'ME' : 'THEM';
            messages.push(`${prefix}: ${text.substring(0, 200)}`);
        }

        return messages;
    } catch (err) {
        await logWarn('chat_extractor.failed', {
            error: err instanceof Error ? err.message : String(err),
        });
        return [];
    }
}
