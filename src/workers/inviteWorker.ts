import { Page } from 'playwright';
import { detectChallenge, humanDelay, humanMouseMove, humanType, simulateHumanReading } from '../browser';
import { transitionLead } from '../core/leadStateService';
import { getLeadById, incrementDailyStat, incrementListDailyStat, updateLeadScrapedContext, updateLeadPromptVariant } from '../core/repositories';
import { joinSelectors } from '../selectors';
import { InviteJobPayload, LeadRecord } from '../types/domain';
import { WorkerContext } from './context';
import { ChallengeDetectedError, RetryableWorkerError } from './errors';
import { isSalesNavigatorUrl } from '../linkedinUrl';
import { config } from '../config';
import { buildPersonalizedInviteNote } from '../ai/inviteNotePersonalizer';
import { pauseAutomation } from '../risk/incidentManager';
import { bridgeDailyStat, bridgeLeadStatus } from '../cloud/cloudBridge';
import { selectVariant, recordSent } from '../ml/abBandit';
import { WorkerExecutionResult, workerResult } from './result';

async function clickConnectOnProfile(page: Page): Promise<boolean> {
    const primaryBtn = page.locator(joinSelectors('connectButtonPrimary')).first();
    if (await primaryBtn.count() > 0) {
        await humanMouseMove(page, joinSelectors('connectButtonPrimary'));
        await humanDelay(page, 120, 320);
        await primaryBtn.click();
        return true;
    }

    const moreBtn = page.locator(joinSelectors('moreActionsButton')).first();
    if (await moreBtn.count() > 0) {
        await humanMouseMove(page, joinSelectors('moreActionsButton'));
        await humanDelay(page, 120, 300);
        await moreBtn.click();
        await humanDelay(page, 700, 1300);
        const connectInMenu = page.locator(joinSelectors('connectInMoreMenu')).first();
        if (await connectInMenu.count() > 0) {
            await humanMouseMove(page, joinSelectors('connectInMoreMenu'));
            await humanDelay(page, 120, 300);
            await connectInMenu.click();
            return true;
        }
    }

    return false;
}

async function detectInviteProof(page: Page): Promise<boolean> {
    const pendingCount = await page.locator(joinSelectors('invitePendingIndicators')).count();
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
    const selectorCount = await page.locator(joinSelectors('inviteWeeklyLimitSignals')).count();
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
): Promise<{ sentWithNote: boolean; noteSource: 'template' | 'ai' | null; variant?: string | null }> {
    if (dryRun) return { sentWithNote: false, noteSource: null, variant: null };

    // Controlla se c'è il bottone "Add a note" (con retry breve se il modale sta caricando)
    const addNoteBtn = page.locator(joinSelectors('addNoteButton')).first();
    let canAddNote = await addNoteBtn.count() > 0;
    if (config.inviteWithNote && !canAddNote) {
        await page.waitForSelector(joinSelectors('addNoteButton'), { timeout: 2000 }).catch(() => null);
        canAddNote = await addNoteBtn.count() > 0;
    }

    if (config.inviteWithNote && canAddNote) {
        await humanMouseMove(page, joinSelectors('addNoteButton'));
        await humanDelay(page, 150, 350);
        await addNoteBtn.click();
        await humanDelay(page, 600, 1200);

        // Scrivi la nota nella textarea del modale
        const generatedNote = await buildPersonalizedInviteNote(lead);

        // A/B Bandit: se ci sono variants disponibili, sovrascrivi la variante col bandit
        if (generatedNote.variant) {
            const candidateVariants = [generatedNote.variant]; // estendibile con altre varianti in config
            const banditVariant = await selectVariant(candidateVariants).catch(() => generatedNote.variant);
            const resolvedVariant = banditVariant ?? generatedNote.variant;
            generatedNote.variant = resolvedVariant;
            await updateLeadPromptVariant(lead.id, resolvedVariant);
            lead.invite_prompt_variant = resolvedVariant;
            await recordSent(resolvedVariant).catch(() => { });
        }

        try {
            await humanType(page, joinSelectors('noteTextarea'), generatedNote.note);
        } catch {
            await incrementDailyStat(localDate, 'selector_failures');
            throw new RetryableWorkerError('Impossibile digitare la nota', 'TYPE_ERROR');
        }

        await humanDelay(page, 400, 800); // Changed from context.session.page to page

        const sendWithNote = page.locator(joinSelectors('sendWithNote')).first();
        if (await sendWithNote.count() > 0) {
            await humanMouseMove(page, joinSelectors('sendWithNote'));
            await humanDelay(page, 150, 400); // Changed from context.session.page to page

            if (!dryRun) { // Changed from context.dryRun to dryRun
                await sendWithNote.click();
            } else {
                console.log(`[DRY RUN] Inviato invito a ${lead.linkedin_url} (nota: ${generatedNote.source} - var: ${generatedNote.variant || 'none'})`);
            }

            return { sentWithNote: true, noteSource: generatedNote.source, variant: generatedNote.variant };
        }

        // Se il bottone Send del modale non è trovato, è un errore bloccante
        await incrementDailyStat(localDate, 'selector_failures');
        throw new RetryableWorkerError('Send con nota non trovato nel modale', 'SEND_WITH_NOTE_NOT_FOUND');
    }

    // Fallback: invia senza nota
    const sendWithoutNote = page.locator(joinSelectors('sendWithoutNote')).first();
    if (await sendWithoutNote.count() > 0) {
        await humanMouseMove(page, joinSelectors('sendWithoutNote'));
        await humanDelay(page, 120, 300);
        await sendWithoutNote.click();
        return { sentWithNote: false, noteSource: null, variant: null };
    }

    const fallback = page.locator(joinSelectors('sendFallback')).first();
    if (await fallback.count() > 0) {
        await humanMouseMove(page, joinSelectors('sendFallback'));
        await humanDelay(page, 120, 300);
        await fallback.click();
        return { sentWithNote: false, noteSource: null, variant: null };
    }

    await incrementDailyStat(localDate, 'selector_failures');
    throw new RetryableWorkerError('Conferma invito senza nota non trovata', 'SEND_BUTTON_NOT_FOUND');
}

export async function processInviteJob(payload: InviteJobPayload, context: WorkerContext): Promise<WorkerExecutionResult> {
    const lead = await getLeadById(payload.leadId);
    if (!lead) {
        throw new RetryableWorkerError(`Lead ${payload.leadId} non trovato`, 'LEAD_NOT_FOUND');
    }

    if (lead.status === 'NEW' || lead.status === 'PENDING') {
        await transitionLead(lead.id, 'READY_INVITE', 'new_lead_promoted');
    }

    if (lead.status !== 'READY_INVITE' && lead.status !== 'NEW' && lead.status !== 'PENDING') {
        return workerResult(0);
    }

    if (isSalesNavigatorUrl(lead.linkedin_url)) {
        await transitionLead(lead.id, 'BLOCKED', 'salesnav_url_requires_profile_invite');
        return workerResult(1);
    }

    await context.session.page.goto(lead.linkedin_url, { waitUntil: 'domcontentloaded' });
    await simulateHumanReading(context.session.page);

    if (await detectChallenge(context.session.page)) {
        throw new ChallengeDetectedError();
    }

    if (config.profileContextExtractionEnabled) {
        try {
            let extractedAbout: string | null = null;
            let extractedExperience: string | null = null;

            const aboutLocator = context.session.page.locator(joinSelectors('aboutSection')).first();
            if (await aboutLocator.isVisible()) {
                extractedAbout = (await aboutLocator.innerText()).trim();
            }

            const expLocator = context.session.page.locator(joinSelectors('experienceSection')).first();
            if (await expLocator.isVisible()) {
                extractedExperience = (await expLocator.innerText()).trim();
            }

            if (extractedAbout || extractedExperience) {
                await updateLeadScrapedContext(lead.id, extractedAbout || null, extractedExperience || null);
                lead.about = extractedAbout || null;
                lead.experience = extractedExperience || null;

                bridgeLeadStatus(lead.linkedin_url, lead.status, {
                    about: extractedAbout || null,
                    experience: extractedExperience || null
                });
            }
        } catch (e) {
            // Estrazione opzionale: non bloccare l'invio dell'invito.
            console.warn(`[WARN] Impossibile estrarre contesto AI per lead ${lead.id}:`, e);
        }
    }

    const connectClicked = await clickConnectOnProfile(context.session.page);
    if (!connectClicked) {
        await incrementDailyStat(context.localDate, 'selector_failures');
        await transitionLead(lead.id, 'SKIPPED', 'connect_not_found');
        return workerResult(1);
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
        variant: inviteResult.variant || null
    });
    await incrementDailyStat(context.localDate, 'invites_sent');
    await incrementListDailyStat(context.localDate, lead.list_name, 'invites_sent');
    // Cloud sync non-bloccante
    bridgeLeadStatus(lead.linkedin_url, 'INVITED', {
        invited_at: new Date().toISOString(),
        invite_prompt_variant: inviteResult.variant || null,
        invite_note_sent: inviteResult.sentWithNote ? 'yes' : 'no'
    });
    bridgeDailyStat(context.localDate, context.accountId, 'invites_sent');
    return workerResult(1);
}
