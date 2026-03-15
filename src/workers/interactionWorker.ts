/**
 * workers/interactionWorker.ts
 *
 * Worker di engagement generico per le Drip Campaigns.
 * Gestisce le azioni di warm-up pre-invito: VIEW_PROFILE, LIKE_POST, FOLLOW.
 * Ogni azione usa humanBehavior per simulare comportamento umano autentico.
 */

import { Page } from 'playwright';
import { WorkerContext } from './context';
import { WorkerExecutionResult, workerResult } from './result';
import { logError, logInfo, logWarn } from '../telemetry/logger';
import { humanDelay, simulateHumanReading, humanMouseMove } from '../browser/humanBehavior';
import { detectChallenge } from '../browser/auth';
import { navigateToProfileForCheck } from '../browser/navigationContext';
import { getDatabase } from '../db';
import { ChallengeDetectedError } from './errors';
import { config, getLocalDateString } from '../config';
import { getDailyStat, incrementDailyStat } from '../core/repositories/stats';
import { isBlacklisted } from '../core/repositories/blacklist';

export interface InteractionJobPayload {
    leadId: number;
    actionType: 'VIEW_PROFILE' | 'LIKE_POST' | 'FOLLOW';
    campaignStateId?: number;
}

// ─── Helpers Interni ────────────────────────────────────────────────────────────

async function getLeadLinkedinUrl(leadId: number): Promise<string | null> {
    const db = await getDatabase();
    const row = await db.get<{ linkedin_url: string }>(`SELECT linkedin_url FROM leads WHERE id = ?`, [leadId]);
    return row?.linkedin_url ?? null;
}


// ─── VIEW PROFILE ───────────────────────────────────────────────────────────────

async function performViewProfile(page: Page, linkedinUrl: string, accountId: string): Promise<void> {
    await navigateToProfileForCheck(page, linkedinUrl, accountId);
    await humanDelay(page, 2000, 4000);
    await simulateHumanReading(page);

    // Scrolla giù per simulare ispezione della sezione Experience
    await page.evaluate(() => window.scrollBy({ top: 600, behavior: 'smooth' }));
    await humanDelay(page, 1200, 2500);
    await page.evaluate(() => window.scrollBy({ top: 400, behavior: 'smooth' }));
    await humanDelay(page, 800, 1800);
}

// ─── LIKE POST ──────────────────────────────────────────────────────────────────

async function performLikePost(page: Page, linkedinUrl: string, accountId: string): Promise<void> {
    // Naviga al profilo con context chain, poi vai alla pagina activity
    await navigateToProfileForCheck(page, linkedinUrl, accountId);
    const activityUrl = linkedinUrl.replace(/\/$/, '') + '/recent-activity/all/';
    await page.goto(activityUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await humanDelay(page, 2500, 5000);
    await simulateHumanReading(page);

    // Cerca il primo bottone "Like" (non ancora premuto)
    const likeSelectors = [
        'button[aria-label*="Like"][aria-pressed="false"]',
        'button[aria-label*="Mi piace"][aria-pressed="false"]',
        'button.react-button__trigger:not([aria-pressed="true"])',
    ];

    for (const selector of likeSelectors) {
        const likeBtn = page.locator(selector).first();
        const count = await likeBtn.count();
        if (count > 0 && (await likeBtn.isVisible())) {
            await humanMouseMove(page, selector);
            await humanDelay(page, 500, 1200);
            await likeBtn.click();
            await humanDelay(page, 800, 1800);
            return;
        }
    }

    // Fallback: se non troviamo il pulsante like su activity, facciamo solo view
    await logWarn('interaction.like_post.button_not_found', { linkedinUrl });
}

// ─── FOLLOW ─────────────────────────────────────────────────────────────────────

async function performFollow(page: Page, linkedinUrl: string, accountId: string): Promise<void> {
    await navigateToProfileForCheck(page, linkedinUrl, accountId);
    await humanDelay(page, 2000, 4000);

    const followSelectors = [
        'button[aria-label*="Follow"]',
        'button[aria-label*="Segui"]',
        'button.pvs-profile-actions__action:has-text("Follow")',
        'button.pvs-profile-actions__action:has-text("Segui")',
    ];

    for (const selector of followSelectors) {
        const btn = page.locator(selector).first();
        if ((await btn.count()) > 0 && (await btn.isVisible())) {
            // Assicuriamoci che non sia già "Following"
            const ariaLabel = (await btn.getAttribute('aria-label')) ?? '';
            if (ariaLabel.toLowerCase().includes('following') || ariaLabel.toLowerCase().includes('seguendo')) {
                await logInfo('interaction.follow.already_following', { linkedinUrl });
                return;
            }
            await humanMouseMove(page, selector);
            await humanDelay(page, 500, 1200);
            await btn.click();
            await humanDelay(page, 800, 1800);
            return;
        }
    }

    await logWarn('interaction.follow.button_not_found', { linkedinUrl });
}

// ─── Main Worker ─────────────────────────────────────────────────────────────────

export async function processInteractionJob(
    payload: InteractionJobPayload,
    context: WorkerContext,
): Promise<WorkerExecutionResult> {
    const { leadId, actionType } = payload;

    const linkedinUrl = await getLeadLinkedinUrl(leadId);
    if (!linkedinUrl) {
        await logError('interaction.lead_not_found', { leadId });
        return workerResult(0, [{ leadId, message: 'Lead URL non trovato' }]);
    }

    // Check blacklist runtime: non visitare profili, mettere like o followare lead in blacklist
    if (await isBlacklisted(linkedinUrl, null)) {
        return workerResult(0);
    }

    // Enforce profile view daily cap
    if (actionType === 'VIEW_PROFILE') {
        const localDate = getLocalDateString();
        const dailyViews = await getDailyStat(localDate, 'profile_views');
        if (dailyViews >= config.profileViewDailyCap) {
            await logWarn('interaction.profile_view_cap_reached', { dailyViews, cap: config.profileViewDailyCap });
            return workerResult(0, [{ leadId, message: `Profile view daily cap raggiunto (${dailyViews}/${config.profileViewDailyCap})` }]);
        }
    }

    if (context.dryRun) {
        await logInfo('interaction.dry_run', { leadId, actionType, linkedinUrl });
        return workerResult(1);
    }

    const page = context.session.page;

    try {
        const effectiveAccountId = context.accountId ?? 'default';
        switch (actionType) {
            case 'VIEW_PROFILE':
                await performViewProfile(page, linkedinUrl, effectiveAccountId);
                await incrementDailyStat(getLocalDateString(), 'profile_views');
                break;
            case 'LIKE_POST':
                await performLikePost(page, linkedinUrl, effectiveAccountId);
                await incrementDailyStat(getLocalDateString(), 'likes_given');
                break;
            case 'FOLLOW':
                await performFollow(page, linkedinUrl, effectiveAccountId);
                await incrementDailyStat(getLocalDateString(), 'follows_given');
                break;
            default:
                await logWarn('interaction.unknown_action', { actionType });
                return workerResult(0, [{ leadId, message: `Tipo azione non supportata: ${actionType}` }]);
        }

        // Verifica challenge dopo l'azione
        const isChallenged = await detectChallenge(page).catch(() => false);
        if (isChallenged) {
            throw new ChallengeDetectedError(`Challenge rilevata dopo azione ${actionType} su ${linkedinUrl}`);
        }

        await logInfo('interaction.success', { leadId, actionType, linkedinUrl });
        return workerResult(1);
    } catch (error) {
        if (error instanceof ChallengeDetectedError) {
            throw error; // Propagato al jobRunner che gestirà il quarantine
        }
        const message = error instanceof Error ? error.message : String(error);
        await logError('interaction.error', { leadId, actionType, error: message });
        return workerResult(0, [{ leadId, message }]);
    }
}
