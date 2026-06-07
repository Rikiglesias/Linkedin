import { describe, test, expect, vi, beforeEach } from 'vitest';

// Ondata-2 (correttezza leadsCore, non anti-ban):
// - promoteNewLeadsToReadyInvite: UPDATE con guard `AND status = 'NEW'` (no clobber race).
// - hasOtherAccountTargeted: match leadId delimitato (no collisione substring 42 vs 420).
// - appendLeadEvent: serializzazione metadata protetta (no crash su riferimenti circolari).
// I primi due sono test di regressione-forma sulla SQL (il test comportamentale full richiede un
// DB reale -> tracciato come DEFER nel triage, finding "zero test su leadsCore write-path").

const mocks = vi.hoisted(() => ({ getDatabase: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn(), logError: vi.fn() }));
vi.mock('../db', () => ({ getDatabase: mocks.getDatabase }));
vi.mock('../telemetry/logger', () => ({ logInfo: mocks.logInfo, logWarn: mocks.logWarn, logError: mocks.logError }));

import {
    promoteNewLeadsToReadyInvite,
    hasOtherAccountTargeted,
    appendLeadEvent,
    addLead,
} from '../core/repositories/leadsCore';

describe('leadsCore correttezza (Ondata-2)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.logWarn.mockResolvedValue(undefined);
        mocks.logInfo.mockResolvedValue(undefined);
    });

    test("promoteNewLeadsToReadyInvite: UPDATE ha guard AND status = 'NEW'", async () => {
        const db = {
            query: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
            run: vi.fn().mockResolvedValue({ changes: 2 }),
        };
        mocks.getDatabase.mockResolvedValue(db);

        await promoteNewLeadsToReadyInvite(10);

        const upd = db.run.mock.calls.find((c) => String(c[0]).includes('UPDATE leads SET status'));
        expect(upd, 'deve esistere la UPDATE di promozione').toBeTruthy();
        expect(String(upd?.[0])).toContain("AND status = 'NEW'");
    });

    test('hasOtherAccountTargeted: match leadId delimitato (no collisione substring)', async () => {
        const db = { get: vi.fn().mockResolvedValue({ cnt: 0 }) };
        mocks.getDatabase.mockResolvedValue(db);

        await hasOtherAccountTargeted('https://www.linkedin.com/in/mario/', 'acc-1', 30);

        const q = String(db.get.mock.calls[0][0]);
        expect(q).toContain("|| ',%'");
        expect(q).toContain("|| '}%'");
        // non deve piu' esserci il match nudo che causava la collisione 42 vs 420
        expect(q).not.toMatch(/\|\| l\.id \|\| '%'/);
    });

    test('appendLeadEvent: metadata con riferimento circolare → fallback {} senza crash', async () => {
        const db = {
            get: vi.fn().mockResolvedValue(undefined),
            query: vi.fn().mockResolvedValue([]),
            run: vi.fn().mockResolvedValue(undefined),
        };
        mocks.getDatabase.mockResolvedValue(db);

        const circular: Record<string, unknown> = { a: 1 };
        circular.self = circular;

        await expect(appendLeadEvent(1, 'NEW', 'READY_INVITE', 'test', circular)).resolves.toBeUndefined();

        const insert = db.run.mock.calls.find((c) => String(c[0]).includes('INSERT INTO lead_events'));
        expect(insert, 'deve inserire comunque l-evento').toBeTruthy();
        expect(insert?.[1]?.[4]).toBe('{}'); // metadata_json a fallback, non crash
    });

    test('addLead: INSERT lead + list_leads dentro una transazione (atomicità)', async () => {
        const db = {
            withTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
            get: vi.fn().mockResolvedValue({ id: 1 }),
            run: vi.fn().mockResolvedValue({ changes: 1 }),
        };
        mocks.getDatabase.mockResolvedValue(db);

        await addLead({
            accountName: 'ACME',
            firstName: 'Mario',
            lastName: 'Rossi',
            jobTitle: 'CTO',
            website: 'acme.com',
            linkedinUrl: 'https://www.linkedin.com/in/mario/',
            listName: 'default',
        });

        expect(db.withTransaction).toHaveBeenCalledTimes(1);
        expect(db.run.mock.calls.find((c) => String(c[0]).includes('INSERT OR IGNORE INTO leads'))).toBeTruthy();
        expect(db.run.mock.calls.find((c) => String(c[0]).includes('INSERT OR IGNORE INTO list_leads'))).toBeTruthy();
    });
});
