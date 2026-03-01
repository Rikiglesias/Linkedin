import { buildPersonalizedInviteNote } from '../../ai/inviteNotePersonalizer';
import { buildPersonalizedFollowUpMessage } from '../../ai/messagePersonalizer';
import { analyzeIncomingMessage } from '../../ai/sentimentAnalysis';
import { config, getLocalDateString } from '../../config';
import { getDatabase } from '../../db';
import type { LeadRecord } from '../../types/domain';
import type {
    AiQualitySnapshot,
    AiValidationRunRecord,
    AiValidationSampleRecord,
    AiValidationTaskType,
    AiVariantComparison,
    AiVariantMetric,
} from '../repositories.types';

interface ValidationRunSummary {
    total: number;
    matched: number;
    failed: number;
    avgSimilarity: number;
    byTask: Record<string, { total: number; matched: number; avgSimilarity: number }>;
}

interface TwoProportionResult {
    pValue: number | null;
    significant: boolean;
}

type SeedSample = {
    taskType: AiValidationTaskType;
    label: string;
    input: Record<string, unknown>;
    expected: Record<string, unknown>;
    tags: string[];
};

const DEFAULT_AI_VALIDATION_SAMPLES: SeedSample[] = [
    {
        taskType: 'sentiment',
        label: 'positive-call-request',
        input: { text: 'Ciao, grazie del messaggio. Possiamo sentirci in call martedi?' },
        expected: { intent: 'POSITIVE', subIntent: 'CALL_REQUESTED', minConfidence: 0.55 },
        tags: ['positive', 'call'],
    },
    {
        taskType: 'sentiment',
        label: 'price-question',
        input: { text: 'Interessante, ma qual e il prezzo e come funziona il piano?' },
        expected: { intent: 'QUESTIONS', subIntent: 'PRICE_INQUIRY', minConfidence: 0.55 },
        tags: ['questions', 'price'],
    },
    {
        taskType: 'invite',
        label: 'invite-short-professional',
        input: { firstName: 'Marco', company: 'Acme', role: 'Head of Sales' },
        expected: { requiredKeywords: ['marco'], maxChars: 300, forbiddenKeywords: ['http://', 'https://'] },
        tags: ['invite', 'short'],
    },
    {
        taskType: 'message',
        label: 'message-no-link-no-emoji',
        input: { firstName: 'Laura', company: 'Nova', role: 'Founder' },
        expected: { requiredKeywords: ['laura'], maxChars: 450, forbiddenKeywords: ['http://', 'https://', '😀', '🚀'] },
        tags: ['message', 'style'],
    },
];

function normalizeText(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.trim();
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed as Record<string, unknown>;
        }
        return {};
    } catch {
        return {};
    }
}

function clamp01(value: number): number {
    if (Number.isNaN(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

function countKeywordHits(text: string, keywords: string[]): number {
    if (keywords.length === 0) return 0;
    const lowered = text.toLowerCase();
    let hits = 0;
    for (const keyword of keywords) {
        const normalized = keyword.trim().toLowerCase();
        if (!normalized) continue;
        if (lowered.includes(normalized)) {
            hits += 1;
        }
    }
    return hits;
}

function scoreTextQuality(
    text: string,
    expected: Record<string, unknown>,
    defaultMaxChars: number
): { similarity: number; isMatch: boolean } {
    const requiredKeywords = Array.isArray(expected.requiredKeywords)
        ? expected.requiredKeywords.filter((value): value is string => typeof value === 'string')
        : [];
    const forbiddenKeywords = Array.isArray(expected.forbiddenKeywords)
        ? expected.forbiddenKeywords.filter((value): value is string => typeof value === 'string')
        : [];
    const maxCharsRaw = expected.maxChars;
    const maxChars = typeof maxCharsRaw === 'number' && Number.isFinite(maxCharsRaw)
        ? Math.max(40, Math.floor(maxCharsRaw))
        : defaultMaxChars;

    const requiredHits = countKeywordHits(text, requiredKeywords);
    const requiredCoverage = requiredKeywords.length === 0
        ? 1
        : requiredHits / requiredKeywords.length;
    const forbiddenHits = countKeywordHits(text, forbiddenKeywords);
    const noForbidden = forbiddenHits === 0;
    const withinLimit = text.length <= maxChars;
    const lengthScore = withinLimit
        ? 1
        : clamp01(1 - ((text.length - maxChars) / Math.max(1, maxChars)));

    const similarity = clamp01((requiredCoverage * 0.7) + (lengthScore * 0.3) - (noForbidden ? 0 : 0.5));
    const isMatch = requiredCoverage >= 0.6 && noForbidden && withinLimit;

    return { similarity, isMatch };
}

function makeSyntheticLead(input: Record<string, unknown>, leadId: number): LeadRecord {
    const firstName = normalizeText(input.firstName) || normalizeText(input.first_name) || 'Collega';
    const lastName = normalizeText(input.lastName) || normalizeText(input.last_name) || 'Test';
    const company = normalizeText(input.company) || normalizeText(input.accountName) || 'Example';
    const role = normalizeText(input.role) || normalizeText(input.jobTitle) || 'Professional';
    const linkedinUrl = normalizeText(input.linkedinUrl) || `https://www.linkedin.com/in/ai-quality-${leadId}/`;
    const website = normalizeText(input.website) || 'https://example.com';
    const about = normalizeText(input.about) || null;
    const experience = normalizeText(input.experience) || null;

    return {
        id: leadId,
        account_name: company,
        first_name: firstName,
        last_name: lastName,
        job_title: role,
        website,
        linkedin_url: linkedinUrl,
        status: 'READY_MESSAGE',
        list_name: 'ai_validation',
        invited_at: null,
        accepted_at: null,
        messaged_at: null,
        last_error: null,
        blocked_reason: null,
        about,
        experience,
        invite_prompt_variant: null,
        lead_score: null,
        confidence_score: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
}

function calculateSentimentSimilarity(
    prediction: { intent: string; subIntent: string; entities: string[]; confidence: number },
    expected: Record<string, unknown>
): { similarity: number; isMatch: boolean } {
    const expectedIntent = normalizeText(expected.intent).toUpperCase();
    const expectedSubIntent = normalizeText(expected.subIntent).toUpperCase();
    const minConfidence = typeof expected.minConfidence === 'number'
        ? clamp01(expected.minConfidence)
        : 0;
    const expectedEntities = Array.isArray(expected.entities)
        ? expected.entities.filter((value): value is string => typeof value === 'string').map((value) => value.toLowerCase())
        : [];
    const predictedEntities = prediction.entities.map((value) => value.toLowerCase());
    const entityHits = expectedEntities.length === 0
        ? 1
        : expectedEntities.filter((entity) => predictedEntities.includes(entity)).length / expectedEntities.length;

    const intentScore = expectedIntent && prediction.intent.toUpperCase() === expectedIntent ? 1 : 0;
    const subIntentScore = expectedSubIntent && prediction.subIntent.toUpperCase() === expectedSubIntent ? 1 : 0;
    const confidenceScore = prediction.confidence >= minConfidence ? 1 : clamp01(prediction.confidence / Math.max(0.01, minConfidence));
    const similarity = clamp01((intentScore * 0.5) + (subIntentScore * 0.3) + (entityHits * 0.1) + (confidenceScore * 0.1));
    const isMatch = intentScore === 1 && (expectedSubIntent ? subIntentScore === 1 : true) && prediction.confidence >= minConfidence;
    return { similarity, isMatch };
}

function formatRate(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Number.parseFloat((numerator / denominator).toFixed(6));
}

function erf(x: number): number {
    const sign = x < 0 ? -1 : 1;
    const absX = Math.abs(x);
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    const t = 1 / (1 + p * absX);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
    return sign * y;
}

function normalCdf(x: number): number {
    return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function computeTwoProportionSignificance(
    baselineSuccess: number,
    baselineTotal: number,
    candidateSuccess: number,
    candidateTotal: number,
    alpha: number
): TwoProportionResult {
    if (baselineTotal <= 0 || candidateTotal <= 0) {
        return { pValue: null, significant: false };
    }
    const pooled = (baselineSuccess + candidateSuccess) / (baselineTotal + candidateTotal);
    const standardError = Math.sqrt(pooled * (1 - pooled) * ((1 / baselineTotal) + (1 / candidateTotal)));
    if (!Number.isFinite(standardError) || standardError === 0) {
        return { pValue: null, significant: false };
    }
    const baselineRate = baselineSuccess / baselineTotal;
    const candidateRate = candidateSuccess / candidateTotal;
    const zScore = (candidateRate - baselineRate) / standardError;
    const pValue = 2 * (1 - normalCdf(Math.abs(zScore)));
    return {
        pValue,
        significant: Number.isFinite(pValue) ? pValue < alpha : false,
    };
}

async function ensureAiValidationTables(): Promise<void> {
    const db = await getDatabase();
    await db.exec(`
        CREATE TABLE IF NOT EXISTS ai_validation_samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_type TEXT NOT NULL,
            label TEXT NOT NULL,
            input_json TEXT NOT NULL DEFAULT '{}',
            expected_json TEXT NOT NULL DEFAULT '{}',
            tags_csv TEXT NOT NULL DEFAULT '',
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);
    await db.exec(`
        CREATE TABLE IF NOT EXISTS ai_validation_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            status TEXT NOT NULL DEFAULT 'RUNNING',
            triggered_by TEXT,
            summary_json TEXT NOT NULL DEFAULT '{}',
            started_at TEXT NOT NULL DEFAULT (datetime('now')),
            finished_at TEXT
        );
    `);
    await db.exec(`
        CREATE TABLE IF NOT EXISTS ai_validation_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER NOT NULL,
            sample_id INTEGER NOT NULL,
            predicted_json TEXT NOT NULL DEFAULT '{}',
            similarity REAL NOT NULL DEFAULT 0,
            is_match INTEGER NOT NULL DEFAULT 0,
            error_message TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(run_id, sample_id)
        );
    `);
}

export async function seedDefaultAiValidationSamples(force: boolean = false): Promise<number> {
    if (!config.aiValidationAutoSeedEnabled && !force) {
        return 0;
    }
    await ensureAiValidationTables();
    const db = await getDatabase();
    const existing = await db.get<{ total: number }>('SELECT COUNT(*) as total FROM ai_validation_samples');
    if (!force && (existing?.total ?? 0) > 0) {
        return 0;
    }

    let inserted = 0;
    for (const sample of DEFAULT_AI_VALIDATION_SAMPLES) {
        const result = await db.run(
            `
            INSERT INTO ai_validation_samples (task_type, label, input_json, expected_json, tags_csv, active)
            VALUES (?, ?, ?, ?, ?, 1)
        `,
            [
                sample.taskType,
                sample.label,
                JSON.stringify(sample.input),
                JSON.stringify(sample.expected),
                sample.tags.join(','),
            ]
        );
        inserted += result.changes ?? 0;
    }
    return inserted;
}

export async function listAiValidationSamples(activeOnly: boolean = true): Promise<AiValidationSampleRecord[]> {
    await ensureAiValidationTables();
    const db = await getDatabase();
    if (activeOnly) {
        return db.query<AiValidationSampleRecord>(
            `
            SELECT id, task_type, label, input_json, expected_json, tags_csv, active, created_at
            FROM ai_validation_samples
            WHERE active = 1
            ORDER BY task_type ASC, created_at ASC, id ASC
        `
        );
    }
    return db.query<AiValidationSampleRecord>(
        `
        SELECT id, task_type, label, input_json, expected_json, tags_csv, active, created_at
        FROM ai_validation_samples
        ORDER BY task_type ASC, created_at ASC, id ASC
    `
    );
}

export async function getLatestAiValidationRun(): Promise<AiValidationRunRecord | null> {
    await ensureAiValidationTables();
    const db = await getDatabase();
    const row = await db.get<AiValidationRunRecord>(
        `
        SELECT id, status, triggered_by, summary_json, started_at, finished_at
        FROM ai_validation_runs
        ORDER BY started_at DESC, id DESC
        LIMIT 1
    `
    );
    return row ?? null;
}

function summarizeValidationRows(rows: Array<{ task_type: string; similarity: number; is_match: number }>): ValidationRunSummary {
    const byTask: ValidationRunSummary['byTask'] = {};
    let total = 0;
    let matched = 0;
    let similaritySum = 0;

    for (const row of rows) {
        total += 1;
        if (row.is_match === 1) matched += 1;
        similaritySum += row.similarity;
        if (!byTask[row.task_type]) {
            byTask[row.task_type] = { total: 0, matched: 0, avgSimilarity: 0 };
        }
        const bucket = byTask[row.task_type];
        if (!bucket) continue;
        bucket.total += 1;
        if (row.is_match === 1) bucket.matched += 1;
        bucket.avgSimilarity += row.similarity;
    }

    for (const key of Object.keys(byTask)) {
        const bucket = byTask[key];
        if (!bucket || bucket.total <= 0) continue;
        bucket.avgSimilarity = Number.parseFloat((bucket.avgSimilarity / bucket.total).toFixed(4));
    }

    return {
        total,
        matched,
        failed: Math.max(0, total - matched),
        avgSimilarity: total > 0 ? Number.parseFloat((similaritySum / total).toFixed(4)) : 0,
        byTask,
    };
}

export async function runAiValidationPipeline(triggeredBy: string = 'manual'): Promise<AiValidationRunRecord> {
    await seedDefaultAiValidationSamples();
    const samples = await listAiValidationSamples(true);
    await ensureAiValidationTables();
    const db = await getDatabase();
    const runInsert = await db.run(
        `INSERT INTO ai_validation_runs (status, triggered_by, summary_json) VALUES ('RUNNING', ?, '{}')`,
        [triggeredBy]
    );
    const runId = runInsert.lastID ?? 0;
    if (!runId) {
        throw new Error('Impossibile creare ai_validation_run');
    }

    for (const sample of samples) {
        const input = parseJsonObject(sample.input_json);
        const expected = parseJsonObject(sample.expected_json);
        let predictedPayload: Record<string, unknown> = {};
        let similarity = 0;
        let isMatch = false;
        let errorMessage: string | null = null;

        try {
            if (sample.task_type === 'sentiment') {
                const messageText = normalizeText(input.text) || normalizeText(input.message) || '';
                const predicted = await analyzeIncomingMessage(messageText);
                predictedPayload = {
                    intent: predicted.intent,
                    subIntent: predicted.subIntent,
                    entities: predicted.entities,
                    confidence: predicted.confidence,
                    reasoning: predicted.reasoning,
                };
                const sentimentScore = calculateSentimentSimilarity(
                    {
                        intent: predicted.intent,
                        subIntent: predicted.subIntent,
                        entities: predicted.entities,
                        confidence: predicted.confidence,
                    },
                    expected
                );
                similarity = sentimentScore.similarity;
                isMatch = sentimentScore.isMatch;
            } else if (sample.task_type === 'invite') {
                const lead = makeSyntheticLead(input, sample.id);
                const generated = await buildPersonalizedInviteNote(lead);
                predictedPayload = {
                    text: generated.note,
                    source: generated.source,
                    model: generated.model,
                    variant: generated.variant,
                };
                const scored = scoreTextQuality(generated.note, expected, 300);
                similarity = scored.similarity;
                isMatch = scored.isMatch;
            } else {
                const lead = makeSyntheticLead(input, sample.id);
                const generated = await buildPersonalizedFollowUpMessage(lead);
                predictedPayload = {
                    text: generated.message,
                    source: generated.source,
                    model: generated.model,
                };
                const scored = scoreTextQuality(generated.message, expected, config.aiMessageMaxChars);
                similarity = scored.similarity;
                isMatch = scored.isMatch;
            }
        } catch (error) {
            errorMessage = error instanceof Error ? error.message : String(error);
            predictedPayload = {
                error: errorMessage,
            };
            similarity = 0;
            isMatch = false;
        }

        await db.run(
            `
            INSERT INTO ai_validation_results (run_id, sample_id, predicted_json, similarity, is_match, error_message)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(run_id, sample_id) DO UPDATE SET
                predicted_json = excluded.predicted_json,
                similarity = excluded.similarity,
                is_match = excluded.is_match,
                error_message = excluded.error_message,
                created_at = datetime('now')
        `,
            [runId, sample.id, JSON.stringify(predictedPayload), similarity, isMatch ? 1 : 0, errorMessage]
        );
    }

    const summaryRows = await db.query<{ task_type: string; similarity: number; is_match: number }>(
        `
        SELECT s.task_type as task_type, r.similarity as similarity, r.is_match as is_match
        FROM ai_validation_results r
        JOIN ai_validation_samples s ON s.id = r.sample_id
        WHERE r.run_id = ?
    `,
        [runId]
    );
    const summary = summarizeValidationRows(summaryRows);
    await db.run(
        `
        UPDATE ai_validation_runs
        SET status = 'COMPLETED',
            summary_json = ?,
            finished_at = datetime('now')
        WHERE id = ?
    `,
        [JSON.stringify(summary), runId]
    );

    const completed = await db.get<AiValidationRunRecord>(
        `
        SELECT id, status, triggered_by, summary_json, started_at, finished_at
        FROM ai_validation_runs
        WHERE id = ?
    `,
        [runId]
    );
    if (!completed) {
        throw new Error('Impossibile leggere ai_validation_run completata');
    }
    return completed;
}

async function getIntentFalsePositiveMetrics(lookbackDays: number): Promise<{ total: number; count: number; rate: number }> {
    const db = await getDatabase();
    const rows = await db.query<{ intent: string; lead_status: string }>(
        `
        SELECT li.intent as intent, l.status as lead_status
        FROM lead_intents li
        JOIN (
            SELECT lead_id, MAX(analyzed_at) as max_analyzed_at
            FROM lead_intents
            WHERE analyzed_at >= DATETIME('now', '-' || ? || ' days')
            GROUP BY lead_id
        ) latest
            ON latest.lead_id = li.lead_id
           AND latest.max_analyzed_at = li.analyzed_at
        JOIN leads l ON l.id = li.lead_id
    `,
        [Math.max(1, lookbackDays)]
    );

    const positiveLike = new Set(['POSITIVE', 'QUESTIONS']);
    const negativeOutcomes = new Set(['BLOCKED', 'SKIPPED', 'DEAD', 'WITHDRAWN', 'REVIEW_REQUIRED']);
    let total = 0;
    let count = 0;
    for (const row of rows) {
        const intent = normalizeText(row.intent).toUpperCase();
        if (!positiveLike.has(intent)) continue;
        total += 1;
        if (negativeOutcomes.has(normalizeText(row.lead_status).toUpperCase())) {
            count += 1;
        }
    }
    return {
        total,
        count,
        rate: formatRate(count, total),
    };
}

async function getVariantMetrics(): Promise<AiVariantMetric[]> {
    const db = await getDatabase();
    const rows = await db.query<{ variant_id: string; sent: number; accepted: number; replied: number }>(
        `
        SELECT variant_id, sent, accepted, replied
        FROM ab_variant_stats
        ORDER BY sent DESC, accepted DESC
    `
    );
    return rows.map((row) => ({
        variantId: row.variant_id,
        sent: row.sent ?? 0,
        accepted: row.accepted ?? 0,
        replied: row.replied ?? 0,
        acceptanceRate: formatRate(row.accepted ?? 0, row.sent ?? 0),
        replyRate: formatRate(row.replied ?? 0, row.sent ?? 0),
    }));
}

function buildVariantComparisons(
    variants: AiVariantMetric[],
    alpha: number,
    minSampleSize: number
): AiVariantComparison[] {
    const eligible = variants.filter((variant) => variant.sent >= minSampleSize);
    if (eligible.length < 2) {
        return [];
    }

    const baseline = [...eligible].sort((a, b) => b.sent - a.sent)[0];
    if (!baseline) return [];

    const candidates = eligible.filter((variant) => variant.variantId !== baseline.variantId);
    const bestAcceptance = [...candidates].sort((a, b) => b.acceptanceRate - a.acceptanceRate)[0];
    const bestReply = [...candidates].sort((a, b) => b.replyRate - a.replyRate)[0];
    const comparisons: AiVariantComparison[] = [];

    if (bestAcceptance) {
        const test = computeTwoProportionSignificance(
            baseline.accepted,
            baseline.sent,
            bestAcceptance.accepted,
            bestAcceptance.sent,
            alpha
        );
        comparisons.push({
            metric: 'acceptance',
            baselineVariant: baseline.variantId,
            candidateVariant: bestAcceptance.variantId,
            baselineRate: baseline.acceptanceRate,
            candidateRate: bestAcceptance.acceptanceRate,
            absoluteLift: Number.parseFloat((bestAcceptance.acceptanceRate - baseline.acceptanceRate).toFixed(6)),
            relativeLift: baseline.acceptanceRate > 0
                ? Number.parseFloat((((bestAcceptance.acceptanceRate - baseline.acceptanceRate) / baseline.acceptanceRate) * 100).toFixed(2))
                : 0,
            pValue: test.pValue,
            significant: test.significant,
            alpha,
            minSampleSize,
        });
    }

    if (bestReply) {
        const test = computeTwoProportionSignificance(
            baseline.replied,
            baseline.sent,
            bestReply.replied,
            bestReply.sent,
            alpha
        );
        comparisons.push({
            metric: 'reply',
            baselineVariant: baseline.variantId,
            candidateVariant: bestReply.variantId,
            baselineRate: baseline.replyRate,
            candidateRate: bestReply.replyRate,
            absoluteLift: Number.parseFloat((bestReply.replyRate - baseline.replyRate).toFixed(6)),
            relativeLift: baseline.replyRate > 0
                ? Number.parseFloat((((bestReply.replyRate - baseline.replyRate) / baseline.replyRate) * 100).toFixed(2))
                : 0,
            pValue: test.pValue,
            significant: test.significant,
            alpha,
            minSampleSize,
        });
    }

    return comparisons;
}

export async function getAiQualitySnapshot(lookbackDays: number = 30): Promise<AiQualitySnapshot> {
    await seedDefaultAiValidationSamples();
    const alpha = config.aiQualitySignificanceAlpha;
    const minSampleSize = config.aiQualityMinSampleSize;
    const [intentMetrics, variants, latestValidationRun] = await Promise.all([
        getIntentFalsePositiveMetrics(lookbackDays),
        getVariantMetrics(),
        getLatestAiValidationRun(),
    ]);

    return {
        localDate: getLocalDateString(),
        lookbackDays: Math.max(1, lookbackDays),
        minSampleSize,
        alpha,
        intentFalsePositiveRate: intentMetrics.rate,
        intentFalsePositiveTotal: intentMetrics.total,
        intentFalsePositiveCount: intentMetrics.count,
        variants,
        comparisons: buildVariantComparisons(variants, alpha, minSampleSize),
        latestValidationRun,
    };
}

