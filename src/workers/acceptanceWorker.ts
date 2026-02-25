import { detectChallenge, humanDelay } from '../browser';
import { transitionLead } from '../core/leadStateService';
import { getLeadById } from '../core/repositories';
import { SELECTORS } from '../selectors';
import { AcceptanceJobPayload } from '../types/domain';
import { WorkerContext } from './context';
import { ChallengeDetectedError } from './errors';
import { isSalesNavigatorUrl } from '../linkedinUrl';

function isFirstDegreeBadge(text: string | null): boolean {
    if (!text) return true;
    return /1st|1°|1\b/i.test(text);
}

export async function processAcceptanceJob(payload: AcceptanceJobPayload, context: WorkerContext): Promise<void> {
    const lead = await getLeadById(payload.leadId);
    if (!lead || lead.status !== 'INVITED') {
        return;
    }

    if (isSalesNavigatorUrl(lead.linkedin_url)) {
        await transitionLead(lead.id, 'BLOCKED', 'salesnav_url_requires_profile_check');
        return;
    }

    await context.session.page.goto(lead.linkedin_url, { waitUntil: 'domcontentloaded' });
    await humanDelay(context.session.page, 2000, 4000);

    if (await detectChallenge(context.session.page)) {
        throw new ChallengeDetectedError();
    }

    const msgBtn = context.session.page.locator(SELECTORS.messageButton).first();
    if (await msgBtn.count() === 0) {
        return;
    }

    const pendingInvite = (await context.session.page.locator(SELECTORS.invitePendingIndicators).count()) > 0;
    const canConnect = (await context.session.page.locator(SELECTORS.connectButtonPrimary).count()) > 0;
    const badgeText = await context.session.page.locator(SELECTORS.distanceBadge).first().textContent().catch(() => '');
    const connectedWithoutBadge = !pendingInvite && !canConnect;
    if (!isFirstDegreeBadge(badgeText) && !connectedWithoutBadge) {
        return;
    }

    await transitionLead(lead.id, 'ACCEPTED', 'acceptance_detected');
    await transitionLead(lead.id, 'READY_MESSAGE', 'message_queue_ready');
}
