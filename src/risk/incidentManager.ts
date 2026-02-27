import { clearAutomationPause, createIncident, countRecentIncidents, pushOutboxEvent, setAutomationPause, setRuntimeFlag } from '../core/repositories';
import { sendTelegramAlert } from '../telemetry/alerts';
import { broadcastCritical, broadcastWarning } from '../telemetry/broadcaster';
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
    // Multi-channel broadcast
    broadcastCritical(`CRITICAL incident #${incidentId}: ${type}`, `Account messo in quarantena.`, details).catch(() => { });
    // Replica cloud: aggiorna health account a RED (non-bloccante)
    bridgeAccountHealth('default', 'RED', type);
    return incidentId;
}

export async function setQuarantine(enabled: boolean): Promise<void> {
    await setRuntimeFlag('account_quarantine', enabled ? 'true' : 'false');
}

export async function pauseAutomation(type: string, details: Record<string, unknown>, baseMinutes: number): Promise<number> {
    let finalMinutes = baseMinutes;

    // Exponential Backoff implementation
    if (type.includes('429') || type === 'HTTP_429_RATE_LIMIT') {
        const recentIncidents = await countRecentIncidents(type, 24); // count same incidents in last 24h
        const backoffMultiplier = Math.pow(2, recentIncidents);
        finalMinutes = Math.min(24 * 60, Math.floor(baseMinutes * backoffMultiplier)); // max 24h
        details = {
            ...details,
            recentIncidents,
            backoffMultiplier,
            baseMinutes,
            finalMinutes
        };
    }

    const incidentId = await createIncident(type, 'WARN', details);
    const pausedUntil = await setAutomationPause(finalMinutes, type);
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
    // Multi-channel broadcast
    broadcastWarning(`WARN incident #${incidentId}: ${type}`, `Automazione in pausa fino a ${pausedUntil ?? 'manual resume'}.`, details).catch(() => { });
    // Replica cloud: aggiorna health account a YELLOW (non-bloccante)
    bridgeAccountHealth('default', 'YELLOW', type, pausedUntil ?? null);
    return incidentId;
}

export async function resumeAutomation(): Promise<void> {
    await clearAutomationPause();
}
