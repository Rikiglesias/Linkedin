import { contextualReadingPause, detectChallenge, humanDelay } from '../browser';
import { transitionLead, transitionLeadAtomic } from '../core/leadStateService';
import { getLeadById, incrementDailyStat } from '../core/repositories';
import { joinSelectors } from '../selectors';
import { AcceptanceJobPayload } from '../types/domain';
import { WorkerContext } from './context';
import { ChallengeDetectedError, RetryableWorkerError } from './errors';
import { attemptChallengeResolution } from './challengeHandler';
import { isSalesNavigatorUrl } from '../linkedinUrl';
import { logWarn } from '../telemetry/logger';
import { normalizeNameForComparison, jaroWinklerSimilarity } from '../utils/text';
import { navigateToProfileForCheck } from '../browser/navigationContext';
import { isLoggedIn } from '../browser/auth';
import { bridgeDailyStat, bridgeLeadStatus } from '../cloud/cloudBridge';
import { recordOutcome } from '../ml/abBandit';
import { WorkerExecutionResult, workerResult } from './result';

function isFirstDegreeBadge(text: string | null): boolean {
    if (!text || text.trim().length === 0) return false;
    return /1st|1°|1\b/i.test(text);
}

export async function processAcceptanceJob(
    payload: AcceptanceJobPayload,
    context: WorkerContext,
): Promise<WorkerExecutionResult> {
    const lead = await getLeadById(payload.leadId);
    if (!lead || lead.status !== 'INVITED') {
        return workerResult(0);
    }

    // C10: SalesNav URL → REVIEW_REQUIRED (era BLOCKED = dead-end irrecuperabile)
    if (isSalesNavigatorUrl(lead.linkedin_url)) {
        await transitionLead(lead.id, 'REVIEW_REQUIRED', 'salesnav_url_needs_resolution');
        return workerResult(1);
    }

    // Session validity check: se il cookie è scaduto, il profilo potrebbe
    // mostrare la pagina di login → false negative sull'acceptance.
    if (!context.dryRun) {
        const stillLoggedIn = await isLoggedIn(context.session.page);
        if (!stillLoggedIn) {
            throw new RetryableWorkerError(
                'Sessione LinkedIn scaduta durante acceptance check — aborto per evitare false negative',
                'SESSION_EXPIRED',
            );
        }
    }

    await navigateToProfileForCheck(context.session.page, lead.linkedin_url, context.accountId ?? 'default');
    await humanDelay(context.session.page, 2000, 4000);

    // M13: Rileva profilo eliminato/URL cambiato — "This page doesn't exist" o redirect a 404.
    try {
        const pageText = await context.session.page.textContent('body', { timeout: 2000 }).catch(() => '') ?? '';
        const isDeleted = /this page doesn.t exist|page not found|pagina non trovata|profilo non disponibile/i.test(pageText);
        const is404 = context.session.page.url().includes('/404') || context.session.page.url().includes('/error');
        if (isDeleted || is404) {
            await logWarn('acceptance.profile_deleted', { leadId: lead.id, url: lead.linkedin_url });
            await transitionLead(lead.id, 'DEAD', 'profile_deleted_or_404');
            return workerResult(1);
        }
    } catch { /* best-effort */ }

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
                    await logWarn('acceptance.identity_mismatch', {
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

    const pendingInvite = (await context.session.page.locator(joinSelectors('invitePendingIndicators')).count()) > 0;
    const canConnect = (await context.session.page.locator(joinSelectors('connectButtonPrimary')).count()) > 0;
    const badgeText = await context.session.page
        .locator(joinSelectors('distanceBadge'))
        .first()
        .textContent()
        .catch(() => '');
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
        // H12: Euristica diretta — ha bottone Message + no Pending + no Connect = accettato.
        // Prima navigava all'invitation manager (/mynetwork/invitation-manager/sent/) per verificare,
        // ma questo rompeva il navigation context (siamo nell'invitation manager, non sul profilo)
        // e creava un pattern automatico rilevabile (un umano non va all'invitation manager per ogni check).
        // L'euristica connectedWithoutBadge è affidabile: se il bottone Message è visibile e non c'è
        // né Pending né Connect, il lead ha accettato (badge "1st" può essere lento a caricare).
        accepted = true;
    }

    if (!accepted) {
        throw new RetryableWorkerError('Invito non ancora accettato', 'ACCEPTANCE_PENDING');
    }

    await transitionLeadAtomic(lead.id, [
        { toStatus: 'ACCEPTED', reason: 'acceptance_detected' },
        { toStatus: 'READY_MESSAGE', reason: 'message_queue_ready' },
    ]);
    await incrementDailyStat(context.localDate, 'acceptances');
    // A/B Bandit: registra accettazione per la variante usata nell'invito
    if (lead.invite_prompt_variant) {
        const segmentKey = (lead.job_title || 'unknown').toLowerCase().trim() || 'unknown';
        recordOutcome(lead.invite_prompt_variant, 'accepted', { segmentKey }).catch(() => {});
    }
    // Cloud sync non-bloccante — stato finale è READY_MESSAGE (non ACCEPTED)
    // perché transitionLeadAtomic esegue INVITED→ACCEPTED→READY_MESSAGE in un'unica transazione.
    bridgeLeadStatus(lead.linkedin_url, 'READY_MESSAGE', { accepted_at: new Date().toISOString() });
    bridgeDailyStat(context.localDate, context.accountId, 'acceptances');
    return workerResult(1);
}
