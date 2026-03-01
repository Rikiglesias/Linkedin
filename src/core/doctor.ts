import { config, isWorkingHour } from '../config';
import { checkLogin, closeBrowser, launchBrowser } from '../browser';
import { getRuntimeAccountProfiles } from '../accountManager';
import { getEventSyncStatus } from '../sync/eventSync';
import { getRuntimeFlag, listOpenIncidents } from './repositories';
import { closeDatabase, getDatabase, initDatabase } from '../db';
import fs from 'fs';
import path from 'path';

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
    };
    openIncidents: number;
}

function evaluateCompliance(): DoctorReport['compliance'] {
    const violations: string[] = [];

    if (config.softInviteCap > config.hardInviteCap) {
        violations.push(`SOFT_INVITE_CAP (${config.softInviteCap}) > HARD_INVITE_CAP (${config.hardInviteCap})`);
    }
    if (config.softMsgCap > config.hardMsgCap) {
        violations.push(`SOFT_MSG_CAP (${config.softMsgCap}) > HARD_MSG_CAP (${config.hardMsgCap})`);
    }
    if (config.hardInviteCap > config.complianceMaxHardInviteCap) {
        violations.push(`HARD_INVITE_CAP (${config.hardInviteCap}) supera il massimo compliance (${config.complianceMaxHardInviteCap})`);
    }
    if (config.weeklyInviteLimit > config.complianceMaxWeeklyInviteLimit) {
        violations.push(`WEEKLY_INVITE_LIMIT (${config.weeklyInviteLimit}) supera il massimo compliance (${config.complianceMaxWeeklyInviteLimit})`);
    }
    if (config.hardMsgCap > config.complianceMaxHardMsgCap) {
        violations.push(`HARD_MSG_CAP (${config.hardMsgCap}) supera il massimo compliance (${config.complianceMaxHardMsgCap})`);
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
        const currentFiles = fs.readdirSync(dir)
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
    const quarantine = (await getRuntimeFlag('account_quarantine')) === 'true';
    const sync = await getEventSyncStatus();
    const incidents = await listOpenIncidents();
    const compliance = evaluateCompliance();

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
        compliance,
        openIncidents: incidents.length,
    };
}
