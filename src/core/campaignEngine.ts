import { getPendingCampaignExecutions, updateLeadCampaignState } from './repositories/campaigns';
import { enqueueJob } from './repositories/jobs';
import { getDatabase } from '../db';
import { CampaignStepRecord, LeadCampaignStateRecord } from './repositories.types';
import { logInfo, logWarn, logError } from '../telemetry/logger';
// Rimosso import diretto di emailEnricher in favore del worker asincrono

/**
 * Trova il prossimo step di una campagna in base a step_order.
 */
async function getNextCampaignStep(campaignId: number, currentStepOrder: number | null): Promise<CampaignStepRecord | null> {
    const db = await getDatabase();
    const order = currentStepOrder ?? -1;
    const nextStep = await db.get<CampaignStepRecord>(
        `
        SELECT * FROM campaign_steps
        WHERE campaign_id = ? AND step_order > ?
        ORDER BY step_order ASC
        LIMIT 1
        `,
        [campaignId, order]
    );
    return nextStep ?? null;
}

/**
 * Ottiene uno step campagna per id.
 */
async function getCampaignStepById(stepId: number): Promise<CampaignStepRecord | null> {
    const db = await getDatabase();
    const step = await db.get<CampaignStepRecord>(`SELECT * FROM campaign_steps WHERE id = ?`, [stepId]);
    return step ?? null;
}

/**
 * Genera un delay in secondi aggiungendo jitter (+/- 10%) per randomizzare l'avvio umano.
 */
function getJitteredDelay(hours: number): number {
    const baseSeconds = hours * 3600;
    const jitter = baseSeconds * 0.1;
    return Math.floor(baseSeconds + (Math.random() * jitter * 2) - jitter);
}

/**
 * Dispatcha i job nella coda principale per i lead la cui campagna è matura.
 */
export async function dispatchReadyCampaignSteps(): Promise<number> {
    const pendingStates = await getPendingCampaignExecutions();
    let dispatched = 0;

    for (const state of pendingStates) {
        try {
            let stepToExecute: CampaignStepRecord | null = null;
            if (state.current_step_id) {
                stepToExecute = await getCampaignStepById(state.current_step_id);
            }

            if (!stepToExecute) {
                const db = await getDatabase();
                // Primo avvio: fetch step 1
                stepToExecute = (await db.get<CampaignStepRecord>(
                    `SELECT * FROM campaign_steps WHERE campaign_id = ? ORDER BY step_order ASC LIMIT 1`,
                    [state.campaign_id]
                )) ?? null;

                if (!stepToExecute) {
                    await updateLeadCampaignState(state.id, 'COMPLETED', null, null, 'Nessuno step configurato');
                    continue;
                }
            }

            const idempotencyKey = `campaign_${state.campaign_id}_lead_${state.lead_id}_step_${stepToExecute.id}`;
            let jobType: 'INVITE' | 'MESSAGE' | 'INTERACTION' | 'ENRICHMENT' = 'INTERACTION';
            const payload: Record<string, unknown> = {
                leadId: state.lead_id,
                campaignStateId: state.id,
                ...(stepToExecute.metadata_json && { metadata_json: stepToExecute.metadata_json })
            };

            switch (stepToExecute.action_type) {
                case 'INVITE':
                    jobType = 'INVITE';
                    break;
                case 'MESSAGE':
                    jobType = 'MESSAGE';
                    break;
                case 'VIEW_PROFILE':
                case 'LIKE_POST':
                case 'FOLLOW':
                    jobType = 'INTERACTION';
                    payload.actionType = stepToExecute.action_type;
                    break;
                case 'EMAIL_ENRICHMENT':
                    jobType = 'ENRICHMENT';
                    break;
                default:
                    await updateLeadCampaignState(state.id, 'ERROR', state.current_step_id, null, `Action non supportata: ${stepToExecute.action_type}`);
                    continue;
            }

            const enqueued = await enqueueJob(
                jobType,
                payload,
                idempotencyKey,
                5,
                3
            );

            if (enqueued) {
                await updateLeadCampaignState(state.id, 'IN_PROGRESS', stepToExecute.id, state.next_execution_at);
                dispatched++;
                await logInfo('campaign.step_dispatched', {
                    leadId: state.lead_id,
                    campaignId: state.campaign_id,
                    stepOrder: stepToExecute.step_order,
                    action: stepToExecute.action_type
                });
            }
        } catch (error) {
            await logError('campaign.dispatch_error', { stateId: state.id, error: String(error) });
        }
    }

    return dispatched;
}

/**
 * Viene chiamato dal jobRunner quando un job con campaignStateId finisce con SUCCESSO.
 * Calcola il delay per il prossimo step e reinserisce il lead in ENROLLED.
 */
export async function advanceLeadCampaign(campaignStateId: number): Promise<void> {
    const db = await getDatabase();
    const state = await db.get<LeadCampaignStateRecord>(
        `SELECT * FROM lead_campaign_state WHERE id = ?`,
        [campaignStateId]
    );
    if (!state) return;

    if (state.status !== 'IN_PROGRESS') {
        await logWarn('campaign.advance_warning', {
            stateId: campaignStateId,
            status: state.status,
            msg: 'Tentativo di avanzare uno stato non IN_PROGRESS'
        });
        // Può succedere in caso di retry. Procediamo comunque per idempotenza.
    }

    const currentStep = state.current_step_id ? await getCampaignStepById(state.current_step_id) : null;
    const nextStep = await getNextCampaignStep(state.campaign_id, currentStep ? currentStep.step_order : null);

    if (!nextStep) {
        await updateLeadCampaignState(campaignStateId, 'COMPLETED', state.current_step_id, null);
        await logInfo('campaign.completed', { stateId: campaignStateId, leadId: state.lead_id });
        return;
    }

    const delaySeconds = getJitteredDelay(nextStep.delay_hours);

    await db.run(
        `
        UPDATE lead_campaign_state
        SET status = 'ENROLLED',
            current_step_id = ?,
            next_execution_at = DATETIME('now', '+' || ? || ' seconds'),
            last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [nextStep.id, delaySeconds, campaignStateId]
    );

    await logInfo('campaign.advanced', {
        stateId: campaignStateId,
        leadId: state.lead_id,
        nextStep: nextStep.action_type,
        delayHours: nextStep.delay_hours
    });
}

/**
 * Marca lo stato campagna come ERROR quando un job va in DEAD_LETTER.
 */
export async function failLeadCampaign(campaignStateId: number, errorMessage: string): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `UPDATE lead_campaign_state SET status = 'ERROR', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [errorMessage, campaignStateId]
    );
    await logWarn('campaign.failed', { stateId: campaignStateId, error: errorMessage });
}
