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
    openIncidents: number;
}

export async function runDoctor(): Promise<DoctorReport> {
    const quarantine = (await getRuntimeFlag('account_quarantine')) === 'true';
    const sync = await getEventSyncStatus();
    const incidents = await listOpenIncidents();

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
        openIncidents: incidents.length,
    };
}
