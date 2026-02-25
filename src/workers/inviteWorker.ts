import { Page } from 'playwright';
import { detectChallenge, humanDelay, simulateHumanReading } from '../browser';
import { transitionLead } from '../core/leadStateService';
import { getLeadById, incrementDailyStat, incrementListDailyStat } from '../core/repositories';
import { SELECTORS } from '../selectors';
import { InviteJobPayload } from '../types/domain';
import { WorkerContext } from './context';
import { ChallengeDetectedError, RetryableWorkerError } from './errors';
import { isSalesNavigatorUrl } from '../linkedinUrl';

async function clickConnectOnProfile(page: Page): Promise<boolean> {
    const primaryBtn = page.locator(SELECTORS.connectButtonPrimary).first();
    if (await primaryBtn.count() > 0) {
        await primaryBtn.click();
        return true;
    }

    const moreBtn = page.locator(SELECTORS.moreActionsButton).first();
    if (await moreBtn.count() > 0) {
        await moreBtn.click();
        await humanDelay(page, 700, 1300);
        const connectInMenu = page.locator(SELECTORS.connectInMoreMenu).first();
        if (await connectInMenu.count() > 0) {
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

    if (!context.dryRun) {
        const sendWithoutNote = context.session.page.locator(SELECTORS.sendWithoutNote).first();
        if (await sendWithoutNote.count() > 0) {
            await sendWithoutNote.click();
        } else {
            const fallback = context.session.page.locator(SELECTORS.sendFallback).first();
            if (await fallback.count() > 0) {
                await fallback.click();
            } else {
                await incrementDailyStat(context.localDate, 'selector_failures');
                throw new RetryableWorkerError('Conferma invito senza nota non trovata', 'SEND_BUTTON_NOT_FOUND');
            }
        }
    }

    await humanDelay(context.session.page, 1200, 2200);
    const proofOfSend = context.dryRun ? true : await detectInviteProof(context.session.page);
    if (!proofOfSend) {
        throw new RetryableWorkerError('Proof-of-send non rilevato', 'NO_PROOF_OF_SEND');
    }

    await transitionLead(lead.id, 'INVITED', context.dryRun ? 'invite_dry_run' : 'invite_sent', {
        dryRun: context.dryRun,
    });
    await incrementDailyStat(context.localDate, 'invites_sent');
    await incrementListDailyStat(context.localDate, lead.list_name, 'invites_sent');
}
