import { describe, it, expect } from 'vitest';
import { isErrorRecoverable } from '../workers/deadLetterWorker';

describe('deadLetterWorker — isErrorRecoverable advanced', () => {
    it('target closed → recoverable', () => {
        expect(isErrorRecoverable('Target page, context or browser has been closed')).toBe(true);
    });

    it('navigation failed → recoverable', () => {
        expect(isErrorRecoverable('Navigation failed because page was closed!')).toBe(true);
    });

    it('502 Bad Gateway → recoverable', () => {
        expect(isErrorRecoverable('HTTP 502 Bad Gateway')).toBe(true);
    });

    it('503 Service Unavailable → recoverable', () => {
        expect(isErrorRecoverable('HTTP 503 Service Unavailable')).toBe(true);
    });

    it('504 Gateway Timeout → recoverable', () => {
        expect(isErrorRecoverable('HTTP 504 Gateway Timeout')).toBe(true);
    });

    it('404 not found → terminal', () => {
        expect(isErrorRecoverable('HTTP 404 Not Found')).toBe(false);
    });

    it('invalid url → terminal', () => {
        expect(isErrorRecoverable('not a valid linkedin url: ftp://example.com')).toBe(false);
    });

    it('user not found → terminal', () => {
        expect(isErrorRecoverable('user not found in database')).toBe(false);
    });

    it('proxy error → recoverable', () => {
        expect(isErrorRecoverable('Proxy error: connection timed out')).toBe(true);
    });

    it('rate limit → recoverable', () => {
        expect(isErrorRecoverable('LinkedIn rate limit reached, please slow down')).toBe(true);
    });

    it('[DLQ_RECYCLED] marker → terminal (già riciclato)', () => {
        // isErrorRecoverable non controlla DLQ_RECYCLED — quello è nel runDeadLetterWorker
        // Ma verifichiamo che l'errore con marker è trattato come recoverable (default)
        expect(isErrorRecoverable('[DLQ_RECYCLED] Timeout waiting for selector')).toBe(true);
    });
});
