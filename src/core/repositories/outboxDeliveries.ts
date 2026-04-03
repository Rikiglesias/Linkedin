/**
 * repositories/outboxDeliveries.ts
 * Fan-out outbox per-sink con stato e retry indipendenti.
 */

import { config, type EventSyncSink } from '../../config';
import type { EventSyncTarget } from '../../config/types';
import { type DatabaseManager, getDatabase } from '../../db';
import { type OutboxDeliveryRecord, type OutboxDeliverySink } from '../../types/domain';
import { withTransaction } from './shared';

const OUTBOX_DELIVERY_SELECT_COLUMNS = `
    d.id AS delivery_id,
    d.sink,
    d.status AS delivery_status,
    d.attempts AS delivery_attempts,
    d.next_retry_at AS delivery_next_retry_at,
    d.delivered_at AS delivery_delivered_at,
    d.last_error AS delivery_last_error,
    d.processing_owner,
    d.processing_started_at,
    d.processing_expires_at,
    e.id,
    e.topic,
    e.payload_json,
    e.idempotency_key,
    e.attempts,
    e.next_retry_at,
    e.delivered_at,
    e.last_error,
    e.created_at
`;

const TERMINAL_OUTBOX_DELIVERY_STATUSES = new Set(['DELIVERED', 'PERMANENT_FAILURE']);

export interface OutboxPendingBySink {
    SUPABASE: number;
    WEBHOOK: number;
}

export function resolveEnabledOutboxSinks(
    eventSyncSink: EventSyncSink,
    supabaseEnabled: boolean,
    webhookEnabled: boolean,
): OutboxDeliverySink[] {
    const sinks: OutboxDeliverySink[] = [];
    if ((eventSyncSink === 'SUPABASE' || eventSyncSink === 'BOTH') && supabaseEnabled) {
        sinks.push('SUPABASE');
    }
    if ((eventSyncSink === 'WEBHOOK' || eventSyncSink === 'BOTH') && webhookEnabled) {
        sinks.push('WEBHOOK');
    }
    return sinks;
}

export function getActiveOutboxSinks(): OutboxDeliverySink[] {
    return resolveEnabledOutboxSinks(config.eventSyncSink, config.supabaseSyncEnabled, config.webhookSyncEnabled);
}

async function refreshOutboxEventDeliveryState(database: DatabaseManager, eventId: number): Promise<void> {
    const deliveryRows = await database.query<{ status: string; last_error: string | null }>(
        `SELECT status, last_error
           FROM outbox_event_deliveries
          WHERE event_id = ?`,
        [eventId],
    );

    if (deliveryRows.length === 0) {
        await database.run(
            `UPDATE outbox_events
                SET delivered_at = CURRENT_TIMESTAMP,
                    last_error = NULL,
                    processing_owner = NULL,
                    processing_started_at = NULL,
                    processing_expires_at = NULL
              WHERE id = ?`,
            [eventId],
        );
        return;
    }

    const nonTerminal = deliveryRows.filter((row) => !TERMINAL_OUTBOX_DELIVERY_STATUSES.has(row.status));
    if (nonTerminal.length > 0) {
        await database.run(
            `UPDATE outbox_events
                SET delivered_at = NULL
              WHERE id = ?`,
            [eventId],
        );
        return;
    }

    const permanentFailure = deliveryRows.find((row) => row.status === 'PERMANENT_FAILURE' && row.last_error);
    await database.run(
        `UPDATE outbox_events
            SET delivered_at = CURRENT_TIMESTAMP,
                last_error = ?,
                processing_owner = NULL,
                processing_started_at = NULL,
                processing_expires_at = NULL
          WHERE id = ?`,
        [permanentFailure?.last_error ?? null, eventId],
    );
}

export async function ensureOutboxEventDeliveries(
    database: DatabaseManager,
    eventId: number,
    sinks: readonly OutboxDeliverySink[],
): Promise<void> {
    for (const sink of sinks) {
        await database.run(
            `INSERT OR IGNORE INTO outbox_event_deliveries (event_id, sink, status)
             VALUES (?, ?, 'PENDING')`,
            [eventId, sink],
        );
    }
    await refreshOutboxEventDeliveryState(database, eventId);
}

export async function claimPendingOutboxDeliveries(
    sink: OutboxDeliverySink,
    limit: number,
    ownerId: string,
    leaseSeconds: number,
): Promise<OutboxDeliveryRecord[]> {
    const db = await getDatabase();
    const safeLimit = Math.max(1, Math.floor(limit));
    const safeLeaseSeconds = Math.max(5, Math.floor(leaseSeconds));
    const normalizedOwner = ownerId.trim() || 'outbox-worker';

    return withTransaction(db, async () => {
        const candidateRows = await db.query<{ delivery_id: number }>(
            `SELECT d.id AS delivery_id
               FROM outbox_event_deliveries d
               INNER JOIN outbox_events e ON e.id = d.event_id
              WHERE d.sink = ?
                AND d.status = 'PENDING'
                AND d.next_retry_at <= CURRENT_TIMESTAMP
                AND (d.processing_expires_at IS NULL OR d.processing_expires_at <= CURRENT_TIMESTAMP)
                AND e.delivered_at IS NULL
              ORDER BY e.created_at ASC
              LIMIT ?`,
            [sink, Math.max(safeLimit * 4, safeLimit)],
        );

        const claimedIds: number[] = [];
        for (const candidate of candidateRows) {
            if (claimedIds.length >= safeLimit) break;

            const claimResult = await db.run(
                `UPDATE outbox_event_deliveries
                    SET status = 'RUNNING',
                        processing_owner = ?,
                        processing_started_at = CURRENT_TIMESTAMP,
                        processing_expires_at = DATETIME('now', '+' || ? || ' seconds'),
                        updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?
                    AND sink = ?
                    AND status = 'PENDING'
                    AND next_retry_at <= CURRENT_TIMESTAMP
                    AND (processing_expires_at IS NULL OR processing_expires_at <= CURRENT_TIMESTAMP)`,
                [normalizedOwner, safeLeaseSeconds, candidate.delivery_id, sink],
            );
            if ((claimResult.changes ?? 0) > 0) {
                claimedIds.push(candidate.delivery_id);
            }
        }

        if (claimedIds.length === 0) {
            return [];
        }

        const placeholders = claimedIds.map(() => '?').join(', ');
        return db.query<OutboxDeliveryRecord>(
            `SELECT ${OUTBOX_DELIVERY_SELECT_COLUMNS}
               FROM outbox_event_deliveries d
               INNER JOIN outbox_events e ON e.id = d.event_id
              WHERE d.id IN (${placeholders})
              ORDER BY e.created_at ASC`,
            claimedIds,
        );
    });
}

async function updateDeliveryClaimed(
    deliveryId: number,
    ownerId: string,
    sql: string,
    params: unknown[],
): Promise<boolean> {
    const db = await getDatabase();
    return withTransaction(db, async () => {
        const deliveryRow = await db.get<{ event_id: number }>(
            `SELECT event_id
               FROM outbox_event_deliveries
              WHERE id = ?
                AND processing_owner = ?
              LIMIT 1`,
            [deliveryId, ownerId],
        );
        if (!deliveryRow) {
            return false;
        }

        const result = await db.run(sql, params);
        if ((result.changes ?? 0) === 0) {
            return false;
        }

        await refreshOutboxEventDeliveryState(db, deliveryRow.event_id);
        return true;
    });
}

export async function markOutboxDeliveryDeliveredClaimed(deliveryId: number, ownerId: string): Promise<boolean> {
    return updateDeliveryClaimed(
        deliveryId,
        ownerId,
        `UPDATE outbox_event_deliveries
            SET status = 'DELIVERED',
                delivered_at = CURRENT_TIMESTAMP,
                last_error = NULL,
                processing_owner = NULL,
                processing_started_at = NULL,
                processing_expires_at = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND processing_owner = ?`,
        [deliveryId, ownerId],
    );
}

export async function markOutboxDeliveryRetryClaimed(
    deliveryId: number,
    ownerId: string,
    attempts: number,
    retryDelayMs: number,
    errorMessage: string,
): Promise<boolean> {
    const seconds = Math.max(1, Math.ceil(retryDelayMs / 1000));
    return updateDeliveryClaimed(
        deliveryId,
        ownerId,
        `UPDATE outbox_event_deliveries
            SET status = 'PENDING',
                attempts = ?,
                next_retry_at = DATETIME('now', '+' || ? || ' seconds'),
                last_error = ?,
                processing_owner = NULL,
                processing_started_at = NULL,
                processing_expires_at = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND processing_owner = ?`,
        [attempts, seconds, errorMessage, deliveryId, ownerId],
    );
}

export async function markOutboxDeliveryPermanentFailureClaimed(
    deliveryId: number,
    ownerId: string,
    attempts: number,
    errorMessage: string,
): Promise<boolean> {
    return updateDeliveryClaimed(
        deliveryId,
        ownerId,
        `UPDATE outbox_event_deliveries
            SET status = 'PERMANENT_FAILURE',
                attempts = ?,
                delivered_at = CURRENT_TIMESTAMP,
                last_error = ?,
                processing_owner = NULL,
                processing_started_at = NULL,
                processing_expires_at = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND processing_owner = ?`,
        [attempts, `PERMANENT_FAILURE: ${errorMessage}`, deliveryId, ownerId],
    );
}

export async function countPendingOutboxDeliveries(sink: OutboxDeliverySink): Promise<number> {
    const db = await getDatabase();
    const row = await db.get<{ total: number }>(
        `SELECT COUNT(*) as total
           FROM outbox_event_deliveries
          WHERE sink = ?
            AND status IN ('PENDING', 'RUNNING')`,
        [sink],
    );
    return row?.total ?? 0;
}

export async function getPendingOutboxDeliveriesBySink(): Promise<OutboxPendingBySink> {
    const db = await getDatabase();
    const rows = await db.query<{ sink: EventSyncTarget; total: number }>(
        `SELECT sink, COUNT(*) as total
           FROM outbox_event_deliveries
          WHERE status IN ('PENDING', 'RUNNING')
          GROUP BY sink`,
    );

    const counts: OutboxPendingBySink = { SUPABASE: 0, WEBHOOK: 0 };
    for (const row of rows) {
        counts[row.sink] = row.total;
    }
    return counts;
}
