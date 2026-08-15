/**
 * api/helpers/controlActions.ts
 * ─────────────────────────────────────────────────────────────────
 * Helper condivisi per le azioni controls (pause/resume/quarantine).
 * Usati da route legacy /api/controls/* e v1 /api/v1/automation/controls/*.
 * Estratti da server.ts per modularità.
 */

import type { Request } from 'express';
import { PauseSchema, QuarantineSchema } from '../schemas';
import { pauseAutomation, setQuarantine } from '../../risk/incidentManager';
import { releaseAutomationPause } from '../../core/repositories';
import { ControlActionRejected } from './controlErrors';
import { publishLiveEvent } from '../../telemetry/liveEvents';
import { recordSecurityAuditEvent } from '../../core/repositories';
import { resolveRequestIp } from './requestIp';

function auditSecurityEvent(event: {
    category: string;
    action: string;
    actor: string;
    result: string;
    metadata?: Record<string, unknown>;
}): void {
    void recordSecurityAuditEvent({
        ...event,
        entityType: undefined,
        entityId: undefined,
    }).catch(() => null);
}

function resolveQuarantineRequest(payload: unknown): { enabled: boolean; accountId?: string } {
    const parsed = QuarantineSchema.safeParse(payload);
    if (!parsed.success) throw parsed.error;
    const enabled = 'enabled' in parsed.data ? parsed.data.enabled : parsed.data.action === 'set';
    // G5-F2: accountId opzionale (validato da zod) → quarantena per-account; assente = flag globale.
    return { enabled, accountId: parsed.data.accountId };
}

export async function handlePauseAction(
    req: Request,
    source: string,
    defaultMinutes?: number,
): Promise<{ success: boolean; minutes: number }> {
    const payload =
        defaultMinutes !== undefined && req.body?.minutes === undefined ? { minutes: defaultMinutes } : req.body;
    const parsed = PauseSchema.safeParse(payload);
    if (!parsed.success) throw parsed.error;
    const minutes = parsed.data.minutes;
    await pauseAutomation(`MANUAL_${source.toUpperCase()}_PAUSE`, { source }, minutes);
    auditSecurityEvent({
        category: 'runtime_control',
        action: 'pause',
        actor: resolveRequestIp(req),
        result: 'ALLOW',
        metadata: { minutes, source },
    });
    return { success: true, minutes };
}

export async function handleResumeAction(req: Request, source: string): Promise<void> {
    // Canale OPERATOR: chi clicca ha l'incidente a schermo. Senza `force` esplicito nel body,
    // una pausa aperta dal sistema NON si spegne per un click distratto; con `force` si', e
    // resta scritto nell'audit che e' stata una decisione presa, non un resume di routine.
    const force = req.body?.force === true;
    const esito = await releaseAutomationPause({ channel: 'OPERATOR', force });
    auditSecurityEvent({
        category: 'runtime_control',
        action: 'resume',
        actor: resolveRequestIp(req),
        result: esito.released ? 'ALLOW' : 'DENY',
        metadata: { source, forced: esito.forced, blockedBy: esito.blockedBy, pauseReason: esito.reason },
    });
    if (!esito.released) {
        throw new ControlActionRejected(esito.blockedBy ?? 'SYSTEM_PAUSE', esito.reason);
    }
    // `resumeAutomation` non e' piu' sul percorso remoto: l'evento live che pubblicava va
    // ripubblicato qui, altrimenti la dashboard non vedrebbe piu' la ripresa in tempo reale.
    publishLiveEvent('automation.resumed', { source, forced: esito.forced });
}

export async function handleQuarantineAction(
    req: Request,
    source: string,
): Promise<{ enabled: boolean; accountId: string }> {
    const { enabled, accountId } = resolveQuarantineRequest(req.body);
    await setQuarantine(enabled, accountId);
    auditSecurityEvent({
        category: 'runtime_control',
        action: enabled ? 'quarantine_enable' : 'quarantine_disable',
        actor: resolveRequestIp(req),
        result: 'ALLOW',
        metadata: { enabled, source, accountId: accountId ?? 'default' },
    });
    return { enabled, accountId: accountId ?? 'default' };
}
