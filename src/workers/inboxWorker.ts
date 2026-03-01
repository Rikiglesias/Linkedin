import { humanDelay, humanMouseMove, simulateHumanReading } from '../browser';
import { WorkerContext } from './context';
import { analyzeIncomingMessage } from '../ai/sentimentAnalysis';
import { logInfo, logWarn } from '../telemetry/logger';
import { WorkerExecutionResult, workerResult } from './result';
import { getLeadByLinkedinUrl, storeLeadIntent } from '../core/repositories';
import { transitionLead } from '../core/leadStateService';
import { isProfileUrl, normalizeLinkedInUrl } from '../linkedinUrl';
import { recordOutcome } from '../ml/abBandit';

export interface InboxJobPayload {
    accountId: string;
}

function estimateReadingDelayMs(message: string): number {
    const normalized = message.trim();
    const words = normalized.length === 0 ? 0 : normalized.split(/\s+/).length;
    const wpm = 185;
    const baseMs = (words / wpm) * 60_000;
    const jitter = Math.floor(Math.random() * 1500);
    return Math.max(1200, Math.min(20_000, Math.floor(baseMs + 1200 + jitter)));
}

async function simulateConversationReading(page: WorkerContext['session']['page'], message: string): Promise<void> {
    const delayMs = estimateReadingDelayMs(message);
    if (Math.random() < 0.6) {
        await page.evaluate(() => {
            const container = document.querySelector('.msg-s-message-list-content, .msg-thread, .scaffold-finite-scroll');
            if (container instanceof HTMLElement) {
                container.scrollBy({ top: 180, behavior: 'smooth' });
            } else {
                window.scrollBy({ top: 120, behavior: 'smooth' });
            }
        }).catch(() => null);
    }
    await page.waitForTimeout(delayMs);
}

async function extractParticipantProfileUrl(page: WorkerContext['session']['page']): Promise<string | null> {
    const links = await page.evaluate(() => {
        const selectors = [
            '.msg-thread__link-to-profile',
            '.msg-thread__topcard a[href*="/in/"]',
            '.msg-convo-wrapper a[href*="/in/"]',
            '.msg-s-message-group__profile-link[href*="/in/"]',
            'a[href*="/in/"]',
        ];
        const hrefs = new Set<string>();
        for (const selector of selectors) {
            for (const node of Array.from(document.querySelectorAll(selector))) {
                const href = (node as HTMLAnchorElement).href || node.getAttribute('href') || '';
                if (href) hrefs.add(href);
            }
            if (hrefs.size > 0) break;
        }
        return Array.from(hrefs);
    }).catch(() => [] as string[]);

    for (const link of links) {
        const normalized = normalizeLinkedInUrl(link);
        if (isProfileUrl(normalized)) {
            return normalized;
        }
    }
    return null;
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
                    await simulateConversationReading(page, rawText.trim());

                    // Analisi Sentiment (NLP)
                    const sentiment = await analyzeIncomingMessage(rawText.trim());
                    const profileUrl = await extractParticipantProfileUrl(page);
                    let leadId: number | null = null;
                    if (profileUrl) {
                        const lead = await getLeadByLinkedinUrl(profileUrl);
                        if (lead) {
                            leadId = lead.id;
                            await storeLeadIntent(
                                lead.id,
                                sentiment.intent,
                                sentiment.subIntent,
                                sentiment.confidence,
                                rawText.trim(),
                                sentiment.entities
                            );
                            if (lead.status === 'MESSAGED') {
                                await transitionLead(
                                    lead.id,
                                    'REPLIED',
                                    'inbox_reply_detected',
                                    {
                                        intent: sentiment.intent,
                                        subIntent: sentiment.subIntent,
                                        entities: sentiment.entities,
                                        confidence: sentiment.confidence,
                                    }
                                );
                                if (lead.invite_prompt_variant) {
                                    const segmentKey = (lead.job_title || 'unknown').toLowerCase().trim() || 'unknown';
                                    recordOutcome(lead.invite_prompt_variant, 'replied', { segmentKey }).catch(() => null);
                                }
                            }
                        }
                    }
                    await logInfo('inbox.analyzed_message', {
                        accountId: payload.accountId,
                        textExcerpt: rawText.substring(0, 30),
                        intent: sentiment.intent,
                        confidence: sentiment.confidence,
                        leadId,
                        profileUrl,
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
            }
        }

        await humanDelay(page, 1000, 2000);
    }

    return workerResult(processedCount, errors);
}
