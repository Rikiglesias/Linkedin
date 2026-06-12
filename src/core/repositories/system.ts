/**
 * repositories/system.ts
 * Domain queries: outbox, runtime locks/flags, logs, privacy cleanup, cloud downsync.
 */

import { getDatabase } from '../../db';
import { OutboxEventRecord } from '../../types/domain';
import type { CloudAccount, CloudLeadUpsert } from '../../cloud/types';
import { getCorrelationId } from '../../telemetry/correlation';
import {
    type AcquireRuntimeLockResult,
    type AccountHealthSnapshotInput,
    type AccountHealthSnapshotRecord,
    type AutomationPauseState,
    type BackupRunRecord,
    type PrivacyCleanupStats,
    type RuntimeLockRecord,
    type SecretRotationStatus,
    type SecurityAuditEventInput,
    type SecurityAuditEventRecord,
} from '../repositories.types';
import { incrementLockMetric, getLockContentionSummary, listLockMetricsByDate } from './lockMetrics';
import { OUTBOX_SELECT_COLUMNS, RUNTIME_LOCK_SELECT_COLUMNS } from './sqlColumns';
import { withTransaction } from './shared';
import { ensureOutboxEventDeliveries, getActiveOutboxSinks } from './outboxDeliveries';

export { getLockContentionSummary, listLockMetricsByDate };

let _governanceTablesCreated = false;
async function ensureGovernanceTables(): Promise<void> {
    if (_governanceTablesCreated) return;
    const db = await getDatabase();
    await db.exec(`
        CREATE TABLE IF NOT EXISTS backup_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            backup_type TEXT NOT NULL,
            target TEXT NOT NULL,
            status TEXT NOT NULL,
            backup_path TEXT,
            checksum_sha256 TEXT,
            duration_ms INTEGER,
            details_json TEXT NOT NULL DEFAULT '{}',
            started_at TEXT NOT NULL DEFAULT (datetime('now')),
            finished_at TEXT
        );
    `);
    await db.exec(`
        CREATE TABLE IF NOT EXISTS security_audit_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            action TEXT NOT NULL,
            actor TEXT,
            account_id TEXT,
            entity_type TEXT,
            entity_id TEXT,
            result TEXT NOT NULL,
            correlation_id TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);
    await db.exec(`
        CREATE TABLE IF NOT EXISTS account_health_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id TEXT NOT NULL,
            queue_processed INTEGER NOT NULL DEFAULT 0,
            queue_failed INTEGER NOT NULL DEFAULT 0,
            challenges INTEGER NOT NULL DEFAULT 0,
            dead_letters INTEGER NOT NULL DEFAULT 0,
            health TEXT NOT NULL DEFAULT 'GREEN',
            reason TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            observed_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);
    await db.exec(`
        CREATE TABLE IF NOT EXISTS secret_inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            secret_name TEXT NOT NULL UNIQUE,
            owner TEXT,
            rotated_at TEXT NOT NULL,
            expires_at TEXT,
            notes TEXT,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);
    _governanceTablesCreated = true;
}

export async function pushOutboxEvent(
    topic: string,
    payload: Record<string, unknown>,
    idempotencyKey: string,
): Promise<void> {
    const db = await getDatabase();
    const correlationId = getCorrelationId();
    const enrichedPayload = correlationId ? { ...payload, correlationId } : payload;
    const activeSinks = getActiveOutboxSinks();

    await withTransaction(db, async () => {
        await db.run(
            `
            INSERT OR IGNORE INTO outbox_events (topic, payload_json, idempotency_key)
            VALUES (?, ?, ?)
        `,
            [topic, JSON.stringify(enrichedPayload), idempotencyKey],
        );

        const eventRow = await db.get<{ id: number }>(
            `SELECT id
               FROM outbox_events
              WHERE idempotency_key = ?
              LIMIT 1`,
            [idempotencyKey],
        );
        if (!eventRow) {
            throw new Error(`Outbox event non trovato per idempotency_key=${idempotencyKey}`);
        }

        await ensureOutboxEventDeliveries(db, eventRow.id, activeSinks);
    });
}

export async function getPendingOutboxEvents(limit: number): Promise<OutboxEventRecord[]> {
    const db = await getDatabase();
    const safeLimit = Math.max(1, Math.floor(limit));
    return db.query<OutboxEventRecord>(
        `
        SELECT ${OUTBOX_SELECT_COLUMNS} FROM outbox_events
        WHERE delivered_at IS NULL
          AND next_retry_at <= CURRENT_TIMESTAMP
          AND (processing_expires_at IS NULL OR processing_expires_at <= CURRENT_TIMESTAMP)
        ORDER BY created_at ASC
        LIMIT ?
    `,
        [safeLimit],
    );
}

export async function claimPendingOutboxEvents(
    limit: number,
    ownerId: string,
    leaseSeconds: number,
): Promise<OutboxEventRecord[]> {
    const db = await getDatabase();
    const safeLimit = Math.max(1, Math.floor(limit));
    const safeLeaseSeconds = Math.max(5, Math.floor(leaseSeconds));
    const normalizedOwner = ownerId.trim() || 'outbox-worker';

    return withTransaction(db, async () => {
        const candidateRows = await db.query<{ id: number }>(
            `
            SELECT id
            FROM outbox_events
            WHERE delivered_at IS NULL
              AND next_retry_at <= CURRENT_TIMESTAMP
              AND (processing_expires_at IS NULL OR processing_expires_at <= CURRENT_TIMESTAMP)
            ORDER BY created_at ASC
            LIMIT ?
        `,
            [Math.max(safeLimit * 4, safeLimit)],
        );

        const claimedIds: number[] = [];
        for (const candidate of candidateRows) {
            if (claimedIds.length >= safeLimit) {
                break;
            }

            const claimResult = await db.run(
                `
                UPDATE outbox_events
                SET processing_owner = ?,
                    processing_started_at = CURRENT_TIMESTAMP,
                    processing_expires_at = DATETIME('now', '+' || ? || ' seconds')
                WHERE id = ?
                  AND delivered_at IS NULL
                  AND next_retry_at <= CURRENT_TIMESTAMP
                  AND (processing_expires_at IS NULL OR processing_expires_at <= CURRENT_TIMESTAMP)
            `,
                [normalizedOwner, safeLeaseSeconds, candidate.id],
            );
            if ((claimResult.changes ?? 0) > 0) {
                claimedIds.push(candidate.id);
            }
        }

        if (claimedIds.length === 0) {
            return [];
        }

        const placeholders = claimedIds.map(() => '?').join(', ');
        return db.query<OutboxEventRecord>(
            `
            SELECT ${OUTBOX_SELECT_COLUMNS}
            FROM outbox_events
            WHERE id IN (${placeholders})
            ORDER BY created_at ASC
        `,
            claimedIds,
        );
    });
}

export async function markOutboxDeliveredClaimed(eventId: number, ownerId: string): Promise<boolean> {
    const db = await getDatabase();
    const result = await db.run(
        `
        UPDATE outbox_events
        SET delivered_at = CURRENT_TIMESTAMP,
            last_error = NULL,
            processing_owner = NULL,
            processing_started_at = NULL,
            processing_expires_at = NULL
        WHERE id = ?
          AND delivered_at IS NULL
          AND processing_owner = ?
    `,
        [eventId, ownerId],
    );
    return (result.changes ?? 0) > 0;
}

export async function markOutboxRetryClaimed(
    eventId: number,
    ownerId: string,
    attempts: number,
    retryDelayMs: number,
    errorMessage: string,
): Promise<boolean> {
    const db = await getDatabase();
    const seconds = Math.max(1, Math.ceil(retryDelayMs / 1000));
    const result = await db.run(
        `
        UPDATE outbox_events
        SET attempts = ?,
            next_retry_at = DATETIME('now', '+' || ? || ' seconds'),
            last_error = ?,
            processing_owner = NULL,
            processing_started_at = NULL,
            processing_expires_at = NULL
        WHERE id = ?
          AND delivered_at IS NULL
          AND processing_owner = ?
    `,
        [attempts, seconds, errorMessage, eventId, ownerId],
    );
    return (result.changes ?? 0) > 0;
}

export async function markOutboxPermanentFailureClaimed(
    eventId: number,
    ownerId: string,
    attempts: number,
    errorMessage: string,
): Promise<boolean> {
    const db = await getDatabase();
    const result = await db.run(
        `
        UPDATE outbox_events
        SET attempts = ?,
            delivered_at = CURRENT_TIMESTAMP,
            last_error = ?,
            processing_owner = NULL,
            processing_started_at = NULL,
            processing_expires_at = NULL
        WHERE id = ?
          AND delivered_at IS NULL
          AND processing_owner = ?
    `,
        [attempts, `PERMANENT_FAILURE: ${errorMessage}`, eventId, ownerId],
    );
    return (result.changes ?? 0) > 0;
}

export async function markOutboxDelivered(eventId: number): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        UPDATE outbox_events
        SET delivered_at = CURRENT_TIMESTAMP,
            last_error = NULL,
            processing_owner = NULL,
            processing_started_at = NULL,
            processing_expires_at = NULL
        WHERE id = ?
    `,
        [eventId],
    );
}

export async function markOutboxRetry(
    eventId: number,
    attempts: number,
    retryDelayMs: number,
    errorMessage: string,
): Promise<void> {
    const db = await getDatabase();
    const seconds = Math.max(1, Math.ceil(retryDelayMs / 1000));
    await db.run(
        `
        UPDATE outbox_events
        SET attempts = ?,
            next_retry_at = DATETIME('now', '+' || ? || ' seconds'),
            last_error = ?,
            processing_owner = NULL,
            processing_started_at = NULL,
            processing_expires_at = NULL
        WHERE id = ?
    `,
        [attempts, seconds, errorMessage, eventId],
    );
}

export async function markOutboxPermanentFailure(
    eventId: number,
    attempts: number,
    errorMessage: string,
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        UPDATE outbox_events
        SET attempts = ?,
            delivered_at = CURRENT_TIMESTAMP,
            last_error = ?,
            processing_owner = NULL,
            processing_started_at = NULL,
            processing_expires_at = NULL
        WHERE id = ?
    `,
        [attempts, `PERMANENT_FAILURE: ${errorMessage}`, eventId],
    );
}

export async function countPendingOutboxEvents(): Promise<number> {
    const db = await getDatabase();
    const row = await db.get<{ total: number }>(
        `SELECT COUNT(*) as total FROM outbox_events WHERE delivered_at IS NULL`,
    );
    return row?.total ?? 0;
}

export async function getRuntimeLock(lockKey: string): Promise<RuntimeLockRecord | null> {
    const db = await getDatabase();
    const row = await db.get<RuntimeLockRecord>(
        `SELECT ${RUNTIME_LOCK_SELECT_COLUMNS} FROM runtime_locks WHERE lock_key = ?`,
        [lockKey],
    );
    return row ?? null;
}

export async function acquireRuntimeLock(
    lockKey: string,
    ownerId: string,
    ttlSeconds: number,
    metadata: Record<string, unknown> = {},
): Promise<AcquireRuntimeLockResult> {
    const db = await getDatabase();
    const safeTtl = Math.max(1, ttlSeconds);
    const metadataJson = JSON.stringify(metadata);

    return withTransaction(db, async () => {
        const existing = await db.get<RuntimeLockRecord>(
            `SELECT ${RUNTIME_LOCK_SELECT_COLUMNS} FROM runtime_locks WHERE lock_key = ?`,
            [lockKey],
        );

        if (!existing) {
            await db.run(
                `
                INSERT INTO runtime_locks (lock_key, owner_id, metadata_json, expires_at)
                VALUES (?, ?, ?, DATETIME('now', '+' || ? || ' seconds'))
            `,
                [lockKey, ownerId, metadataJson, safeTtl],
            );
            const inserted = await db.get<RuntimeLockRecord>(
                `SELECT ${RUNTIME_LOCK_SELECT_COLUMNS} FROM runtime_locks WHERE lock_key = ?`,
                [lockKey],
            );
            return {
                acquired: true,
                lock: inserted ?? null,
            };
        }

        if (existing.owner_id === ownerId) {
            await db.run(
                `
                UPDATE runtime_locks
                SET heartbeat_at = CURRENT_TIMESTAMP,
                    expires_at = DATETIME('now', '+' || ? || ' seconds'),
                    metadata_json = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE lock_key = ?
            `,
                [safeTtl, metadataJson, lockKey],
            );
            const renewed = await db.get<RuntimeLockRecord>(
                `SELECT ${RUNTIME_LOCK_SELECT_COLUMNS} FROM runtime_locks WHERE lock_key = ?`,
                [lockKey],
            );
            return {
                acquired: true,
                lock: renewed ?? null,
            };
        }

        // H12 fix (resilience/anti-ban): takeover ATOMICO del lock stale. Prima un SELECT separato
        // valutava la staleness e l'UPDATE aveva solo WHERE lock_key=? → due runner concorrenti
        // potevano entrambi superare il SELECT e sovrascrivere il lock = DOPPIO workflow runner
        // sullo stesso account (volume doppio, azioni concorrenti = rischio ban). Ora l'UPDATE e'
        // condizionale e atomico (AND expires_at <= CURRENT_TIMESTAMP): solo il primo runner ottiene
        // changes>0; il secondo, dopo il row-lock, rivaluta il WHERE e trova expires_at gia'
        // rinnovato → changes=0 → acquired:false. Nessun SELECT-then-UPDATE TOCTOU.
        const takeover = await db.run(
            `
                UPDATE runtime_locks
                SET owner_id = ?,
                    acquired_at = CURRENT_TIMESTAMP,
                    heartbeat_at = CURRENT_TIMESTAMP,
                    expires_at = DATETIME('now', '+' || ? || ' seconds'),
                    metadata_json = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE lock_key = ? AND expires_at <= CURRENT_TIMESTAMP
            `,
            [ownerId, safeTtl, metadataJson, lockKey],
        );

        if ((takeover?.changes ?? 0) > 0) {
            await incrementLockMetric(lockKey, 'acquire_stale_takeover');
            const takenOver = await db.get<RuntimeLockRecord>(
                `SELECT ${RUNTIME_LOCK_SELECT_COLUMNS} FROM runtime_locks WHERE lock_key = ?`,
                [lockKey],
            );
            return {
                acquired: true,
                lock: takenOver ?? null,
            };
        }

        await incrementLockMetric(lockKey, 'acquire_contended');

        return {
            acquired: false,
            lock: existing,
        };
    });
}

export async function heartbeatRuntimeLock(lockKey: string, ownerId: string, ttlSeconds: number): Promise<boolean> {
    const db = await getDatabase();
    const safeTtl = Math.max(1, ttlSeconds);
    const result = await db.run(
        `
        UPDATE runtime_locks
        SET heartbeat_at = CURRENT_TIMESTAMP,
            expires_at = DATETIME('now', '+' || ? || ' seconds'),
            updated_at = CURRENT_TIMESTAMP
        WHERE lock_key = ?
          AND owner_id = ?
    `,
        [safeTtl, lockKey, ownerId],
    );
    const ok = (result.changes ?? 0) > 0;
    if (!ok) {
        await incrementLockMetric(lockKey, 'heartbeat_miss');
    }
    return ok;
}

export async function releaseRuntimeLock(lockKey: string, ownerId: string): Promise<boolean> {
    const db = await getDatabase();
    const result = await db.run(
        `
        DELETE FROM runtime_locks
        WHERE lock_key = ?
          AND owner_id = ?
    `,
        [lockKey, ownerId],
    );
    const released = (result.changes ?? 0) > 0;
    if (!released) {
        await incrementLockMetric(lockKey, 'release_miss');
    }
    return released;
}

export async function setRuntimeFlag(key: string, value: string): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `,
        [key, value],
    );
}

export async function getRuntimeFlag(key: string): Promise<string | null> {
    const db = await getDatabase();
    const row = await db.get<{ value: string }>(`SELECT value FROM sync_state WHERE key = ?`, [key]);
    return row?.value ?? null;
}

// ── Quarantena per-account (G5-F2) ─────────────────────────────────────────
// Chiave composta `account_quarantine:<accountId>` (stesso pattern di
// `browser_session_ended_at:<id>`). Il flag GLOBALE legacy `account_quarantine`
// resta valido e blocca TUTTI gli account: è sia backward-compat (quarantene
// scritte prima del per-account) sia fail-safe per incidenti non attribuibili
// a un account specifico (meglio fermare tutto che non fermare quello giusto).

const ACCOUNT_QUARANTINE_FLAG = 'account_quarantine';

function accountQuarantineKey(accountId: string): string {
    return `${ACCOUNT_QUARANTINE_FLAG}:${accountId}`;
}

function normalizeQuarantineAccountId(accountId: string | null | undefined): string {
    const trimmed = (accountId ?? '').trim();
    return trimmed.length > 0 ? trimmed : 'default';
}

/**
 * Attiva/disattiva la quarantena per un account. `accountId` assente o 'default'
 * (incidente non attribuibile) scrive il flag GLOBALE legacy → blocca tutti.
 */
export async function setAccountQuarantine(accountId: string | null | undefined, enabled: boolean): Promise<void> {
    const normalized = normalizeQuarantineAccountId(accountId);
    const key = normalized === 'default' ? ACCOUNT_QUARANTINE_FLAG : accountQuarantineKey(normalized);
    await setRuntimeFlag(key, enabled ? 'true' : 'false');
}

/**
 * True se l'account è in quarantena: flag per-account O flag globale legacy
 * (un flag globale attivo blocca OGNI account, qualunque sia il suo id).
 */
export async function getAccountQuarantine(accountId: string | null | undefined): Promise<boolean> {
    const normalized = normalizeQuarantineAccountId(accountId);
    if (normalized !== 'default') {
        const perAccount = await getRuntimeFlag(accountQuarantineKey(normalized));
        if (perAccount === 'true') {
            return true;
        }
    }
    return (await getRuntimeFlag(ACCOUNT_QUARANTINE_FLAG)) === 'true';
}

export interface QuarantineStatus {
    /** Flag globale legacy / non attribuito: blocca TUTTI gli account. */
    global: boolean;
    /** Account con quarantena per-account attiva. */
    accounts: string[];
    /** Almeno una quarantena attiva (globale o per-account). */
    any: boolean;
}

/** Stato aggregato per doctor/admin/API: flag globale + elenco account in quarantena. */
export async function getQuarantineStatus(): Promise<QuarantineStatus> {
    const db = await getDatabase();
    const rows = await db.query<{ key: string }>(
        `SELECT key FROM sync_state WHERE key LIKE ? AND value = 'true'`,
        [`${ACCOUNT_QUARANTINE_FLAG}:%`],
    );
    const accounts = rows.map((row) => row.key.slice(ACCOUNT_QUARANTINE_FLAG.length + 1));
    const global = (await getRuntimeFlag(ACCOUNT_QUARANTINE_FLAG)) === 'true';
    return { global, accounts, any: global || accounts.length > 0 };
}

export async function setAutomationPause(minutes: number | null, reason: string): Promise<string | null> {
    await setRuntimeFlag('automation_paused', 'true');
    await setRuntimeFlag('automation_pause_reason', reason.trim() || 'manual_pause');

    if (minutes === null) {
        await setRuntimeFlag('automation_paused_until', '');
        return null;
    }

    const safeMinutes = Math.max(1, minutes);
    const until = new Date(Date.now() + safeMinutes * 60_000).toISOString();
    await setRuntimeFlag('automation_paused_until', until);
    return until;
}

export async function clearAutomationPause(): Promise<void> {
    await setRuntimeFlag('automation_paused', 'false');
    await setRuntimeFlag('automation_paused_until', '');
    await setRuntimeFlag('automation_pause_reason', '');
}

export async function getAutomationPauseState(now: Date = new Date()): Promise<AutomationPauseState> {
    const paused = (await getRuntimeFlag('automation_paused')) === 'true';
    if (!paused) {
        return {
            paused: false,
            pausedUntil: null,
            reason: null,
            remainingSeconds: null,
        };
    }

    const reasonRaw = await getRuntimeFlag('automation_pause_reason');
    const untilRaw = await getRuntimeFlag('automation_paused_until');
    const parsedUntil = untilRaw && Number.isFinite(Date.parse(untilRaw)) ? new Date(untilRaw).toISOString() : null;

    if (parsedUntil && Date.parse(parsedUntil) <= now.getTime()) {
        await clearAutomationPause();
        return {
            paused: false,
            pausedUntil: null,
            reason: null,
            remainingSeconds: null,
        };
    }

    const remainingSeconds = parsedUntil
        ? Math.max(0, Math.ceil((Date.parse(parsedUntil) - now.getTime()) / 1000))
        : null;

    return {
        paused: true,
        pausedUntil: parsedUntil,
        reason: reasonRaw && reasonRaw.trim() ? reasonRaw : null,
        remainingSeconds,
    };
}

export async function recordRunLog(
    level: 'INFO' | 'WARN' | 'ERROR',
    event: string,
    payload: Record<string, unknown>,
): Promise<void> {
    try {
        const db = await getDatabase();
        await db.run(
            `
        INSERT INTO run_logs (level, event, payload_json)
        VALUES (?, ?, ?)
    `,
            [level, event, JSON.stringify(payload)],
        );
    } catch {
        // DB logging is best-effort — never propagate to callers
    }
}

export async function getLastRunLogs(
    limit: number,
): Promise<Array<{ level: string; event: string; payload_json: string; created_at: string }>> {
    const db = await getDatabase();
    return db.query(`SELECT level, event, payload_json, created_at FROM run_logs ORDER BY created_at DESC LIMIT ?`, [
        limit,
    ]);
}

export async function recordBackupRunStarted(
    backupType: string,
    target: string,
    details: Record<string, unknown> = {},
): Promise<number> {
    await ensureGovernanceTables();
    const db = await getDatabase();
    const result = await db.run(
        `
        INSERT INTO backup_runs (backup_type, target, status, details_json)
        VALUES (?, ?, 'RUNNING', ?)
    `,
        [backupType, target, JSON.stringify(details)],
    );
    return result.lastID ?? 0;
}

export async function finalizeBackupRun(
    runId: number,
    status: 'SUCCEEDED' | 'FAILED',
    patch: {
        backupPath?: string | null;
        checksumSha256?: string | null;
        durationMs?: number | null;
        details?: Record<string, unknown>;
    } = {},
): Promise<void> {
    await ensureGovernanceTables();
    const db = await getDatabase();
    await db.run(
        `
        UPDATE backup_runs
        SET status = ?,
            backup_path = ?,
            checksum_sha256 = ?,
            duration_ms = ?,
            details_json = CASE
                WHEN ? IS NULL THEN details_json
                ELSE ?
            END,
            finished_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [
            status,
            patch.backupPath ?? null,
            patch.checksumSha256 ?? null,
            patch.durationMs ?? null,
            patch.details ? JSON.stringify(patch.details) : null,
            patch.details ? JSON.stringify(patch.details) : null,
            runId,
        ],
    );
}

export async function listRecentBackupRuns(limit: number = 20): Promise<BackupRunRecord[]> {
    await ensureGovernanceTables();
    const db = await getDatabase();
    return db.query<BackupRunRecord>(
        `
        SELECT id, backup_type, target, status, backup_path, checksum_sha256, duration_ms, details_json, started_at, finished_at
        FROM backup_runs
        ORDER BY started_at DESC, id DESC
        LIMIT ?
    `,
        [Math.max(1, limit)],
    );
}

export async function recordSecurityAuditEvent(input: SecurityAuditEventInput): Promise<number> {
    await ensureGovernanceTables();
    const db = await getDatabase();
    const correlationId = getCorrelationId();
    const result = await db.run(
        `
        INSERT INTO security_audit_events (
            category,
            action,
            actor,
            account_id,
            entity_type,
            entity_id,
            result,
            correlation_id,
            metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
        [
            input.category,
            input.action,
            input.actor ?? null,
            input.accountId ?? null,
            input.entityType ?? null,
            input.entityId ?? null,
            input.result,
            correlationId ?? null,
            JSON.stringify(input.metadata ?? {}),
        ],
    );
    return result.lastID ?? 0;
}

export async function listSecurityAuditEvents(
    limit: number = 50,
    category?: string,
): Promise<SecurityAuditEventRecord[]> {
    await ensureGovernanceTables();
    const db = await getDatabase();
    if (category && category.trim()) {
        return db.query<SecurityAuditEventRecord>(
            `
            SELECT id, category, action, actor, account_id, entity_type, entity_id, result, correlation_id, metadata_json, created_at
            FROM security_audit_events
            WHERE category = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ?
        `,
            [category.trim(), Math.max(1, limit)],
        );
    }
    return db.query<SecurityAuditEventRecord>(
        `
        SELECT id, category, action, actor, account_id, entity_type, entity_id, result, correlation_id, metadata_json, created_at
        FROM security_audit_events
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `,
        [Math.max(1, limit)],
    );
}

export async function countSecurityAuditEventsSince(sinceIso: string, category?: string): Promise<number> {
    await ensureGovernanceTables();
    const db = await getDatabase();
    if (category && category.trim()) {
        const row = await db.get<{ total: number }>(
            `
            SELECT COUNT(*) as total
            FROM security_audit_events
            WHERE created_at >= ?
              AND category = ?
        `,
            [sinceIso, category.trim()],
        );
        return row?.total ?? 0;
    }

    const row = await db.get<{ total: number }>(
        `
        SELECT COUNT(*) as total
        FROM security_audit_events
        WHERE created_at >= ?
    `,
        [sinceIso],
    );
    return row?.total ?? 0;
}

export async function recordAccountHealthSnapshot(input: AccountHealthSnapshotInput): Promise<void> {
    await ensureGovernanceTables();
    const db = await getDatabase();
    await db.run(
        `
        INSERT INTO account_health_snapshots (
            account_id,
            queue_processed,
            queue_failed,
            challenges,
            dead_letters,
            health,
            reason,
            metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
        [
            input.accountId.trim() || 'default',
            Math.max(0, Math.floor(input.queueProcessed)),
            Math.max(0, Math.floor(input.queueFailed)),
            Math.max(0, Math.floor(input.challenges)),
            Math.max(0, Math.floor(input.deadLetters)),
            input.health,
            input.reason ?? null,
            JSON.stringify(input.metadata ?? {}),
        ],
    );
}

export async function listLatestAccountHealthSnapshots(limit: number = 20): Promise<AccountHealthSnapshotRecord[]> {
    await ensureGovernanceTables();
    const db = await getDatabase();
    return db.query<AccountHealthSnapshotRecord>(
        `
        SELECT h.id, h.account_id, h.queue_processed, h.queue_failed, h.challenges, h.dead_letters, h.health, h.reason, h.metadata_json, h.observed_at
        FROM account_health_snapshots h
        JOIN (
            SELECT account_id, MAX(observed_at) AS max_observed_at
            FROM account_health_snapshots
            GROUP BY account_id
        ) latest
            ON latest.account_id = h.account_id
           AND latest.max_observed_at = h.observed_at
        ORDER BY h.observed_at DESC, h.id DESC
        LIMIT ?
    `,
        [Math.max(1, limit)],
    );
}

export async function listAccountHealthSnapshots(
    accountId: string,
    limit: number = 50,
): Promise<AccountHealthSnapshotRecord[]> {
    await ensureGovernanceTables();
    const db = await getDatabase();
    return db.query<AccountHealthSnapshotRecord>(
        `
        SELECT id, account_id, queue_processed, queue_failed, challenges, dead_letters, health, reason, metadata_json, observed_at
        FROM account_health_snapshots
        WHERE account_id = ?
        ORDER BY observed_at DESC, id DESC
        LIMIT ?
    `,
        [accountId.trim() || 'default', Math.max(1, limit)],
    );
}

export async function upsertSecretRotation(
    secretName: string,
    rotatedAtIso: string,
    owner: string | null,
    expiresAtIso: string | null,
    notes: string | null,
): Promise<void> {
    await ensureGovernanceTables();
    const db = await getDatabase();
    await db.run(
        `
        INSERT INTO secret_inventory (secret_name, owner, rotated_at, expires_at, notes, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(secret_name) DO UPDATE SET
            owner = excluded.owner,
            rotated_at = excluded.rotated_at,
            expires_at = excluded.expires_at,
            notes = excluded.notes,
            updated_at = CURRENT_TIMESTAMP
    `,
        [secretName.trim(), owner, rotatedAtIso, expiresAtIso, notes],
    );
}

function resolveSecretStatus(
    rotatedAt: string,
    expiresAt: string | null,
    maxAgeDays: number,
    warnDays: number,
): { status: SecretRotationStatus['status']; daysSinceRotation: number; daysToExpiry: number | null } {
    const nowMs = Date.now();
    const rotatedAtMs = Date.parse(rotatedAt);
    if (!Number.isFinite(rotatedAtMs)) {
        return {
            status: 'UNKNOWN',
            daysSinceRotation: -1,
            daysToExpiry: null,
        };
    }

    const daysSince = Math.max(0, Math.floor((nowMs - rotatedAtMs) / 86_400_000));
    if (expiresAt) {
        const expiryMs = Date.parse(expiresAt);
        if (!Number.isFinite(expiryMs)) {
            return {
                status: 'UNKNOWN',
                daysSinceRotation: daysSince,
                daysToExpiry: null,
            };
        }
        const daysToExpiry = Math.floor((expiryMs - nowMs) / 86_400_000);
        if (daysToExpiry < 0) {
            return { status: 'EXPIRED', daysSinceRotation: daysSince, daysToExpiry };
        }
        if (daysToExpiry <= warnDays) {
            return { status: 'WARN', daysSinceRotation: daysSince, daysToExpiry };
        }
        return { status: 'OK', daysSinceRotation: daysSince, daysToExpiry };
    }

    if (daysSince > maxAgeDays) {
        return { status: 'EXPIRED', daysSinceRotation: daysSince, daysToExpiry: null };
    }
    if (daysSince >= Math.max(0, maxAgeDays - warnDays)) {
        return { status: 'WARN', daysSinceRotation: daysSince, daysToExpiry: null };
    }
    return { status: 'OK', daysSinceRotation: daysSince, daysToExpiry: null };
}

export async function listSecretRotationStatus(maxAgeDays: number, warnDays: number): Promise<SecretRotationStatus[]> {
    await ensureGovernanceTables();
    const db = await getDatabase();
    const rows = await db.query<{
        secret_name: string;
        owner: string | null;
        rotated_at: string;
        expires_at: string | null;
        notes: string | null;
    }>(
        `
        SELECT secret_name, owner, rotated_at, expires_at, notes
        FROM secret_inventory
        ORDER BY secret_name ASC
    `,
    );

    return rows.map((row) => {
        const status = resolveSecretStatus(row.rotated_at, row.expires_at, maxAgeDays, warnDays);
        return {
            secretName: row.secret_name,
            owner: row.owner,
            rotatedAt: row.rotated_at,
            expiresAt: row.expires_at,
            daysSinceRotation: status.daysSinceRotation,
            daysToExpiry: status.daysToExpiry,
            status: status.status,
            notes: row.notes,
        };
    });
}

export async function cleanupPrivacyData(
    retentionDays: number,
    options: { dryRun?: boolean } = {},
): Promise<PrivacyCleanupStats> {
    const db = await getDatabase();
    const safeDays = Math.max(7, retentionDays);
    const daysParam = String(safeDays);
    const dryRun = options.dryRun === true;

    // CL16 (collaudo): in dryRun NON cancelliamo nulla — convertiamo ogni DELETE in SELECT COUNT(*)
    // per mostrare quante righe verrebbero eliminate (preview di un'operazione IRREVERSIBILE).
    // Tutte le query partono con "DELETE FROM <tabella> WHERE ...": la sostituzione e' affidabile.
    const runDeleteOrCount = async (sql: string, params: unknown[]): Promise<number> => {
        if (dryRun) {
            const countSql = sql.replace(/^\s*DELETE\s+FROM/i, 'SELECT COUNT(*) AS n FROM');
            const row = await db.get<{ n: number }>(countSql, params);
            return Number(row?.n ?? 0);
        }
        const res = await db.run(sql, params);
        return res.changes ?? 0;
    };

    return withTransaction(db, async () => {
        const runLogs = await runDeleteOrCount(
            `DELETE FROM run_logs WHERE created_at < DATETIME('now', '-' || ? || ' days')`,
            [daysParam],
        );
        const jobAttempts = await runDeleteOrCount(
            `DELETE FROM job_attempts WHERE started_at < DATETIME('now', '-' || ? || ' days')`,
            [daysParam],
        );
        const leadEvents = await runDeleteOrCount(
            `DELETE FROM lead_events WHERE created_at < DATETIME('now', '-' || ? || ' days')`,
            [daysParam],
        );
        const messageHistory = await runDeleteOrCount(
            `DELETE FROM message_history WHERE sent_at < DATETIME('now', '-' || ? || ' days')`,
            [daysParam],
        );
        // H14 fix (data-integrity/GDPR): cancellare prima le righe figlie outbox_event_deliveries.
        // La FK event_id -> outbox_events(id) (migration 058) NON ha ON DELETE CASCADE: con
        // foreign_keys ON (H13) o su Postgres, il DELETE da outbox_events viola la FK e fa ROLLBACK
        // dell'INTERA transazione di purge GDPR (retention silenziosamente non funzionante in prod).
        // (In dryRun nessun DELETE viene eseguito: questo COUNT non e' nelle stats di ritorno.)
        if (!dryRun) {
            await db.run(
                `DELETE FROM outbox_event_deliveries
             WHERE event_id IN (
                 SELECT id FROM outbox_events
                 WHERE delivered_at IS NOT NULL
                   AND created_at < DATETIME('now', '-' || ? || ' days')
             )`,
                [daysParam],
            );
        }
        const deliveredOutboxEvents = await runDeleteOrCount(
            `DELETE FROM outbox_events
             WHERE delivered_at IS NOT NULL
               AND created_at < DATETIME('now', '-' || ? || ' days')`,
            [daysParam],
        );
        const resolvedIncidents = await runDeleteOrCount(
            `DELETE FROM account_incidents
             WHERE status = 'RESOLVED'
               AND resolved_at < DATETIME('now', '-' || ? || ' days')`,
            [daysParam],
        );

        const staleLeadsSubquery = `
            SELECT id
            FROM leads
            WHERE status IN ('SKIPPED', 'BLOCKED', 'DEAD', 'WITHDRAWN', 'REPLIED', 'CONNECTED')
              AND COALESCE(updated_at, created_at) < DATETIME('now', '-' || ? || ' days')
        `;
        const staleListMemberships = await runDeleteOrCount(
            `DELETE FROM list_leads WHERE lead_id IN (${staleLeadsSubquery})`,
            [daysParam],
        );
        const staleLeadEvents = await runDeleteOrCount(
            `DELETE FROM lead_events WHERE lead_id IN (${staleLeadsSubquery})`,
            [daysParam],
        );
        const staleMessageHistory = await runDeleteOrCount(
            `DELETE FROM message_history WHERE lead_id IN (${staleLeadsSubquery})`,
            [daysParam],
        );
        // Pulizia FK-completa delle tabelle figlie di leads PRIMA di cancellare il padre.
        // Senza questo, su Postgres (FK enforced) la DELETE FROM leads viola la foreign key e
        // l'intera transazione va in rollback -> il purge GDPR non avviene mai. Set allineato a
        // deleteLead() in gdprRetentionCleanup.ts (fonte autoritativa delle figlie di leads).
        // (In dryRun saltiamo i DELETE figli: nessun conteggio nelle stats e nessuna scrittura.)
        if (!dryRun) {
            for (const childTable of [
                'lead_intents',
                'lead_enrichment_data',
                'prebuilt_messages',
                'salesnav_list_items',
                'ml_feature_store',
                'challenge_events',
                'lead_campaign_state',
            ]) {
                await db.run(`DELETE FROM ${childTable} WHERE lead_id IN (${staleLeadsSubquery})`, [daysParam]);
            }
            // salesnav_list_members: keyed su linkedin_url (NON lead_id) -> match separato sui lead
            // stale. 4° percorso del perimetro erasure GDPR (anonymizeLead/deleteLead/runRightToErasure
            // + qui): senza, la PII del membro (profile_name/company/message_text) resta dopo il purge.
            // PRIMA del DELETE leads sotto, altrimenti la subquery non troverebbe piu' i lead.
            await db.run(
                `DELETE FROM salesnav_list_members
                 WHERE linkedin_url IN (
                     SELECT linkedin_url FROM leads
                     WHERE status IN ('SKIPPED', 'BLOCKED', 'DEAD', 'WITHDRAWN', 'REPLIED', 'CONNECTED')
                       AND COALESCE(updated_at, created_at) < DATETIME('now', '-' || ? || ' days')
                       AND linkedin_url IS NOT NULL
                 )`,
                [daysParam],
            );
        }
        const staleLeads = await runDeleteOrCount(`DELETE FROM leads WHERE id IN (${staleLeadsSubquery})`, [daysParam]);

        return {
            runLogs,
            jobAttempts,
            leadEvents,
            messageHistory,
            deliveredOutboxEvents,
            resolvedIncidents,
            staleListMemberships,
            staleLeadEvents,
            staleMessageHistory,
            staleLeads,
        };
    });
}

/**
 * Applies partial updates from cloud sync. COALESCE(?, field) semantics:
 * if the cloud value is NULL (not provided), keep the current local value.
 * This prevents cloud sync from erasing locally-set fields.
 */
export async function applyCloudAccountUpdates(updates: CloudAccount[]): Promise<void> {
    if (updates.length === 0) return;
    const db = await getDatabase();
    await withTransaction(db, async () => {
        for (const acc of updates) {
            await db.run(
                `
                UPDATE accounts
                SET
                    tier = COALESCE(?, tier),
                    health = COALESCE(?, health),
                    quarantine_reason = COALESCE(?, quarantine_reason),
                    quarantine_until = COALESCE(?, quarantine_until),
                    updated_at = COALESCE(?, updated_at)
                WHERE id = ?
                `,
                [
                    acc.tier,
                    acc.health,
                    acc.quarantine_reason,
                    acc.quarantine_until,
                    acc.updated_at || new Date().toISOString(),
                    acc.id,
                ],
            );
        }
    });
}

export async function applyCloudLeadUpdates(updates: CloudLeadUpsert[]): Promise<void> {
    if (updates.length === 0) return;
    const db = await getDatabase();
    await withTransaction(db, async () => {
        for (const l of updates) {
            await db.run(
                `
                UPDATE leads
                SET
                    status = COALESCE(?, status),
                    invited_at = COALESCE(?, invited_at),
                    accepted_at = COALESCE(?, accepted_at),
                    messaged_at = COALESCE(?, messaged_at),
                    last_error = COALESCE(?, last_error),
                    blocked_reason = COALESCE(?, blocked_reason),
                    lead_score = COALESCE(?, lead_score),
                    confidence_score = COALESCE(?, confidence_score),
                    updated_at = COALESCE(?, updated_at)
                WHERE linkedin_url = ?
                `,
                [
                    l.status,
                    l.invited_at,
                    l.accepted_at,
                    l.messaged_at,
                    l.last_error,
                    l.blocked_reason,
                    l.lead_score,
                    l.confidence_score,
                    l.updated_at || new Date().toISOString(),
                    l.linkedin_url,
                ],
            );
        }
    });
}
