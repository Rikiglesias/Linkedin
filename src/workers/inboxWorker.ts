import { clickWithFallback, humanDelay, humanMouseMove, simulateHumanReading, typeWithFallback } from '../browser';
import { WorkerContext } from './context';
import { resolveIntentAndDraft } from '../ai/intentResolver';
import { logInfo, logWarn } from '../telemetry/logger';
import { WorkerExecutionResult, workerResult } from './result';
import { appendLeadReplyDraft, countRecentMessageHash, getLeadByLinkedinUrl, storeLeadIntent, storeMessageHash } from '../core/repositories';
import { hashMessage } from '../validation/messageValidator';
import { transitionLead } from '../core/leadStateService';
import { isProfileUrl, normalizeLinkedInUrl } from '../linkedinUrl';
import { recordOutcome } from '../ml/abBandit';
import { config } from '../config';
import { SELECTORS, joinSelectors } from '../selectors';

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
        await page
            .evaluate(() => {
                const container = document.querySelector(
                    '.msg-s-message-list-content, .msg-thread, .scaffold-finite-scroll',
                );
                if (container instanceof HTMLElement) {
                    container.scrollBy({ top: 180, behavior: 'smooth' });
                } else {
                    window.scrollBy({ top: 120, behavior: 'smooth' });
                }
            })
            .catch(() => null);
    }
    await page.waitForTimeout(delayMs);
}

async function extractParticipantProfileUrl(page: WorkerContext['session']['page']): Promise<string | null> {
    const links = await page
        .evaluate(() => {
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
        })
        .catch(() => [] as string[]);

    for (const link of links) {
        const normalized = normalizeLinkedInUrl(link);
        if (isProfileUrl(normalized)) {
            return normalized;
        }
    }
    return null;
}

export async function processInboxJob(
    payload: InboxJobPayload,
    context: WorkerContext,
): Promise<WorkerExecutionResult> {
    const page = context.session.page;
    const errors: Array<{ message: string }> = [];
    let processedCount = 0;
    let autoRepliesSent = 0;
    await page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'domcontentloaded' });
    await simulateHumanReading(page);

    // Aspetta che i messaggi vengano caricati
    try {
        await page.waitForSelector(joinSelectors('inboxConversationItem'), { timeout: 10000 });
    } catch {
        await logWarn('inbox.no_conversations', {
            accountId: payload.accountId,
            message: 'Nessuna conversazione trovata o timeout',
        });
        return workerResult(0);
    }

    // ── Anti-ban: rilevare messaggi di sistema LinkedIn ("unusual activity", "restricted") ──
    // LinkedIn manda messaggi prima di un ban. Se ne troviamo uno, pausa immediata.
    try {
        const allConvos = page.locator(joinSelectors('inboxConversationItem'));
        const convoCount = await allConvos.count();
        for (let c = 0; c < Math.min(convoCount, 8); c++) {
            const previewText = await allConvos.nth(c).innerText().catch(() => '');
            const lower = previewText.toLowerCase();
            const isLinkedInSystemWarning =
                (lower.includes('linkedin') || lower.includes('security')) &&
                (lower.includes('unusual activity') || lower.includes('restricted') ||
                 lower.includes('verify your identity') || lower.includes('temporarily limited') ||
                 lower.includes('attività insolita') || lower.includes('account limitato') ||
                 lower.includes('verifica la tua identità'));
            if (isLinkedInSystemWarning) {
                await logWarn('inbox.linkedin_system_warning_detected', {
                    accountId: payload.accountId,
                    preview: previewText.slice(0, 200),
                });
                const { pauseAutomation } = await import('../risk/incidentManager');
                await pauseAutomation('LINKEDIN_INBOX_WARNING', { preview: previewText.slice(0, 200) }, 1440);
                const { sendTelegramAlert } = await import('../telemetry/alerts');
                await sendTelegramAlert(
                    `🚨 **LinkedIn warning rilevato nella inbox!**\n\nPreview: ${previewText.slice(0, 150)}\n\n_Automazione in pausa per 24h._`,
                    'LinkedIn Warning',
                    'critical',
                ).catch(() => null);
                return workerResult(0);
            }
        }
    } catch {
        // Best effort — non bloccare l'inbox processing se il check fallisce
    }

    const unreadConversations = page.locator(`${joinSelectors('inboxConversationItem')}:has(${joinSelectors('inboxUnreadBadge')})`);
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
        await humanMouseMove(page, `${joinSelectors('inboxConversationItem')}:has(${joinSelectors('inboxUnreadBadge')})`);
        await humanDelay(page, 200, 600);
        await convo.click();

        await humanDelay(page, 1500, 3000); // Wait for chat to load

        // Estrai l'ultimo messaggio visibile dell'interlocutore
        const lastMessageLocator = page
            .locator(
                '.msg-s-message-list__event:not([data-msg-s-message-event-is-me="true"]) .msg-s-event-listitem__body',
            )
            .last();

        if (await lastMessageLocator.isVisible()) {
            const rawText = await lastMessageLocator.innerText();
            if (rawText && rawText.trim().length > 0) {
                try {
                    await simulateConversationReading(page, rawText.trim());

                    // Analisi Sentiment (NLP)
                    const resolution = await resolveIntentAndDraft(rawText.trim());
                    const profileUrl = await extractParticipantProfileUrl(page);
                    let leadId: number | null = null;
                    let autoReplySent = false;
                    if (profileUrl) {
                        const lead = await getLeadByLinkedinUrl(profileUrl);
                        if (lead) {
                            leadId = lead.id;
                            await storeLeadIntent(
                                lead.id,
                                resolution.intent,
                                resolution.subIntent,
                                resolution.confidence,
                                rawText.trim(),
                                resolution.entities,
                            );
                            if (lead.status === 'MESSAGED') {
                                await transitionLead(lead.id, 'REPLIED', 'inbox_reply_detected', {
                                    intent: resolution.intent,
                                    subIntent: resolution.subIntent,
                                    entities: resolution.entities,
                                    confidence: resolution.confidence,
                                });
                                if (lead.invite_prompt_variant) {
                                    const segmentKey = (lead.job_title || 'unknown').toLowerCase().trim() || 'unknown';
                                    recordOutcome(lead.invite_prompt_variant, 'replied', { segmentKey }).catch(
                                        () => null,
                                    );
                                }
                            }

                            // Anti-duplicate: check if this reply draft was already sent
                            const replyHash = hashMessage(resolution.responseDraft);
                            const replyDuplicateCount = await countRecentMessageHash(replyHash, 24);

                            const canAutoReply =
                                config.inboxAutoReplyEnabled &&
                                !context.dryRun &&
                                autoRepliesSent < config.inboxAutoReplyMaxPerRun &&
                                resolution.confidence >= config.inboxAutoReplyMinConfidence &&
                                resolution.responseDraft.trim().length > 0 &&
                                resolution.intent !== 'NOT_INTERESTED' &&
                                resolution.intent !== 'NEGATIVE' &&
                                replyDuplicateCount === 0;

                            if (canAutoReply) {
                                try {
                                    await page.waitForTimeout(
                                        Math.min(24_000, estimateReadingDelayMs(rawText.trim()) + 1500),
                                    );
                                    await typeWithFallback(
                                        page,
                                        SELECTORS.messageTextbox,
                                        resolution.responseDraft,
                                        'messageTextbox',
                                        5000,
                                    );
                                    await humanDelay(page, 350, 900);
                                    await clickWithFallback(
                                        page,
                                        SELECTORS.messageSendButton,
                                        'messageSendButton',
                                        { timeoutPerSelector: 5000 },
                                    );
                                    autoReplySent = true;
                                    autoRepliesSent += 1;
                                    await storeMessageHash(lead.id, replyHash);
                                } catch (autoReplyError: unknown) {
                                    await logWarn('inbox.auto_reply_failed', {
                                        accountId: payload.accountId,
                                        leadId: lead.id,
                                        error:
                                            autoReplyError instanceof Error
                                                ? autoReplyError.message
                                                : String(autoReplyError),
                                    });
                                }
                            }

                            await appendLeadReplyDraft(lead.id, {
                                draft: resolution.responseDraft,
                                confidence: resolution.confidence,
                                source: resolution.source,
                                intent: resolution.intent,
                                subIntent: resolution.subIntent,
                                entities: resolution.entities,
                                reasoning: resolution.reasoning,
                                autoReplySent,
                            });
                        }
                    }
                    await logInfo('inbox.analyzed_message', {
                        accountId: payload.accountId,
                        textExcerpt: rawText.substring(0, 30),
                        intent: resolution.intent,
                        confidence: resolution.confidence,
                        draftSource: resolution.source,
                        draftLength: resolution.responseDraft.length,
                        autoReplySent,
                        autoRepliesSent,
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
