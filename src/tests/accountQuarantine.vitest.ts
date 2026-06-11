import { beforeEach, describe, expect, test, vi } from 'vitest';

// G5-F2: semantica della quarantena per-account (setAccountQuarantine / getAccountQuarantine /
// getQuarantineStatus) con un sync_state finto in-memory: chiave per-account, flag globale
// legacy che blocca tutti (backward-compat + fail-safe), aggregato per doctor/admin/API.

const syncState = new Map<string, string>();

vi.mock('../db', () => ({
    getDatabase: async () => ({
        run: async (sql: string, params: unknown[] = []) => {
            if (sql.includes('INSERT INTO sync_state')) {
                syncState.set(String(params[0]), String(params[1]));
                return { changes: 1 };
            }
            throw new Error(`SQL non gestito dal fake: ${sql}`);
        },
        get: async (sql: string, params: unknown[] = []) => {
            if (sql.includes('SELECT value FROM sync_state')) {
                const value = syncState.get(String(params[0]));
                return value === undefined ? undefined : { value };
            }
            throw new Error(`SQL non gestito dal fake: ${sql}`);
        },
        query: async (sql: string, params: unknown[] = []) => {
            if (sql.includes('SELECT key FROM sync_state')) {
                const prefix = String(params[0]).replace(/%$/, '');
                return [...syncState.entries()]
                    .filter(([key, value]) => key.startsWith(prefix) && value === 'true')
                    .map(([key]) => ({ key }));
            }
            throw new Error(`SQL non gestito dal fake: ${sql}`);
        },
    }),
}));

import { getAccountQuarantine, getQuarantineStatus, setAccountQuarantine } from '../core/repositories/system';

describe('quarantena per-account (G5-F2)', () => {
    beforeEach(() => {
        syncState.clear();
    });

    test('quarantena su un account NON blocca gli altri', async () => {
        await setAccountQuarantine('acc-1', true);

        expect(await getAccountQuarantine('acc-1')).toBe(true);
        expect(await getAccountQuarantine('acc-2')).toBe(false);
        expect(syncState.get('account_quarantine:acc-1')).toBe('true');
        // Il flag globale legacy NON viene toccato da una quarantena attribuita.
        expect(syncState.has('account_quarantine')).toBe(false);
    });

    test('flag globale legacy blocca OGNI account (backward-compat)', async () => {
        syncState.set('account_quarantine', 'true');

        expect(await getAccountQuarantine('acc-1')).toBe(true);
        expect(await getAccountQuarantine('acc-2')).toBe(true);
        expect(await getAccountQuarantine(undefined)).toBe(true);
    });

    test("accountId assente o 'default' scrive il flag GLOBALE (fail-safe non-attribuibile)", async () => {
        await setAccountQuarantine(undefined, true);
        expect(syncState.get('account_quarantine')).toBe('true');
        expect(await getAccountQuarantine('acc-qualunque')).toBe(true);

        await setAccountQuarantine('default', false);
        expect(syncState.get('account_quarantine')).toBe('false');
        expect(await getAccountQuarantine('acc-qualunque')).toBe(false);
    });

    test('disattivazione per-account non tocca il flag globale né gli altri account', async () => {
        await setAccountQuarantine('acc-1', true);
        await setAccountQuarantine('acc-2', true);

        await setAccountQuarantine('acc-1', false);

        expect(await getAccountQuarantine('acc-1')).toBe(false);
        expect(await getAccountQuarantine('acc-2')).toBe(true);
    });

    test('getQuarantineStatus aggrega globale + per-account ed esclude i flag spenti', async () => {
        expect(await getQuarantineStatus()).toEqual({ global: false, accounts: [], any: false });

        await setAccountQuarantine('acc-1', true);
        await setAccountQuarantine('acc-2', true);
        await setAccountQuarantine('acc-2', false);

        const status = await getQuarantineStatus();
        expect(status.global).toBe(false);
        expect(status.accounts).toEqual(['acc-1']);
        expect(status.any).toBe(true);

        syncState.set('account_quarantine', 'true');
        const withGlobal = await getQuarantineStatus();
        expect(withGlobal.global).toBe(true);
        expect(withGlobal.any).toBe(true);
    });
});
