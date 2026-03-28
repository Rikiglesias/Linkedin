import { getDatabase } from '../../db';
import type { SelectorLearningRollbackSnapshotEntry, SelectorLearningRunRecord } from '../repositories.types';

export async function storeMessageHash(leadId: number, contentHash: string, messageText?: string): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        INSERT INTO message_history (lead_id, content_hash, message_text)
        VALUES (?, ?, ?)
    `,
        [leadId, contentHash, messageText ?? null],
    );
}

/**
 * Carica gli ultimi N testi di messaggio inviati a un lead (per semantic dedup persistente).
 * Ritorna solo i record che hanno message_text non-null.
 */
export async function getRecentMessageTexts(leadId: number, limit: number = 10): Promise<string[]> {
    const db = await getDatabase();
    const rows = await db.query<{ message_text: string }>(
        `SELECT message_text FROM message_history
         WHERE lead_id = ? AND message_text IS NOT NULL
         ORDER BY sent_at DESC LIMIT ?`,
        [leadId, limit],
    );
    return rows.map(r => r.message_text);
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
        [contentHash, hoursWindow],
    );
    return row?.total ?? 0;
}

export async function storeLeadIntent(
    leadId: number,
    intent: string,
    subIntent: string,
    confidence: number,
    rawMessage: string,
    entities: string[] = [],
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `INSERT INTO lead_intents (lead_id, intent, sub_intent, confidence, raw_message, entities_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [leadId, intent, subIntent, confidence, rawMessage.substring(0, 500), JSON.stringify(entities.slice(0, 20))],
    );
}

export async function getLeadIntent(
    leadId: number,
): Promise<{ intent: string; subIntent: string; confidence: number; entities: string[] } | null> {
    const db = await getDatabase();
    const row = await db.get<{ intent: string; sub_intent: string; confidence: number; entities_json: string | null }>(
        `SELECT intent, sub_intent, confidence, entities_json
         FROM lead_intents
         WHERE lead_id = ?
         ORDER BY analyzed_at DESC
         LIMIT 1`,
        [leadId],
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

export interface LeadReplyDraftInput {
    draft: string;
    confidence: number;
    source: 'ai' | 'fallback';
    intent: string;
    subIntent: string;
    entities: string[];
    reasoning: string;
    autoReplySent: boolean;
}

let cachedLeadMetadataColumn: 'lead_metadata' | 'metadata_json' | null = null;

async function resolveLeadMetadataColumn(
    db: Awaited<ReturnType<typeof getDatabase>>,
): Promise<'lead_metadata' | 'metadata_json'> {
    if (cachedLeadMetadataColumn) {
        return cachedLeadMetadataColumn;
    }
    try {
        await db.get(`SELECT lead_metadata FROM leads LIMIT 1`);
        cachedLeadMetadataColumn = 'lead_metadata';
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/no such column|SQLITE_ERROR/i.test(msg)) {
            cachedLeadMetadataColumn = 'metadata_json';
        }
        return 'metadata_json';
    }
    return cachedLeadMetadataColumn;
}

async function readLeadMetadataForLead(
    db: Awaited<ReturnType<typeof getDatabase>>,
    leadId: number,
): Promise<{ found: boolean; metadata: Record<string, unknown> }> {
    const metadataColumn = await resolveLeadMetadataColumn(db);
    const row = await db.get<{ metadata: string | null }>(
        `SELECT ${metadataColumn} AS metadata FROM leads WHERE id = ? LIMIT 1`,
        [leadId],
    );
    if (!row) {
        return { found: false, metadata: {} };
    }
    return {
        found: true,
        metadata: parseLeadMetadataObject(row.metadata),
    };
}

async function writeLeadMetadataForLead(
    db: Awaited<ReturnType<typeof getDatabase>>,
    leadId: number,
    metadata: Record<string, unknown>,
): Promise<void> {
    const metadataColumn = await resolveLeadMetadataColumn(db);
    await db.run(`UPDATE leads SET ${metadataColumn} = ?, updated_at = datetime('now') WHERE id = ?`, [
        JSON.stringify(metadata),
        leadId,
    ]);
}

export async function appendLeadReplyDraft(leadId: number, input: LeadReplyDraftInput): Promise<void> {
    const db = await getDatabase();
    const readResult = await readLeadMetadataForLead(db, leadId);
    const metadata = readResult.metadata;

    const existingDrafts = Array.isArray(metadata.reply_drafts)
        ? metadata.reply_drafts.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        : [];
    const nextDraft = {
        draft: input.draft.slice(0, 500),
        confidence: Math.max(0, Math.min(1, input.confidence)),
        source: input.source,
        intent: input.intent,
        subIntent: input.subIntent,
        entities: input.entities.slice(0, 20),
        reasoning: input.reasoning.slice(0, 300),
        autoReplySent: input.autoReplySent,
        createdAt: new Date().toISOString(),
    };
    metadata.reply_drafts = [nextDraft, ...existingDrafts].slice(0, 20);
    metadata.reply_draft_last_updated_at = new Date().toISOString();

    await writeLeadMetadataForLead(db, leadId, metadata);
}

export type CommentSuggestionReviewStatus = 'REVIEW_PENDING' | 'APPROVED' | 'REJECTED';

export interface CommentSuggestionReviewItem {
    leadId: number;
    firstName: string;
    lastName: string;
    listName: string;
    linkedinUrl: string;
    suggestionIndex: number;
    postIndex: number;
    postSnippet: string;
    comment: string;
    confidence: number;
    source: string;
    model: string | null;
    status: CommentSuggestionReviewStatus;
    generatedAt: string | null;
    reviewedAt: string | null;
    reviewedBy: string | null;
}

export interface CommentSuggestionReviewDecisionInput {
    leadId: number;
    suggestionIndex: number;
    action: 'approve' | 'reject';
    reviewer?: string | null;
    comment?: string | null;
}

export interface CommentSuggestionReviewDecisionResult {
    leadId: number;
    suggestionIndex: number;
    status: CommentSuggestionReviewStatus;
    comment: string;
    reviewedAt: string;
    reviewedBy: string | null;
    reviewRequired: boolean;
}

interface StoredCommentSuggestion {
    postIndex: number;
    comment: string;
    confidence: number;
    source: string;
    model: string | null;
    status: CommentSuggestionReviewStatus;
    generatedAt: string | null;
    reviewedAt: string | null;
    reviewedBy: string | null;
}

function parseLeadMetadataObject(raw: string | null): Record<string, unknown> {
    if (!raw || !raw.trim()) return {};
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }
        return parsed as Record<string, unknown>;
    } catch {
        return {};
    }
}

function normalizeReviewStatus(value: unknown): CommentSuggestionReviewStatus {
    if (value === 'APPROVED') return 'APPROVED';
    if (value === 'REJECTED') return 'REJECTED';
    return 'REVIEW_PENDING';
}

function parseStoredCommentSuggestions(meta: Record<string, unknown>): StoredCommentSuggestion[] {
    if (!Array.isArray(meta.comment_suggestions)) return [];
    return meta.comment_suggestions
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
        .map((entry) => ({
            postIndex: Number.isFinite(entry.postIndex) ? Number(entry.postIndex) : 0,
            comment: typeof entry.comment === 'string' ? entry.comment : '',
            confidence: Math.max(0, Math.min(1, Number.isFinite(entry.confidence) ? Number(entry.confidence) : 0)),
            source: typeof entry.source === 'string' ? entry.source : 'template',
            model: typeof entry.model === 'string' ? entry.model : null,
            status: normalizeReviewStatus(entry.status),
            generatedAt: typeof entry.generatedAt === 'string' ? entry.generatedAt : null,
            reviewedAt: typeof entry.reviewedAt === 'string' ? entry.reviewedAt : null,
            reviewedBy: typeof entry.reviewedBy === 'string' ? entry.reviewedBy : null,
        }))
        .filter((entry) => entry.comment.trim().length > 0);
}

function buildPostSnippet(meta: Record<string, unknown>, postIndex: number): string {
    if (!Array.isArray(meta.recent_posts)) return '';
    const post = meta.recent_posts[postIndex] as Record<string, unknown> | undefined;
    const text = typeof post?.text === 'string' ? post.text : '';
    if (!text.trim()) return '';
    const normalized = text.replace(/\s+/g, ' ').trim();
    return normalized.slice(0, 180);
}

export async function listCommentSuggestionsForReview(
    limit: number = 25,
    status: CommentSuggestionReviewStatus = 'REVIEW_PENDING',
): Promise<CommentSuggestionReviewItem[]> {
    const db = await getDatabase();
    const safeLimit = Math.max(1, Math.floor(limit));
    const metadataColumn = await resolveLeadMetadataColumn(db);
    const rows = await db.query<{
        id: number;
        first_name: string;
        last_name: string;
        list_name: string;
        linkedin_url: string;
        metadata: string | null;
    }>(
        `SELECT id, first_name, last_name, list_name, linkedin_url, ${metadataColumn} AS metadata
         FROM leads
         WHERE ${metadataColumn} IS NOT NULL
           AND ${metadataColumn} LIKE '%comment_suggestions%'
         ORDER BY updated_at DESC
         LIMIT ?`,
        [Math.max(100, safeLimit * 6)],
    );

    const collected: CommentSuggestionReviewItem[] = [];
    for (const row of rows) {
        const meta = parseLeadMetadataObject(row.metadata);
        const suggestions = parseStoredCommentSuggestions(meta);
        for (let i = 0; i < suggestions.length; i++) {
            const suggestion = suggestions[i];
            if (suggestion.status !== status) continue;
            collected.push({
                leadId: row.id,
                firstName: row.first_name,
                lastName: row.last_name,
                listName: row.list_name,
                linkedinUrl: row.linkedin_url,
                suggestionIndex: i,
                postIndex: suggestion.postIndex,
                postSnippet: buildPostSnippet(meta, suggestion.postIndex),
                comment: suggestion.comment,
                confidence: suggestion.confidence,
                source: suggestion.source,
                model: suggestion.model,
                status: suggestion.status,
                generatedAt: suggestion.generatedAt,
                reviewedAt: suggestion.reviewedAt,
                reviewedBy: suggestion.reviewedBy,
            });
        }
    }

    collected.sort((a, b) => {
        const aTs = a.generatedAt ? Date.parse(a.generatedAt) : 0;
        const bTs = b.generatedAt ? Date.parse(b.generatedAt) : 0;
        if (bTs !== aTs) return bTs - aTs;
        return b.confidence - a.confidence;
    });
    return collected.slice(0, safeLimit);
}

export async function reviewCommentSuggestion(
    input: CommentSuggestionReviewDecisionInput,
): Promise<CommentSuggestionReviewDecisionResult> {
    const db = await getDatabase();
    const leadId = Math.max(1, Math.floor(input.leadId));
    const suggestionIndex = Math.max(0, Math.floor(input.suggestionIndex));
    const readResult = await readLeadMetadataForLead(db, leadId);
    if (!readResult.found) {
        throw new Error(`lead_not_found:${leadId}`);
    }

    const meta = readResult.metadata;
    const suggestions = parseStoredCommentSuggestions(meta);
    const current = suggestions[suggestionIndex];
    if (!current) {
        throw new Error(`comment_suggestion_not_found:${leadId}:${suggestionIndex}`);
    }

    const nowIso = new Date().toISOString();
    const reviewer = input.reviewer?.trim() || null;
    const status: CommentSuggestionReviewStatus = input.action === 'approve' ? 'APPROVED' : 'REJECTED';
    const approvedComment =
        typeof input.comment === 'string' ? input.comment.replace(/\s+/g, ' ').trim().slice(0, 280) : '';

    current.status = status;
    current.reviewedAt = nowIso;
    current.reviewedBy = reviewer;
    if (status === 'APPROVED' && approvedComment.length >= 12) {
        current.comment = approvedComment;
    }

    const reviewRequired = suggestions.some((suggestion) => suggestion.status === 'REVIEW_PENDING');
    meta.comment_suggestions = suggestions;
    meta.comment_suggestions_review_required = reviewRequired;
    meta.comment_suggestions_reviewed_at = nowIso;

    await writeLeadMetadataForLead(db, leadId, meta);

    return {
        leadId,
        suggestionIndex,
        status: current.status,
        comment: current.comment,
        reviewedAt: nowIso,
        reviewedBy: reviewer,
        reviewRequired,
    };
}

export async function listABVariantStats(): Promise<
    Array<{
        variantId: string;
        sent: number;
        accepted: number;
        replied: number;
    }>
> {
    const db = await getDatabase();
    const rows = await db.query<{ variant_id: string; sent: number; accepted: number; replied: number }>(
        `SELECT variant_id, sent, accepted, replied
         FROM ab_variant_stats
         ORDER BY sent DESC`,
    );
    return (rows || []).map((r: { variant_id: string; sent: number; accepted: number; replied: number }) => ({
        variantId: r.variant_id,
        sent: r.sent,
        accepted: r.accepted,
        replied: r.replied,
    }));
}

export async function getDynamicSelectors(actionLabel: string, limit: number = 6): Promise<string[]> {
    const rows = await listDynamicSelectorCandidates(actionLabel, limit);
    return rows.map((row) => row.selector).filter((selector) => selector.trim().length > 0);
}

export interface DynamicSelectorCandidate {
    selector: string;
    confidence: number;
    success_count: number;
    source: string;
    updated_at: string;
}

export async function listDynamicSelectorCandidates(
    actionLabel: string,
    limit: number = 12,
): Promise<DynamicSelectorCandidate[]> {
    const db = await getDatabase();
    const rows = await db.query<DynamicSelectorCandidate>(
        `SELECT selector, confidence, success_count, source, updated_at
         FROM dynamic_selectors
         WHERE action_label = ?
           AND active = 1
         ORDER BY confidence DESC, success_count DESC, updated_at DESC
         LIMIT ?`,
        [actionLabel, Math.max(1, limit)],
    );
    return rows;
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
        [actionLabel, selector, url],
    );

    await db.run(
        `UPDATE dynamic_selectors
         SET success_count = success_count + 1,
             last_validated_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE action_label = ?
           AND selector = ?`,
        [actionLabel, selector],
    );
}

export async function recordSelectorFailure(
    actionLabel: string,
    url: string,
    selectors: readonly string[],
    errorMessage: string,
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
        [actionLabel, url, JSON.stringify(selectors.slice(0, 25)), errorMessage.slice(0, 500)],
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
        [Math.max(1, limit)],
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
        [actionLabel],
    );
}

export interface SelectorFallbackAggregate {
    action_label: string;
    selector: string;
    success_count: number;
    last_success_at: string;
}

export async function listSelectorFallbackAggregates(
    minSuccess: number = 3,
    limit: number = 50,
): Promise<SelectorFallbackAggregate[]> {
    const db = await getDatabase();
    return db.query<SelectorFallbackAggregate>(
        `SELECT action_label, selector, success_count, last_success_at
         FROM selector_fallbacks
         WHERE success_count >= ?
         ORDER BY success_count DESC, last_success_at DESC
         LIMIT ?`,
        [Math.max(1, minSuccess), Math.max(1, limit)],
    );
}

export async function upsertDynamicSelector(
    actionLabel: string,
    selector: string,
    confidence: number,
    source: string,
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
        [actionLabel, selector, Math.max(0, Math.min(1, confidence)), source],
    );
}

export interface DynamicSelectorStateRecord {
    action_label: string;
    selector: string;
    confidence: number;
    source: string;
    active: number;
    success_count: number;
    last_validated_at: string | null;
}

function normalizeActionLabels(actionLabels: readonly string[]): string[] {
    return Array.from(new Set(actionLabels.map((label) => label.trim()).filter((label) => label.length > 0)));
}

function parseSnapshotEntries(raw: string): SelectorLearningRollbackSnapshotEntry[] {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
            .map((entry) => ({
                actionLabel: typeof entry.actionLabel === 'string' ? entry.actionLabel : '',
                selector: typeof entry.selector === 'string' ? entry.selector : '',
                existedBefore: entry.existedBefore === true,
                previousConfidence: typeof entry.previousConfidence === 'number' ? entry.previousConfidence : null,
                previousSource: typeof entry.previousSource === 'string' ? entry.previousSource : null,
                previousActive: typeof entry.previousActive === 'number' ? entry.previousActive : null,
                previousSuccessCount:
                    typeof entry.previousSuccessCount === 'number' ? entry.previousSuccessCount : null,
                previousLastValidatedAt:
                    typeof entry.previousLastValidatedAt === 'string' ? entry.previousLastValidatedAt : null,
            }))
            .filter((entry) => entry.actionLabel.length > 0 && entry.selector.length > 0);
    } catch {
        return [];
    }
}

export async function getDynamicSelectorState(
    actionLabel: string,
    selector: string,
): Promise<DynamicSelectorStateRecord | null> {
    const db = await getDatabase();
    const row = await db.get<DynamicSelectorStateRecord>(
        `SELECT action_label, selector, confidence, source, active, success_count, last_validated_at
         FROM dynamic_selectors
         WHERE action_label = ?
           AND selector = ?
         LIMIT 1`,
        [actionLabel, selector],
    );
    return row ?? null;
}

export async function countOpenSelectorFailuresByActionLabels(
    actionLabels: readonly string[],
    lookbackDays: number = 7,
): Promise<number> {
    const normalizedLabels = normalizeActionLabels(actionLabels);
    if (normalizedLabels.length === 0) {
        return 0;
    }
    const db = await getDatabase();
    const placeholders = normalizedLabels.map(() => '?').join(', ');
    const row = await db.get<{ total: number }>(
        `SELECT COUNT(*) as total
         FROM selector_failures
         WHERE status = 'OPEN'
           AND action_label IN (${placeholders})
           AND last_seen_at >= DATETIME('now', '-' || ? || ' days')`,
        [...normalizedLabels, Math.max(1, lookbackDays)],
    );
    return row?.total ?? 0;
}

export async function createSelectorLearningRun(input: {
    triggeredBy?: string | null;
    sourceTag: string;
    lookbackDays: number;
    minSuccess: number;
}): Promise<number> {
    const db = await getDatabase();
    const insert = await db.run(
        `INSERT INTO selector_learning_runs (
            status,
            triggered_by,
            source_tag,
            lookback_days,
            min_success
         ) VALUES ('RUNNING', ?, ?, ?, ?)`,
        [
            input.triggeredBy ?? null,
            input.sourceTag,
            Math.max(1, Math.floor(input.lookbackDays)),
            Math.max(1, Math.floor(input.minSuccess)),
        ],
    );
    return insert.lastID ?? 0;
}

export async function completeSelectorLearningRun(
    runId: number,
    input: {
        status: string;
        scannedFailures: number;
        promotedCount: number;
        promotedLabelsCount: number;
        baselineOpenFailures: number;
        summary: Record<string, unknown>;
        rollbackSnapshot: SelectorLearningRollbackSnapshotEntry[];
    },
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `UPDATE selector_learning_runs
         SET status = ?,
             scanned_failures = ?,
             promoted_count = ?,
             promoted_labels_count = ?,
             baseline_open_failures = ?,
             summary_json = ?,
             rollback_snapshot_json = ?,
             finished_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            input.status,
            Math.max(0, Math.floor(input.scannedFailures)),
            Math.max(0, Math.floor(input.promotedCount)),
            Math.max(0, Math.floor(input.promotedLabelsCount)),
            Math.max(0, Math.floor(input.baselineOpenFailures)),
            JSON.stringify(input.summary ?? {}),
            JSON.stringify(input.rollbackSnapshot ?? []),
            runId,
        ],
    );
}

export async function listSelectorLearningRuns(limit: number = 20): Promise<SelectorLearningRunRecord[]> {
    const db = await getDatabase();
    return db.query<SelectorLearningRunRecord>(
        `SELECT id, status, triggered_by, source_tag, lookback_days, min_success, scanned_failures,
                promoted_count, promoted_labels_count, baseline_open_failures, evaluation_open_failures,
                evaluation_degraded, rollback_applied, rollback_reason, summary_json, rollback_snapshot_json,
                started_at, finished_at
         FROM selector_learning_runs
         ORDER BY id DESC
         LIMIT ?`,
        [Math.max(1, limit)],
    );
}

export async function getLatestPromotedSelectorLearningRun(): Promise<SelectorLearningRunRecord | null> {
    const db = await getDatabase();
    const row = await db.get<SelectorLearningRunRecord>(
        `SELECT id, status, triggered_by, source_tag, lookback_days, min_success, scanned_failures,
                promoted_count, promoted_labels_count, baseline_open_failures, evaluation_open_failures,
                evaluation_degraded, rollback_applied, rollback_reason, summary_json, rollback_snapshot_json,
                started_at, finished_at
         FROM selector_learning_runs
         WHERE status = 'PROMOTED'
           AND rollback_applied = 0
         ORDER BY id DESC
         LIMIT 1`,
    );
    return row ?? null;
}

export async function recordSelectorLearningRunEvaluation(
    runId: number,
    input: {
        evaluationOpenFailures: number;
        degraded: boolean;
        rollbackApplied: boolean;
        rollbackReason?: string | null;
    },
): Promise<void> {
    const db = await getDatabase();
    const status = input.rollbackApplied ? 'ROLLED_BACK' : undefined;
    if (status) {
        await db.run(
            `UPDATE selector_learning_runs
             SET status = ?,
                 evaluation_open_failures = ?,
                 evaluation_degraded = ?,
                 rollback_applied = ?,
                 rollback_reason = ?,
                 finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP)
             WHERE id = ?`,
            [
                status,
                Math.max(0, Math.floor(input.evaluationOpenFailures)),
                input.degraded ? 1 : 0,
                input.rollbackApplied ? 1 : 0,
                input.rollbackReason ?? null,
                runId,
            ],
        );
        return;
    }

    await db.run(
        `UPDATE selector_learning_runs
         SET evaluation_open_failures = ?,
             evaluation_degraded = ?,
             rollback_applied = ?,
             rollback_reason = ?
         WHERE id = ?`,
        [
            Math.max(0, Math.floor(input.evaluationOpenFailures)),
            input.degraded ? 1 : 0,
            input.rollbackApplied ? 1 : 0,
            input.rollbackReason ?? null,
            runId,
        ],
    );
}

export async function restoreDynamicSelectorSnapshots(
    rawSnapshotEntries: readonly SelectorLearningRollbackSnapshotEntry[],
): Promise<{ restored: number; deleted: number }> {
    const db = await getDatabase();
    let restored = 0;
    let deleted = 0;
    const snapshotEntries = parseSnapshotEntries(JSON.stringify(rawSnapshotEntries));

    for (const snapshot of snapshotEntries) {
        if (!snapshot.existedBefore) {
            const deletedResult = await db.run(
                `DELETE FROM dynamic_selectors
                 WHERE action_label = ?
                   AND selector = ?`,
                [snapshot.actionLabel, snapshot.selector],
            );
            deleted += deletedResult.changes ?? 0;
            continue;
        }

        const restoredConfidence = Math.max(0, Math.min(1, snapshot.previousConfidence ?? 0.35));
        const restoredSource = snapshot.previousSource ?? 'fallback_learner_rollback';
        const restoredActive = snapshot.previousActive === 0 ? 0 : 1;
        const restoredSuccessCount = Math.max(0, Math.floor(snapshot.previousSuccessCount ?? 0));

        const updated = await db.run(
            `UPDATE dynamic_selectors
             SET confidence = ?,
                 source = ?,
                 active = ?,
                 success_count = ?,
                 last_validated_at = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE action_label = ?
               AND selector = ?`,
            [
                restoredConfidence,
                restoredSource,
                restoredActive,
                restoredSuccessCount,
                snapshot.previousLastValidatedAt ?? null,
                snapshot.actionLabel,
                snapshot.selector,
            ],
        );

        if ((updated.changes ?? 0) > 0) {
            restored += 1;
            continue;
        }

        const inserted = await db.run(
            `INSERT INTO dynamic_selectors (
                action_label,
                selector,
                confidence,
                source,
                active,
                success_count,
                last_validated_at,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [
                snapshot.actionLabel,
                snapshot.selector,
                restoredConfidence,
                restoredSource,
                restoredActive,
                restoredSuccessCount,
                snapshot.previousLastValidatedAt ?? null,
            ],
        );
        if ((inserted.changes ?? 0) > 0) {
            restored += 1;
        }
    }

    return { restored, deleted };
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
        [listName],
    );
    return row ?? null;
}

export async function upsertRampUpState(
    listName: string,
    inviteCap: number,
    messageCap: number,
    dailyIncrease: number,
    lastRunDate: string,
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
        [listName, lastRunDate, Math.max(0, inviteCap), Math.max(0, messageCap), Math.max(0.01, dailyIncrease)],
    );
}
