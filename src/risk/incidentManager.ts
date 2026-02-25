import { clearAutomationPause, createIncident, pushOutboxEvent, setAutomationPause, setRuntimeFlag } from '../core/repositories';
import { sendTelegramAlert } from '../telemetry/alerts';

export async function quarantineAccount(type: string, details: Record<string, unknown>): Promise<number> {
    const incidentId = await createIncident(type, 'CRITICAL', details);
    await setRuntimeFlag('account_quarantine', 'true');
    await pushOutboxEvent(
        'incident.opened',
        {
            incidentId,
            type,
            severity: 'CRITICAL',
            details,
        },
        `incident.opened:${incidentId}`
    );
    await sendTelegramAlert(`CRITICAL incident #${incidentId}: ${type}`);
    return incidentId;
}

export async function setQuarantine(enabled: boolean): Promise<void> {
    await setRuntimeFlag('account_quarantine', enabled ? 'true' : 'false');
}

export async function pauseAutomation(type: string, details: Record<string, unknown>, minutes: number): Promise<number> {
    const incidentId = await createIncident(type, 'WARN', details);
    const pausedUntil = await setAutomationPause(minutes, type);
    await pushOutboxEvent(
        'automation.paused',
        {
            incidentId,
            type,
            severity: 'WARN',
            pausedUntil,
            details,
        },
        `automation.paused:${incidentId}`
    );
    await sendTelegramAlert(`WARN incident #${incidentId}: ${type}. Automazione in pausa fino a ${pausedUntil ?? 'manual resume'}`);
    return incidentId;
}

export async function resumeAutomation(): Promise<void> {
    await clearAutomationPause();
}
