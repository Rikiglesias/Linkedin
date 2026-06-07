import { recordSecurityAuditEvent } from '../../core/repositories';
import { logError } from '../../telemetry/logger';

export function auditSecurityEvent(payload: {
    category: string;
    action: string;
    actor?: string | null;
    accountId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    result: string;
    metadata?: Record<string, unknown>;
}): void {
    // Un audit di sicurezza droppato è esso stesso un evento di sicurezza: non inghiottirlo.
    // logError è best-effort (isolato dal fallimento DB), quindi non rilancia.
    void recordSecurityAuditEvent(payload).catch((err) => {
        void logError('security.audit.write_failed', {
            category: payload.category,
            action: payload.action,
            result: payload.result,
            error: err instanceof Error ? err.message : String(err),
        });
    });
}
