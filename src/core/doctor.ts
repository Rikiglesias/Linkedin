import { config, isWorkingHour } from '../config';
import { checkLogin, closeBrowser, launchBrowser } from '../browser';
import { getRuntimeAccountProfiles } from '../accountManager';
import { getEventSyncStatus } from '../sync/eventSync';
import { getRuntimeFlag, listOpenIncidents } from './repositories';

export interface DoctorAccountSessionReport {
    accountId: string;
    sessionDir: string;
    sessionLoginOk: boolean;
}

export interface DoctorReport {
    dbPath: string;
    workingHoursOk: boolean;
    sessionLoginOk: boolean;
    accountSessions: DoctorAccountSessionReport[];
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

export async function runDoctor(): Promise<DoctorReport> {
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

    return {
        dbPath: config.dbPath,
        workingHoursOk: isWorkingHour(),
        sessionLoginOk,
        accountSessions,
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
