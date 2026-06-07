import { describe, test, expect, vi, beforeEach } from 'vitest';

// Ondata-4: auditSecurityEvent inghiottiva i fallimenti di scrittura (.catch(()=>null)). Un audit
// di sicurezza droppato è esso stesso un evento di sicurezza -> ora viene loggato (logError).

const mocks = vi.hoisted(() => ({ recordSecurityAuditEvent: vi.fn(), logError: vi.fn() }));
vi.mock('../core/repositories', () => ({ recordSecurityAuditEvent: mocks.recordSecurityAuditEvent }));
vi.mock('../telemetry/logger', () => ({ logError: mocks.logError }));

import { auditSecurityEvent } from '../api/helpers/audit';

describe('auditSecurityEvent non inghiotte i fallimenti (Ondata-4)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.logError.mockResolvedValue(undefined);
    });

    test('write fallita → logError security.audit.write_failed', async () => {
        mocks.recordSecurityAuditEvent.mockRejectedValue(new Error('db down'));

        auditSecurityEvent({ category: 'auth', action: 'login', result: 'failure' });
        await new Promise((r) => setTimeout(r, 0)); // flush della microtask del .catch

        expect(mocks.logError).toHaveBeenCalledWith(
            'security.audit.write_failed',
            expect.objectContaining({ category: 'auth', action: 'login' }),
        );
    });

    test('write riuscita → nessun logError', async () => {
        mocks.recordSecurityAuditEvent.mockResolvedValue(undefined);

        auditSecurityEvent({ category: 'auth', action: 'logout', result: 'success' });
        await new Promise((r) => setTimeout(r, 0));

        expect(mocks.logError).not.toHaveBeenCalled();
    });
});
