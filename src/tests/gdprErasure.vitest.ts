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
        // pushOutboxEvent (emissione cloud.lead.erase, goal gdpr-erasure-cloud) rilegge l'evento
        // appena inserito via db.get: deve trovare un id, altrimenti throw "Outbox event non trovato".
        get: vi.fn().mockResolvedValue({ id: 1 }),
        // shared.withTransaction(db, cb) -> db.withTransaction(() => cb()): esegue la callback.
        withTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
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

        // GDPR Art.17: l'UPDATE leads deve anonimizzare ANCHE account_name (nome azienda = PII).
        // Drift fixato 2026-06-12: runRightToErasure lo ometteva mentre anonymizeLead lo includeva.
        const ano = findRun(db, 'UPDATE leads SET');
        expect(ano, 'deve anonimizzare il lead').toBeTruthy();
        expect(String(ano?.[0]), 'account_name deve essere anonimizzato (no PII residua)').toMatch(
            /account_name\s*=\s*'\[ANONIMIZZATO\]'/,
        );

        const enr = findRun(db, 'UPDATE lead_enrichment_data');
        expect(enr, 'deve azzerare la PII in lead_enrichment_data').toBeTruthy();
        expect(enr?.[1]).toEqual([42]);
        expect(String(enr?.[0])).toMatch(/phones_json\s*=\s*NULL/);
        expect(String(enr?.[0])).toMatch(/socials_json\s*=\s*NULL/);
        expect(String(enr?.[0])).toMatch(/company_json\s*=\s*NULL/);

        const pre = findRun(db, 'DELETE FROM prebuilt_messages');
        expect(pre, 'deve cancellare prebuilt_messages (testo PII)').toBeTruthy();
        expect(pre?.[1]).toEqual([42]);

        // Perimetro erasure esteso (goal gdpr-erasure-cloud): salesnav_list_members ha PII del
        // membro (profile_name/company/message_text) e match su linkedin_url originale, non lead_id.
        const sln = findRun(db, 'DELETE FROM salesnav_list_members');
        expect(sln, 'deve cancellare i membri salesnav per quel linkedin_url (PII residua Art.17)').toBeTruthy();
        expect(sln?.[1]).toEqual(['https://www.linkedin.com/in/x/']);

        // P0c (backend-audit): l'erasure Art.17 deve azzerare anche il TESTO dei messaggi
        // (message_history.message_text + lead_intents.raw_message), tenendo content_hash.
        const mh = findRun(db, 'UPDATE message_history SET message_text = NULL');
        expect(mh, 'deve azzerare message_history.message_text (testo PII)').toBeTruthy();
        expect(mh?.[1]).toEqual([42]);
        const li = findRun(db, 'UPDATE lead_intents SET raw_message = NULL');
        expect(li, 'deve azzerare lead_intents.raw_message (snippet PII)').toBeTruthy();
        expect(li?.[1]).toEqual([42]);
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
        // P0c: anche anonymize (180gg) azzera il testo dei messaggi (message_history + lead_intents).
        expect(findRun(db, 'UPDATE message_history SET message_text = NULL')?.[1]).toEqual([55]);
        expect(findRun(db, 'UPDATE lead_intents SET raw_message = NULL')?.[1]).toEqual([55]);
        // il lead NON viene cancellato in modalita' anonymize
        expect(findRun(db, 'DELETE FROM leads WHERE id')).toBeUndefined();
    });

    test('Ondata-1: delete gira dentro una transazione (atomicita)', async () => {
        const db = makeDb();
        db.query.mockResolvedValue([oldLead(11, 400)]);
        mocks.getDatabase.mockResolvedValue(db);
        await runGdprRetentionCleanup({ deleteOnly: true });
        expect(db.withTransaction).toHaveBeenCalled();
    });

    test('Ondata-1: runRightToErasure gira dentro una transazione', async () => {
        const db = makeDb();
        db.query.mockResolvedValue([{ id: 5 }]);
        mocks.getDatabase.mockResolvedValue(db);
        await runRightToErasure('https://www.linkedin.com/in/z/', false);
        // 2 chiamate: la transazione esterna + il SAVEPOINT annidato di pushOutboxEvent
        // (emissione cloud.lead.erase in-transaction — goal gdpr-erasure-cloud).
        expect(db.withTransaction).toHaveBeenCalledTimes(2);
    });
});

describe('GDPR erasure — propagazione cloud via outbox (goal gdpr-erasure-cloud)', () => {
    const URL = 'https://www.linkedin.com/in/cloud-x/';

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.logInfo.mockResolvedValue(undefined);
        mocks.logWarn.mockResolvedValue(undefined);
    });

    test('runRightToErasure emette cloud.lead.erase: URL originale nel payload, key hash-based senza URL raw', async () => {
        const db = makeDb();
        db.query.mockResolvedValue([{ id: 42 }]);
        mocks.getDatabase.mockResolvedValue(db);

        await runRightToErasure(URL, false);

        const emit = findRun(db, 'INSERT OR IGNORE INTO outbox_events');
        expect(emit, 'deve emettere un evento outbox per la copia cloud').toBeTruthy();
        const [topic, payloadJson, idemKey] = emit?.[1] as [string, string, string];
        expect(topic).toBe('cloud.lead.erase');
        const payload = JSON.parse(payloadJson) as { linkedinUrl: string; urlHash: string };
        expect(payload.linkedinUrl, 'serve l URL ORIGINALE per la query cloud (chiave linkedin_url)').toBe(URL);
        expect(payload.urlHash).toMatch(/^[0-9a-f]{64}$/);
        // La key finisce in cp_events in chiaro: hash-based, MAI l'URL raw.
        expect(idemKey).toMatch(/^cloud\.lead\.erase:[0-9a-f]{64}:\d+$/);
        expect(idemKey).not.toContain(URL);
    });

    test('anonymize (retention) emette cloud.lead.erase con l URL originale pre-rewrite', async () => {
        const db = makeDb();
        db.query.mockResolvedValue([oldLead(55, 200)]);
        mocks.getDatabase.mockResolvedValue(db);

        await runGdprRetentionCleanup({ anonymizeOnly: true });

        const emit = findRun(db, 'INSERT OR IGNORE INTO outbox_events');
        expect(emit, 'anonymize deve propagare l erasure al cloud').toBeTruthy();
        const payload = JSON.parse(String((emit?.[1] as unknown[])[1])) as { linkedinUrl: string };
        expect(payload.linkedinUrl).toBe('https://www.linkedin.com/in/lead-55/');
    });

    test('rollback: se l UPDATE leads fallisce, NESSUN evento outbox viene emesso', async () => {
        const db = makeDb();
        db.query.mockResolvedValue([{ id: 9 }]);
        db.run.mockImplementation(async (sql: string) => {
            if (String(sql).includes('UPDATE leads SET')) throw new Error('disk I/O error');
            return undefined;
        });
        mocks.getDatabase.mockResolvedValue(db);

        await expect(runRightToErasure(URL, false)).rejects.toThrow('disk I/O error');
        expect(
            findRun(db, 'INSERT OR IGNORE INTO outbox_events'),
            'emissione DOPO la mutazione locale, nella stessa transazione: fallimento ⇒ niente evento',
        ).toBeUndefined();
    });

    test('delete di lead GIA anonimizzato (identifier anon:) NON ri-emette verso il cloud', async () => {
        const db = makeDb();
        const lead = { ...oldLead(77, 800), linkedin_url: 'anon:abcdef123456', anonymized_at: '2026-01-01' };
        db.query.mockResolvedValue([lead]);
        mocks.getDatabase.mockResolvedValue(db);

        await runGdprRetentionCleanup({ deleteOnly: true });

        expect(findRun(db, 'INSERT OR IGNORE INTO outbox_events')).toBeUndefined();
    });

    test('anonymize azzera anche invite_note_sent e last_reply_snippet (PII residua, fix stessa-classe)', async () => {
        const db = makeDb();
        db.query.mockResolvedValue([oldLead(56, 200)]);
        mocks.getDatabase.mockResolvedValue(db);

        await runGdprRetentionCleanup({ anonymizeOnly: true });

        const ano = findRun(db, 'UPDATE leads SET');
        expect(String(ano?.[0])).toMatch(/invite_note_sent\s*=\s*NULL/);
        expect(String(ano?.[0])).toMatch(/last_reply_snippet\s*=\s*NULL/);
    });
});
