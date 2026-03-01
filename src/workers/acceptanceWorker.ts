import { contextualReadingPause, detectChallenge, humanDelay } from '../browser';
import { transitionLead } from '../core/leadStateService';
import { getLeadById, incrementDailyStat } from '../core/repositories';
import { joinSelectors } from '../selectors';
import { AcceptanceJobPayload } from '../types/domain';
import { WorkerContext } from './context';
import { ChallengeDetectedError } from './errors';
import { isSalesNavigatorUrl, normalizeLinkedInUrl } from '../linkedinUrl';
import { bridgeDailyStat, bridgeLeadStatus } from '../cloud/cloudBridge';
import { Page } from 'playwright';
import { recordOutcome } from '../ml/abBandit';
import { WorkerExecutionResult, workerResult } from './result';

function isFirstDegreeBadge(text: string | null): boolean {
    if (!text) return true;
    return /1st|1°|1\b/i.test(text);
}

async function checkSentInvitations(page: Page, leadUrl: string): Promise<boolean> {
    await page.goto('https://www.linkedin.com/mynetwork/invitation-manager/sent/', { waitUntil: 'domcontentloaded' });
    await humanDelay(page, 2000, 3000);

    // Scroll multi-page to load recent sent invites
    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await humanDelay(page, 1000, 2000);

        const showMoreBtn = page.locator(joinSelectors('showMoreButton')).first();
        if (await showMoreBtn.isVisible().catch(() => false)) {
            await showMoreBtn.click().catch(() => null);
            await humanDelay(page, 1000, 2000);
        }
    }

    const sentLinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/in/"]'));
        return links.map(a => a.getAttribute('href') || '');
    });

    const normalizedLeadUrl = normalizeLinkedInUrl(leadUrl);
    return sentLinks.some(href => normalizeLinkedInUrl(href) === normalizedLeadUrl);
}

export async function processAcceptanceJob(payload: AcceptanceJobPayload, context: WorkerContext): Promise<WorkerExecutionResult> {
    const lead = await getLeadById(payload.leadId);
    if (!lead || lead.status !== 'INVITED') {
        return workerResult(0);
    }

    if (isSalesNavigatorUrl(lead.linkedin_url)) {
        await transitionLead(lead.id, 'BLOCKED', 'salesnav_url_requires_profile_check');
        return workerResult(1);
    }

    await context.session.page.goto(lead.linkedin_url, { waitUntil: 'domcontentloaded' });
    await humanDelay(context.session.page, 2000, 4000);
    await contextualReadingPause(context.session.page);

    if (await detectChallenge(context.session.page)) {
        throw new ChallengeDetectedError();
    }

    const pendingInvite = (await context.session.page.locator(joinSelectors('invitePendingIndicators')).count()) > 0;
    const canConnect = (await context.session.page.locator(joinSelectors('connectButtonPrimary')).count()) > 0;
    const badgeText = await context.session.page.locator(joinSelectors('distanceBadge')).first().textContent().catch(() => '');
    const hasMessageButton = (await context.session.page.locator(joinSelectors('messageButton')).count()) > 0;
    const connectedWithoutBadge = !pendingInvite && !canConnect && hasMessageButton;

    let accepted = false;

    if (isFirstDegreeBadge(badgeText)) {
        accepted = true;
    } else if (pendingInvite) {
        accepted = false;
    } else if (canConnect) {
        // Invite withdrawn or rejected
        accepted = false;
    } else if (connectedWithoutBadge) {
        // Lagged UI: Has Message button but no 1st badge, and no Pending/Connect.
        // Check Sent Invitations as the absolute Source of Truth
        const isStillPendingInManager = await checkSentInvitations(context.session.page, lead.linkedin_url);
        if (!isStillPendingInManager) {
            accepted = true;
        }
    }

    if (!accepted) {
        return workerResult(0);
    }

    await transitionLead(lead.id, 'ACCEPTED', 'acceptance_detected');
    await transitionLead(lead.id, 'READY_MESSAGE', 'message_queue_ready');
    await incrementDailyStat(context.localDate, 'acceptances');
    // A/B Bandit: registra accettazione per la variante usata nell'invito
    if (lead.invite_prompt_variant) {
        const segmentKey = (lead.job_title || 'unknown').toLowerCase().trim() || 'unknown';
        recordOutcome(lead.invite_prompt_variant, 'accepted', { segmentKey }).catch(() => { });
    }
    // Cloud sync non-bloccante
    bridgeLeadStatus(lead.linkedin_url, 'ACCEPTED', { accepted_at: new Date().toISOString() });
    bridgeDailyStat(context.localDate, context.accountId, 'acceptances');
    return workerResult(1);
}
