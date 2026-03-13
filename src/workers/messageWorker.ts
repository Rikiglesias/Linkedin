import {
    clickWithFallback,
    contextualReadingPause,
    detectChallenge,
    dismissKnownOverlays,
    humanDelay,
    humanMouseMove,
    simulateHumanReading,
    typeWithFallback,
} from '../browser';
import { transitionLead } from '../core/leadStateService';
import { isBlacklisted } from '../core/repositories/blacklist';
import {
    checkAndIncrementDailyLimit,
    countRecentMessageHash,
    getDailyStat,
    getLeadById,
    incrementDailyStat,
    incrementListDailyStat,
    recordLeadTimingAttribution,
    storeMessageHash,
} from '../core/repositories';
import { config } from '../config';
import { joinSelectors, SELECTORS } from '../selectors';
import { MessageJobPayload } from '../types/domain';
import { hashMessage, validateMessageContent } from '../validation/messageValidator';
import { WorkerContext } from './context';
import { ChallengeDetectedError, RetryableWorkerError } from './errors';
import { attemptChallengeResolution } from './challengeHandler';
import { isSalesNavigatorUrl } from '../linkedinUrl';
import { buildPersonalizedFollowUpMessage } from '../ai/messagePersonalizer';
import { getUnusedPrebuiltMessage, markPrebuiltMessageUsed } from '../core/repositories/prebuiltMessages';
import { logInfo } from '../telemetry/logger';
import { bridgeDailyStat, bridgeLeadStatus } from '../cloud/cloudBridge';
import { WorkerExecutionResult, workerResult } from './result';
import { inferLeadSegment } from '../ml/segments';

export async function processMessageJob(
    payload: MessageJobPayload,
    context: WorkerContext,
): Promise<WorkerExecutionResult> {
    const lead = await getLeadById(payload.leadId);

    const isCampaignDriven = !!payload.campaignStateId;
    if (!lead || (!isCampaignDriven && lead.status !== 'READY_MESSAGE')) {
        return workerResult(0);
    }

    // Check blacklist runtime: il lead potrebbe essere stato aggiunto alla blacklist
    // DOPO la creazione del job nello scheduler (ore/giorni prima).
    if (await isBlacklisted(lead.linkedin_url, lead.company_domain)) {
        return workerResult(0);
    }

    if (isSalesNavigatorUrl(lead.linkedin_url)) {
        await transitionLead(lead.id, 'BLOCKED', 'salesnav_url_requires_profile_message');
        return workerResult(1);
    }

    // Pre-flight cap check (read-only): evita navigazione + typing se il cap è già raggiunto
    if (!context.dryRun) {
        const currentMessages = await getDailyStat(context.localDate, 'messages_sent');
        if (currentMessages >= config.hardMsgCap) {
            await logInfo('message.daily_cap_reached', { leadId: lead.id, cap: config.hardMsgCap });
            return workerResult(0);
        }
    }

    let message = '';
    let messageSource: 'template' | 'ai' = 'ai';
    let messageModel: string | null = null;

    let lang: string | undefined;
    if (payload.metadata_json) {
        try {
            const meta = JSON.parse(payload.metadata_json);
            if (isCampaignDriven && meta.message) {
                message = meta.message;
                messageSource = 'template';
            }
            if (meta.lang) lang = meta.lang;
        } catch {
            // ignore JSON parse error in metadata
        }
    }

    if (!message) {
        // Cerca prima un messaggio pre-built (generato offline in batch — zero latenza AI)
        const prebuilt = await getUnusedPrebuiltMessage(lead.id);
        if (prebuilt) {
            message = prebuilt.message;
            messageSource = prebuilt.source as 'template' | 'ai';
            messageModel = prebuilt.model;
            await markPrebuiltMessageUsed(prebuilt.id);
            await logInfo('message.used_prebuilt', { leadId: lead.id, prebuiltId: prebuilt.id });
        } else {
            // Fallback: generazione on-the-fly (aggiunge ~2-5s di latenza AI)
            const personalized = await buildPersonalizedFollowUpMessage(lead, lang);
            message = personalized.message;
            messageSource = personalized.source as 'template' | 'ai';
            messageModel = personalized.model;
        }
    }

    const messageHash = hashMessage(message);
    const duplicateCount = await countRecentMessageHash(messageHash, 24);
    const validation = validateMessageContent(message, { duplicateCountLast24h: duplicateCount });
    if (!validation.valid) {
        await transitionLead(lead.id, 'BLOCKED', 'message_validation_failed', {
            reasons: validation.reasons,
            source: messageSource,
        });
        return workerResult(1, [
            {
                leadId: lead.id,
                message: `message_validation_failed:${validation.reasons.join(',')}`,
            },
        ]);
    }

    await context.session.page.goto(lead.linkedin_url, { waitUntil: 'domcontentloaded' });
    await humanDelay(context.session.page, 2500, 5000);
    await simulateHumanReading(context.session.page);
    await contextualReadingPause(context.session.page);

    if (await detectChallenge(context.session.page)) {
        const resolved = await attemptChallengeResolution(context.session.page);
        if (!resolved) {
            throw new ChallengeDetectedError();
        }
    }

    // Chiudi overlay LinkedIn prima di cercare il bottone messaggio
    await dismissKnownOverlays(context.session.page);

    await humanMouseMove(context.session.page, joinSelectors('messageButton'));
    await humanDelay(context.session.page, 120, 320);
    await clickWithFallback(context.session.page, SELECTORS.messageButton, 'messageButton', {
        timeoutPerSelector: 5000,
        postClickDelayMs: 120,
    }).catch(() => {
        throw new RetryableWorkerError('Bottone messaggio non trovato', 'MESSAGE_BUTTON_NOT_FOUND');
    });
    await context.session.page
        .waitForSelector(joinSelectors('messageTextbox'), { timeout: 2500 })
        .catch(() => {
            throw new RetryableWorkerError('Textbox messaggio non apparsa dopo click', 'TEXTBOX_NOT_FOUND');
        });
    await humanDelay(context.session.page, 1200, 2200);

    await typeWithFallback(context.session.page, SELECTORS.messageTextbox, message, 'messageTextbox', 5000).catch(
        async () => {
            await incrementDailyStat(context.localDate, 'selector_failures');
            throw new RetryableWorkerError('Textbox messaggio non trovata', 'TEXTBOX_NOT_FOUND');
        },
    );
    await humanDelay(context.session.page, 800, 1600);

    if (!context.dryRun) {
        // Atomic daily cap check: incrementa solo se sotto il limite
        const withinCap = await checkAndIncrementDailyLimit(context.localDate, 'messages_sent', config.hardMsgCap);
        if (!withinCap) {
            await logInfo('message.daily_cap_reached', { leadId: lead.id, cap: config.hardMsgCap });
            return workerResult(0);
        }

        // Se il click Send fallisce DOPO l'incremento atomico, compensiamo
        // decrementando la stat per evitare phantom increments (NEW-7 fix).
        try {
            const sendBtn = context.session.page.locator(joinSelectors('messageSendButton')).first();
            if ((await sendBtn.count()) === 0 || (await sendBtn.isDisabled())) {
                await incrementDailyStat(context.localDate, 'selector_failures');
                throw new RetryableWorkerError('Bottone invio non disponibile', 'SEND_NOT_AVAILABLE');
            }
            await humanMouseMove(context.session.page, joinSelectors('messageSendButton'));
            await humanDelay(context.session.page, 100, 300);
            await clickWithFallback(context.session.page, SELECTORS.messageSendButton, 'messageSendButton').catch(
                async () => {
                    await incrementDailyStat(context.localDate, 'selector_failures');
                    throw new RetryableWorkerError('Bottone invio non disponibile', 'SEND_NOT_AVAILABLE');
                },
            );
        } catch (sendError) {
            // Compensazione: decrementa messages_sent perché il messaggio NON è stato inviato
            await incrementDailyStat(context.localDate, 'messages_sent', -1).catch(() => {});
            throw sendError;
        }
    }

    await transitionLead(lead.id, 'MESSAGED', context.dryRun ? 'message_dry_run' : 'message_sent', {
        timing: payload.timing ?? null,
    });
    if (!context.dryRun) {
        await recordLeadTimingAttribution(lead.id, 'message', {
            strategy: payload.timing?.strategy === 'optimizer' ? 'optimizer' : 'baseline',
            segment: payload.timing?.segment ?? inferLeadSegment(lead.job_title),
            score: payload.timing?.score ?? 0,
            slotHour: payload.timing?.slotHour ?? null,
            slotDow: payload.timing?.slotDow ?? null,
            delaySec: payload.timing?.delaySec ?? 0,
            model: payload.timing?.model ?? 'timing_optimizer_v2',
        });
    }
    await logInfo('message.generated', {
        leadId: lead.id,
        source: messageSource,
        model: messageModel,
        messageLength: message.length,
        isCampaignDriven,
    });
    await storeMessageHash(lead.id, messageHash);
    // messages_sent already incremented atomically by checkAndIncrementDailyLimit (non dry-run)
    if (context.dryRun) {
        await incrementDailyStat(context.localDate, 'messages_sent');
    }
    await incrementListDailyStat(context.localDate, lead.list_name, 'messages_sent');
    // Cloud sync non-bloccante
    bridgeLeadStatus(lead.linkedin_url, 'MESSAGED', { messaged_at: new Date().toISOString() });
    bridgeDailyStat(context.localDate, context.accountId, 'messages_sent');
    return workerResult(1);
}
