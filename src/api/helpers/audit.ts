import { recordSecurityAuditEvent } from '../../core/repositories';

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
    void recordSecurityAuditEvent(payload).catch(() => null);
}
