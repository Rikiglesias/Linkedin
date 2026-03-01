import { humanDelay, humanMouseMove, simulateHumanReading } from '../browser';
import { WorkerContext } from './context';
import { analyzeIncomingMessage } from '../ai/sentimentAnalysis';
import { logInfo, logWarn } from '../telemetry/logger';
import { WorkerExecutionResult, workerResult } from './result';

export interface InboxJobPayload {
    accountId: string;
}

export async function processInboxJob(payload: InboxJobPayload, context: WorkerContext): Promise<WorkerExecutionResult> {
    const page = context.session.page;
    const errors: Array<{ message: string }> = [];
    let processedCount = 0;
    await page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'domcontentloaded' });
    await simulateHumanReading(page);

    // Aspetta che i messaggi vengano caricati
    try {
        await page.waitForSelector('.msg-conversation-listitem', { timeout: 10000 });
    } catch {
        await logWarn('inbox.no_conversations', {
            accountId: payload.accountId,
            message: 'Nessuna conversazione trovata o timeout',
        });
        return workerResult(0);
    }

    const unreadConversations = page.locator('.msg-conversation-listitem:has(.msg-conversation-card__unread-count)');
    const count = await unreadConversations.count();

    if (count === 0) {
        await logInfo('inbox.no_unread', {
            accountId: payload.accountId,
            message: 'Nessun messaggio non letto trovato',
        });
        return workerResult(0);
    }

    for (let i = 0; i < Math.min(count, 5); i++) {
        const convo = unreadConversations.nth(i);
        await humanMouseMove(page, '.msg-conversation-listitem:has(.msg-conversation-card__unread-count)');
        await humanDelay(page, 200, 600);
        await convo.click();

        await humanDelay(page, 1500, 3000); // Wait for chat to load

        // Estrai l'ultimo messaggio visibile dell'interlocutore
        const lastMessageLocator = page.locator('.msg-s-message-list__event:not([data-msg-s-message-event-is-me="true"]) .msg-s-event-listitem__body').last();

        if (await lastMessageLocator.isVisible()) {
            const rawText = await lastMessageLocator.innerText();
            if (rawText && rawText.trim().length > 0) {
                try {
                    // Analisi Sentiment (NLP)
                    const sentiment = await analyzeIncomingMessage(rawText.trim());
                    await logInfo('inbox.analyzed_message', {
                        accountId: payload.accountId,
                        textExcerpt: rawText.substring(0, 30),
                        intent: sentiment.intent,
                        confidence: sentiment.confidence
                    });
                    processedCount += 1;
                } catch (error: unknown) {
                    const message = error instanceof Error ? error.message : String(error);
                    errors.push({ message });
                    await logWarn('inbox.analyzed_message_error', {
                        accountId: payload.accountId,
                        message,
                    });
                }

                //TODO: Aggiorna lo stato del Lead in base all'intent (es. tag 'INTERESTED' o blocca bot)
            }
        }

        await humanDelay(page, 1000, 2000);
    }

    return workerResult(processedCount, errors);
}
