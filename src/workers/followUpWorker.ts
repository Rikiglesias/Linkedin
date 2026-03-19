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
} from '../core/repositories';
import { joinSelectors, SELECTORS } from '../selectors';
import { hashMessage, validateMessageContent } from '../validation/messageValidator';
import { logInfo, logWarn } from '../telemetry/logger';
import { LeadRecord } from '../types/domain';
import { WorkerContext } from './context';
import { ChallengeDetectedError, RetryableWorkerError } from './errors';
import { WorkerExecutionResult, workerResult } from './result';
import { navigateToProfileForMessage } from '../browser/navigationContext';

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

function deterministicGaussian(leadId: number, followUpCount: number, intent: string, subIntent: string): number {
    const salt = `${leadId}|${followUpCount}|${intent}|${subIntent}`;
    let hash = 2166136261;
    for (let i = 0; i < salt.length; i++) {
        hash ^= salt.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    const seedBase = Math.abs(hash >>> 0) + 1;
    const u1 = Math.max(0.000001, seededUnit(seedBase + 17));
    const u2 = Math.max(0.000001, seededUnit(seedBase + 97));
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(-2.5, Math.min(2.5, z));
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

export function resolveFollowUpCadence(
    lead: Pick<LeadRecord, 'id' | 'messaged_at' | 'follow_up_sent_at' | 'follow_up_count'>,
    intentHint: LeadIntentHint | null,
): FollowUpCadence {
    const baseDelay = resolveIntentBaseDelayDays(intentHint?.intent, intentHint?.subIntent);
    const followUpCount = Math.max(0, lead.follow_up_count ?? 0);
    const escalationMultiplier = 1 + followUpCount * config.followUpDelayEscalationFactor;
    const escalatedDelay = Math.max(1, Math.round(baseDelay.baseDelayDays * escalationMultiplier));

    const gaussian = deterministicGaussian(
        lead.id,
        followUpCount,
        intentHint?.intent ?? 'UNKNOWN',
        intentHint?.subIntent ?? 'NONE',
    );
    const jitterDays = Math.round(gaussian * config.followUpDelayStddevDays);
    const requiredDelayDays = Math.max(1, escalatedDelay + jitterDays);
    const referenceAt = lead.follow_up_sent_at ?? lead.messaged_at ?? null;
    const referenceDaysSince = daysSince(referenceAt);

    return {
        baseDelayDays: baseDelay.baseDelayDays,
        escalationMultiplier,
        jitterDays,
        requiredDelayDays,
        referenceDaysSince,
        referenceAt,
        reason: baseDelay.reason,
    };
}
