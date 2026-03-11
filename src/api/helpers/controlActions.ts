/**
 * api/helpers/controlActions.ts
 * ─────────────────────────────────────────────────────────────────
 * Helper condivisi per le azioni controls (pause/resume/quarantine).
 * Usati da route legacy /api/controls/* e v1 /api/v1/automation/controls/*.
 * Estratti da server.ts per modularità.
 */

import type { Request } from 'express';
import { PauseSchema, QuarantineSchema } from '../schemas';
import { pauseAutomation, resumeAutomation, setQuarantine } from '../../risk/incidentManager';
import { recordSecurityAuditEvent } from '../../core/repositories';

function resolveRequestIp(req: Request): string {
    const fromExpress = (req.ip ?? '').trim();
    if (fromExpress && fromExpress !== '::1') return fromExpress.startsWith('::ffff:') ? fromExpress.slice(7) : fromExpress;
    if (fromExpress === '::1') return '127.0.0.1';
    const fallback = req.socket?.remoteAddress ?? '';
    return fallback.trim().startsWith('::ffff:') ? fallback.trim().slice(7) : fallback.trim();
}

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

function resolveQuarantineEnabled(payload: unknown): boolean {
    const parsed = QuarantineSchema.safeParse(payload);
    if (!parsed.success) throw parsed.error;
    if ('enabled' in parsed.data) return parsed.data.enabled;
    return parsed.data.action === 'set';
}

export async function handlePauseAction(
    req: Request,
    source: string,
    defaultMinutes?: number,
): Promise<{ success: boolean; minutes: number }> {
    const payload = defaultMinutes !== undefined && req.body?.minutes === undefined
        ? { minutes: defaultMinutes }
        : req.body;
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
    await resumeAutomation();
    auditSecurityEvent({
        category: 'runtime_control',
        action: 'resume',
        actor: resolveRequestIp(req),
        result: 'ALLOW',
        metadata: { source },
    });
}

export async function handleQuarantineAction(req: Request, source: string): Promise<{ enabled: boolean }> {
    const enabled = resolveQuarantineEnabled(req.body);
    await setQuarantine(enabled);
    auditSecurityEvent({
        category: 'runtime_control',
        action: enabled ? 'quarantine_enable' : 'quarantine_disable',
        actor: resolveRequestIp(req),
        result: 'ALLOW',
        metadata: { enabled, source },
    });
    return { enabled };
}
