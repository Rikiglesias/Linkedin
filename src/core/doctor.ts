import { config, isWorkingHour } from '../config';
import { checkLogin, closeBrowser, launchBrowser } from '../browser';
import { getEventSyncStatus } from '../sync/eventSync';
import { getRuntimeFlag, listOpenIncidents } from './repositories';

export interface DoctorReport {
    dbPath: string;
    workingHoursOk: boolean;
    sessionLoginOk: boolean;
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

    let sessionLoginOk = false;
    const session = await launchBrowser();
    try {
        sessionLoginOk = await checkLogin(session.page);
    } finally {
        await closeBrowser(session);
    }

    return {
        dbPath: config.dbPath,
        workingHoursOk: isWorkingHour(),
        sessionLoginOk,
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
