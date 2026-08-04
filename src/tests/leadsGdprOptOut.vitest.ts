/**
 * GDPR Art.21 — chi si è opposto non deve essere CONTATTATO.
 *
 * Il gate esisteva solo sull'arricchimento (`leadEnricher`, `enrichmentWorker`, CLI: "H17 fix"),
 * cioè sulla raccolta dei dati. Le query con cui lo scheduler sceglie chi invitare e a chi
 * scrivere non lo avevano: un lead con `gdpr_opt_out = 1` non veniva arricchito, ma veniva
 * comunque contattato — che è esattamente ciò a cui l'opposizione si riferisce.
 *
 * SQLite in-memory con schema minimo, come `leadsCoreTransaction.vitest.ts`: il DB reale non
 * viene toccato e le query girano davvero.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { open, Database as SQLiteDatabase } from 'sqlite';
import type { DatabaseManager, DBRunResult } from '../db';

const mocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));
vi.mock('../db', () => ({ getDatabase: mocks.getDatabase }));

import { getLeadsByStatusForList, getLeadsForFollowUp } from '../core/repositories/leadsCore';

let db: SQLiteDatabase;

/** Schema minimo: le colonne lette da LEAD_SELECT_COLUMNS più quelle usate dai filtri. */
async function createSchema(database: SQLiteDatabase): Promise<void> {
    await database.exec(`
        CREATE TABLE leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_name TEXT NOT NULL DEFAULT '',
            first_name TEXT NOT NULL DEFAULT '',
            last_name TEXT NOT NULL DEFAULT '',
            job_title TEXT NOT NULL DEFAULT '',
            website TEXT NOT NULL DEFAULT '',
            linkedin_url TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'NEW',
            list_name TEXT NOT NULL DEFAULT 'default',
            invited_at DATETIME,
            accepted_at DATETIME,
            messaged_at DATETIME,
            follow_up_count INTEGER NOT NULL DEFAULT 0,
            follow_up_sent_at DATETIME,
            last_site_check_at DATETIME,
            last_error TEXT,
            blocked_reason TEXT,
            about TEXT,
            experience TEXT,
            invite_prompt_variant TEXT,
            lead_score INTEGER,
            confidence_score INTEGER,
            email TEXT,
            phone TEXT,
            location TEXT,
            salesnav_url TEXT,
            company_domain TEXT,
            business_email TEXT,
            business_email_confidence REAL,
            gdpr_opt_out INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE campaigns (id INTEGER PRIMARY KEY AUTOINCREMENT, active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE lead_campaign_state (
            lead_id INTEGER NOT NULL,
            campaign_id INTEGER NOT NULL,
            status TEXT NOT NULL
        );
        CREATE TABLE lead_intents (
            lead_id INTEGER NOT NULL,
            analyzed_at DATETIME
        );
    `);
}

function makeManager(database: SQLiteDatabase): DatabaseManager {
    return {
        isPostgres: false,
        async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
            return database.all<T[]>(sql, params);
        },
        async get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined> {
            return database.get<T>(sql, params);
        },
        async exec(sql: string): Promise<void> {
            await database.exec(sql);
        },
        async run(sql: string, params?: unknown[]): Promise<DBRunResult> {
            const res = await database.run(sql, params);
            return { lastID: res.lastID, changes: res.changes };
        },
        async withTransaction<T>(cb: (tx: DatabaseManager) => Promise<T>): Promise<T> {
            return cb(makeManager(database));
        },
        async close(): Promise<void> {
            await database.close();
        },
    } as DatabaseManager;
}

async function insertLead(fields: {
    url: string;
    status: string;
    optOut?: number | null;
    messagedDaysAgo?: number;
}): Promise<void> {
    const messagedAt =
        fields.messagedDaysAgo === undefined ? null : `datetime('now','-${fields.messagedDaysAgo} days')`;
    await db.run(
        `INSERT INTO leads (linkedin_url, status, list_name, gdpr_opt_out, messaged_at)
         VALUES (?, ?, 'default', ?, ${messagedAt ?? 'NULL'})`,
        [fields.url, fields.status, fields.optOut ?? null],
    );
}

beforeEach(async () => {
    db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await createSchema(db);
    mocks.getDatabase.mockResolvedValue(makeManager(db));
});

afterEach(async () => {
    vi.clearAllMocks();
    await db.close();
});

describe('selezione per invito — chi si è opposto resta fuori', () => {
    it('non restituisce un lead con gdpr_opt_out = 1', async () => {
        await insertLead({ url: 'https://www.linkedin.com/in/ok', status: 'READY_INVITE', optOut: 0 });
        await insertLead({ url: 'https://www.linkedin.com/in/opposto', status: 'READY_INVITE', optOut: 1 });

        const leads = await getLeadsByStatusForList('READY_INVITE', 'default', 10);

        expect(leads.map((l) => l.linkedin_url)).toEqual(['https://www.linkedin.com/in/ok']);
    });

    it('continua a restituire chi non si è opposto, sia con 0 sia con valore assente', async () => {
        await insertLead({ url: 'https://www.linkedin.com/in/zero', status: 'READY_INVITE', optOut: 0 });
        await insertLead({ url: 'https://www.linkedin.com/in/nullo', status: 'READY_INVITE', optOut: null });

        const leads = await getLeadsByStatusForList('READY_INVITE', 'default', 10);

        expect(leads).toHaveLength(2);
    });

    it('vale anche per gli altri stati che portano a un contatto', async () => {
        await insertLead({ url: 'https://www.linkedin.com/in/acc-ok', status: 'ACCEPTED', optOut: 0 });
        await insertLead({ url: 'https://www.linkedin.com/in/acc-no', status: 'ACCEPTED', optOut: 1 });

        const leads = await getLeadsByStatusForList('ACCEPTED', 'default', 10);

        expect(leads.map((l) => l.linkedin_url)).toEqual(['https://www.linkedin.com/in/acc-ok']);
    });
});

describe('selezione per follow-up — chi si è opposto resta fuori', () => {
    it('non restituisce un lead con gdpr_opt_out = 1', async () => {
        await insertLead({
            url: 'https://www.linkedin.com/in/fu-ok',
            status: 'MESSAGED',
            optOut: 0,
            messagedDaysAgo: 10,
        });
        await insertLead({
            url: 'https://www.linkedin.com/in/fu-no',
            status: 'MESSAGED',
            optOut: 1,
            messagedDaysAgo: 10,
        });

        const leads = await getLeadsForFollowUp(3, 2, 10);

        expect(leads.map((l) => l.linkedin_url)).toEqual(['https://www.linkedin.com/in/fu-ok']);
    });
});
