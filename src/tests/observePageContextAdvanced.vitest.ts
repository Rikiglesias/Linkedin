import { describe, it, expect } from 'vitest';
import { hasBlockingIssue, type PageObservation } from '../browser/observePageContext';

const base: PageObservation = {
    profileName: 'Test User',
    profileHeadline: 'CEO at TestCo',
    connectionDegree: '2nd',
    isProfileDeleted: false,
    hasModalOpen: false,
    hasChallenge: false,
    currentUrl: 'https://www.linkedin.com/in/test-user/',
    hasConnectButton: true,
    hasMessageButton: false,
    hasPendingIndicator: false,
};

describe('observePageContext — hasBlockingIssue advanced', () => {
    it('profilo con pending → non bloccante', () => {
        expect(hasBlockingIssue({ ...base, hasPendingIndicator: true }).blocked).toBe(false);
    });

    it('profilo con message button → non bloccante', () => {
        expect(hasBlockingIssue({ ...base, hasMessageButton: true }).blocked).toBe(false);
    });

    it('profilo senza connect button → non bloccante', () => {
        expect(hasBlockingIssue({ ...base, hasConnectButton: false }).blocked).toBe(false);
    });

    it('profilo con nome null → non bloccante', () => {
        expect(hasBlockingIssue({ ...base, profileName: null }).blocked).toBe(false);
    });

    it('profilo con headline null → non bloccante', () => {
        expect(hasBlockingIssue({ ...base, profileHeadline: null }).blocked).toBe(false);
    });

    it('profilo con connectionDegree null → non bloccante', () => {
        expect(hasBlockingIssue({ ...base, connectionDegree: null }).blocked).toBe(false);
    });

    it('URL /404 → bloccante (profilo eliminato)', () => {
        expect(
            hasBlockingIssue({ ...base, currentUrl: 'https://www.linkedin.com/404', isProfileDeleted: true }).blocked,
        ).toBe(true);
    });
});
