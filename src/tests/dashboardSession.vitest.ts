import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CL15: copertura della validazione sessione dashboard (prima NON testata, ora single-source
 * usata da auth HTTP + WS). Verifica FAIL-CLOSED su ogni ramo + lo sliding-window refresh.
 */

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    run: vi.fn(),
}));

vi.mock('../db', () => ({
    getDatabase: vi.fn(async () => ({ get: mocks.get, run: mocks.run })),
}));

import { extractDashboardSessionCookie, validateDashboardSessionToken } from '../api/dashboardSession';

const future = (): string => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const past = (): string => new Date(Date.now() - 60 * 60 * 1000).toISOString();

describe('extractDashboardSessionCookie', () => {
    it('header assente → null', () => {
        expect(extractDashboardSessionCookie(undefined)).toBeNull();
        expect(extractDashboardSessionCookie('')).toBeNull();
    });
    it('estrae il valore del cookie dashboard_session tra gli altri', () => {
        expect(extractDashboardSessionCookie('foo=1; dashboard_session=abc123; bar=2')).toBe('abc123');
    });
    it('url-decodifica il valore', () => {
        expect(extractDashboardSessionCookie('dashboard_session=a%20b')).toBe('a b');
    });
    it('cookie dashboard_session assente → null', () => {
        expect(extractDashboardSessionCookie('other=x; another=y')).toBeNull();
    });
});

describe('validateDashboardSessionToken (FAIL-CLOSED)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('token assente/vuoto → false senza toccare il DB', async () => {
        expect(await validateDashboardSessionToken(null)).toBe(false);
        expect(await validateDashboardSessionToken('')).toBe(false);
        expect(await validateDashboardSessionToken('   ')).toBe(false);
        expect(mocks.get).not.toHaveBeenCalled();
    });

    it('sessione non trovata → false', async () => {
        mocks.get.mockResolvedValue(undefined);
        expect(await validateDashboardSessionToken('tok')).toBe(false);
    });

    it('sessione revocata → false', async () => {
        mocks.get.mockResolvedValue({ expires_at: future(), revoked_at: '2020-01-01T00:00:00.000Z' });
        expect(await validateDashboardSessionToken('tok')).toBe(false);
    });

    it('sessione scaduta → false', async () => {
        mocks.get.mockResolvedValue({ expires_at: past(), revoked_at: null });
        expect(await validateDashboardSessionToken('tok')).toBe(false);
    });

    it('expires_at non parsabile → false', async () => {
        mocks.get.mockResolvedValue({ expires_at: 'not-a-date', revoked_at: null });
        expect(await validateDashboardSessionToken('tok')).toBe(false);
    });

    it('sessione valida → true; refresh:true esegue UPDATE (sliding-window)', async () => {
        mocks.get.mockResolvedValue({ expires_at: future(), revoked_at: null });
        mocks.run.mockResolvedValue({ changes: 1 });
        expect(await validateDashboardSessionToken('tok', { refresh: true })).toBe(true);
        expect(mocks.run).toHaveBeenCalledTimes(1);
    });

    it('sessione valida, refresh:false (path WS) → true, nessun UPDATE', async () => {
        mocks.get.mockResolvedValue({ expires_at: future(), revoked_at: null });
        expect(await validateDashboardSessionToken('tok')).toBe(true);
        expect(mocks.run).not.toHaveBeenCalled();
    });

    it('errore DB → false (fail-closed, mai autorizza in caso di dubbio)', async () => {
        mocks.get.mockRejectedValue(new Error('db down'));
        expect(await validateDashboardSessionToken('tok', { refresh: true })).toBe(false);
    });
});
