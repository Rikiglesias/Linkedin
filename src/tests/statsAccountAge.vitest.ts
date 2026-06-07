import { describe, test, expect, vi, beforeEach } from 'vitest';

// T2: getAccountAgeDays deve restituire un numero valido sia su SQLite (created_at = stringa)
// sia su Postgres (node-postgres ritorna gia' un Date). Prima il codice faceva `firstDate + 'Z'`
// che su un Date produce una stringa malformata -> Invalid Date -> NaN. Test mock-based.

const mocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));
vi.mock('../db', () => ({ getDatabase: mocks.getDatabase }));

import { getAccountAgeDays } from '../core/repositories/stats';

function dbReturning(firstDate: unknown) {
    return { get: vi.fn().mockResolvedValue({ firstDate }) };
}

describe('getAccountAgeDays — coerenza SQLite/Postgres (T2)', () => {
    beforeEach(() => vi.clearAllMocks());

    test('Postgres: firstDate come oggetto Date NON produce NaN', async () => {
        const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
        mocks.getDatabase.mockResolvedValue(dbReturning(tenDaysAgo));
        const age = await getAccountAgeDays();
        expect(Number.isNaN(age)).toBe(false);
        expect(age).toBeGreaterThanOrEqual(9);
        expect(age).toBeLessThanOrEqual(11);
    });

    test('SQLite: firstDate come stringa "YYYY-MM-DD HH:MM:SS" (UTC implicito)', async () => {
        const d = new Date(Date.now() - 30 * 86_400_000);
        const sqliteStr = d.toISOString().replace('T', ' ').slice(0, 19);
        mocks.getDatabase.mockResolvedValue(dbReturning(sqliteStr));
        const age = await getAccountAgeDays();
        expect(Number.isNaN(age)).toBe(false);
        expect(age).toBeGreaterThanOrEqual(29);
        expect(age).toBeLessThanOrEqual(31);
    });

    test('stringa ISO con suffisso Z → niente doppio Z, niente NaN', async () => {
        const d = new Date(Date.now() - 5 * 86_400_000);
        mocks.getDatabase.mockResolvedValue(dbReturning(d.toISOString()));
        const age = await getAccountAgeDays();
        expect(Number.isNaN(age)).toBe(false);
        expect(age).toBeGreaterThanOrEqual(4);
        expect(age).toBeLessThanOrEqual(6);
    });

    test('nessun lead (firstDate assente) → 0', async () => {
        mocks.getDatabase.mockResolvedValue({ get: vi.fn().mockResolvedValue(undefined) });
        expect(await getAccountAgeDays()).toBe(0);
    });
});
