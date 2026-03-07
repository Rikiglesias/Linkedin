import { config, getLocalDateString, getWeekStartDate, isWorkingHour } from '../config';
import { checkLogin, closeBrowser, launchBrowser } from '../browser';
import { getRuntimeAccountProfiles } from '../accountManager';
import { getEventSyncStatus } from '../sync/eventSync';
import {
    countWeeklyInvites,
    getAccountAgeDays,
    getComplianceHealthMetrics,
    getDailyStat,
    getRuntimeFlag,
    getRiskInputs,
    listOpenIncidents,
} from './repositories';
import { closeDatabase, getDatabase, initDatabase } from '../db';
import fs from 'fs';
import path from 'path';
import { calculateDynamicWeeklyInviteLimit, evaluateComplianceHealthScore } from '../risk/riskEngine';
import { getSecurityAdvisorPosture } from './securityAdvisor';

export interface DoctorAccountSessionReport {
    accountId: string;
    sessionDir: string;
    sessionLoginOk: boolean;
}

export interface DoctorReport {
    dbPath: string;
    dbIntegrityOk: boolean;
    dbRestoreAttempted: boolean;
    dbRestorePath: string | null;
    workingHoursOk: boolean;
    sessionLoginOk: boolean;
    accountSessions: DoctorAccountSessionReport[];
    accountIsolation: {
        ok: boolean;
        warnings: string[];
    };
    quarantine: boolean;
    sync: {
        activeSink: 'SUPABASE' | 'WEBHOOK' | 'NONE';
        enabled: boolean;
        configured: boolean;
        pendingOutbox: number;
        warning: string | null;
    };
    disasterRecovery: {
        enabled: boolean;
        intervalDays: number;
        lastRunAt: string | null;
        lastStatus: string | null;
        lastReportPath: string | null;
        stale: boolean;
        warning: string | null;
    };
    compliance: {
        enforced: boolean;
        ok: boolean;
        violations: string[];
        limits: {
            softInviteCap: number;
            hardInviteCap: number;
            weeklyInviteLimit: number;
            softMsgCap: number;
            hardMsgCap: number;
        };
        dynamic: {
            accountAgeDays: number;
            weeklyInvitesSent: number;
            weeklyInviteLimitEffective: number;
            pendingRatio: number;
            healthScore: number | null;
        };
    };
    securityAdvisor: {
        enabled: boolean;
        intervalDays: number;
        lastRunAt: string | null;
        lastStatus: string | null;
        lastReason: string | null;
        lastReportPath: string | null;
        lastFindingsCount: number | null;
        lastBacklogCount: number | null;
        stale: boolean;
        elapsedDaysSinceRun: number | null;
        warning: string | null;
    };
    openIncidents: number;
}

async function evaluateCompliance(): Promise<DoctorReport['compliance']> {
    const violations: string[] = [];
    const localDate = getLocalDateString();
    const weekStart = getWeekStartDate();
    const [accountAgeDays, weeklyInvitesSent, riskInputs] = await Promise.all([
        getAccountAgeDays(),
        countWeeklyInvites(weekStart),
        getRiskInputs(localDate, config.hardInviteCap),
    ]);
    const weeklyInviteLimitEffective = config.complianceDynamicWeeklyLimitEnabled
        ? calculateDynamicWeeklyInviteLimit(
              accountAgeDays,
              config.complianceDynamicWeeklyMinInvites,
              Math.min(config.complianceDynamicWeeklyMaxInvites, config.weeklyInviteLimit),
              config.complianceDynamicWeeklyWarmupDays,
          )
        : config.weeklyInviteLimit;

    if (config.softInviteCap > config.hardInviteCap) {
        violations.push(`SOFT_INVITE_CAP (${config.softInviteCap}) > HARD_INVITE_CAP (${config.hardInviteCap})`);
    }
    if (config.softMsgCap > config.hardMsgCap) {
        violations.push(`SOFT_MSG_CAP (${config.softMsgCap}) > HARD_MSG_CAP (${config.hardMsgCap})`);
    }
    if (config.hardInviteCap > config.complianceMaxHardInviteCap) {
        violations.push(
            `HARD_INVITE_CAP (${config.hardInviteCap}) supera il massimo compliance (${config.complianceMaxHardInviteCap})`,
        );
    }
    if (config.weeklyInviteLimit > config.complianceMaxWeeklyInviteLimit) {
        violations.push(
            `WEEKLY_INVITE_LIMIT (${config.weeklyInviteLimit}) supera il massimo compliance (${config.complianceMaxWeeklyInviteLimit})`,
        );
    }
    if (config.weeklyInviteLimit > weeklyInviteLimitEffective) {
        violations.push(
            `WEEKLY_INVITE_LIMIT (${config.weeklyInviteLimit}) supera il limite dinamico (${weeklyInviteLimitEffective})`,
        );
    }
    if (config.hardMsgCap > config.complianceMaxHardMsgCap) {
        violations.push(
            `HARD_MSG_CAP (${config.hardMsgCap}) supera il massimo compliance (${config.complianceMaxHardMsgCap})`,
        );
    }
    if (weeklyInvitesSent > weeklyInviteLimitEffective) {
        violations.push(
            `INVITI_SETTIMANA (${weeklyInvitesSent}) oltre limite dinamico (${weeklyInviteLimitEffective})`,
        );
    }
    if (riskInputs.pendingRatio > config.complianceHealthPendingWarnThreshold) {
        violations.push(
            `PENDING_RATIO (${riskInputs.pendingRatio.toFixed(3)}) oltre soglia (${config.complianceHealthPendingWarnThreshold})`,
        );
    }

    let healthScore: number | null = null;
    if (config.complianceHealthScoreEnabled) {
        const [healthMetrics, invitesSentToday, messagesSentToday] = await Promise.all([
            getComplianceHealthMetrics(localDate, config.complianceHealthLookbackDays, config.hardInviteCap),
            getDailyStat(localDate, 'invites_sent'),
            getDailyStat(localDate, 'messages_sent'),
        ]);
        const healthSnapshot = evaluateComplianceHealthScore({
            acceptanceRatePct: healthMetrics.acceptanceRatePct,
            engagementRatePct: healthMetrics.engagementRatePct,
            pendingRatio: healthMetrics.pendingRatio,
            invitesSentToday,
            messagesSentToday,
            weeklyInvitesSent,
            dailyInviteLimit: Math.max(1, config.softInviteCap),
            dailyMessageLimit: Math.max(1, config.softMsgCap),
            weeklyInviteLimit: Math.max(1, weeklyInviteLimitEffective),
            pendingWarnThreshold: config.complianceHealthPendingWarnThreshold,
        });
        healthScore = healthSnapshot.score;
        const hasSufficientSample =
            healthMetrics.invitesSentLookback >= config.complianceHealthMinInviteSample &&
            healthMetrics.messagedLookback >= config.complianceHealthMinMessageSample;
        if (hasSufficientSample && healthSnapshot.score < config.complianceHealthPauseThreshold) {
            violations.push(
                `HEALTH_SCORE (${healthSnapshot.score}) sotto soglia (${config.complianceHealthPauseThreshold})`,
            );
        }
    }

    const enforced = config.complianceEnforced;
    return {
        enforced,
        ok: !enforced || violations.length === 0,
        violations,
        limits: {
            softInviteCap: config.softInviteCap,
            hardInviteCap: config.hardInviteCap,
            weeklyInviteLimit: config.weeklyInviteLimit,
            softMsgCap: config.softMsgCap,
            hardMsgCap: config.hardMsgCap,
        },
        dynamic: {
            accountAgeDays,
            weeklyInvitesSent,
            weeklyInviteLimitEffective,
            pendingRatio: Number.parseFloat(riskInputs.pendingRatio.toFixed(4)),
            healthScore,
        },
    };
}

function resolveBackupCandidates(): string[] {
    const dbParsed = path.parse(config.dbPath);
    const localDir = dbParsed.dir;
    const defaultBackupDir = path.resolve(process.cwd(), 'data', 'backups');
    const dirs = Array.from(new Set([localDir, defaultBackupDir]));
    const files: string[] = [];
    for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        const currentFiles = fs
            .readdirSync(dir)
            .filter((file) => file.endsWith('.sqlite'))
            .map((file) => path.join(dir, file));
        files.push(...currentFiles);
    }
    return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

async function runDbIntegrityCheckAndRestoreIfNeeded(): Promise<{
    ok: boolean;
    restoreAttempted: boolean;
    restorePath: string | null;
}> {
    if (config.databaseUrl && config.databaseUrl.startsWith('postgres')) {
        return { ok: true, restoreAttempted: false, restorePath: null };
    }

    const db = await getDatabase();
    const integrityRow = await db.get<{ integrity_check?: string; integrity?: string }>(`PRAGMA integrity_check`);
    const status = (integrityRow?.integrity_check ?? integrityRow?.integrity ?? '').toLowerCase();
    if (status === 'ok') {
        return { ok: true, restoreAttempted: false, restorePath: null };
    }

    const candidates = resolveBackupCandidates();
    const latestBackup = candidates.find((candidate) => candidate !== config.dbPath) ?? null;
    if (!latestBackup) {
        return { ok: false, restoreAttempted: false, restorePath: null };
    }

    await closeDatabase();
    const corruptedBackupPath = `${config.dbPath}.corrupted.${Date.now()}`;
    try {
        fs.copyFileSync(config.dbPath, corruptedBackupPath);
    } catch {
        // Best effort: if the DB file is locked or missing, proceed with restore anyway
    }
    fs.copyFileSync(latestBackup, config.dbPath);
    await initDatabase();

    const reloadedDb = await getDatabase();
    const recheckRow = await reloadedDb.get<{ integrity_check?: string; integrity?: string }>(`PRAGMA integrity_check`);
    const recheck = (recheckRow?.integrity_check ?? recheckRow?.integrity ?? '').toLowerCase();
    return {
        ok: recheck === 'ok',
        restoreAttempted: true,
        restorePath: latestBackup,
    };
}

export async function runDoctor(): Promise<DoctorReport> {
    const dbHealth = await runDbIntegrityCheckAndRestoreIfNeeded();
    const [
        quarantineFlag,
        sync,
        incidents,
        compliance,
        drLastRunAtRaw,
        drLastStatus,
        drLastReportPath,
        securityAdvisor,
    ] = await Promise.all([
        getRuntimeFlag('account_quarantine'),
        getEventSyncStatus(),
        listOpenIncidents(),
        evaluateCompliance(),
        getRuntimeFlag('dr_restore_test_last_run_at'),
        getRuntimeFlag('dr_restore_test_last_status'),
        getRuntimeFlag('dr_restore_test_last_report_path'),
        getSecurityAdvisorPosture(),
    ]);
    const quarantine = quarantineFlag === 'true';
    const drLastRunAt =
        drLastRunAtRaw && Number.isFinite(Date.parse(drLastRunAtRaw)) ? new Date(drLastRunAtRaw).toISOString() : null;
    const drStale = (() => {
        if (!config.disasterRecoveryRestoreTestEnabled) return false;
        if (!drLastRunAt) return true;
        const elapsedDays = (Date.now() - Date.parse(drLastRunAt)) / 86_400_000;
        return elapsedDays > config.disasterRecoveryRestoreTestIntervalDays;
    })();
    const drWarning = (() => {
        if (!config.disasterRecoveryRestoreTestEnabled) return null;
        if (!drLastRunAt) return 'restore_drill_never_executed';
        if (drStale) return 'restore_drill_stale';
        if (drLastStatus === 'FAILED') return 'restore_drill_last_failed';
        return null;
    })();

    const accountSessions: DoctorAccountSessionReport[] = [];
    const accounts = getRuntimeAccountProfiles();
    for (const account of accounts) {
        const session = await launchBrowser({
            sessionDir: account.sessionDir,
            proxy: account.proxy,
        });
        try {
            const sessionLoginOk = await checkLogin(session.page);
            accountSessions.push({
                accountId: account.id,
                sessionDir: account.sessionDir,
                sessionLoginOk,
            });
        } finally {
            await closeBrowser(session);
        }
    }
    const sessionLoginOk = accountSessions.every((entry) => entry.sessionLoginOk);
    const isolationWarnings: string[] = [];
    const sessionDirs = accountSessions.map((entry) => path.resolve(entry.sessionDir));
    const uniqueSessionDirs = new Set(sessionDirs);
    if (uniqueSessionDirs.size < sessionDirs.length) {
        isolationWarnings.push('Session directories duplicate tra account runtime.');
    }
    const proxies = accounts
        .map((account) => account.proxy?.server?.trim())
        .filter((value): value is string => !!value && value.length > 0);
    const uniqueProxies = new Set(proxies);
    if (proxies.length > 1 && uniqueProxies.size < proxies.length) {
        isolationWarnings.push('Proxy condiviso tra più account runtime.');
    }

    return {
        dbPath: config.dbPath,
        dbIntegrityOk: dbHealth.ok,
        dbRestoreAttempted: dbHealth.restoreAttempted,
        dbRestorePath: dbHealth.restorePath,
        workingHoursOk: isWorkingHour(),
        sessionLoginOk,
        accountSessions,
        accountIsolation: {
            ok: isolationWarnings.length === 0,
            warnings: isolationWarnings,
        },
        quarantine,
        sync: {
            activeSink: sync.activeSink,
            enabled: sync.enabled,
            configured: sync.configured,
            pendingOutbox: sync.pendingOutbox,
            warning: sync.warning,
        },
        disasterRecovery: {
            enabled: config.disasterRecoveryRestoreTestEnabled,
            intervalDays: config.disasterRecoveryRestoreTestIntervalDays,
            lastRunAt: drLastRunAt,
            lastStatus: drLastStatus,
            lastReportPath: drLastReportPath || null,
            stale: drStale,
            warning: drWarning,
        },
        compliance,
        securityAdvisor: {
            enabled: securityAdvisor.enabled,
            intervalDays: securityAdvisor.intervalDays,
            lastRunAt: securityAdvisor.lastRunAt,
            lastStatus: securityAdvisor.lastStatus,
            lastReason: securityAdvisor.lastReason,
            lastReportPath: securityAdvisor.lastReportPath,
            lastFindingsCount: securityAdvisor.lastFindingsCount,
            lastBacklogCount: securityAdvisor.lastBacklogCount,
            stale: securityAdvisor.stale,
            elapsedDaysSinceRun: securityAdvisor.elapsedDaysSinceRun,
            warning: securityAdvisor.warning,
        },
        openIncidents: incidents.length,
    };
}
