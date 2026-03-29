import { getDatabase } from '../../db';
import { CampaignRecord, CampaignStepRecord, LeadCampaignStateRecord } from '../repositories.types';

export async function createCampaign(name: string): Promise<CampaignRecord> {
    const db = await getDatabase();
    const result = await db.run(`INSERT INTO campaigns (name) VALUES (?)`, [name]);
    if (!result.lastID) {
        throw new Error('Impossibile creare la campagna.');
    }
    const row = await db.get<CampaignRecord>(`SELECT * FROM campaigns WHERE id = ?`, [result.lastID]);
    if (!row) throw new Error('Errore nel recupero della campagna.');
    return row;
}

export async function listCampaigns(onlyActive: boolean = false): Promise<CampaignRecord[]> {
    const db = await getDatabase();
    if (onlyActive) {
        return db.query<CampaignRecord>(`SELECT * FROM campaigns WHERE active = 1 ORDER BY created_at DESC`);
    }
    return db.query<CampaignRecord>(`SELECT * FROM campaigns ORDER BY created_at DESC`);
}

export async function getCampaignById(id: number): Promise<CampaignRecord | undefined> {
    const db = await getDatabase();
    return db.get<CampaignRecord>(`SELECT * FROM campaigns WHERE id = ?`, [id]);
}

export async function updateCampaignStatus(id: number, active: boolean): Promise<boolean> {
    const db = await getDatabase();
    const result = await db.run(`UPDATE campaigns SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [
        active ? 1 : 0,
        id,
    ]);
    return (result.changes ?? 0) > 0;
}

export async function addCampaignStep(
    campaignId: number,
    stepOrder: number,
    actionType: string,
    delayHours: number,
    metadataJson: string = '{}',
): Promise<CampaignStepRecord> {
    const db = await getDatabase();
    const result = await db.run(
        `
        INSERT INTO campaign_steps (campaign_id, step_order, action_type, delay_hours, metadata_json)
        VALUES (?, ?, ?, ?, ?)
        `,
        [campaignId, stepOrder, actionType, delayHours, metadataJson],
    );
    if (!result.lastID) {
        throw new Error('Impossibile creare lo step della campagna.');
    }
    const row = await db.get<CampaignStepRecord>(`SELECT * FROM campaign_steps WHERE id = ?`, [result.lastID]);
    if (!row) throw new Error('Errore nel recupero dello step.');
    return row;
}

export async function getCampaignSteps(campaignId: number): Promise<CampaignStepRecord[]> {
    const db = await getDatabase();
    return db.query<CampaignStepRecord>(`SELECT * FROM campaign_steps WHERE campaign_id = ? ORDER BY step_order ASC`, [
        campaignId,
    ]);
}

export async function enrollLeadInCampaign(
    leadId: number,
    campaignId: number,
    currentStepId: number,
    nextExecutionAt: string,
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        INSERT OR IGNORE INTO lead_campaign_state (lead_id, campaign_id, current_step_id, status, next_execution_at)
        VALUES (?, ?, ?, 'ENROLLED', ?)
        `,
        [leadId, campaignId, currentStepId, nextExecutionAt],
    );
}

export async function getPendingCampaignExecutions(limit: number = 50): Promise<LeadCampaignStateRecord[]> {
    const db = await getDatabase();
    return db.query<LeadCampaignStateRecord>(
        `
        SELECT * FROM lead_campaign_state
        WHERE status IN ('ENROLLED', 'IN_PROGRESS')
          AND next_execution_at <= CURRENT_TIMESTAMP
        ORDER BY next_execution_at ASC
        LIMIT ?
        `,
        [limit],
    );
}

export async function updateLeadCampaignState(
    id: number,
    status: string,
    nextStepId: number | null,
    nextExecutionAt: string | null,
    lastError: string | null = null,
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        UPDATE lead_campaign_state
        SET status = ?,
            current_step_id = ?,
            next_execution_at = ?,
            last_error = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [status, nextStepId, nextExecutionAt, lastError, id],
    );
}

/**
 * Trova il prossimo step di una campagna in base a step_order.
 */
export async function getNextCampaignStep(
    campaignId: number,
    currentStepOrder: number | null,
): Promise<CampaignStepRecord | null> {
    const db = await getDatabase();
    const order = currentStepOrder ?? -1;
    const nextStep = await db.get<CampaignStepRecord>(
        `
        SELECT * FROM campaign_steps
        WHERE campaign_id = ? AND step_order > ?
        ORDER BY step_order ASC
        LIMIT 1
        `,
        [campaignId, order],
    );
    return nextStep ?? null;
}

/**
 * Ottiene uno step campagna per id.
 */
export async function getCampaignStepById(stepId: number): Promise<CampaignStepRecord | null> {
    const db = await getDatabase();
    const step = await db.get<CampaignStepRecord>(`SELECT * FROM campaign_steps WHERE id = ?`, [stepId]);
    return step ?? null;
}

/**
 * Ottiene il primo step di una campagna (step_order ASC).
 */
export async function getFirstCampaignStep(campaignId: number): Promise<CampaignStepRecord | null> {
    const db = await getDatabase();
    const step = await db.get<CampaignStepRecord>(
        `SELECT * FROM campaign_steps WHERE campaign_id = ? ORDER BY step_order ASC LIMIT 1`,
        [campaignId],
    );
    return step ?? null;
}

/**
 * Ottiene lo stato lead-campagna per id.
 */
export async function getLeadCampaignStateById(id: number): Promise<LeadCampaignStateRecord | null> {
    const db = await getDatabase();
    const state = await db.get<LeadCampaignStateRecord>(`SELECT * FROM lead_campaign_state WHERE id = ?`, [id]);
    return state ?? null;
}

/**
 * Avanza lo stato lead-campagna al prossimo step con delay calcolato.
 */
export async function advanceLeadCampaignState(id: number, nextStepId: number, delaySeconds: number): Promise<void> {
    const db = await getDatabase();
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
        [nextStepId, delaySeconds, id],
    );
}

/**
 * H14: Verifica se il lead ha una campagna drip attiva (campaigns.active = 1).
 * Ritorna true se il lead NON ha campagne drip, o se tutte le sue campagne sono attive.
 * Ritorna false se il lead ha almeno una campagna drip DISATTIVATA con stato ENROLLED/IN_PROGRESS.
 */
export async function isLeadCampaignActive(leadId: number): Promise<boolean> {
    const db = await getDatabase();
    const row = await db.get<{ cnt: number }>(
        `SELECT COUNT(*) as cnt
         FROM lead_campaign_state lcs
         JOIN campaigns c ON lcs.campaign_id = c.id
         WHERE lcs.lead_id = ?
           AND lcs.status IN ('ENROLLED', 'IN_PROGRESS')
           AND c.active = 0`,
        [leadId],
    );
    return (row?.cnt ?? 0) === 0;
}

/**
 * Marca lo stato lead-campagna come ERROR.
 */
export async function failLeadCampaignState(id: number, errorMessage: string): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `UPDATE lead_campaign_state SET status = 'ERROR', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [errorMessage, id],
    );
}
