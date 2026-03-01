import { clearAutomationPause, createIncident, countRecentIncidents, pushOutboxEvent, recordSecurityAuditEvent, setAutomationPause, setRuntimeFlag } from '../core/repositories';
import { sendTelegramAlert } from '../telemetry/alerts';
import { broadcastCritical, broadcastWarning } from '../telemetry/broadcaster';
import { bridgeAccountHealth } from '../cloud/cloudBridge';
import { publishLiveEvent } from '../telemetry/liveEvents';
import { reconcileLeadStatus } from '../core/leadStateService';
import { config } from '../config';

function resolveAccountId(details: Record<string, unknown>): string {
    const accountId = details.accountId;
    if (typeof accountId === 'string' && accountId.trim().length > 0) {
        return accountId.trim();
    }
    return 'default';
}

async function recordAuditSafe(payload: Parameters<typeof recordSecurityAuditEvent>[0]): Promise<void> {
    try {
        await recordSecurityAuditEvent(payload);
    } catch {
        // audit is best-effort and must not block incident handling
    }
}

export async function quarantineAccount(type: string, details: Record<string, unknown>): Promise<number> {
    const incidentId = await createIncident(type, 'CRITICAL', details);
    await setRuntimeFlag('account_quarantine', 'true');
    await recordAuditSafe({
        category: 'incident',
        action: 'quarantine_account',
        actor: 'system',
        accountId: resolveAccountId(details),
        entityType: 'account_incident',
        entityId: String(incidentId),
        result: 'ALLOW',
        metadata: { type, details },
    });
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
    bridgeAccountHealth(resolveAccountId(details), 'RED', type);
    publishLiveEvent('incident.opened', {
        incidentId,
        type,
        severity: 'CRITICAL',
        details,
        quarantined: true,
    });
    return incidentId;
}

export async function setQuarantine(enabled: boolean): Promise<void> {
    await setRuntimeFlag('account_quarantine', enabled ? 'true' : 'false');
    if (!enabled) {
        await setRuntimeFlag('challenge_review_pending', 'false');
    }
    await recordAuditSafe({
        category: 'runtime_control',
        action: enabled ? 'quarantine_enable' : 'quarantine_disable',
        actor: 'system',
        result: 'ALLOW',
        metadata: { enabled },
    });
    publishLiveEvent('system.quarantine', { enabled });
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
    await recordAuditSafe({
        category: 'runtime_control',
        action: 'pause_automation',
        actor: 'system',
        accountId: resolveAccountId(details),
        entityType: 'account_incident',
        entityId: String(incidentId),
        result: 'ALLOW',
        metadata: { type, finalMinutes, pausedUntil, details },
    });
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
    bridgeAccountHealth(resolveAccountId(details), 'YELLOW', type, pausedUntil ?? null);
    publishLiveEvent('automation.paused', {
        incidentId,
        type,
        severity: 'WARN',
        pausedUntil,
        details,
    });
    return incidentId;
}

export async function resumeAutomation(): Promise<void> {
    await clearAutomationPause();
    await setRuntimeFlag('challenge_review_pending', 'false');
    await recordAuditSafe({
        category: 'runtime_control',
        action: 'resume_automation',
        actor: 'system',
        result: 'ALLOW',
    });
    publishLiveEvent('automation.resumed', {});
}

export interface ChallengeDetectionInput {
    source: string;
    accountId?: string;
    leadId?: number;
    linkedinUrl?: string;
    jobId?: number;
    jobType?: string;
    message?: string;
    extra?: Record<string, unknown>;
}

export async function handleChallengeDetected(input: ChallengeDetectionInput): Promise<number> {
    const details: Record<string, unknown> = {
        source: input.source,
        accountId: (input.accountId ?? 'default').trim() || 'default',
        leadId: input.leadId ?? null,
        linkedinUrl: input.linkedinUrl ?? null,
        jobId: input.jobId ?? null,
        jobType: input.jobType ?? null,
        message: input.message ?? 'Challenge/CAPTCHA rilevato',
        detectedAt: new Date().toISOString(),
        ...(input.extra ?? {}),
    };

    const incidentId = await pauseAutomation(
        'CHALLENGE_DETECTED',
        details,
        config.challengePauseMinutes
    );

    if (typeof input.leadId === 'number' && Number.isFinite(input.leadId)) {
        try {
            await reconcileLeadStatus(
                input.leadId,
                'REVIEW_REQUIRED',
                'challenge_detected_review_queue',
                {
                    incidentId,
                    source: input.source,
                    accountId: details.accountId,
                }
            );
        } catch {
            // best effort: challenge handling must continue even if lead transition fails
        }
    }

    await pushOutboxEvent(
        'challenge.review_queued',
        {
            incidentId,
            ...details,
        },
        `challenge.review_queued:${incidentId}:${input.leadId ?? 'none'}:${input.source}`
    );
    await setRuntimeFlag('challenge_review_pending', 'true');
    await setRuntimeFlag('challenge_review_last_incident_id', String(incidentId));
    publishLiveEvent('challenge.review_queued', {
        incidentId,
        ...details,
    });

    return incidentId;
}
