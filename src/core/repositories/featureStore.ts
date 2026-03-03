import { createHash } from 'crypto';
import { getDatabase } from '../../db';
import { inferLeadSegment } from '../../ml/segments';
import type {
    BuildFeatureDatasetOptions,
    BuildFeatureDatasetResult,
    FeatureDatasetRowInput,
    FeatureDatasetRowRecord,
    FeatureDatasetSplit,
    FeatureDatasetVersionRecord,
    FeatureStoreAction,
    ImportFeatureDatasetInput,
} from '../repositories.types';
import { normalizeTextValue, withTransaction } from './shared';

interface RawFeatureSourceRow {
    lead_id: number;
    account_name: string;
    list_name: string;
    job_title: string | null;
    lead_score: number | null;
    confidence_score: number | null;
    follow_up_count: number | null;
    follow_up_sent_at: string | null;
    event_at: string;
    accepted_at: string | null;
    status: string | null;
    timing_strategy: string | null;
    intent: string | null;
    sub_intent: string | null;
    intent_confidence: number | null;
    intent_analyzed_at: string | null;
}

interface SourceStatsCounter {
    total: number;
    positive: number;
    byAction: Record<string, number>;
    bySplit: Record<string, number>;
}

const FEATURE_SPLIT_TRAIN_DEFAULT = 80;
const FEATURE_SPLIT_VALIDATION_DEFAULT = 10;
const FEATURE_LOOKBACK_DAYS_DEFAULT = 30;
const FEATURE_SEED_DEFAULT = 'default';

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        return {};
    } catch {
        return {};
    }
}

function normalizeDatasetName(value: string): string {
    const normalized = normalizeTextValue(value).toLowerCase();
    const safe = normalized.replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
    if (!safe) {
        throw new Error('datasetName non valido');
    }
    return safe.slice(0, 120);
}

function normalizeDatasetVersion(value: string | undefined): string {
    if (value && normalizeTextValue(value)) {
        const normalized = normalizeTextValue(value).replace(/[^a-zA-Z0-9._-]+/g, '_');
        return normalized.slice(0, 120);
    }
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mi = String(now.getUTCMinutes()).padStart(2, '0');
    const ss = String(now.getUTCSeconds()).padStart(2, '0');
    return `v${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function normalizeExistingDatasetVersion(value: string): string {
    const normalized = normalizeTextValue(value).replace(/[^a-zA-Z0-9._-]+/g, '_');
    if (!normalized) {
        throw new Error('datasetVersion non valido');
    }
    return normalized.slice(0, 120);
}

function normalizeActions(rawActions: FeatureStoreAction[] | undefined): FeatureStoreAction[] {
    const defaults: FeatureStoreAction[] = ['invite', 'message'];
    const source = rawActions && rawActions.length > 0 ? rawActions : defaults;
    const normalized = Array.from(new Set(source.map((item) => item === 'message' ? 'message' : 'invite')));
    return normalized.sort();
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`);
    return `{${entries.join(',')}}`;
}

function deterministicBucket(seed: string, sampleKey: string): number {
    const digest = createHash('sha256').update(`${seed}|${sampleKey}`).digest();
    return digest.readUInt32BE(0) % 100;
}

function resolveSplit(bucket: number, trainPct: number, validationPct: number): FeatureDatasetSplit {
    if (bucket < trainPct) return 'train';
    if (bucket < (trainPct + validationPct)) return 'validation';
    return 'test';
}

function extractUtcTimeParts(eventAt: string): { hour: number; dayOfWeek: number } {
    const parsedMs = Date.parse(eventAt);
    if (!Number.isFinite(parsedMs)) {
        return { hour: 0, dayOfWeek: 0 };
    }
    const dt = new Date(parsedMs);
    return {
        hour: dt.getUTCHours(),
        dayOfWeek: dt.getUTCDay(),
    };
}

function buildSignatureLine(row: FeatureDatasetRowInput): string {
    return [
        row.sampleKey,
        row.action,
        String(row.leadId),
        row.eventAt,
        String(row.label),
        row.split,
        stableStringify(row.features),
        stableStringify(row.metadata ?? {}),
    ].join('|');
}

export function computeFeatureDatasetSignature(rows: FeatureDatasetRowInput[]): string {
    const hash = createHash('sha256');
    const ordered = [...rows].sort((left, right) => left.sampleKey.localeCompare(right.sampleKey));
    for (const row of ordered) {
        hash.update(buildSignatureLine(row));
        hash.update('\n');
    }
    return hash.digest('hex');
}

function normalizeIntent(raw: string | null | undefined): string {
    const normalized = (raw ?? '').trim().toUpperCase();
    return normalized || 'UNKNOWN';
}

function normalizeSubIntent(raw: string | null | undefined): string {
    const normalized = (raw ?? '').trim().toUpperCase();
    return normalized || 'NONE';
}

function normalizeTimingStrategy(raw: string | null | undefined): string {
    return (raw ?? '').trim().toLowerCase() === 'optimizer' ? 'optimizer' : 'baseline';
}

function sanitizeSplitConfig(
    splitTrainPctRaw: number | undefined,
    splitValidationPctRaw: number | undefined
): { trainPct: number; validationPct: number } {
    const trainPct = Math.max(1, Math.min(98, Math.floor(splitTrainPctRaw ?? FEATURE_SPLIT_TRAIN_DEFAULT)));
    const validationPct = Math.max(1, Math.min(98, Math.floor(splitValidationPctRaw ?? FEATURE_SPLIT_VALIDATION_DEFAULT)));
    if (trainPct + validationPct >= 100) {
        throw new Error('split train+validation deve essere < 100');
    }
    return { trainPct, validationPct };
}

function buildSourceStats(rows: FeatureDatasetRowInput[]): Record<string, unknown> {
    const counter: SourceStatsCounter = {
        total: rows.length,
        positive: 0,
        byAction: {},
        bySplit: {},
    };
    for (const row of rows) {
        if (row.label >= 1) counter.positive += 1;
        counter.byAction[row.action] = (counter.byAction[row.action] ?? 0) + 1;
        counter.bySplit[row.split] = (counter.bySplit[row.split] ?? 0) + 1;
    }
    return {
        total: counter.total,
        positive: counter.positive,
        positiveRate: counter.total > 0 ? Number.parseFloat((counter.positive / counter.total).toFixed(6)) : 0,
        byAction: counter.byAction,
        bySplit: counter.bySplit,
    };
}

function toBuildResult(
    row: FeatureDatasetVersionRecord,
    reusedExisting: boolean
): BuildFeatureDatasetResult {
    return {
        datasetName: row.dataset_name,
        datasetVersion: row.dataset_version,
        actionScope: row.action_scope,
        lookbackDays: row.lookback_days,
        splitTrainPct: row.split_train_pct,
        splitValidationPct: row.split_validation_pct,
        seed: row.seed,
        rowCount: row.row_count,
        signatureSha256: row.signature_sha256,
        sourceStats: parseJsonObject(row.source_stats_json),
        reusedExisting,
        generatedAt: row.generated_at,
    };
}

async function getExistingDatasetVersion(
    datasetName: string,
    datasetVersion: string
): Promise<FeatureDatasetVersionRecord | null> {
    const db = await getDatabase();
    const row = await db.get<FeatureDatasetVersionRecord>(
        `
        SELECT dataset_name, dataset_version, action_scope, lookback_days, split_train_pct, split_validation_pct,
               seed, row_count, signature_sha256, source_stats_json, metadata_json, generated_at
        FROM ml_feature_dataset_versions
        WHERE dataset_name = ?
          AND dataset_version = ?
        LIMIT 1
    `,
        [datasetName, datasetVersion]
    );
    return row ?? null;
}

function latestIntentJoinSql(): string {
    return `
        LEFT JOIN (
            SELECT li.lead_id, li.intent, li.sub_intent, li.confidence, li.analyzed_at
            FROM lead_intents li
            INNER JOIN (
                SELECT lead_id, MAX(analyzed_at) AS max_analyzed_at
                FROM lead_intents
                GROUP BY lead_id
            ) latest
                ON latest.lead_id = li.lead_id
               AND latest.max_analyzed_at = li.analyzed_at
        ) li_latest
            ON li_latest.lead_id = l.id
    `;
}

async function queryInviteRows(lookbackDays: number): Promise<RawFeatureSourceRow[]> {
    const db = await getDatabase();
    const safeLookback = Math.max(1, Math.floor(lookbackDays));
    return db.query<RawFeatureSourceRow>(
        `
        SELECT
            l.id AS lead_id,
            l.account_name,
            l.list_name,
            l.job_title,
            l.lead_score,
            l.confidence_score,
            l.follow_up_count,
            l.follow_up_sent_at,
            l.invited_at AS event_at,
            l.accepted_at,
            l.status,
            l.invite_timing_strategy AS timing_strategy,
            li_latest.intent AS intent,
            li_latest.sub_intent AS sub_intent,
            li_latest.confidence AS intent_confidence,
            li_latest.analyzed_at AS intent_analyzed_at
        FROM leads l
        ${latestIntentJoinSql()}
        WHERE l.invited_at IS NOT NULL
          AND l.invited_at >= DATETIME('now', '-${safeLookback} days')
    `
    );
}

async function queryMessageRows(lookbackDays: number): Promise<RawFeatureSourceRow[]> {
    const db = await getDatabase();
    const safeLookback = Math.max(1, Math.floor(lookbackDays));
    return db.query<RawFeatureSourceRow>(
        `
        SELECT
            l.id AS lead_id,
            l.account_name,
            l.list_name,
            l.job_title,
            l.lead_score,
            l.confidence_score,
            l.follow_up_count,
            l.follow_up_sent_at,
            l.messaged_at AS event_at,
            l.accepted_at,
            l.status,
            l.message_timing_strategy AS timing_strategy,
            li_latest.intent AS intent,
            li_latest.sub_intent AS sub_intent,
            li_latest.confidence AS intent_confidence,
            li_latest.analyzed_at AS intent_analyzed_at
        FROM leads l
        ${latestIntentJoinSql()}
        WHERE l.messaged_at IS NOT NULL
          AND l.messaged_at >= DATETIME('now', '-${safeLookback} days')
    `
    );
}

function buildRowInput(
    action: FeatureStoreAction,
    sourceRow: RawFeatureSourceRow,
    splitTrainPct: number,
    splitValidationPct: number,
    seed: string
): FeatureDatasetRowInput {
    const eventAt = sourceRow.event_at;
    const label = action === 'invite'
        ? (sourceRow.accepted_at ? 1 : 0)
        : ((sourceRow.status === 'REPLIED' || sourceRow.status === 'CONNECTED') ? 1 : 0);
    const sampleKey = `${action}:${sourceRow.lead_id}:${eventAt}`;
    const bucket = deterministicBucket(seed, sampleKey);
    const split = resolveSplit(bucket, splitTrainPct, splitValidationPct);
    const timeParts = extractUtcTimeParts(eventAt);
    const segment = inferLeadSegment(sourceRow.job_title);

    const features: Record<string, unknown> = {
        segment,
        listName: sourceRow.list_name,
        eventHour: timeParts.hour,
        eventDayOfWeek: timeParts.dayOfWeek,
        leadScore: sourceRow.lead_score ?? -1,
        confidenceScore: sourceRow.confidence_score ?? -1,
        followUpCount: sourceRow.follow_up_count ?? 0,
        hasRecentFollowUp: sourceRow.follow_up_sent_at ? 1 : 0,
        intent: normalizeIntent(sourceRow.intent),
        subIntent: normalizeSubIntent(sourceRow.sub_intent),
        intentConfidence: sourceRow.intent_confidence ?? 0,
        timingStrategy: normalizeTimingStrategy(sourceRow.timing_strategy),
    };

    const metadata: Record<string, unknown> = {
        accountName: sourceRow.account_name,
        eventAt,
        action,
        label,
        status: sourceRow.status ?? null,
        intentAnalyzedAt: sourceRow.intent_analyzed_at,
    };

    return {
        sampleKey,
        leadId: sourceRow.lead_id,
        action,
        eventAt,
        label,
        split,
        features,
        metadata,
    };
}

export async function buildFeatureDatasetVersion(
    options: BuildFeatureDatasetOptions
): Promise<BuildFeatureDatasetResult> {
    const datasetName = normalizeDatasetName(options.datasetName);
    const datasetVersion = normalizeDatasetVersion(options.datasetVersion);
    const actions = normalizeActions(options.actions);
    const lookbackDays = Math.max(1, Math.floor(options.lookbackDays ?? FEATURE_LOOKBACK_DAYS_DEFAULT));
    const splitConfig = sanitizeSplitConfig(options.splitTrainPct, options.splitValidationPct);
    const seed = normalizeTextValue(options.seed ?? FEATURE_SEED_DEFAULT) || FEATURE_SEED_DEFAULT;
    const forceRebuild = options.forceRebuild === true;

    const existing = await getExistingDatasetVersion(datasetName, datasetVersion);
    if (existing && !forceRebuild) {
        return toBuildResult(existing, true);
    }

    const sourceRows: FeatureDatasetRowInput[] = [];
    if (actions.includes('invite')) {
        const inviteRows = await queryInviteRows(lookbackDays);
        for (const row of inviteRows) {
            sourceRows.push(buildRowInput('invite', row, splitConfig.trainPct, splitConfig.validationPct, seed));
        }
    }
    if (actions.includes('message')) {
        const messageRows = await queryMessageRows(lookbackDays);
        for (const row of messageRows) {
            sourceRows.push(buildRowInput('message', row, splitConfig.trainPct, splitConfig.validationPct, seed));
        }
    }

    sourceRows.sort((left, right) => left.sampleKey.localeCompare(right.sampleKey));
    const signatureSha256 = computeFeatureDatasetSignature(sourceRows);
    const sourceStats = buildSourceStats(sourceRows);
    const actionScope = actions.join(',');
    const metadata = options.metadata ?? {};
    const db = await getDatabase();

    await withTransaction(db, async () => {
        if (existing) {
            await db.run(
                `DELETE FROM ml_feature_store WHERE dataset_name = ? AND dataset_version = ?`,
                [datasetName, datasetVersion]
            );
            await db.run(
                `DELETE FROM ml_feature_dataset_versions WHERE dataset_name = ? AND dataset_version = ?`,
                [datasetName, datasetVersion]
            );
        }

        for (const row of sourceRows) {
            await db.run(
                `
                INSERT INTO ml_feature_store (
                    dataset_name, dataset_version, sample_key, lead_id, action, event_at, label, split, features_json, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
                [
                    datasetName,
                    datasetVersion,
                    row.sampleKey,
                    row.leadId,
                    row.action,
                    row.eventAt,
                    row.label,
                    row.split,
                    JSON.stringify(row.features),
                    JSON.stringify(row.metadata ?? {}),
                ]
            );
        }

        await db.run(
            `
            INSERT INTO ml_feature_dataset_versions (
                dataset_name, dataset_version, action_scope, lookback_days, split_train_pct, split_validation_pct,
                seed, row_count, signature_sha256, source_stats_json, metadata_json, generated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `,
            [
                datasetName,
                datasetVersion,
                actionScope,
                lookbackDays,
                splitConfig.trainPct,
                splitConfig.validationPct,
                seed,
                sourceRows.length,
                signatureSha256,
                JSON.stringify(sourceStats),
                JSON.stringify(metadata),
            ]
        );
    });

    const saved = await getExistingDatasetVersion(datasetName, datasetVersion);
    if (!saved) {
        throw new Error('Salvataggio dataset feature store fallito');
    }
    return toBuildResult(saved, false);
}

export async function importFeatureDatasetVersion(
    input: ImportFeatureDatasetInput
): Promise<BuildFeatureDatasetResult> {
    const datasetName = normalizeDatasetName(input.datasetName);
    const datasetVersion = normalizeDatasetVersion(input.datasetVersion);
    const lookbackDays = Math.max(1, Math.floor(input.lookbackDays));
    const splitConfig = sanitizeSplitConfig(input.splitTrainPct, input.splitValidationPct);
    const seed = normalizeTextValue(input.seed || FEATURE_SEED_DEFAULT) || FEATURE_SEED_DEFAULT;
    const rows = [...input.rows].sort((left, right) => left.sampleKey.localeCompare(right.sampleKey));
    const computedSignature = computeFeatureDatasetSignature(rows);
    const expectedSignature = normalizeTextValue(input.signatureSha256 || computedSignature) || computedSignature;
    if (computedSignature !== expectedSignature) {
        throw new Error('Signature dataset non valida: contenuto rows non coerente con signature dichiarata');
    }

    const existing = await getExistingDatasetVersion(datasetName, datasetVersion);
    if (existing && !input.forceRebuild) {
        throw new Error(`Dataset già presente: ${datasetName}@${datasetVersion}. Usa forceRebuild per sovrascrivere.`);
    }

    const db = await getDatabase();
    const sourceStats = input.sourceStats ?? buildSourceStats(rows);
    const actionScope = normalizeTextValue(input.actionScope) || normalizeActions(undefined).join(',');
    const metadata = input.metadata ?? {};

    await withTransaction(db, async () => {
        if (existing) {
            await db.run(
                `DELETE FROM ml_feature_store WHERE dataset_name = ? AND dataset_version = ?`,
                [datasetName, datasetVersion]
            );
            await db.run(
                `DELETE FROM ml_feature_dataset_versions WHERE dataset_name = ? AND dataset_version = ?`,
                [datasetName, datasetVersion]
            );
        }

        for (const row of rows) {
            await db.run(
                `
                INSERT INTO ml_feature_store (
                    dataset_name, dataset_version, sample_key, lead_id, action, event_at, label, split, features_json, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
                [
                    datasetName,
                    datasetVersion,
                    row.sampleKey,
                    row.leadId,
                    row.action,
                    row.eventAt,
                    Math.max(0, Math.min(1, Math.floor(row.label))),
                    row.split,
                    JSON.stringify(row.features ?? {}),
                    JSON.stringify(row.metadata ?? {}),
                ]
            );
        }

        await db.run(
            `
            INSERT INTO ml_feature_dataset_versions (
                dataset_name, dataset_version, action_scope, lookback_days, split_train_pct, split_validation_pct,
                seed, row_count, signature_sha256, source_stats_json, metadata_json, generated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `,
            [
                datasetName,
                datasetVersion,
                actionScope,
                lookbackDays,
                splitConfig.trainPct,
                splitConfig.validationPct,
                seed,
                rows.length,
                expectedSignature,
                JSON.stringify(sourceStats),
                JSON.stringify(metadata),
            ]
        );
    });

    const saved = await getExistingDatasetVersion(datasetName, datasetVersion);
    if (!saved) {
        throw new Error('Import dataset feature store fallito');
    }
    return toBuildResult(saved, false);
}

export async function getFeatureDatasetVersion(
    datasetName: string,
    datasetVersion: string
): Promise<FeatureDatasetVersionRecord | null> {
    const normalizedName = normalizeDatasetName(datasetName);
    const normalizedVersion = normalizeExistingDatasetVersion(datasetVersion);
    return getExistingDatasetVersion(normalizedName, normalizedVersion);
}

export async function listFeatureDatasetVersions(
    limit: number = 20,
    datasetName?: string
): Promise<FeatureDatasetVersionRecord[]> {
    const db = await getDatabase();
    const safeLimit = Math.max(1, Math.floor(limit));
    if (datasetName && normalizeTextValue(datasetName)) {
        const normalizedName = normalizeDatasetName(datasetName);
        return db.query<FeatureDatasetVersionRecord>(
            `
            SELECT dataset_name, dataset_version, action_scope, lookback_days, split_train_pct, split_validation_pct,
                   seed, row_count, signature_sha256, source_stats_json, metadata_json, generated_at
            FROM ml_feature_dataset_versions
            WHERE dataset_name = ?
            ORDER BY generated_at DESC, dataset_version DESC
            LIMIT ?
        `,
            [normalizedName, safeLimit]
        );
    }

    return db.query<FeatureDatasetVersionRecord>(
        `
        SELECT dataset_name, dataset_version, action_scope, lookback_days, split_train_pct, split_validation_pct,
               seed, row_count, signature_sha256, source_stats_json, metadata_json, generated_at
        FROM ml_feature_dataset_versions
        ORDER BY generated_at DESC, dataset_name ASC, dataset_version DESC
        LIMIT ?
    `,
        [safeLimit]
    );
}

export async function getFeatureDatasetRows(
    datasetName: string,
    datasetVersion: string,
    limit?: number
): Promise<FeatureDatasetRowRecord[]> {
    const db = await getDatabase();
    const normalizedName = normalizeDatasetName(datasetName);
    const normalizedVersion = normalizeExistingDatasetVersion(datasetVersion);
    if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
        return db.query<FeatureDatasetRowRecord>(
            `
            SELECT dataset_name, dataset_version, sample_key, lead_id, action, event_at, label, split, features_json, metadata_json, created_at
            FROM ml_feature_store
            WHERE dataset_name = ?
              AND dataset_version = ?
            ORDER BY sample_key ASC
            LIMIT ?
        `,
            [normalizedName, normalizedVersion, Math.floor(limit)]
        );
    }

    return db.query<FeatureDatasetRowRecord>(
        `
        SELECT dataset_name, dataset_version, sample_key, lead_id, action, event_at, label, split, features_json, metadata_json, created_at
        FROM ml_feature_store
        WHERE dataset_name = ?
          AND dataset_version = ?
        ORDER BY sample_key ASC
    `,
        [normalizedName, normalizedVersion]
    );
}
