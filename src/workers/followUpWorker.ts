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

import { detectChallenge, humanDelay, humanMouseMove, humanType, simulateHumanReading } from '../browser';
import { buildFollowUpReminderMessage } from '../ai/messagePersonalizer';
import { config } from '../config';
import { getLeadsForFollowUp, recordFollowUpSent, incrementDailyStat, countRecentMessageHash, storeMessageHash } from '../core/repositories';
import { joinSelectors } from '../selectors';
import { hashMessage, validateMessageContent } from '../validation/messageValidator';
import { logInfo, logWarn } from '../telemetry/logger';
import { LeadRecord } from '../types/domain';
import { WorkerContext } from './context';
import { ChallengeDetectedError, RetryableWorkerError } from './errors';
import { WorkerExecutionResult, workerResult } from './result';

/**
 * Calcola quanti giorni fa è avvenuto l'evento (dal timestamp ISO).
 */
function daysSince(iso: string | null | undefined): number {
    if (!iso) return 0;
    const diffMs = Date.now() - new Date(iso).getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
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
    context: WorkerContext
): Promise<boolean> {

    const days = daysSince(messagedAt);
    const { message, source } = await buildFollowUpReminderMessage(lead, days);

    // Validazione anti-duplicata
    const messageHash = hashMessage(message);
    const duplicateCount = await countRecentMessageHash(messageHash, 48);
    const validation = validateMessageContent(message, { duplicateCountLast24h: duplicateCount });
    if (!validation.valid) {
        await logWarn('follow_up.validation_failed', { leadId, reasons: validation.reasons });
        return false;
    }

    // Navigazione al profilo
    await context.session.page.goto(linkedinUrl, { waitUntil: 'domcontentloaded' });
    await humanDelay(context.session.page, 2500, 5000);
    await simulateHumanReading(context.session.page);

    if (await detectChallenge(context.session.page)) {
        throw new ChallengeDetectedError();
    }

    // Cerca bottone messaggio
    const msgBtn = context.session.page.locator(joinSelectors('messageButton')).first();
    if (await msgBtn.count() === 0) {
        await logWarn('follow_up.button_not_found', { leadId, url: linkedinUrl });
        return false;
    }

    await humanMouseMove(context.session.page, joinSelectors('messageButton'));
    await humanDelay(context.session.page, 120, 320);
    await msgBtn.click();
    await humanDelay(context.session.page, 1200, 2200);

    // Cerca textbox
    const textbox = context.session.page.locator(joinSelectors('messageTextbox')).first();
    if (await textbox.count() === 0) {
        await incrementDailyStat(context.localDate, 'selector_failures');
        throw new RetryableWorkerError('Textbox follow-up non trovata', 'TEXTBOX_NOT_FOUND');
    }

    await humanType(context.session.page, joinSelectors('messageTextbox'), message);
    await humanDelay(context.session.page, 800, 1600);

    if (!context.dryRun) {
        const sendBtn = context.session.page.locator(joinSelectors('messageSendButton')).first();
        if (await sendBtn.count() === 0 || (await sendBtn.isDisabled())) {
            await incrementDailyStat(context.localDate, 'selector_failures');
            throw new RetryableWorkerError('Bottone invio follow-up non disponibile', 'SEND_NOT_AVAILABLE');
        }
        await humanMouseMove(context.session.page, joinSelectors('messageSendButton'));
        await humanDelay(context.session.page, 100, 300);
        await sendBtn.click();

        // Persisti l'invio nel DB
        await recordFollowUpSent(leadId);
        await storeMessageHash(leadId, messageHash);
        await incrementDailyStat(context.localDate, 'follow_ups_sent');

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
export async function runFollowUpWorker(
    context: WorkerContext,
    dailySentSoFar = 0
): Promise<WorkerExecutionResult> {
    const delayDays = config.followUpDelayDays;
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
    const errors: Array<{ leadId: number; message: string }> = [];

    for (const lead of leads) {
        if (sent + dailySentSoFar >= dailyCap) break;

        try {
            const ok = await processSingleFollowUp(
                lead.id,
                lead.linkedin_url,
                lead,
                lead.messaged_at ?? null,
                context
            );
            if (ok) sent++;
        } catch (err: unknown) {
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

    await logInfo('follow_up.done', { sent, errors: errors.length, total: leads.length });
    return workerResult(sent, errors);
}
