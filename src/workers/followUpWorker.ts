/**
 * followUpWorker.ts — Follow-up automatico per lead senza risposta
 *
 * Logica:
 *   1. Query: lead MESSAGED da > FOLLOW_UP_DELAY_DAYS giorni con follow_up_count < FOLLOW_UP_MAX
 *   2. Genera reminder breve via buildFollowUpReminderMessage (AI o template)
 *   3. Invia il messaggio tramite Playwright (stessa logica messageWorker)
 *   4. Aggiorna follow_up_count++ e follow_up_sent_at nel DB
 *   5. Il lead rimane in stato MESSAGED (nessuna transizione di stato)
 *
 * Daily cap: max FOLLOW_UP_DAILY_CAP follow-up al giorno.
 * Dry-run: genera messaggio senza inviarlo.
 */

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
import { buildFollowUpReminderMessage } from '../ai/messagePersonalizer';
import { config } from '../config';
import {
    checkAndIncrementDailyLimit,
    getLeadIntent,
    getLeadsForFollowUp,
    recordFollowUpSent,
    incrementDailyStat,
    countRecentMessageHash,
    storeMessageHash,
    isLeadCampaignActive,
} from '../core/repositories';
import { joinSelectors, SELECTORS } from '../selectors';
import { hashMessage, validateMessageContent } from '../validation/messageValidator';
import { logInfo, logWarn } from '../telemetry/logger';
import { LeadRecord } from '../types/domain';
import { WorkerContext } from './context';
import { ChallengeDetectedError, RetryableWorkerError } from './errors';
import { WorkerExecutionResult, workerResult } from './result';
import { navigateToProfileForMessage } from '../browser/navigationContext';
import { observePageContext, logObservation } from '../browser/observePageContext';
import { aiDecide } from '../ai/aiDecisionEngine';

/**
 * Calcola quanti giorni fa è avvenuto l'evento (dal timestamp ISO).
 */
function daysSince(iso: string | null | undefined): number {
    if (!iso) return 0;
    const diffMs = Date.now() - new Date(iso).getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

interface LeadIntentHint {
    intent: string;
    subIntent: string;
    confidence: number;
    entities: string[];
}

interface FollowUpCadence {
    baseDelayDays: number;
    escalationMultiplier: number;
    jitterDays: number;
    requiredDelayDays: number;
    referenceDaysSince: number;
    referenceAt: string | null;
    reason: string;
}

function seededUnit(seed: number): number {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

/**
 * Tenta di inviare il follow-up a un singolo lead.
 * @returns true se inviato (o simulato in dry-run), false se saltato
 */
async function processSingleFollowUp(
    leadId: number,
    linkedinUrl: string,
    lead: LeadRecord,
    messagedAt: string | null,
    intentHint: LeadIntentHint | null,
    context: WorkerContext,
): Promise<boolean> {
    const days = daysSince(messagedAt);
    const { message, source } = await buildFollowUpReminderMessage(lead, days, {
        intent: intentHint?.intent ?? null,
        subIntent: intentHint?.subIntent ?? null,
        entities: intentHint?.entities ?? [],
    });

    // Validazione anti-duplicata
    const messageHash = hashMessage(message);
    const duplicateCount = await countRecentMessageHash(messageHash, 48);
    const validation = validateMessageContent(message, { duplicateCountLast24h: duplicateCount });
    if (!validation.valid) {
        await logWarn('follow_up.validation_failed', { leadId, reasons: validation.reasons });
        return false;
    }

    // C11: Navigazione al profilo con catena organica (era goto diretto — segnale detection #1).
    // navigateToProfileForMessage: 60% Feed→Profilo, 40% Diretto (con varianza notifiche).
    await navigateToProfileForMessage(context.session.page, linkedinUrl, context.accountId);
    await humanDelay(context.session.page, 2500, 5000);
    await simulateHumanReading(context.session.page);
    await contextualReadingPause(context.session.page);

    // R01+R02: OBSERVE page context + AI DECIDE prima dell'azione critica.
    // Il bot "guarda" la pagina (R01) e l'AI "decide" se procedere (R02).
    // Se AI non configurata → fallback meccanico PROCEED (zero regressione).
    const pageObs = await observePageContext(context.session.page);
    await logObservation(pageObs, { leadId, purpose: 'pre_follow_up' });

    // Gate bloccante: profilo eliminato/404 → skip follow-up
    if (pageObs.isProfileDeleted) {
        await logWarn('follow_up.profile_deleted_observed', { leadId, url: pageObs.currentUrl });
        const { transitionLead } = await import('../core/leadStateService');
        await transitionLead(leadId, 'REVIEW_REQUIRED', 'profile_deleted_observed');
        return false;
    }

    // AI Decision: l'AI decide SE inviare il follow-up
    const aiDecision = await aiDecide({
        point: 'pre_follow_up',
        lead: {
            id: leadId,
            name: `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || undefined,
            title: lead.job_title ?? undefined,
            company: lead.account_name ?? undefined,
        },
        pageObservation: pageObs,
    });

    if (aiDecision.action === 'SKIP') {
        await logInfo('follow_up.ai_skip', {
            leadId,
            reason: aiDecision.reason.substring(0, 80),
            confidence: aiDecision.confidence,
        });
        return false;
    }
    if (aiDecision.action === 'NOTIFY_HUMAN') {
        await logInfo('follow_up.ai_notify_human', { leadId, reason: aiDecision.reason.substring(0, 80) });
        const { transitionLead } = await import('../core/leadStateService');
        await transitionLead(leadId, 'REVIEW_REQUIRED', 'ai_notify_human');
        return false;
    }
    if (aiDecision.action === 'DEFER') {
        await logInfo('follow_up.ai_defer', { leadId, reason: aiDecision.reason.substring(0, 80) });
        return false;
    }
    // PROCEED: delay suggerito dall'AI
    if (aiDecision.suggestedDelaySec && aiDecision.suggestedDelaySec > 0) {
        await humanDelay(context.session.page, aiDecision.suggestedDelaySec * 1000, (aiDecision.suggestedDelaySec + 2) * 1000);
    }

    if (await detectChallenge(context.session.page)) {
        throw new ChallengeDetectedError();
    }

    // Chiudi overlay LinkedIn prima di cercare il bottone messaggio
    await dismissKnownOverlays(context.session.page);

    // Cerca bottone messaggio
    await humanMouseMove(context.session.page, joinSelectors('messageButton'));
    await humanDelay(context.session.page, 120, 320);
    const openedThread = await clickWithFallback(context.session.page, SELECTORS.messageButton, 'messageButton', {
        timeoutPerSelector: 5000,
        postClickDelayMs: 120,
        verify: async (activePage) => {
            await activePage.waitForSelector(joinSelectors('messageTextbox'), { timeout: 2500 });
            return true;
        },
    })
        .then(() => true)
        .catch(() => false);
    if (!openedThread) {
        await logWarn('follow_up.button_not_found', { leadId, url: linkedinUrl });
        return false;
    }
    await humanDelay(context.session.page, 1200, 2200);

    // GAP3-C06: Check in-browser — se l'ultimo messaggio nella chat NON è nostro,
    // il lead ha già risposto. Skip follow-up per evitare spam gravissimo.
    // Questo è il livello 1 (IMMEDIATO) del fix C06, complementare al filtro DB.
    try {
        const theirLastMsg = context.session.page
            .locator('.msg-s-message-list__event:not([data-msg-s-message-event-is-me="true"]) .msg-s-event-listitem__body')
            .last();
        if (await theirLastMsg.isVisible({ timeout: 1500 }).catch(() => false)) {
            const theirText = await theirLastMsg.innerText().catch(() => '');
            if (theirText && theirText.trim().length > 0) {
                // Verifica che il messaggio del lead sia PIÙ RECENTE dell'ultimo nostro
                const ourLastMsg = context.session.page
                    .locator('.msg-s-message-list__event[data-msg-s-message-event-is-me="true"] .msg-s-event-listitem__body')
                    .last();
                const ourText = await ourLastMsg.innerText().catch(() => '');
                // Se il lead ha scritto E il suo messaggio è l'ultimo visibile → ha risposto
                const theirMsgIndex = await theirLastMsg.evaluate((el) => {
                    const parent = el.closest('.msg-s-message-list__event');
                    return parent ? Array.from(parent.parentElement?.children ?? []).indexOf(parent) : -1;
                }).catch(() => -1);
                const ourMsgIndex = ourText ? await ourLastMsg.evaluate((el) => {
                    const parent = el.closest('.msg-s-message-list__event');
                    return parent ? Array.from(parent.parentElement?.children ?? []).indexOf(parent) : -1;
                }).catch(() => -1) : -1;

                if (theirMsgIndex > ourMsgIndex) {
                    await logInfo('follow_up.reply_detected_in_chat', {
                        leadId,
                        textExcerpt: theirText.trim().substring(0, 50),
                    });
                    // Transiziona il lead a REPLIED — il follow-up non serve
                    const { transitionLead } = await import('../core/leadStateService');
                    await transitionLead(leadId, 'REPLIED', 'follow_up_reply_in_chat');
                    return false;
                }
            }
        }
    } catch {
        // Check non bloccante: se fallisce, procedi con il follow-up
    }

    await typeWithFallback(context.session.page, SELECTORS.messageTextbox, message, 'messageTextbox').catch(
        async () => {
            await incrementDailyStat(context.localDate, 'selector_failures');
            throw new RetryableWorkerError('Textbox follow-up non trovata', 'TEXTBOX_NOT_FOUND');
        },
    );
    await humanDelay(context.session.page, 800, 1600);

    if (!context.dryRun) {
        // Atomic daily cap check: incrementa follow_ups_sent solo se sotto il limite
        const withinCap = await checkAndIncrementDailyLimit(context.localDate, 'follow_ups_sent', config.followUpDailyCap);
        if (!withinCap) {
            await logInfo('follow_up.daily_cap_atomic', { leadId, cap: config.followUpDailyCap });
            return false;
        }

        const sendBtn = context.session.page.locator(joinSelectors('messageSendButton')).first();
        if ((await sendBtn.count()) === 0 || (await sendBtn.isDisabled())) {
            await incrementDailyStat(context.localDate, 'selector_failures');
            throw new RetryableWorkerError('Bottone invio follow-up non disponibile', 'SEND_NOT_AVAILABLE');
        }
        await humanMouseMove(context.session.page, joinSelectors('messageSendButton'));
        await humanDelay(context.session.page, 100, 300);
        await clickWithFallback(context.session.page, SELECTORS.messageSendButton, 'messageSendButton').catch(
            async () => {
                await incrementDailyStat(context.localDate, 'selector_failures');
                throw new RetryableWorkerError('Bottone invio follow-up non disponibile', 'SEND_NOT_AVAILABLE');
            },
        );

        // Persisti l'invio nel DB
        await recordFollowUpSent(leadId);
        await storeMessageHash(leadId, messageHash);
        // follow_ups_sent already incremented atomically by checkAndIncrementDailyLimit

        await logInfo('follow_up.sent', { leadId, source, daysSince: days, messageLength: message.length });
    } else {
        await logInfo('follow_up.dry_run', { leadId, source, daysSince: days, message: message.substring(0, 60) });
    }

    return true;
}

/**
 * Worker principale del follow-up. Chiamato dall'orchestrator.
 *
 * @param context - WorkerContext con session Playwright
 * @param dailySentSoFar - follow-up già inviati oggi (per rispettare il daily cap)
 * @returns risultato standardizzato della run corrente
 */
export async function runFollowUpWorker(context: WorkerContext, dailySentSoFar = 0): Promise<WorkerExecutionResult> {
    const delayDays = Math.max(
        1,
        Math.min(
            config.followUpDelayDays,
            config.followUpQuestionsDelayDays,
            config.followUpNegativeDelayDays,
            config.followUpNotInterestedDelayDays,
        ),
    );
    const maxFollowUp = config.followUpMax;
    const dailyCap = config.followUpDailyCap;
    const remaining = dailyCap - dailySentSoFar;

    if (remaining <= 0) {
        await logInfo('follow_up.daily_cap_reached', { dailyCap, dailySentSoFar });
        return workerResult(0);
    }

    await logInfo('follow_up.start', { delayDays, maxFollowUp, remaining });

    const leads = await getLeadsForFollowUp(delayDays, maxFollowUp, remaining);

    if (leads.length === 0) {
        await logInfo('follow_up.no_eligible_leads', { delayDays, maxFollowUp });
        return workerResult(0);
    }

    let sent = 0;
    let attempted = 0;
    const errors: Array<{ leadId: number; message: string }> = [];

    for (const lead of leads) {
        if (sent + dailySentSoFar >= dailyCap) break;

        try {
            // H14: Verifica che la campagna drip del lead sia attiva.
            // Se l'utente ha disattivato la campagna, il follow-up non deve partire.
            const campaignActive = await isLeadCampaignActive(lead.id);
            if (!campaignActive) {
                await logInfo('follow_up.skipped_campaign_inactive', { leadId: lead.id });
                continue;
            }

            const intentHint = await getLeadIntent(lead.id);
            const cadence = resolveFollowUpCadence(lead, intentHint);
            if (cadence.referenceDaysSince < cadence.requiredDelayDays) {
                await logInfo('follow_up.skipped_not_due', {
                    leadId: lead.id,
                    intent: intentHint?.intent ?? 'UNKNOWN',
                    subIntent: intentHint?.subIntent ?? 'NONE',
                    daysSinceReference: cadence.referenceDaysSince,
                    requiredDelayDays: cadence.requiredDelayDays,
                    baseDelayDays: cadence.baseDelayDays,
                    escalationMultiplier: cadence.escalationMultiplier,
                    jitterDays: cadence.jitterDays,
                    reason: cadence.reason,
                    referenceAt: cadence.referenceAt,
                    followUpCount: lead.follow_up_count ?? 0,
                });
                continue;
            }
            attempted += 1;
            const ok = await processSingleFollowUp(
                lead.id,
                lead.linkedin_url,
                lead,
                lead.messaged_at ?? null,
                intentHint,
                context,
            );
            if (ok) sent++;
        } catch (err: unknown) {
            if (err instanceof ChallengeDetectedError) {
                await logWarn('follow_up.challenge_detected', { leadId: lead.id });
                throw err;
            }
            const message = err instanceof Error ? err.message : String(err);
            errors.push({ leadId: lead.id, message });
            await logWarn('follow_up.error', {
                leadId: lead.id,
                error: message,
            });
            // Non throwja — il ciclo continua con il lead successivo
        }

        // Pausa umana tra un profilo e l'altro
        await humanDelay(context.session.page, 4000, 8000);
    }

    await logInfo('follow_up.done', { sent, attempted, errors: errors.length, total: leads.length });
    return workerResult(attempted, errors);
}

function resolveIntentBaseDelayDays(
    intent: string | null | undefined,
    subIntent: string | null | undefined,
): { baseDelayDays: number; reason: string } {
    const normalizedIntent = (intent ?? '').toUpperCase();
    const normalizedSubIntent = (subIntent ?? '').toUpperCase();

    if (normalizedIntent === 'NOT_INTERESTED') {
        return { baseDelayDays: config.followUpNotInterestedDelayDays, reason: 'intent_not_interested' };
    }

    if (normalizedIntent === 'NEGATIVE') {
        if (normalizedSubIntent === 'OBJECTION_HANDLING') {
            const objectionDelay = Math.max(
                config.followUpQuestionsDelayDays,
                Math.floor((config.followUpNegativeDelayDays + config.followUpQuestionsDelayDays) / 2),
            );
            return { baseDelayDays: objectionDelay, reason: 'intent_negative_objection' };
        }
        return { baseDelayDays: config.followUpNegativeDelayDays, reason: 'intent_negative' };
    }

    if (normalizedIntent === 'QUESTIONS') {
        return { baseDelayDays: config.followUpQuestionsDelayDays, reason: 'intent_questions' };
    }

    if (
        normalizedSubIntent === 'CALL_REQUESTED' ||
        normalizedSubIntent === 'REFERRAL' ||
        normalizedSubIntent === 'PRICE_INQUIRY'
    ) {
        return {
            baseDelayDays: Math.max(1, Math.min(config.followUpQuestionsDelayDays, config.followUpDelayDays)),
            reason: `sub_intent_${normalizedSubIntent.toLowerCase()}`,
        };
    }

    return { baseDelayDays: config.followUpDelayDays, reason: 'intent_default' };
}

/**
 * M29: Cadenza semplificata — delay lineare per follow-up number + jitter 0-1 giorno.
 *
 * Prima: baseDelay × escalationMultiplier + deterministicGaussian (FNV-1a + Box-Muller).
 * Impossibile da debuggare — servivano 20 min per spiegare perché un follow-up non era partito.
 *
 * Ora: baseDelay (intent-based, invariato) + (followUpCount × followUpDelayDays) + jitter 0-1 giorno.
 * Esempio con baseDelay=5, followUpDelayDays=5:
 *   Follow-up #1: 5 + 0×5 + jitter = 5-6 giorni dopo il messaggio
 *   Follow-up #2: 5 + 1×5 + jitter = 10-11 giorni dopo il follow-up #1
 *   Follow-up #3: 5 + 2×5 + jitter = 15-16 giorni dopo il follow-up #2
 *
 * Il jitter è deterministico per leadId (stabile cross-riavvii) ma semplice:
 * hash del leadId → 0.0-1.0 giorni.
 */
export function resolveFollowUpCadence(
    lead: Pick<LeadRecord, 'id' | 'messaged_at' | 'follow_up_sent_at' | 'follow_up_count'>,
    intentHint: LeadIntentHint | null,
): FollowUpCadence {
    const baseDelay = resolveIntentBaseDelayDays(intentHint?.intent, intentHint?.subIntent);
    const followUpCount = Math.max(0, lead.follow_up_count ?? 0);

    // Cadenza lineare: base + (count × step) — chiara, prevedibile, debuggabile
    const stepDelay = followUpCount * config.followUpDelayDays;
    const totalDelay = baseDelay.baseDelayDays + stepDelay;

    // Jitter deterministico semplice: hash del leadId → 0.0-1.0 giorni
    const jitterDays = Math.round(seededUnit(lead.id * 7 + followUpCount * 13));
    const requiredDelayDays = Math.max(1, totalDelay + jitterDays);

    const referenceAt = lead.follow_up_sent_at ?? lead.messaged_at ?? null;
    const referenceDaysSince = daysSince(referenceAt);

    return {
        baseDelayDays: baseDelay.baseDelayDays,
        escalationMultiplier: 1 + followUpCount, // per retrocompatibilità log
        jitterDays,
        requiredDelayDays,
        referenceDaysSince,
        referenceAt,
        reason: baseDelay.reason,
    };
}
