import { WorkerContext } from './context';
import { getExpiredInvitedLeads } from '../core/repositories';
import { transitionLead } from '../core/leadStateService';
import { logInfo, logError } from '../telemetry/logger';
import { humanDelay } from '../browser';
import { config } from '../config';
import { WorkerExecutionResult, workerResult } from './result';

export interface HygieneJobPayload {
    accountId: string;
}

export async function processHygieneJob(payload: HygieneJobPayload, context: WorkerContext): Promise<WorkerExecutionResult> {
    if (!config.withdrawInvitesEnabled) return workerResult(0);

    const expired = await getExpiredInvitedLeads(payload.accountId, config.pendingInviteMaxDays);
    if (!expired || expired.length === 0) {
        await logInfo('hygiene.no_expired_invites', { accountId: payload.accountId });
        return workerResult(0);
    }

    await logInfo('hygiene.found_expired_invites', { count: expired.length, accountId: payload.accountId });
    const page = context.session.page;
    const errors: Array<{ leadId: number; message: string }> = [];
    let processedCount = 0;

    for (const lead of expired) {
        if (context.dryRun) {
            console.log(`[DRY RUN] Hygiene ritirerebbe invito per lead ${lead.linkedin_url}`);
            processedCount += 1;
            continue;
        }

        try {
            await page.goto(lead.linkedin_url, { waitUntil: 'domcontentloaded' });
            await humanDelay(page, 2000, 4000);

            // Cerca bottone "In attesa" / "Pending"
            const pendingBtn = page.locator('button:has-text("Pending"), button:has-text("In attesa")').first();
            if (await pendingBtn.count() > 0) {
                await pendingBtn.click();
                await humanDelay(page, 700, 1500);

                // Nel modale, cerca "Ritira" / "Withdraw"
                const withdrawAction = page.locator('div.artdeco-dropdown__content button:has-text("Withdraw"), div.artdeco-dropdown__content button:has-text("Ritira")').first();
                if (await withdrawAction.isVisible()) {
                    await withdrawAction.click();
                    await humanDelay(page, 700, 1200);

                    // Conferma finale nel dialog modale
                    const confirmDialog = page.locator('.artdeco-modal button.artdeco-button--primary:has-text("Withdraw"), .artdeco-modal button.artdeco-button--primary:has-text("Ritira")').first();
                    if (await confirmDialog.isVisible()) {
                        await confirmDialog.click();
                        await transitionLead(lead.id, 'WITHDRAWN', 'auto_hygiene_policy', { days_old: config.pendingInviteMaxDays });
                        await logInfo('hygiene.invite_withdrawn', { leadId: lead.id, accountId: payload.accountId });
                    }
                }
            } else {
                // Se non troviamo il pending, lo marchiamo in review
                await transitionLead(lead.id, 'REVIEW_REQUIRED', 'hygiene_button_pending_not_found');
            }

            await humanDelay(page, 1500, 3000);
            processedCount += 1;
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            await logError('hygiene.worker.error', { leadId: lead.id, error: message });
            await transitionLead(lead.id, 'REVIEW_REQUIRED', 'hygiene_error_on_dom_execution');
            errors.push({ leadId: lead.id, message });
            processedCount += 1;
        }
    }

    return workerResult(processedCount, errors);
}
