import { describe, test, expect, vi, beforeEach } from 'vitest';

// T7: captureError deve sanitizzare il payload PRIMA di inviarlo a Sentry (choke-point unico).
// Prima logError passava il payload RAW a captureError -> PII/secret finivano su Sentry non redatti.
// sanitizeForLogs e' reale (non mockato): testiamo l'integrazione end-to-end della redaction.

const h = vi.hoisted(() => ({
    init: vi.fn(),
    captureException: vi.fn(),
    flush: vi.fn(),
}));

vi.mock('@sentry/node', () => ({
    init: h.init,
    captureException: h.captureException,
    flush: h.flush,
}));

vi.mock('../config/env', () => ({
    parseStringEnv: (key: string, def?: string) =>
        key === 'SENTRY_DSN' ? 'https://abc@o1.ingest.sentry.io/1' : (def ?? ''),
}));

import { initSentry, captureError } from '../telemetry/sentry';

describe('captureError sanitizza il payload prima di Sentry (T7)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        initSentry(); // setta _initialized = true (DSN presente via mock)
    });

    test('chiavi sensibili e PII redatte nel payload extra inviato a Sentry', () => {
        captureError('worker.crash', {
            password: 'topsecret',
            apiToken: 'sk_live_abcdefghijklmnop',
            detail: 'contattami a mario.rossi@acme.com',
            userId: 7,
        });

        expect(h.captureException).toHaveBeenCalledTimes(1);
        const extra = h.captureException.mock.calls[0][1].extra as Record<string, unknown>;
        expect(extra.password).toBe('[REDACTED]');
        expect(extra.apiToken).toBe('[REDACTED]'); // chiave contiene "token"
        expect(String(extra.detail)).not.toContain('mario.rossi@acme.com');
        expect(String(extra.detail)).toContain('[PII_REDACTED]');
        expect(extra.userId).toBe(7); // dato non sensibile preservato
    });
});
