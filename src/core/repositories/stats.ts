/**
 * repositories/stats.ts
 * Domain queries: KPIs, daily stats, campaign runs, risk inputs, observability snapshot.
 */

import { getDatabase } from '../../db';
import { config, getLocalDateString } from '../../config';
import { ABTestStats, RiskInputs, RunStatus } from '../../types/domain';
import {
    type DailyStatsSnapshot,
    type ObservabilityAlert,
    type OperationalSloSnapshot,
    type OperationalSloThresholds,
    type OperationalSloWindowSnapshot,
    type OperationalObservabilitySnapshot,
    type SelectorCacheKpiSnapshot,
} from '../repositories.types';
import { countLeadsByStatuses } from './leadsCore';
import { countPendingOutboxEvents, getLockContentionSummary } from './system';

export async function getDailyStat(
    dateString: string,
    field:
        | 'invites_sent'
        | 'messages_sent'
        | 'acceptances'
        | 'challenges_count'
        | 'selector_failures'
        | 'run_errors'
        | 'follow_ups_sent'
        | 'profile_views'
        | 'likes_given'
        | 'follows_given',
): Promise<number> {
    const db = await getDatabase();
    const row = await db.get<Record<string, number>>(`SELECT ${field} FROM daily_stats WHERE date = ?`, [dateString]);
    return row?.[field] ?? 0;
}

function formatPercent(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Number.parseFloat(((numerator / denominator) * 100).toFixed(2));
}

export interface ComplianceHealthMetrics {
    localDate: string;
    lookbackDays: number;
    invitesSentLookback: number;
    acceptancesLookback: number;
    acceptanceRatePct: number;
    messagedLookback: number;
    engagedLookback: number;
    engagementRatePct: number;
    pendingRatio: number;
}

export async function getComplianceHealthMetrics(
    localDate: string,
    lookbackDays: number,
    hardInviteCap: number,
): Promise<ComplianceHealthMetrics> {
    const db = await getDatabase();
    const safeLookbackDays = Math.max(1, Math.floor(lookbackDays));

    const [dailyStatsRow, messagedRow, engagedRow, riskInputs] = await Promise.all([
        db.get<{ invites: number; acceptances: number }>(
            `
            SELECT
                COALESCE(SUM(invites_sent), 0) AS invites,
                COALESCE(SUM(acceptances), 0) AS acceptances
            FROM daily_stats
            WHERE date >= DATE('now', '-' || ? || ' days')
        `,
            [safeLookbackDays],
        ),
        db.get<{ total: number }>(
            `
            SELECT COUNT(*) AS total
            FROM leads
            WHERE messaged_at IS NOT NULL
              AND messaged_at >= DATETIME('now', '-' || ? || ' days')
        `,
            [safeLookbackDays],
        ),
        db.get<{ total: number }>(
            `
            SELECT COUNT(*) AS total
            FROM leads
            WHERE messaged_at IS NOT NULL
              AND messaged_at >= DATETIME('now', '-' || ? || ' days')
              AND status IN ('REPLIED', 'CONNECTED')
        `,
            [safeLookbackDays],
        ),
        getRiskInputs(localDate, Math.max(1, hardInviteCap)),
    ]);

    const invitesSentLookback = dailyStatsRow?.invites ?? 0;
    const acceptancesLookback = dailyStatsRow?.acceptances ?? 0;
    const messagedLookback = messagedRow?.total ?? 0;
    const engagedLookback = engagedRow?.total ?? 0;

    return {
        localDate,
        lookbackDays: safeLookbackDays,
        invitesSentLookback,
        acceptancesLookback,
        acceptanceRatePct: formatPercent(acceptancesLookback, invitesSentLookback),
        messagedLookback,
        engagedLookback,
        engagementRatePct: formatPercent(engagedLookback, messagedLookback),
        pendingRatio: Number.parseFloat(riskInputs.pendingRatio.toFixed(4)),
    };
}

export async function getDailyStatsSnapshot(dateString: string): Promise<DailyStatsSnapshot> {
    const db = await getDatabase();
    const row = await db.get<{
        invites_sent: number;
        messages_sent: number;
        challenges_count: number;
        selector_failures: number;
        run_errors: number;
    }>(
        `SELECT invites_sent, messages_sent, challenges_count, selector_failures, run_errors FROM daily_stats WHERE date = ?`,
        [dateString],
    );

    return {
        date: dateString,
        invitesSent: row?.invites_sent ?? 0,
        messagesSent: row?.messages_sent ?? 0,
        challengesCount: row?.challenges_count ?? 0,
        selectorFailures: row?.selector_failures ?? 0,
        runErrors: row?.run_errors ?? 0,
    };
}

export async function getRecentDailyStats(limit: number): Promise<DailyStatsSnapshot[]> {
    const db = await getDatabase();
    const safeLimit = Math.max(1, Math.floor(limit));
    const rows = await db.query<{
        date: string;
        invites_sent: number;
        messages_sent: number;
        challenges_count: number;
        selector_failures: number;
        run_errors: number;
    }>(
        `
        SELECT date, invites_sent, messages_sent, challenges_count, selector_failures, run_errors
        FROM daily_stats
        ORDER BY date DESC
        LIMIT ?
    `,
        [safeLimit],
    );

    return rows.map((row) => ({
        date: row.date,
        invitesSent: row.invites_sent ?? 0,
        messagesSent: row.messages_sent ?? 0,
        challengesCount: row.challenges_count ?? 0,
        selectorFailures: row.selector_failures ?? 0,
        runErrors: row.run_errors ?? 0,
    }));
}

function computeAgeSeconds(rawTimestamp: string | null, nowMs: number): number {
    if (!rawTimestamp) return 0;
    const parsedMs = Date.parse(rawTimestamp);
    if (!Number.isFinite(parsedMs)) return 0;
    return Math.max(0, Math.floor((nowMs - parsedMs) / 1000));
}

type SloSeverity = 'OK' | 'WARN' | 'CRITICAL';

function maxSloSeverity(a: SloSeverity, b: SloSeverity): SloSeverity {
    if (a === 'CRITICAL' || b === 'CRITICAL') return 'CRITICAL';
    if (a === 'WARN' || b === 'WARN') return 'WARN';
    return 'OK';
}

function evaluateSloValueSeverity(value: number, warnThreshold: number, criticalThreshold: number): SloSeverity {
    if (value >= criticalThreshold) return 'CRITICAL';
    if (value >= warnThreshold) return 'WARN';
    return 'OK';
}

function computeWindowStartDate(localDate: string, windowDays: number): string {
    const anchor = new Date(`${localDate}T00:00:00Z`);
    if (!Number.isFinite(anchor.getTime())) {
        return localDate;
    }
    anchor.setUTCDate(anchor.getUTCDate() - Math.max(0, windowDays - 1));
    const year = anchor.getUTCFullYear();
    const month = String(anchor.getUTCMonth() + 1).padStart(2, '0');
    const day = String(anchor.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function shiftDateByDays(localDate: string, deltaDays: number): string {
    const anchor = new Date(`${localDate}T00:00:00Z`);
    if (!Number.isFinite(anchor.getTime())) {
        return localDate;
    }
    anchor.setUTCDate(anchor.getUTCDate() + deltaDays);
    const year = anchor.getUTCFullYear();
    const month = String(anchor.getUTCMonth() + 1).padStart(2, '0');
    const day = String(anchor.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function buildSelectorCacheKpiSnapshot(localDate: string): Promise<SelectorCacheKpiSnapshot> {
    const db = await getDatabase();
    const windowDays = 7;
    const targetReductionRate = 0.3;
    const minBaselineFailures = Math.max(0, config.selectorCacheKpiMinBaselineFailures);
    const currentFrom = computeWindowStartDate(localDate, windowDays);
    const previousTo = shiftDateByDays(currentFrom, -1);
    const previousFrom = computeWindowStartDate(previousTo, windowDays);

    const [currentRow, previousRow] = await Promise.all([
        db.get<{ total: number }>(
            `SELECT COALESCE(SUM(selector_failures), 0) AS total
             FROM daily_stats
             WHERE date >= ?
               AND date <= ?`,
            [currentFrom, localDate],
        ),
        db.get<{ total: number }>(
            `SELECT COALESCE(SUM(selector_failures), 0) AS total
             FROM daily_stats
             WHERE date >= ?
               AND date <= ?`,
            [previousFrom, previousTo],
        ),
    ]);

    const currentFailures = currentRow?.total ?? 0;
    const previousFailures = previousRow?.total ?? 0;
    let reductionRate: number | null = null;
    if (previousFailures > 0) {
        reductionRate = (previousFailures - currentFailures) / previousFailures;
    } else if (currentFailures === 0) {
        reductionRate = 1;
    }
    const baselineSufficient = previousFailures >= minBaselineFailures;
    const validationStatus: SelectorCacheKpiSnapshot['validationStatus'] = !baselineSufficient
        ? 'INSUFFICIENT_DATA'
        : reductionRate !== null && reductionRate >= targetReductionRate
          ? 'PASS'
          : 'WARN';

    return {
        windowDays,
        previousWindowDays: windowDays,
        currentFailures,
        previousFailures,
        reductionRate,
        reductionPct: reductionRate === null ? null : Number.parseFloat((reductionRate * 100).toFixed(2)),
        targetReductionRate,
        minBaselineFailures,
        baselineSufficient,
        validationStatus,
        targetMet: validationStatus === 'PASS',
    };
}

function buildSloThresholds(queueLagWarnSeconds: number, runningJobStaleWarnSeconds: number): OperationalSloThresholds {
    return {
        windowShortDays: Math.max(1, config.observabilitySloWindowShortDays),
        windowLongDays: Math.max(1, config.observabilitySloWindowLongDays),
        errorRateWarn: config.observabilitySloErrorRateWarn,
        errorRateCritical: Math.max(config.observabilitySloErrorRateWarn, config.observabilitySloErrorRateCritical),
        challengeRateWarn: config.observabilitySloChallengeRateWarn,
        challengeRateCritical: Math.max(
            config.observabilitySloChallengeRateWarn,
            config.observabilitySloChallengeRateCritical,
        ),
        selectorFailureRateWarn: config.observabilitySloSelectorFailureRateWarn,
        selectorFailureRateCritical: Math.max(
            config.observabilitySloSelectorFailureRateWarn,
            config.observabilitySloSelectorFailureRateCritical,
        ),
        queueLagWarnSeconds,
        queueLagCriticalSeconds: Math.max(queueLagWarnSeconds + 60, Math.floor(queueLagWarnSeconds * 2)),
        runningJobStaleWarnSeconds,
        runningJobStaleCriticalSeconds: Math.max(
            runningJobStaleWarnSeconds + 60,
            Math.floor(runningJobStaleWarnSeconds * 1.5),
        ),
    };
}

async function buildOperationalSloSnapshot(
    localDate: string,
    queueLagSeconds: number,
    oldestRunningJobSeconds: number,
    queueLagWarnSeconds: number,
    runningJobStaleWarnSeconds: number,
): Promise<OperationalSloSnapshot> {
    const db = await getDatabase();
    const thresholds = buildSloThresholds(queueLagWarnSeconds, runningJobStaleWarnSeconds);

    const queueLagSeverity = evaluateSloValueSeverity(
        queueLagSeconds,
        thresholds.queueLagWarnSeconds,
        thresholds.queueLagCriticalSeconds,
    );
    const runningStaleSeverity = evaluateSloValueSeverity(
        oldestRunningJobSeconds,
        thresholds.runningJobStaleWarnSeconds,
        thresholds.runningJobStaleCriticalSeconds,
    );
    const currentStatus = maxSloSeverity(queueLagSeverity, runningStaleSeverity);

    const windowsToCompute = Array.from(new Set([thresholds.windowShortDays, thresholds.windowLongDays]))
        .filter((value) => value >= 1)
        .sort((a, b) => a - b);

    const windows: OperationalSloWindowSnapshot[] = [];
    let overallStatus: SloSeverity = currentStatus;

    for (const windowDays of windowsToCompute) {
        const fromDate = computeWindowStartDate(localDate, windowDays);
        const row = await db.get<{
            invites: number;
            messages: number;
            run_errors: number;
            challenges: number;
            selector_failures: number;
        }>(
            `
            SELECT
                COALESCE(SUM(invites_sent), 0) AS invites,
                COALESCE(SUM(messages_sent), 0) AS messages,
                COALESCE(SUM(run_errors), 0) AS run_errors,
                COALESCE(SUM(challenges_count), 0) AS challenges,
                COALESCE(SUM(selector_failures), 0) AS selector_failures
            FROM daily_stats
            WHERE date >= ?
              AND date <= ?
        `,
            [fromDate, localDate],
        );

        const invitesSent = row?.invites ?? 0;
        const messagesSent = row?.messages ?? 0;
        const operations = Math.max(1, invitesSent + messagesSent);
        const runErrors = row?.run_errors ?? 0;
        const challengesCount = row?.challenges ?? 0;
        const selectorFailures = row?.selector_failures ?? 0;
        const errorRate = runErrors / operations;
        const challengeRate = challengesCount / operations;
        const selectorFailureRate = selectorFailures / operations;

        const errorRateSeverity = evaluateSloValueSeverity(
            errorRate,
            thresholds.errorRateWarn,
            thresholds.errorRateCritical,
        );
        const challengeRateSeverity = evaluateSloValueSeverity(
            challengeRate,
            thresholds.challengeRateWarn,
            thresholds.challengeRateCritical,
        );
        const selectorFailureRateSeverity = evaluateSloValueSeverity(
            selectorFailureRate,
            thresholds.selectorFailureRateWarn,
            thresholds.selectorFailureRateCritical,
        );

        const windowStatus = maxSloSeverity(
            maxSloSeverity(errorRateSeverity, challengeRateSeverity),
            selectorFailureRateSeverity,
        );
        overallStatus = maxSloSeverity(overallStatus, windowStatus);

        windows.push({
            windowDays,
            fromDate,
            toDate: localDate,
            invitesSent,
            messagesSent,
            operations,
            runErrors,
            challengesCount,
            selectorFailures,
            errorRate,
            challengeRate,
            selectorFailureRate,
            status: windowStatus,
            breaches: {
                errorRate: errorRateSeverity,
                challengeRate: challengeRateSeverity,
                selectorFailureRate: selectorFailureRateSeverity,
            },
        });
    }

    return {
        generatedAt: new Date().toISOString(),
        localDate,
        status: overallStatus,
        thresholds,
        current: {
            queueLagSeconds,
            oldestRunningJobSeconds,
            status: currentStatus,
            breaches: {
                queueLag: queueLagSeverity,
                runningJobStale: runningStaleSeverity,
            },
        },
        windows,
    };
}

export async function getOperationalObservabilitySnapshot(
    localDate: string = getLocalDateString(),
): Promise<OperationalObservabilitySnapshot> {
    const db = await getDatabase();
    const nowMs = Date.now();
    const [daily, pendingOutbox, queueRow, runningRow, lockContention, selectorCacheKpi] = await Promise.all([
        getDailyStatsSnapshot(localDate),
        countPendingOutboxEvents(),
        db.get<{ queued_total: number; oldest_next_run_at: string | null }>(
            `SELECT COUNT(*) AS queued_total, MIN(next_run_at) AS oldest_next_run_at FROM jobs WHERE status = 'QUEUED'`,
        ),
        db.get<{ running_total: number; oldest_locked_at: string | null }>(
            `SELECT COUNT(*) AS running_total, MIN(locked_at) AS oldest_locked_at FROM jobs WHERE status = 'RUNNING'`,
        ),
        getLockContentionSummary(localDate),
        buildSelectorCacheKpiSnapshot(localDate),
    ]);

    const queuedJobs = queueRow?.queued_total ?? 0;
    const runningJobs = runningRow?.running_total ?? 0;
    const queueLagSeconds = computeAgeSeconds(queueRow?.oldest_next_run_at ?? null, nowMs);
    const oldestRunningJobSeconds = computeAgeSeconds(runningRow?.oldest_locked_at ?? null, nowMs);
    const operations = Math.max(1, daily.invitesSent + daily.messagesSent);
    const errorRate = daily.runErrors / operations;

    const alerts: ObservabilityAlert[] = [];
    const queueLagThreshold = Math.max(60, Math.floor((config.workflowLoopIntervalMs / 1000) * 2));
    const runningStaleThreshold = Math.max(60, config.jobStuckMinutes * 60);

    if (queueLagSeconds >= queueLagThreshold) {
        alerts.push({
            code: 'QUEUE_LAG_HIGH',
            severity: 'WARN',
            message: 'Queue lag elevato: job in coda non eseguiti entro la finestra attesa.',
            current: queueLagSeconds,
            threshold: queueLagThreshold,
        });
    }
    if (oldestRunningJobSeconds >= runningStaleThreshold) {
        alerts.push({
            code: 'RUNNING_JOB_STALE',
            severity: 'CRITICAL',
            message: 'Esistono job RUNNING troppo vecchi (possibile lock perso o worker bloccato).',
            current: oldestRunningJobSeconds,
            threshold: runningStaleThreshold,
        });
    }
    if (daily.selectorFailures >= config.maxSelectorFailuresPerDay) {
        alerts.push({
            code: 'SELECTOR_FAILURE_BURST',
            severity: 'CRITICAL',
            message: 'Selector failures sopra soglia giornaliera.',
            current: daily.selectorFailures,
            threshold: config.maxSelectorFailuresPerDay,
        });
    }
    if (daily.runErrors >= config.maxRunErrorsPerDay) {
        alerts.push({
            code: 'RUN_ERROR_BURST',
            severity: 'CRITICAL',
            message: 'Run errors sopra soglia giornaliera.',
            current: daily.runErrors,
            threshold: config.maxRunErrorsPerDay,
        });
    }
    if (daily.challengesCount > 0) {
        alerts.push({
            code: 'CHALLENGES_DETECTED',
            severity: 'WARN',
            message: 'Sono stati rilevati challenge LinkedIn nella giornata corrente.',
            current: daily.challengesCount,
            threshold: 1,
        });
    }

    const contentionTotal =
        lockContention.acquireContended +
        lockContention.acquireStaleTakeover +
        lockContention.heartbeatMiss +
        lockContention.releaseMiss +
        lockContention.queueRaceLost;
    if (contentionTotal > 0) {
        alerts.push({
            code: 'LOCK_CONTENTION',
            severity: 'WARN',
            message: 'Contese lock rilevate. Valutare tuning di scheduling e heartbeat.',
            current: contentionTotal,
            threshold: 1,
        });
    }

    if (selectorCacheKpi.validationStatus === 'WARN') {
        alerts.push({
            code: 'SELECTOR_CACHE_KPI_BELOW_TARGET',
            severity: 'WARN',
            message: 'Riduzione selector failures 7d sotto target 30%.',
            current: Number.parseFloat(((selectorCacheKpi.reductionRate ?? 0) * 100).toFixed(2)),
            threshold: selectorCacheKpi.targetReductionRate * 100,
        });
    }

    const slo = await buildOperationalSloSnapshot(
        localDate,
        queueLagSeconds,
        oldestRunningJobSeconds,
        queueLagThreshold,
        runningStaleThreshold,
    );

    for (const window of slo.windows) {
        const metricBreaches: Array<{
            metric: 'error_rate' | 'challenge_rate' | 'selector_failure_rate';
            severity: SloSeverity;
            current: number;
            warnThreshold: number;
            criticalThreshold: number;
            label: string;
        }> = [
            {
                metric: 'error_rate',
                severity: window.breaches.errorRate,
                current: window.errorRate,
                warnThreshold: slo.thresholds.errorRateWarn,
                criticalThreshold: slo.thresholds.errorRateCritical,
                label: 'Error rate',
            },
            {
                metric: 'challenge_rate',
                severity: window.breaches.challengeRate,
                current: window.challengeRate,
                warnThreshold: slo.thresholds.challengeRateWarn,
                criticalThreshold: slo.thresholds.challengeRateCritical,
                label: 'Challenge rate',
            },
            {
                metric: 'selector_failure_rate',
                severity: window.breaches.selectorFailureRate,
                current: window.selectorFailureRate,
                warnThreshold: slo.thresholds.selectorFailureRateWarn,
                criticalThreshold: slo.thresholds.selectorFailureRateCritical,
                label: 'Selector failure rate',
            },
        ];

        for (const breach of metricBreaches) {
            if (breach.severity === 'OK') continue;
            const threshold = breach.severity === 'CRITICAL' ? breach.criticalThreshold : breach.warnThreshold;
            alerts.push({
                code: `SLO_${breach.metric.toUpperCase()}_${window.windowDays}D`,
                severity: breach.severity === 'CRITICAL' ? 'CRITICAL' : 'WARN',
                message: `${breach.label} ${window.windowDays}d oltre soglia ${breach.severity.toLowerCase()}.`,
                current: Number.parseFloat((breach.current * 100).toFixed(2)),
                threshold: Number.parseFloat((threshold * 100).toFixed(2)),
            });
        }
    }

    return {
        localDate,
        queuedJobs,
        runningJobs,
        queueLagSeconds,
        oldestRunningJobSeconds,
        pendingOutbox,
        invitesSent: daily.invitesSent,
        messagesSent: daily.messagesSent,
        runErrors: daily.runErrors,
        selectorFailures: daily.selectorFailures,
        challengesCount: daily.challengesCount,
        errorRate,
        lockContention,
        alerts,
        slo,
        selectorCacheKpi,
    };
}

export async function getListDailyStat(
    dateString: string,
    listName: string,
    field: 'invites_sent' | 'messages_sent',
): Promise<number> {
    const db = await getDatabase();
    const row = await db.get<Record<string, number>>(
        `SELECT ${field} FROM list_daily_stats WHERE date = ? AND list_name = ?`,
        [dateString, listName],
    );
    return row?.[field] ?? 0;
}

export async function getListDailyStatsBatch(
    dateString: string,
    field: 'invites_sent' | 'messages_sent',
): Promise<Map<string, number>> {
    const db = await getDatabase();
    const rows = await db.query<{ list_name: string } & Record<string, number>>(
        `SELECT list_name, ${field} FROM list_daily_stats WHERE date = ?`,
        [dateString],
    );
    const map = new Map<string, number>();
    for (const row of rows) {
        map.set(row.list_name, row[field] ?? 0);
    }
    return map;
}

export async function incrementDailyStat(
    dateString: string,
    field:
        | 'invites_sent'
        | 'messages_sent'
        | 'acceptances'
        | 'challenges_count'
        | 'selector_failures'
        | 'run_errors'
        | 'follow_ups_sent'
        | 'profile_views'
        | 'likes_given'
        | 'follows_given',
    amount: number = 1,
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        INSERT INTO daily_stats (date, ${field}) VALUES (?, ?)
        ON CONFLICT(date) DO UPDATE SET ${field} = ${field} + ?
    `,
        [dateString, amount, amount],
    );
}

/**
 * Controlla atomicamente se il cap giornaliero è raggiunto e, se no, incrementa.
 * Usa INSERT + ON CONFLICT con RETURNING (SQLite 3.35+) per atomicità.
 *
 * @returns `true` se l'incremento è avvenuto (sotto il cap), `false` se il cap è raggiunto.
 */
export async function checkAndIncrementDailyLimit(
    dateString: string,
    field: 'messages_sent' | 'follow_ups_sent',
    hardCap: number,
): Promise<boolean> {
    const db = await getDatabase();

    // Upsert atomico: INSERT o UPDATE solo se il valore corrente < hardCap
    const result = await db.run(
        `
        INSERT INTO daily_stats (date, ${field}) VALUES (?, 1)
        ON CONFLICT(date) DO UPDATE SET ${field} = ${field} + 1
        WHERE ${field} < ?
    `,
        [dateString, hardCap],
    );

    // Se changes === 0, il WHERE ha bloccato l'update → cap raggiunto
    return (result.changes ?? 0) > 0;
}

export async function incrementListDailyStat(
    dateString: string,
    listName: string,
    field: 'invites_sent' | 'messages_sent',
    amount: number = 1,
): Promise<void> {
    const db = await getDatabase();
    await db.run(
        `
        INSERT INTO list_daily_stats (date, list_name, ${field}) VALUES (?, ?, ?)
        ON CONFLICT(date, list_name) DO UPDATE SET ${field} = ${field} + ?
    `,
        [dateString, listName, amount, amount],
    );
}

export async function countWeeklyInvites(weekStartDate: string): Promise<number> {
    const db = await getDatabase();
    const row = await db.get<{ total: number }>(
        `SELECT COALESCE(SUM(invites_sent), 0) as total FROM daily_stats WHERE date >= ?`,
        [weekStartDate],
    );
    return row?.total ?? 0;
}

export async function getRiskInputs(localDate: string, hardInviteCap: number): Promise<RiskInputs> {
    const db = await getDatabase();
    const pendingInvites = await countLeadsByStatuses(['INVITED']);
    const invitedTotalRow = await db.get<{ total: number }>(
        `SELECT COUNT(*) as total FROM leads WHERE invited_at IS NOT NULL`,
    );
    const invitedTotal = invitedTotalRow?.total ?? 0;
    const pendingRatio = invitedTotal > 0 ? pendingInvites / invitedTotal : 0;

    const attemptsRow = await db.get<{ total: number }>(
        `
        SELECT COUNT(*) as total
        FROM job_attempts
        WHERE started_at >= DATETIME('now', '-24 hours')
    `,
    );
    const failedRow = await db.get<{ total: number }>(
        `
        SELECT COUNT(*) as total
        FROM job_attempts
        WHERE started_at >= DATETIME('now', '-24 hours')
          AND success = 0
    `,
    );
    const totalAttempts = attemptsRow?.total ?? 0;
    const failedAttempts = failedRow?.total ?? 0;
    const errorRate = totalAttempts > 0 ? failedAttempts / totalAttempts : 0;

    const selectorFailures = await getDailyStat(localDate, 'selector_failures');
    const denominator = Math.max(1, totalAttempts);
    const selectorFailureRate = selectorFailures / denominator;

    const challengeCount = await getDailyStat(localDate, 'challenges_count');
    const invitesSent = await getDailyStat(localDate, 'invites_sent');
    const inviteVelocityRatio = hardInviteCap > 0 ? invitesSent / hardInviteCap : 0;

    return {
        pendingRatio,
        errorRate,
        selectorFailureRate,
        challengeCount,
        inviteVelocityRatio,
    };
}

export interface GlobalKPIData {
    totalLeads: number;
    statusCounts: Record<string, number>;
    activeCampaigns: number;
    totalAcceptances7d: number;
}

export async function getGlobalKPIData(): Promise<GlobalKPIData> {
    const db = await getDatabase();
    const counts = await db.query<{ status: string; count: number }>(`
        SELECT status, COUNT(*) as count FROM leads GROUP BY status
    `);

    let totalLeads = 0;
    const statusCounts: Record<string, number> = {};
    for (const row of counts) {
        statusCounts[row.status] = row.count;
        totalLeads += row.count;
    }

    const activeCamps = await db.get<{ count: number }>(`
        SELECT COUNT(*) as count FROM lead_lists WHERE is_active = 1
    `);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoDate = weekAgo.toISOString().slice(0, 10);
    const weeklyAcceptancesRow = await db.get<{ count: number }>(
        `
        SELECT SUM(acceptances) as count
        FROM daily_stats
        WHERE date >= ?
    `,
        [weekAgoDate],
    );

    return {
        totalLeads,
        statusCounts,
        activeCampaigns: activeCamps?.count ?? 0,
        totalAcceptances7d: weeklyAcceptancesRow?.count ?? 0,
    };
}

export async function startCampaignRun(): Promise<number> {
    const db = await getDatabase();
    const startedAt = new Date().toISOString();

    try {
        const inserted = await db.get<{ id?: number | string }>(
            `
            INSERT INTO campaign_runs (start_time, status)
            VALUES (?, 'RUNNING')
            RETURNING id
        `,
            [startedAt],
        );

        const returnedId = inserted?.id;
        if (typeof returnedId === 'number' && Number.isFinite(returnedId)) {
            return returnedId;
        }
        if (typeof returnedId === 'string' && /^[0-9]+$/.test(returnedId)) {
            return Number.parseInt(returnedId, 10);
        }
    } catch {
        // SQLite fallback below.
    }

    const fallbackResult = await db.run(
        `
        INSERT INTO campaign_runs (start_time, status)
        VALUES (?, 'RUNNING')
    `,
        [startedAt],
    );
    if (!fallbackResult.lastID) {
        throw new Error('Failed to create campaign run record');
    }
    return fallbackResult.lastID;
}

export interface CampaignRunMetrics {
    discovered: number;
    invites: number;
    messages: number;
    errors: number;
}

export async function finishCampaignRun(runId: number, status: RunStatus, metrics: CampaignRunMetrics): Promise<void> {
    const db = await getDatabase();
    const finishedAt = new Date().toISOString();
    await db.run(
        `
        UPDATE campaign_runs
        SET
            end_time = ?,
            status = ?,
            profiles_discovered = ?,
            invites_sent = ?,
            messages_sent = ?,
            errors_count = ?
        WHERE id = ?
    `,
        [finishedAt, status, metrics.discovered, metrics.invites, metrics.messages, metrics.errors, runId],
    );
}

export async function getABTestingStats(): Promise<ABTestStats[]> {
    const db = await getDatabase();

    const rows = await db.query<{ variant: string; totalSent: number; totalAccepted: number; totalReplied: number }>(`
        SELECT
            COALESCE(invite_prompt_variant, 'default') as variant,
            COUNT(id) as totalSent,
            SUM(CASE WHEN status IN ('ACCEPTED', 'READY_MESSAGE', 'MESSAGED', 'REPLIED', 'CONNECTED') THEN 1 ELSE 0 END) as totalAccepted,
            SUM(CASE WHEN status IN ('REPLIED', 'CONNECTED') THEN 1 ELSE 0 END) as totalReplied
        FROM leads
        WHERE status NOT IN ('NEW', 'READY_INVITE', 'REVIEW_REQUIRED', 'SKIPPED', 'BLOCKED', 'DEAD', 'WITHDRAWN')
          AND invite_prompt_variant IS NOT NULL
        GROUP BY COALESCE(invite_prompt_variant, 'default')
        ORDER BY totalSent DESC
    `);

    return rows.map((r) => {
        const totalSent = r.totalSent || 0;
        const totalAccepted = r.totalAccepted || 0;
        const totalReplied = r.totalReplied || 0;

        return {
            variant: r.variant,
            totalSent,
            totalAccepted,
            totalReplied,
            acceptanceRate: totalSent > 0 ? (totalAccepted / totalSent) * 100 : 0,
            replyRate: totalSent > 0 ? (totalReplied / totalSent) * 100 : 0,
        };
    });
}

export async function getAccountAgeDays(): Promise<number> {
    const db = await getDatabase();
    const row = await db.get<{ firstDate: string }>(`
        SELECT MIN(created_at) as firstDate FROM leads
    `);

    if (!row || !row.firstDate) {
        return 0;
    }

    const firstDate = new Date(row.firstDate + 'Z');
    const now = new Date();
    const diffMs = now.getTime() - firstDate.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}
