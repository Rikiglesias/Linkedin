/**
 * repositories/automationCommands.ts
 * Coda persistente dei comandi automation esterni.
 */

import { randomUUID } from 'crypto';
import {
    type AutomationCommandExecutionResult,
    type AutomationCommandKind,
    type AutomationCommandPayload,
    type AutomationCommandRecord,
    type AutomationCommandStatus,
    type ParsedAutomationCommandRecord,
    isTerminalAutomationCommandStatus,
} from '../../automation/types';
import { getDatabase } from '../../db';
import { parsePayload, withTransaction } from './shared';

const AUTOMATION_COMMAND_SELECT_COLUMNS = `
    id,
    request_id,
    kind,
    payload_json,
    source,
    idempotency_key,
    status,
    claimed_by,
    started_at,
    finished_at,
    result_json,
    last_error,
    created_at,
    updated_at
`;

export interface EnqueueAutomationCommandResult {
    command: ParsedAutomationCommandRecord;
    created: boolean;
}

export interface AutomationCommandSummary {
    pending: number;
    running: number;
    lastCompleted: ParsedAutomationCommandRecord | null;
}

export function parseAutomationCommandRecord(record: AutomationCommandRecord): ParsedAutomationCommandRecord {
    return {
        id: record.id,
        requestId: record.request_id,
        kind: record.kind,
        payload: parsePayload<AutomationCommandPayload>(record.payload_json),
        source: record.source,
        idempotencyKey: record.idempotency_key,
        status: record.status,
        claimedBy: record.claimed_by,
        startedAt: record.started_at,
        finishedAt: record.finished_at,
        result: record.result_json ? parsePayload<AutomationCommandExecutionResult>(record.result_json) : null,
        lastError: record.last_error,
        createdAt: record.created_at,
        updatedAt: record.updated_at,
    };
}

async function getAutomationCommandByIdempotencyKeyRaw(
    idempotencyKey: string,
): Promise<AutomationCommandRecord | null> {
    const db = await getDatabase();
    const row = await db.get<AutomationCommandRecord>(
        `SELECT ${AUTOMATION_COMMAND_SELECT_COLUMNS}
           FROM automation_commands
          WHERE idempotency_key = ?
          LIMIT 1`,
        [idempotencyKey],
    );
    return row ?? null;
}

async function getAutomationCommandByIdRaw(commandId: number): Promise<AutomationCommandRecord | null> {
    const db = await getDatabase();
    const row = await db.get<AutomationCommandRecord>(
        `SELECT ${AUTOMATION_COMMAND_SELECT_COLUMNS}
           FROM automation_commands
          WHERE id = ?
          LIMIT 1`,
        [commandId],
    );
    return row ?? null;
}

export async function enqueueAutomationCommand(
    kind: AutomationCommandKind,
    payload: AutomationCommandPayload,
    source: string,
    idempotencyKey: string,
): Promise<EnqueueAutomationCommandResult> {
    const db = await getDatabase();
    const normalizedSource = source.trim() || 'api_v1';
    const normalizedIdempotencyKey = idempotencyKey.trim();
    if (!normalizedIdempotencyKey) {
        throw new Error('idempotencyKey obbligatorio');
    }

    return withTransaction(db, async () => {
        const existing = await getAutomationCommandByIdempotencyKeyRaw(normalizedIdempotencyKey);
        if (existing) {
            return {
                command: parseAutomationCommandRecord(existing),
                created: false,
            };
        }

        const requestId = randomUUID();
        await db.run(
            `INSERT INTO automation_commands (
                request_id,
                kind,
                payload_json,
                source,
                idempotency_key,
                status
            ) VALUES (?, ?, ?, ?, ?, 'PENDING')`,
            [requestId, kind, JSON.stringify(payload ?? {}), normalizedSource, normalizedIdempotencyKey],
        );

        const created = await getAutomationCommandByIdempotencyKeyRaw(normalizedIdempotencyKey);
        if (!created) {
            throw new Error('Impossibile creare automation command');
        }

        return {
            command: parseAutomationCommandRecord(created),
            created: true,
        };
    });
}

export async function getAutomationCommandByRequestId(
    requestId: string,
): Promise<ParsedAutomationCommandRecord | null> {
    const db = await getDatabase();
    const row = await db.get<AutomationCommandRecord>(
        `SELECT ${AUTOMATION_COMMAND_SELECT_COLUMNS}
           FROM automation_commands
          WHERE request_id = ?
          LIMIT 1`,
        [requestId],
    );
    return row ? parseAutomationCommandRecord(row) : null;
}

export async function listAutomationCommands(
    statuses: AutomationCommandStatus[] = [],
    limit: number = 25,
): Promise<ParsedAutomationCommandRecord[]> {
    const db = await getDatabase();
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const normalizedStatuses = Array.from(new Set(statuses));

    let sql = `SELECT ${AUTOMATION_COMMAND_SELECT_COLUMNS}
                 FROM automation_commands`;
    const params: unknown[] = [];
    if (normalizedStatuses.length > 0) {
        const placeholders = normalizedStatuses.map(() => '?').join(', ');
        sql += ` WHERE status IN (${placeholders})`;
        params.push(...normalizedStatuses);
    }
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(safeLimit);

    const rows = await db.query<AutomationCommandRecord>(sql, params);
    return rows.map(parseAutomationCommandRecord);
}

export async function claimNextAutomationCommand(claimedBy: string): Promise<ParsedAutomationCommandRecord | null> {
    const db = await getDatabase();
    const normalizedClaimedBy = claimedBy.trim() || `loop:${process.pid}`;

    return withTransaction(db, async () => {
        const row = await db.get<AutomationCommandRecord>(
            `SELECT ${AUTOMATION_COMMAND_SELECT_COLUMNS}
               FROM automation_commands
              WHERE status = 'PENDING'
              ORDER BY created_at ASC
              LIMIT 1${db.isPostgres ? ' FOR UPDATE SKIP LOCKED' : ''}`,
        );

        if (!row) {
            return null;
        }

        const result = await db.run(
            `UPDATE automation_commands
                SET status = 'RUNNING',
                    claimed_by = ?,
                    started_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
                AND status = 'PENDING'`,
            [normalizedClaimedBy, row.id],
        );
        if ((result.changes ?? 0) === 0) {
            return null;
        }

        const claimed = await getAutomationCommandByIdRaw(row.id);
        return claimed ? parseAutomationCommandRecord(claimed) : null;
    });
}

async function markAutomationCommandTerminal(
    commandId: number,
    status: Extract<AutomationCommandStatus, 'SUCCEEDED' | 'FAILED' | 'SKIPPED'>,
    result: AutomationCommandExecutionResult | null,
    lastError: string | null,
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `UPDATE automation_commands
            SET status = ?,
                finished_at = CURRENT_TIMESTAMP,
                result_json = ?,
                last_error = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [status, result ? JSON.stringify(result) : null, lastError, commandId],
    );
}

export async function markAutomationCommandSucceeded(
    commandId: number,
    result: AutomationCommandExecutionResult,
): Promise<void> {
    await markAutomationCommandTerminal(commandId, 'SUCCEEDED', result, null);
}

export async function markAutomationCommandFailed(commandId: number, errorMessage: string): Promise<void> {
    await markAutomationCommandTerminal(
        commandId,
        'FAILED',
        {
            success: false,
            blocked: {
                reason: 'WORKFLOW_ERROR',
                message: errorMessage,
            },
            summary: {
                status: 'FAILED',
            },
            errors: [errorMessage],
            nextAction: "Controlla i log del loop e correggi la causa dell'errore prima di ritentare.",
            details: { error: errorMessage },
        },
        errorMessage,
    );
}

export async function markAutomationCommandSkipped(commandId: number, reason: string): Promise<void> {
    await markAutomationCommandTerminal(
        commandId,
        'SKIPPED',
        {
            success: false,
            blocked: {
                reason: 'PRECONDITION_FAILED',
                message: reason,
            },
            summary: {
                status: 'SKIPPED',
            },
            errors: [],
            nextAction: 'Rimuovi il blocco operativo prima di rilanciare il comando.',
            details: { reason },
        },
        reason,
    );
}

export async function getAutomationCommandSummary(): Promise<AutomationCommandSummary> {
    const db = await getDatabase();
    const rows = await db.query<{ status: AutomationCommandStatus; total: number }>(
        `SELECT status, COUNT(*) as total
           FROM automation_commands
          GROUP BY status`,
    );

    let pending = 0;
    let running = 0;
    for (const row of rows) {
        if (row.status === 'PENDING') pending = row.total;
        if (row.status === 'RUNNING') running = row.total;
    }

    const lastCompletedRow = await db.get<AutomationCommandRecord>(
        `SELECT ${AUTOMATION_COMMAND_SELECT_COLUMNS}
           FROM automation_commands
          WHERE status IN ('SUCCEEDED', 'FAILED', 'SKIPPED')
          ORDER BY COALESCE(finished_at, updated_at) DESC
          LIMIT 1`,
    );

    const lastCompleted = lastCompletedRow ? parseAutomationCommandRecord(lastCompletedRow) : null;
    if (lastCompleted && !isTerminalAutomationCommandStatus(lastCompleted.status)) {
        return { pending, running, lastCompleted: null };
    }
    return { pending, running, lastCompleted };
}

export async function recoverStaleAutomationCommands(maxAgeMinutes: number = 15): Promise<number> {
    const db = await getDatabase();
    const safeMinutes = Math.max(1, maxAgeMinutes);
    const errorMsg = `Stato RUNNING per oltre ${safeMinutes} min — ripristinato automaticamente al boot dopo crash o stop forzato.`;
    const resultJson = JSON.stringify({
        success: false,
        blocked: { reason: 'CRASH_RECOVERY', message: errorMsg },
        summary: { status: 'FAILED' },
        errors: [errorMsg],
        nextAction: "Il daemon e' stato riavviato. Reinvia il comando se necessario.",
        details: { recoveredAt: new Date().toISOString() },
    });

    const result = await db.run(
        `UPDATE automation_commands
            SET status = 'FAILED',
                finished_at = CURRENT_TIMESTAMP,
                result_json = ?,
                last_error = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE status = 'RUNNING'
            AND started_at <= DATETIME('now', '-' || ? || ' minutes')`,
        [resultJson, errorMsg, safeMinutes],
    );

    return result.changes ?? 0;
}
