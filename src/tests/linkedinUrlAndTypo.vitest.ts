import { describe, it, expect } from 'vitest';
import { normalizeLinkedInUrl, isSalesNavigatorUrl } from '../linkedinUrl';
import { isErrorRecoverable } from '../workers/deadLetterWorker';

describe('linkedinUrl', () => {
    describe('normalizeLinkedInUrl', () => {
        it('canonicalizza a /in/slug/ con trailing slash', () => {
            expect(normalizeLinkedInUrl('https://www.linkedin.com/in/marco-rossi')).toBe(
                'https://www.linkedin.com/in/marco-rossi/',
            );
        });

        it('rimuove parametri query', () => {
            const url = normalizeLinkedInUrl('https://www.linkedin.com/in/marco-rossi?trk=abc&ref=123');
            expect(url).not.toContain('?');
            expect(url).not.toContain('trk');
        });

        it('normalizza hostname a www.linkedin.com', () => {
            const url = normalizeLinkedInUrl('https://www.LinkedIn.com/in/Marco-Rossi');
            expect(url).toContain('www.linkedin.com');
        });

        it('stringa vuota → stringa vuota', () => {
            expect(normalizeLinkedInUrl('')).toBe('');
        });
    });

    describe('isSalesNavigatorUrl', () => {
        it('/sales/lead/ → true', () => {
            expect(isSalesNavigatorUrl('https://www.linkedin.com/sales/lead/ABC123')).toBe(true);
        });

        it('/sales/people/ → true', () => {
            expect(isSalesNavigatorUrl('https://www.linkedin.com/sales/people/ABC123')).toBe(true);
        });

        it('/in/marco-rossi → false', () => {
            expect(isSalesNavigatorUrl('https://www.linkedin.com/in/marco-rossi')).toBe(false);
        });

        it('stringa vuota → false', () => {
            expect(isSalesNavigatorUrl('')).toBe(false);
        });
    });
});

describe('deadLetterWorker — isErrorRecoverable', () => {
    it('timeout → recoverable', () => {
        expect(isErrorRecoverable('Timeout waiting for selector')).toBe(true);
    });

    it('network error → recoverable', () => {
        expect(isErrorRecoverable('net::ERR_CONNECTION_REFUSED')).toBe(true);
    });

    it('ECONNREFUSED → recoverable', () => {
        expect(isErrorRecoverable('connect ECONNREFUSED 127.0.0.1:9222')).toBe(true);
    });

    it('429 rate limit → recoverable', () => {
        expect(isErrorRecoverable('HTTP 429 Too Many Requests')).toBe(true);
    });

    it('page not found → terminal', () => {
        expect(isErrorRecoverable('page not found')).toBe(false);
    });

    it('banned → terminal', () => {
        expect(isErrorRecoverable('Account banned by LinkedIn')).toBe(false);
    });

    it('restricted → terminal', () => {
        expect(isErrorRecoverable('Your account has been restricted')).toBe(false);
    });

    it('errore sconosciuto → recoverable (default)', () => {
        expect(isErrorRecoverable('Something completely unexpected happened')).toBe(true);
    });

    it('stringa vuota → recoverable', () => {
        expect(isErrorRecoverable('')).toBe(true);
    });
});
