import { beforeEach, describe, expect, test, vi } from 'vitest';

// Blinda la fix critica GDPR: erasure/anonymize/delete devono ripulire la PII anche nelle
// tabelle collegate (lead_enrichment_data: phones/socials/company; prebuilt_messages: testo
// personalizzato), perche' il cascade FK e' inattivo (PRAGMA foreign_keys off). Pattern mock-based
// come gli altri test del DB del repo (no DB reale -> deterministico, scripts-audit #4).

const mocks = vi.hoisted(() => ({
    getDatabase: vi.fn(),
    logInfo: vi.fn(),
    logWarn: vi.fn(),
}));

vi.mock('../db', () => ({
    getDatabase: mocks.getDatabase,
}));

vi.mock('../telemetry/logger', () => ({
    logInfo: mocks.logInfo,
    logWarn: mocks.logWarn,
}));

import { runRightToErasure, runGdprRetentionCleanup } from '../scripts/gdprRetentionCleanup';

function makeDb() {
    return {
        run: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue(undefined),
    };
}

function findRun(db: ReturnType<typeof makeDb>, substr: string): unknown[] | undefined {
    return db.run.mock.calls.find((c) => String(c[0]).includes(substr));
}

function oldLead(id: number, daysAgo: number) {
    const iso = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    return {
        id,
        linkedin_url: `https://www.linkedin.com/in/lead-${id}/`,
        first_name: 'Mario',
        last_name: 'Rossi',
        account_name: 'ACME',
        email: 'mario@acme.com',
        phone: '+391234567',
        about: null,
        status: 'PENDING',
        last_activity_at: null,
        anonymized_at: null,
        created_at: iso,
        invited_at: null,
        accepted_at: null,
        messaged_at: null,
        follow_up_sent_at: null,
        updated_at: iso,
    };
}

describe('GDPR erasure — pulizia PII nelle tabelle collegate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.logInfo.mockResolvedValue(undefined);
        mocks.logWarn.mockResolvedValue(undefined);
    });

    test('runRightToErasure azzera lead_enrichment_data e cancella prebuilt_messages per gli id risolti', async () => {
        const db = makeDb();
        db.query.mockResolvedValue([{ id: 42 }]); // SELECT id FROM leads WHERE linkedin_url = ?
        mocks.getDatabase.mockResolvedValue(db);

        await runRightToErasure('https://www.linkedin.com/in/x/', false);

        const enr = findRun(db, 'UPDATE lead_enrichment_data');
        expect(enr, 'deve azzerare la PII in lead_enrichment_data').toBeTruthy();
        expect(enr?.[1]).toEqual([42]);
        expect(String(enr?.[0])).toMatch(/phones_json\s*=\s*NULL/);
        expect(String(enr?.[0])).toMatch(/socials_json\s*=\s*NULL/);
        expect(String(enr?.[0])).toMatch(/company_json\s*=\s*NULL/);

        const pre = findRun(db, 'DELETE FROM prebuilt_messages');
        expect(pre, 'deve cancellare prebuilt_messages (testo PII)').toBeTruthy();
        expect(pre?.[1]).toEqual([42]);
    });

    test('runRightToErasure in dryRun non scrive nulla', async () => {
        const db = makeDb();
        db.query.mockResolvedValue([{ id: 7 }]);
        mocks.getDatabase.mockResolvedValue(db);

        await runRightToErasure('https://www.linkedin.com/in/y/', true);

        expect(db.run).not.toHaveBeenCalled();
    });

    test('delete (>=365gg) rimuove anche lead_enrichment_data e prebuilt_messages (no orfani)', async () => {
        const db = makeDb();
        db.query.mockResolvedValue([oldLead(99, 400)]);
        mocks.getDatabase.mockResolvedValue(db);

        await runGdprRetentionCleanup({ deleteOnly: true });

        for (const table of [
            'lead_enrichment_data',
            'prebuilt_messages',
            'salesnav_list_items',
            'ml_feature_store',
            'challenge_events',
            'lead_campaign_state',
        ]) {
            const call = findRun(db, `DELETE FROM ${table}`);
            expect(call, `delete deve rimuovere ${table}`).toBeTruthy();
            expect(call?.[1]).toEqual([99]);
        }
        // il lead padre viene cancellato per ultimo
        const leadDel = findRun(db, 'DELETE FROM leads WHERE id');
        expect(leadDel?.[1]).toEqual([99]);
    });

    test('anonymize (>=180gg, <365gg) azzera lead_enrichment_data e cancella prebuilt_messages', async () => {
        const db = makeDb();
        db.query.mockResolvedValue([oldLead(55, 200)]);
        mocks.getDatabase.mockResolvedValue(db);

        await runGdprRetentionCleanup({ anonymizeOnly: true });

        const enr = findRun(db, 'UPDATE lead_enrichment_data');
        expect(enr, 'anonymize deve azzerare lead_enrichment_data').toBeTruthy();
        expect(enr?.[1]).toEqual([55]);
        const pre = findRun(db, 'DELETE FROM prebuilt_messages');
        expect(pre?.[1]).toEqual([55]);
        // il lead NON viene cancellato in modalita' anonymize
        expect(findRun(db, 'DELETE FROM leads WHERE id')).toBeUndefined();
    });
});
