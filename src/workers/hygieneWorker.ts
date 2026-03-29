import { WorkerContext } from './context';
import { getExpiredInvitedLeads } from '../core/repositories';
import { transitionLead } from '../core/leadStateService';
import { logInfo, logError, logWarn } from '../telemetry/logger';
import { humanDelay } from '../browser';
import { clickWithFallback } from '../browser/uiFallback';
import { visionClick, OllamaDownError } from '../salesnav/visionNavigator';
import { config } from '../config';
import { navigateToProfileForCheck } from '../browser/navigationContext';
import { isLoggedIn } from '../browser/auth';
import { WorkerExecutionResult, workerResult } from './result';

const HYGIENE_DAILY_WITHDRAW_CAP = Math.max(1, parseInt(process.env.HYGIENE_DAILY_WITHDRAW_CAP ?? '10', 10) || 10);

/** Vision fallback is available when a non-default Ollama endpoint is configured. */
function isVisionAvailable(): boolean {
    return config.ollamaEndpoint !== '';
}

export interface HygieneJobPayload {
    accountId: string;
}

export async function processHygieneJob(
    payload: HygieneJobPayload,
    context: WorkerContext,
): Promise<WorkerExecutionResult> {
    if (!config.withdrawInvitesEnabled) return workerResult(0);

    const expired = await getExpiredInvitedLeads(payload.accountId, config.pendingInviteMaxDays);
    if (!expired || expired.length === 0) {
        await logInfo('hygiene.no_expired_invites', { accountId: payload.accountId });
        return workerResult(0);
    }

    const cappedExpired = expired.slice(0, HYGIENE_DAILY_WITHDRAW_CAP);
    await logInfo('hygiene.found_expired_invites', {
        count: expired.length,
        capped: cappedExpired.length,
        cap: HYGIENE_DAILY_WITHDRAW_CAP,
        accountId: payload.accountId,
    });
    const page = context.session.page;
    const errors: Array<{ leadId: number; message: string }> = [];
    let processedCount = 0;
    let visionUsed = false;

    for (const lead of cappedExpired) {
        if (context.dryRun) {
            console.log(`[DRY RUN] Hygiene ritirerebbe invito per lead ${lead.linkedin_url}`);
            processedCount += 1;
            continue;
        }

        try {
            // Session validity check prima di azioni critiche.
            // Se il cookie è scaduto mid-session, evita click su pagina di login.
            const stillLoggedIn = await isLoggedIn(page);
            if (!stillLoggedIn) {
                await logWarn('hygiene.session_expired', { leadId: lead.id });
                break; // Esce dal loop — sessione non più valida
            }

            await navigateToProfileForCheck(page, lead.linkedin_url, payload.accountId);
            await humanDelay(page, 2000, 4000);

            // Fase 1: Cerca bottone "In attesa" / "Pending" con Fallback progressivo
            // Includiamo aria-label e testID (più stabili sui reskin) prima delle label di testo
            const pendingSelectors = [
                'button[aria-label*="Pending"]',
                'button[aria-label*="In attesa"]',
                'button.pv-s-profile-actions--pending',
                'button:has-text("Pending")',
                'button:has-text("In attesa")',
                '.pvs-profile-actions button:has(svg)',
            ];

            try {
                await clickWithFallback(page, pendingSelectors, `withdraw_pending_button_${lead.id}`, {
                    timeoutPerSelector: 4000,
                    postClickDelayMs: 1000,
                });
            } catch (cssError) {
                if (!isVisionAvailable()) throw cssError;
                visionUsed = true;
                await logWarn('hygiene.vision_fallback.pending', { leadId: lead.id });
                try {
                    await visionClick(
                        page,
                        'Find and click the "Pending" or "In attesa" button on this LinkedIn profile page',
                        {
                            retries: 2,
                            postClickDelayMs: 1000,
                        },
                    );
                } catch (visionError) {
                    if (visionError instanceof OllamaDownError) throw cssError;
                    throw cssError;
                }
            }

            // Fase 2: Nel modale dropdown aperto, cerca "Ritira" / "Withdraw"
            const withdrawDropdownSelectors = [
                'div.artdeco-dropdown__content button[aria-label*="Withdraw"]',
                'div.artdeco-dropdown__content button[aria-label*="Ritira"]',
                'div.artdeco-dropdown__content button:has-text("Withdraw")',
                'div.artdeco-dropdown__content button:has-text("Ritira")',
                'div.artdeco-dropdown__item:has-text("Withdraw")',
                'div.artdeco-dropdown__item:has-text("Ritira")',
            ];

            try {
                await clickWithFallback(page, withdrawDropdownSelectors, `withdraw_dropdown_action_${lead.id}`, {
                    timeoutPerSelector: 3000,
                    postClickDelayMs: 1200,
                });
            } catch (cssError) {
                if (!isVisionAvailable()) throw cssError;
                visionUsed = true;
                await logWarn('hygiene.vision_fallback.withdraw_dropdown', { leadId: lead.id });
                try {
                    await visionClick(
                        page,
                        'Find and click the "Withdraw" or "Ritira" option in the open dropdown menu',
                        {
                            retries: 2,
                            postClickDelayMs: 1200,
                        },
                    );
                } catch (visionError) {
                    if (visionError instanceof OllamaDownError) throw cssError;
                    throw cssError;
                }
            }

            // Fase 3: Conferma finale nel dialog modale
            const modalConfirmSelectors = [
                '.artdeco-modal button.artdeco-button--primary:has-text("Withdraw")',
                '.artdeco-modal button.artdeco-button--primary:has-text("Ritira")',
                '.artdeco-modal button[data-control-name="withdraw_single"]',
                '.artdeco-modal button.artdeco-button--primary',
            ];

            try {
                await clickWithFallback(page, modalConfirmSelectors, `withdraw_confirm_modal_${lead.id}`, {
                    timeoutPerSelector: 4000,
                    postClickDelayMs: 1500,
                });
            } catch (cssError) {
                if (!isVisionAvailable()) throw cssError;
                visionUsed = true;
                await logWarn('hygiene.vision_fallback.confirm_modal', { leadId: lead.id });
                try {
                    await visionClick(
                        page,
                        'Find and click the primary "Withdraw" or "Ritira" confirmation button in the modal dialog',
                        {
                            retries: 2,
                            postClickDelayMs: 1500,
                        },
                    );
                } catch (visionError) {
                    if (visionError instanceof OllamaDownError) throw cssError;
                    throw cssError;
                }
            }

            // Se arriviamo qui, il prelievo ha avuto successo
            await transitionLead(lead.id, 'WITHDRAWN', 'auto_hygiene_policy', {
                days_old: config.pendingInviteMaxDays,
            });
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

    const result = workerResult(processedCount, errors);
    if (visionUsed) {
        result.visionFallbackUsed = true;
    }
    return result;
}
