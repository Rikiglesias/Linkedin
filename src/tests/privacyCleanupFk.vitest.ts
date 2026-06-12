import { describe, test, expect, vi, beforeEach } from 'vitest';

// T4: cleanupPrivacyData deve cancellare TUTTE le tabelle figlie di leads PRIMA del padre.
// Senza, su Postgres (FK enforced) la DELETE FROM leads viola la foreign key e la transazione
// va in rollback -> il purge GDPR non avviene mai. Set figli allineato a deleteLead().

const mocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));
vi.mock('../db', () => ({ getDatabase: mocks.getDatabase }));

import { cleanupPrivacyData } from '../core/repositories/system';

function makeDb() {
    return {
        withTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
        run: vi.fn().mockResolvedValue({ changes: 0 }),
        // SELECT degli URL in purge (emissione cloud.lead.erase, goal gdpr-erasure-cloud):
        // lista vuota = nessuna emissione, il perimetro FK resta l'oggetto del test.
        query: vi.fn().mockResolvedValue([]),
        // pushOutboxEvent rilegge l'evento via db.get (usato solo se query ritorna URL).
        get: vi.fn().mockResolvedValue({ id: 1 }),
    };
}

function indexOfDelete(db: ReturnType<typeof makeDb>, needle: string): number {
    return db.run.mock.calls.findIndex((c) => String(c[0]).includes(needle));
}

const CHILD_TABLES = [
    'lead_intents',
    'lead_enrichment_data',
    'prebuilt_messages',
    'salesnav_list_items',
    'ml_feature_store',
    'challenge_events',
    'lead_campaign_state',
];

describe('cleanupPrivacyData — integrita FK figli->padre (T4)', () => {
    beforeEach(() => vi.clearAllMocks());

    test('cancella ogni tabella figlia di leads, prima della DELETE FROM leads', async () => {
        const db = makeDb();
        mocks.getDatabase.mockResolvedValue(db);

        await cleanupPrivacyData(90);

        const leadsIdx = indexOfDelete(db, 'DELETE FROM leads WHERE id IN');
        expect(leadsIdx).toBeGreaterThanOrEqual(0);

        for (const table of CHILD_TABLES) {
            const childIdx = indexOfDelete(db, `DELETE FROM ${table} WHERE lead_id IN`);
            expect(childIdx, `${table} deve essere cancellata`).toBeGreaterThanOrEqual(0);
            expect(childIdx, `${table} deve precedere DELETE FROM leads`).toBeLessThan(leadsIdx);
        }
    });

    test('tutte le DELETE girano dentro una transazione (atomicita)', async () => {
        const db = makeDb();
        mocks.getDatabase.mockResolvedValue(db);
        await cleanupPrivacyData(90);
        expect(db.withTransaction).toHaveBeenCalledTimes(1);
    });
});
