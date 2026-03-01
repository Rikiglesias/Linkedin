/**
 * repositories/jobs.ts
 * Domain queries: queueing, retries, dead letter, stuck job recovery.
 */

import { getDatabase } from '../../db';
import { JobRecord, JobStatus, JobType } from '../../types/domain';
import { type JobStatusCounts } from '../repositories.types';
import { incrementLockMetric } from './lockMetrics';
import { JOB_SELECT_COLUMNS } from './sqlColumns';
import { parsePayload, withTransaction } from './shared';

export async function enqueueJob(
    type: JobType,
    payload: Record<string, unknown>,
    idempotencyKey: string,
    priority: number,
    maxAttempts: number,
    initialDelaySeconds: number = 0,
    accountId: string = 'default'
): Promise<boolean> {
    const db = await getDatabase();
    const safeDelay = Math.max(0, Math.floor(initialDelaySeconds));
    const normalizedAccountId = accountId.trim() || 'default';
    const result = await db.run(
        `
        INSERT OR IGNORE INTO jobs (type, status, account_id, payload_json, idempotency_key, priority, max_attempts, next_run_at)
        VALUES (?, 'QUEUED', ?, ?, ?, ?, ?, DATETIME('now', '+' || ? || ' seconds'))
    `,
        [type, normalizedAccountId, JSON.stringify(payload), idempotencyKey, priority, maxAttempts, safeDelay]
    );
    return (result.changes ?? 0) > 0;
}

export async function lockNextQueuedJob(
    allowedTypes: JobType[],
    accountId?: string,
    includeLegacyDefaultQueue: boolean = false
): Promise<JobRecord | null> {
    if (allowedTypes.length === 0) {
        return null;
    }
    const db = await getDatabase();
    return withTransaction(db, async () => {
        const placeholders = allowedTypes.map(() => '?').join(', ');
        const whereClauses = [
            `status = 'QUEUED'`,
            `next_run_at <= CURRENT_TIMESTAMP`,
            `type IN (${placeholders})`,
        ];
        const params: unknown[] = [...allowedTypes];

        const normalizedAccountId = accountId?.trim();
        if (normalizedAccountId) {
            if (includeLegacyDefaultQueue && normalizedAccountId !== 'default') {
                whereClauses.push(`account_id IN (?, 'default')`);
                params.push(normalizedAccountId);
            } else {
                whereClauses.push(`account_id = ?`);
                params.push(normalizedAccountId);
            }
        }

        const job = await db.get<JobRecord>(
            `
            SELECT ${JOB_SELECT_COLUMNS} FROM jobs
            WHERE ${whereClauses.join('\n              AND ')}
            ORDER BY priority ASC, created_at ASC
            LIMIT 1
        `,
            params
        );

        if (!job) return null;

        const updateResult = await db.run(
            `
            UPDATE jobs
            SET status = 'RUNNING', locked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'QUEUED'
        `,
            [job.id]
        );
        if ((updateResult.changes ?? 0) === 0) {
            await incrementLockMetric('jobs.queue', 'queue_race_lost');
            return null;
        }

        return {
            ...job,
            status: 'RUNNING',
            payload_json: job.payload_json,
        };
    });
}

export async function markJobSucceeded(jobId: number): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        UPDATE jobs
        SET status = 'SUCCEEDED', locked_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [jobId]
    );
}

export async function markJobRetryOrDeadLetter(
    jobId: number,
    attempts: number,
    maxAttempts: number,
    nextRetryDelayMs: number,
    errorMessage: string
): Promise<JobStatus> {
    const db = await getDatabase();
    if (attempts >= maxAttempts) {
        await db.run(
            `
            UPDATE jobs
            SET status = 'DEAD_LETTER',
                attempts = ?,
                last_error = ?,
                locked_at = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `,
            [attempts, errorMessage, jobId]
        );
        return 'DEAD_LETTER';
    }

    const seconds = Math.max(1, Math.ceil(nextRetryDelayMs / 1000));
    await db.run(
        `
        UPDATE jobs
        SET status = 'QUEUED',
            attempts = ?,
            last_error = ?,
            next_run_at = DATETIME('now', '+' || ? || ' seconds'),
            locked_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `,
        [attempts, errorMessage, seconds, jobId]
    );
    return 'QUEUED';
}

export async function createJobAttempt(
    jobId: number,
    success: boolean,
    errorCode: string | null,
    errorMessage: string | null,
    evidencePath: string | null
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        INSERT INTO job_attempts (job_id, finished_at, success, error_code, error_message, evidence_path)
        VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
    `,
        [jobId, success ? 1 : 0, errorCode, errorMessage, evidencePath]
    );
}

export async function getJobStatusCounts(): Promise<JobStatusCounts> {
    const db = await getDatabase();
    const rows = await db.query<{ status: JobStatus; total: number }>(
        `SELECT status, COUNT(*) as total FROM jobs GROUP BY status`
    );

    const counts: JobStatusCounts = {
        QUEUED: 0,
        RUNNING: 0,
        SUCCEEDED: 0,
        FAILED: 0,
        DEAD_LETTER: 0,
        PAUSED: 0,
    };

    for (const row of rows) {
        if (row.status in counts) {
            counts[row.status] = row.total;
        }
    }

    return counts;
}

export interface JobWithPayload<T extends Record<string, unknown>> extends JobRecord {
    payload: T;
}

export function parseJobPayload<T extends Record<string, unknown>>(job: JobRecord): JobWithPayload<T> {
    return {
        ...job,
        payload: parsePayload<T>(job.payload_json),
    };
}

export async function recoverStuckJobs(staleAfterMinutes: number = 30): Promise<number> {
    const db = await getDatabase();
    const result = await db.run(
        `UPDATE jobs
         SET status = 'QUEUED',
             locked_at = NULL,
             updated_at = CURRENT_TIMESTAMP,
             last_error = 'Recovered from RUNNING on startup'
         WHERE status = 'RUNNING'
           AND (
             locked_at IS NULL
             OR locked_at <= DATETIME('now', '-' || ? || ' minutes')
           )`,
        [Math.max(1, staleAfterMinutes)]
    );
    return result.changes ?? 0;
}

export async function getFailedJobs(limit: number): Promise<JobRecord[]> {
    const db = await getDatabase();
    return db.query<JobRecord>(`SELECT ${JOB_SELECT_COLUMNS} FROM jobs WHERE status = 'FAILED' LIMIT ?`, [limit]);
}

export async function markJobAsDeadLetter(jobId: number, explanation: string): Promise<void> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    await db.run(
        `UPDATE jobs
         SET status = 'DEAD_LETTER', last_error = ?, updated_at = ?
         WHERE id = ?`,
        [explanation, now, jobId]
    );
}

export async function recycleJob(jobId: number, newDelaySec: number, newPriority: number): Promise<void> {
    const db = await getDatabase();
    const now = new Date();
    const nextRun = new Date(now.getTime() + newDelaySec * 1000).toISOString();

    await db.run(
        `UPDATE jobs
         SET status = 'QUEUED', attempts = 0, next_run_at = ?, priority = ?, updated_at = ?
         WHERE id = ?`,
        [nextRun, newPriority, now.toISOString(), jobId]
    );
}
