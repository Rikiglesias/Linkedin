import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { open, Database as SQLiteDatabase } from 'sqlite';
import type { DatabaseManager, DBRunResult } from '../db';

// ── sezione T3 (mock-based, pre-esistente) ───────────────────────────────────
// T3: le scritture multiple di applyControlPlaneCampaignConfigs / upsertSalesNavigatorLead devono
// essere atomiche (withTransaction). Verifichiamo che (a) le scritture avvengano DENTRO una
// transazione e (b) un errore a meta' propaghi (cosi' il rollback reale di withTransaction scatta).
// Mock-based: il rollback SQL vero e' coperto da PostgresManager.withTransaction (db.ts).

const mocks = vi.hoisted(() => ({ getDatabase: vi.fn() }));
vi.mock('../db', () => ({ getDatabase: mocks.getDatabase }));

import { applyControlPlaneCampaignConfigs, upsertSalesNavigatorLead } from '../core/repositories/leadsCore';

function makeDb(overrides: Record<string, unknown> = {}) {
    return {
        // shared.withTransaction(db, cb) chiama db.withTransaction(() => cb())
        withTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
        get: vi.fn().mockResolvedValue(undefined),
        run: vi.fn().mockResolvedValue({ changes: 1, lastID: 1 }),
        ...overrides,
    };
}

const cfg = [{ name: 'Lista A', isActive: true, priority: 1, dailyInviteCap: null, dailyMessageCap: null }];

describe('leadsCore atomicità transazionale (T3)', () => {
    beforeEach(() => vi.clearAllMocks());

    test('applyControlPlaneCampaignConfigs esegue le scritture dentro withTransaction', async () => {
        const db = makeDb();
        mocks.getDatabase.mockResolvedValue(db);

        const result = await applyControlPlaneCampaignConfigs(cfg);

        expect(db.withTransaction).toHaveBeenCalledTimes(1);
        expect(db.run).toHaveBeenCalled(); // INSERT del nuovo lead_list
        expect(result.created).toBe(1);
    });

    test('errore a meta transazione propaga (rollback reale scatterebbe), non swallowed', async () => {
        const db = makeDb({ run: vi.fn().mockRejectedValue(new Error('boom')) });
        mocks.getDatabase.mockResolvedValue(db);

        await expect(applyControlPlaneCampaignConfigs(cfg)).rejects.toThrow('boom');
        // la scrittura fallita era comunque avvenuta dentro la transazione
        expect(db.withTransaction).toHaveBeenCalledTimes(1);
    });
});

// ── sezione H24 (in-memory SQLite reale) ─────────────────────────────────────
// H24-1: errore iniettato a metà transazione → rollback completo (nessun lead/list_lead parziale)
// H24-2: idempotenza — due chiamate con lo stesso input → conteggi righe invariati alla seconda

/**
 * Crea uno schema minimo in-memory per soddisfare upsertSalesNavigatorLead:
 *   leads, lead_lists, list_leads
 * Aggiunge SOLO le colonne realmente usate dalla funzione (evita import di tutte le migration).
 */
async function openMemoryDb(): Promise<SQLiteDatabase> {
    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec(`PRAGMA foreign_keys = ON;`);
    await db.exec(`
        CREATE TABLE IF NOT EXISTS lead_lists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            source TEXT NOT NULL DEFAULT 'import',
            is_active INTEGER NOT NULL DEFAULT 1,
            priority INTEGER NOT NULL DEFAULT 100,
            daily_invite_cap INTEGER,
            daily_message_cap INTEGER,
            scoring_criteria TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_name TEXT NOT NULL DEFAULT '',
            first_name TEXT NOT NULL DEFAULT '',
            last_name TEXT NOT NULL DEFAULT '',
            job_title TEXT NOT NULL DEFAULT '',
            website TEXT NOT NULL DEFAULT '',
            linkedin_url TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'NEW',
            list_name TEXT NOT NULL DEFAULT 'default',
            about TEXT,
            experience TEXT,
            invite_prompt_variant TEXT,
            lead_score INTEGER,
            confidence_score INTEGER,
            location TEXT,
            salesnav_url TEXT,
            email TEXT,
            phone TEXT,
            company_domain TEXT,
            business_email TEXT,
            business_email_confidence REAL,
            invited_at DATETIME,
            accepted_at DATETIME,
            messaged_at DATETIME,
            follow_up_count INTEGER NOT NULL DEFAULT 0,
            follow_up_sent_at DATETIME,
            last_site_check_at DATETIME,
            last_error TEXT,
            blocked_reason TEXT,
            version INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS list_leads (
            list_id INTEGER NOT NULL,
            lead_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (list_id, lead_id),
            FOREIGN KEY (list_id) REFERENCES lead_lists(id),
            FOREIGN KEY (lead_id) REFERENCES leads(id)
        );
    `);
    return db;
}

/**
 * DatabaseManager minimo su SQLite in-memory.
 * withTransaction: usa BEGIN/COMMIT/ROLLBACK reali su questa singola connessione.
 * getDatabase è mockato per restituire SEMPRE questa stessa istanza — corretto perché
 * SQLite è single-connection e il lock di transazione è sulla connessione stessa.
 */
function makeRealSqliteManager(db: SQLiteDatabase): DatabaseManager {
    let inTx = false;

    const mgr: DatabaseManager = {
        isPostgres: false,
        async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
            return db.all<T[]>(sql, params);
        },
        async get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined> {
            return db.get<T>(sql, params);
        },
        async exec(sql: string): Promise<void> {
            await db.exec(sql);
        },
        async run(sql: string, params?: unknown[]): Promise<DBRunResult> {
            const res = await db.run(sql, params);
            return { lastID: res.lastID, changes: res.changes };
        },
        async withTransaction<T>(callback: (tx: DatabaseManager) => Promise<T>): Promise<T> {
            if (inTx) {
                // nested: usa SAVEPOINT
                const sp = `sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                await db.exec(`SAVEPOINT ${sp}`);
                try {
                    const result = await callback(mgr);
                    await db.exec(`RELEASE SAVEPOINT ${sp}`);
                    return result;
                } catch (err) {
                    await db.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
                    throw err;
                }
            }
            inTx = true;
            await db.exec('BEGIN');
            try {
                const result = await callback(mgr);
                await db.exec('COMMIT');
                inTx = false;
                return result;
            } catch (err) {
                inTx = false;
                await db.exec('ROLLBACK');
                throw err;
            }
        },
        async close(): Promise<void> {
            await db.close();
        },
    };
    return mgr;
}

async function countRows(db: SQLiteDatabase, table: string): Promise<number> {
    const row = await db.get<{ n: number }>(`SELECT COUNT(*) as n FROM ${table}`);
    return row?.n ?? 0;
}

const BASE_INPUT = {
    linkedinUrl: 'https://www.linkedin.com/in/h24-test-user',
    listName: 'h24-list',
    accountName: 'H24 Corp',
    firstName: 'H24',
    lastName: 'Test',
    jobTitle: 'Engineer',
    website: 'https://h24.example.com',
    location: 'Milano',
    salesnavUrl: null,
    leadScore: null,
    confidenceScore: null,
};

describe('upsertSalesNavigatorLead — transazione reale SQLite in-memory (H24)', () => {
    let rawDb: SQLiteDatabase;
    let mgr: DatabaseManager;

    beforeEach(async () => {
        vi.clearAllMocks();
        rawDb = await openMemoryDb();
        mgr = makeRealSqliteManager(rawDb);
        // getDatabase() restituisce sempre la stessa connessione (SQLite single-conn)
        mocks.getDatabase.mockResolvedValue(mgr);
    });

    afterEach(async () => {
        await rawDb.close();
    });

    test('H24-1: errore iniettato a metà transazione → rollback completo, nessun lead/list_lead parziale', async () => {
        // Piantiamo l'errore sul SECONDO run() (dopo INSERT leads, prima di INSERT list_leads)
        // Usiamo un wrapper che lancia al run n.2 della prima transazione
        let runCallCount = 0;
        const originalRun = mgr.run.bind(mgr);
        mgr.run = async (sql: string, params?: unknown[]): Promise<DBRunResult> => {
            runCallCount += 1;
            // Il 2° run è INSERT INTO list_leads (dopo INSERT leads e dopo ensureLeadList)
            // ensureLeadList → run #1 (INSERT OR IGNORE lead_lists)
            // INSERT INTO leads → run #2
            // INSERT OR IGNORE INTO list_leads → run #3
            // Iniettiamo l'errore al run #3 (list_leads insert) per verificare rollback completo
            if (runCallCount === 3) {
                throw new Error('H24-injected-error');
            }
            return originalRun(sql, params);
        };
        // Aggiorniamo il mock per restituire il mgr modificato
        mocks.getDatabase.mockResolvedValue(mgr);

        await expect(upsertSalesNavigatorLead(BASE_INPUT)).rejects.toThrow('H24-injected-error');

        // Dopo rollback: nessun lead e nessun list_lead devono essere rimasti
        const leadsCount = await countRows(rawDb, 'leads');
        const listLeadsCount = await countRows(rawDb, 'list_leads');
        expect(leadsCount).toBe(0);
        expect(listLeadsCount).toBe(0);
    });

    test('H24-2: idempotenza — due chiamate con lo stesso input → conteggi righe invariati alla seconda', async () => {
        // Prima chiamata: crea lead + list_lead
        const result1 = await upsertSalesNavigatorLead(BASE_INPUT);
        expect(result1.action).toBe('inserted');

        const leadsAfterFirst = await countRows(rawDb, 'leads');
        const listLeadsAfterFirst = await countRows(rawDb, 'list_leads');
        const leadListsAfterFirst = await countRows(rawDb, 'lead_lists');
        expect(leadsAfterFirst).toBe(1);
        expect(listLeadsAfterFirst).toBe(1);
        expect(leadListsAfterFirst).toBe(1);

        // Seconda chiamata con lo stesso input: nessuna nuova riga
        const result2 = await upsertSalesNavigatorLead(BASE_INPUT);
        // L'azione deve essere 'unchanged' (stesso URL, stessi dati)
        expect(result2.action).toBe('unchanged');

        const leadsAfterSecond = await countRows(rawDb, 'leads');
        const listLeadsAfterSecond = await countRows(rawDb, 'list_leads');
        const leadListsAfterSecond = await countRows(rawDb, 'lead_lists');
        expect(leadsAfterSecond).toBe(leadsAfterFirst);
        expect(listLeadsAfterSecond).toBe(listLeadsAfterFirst);
        expect(leadListsAfterSecond).toBe(leadListsAfterFirst);
    });
});
