import { Page } from 'playwright';
import { detectChallenge, humanDelay, humanMouseMove, humanType, simulateHumanReading } from '../browser';
import { transitionLead } from '../core/leadStateService';
import { getLeadById, incrementDailyStat, incrementListDailyStat } from '../core/repositories';
import { SELECTORS } from '../selectors';
import { InviteJobPayload, LeadRecord } from '../types/domain';
import { WorkerContext } from './context';
import { ChallengeDetectedError, RetryableWorkerError } from './errors';
import { isSalesNavigatorUrl } from '../linkedinUrl';
import { config } from '../config';
import { buildPersonalizedInviteNote } from '../ai/inviteNotePersonalizer';
import { pauseAutomation } from '../risk/incidentManager';

async function clickConnectOnProfile(page: Page): Promise<boolean> {
    const primaryBtn = page.locator(SELECTORS.connectButtonPrimary).first();
    if (await primaryBtn.count() > 0) {
        await humanMouseMove(page, SELECTORS.connectButtonPrimary);
        await humanDelay(page, 120, 320);
        await primaryBtn.click();
        return true;
    }

    const moreBtn = page.locator(SELECTORS.moreActionsButton).first();
    if (await moreBtn.count() > 0) {
        await humanMouseMove(page, SELECTORS.moreActionsButton);
        await humanDelay(page, 120, 300);
        await moreBtn.click();
        await humanDelay(page, 700, 1300);
        const connectInMenu = page.locator(SELECTORS.connectInMoreMenu).first();
        if (await connectInMenu.count() > 0) {
            await humanMouseMove(page, SELECTORS.connectInMoreMenu);
            await humanDelay(page, 120, 300);
            await connectInMenu.click();
            return true;
        }
    }

    return false;
}

async function detectInviteProof(page: Page): Promise<boolean> {
    const pendingCount = await page.locator(SELECTORS.invitePendingIndicators).count();
    if (pendingCount > 0) {
        return true;
    }

    const pageText = await page.textContent('body').catch(() => '');
    if (!pageText) {
        return false;
    }
    return /invitation sent|in attesa|pending/i.test(pageText);
}

async function detectWeeklyInviteLimit(page: Page): Promise<boolean> {
    const selectorCount = await page.locator(SELECTORS.inviteWeeklyLimitSignals).count();
    if (selectorCount > 0) {
        return true;
    }

    const pageText = await page.textContent('body').catch(() => '');
    if (!pageText) {
        return false;
    }
    return /weekly invitation limit|limite settimanale(?: degli)? inviti|hai raggiunto il limite settimanale/i.test(pageText);
}

/**
 * Tenta di inviare l'invito con nota personalizzata (se INVITE_WITH_NOTE=true).
 * Flusso:
 *   1. Cerca il bottone "Add a note" nel modale
 *   2. Scrive la nota via humanType
 *   3. Clicca "Send" dal modale
 * Se il bottone "Add a note" non è presente, ricade su sendWithoutNote.
 * Ritorna se l'invio è avvenuto con nota e la source della nota (template/ai).
 */
async function handleInviteModal(
    page: Page,
    lead: LeadRecord,
    dryRun: boolean,
    localDate: string,
): Promise<{ sentWithNote: boolean; noteSource: 'template' | 'ai' | null }> {
    if (dryRun) return { sentWithNote: false, noteSource: null };

    // Controlla se c'è il bottone "Add a note" (con retry breve se il modale sta caricando)
    const addNoteBtn = page.locator(SELECTORS.addNoteButton).first();
    let canAddNote = await addNoteBtn.count() > 0;
    if (config.inviteWithNote && !canAddNote) {
        await page.waitForSelector(SELECTORS.addNoteButton, { timeout: 2000 }).catch(() => null);
        canAddNote = await addNoteBtn.count() > 0;
    }

    if (config.inviteWithNote && canAddNote) {
        await humanMouseMove(page, SELECTORS.addNoteButton);
        await humanDelay(page, 150, 350);
        await addNoteBtn.click();
        await humanDelay(page, 600, 1200);

        // Scrivi la nota nella textarea del modale
        const personalizedNote = await buildPersonalizedInviteNote(lead);
        const note = personalizedNote.note;
        const textarea = page.locator(SELECTORS.noteTextarea).first();
        if (await textarea.count() > 0) {
            await humanType(page, SELECTORS.noteTextarea, note);
            await humanDelay(page, 500, 1000);
        }

        // Clicca il tasto Send del modale
        const sendNoteBtn = page.locator(SELECTORS.sendWithNote).first();
        if (await sendNoteBtn.count() > 0) {
            await humanMouseMove(page, SELECTORS.sendWithNote);
            await humanDelay(page, 120, 320);
            await sendNoteBtn.click();
            return { sentWithNote: true, noteSource: personalizedNote.source };
        }

        // Se il bottone Send del modale non è trovato, è un errore bloccante
        await incrementDailyStat(localDate, 'selector_failures');
        throw new RetryableWorkerError('Send con nota non trovato nel modale', 'SEND_WITH_NOTE_NOT_FOUND');
    }

    // Fallback: invia senza nota
    const sendWithoutNote = page.locator(SELECTORS.sendWithoutNote).first();
    if (await sendWithoutNote.count() > 0) {
        await humanMouseMove(page, SELECTORS.sendWithoutNote);
        await humanDelay(page, 120, 300);
        await sendWithoutNote.click();
        return { sentWithNote: false, noteSource: null };
    }

    const fallback = page.locator(SELECTORS.sendFallback).first();
    if (await fallback.count() > 0) {
        await humanMouseMove(page, SELECTORS.sendFallback);
        await humanDelay(page, 120, 300);
        await fallback.click();
        return { sentWithNote: false, noteSource: null };
    }

    await incrementDailyStat(localDate, 'selector_failures');
    throw new RetryableWorkerError('Conferma invito senza nota non trovata', 'SEND_BUTTON_NOT_FOUND');
}

export async function processInviteJob(payload: InviteJobPayload, context: WorkerContext): Promise<void> {
    const lead = await getLeadById(payload.leadId);
    if (!lead) {
        throw new RetryableWorkerError(`Lead ${payload.leadId} non trovato`, 'LEAD_NOT_FOUND');
    }

    if (lead.status === 'NEW' || lead.status === 'PENDING') {
        await transitionLead(lead.id, 'READY_INVITE', 'new_lead_promoted');
    }

    if (lead.status !== 'READY_INVITE' && lead.status !== 'NEW' && lead.status !== 'PENDING') {
        return;
    }

    if (isSalesNavigatorUrl(lead.linkedin_url)) {
        await transitionLead(lead.id, 'BLOCKED', 'salesnav_url_requires_profile_invite');
        return;
    }

    await context.session.page.goto(lead.linkedin_url, { waitUntil: 'domcontentloaded' });
    await simulateHumanReading(context.session.page);

    if (await detectChallenge(context.session.page)) {
        throw new ChallengeDetectedError();
    }

    const connectClicked = await clickConnectOnProfile(context.session.page);
    if (!connectClicked) {
        await incrementDailyStat(context.localDate, 'selector_failures');
        await transitionLead(lead.id, 'SKIPPED', 'connect_not_found');
        return;
    }

    await humanDelay(context.session.page, 900, 1800);

    const inviteResult = await handleInviteModal(
        context.session.page,
        lead,
        context.dryRun,
        context.localDate,
    );

    if (!context.dryRun) {
        const weeklyLimitReached = await detectWeeklyInviteLimit(context.session.page);
        if (weeklyLimitReached) {
            await pauseAutomation(
                'WEEKLY_INVITE_LIMIT_REACHED',
                {
                    leadId: lead.id,
                    linkedinUrl: lead.linkedin_url,
                    accountId: context.accountId,
                },
                7 * 24 * 60
            );
            throw new RetryableWorkerError('Limite settimanale inviti raggiunto', 'WEEKLY_LIMIT_REACHED');
        }
    }

    await humanDelay(context.session.page, 1200, 2200);
    const proofOfSend = context.dryRun ? true : await detectInviteProof(context.session.page);
    if (!proofOfSend) {
        throw new RetryableWorkerError('Proof-of-send non rilevato', 'NO_PROOF_OF_SEND');
    }

    await transitionLead(lead.id, 'INVITED', context.dryRun ? 'invite_dry_run' : 'invite_sent', {
        dryRun: context.dryRun,
        withNote: inviteResult.sentWithNote,
        withNoteSource: inviteResult.noteSource,
    });
    await incrementDailyStat(context.localDate, 'invites_sent');
    await incrementListDailyStat(context.localDate, lead.list_name, 'invites_sent');
}
