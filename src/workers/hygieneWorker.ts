import { WorkerContext } from './context';
import { getExpiredInvitedLeads } from '../core/repositories';
import { transitionLead } from '../core/leadStateService';
import { logInfo, logError } from '../telemetry/logger';
import { humanDelay } from '../browser';
import { clickWithFallback } from '../browser/uiFallback';
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

            // Fase 1: Cerca bottone "In attesa" / "Pending" con Fallback progressivo
            // Includiamo aria-label e testID (più stabili sui reskin) prima delle label di testo
            const pendingSelectors = [
                'button[aria-label*="Pending"]',
                'button[aria-label*="In attesa"]',
                'button.pv-s-profile-actions--pending',
                'button:has-text("Pending")',
                'button:has-text("In attesa")',
                '.pvs-profile-actions button:has(svg)'
            ];

            await clickWithFallback(
                page,
                pendingSelectors,
                `withdraw_pending_button_${lead.id}`,
                { timeoutPerSelector: 4000, postClickDelayMs: 1000 }
            );

            // Fase 2: Nel modale dropdown aperto, cerca "Ritira" / "Withdraw"
            const withdrawDropdownSelectors = [
                'div.artdeco-dropdown__content button[aria-label*="Withdraw"]',
                'div.artdeco-dropdown__content button[aria-label*="Ritira"]',
                'div.artdeco-dropdown__content button:has-text("Withdraw")',
                'div.artdeco-dropdown__content button:has-text("Ritira")',
                'div.artdeco-dropdown__item:has-text("Withdraw")',
                'div.artdeco-dropdown__item:has-text("Ritira")'
            ];

            await clickWithFallback(
                page,
                withdrawDropdownSelectors,
                `withdraw_dropdown_action_${lead.id}`,
                { timeoutPerSelector: 3000, postClickDelayMs: 1200 }
            );

            // Fase 3: Conferma finale nel dialog modale
            const modalConfirmSelectors = [
                '.artdeco-modal button.artdeco-button--primary:has-text("Withdraw")',
                '.artdeco-modal button.artdeco-button--primary:has-text("Ritira")',
                '.artdeco-modal button[data-control-name="withdraw_single"]',
                '.artdeco-modal button.artdeco-button--primary'
            ];

            await clickWithFallback(
                page,
                modalConfirmSelectors,
                `withdraw_confirm_modal_${lead.id}`,
                { timeoutPerSelector: 4000, postClickDelayMs: 1500 }
            );

            // Se arriviamo qui, il prelievo ha avuto successo
            await transitionLead(lead.id, 'WITHDRAWN', 'auto_hygiene_policy', { days_old: config.pendingInviteMaxDays });
            await logInfo('hygiene.invite_withdrawn', { leadId: lead.id, accountId: payload.accountId });

            await humanDelay(page, 1500, 3000);
            processedCount += 1;
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            await logError('hygiene.worker.error', { leadId: lead.id, error: message });
            // Se fallisce, usiamo la custom reason per monitorare decadimento selettori
            await transitionLead(lead.id, 'REVIEW_REQUIRED', 'hygiene_button_pending_not_found');
            errors.push({ leadId: lead.id, message });
            processedCount += 1;
        }
    }

    return workerResult(processedCount, errors);
}
