import { clearAutomationPause, createIncident, pushOutboxEvent, setAutomationPause, setRuntimeFlag } from '../core/repositories';
import { sendTelegramAlert } from '../telemetry/alerts';
import { bridgeAccountHealth } from '../cloud/cloudBridge';

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
    await sendTelegramAlert(`Dettagli:\n\`\`\`json\n${JSON.stringify(details, null, 2)}\n\`\`\``, `CRITICAL incident #${incidentId}: ${type}`, 'critical');
    // Replica cloud: aggiorna health account a RED (non-bloccante)
    bridgeAccountHealth('default', 'RED', type);
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
    await sendTelegramAlert(`Automazione in pausa fino a ${pausedUntil ?? 'manual resume'}\n\nDettagli:\n\`\`\`json\n${JSON.stringify(details, null, 2)}\n\`\`\``, `WARN incident #${incidentId}: ${type}`, 'warn');
    // Replica cloud: aggiorna health account a YELLOW (non-bloccante)
    bridgeAccountHealth('default', 'YELLOW', type, pausedUntil ?? null);
    return incidentId;
}

export async function resumeAutomation(): Promise<void> {
    await clearAutomationPause();
}
