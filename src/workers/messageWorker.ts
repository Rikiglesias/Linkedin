import { detectChallenge, humanDelay, humanMouseMove, humanType, simulateHumanReading } from '../browser';
import { transitionLead } from '../core/leadStateService';
import { countRecentMessageHash, getLeadById, incrementDailyStat, incrementListDailyStat, storeMessageHash } from '../core/repositories';
import { SELECTORS } from '../selectors';
import { MessageJobPayload } from '../types/domain';
import { hashMessage, validateMessageContent } from '../validation/messageValidator';
import { WorkerContext } from './context';
import { ChallengeDetectedError, RetryableWorkerError } from './errors';
import { isSalesNavigatorUrl } from '../linkedinUrl';
import { buildPersonalizedFollowUpMessage } from '../ai/messagePersonalizer';
import { logInfo } from '../telemetry/logger';

export async function processMessageJob(payload: MessageJobPayload, context: WorkerContext): Promise<void> {
    const lead = await getLeadById(payload.leadId);
    if (!lead || lead.status !== 'READY_MESSAGE') {
        return;
    }

    if (isSalesNavigatorUrl(lead.linkedin_url)) {
        await transitionLead(lead.id, 'BLOCKED', 'salesnav_url_requires_profile_message');
        return;
    }

    const personalized = await buildPersonalizedFollowUpMessage(lead);
    const message = personalized.message;
    const messageHash = hashMessage(message);
    const duplicateCount = await countRecentMessageHash(messageHash, 24);
    const validation = validateMessageContent(message, { duplicateCountLast24h: duplicateCount });
    if (!validation.valid) {
        await transitionLead(lead.id, 'BLOCKED', 'message_validation_failed', {
            reasons: validation.reasons,
        });
        return;
    }

    await context.session.page.goto(lead.linkedin_url, { waitUntil: 'domcontentloaded' });
    await humanDelay(context.session.page, 2500, 5000);
    await simulateHumanReading(context.session.page);

    if (await detectChallenge(context.session.page)) {
        throw new ChallengeDetectedError();
    }

    const msgBtn = context.session.page.locator(SELECTORS.messageButton).first();
    if (await msgBtn.count() === 0) {
        throw new RetryableWorkerError('Bottone messaggio non trovato', 'MESSAGE_BUTTON_NOT_FOUND');
    }

    await humanMouseMove(context.session.page, SELECTORS.messageButton);
    await humanDelay(context.session.page, 120, 320);
    await msgBtn.click();
    await humanDelay(context.session.page, 1200, 2200);

    const textbox = context.session.page.locator(SELECTORS.messageTextbox).first();
    if (await textbox.count() === 0) {
        await incrementDailyStat(context.localDate, 'selector_failures');
        throw new RetryableWorkerError('Textbox messaggio non trovata', 'TEXTBOX_NOT_FOUND');
    }
    await humanType(context.session.page, SELECTORS.messageTextbox, message);
    await humanDelay(context.session.page, 800, 1600);

    if (!context.dryRun) {
        const sendBtn = context.session.page.locator(SELECTORS.messageSendButton).first();
        if (await sendBtn.count() === 0 || (await sendBtn.isDisabled())) {
            await incrementDailyStat(context.localDate, 'selector_failures');
            throw new RetryableWorkerError('Bottone invio non disponibile', 'SEND_NOT_AVAILABLE');
        }
        await humanMouseMove(context.session.page, SELECTORS.messageSendButton);
        await humanDelay(context.session.page, 100, 300);
        await sendBtn.click();
    }

    await transitionLead(lead.id, 'MESSAGED', context.dryRun ? 'message_dry_run' : 'message_sent');
    await logInfo('message.generated', {
        leadId: lead.id,
        source: personalized.source,
        model: personalized.model,
        messageLength: message.length,
    });
    await storeMessageHash(lead.id, messageHash);
    await incrementDailyStat(context.localDate, 'messages_sent');
    await incrementListDailyStat(context.localDate, lead.list_name, 'messages_sent');
}
