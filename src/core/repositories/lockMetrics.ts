import { getDatabase } from '../../db';
import { getLocalDateString } from '../../config';
import { type LockContentionSummary, type LockMetricSnapshot } from '../repositories.types';

export type LockMetricName =
    | 'acquire_contended'
    | 'acquire_stale_takeover'
    | 'heartbeat_miss'
    | 'release_miss'
    | 'queue_race_lost';

export async function incrementLockMetric(lockKey: string, metric: LockMetricName, amount: number = 1): Promise<void> {
    const db = await getDatabase();
    const localDate = getLocalDateString();
    const safeAmount = Math.max(1, Math.floor(amount));
    await db.run(
        `INSERT INTO lock_metrics (date, lock_key, metric, value, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(date, lock_key, metric)
         DO UPDATE SET
            value = lock_metrics.value + excluded.value,
            updated_at = CURRENT_TIMESTAMP`,
        [localDate, lockKey, metric, safeAmount]
    );
}

export async function listLockMetricsByDate(dateString: string): Promise<LockMetricSnapshot[]> {
    const db = await getDatabase();
    const rows = await db.query<{ date: string; lock_key: string; metric: string; value: number }>(
        `SELECT date, lock_key, metric, value
         FROM lock_metrics
         WHERE date = ?
         ORDER BY lock_key ASC, metric ASC`,
        [dateString]
    );

    return rows.map((row) => ({
        date: row.date,
        lockKey: row.lock_key,
        metric: row.metric,
        value: row.value ?? 0,
    }));
}

export async function getLockContentionSummary(dateString: string = getLocalDateString()): Promise<LockContentionSummary> {
    const metrics = await listLockMetricsByDate(dateString);
    const summary: LockContentionSummary = {
        acquireContended: 0,
        acquireStaleTakeover: 0,
        heartbeatMiss: 0,
        releaseMiss: 0,
        queueRaceLost: 0,
    };

    for (const metric of metrics) {
        switch (metric.metric) {
            case 'acquire_contended':
                summary.acquireContended += metric.value;
                break;
            case 'acquire_stale_takeover':
                summary.acquireStaleTakeover += metric.value;
                break;
            case 'heartbeat_miss':
                summary.heartbeatMiss += metric.value;
                break;
            case 'release_miss':
                summary.releaseMiss += metric.value;
                break;
            case 'queue_race_lost':
                summary.queueRaceLost += metric.value;
                break;
            default:
                break;
        }
    }

    return summary;
}
