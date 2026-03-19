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
import { isLoggedIn } from '../browser/auth';
import { navigateToProfileForMessage } from '../browser/navigationContext';
import { ensureViewportDwell } from '../browser/humanBehavior';
import { buildPersonalizedFollowUpMessage } from '../ai/messagePersonalizer';
import { getUnusedPrebuiltMessage, markPrebuiltMessageUsed } from '../core/repositories/prebuiltMessages';
import { logInfo, logWarn } from '../telemetry/logger';
import { normalizeNameForComparison, jaroWinklerSimilarity } from '../utils/text';
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

    // C10: SalesNav URL → REVIEW_REQUIRED (era BLOCKED = dead-end irrecuperabile)
    if (isSalesNavigatorUrl(lead.linkedin_url)) {
        await transitionLead(lead.id, 'REVIEW_REQUIRED', 'salesnav_url_needs_resolution');
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
    let forceTemplate = false;
    if (payload.metadata_json) {
        try {
            const meta = JSON.parse(payload.metadata_json);
            if (isCampaignDriven && meta.message) {
                message = meta.message;
                messageSource = 'template';
            }
            if (meta.lang) lang = meta.lang;
            if (meta.messageMode === 'template') forceTemplate = true;
        } catch {
            // ignore JSON parse error in metadata
        }
    }

    if (!message) {
        if (forceTemplate) {
            // L'utente ha scelto 'template' nel preflight — usa solo il template, niente AI
            const { buildFollowUpMessage } = await import('../messages');
            message = buildFollowUpMessage(lead);
            messageSource = 'template';
            messageModel = null;
        } else {
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

    // Navigation Context Chain (1.2): catena di navigazione realistica
    // invece di goto diretto al profilo (segnale detection #1).
    await navigateToProfileForMessage(
        context.session.page,
        lead.linkedin_url,
        context.accountId,
    );
    await humanDelay(context.session.page, 2500, 5000);
    await simulateHumanReading(context.session.page);
    await contextualReadingPause(context.session.page);

    // GAP2-C04: Identity check — verifica che il profilo corrisponda al lead target.
    try {
        const h1Element = context.session.page.locator('h1').first();
        const h1Text = await h1Element.textContent({ timeout: 3000 }).catch(() => null);
        if (h1Text) {
            const expectedName = normalizeNameForComparison(`${lead.first_name} ${lead.last_name}`);
            const actualName = normalizeNameForComparison(h1Text);
            if (expectedName && actualName) {
                const similarity = jaroWinklerSimilarity(expectedName, actualName);
                if (similarity < 0.75) {
                    await logWarn('message.identity_mismatch', {
                        leadId: lead.id,
                        expectedName,
                        actualName,
                        similarity: Number.parseFloat(similarity.toFixed(3)),
                    });
                    await transitionLead(lead.id, 'REVIEW_REQUIRED', 'identity_mismatch');
                    return workerResult(1);
                }
            }
        }
    } catch {
        // Identity check non bloccante
    }

    if (await detectChallenge(context.session.page)) {
        const resolved = await attemptChallengeResolution(context.session.page).catch(() => false);
        if (!resolved) {
            throw new ChallengeDetectedError();
        }
    }

    // Session validity check prima di azioni critiche (come inviteWorker).
    // Se il cookie è scaduto mid-session, la pagina redirige al login.
    // Detectare subito evita retry inutili su una pagina di login.
    if (!context.dryRun) {
        const stillLoggedIn = await isLoggedIn(context.session.page);
        if (!stillLoggedIn) {
            throw new RetryableWorkerError(
                'Sessione LinkedIn scaduta durante il flusso message — aborto per evitare retry su login page',
                'SESSION_EXPIRED',
            );
        }
    }

    // Chiudi overlay LinkedIn prima di cercare il bottone messaggio
    await dismissKnownOverlays(context.session.page);

    // Viewport Dwell Time (3.3): assicura che il bottone Message sia nel viewport
    // da almeno 800-2000ms prima del click — previene segnale click-before-visible.
    await ensureViewportDwell(context.session.page, joinSelectors('messageButton'));

    // Confidence check: verifica che il bottone contenga "Message"/"Messaggio" prima di cliccare
    const msgBtn = context.session.page.locator(joinSelectors('messageButton')).first();
    if ((await msgBtn.count()) > 0) {
        const btnText = await msgBtn.innerText().catch(() => '');
        if (!/message|messaggio|invia/i.test(btnText.trim())) {
            await logInfo('message.confidence_check_failed', {
                leadId: lead.id,
                buttonText: btnText.trim().substring(0, 40),
            });
            await incrementDailyStat(context.localDate, 'selector_failures');
            throw new RetryableWorkerError(
                `Confidence check FAILED: bottone dice "${btnText.trim().substring(0, 40)}"`,
                'MESSAGE_BUTTON_NOT_FOUND',
            );
        }
    }

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

    // C07: Check se il lead ha GIÀ scritto nella chat prima di inviare il primo messaggio.
    // Senza questo check, il bot potrebbe inviare un messaggio freddo a qualcuno che ci ha già contattato.
    // Legge l'ultimo messaggio non-nostro nella conversazione aperta.
    try {
        const theirLastMsg = context.session.page
            .locator('.msg-s-message-list__event:not([data-msg-s-message-event-is-me="true"]) .msg-s-event-listitem__body')
            .last();
        if (await theirLastMsg.isVisible({ timeout: 1500 }).catch(() => false)) {
            const theirText = await theirLastMsg.innerText().catch(() => '');
            if (theirText && theirText.trim().length > 0) {
                await logInfo('message.existing_reply_detected', {
                    leadId: lead.id,
                    textExcerpt: theirText.trim().substring(0, 50),
                });
                await transitionLead(lead.id, 'REPLIED', 'existing_reply_in_chat');
                return workerResult(1);
            }
        }
    } catch {
        // Check non bloccante: se fallisce, procedi con l'invio
    }

    await typeWithFallback(context.session.page, SELECTORS.messageTextbox, message, 'messageTextbox', 5000).catch(
        async () => {
            await incrementDailyStat(context.localDate, 'selector_failures');
            throw new RetryableWorkerError('Textbox messaggio non trovata', 'TEXTBOX_NOT_FOUND');
        },
    );
    await humanDelay(context.session.page, 800, 1600);

    // H11: Verifica che il contenuto digitato nel textbox corrisponda al messaggio atteso.
    // Se typing in campo sbagliato o il testo è stato troncato, il contenuto è diverso o vuoto.
    try {
        const textboxContent = await context.session.page
            .locator(joinSelectors('messageTextbox')).first()
            .inputValue({ timeout: 2000 })
            .catch(() => '');
        const typed = textboxContent.trim();
        const expected = message.trim();
        if (typed.length < expected.length * 0.5) {
            await logInfo('message.content_verification_failed', {
                leadId: lead.id,
                expectedLength: expected.length,
                typedLength: typed.length,
            });
            throw new RetryableWorkerError(
                `Contenuto textbox (${typed.length} chars) < 50% del messaggio atteso (${expected.length} chars)`,
                'MESSAGE_CONTENT_MISMATCH',
            );
        }
    } catch (verifyError) {
        if (verifyError instanceof RetryableWorkerError) throw verifyError;
        // Verifica non bloccante se fallisce per altri motivi (es. locator non trovato)
    }

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
