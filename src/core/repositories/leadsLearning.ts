import { getDatabase } from '../../db';

export async function storeMessageHash(leadId: number, contentHash: string): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        INSERT INTO message_history (lead_id, content_hash)
        VALUES (?, ?)
    `,
        [leadId, contentHash]
    );
}

export async function countRecentMessageHash(contentHash: string, hoursWindow: number): Promise<number> {
    const db = await getDatabase();
    const row = await db.get<{ total: number }>(
        `
        SELECT COUNT(*) as total
        FROM message_history
        WHERE content_hash = ?
          AND sent_at >= DATETIME('now', '-' || ? || ' hours')
    `,
        [contentHash, hoursWindow]
    );
    return row?.total ?? 0;
}

export async function storeLeadIntent(
    leadId: number,
    intent: string,
    subIntent: string,
    confidence: number,
    rawMessage: string,
    entities: string[] = []
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `INSERT INTO lead_intents (lead_id, intent, sub_intent, confidence, raw_message, entities_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [leadId, intent, subIntent, confidence, rawMessage.substring(0, 500), JSON.stringify(entities.slice(0, 20))]
    );
}

export async function getLeadIntent(
    leadId: number
): Promise<{ intent: string; subIntent: string; confidence: number; entities: string[] } | null> {
    const db = await getDatabase();
    const row = await db.get<{ intent: string; sub_intent: string; confidence: number; entities_json: string | null }>(
        `SELECT intent, sub_intent, confidence, entities_json
         FROM lead_intents
         WHERE lead_id = ?
         ORDER BY analyzed_at DESC
         LIMIT 1`,
        [leadId]
    );
    if (!row) return null;
    let entities: string[] = [];
    if (row.entities_json) {
        try {
            const parsed = JSON.parse(row.entities_json) as unknown;
            if (Array.isArray(parsed)) {
                entities = parsed.filter((item): item is string => typeof item === 'string').slice(0, 20);
            }
        } catch {
            entities = [];
        }
    }
    return { intent: row.intent, subIntent: row.sub_intent, confidence: row.confidence, entities };
}

export async function listABVariantStats(): Promise<Array<{
    variantId: string;
    sent: number;
    accepted: number;
    replied: number;
}>> {
    const db = await getDatabase();
    const rows = await db.query<{ variant_id: string; sent: number; accepted: number; replied: number }>(
        `SELECT variant_id, sent, accepted, replied
         FROM ab_variant_stats
         ORDER BY sent DESC`
    );
    return (rows || []).map((r: { variant_id: string; sent: number; accepted: number; replied: number }) => ({
        variantId: r.variant_id,
        sent: r.sent,
        accepted: r.accepted,
        replied: r.replied,
    }));
}

export async function getDynamicSelectors(actionLabel: string, limit: number = 6): Promise<string[]> {
    const db = await getDatabase();
    const rows = await db.query<{ selector: string }>(
        `SELECT selector
         FROM dynamic_selectors
         WHERE action_label = ?
           AND active = 1
         ORDER BY success_count DESC, confidence DESC, updated_at DESC
         LIMIT ?`,
        [actionLabel, Math.max(1, limit)]
    );
    return rows.map((row) => row.selector).filter((selector) => selector.trim().length > 0);
}

export async function recordSelectorFallbackSuccess(actionLabel: string, selector: string, url: string): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `INSERT INTO selector_fallbacks (action_label, selector, url, success_count, last_success_at, updated_at)
         VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(action_label, selector)
         DO UPDATE SET
            success_count = selector_fallbacks.success_count + 1,
            last_success_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP`,
        [actionLabel, selector, url]
    );

    await db.run(
        `UPDATE dynamic_selectors
         SET success_count = success_count + 1,
             last_validated_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE action_label = ?
           AND selector = ?`,
        [actionLabel, selector]
    );
}

export async function recordSelectorFailure(
    actionLabel: string,
    url: string,
    selectors: readonly string[],
    errorMessage: string
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `INSERT INTO selector_failures (action_label, url, selectors_json, error_message, occurrences, first_seen_at, last_seen_at, status)
         VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'OPEN')
         ON CONFLICT(action_label, url)
         DO UPDATE SET
            selectors_json = excluded.selectors_json,
            error_message = excluded.error_message,
            occurrences = selector_failures.occurrences + 1,
            last_seen_at = CURRENT_TIMESTAMP,
            resolved_at = NULL,
            status = 'OPEN'`,
        [actionLabel, url, JSON.stringify(selectors.slice(0, 25)), errorMessage.slice(0, 500)]
    );
}

export interface SelectorFailureRecord {
    id: number;
    action_label: string;
    url: string;
    selectors_json: string;
    error_message: string | null;
    occurrences: number;
    first_seen_at: string;
    last_seen_at: string;
    resolved_at: string | null;
    status: string;
}

export async function listOpenSelectorFailures(limit: number = 50): Promise<SelectorFailureRecord[]> {
    const db = await getDatabase();
    return db.query<SelectorFailureRecord>(
        `SELECT id, action_label, url, selectors_json, error_message, occurrences, first_seen_at, last_seen_at, resolved_at, status
         FROM selector_failures
         WHERE status = 'OPEN'
         ORDER BY occurrences DESC, last_seen_at DESC
         LIMIT ?`,
        [Math.max(1, limit)]
    );
}

export async function markSelectorFailuresResolved(actionLabel: string): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `UPDATE selector_failures
         SET status = 'RESOLVED',
             resolved_at = CURRENT_TIMESTAMP
         WHERE action_label = ?
           AND status = 'OPEN'`,
        [actionLabel]
    );
}

export interface SelectorFallbackAggregate {
    action_label: string;
    selector: string;
    success_count: number;
    last_success_at: string;
}

export async function listSelectorFallbackAggregates(minSuccess: number = 3, limit: number = 50): Promise<SelectorFallbackAggregate[]> {
    const db = await getDatabase();
    return db.query<SelectorFallbackAggregate>(
        `SELECT action_label, selector, success_count, last_success_at
         FROM selector_fallbacks
         WHERE success_count >= ?
         ORDER BY success_count DESC, last_success_at DESC
         LIMIT ?`,
        [Math.max(1, minSuccess), Math.max(1, limit)]
    );
}

export async function upsertDynamicSelector(
    actionLabel: string,
    selector: string,
    confidence: number,
    source: string
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `INSERT INTO dynamic_selectors (action_label, selector, confidence, source, active, success_count, updated_at)
         VALUES (?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP)
         ON CONFLICT(action_label, selector)
         DO UPDATE SET
            confidence = CASE
                WHEN excluded.confidence > dynamic_selectors.confidence THEN excluded.confidence
                ELSE dynamic_selectors.confidence
            END,
            source = excluded.source,
            active = 1,
            updated_at = CURRENT_TIMESTAMP`,
        [actionLabel, selector, Math.max(0, Math.min(1, confidence)), source]
    );
}

export interface RampUpStateRecord {
    list_name: string;
    last_run_date: string | null;
    current_invite_cap: number;
    current_message_cap: number;
    daily_increase: number;
    updated_at: string;
}

export async function getRampUpState(listName: string): Promise<RampUpStateRecord | null> {
    const db = await getDatabase();
    const row = await db.get<RampUpStateRecord>(
        `SELECT list_name, last_run_date, current_invite_cap, current_message_cap, daily_increase, updated_at
         FROM list_rampup_state
         WHERE list_name = ?
         LIMIT 1`,
        [listName]
    );
    return row ?? null;
}

export async function upsertRampUpState(
    listName: string,
    inviteCap: number,
    messageCap: number,
    dailyIncrease: number,
    lastRunDate: string
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `INSERT INTO list_rampup_state (list_name, last_run_date, current_invite_cap, current_message_cap, daily_increase, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(list_name)
         DO UPDATE SET
            last_run_date = excluded.last_run_date,
            current_invite_cap = excluded.current_invite_cap,
            current_message_cap = excluded.current_message_cap,
            daily_increase = excluded.daily_increase,
            updated_at = CURRENT_TIMESTAMP`,
        [listName, lastRunDate, Math.max(0, inviteCap), Math.max(0, messageCap), Math.max(0.01, dailyIncrease)]
    );
}
