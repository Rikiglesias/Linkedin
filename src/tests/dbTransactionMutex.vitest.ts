import { describe, test, expect } from 'vitest';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { createSqliteManager } from '../db';

// D1: il mutex Promise-chain di SQLiteManager.withTransaction deve SERIALIZZARE le transazioni
// top-level concorrenti sulla connessione SQLite singola. Senza mutex, due BEGIN sovrapposti
// danno "cannot start a transaction within a transaction" o interlacciano COMMIT/ROLLBACK.
// File dedicato (NO vi.mock di '../db') per esercitare il codice reale.

async function openMemory() {
    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT NOT NULL);`);
    return db;
}

describe('SQLiteManager — D1 mutex transazioni concorrenti', () => {
    test('due withTransaction concorrenti si serializzano (nessun errore, entrambe committate)', async () => {
        const raw = await openMemory();
        const mgr = createSqliteManager(raw);

        const results = await Promise.all([
            mgr.withTransaction(async (tx) => {
                await tx.run(`INSERT INTO t (v) VALUES (?)`, ['a']);
                return 'A';
            }),
            mgr.withTransaction(async (tx) => {
                await tx.run(`INSERT INTO t (v) VALUES (?)`, ['b']);
                return 'B';
            }),
        ]);

        expect(results.sort()).toEqual(['A', 'B']);
        const rows = await raw.all<{ v: string }[]>(`SELECT v FROM t ORDER BY id`);
        expect(rows.map((r) => r.v).sort()).toEqual(['a', 'b']);
        await raw.close();
    });

    test('rollback di una transazione non blocca la coda: la successiva committa comunque', async () => {
        const raw = await openMemory();
        const mgr = createSqliteManager(raw);

        const settled = await Promise.allSettled([
            mgr.withTransaction(async (tx) => {
                await tx.run(`INSERT INTO t (v) VALUES (?)`, ['x']);
                throw new Error('boom'); // → ROLLBACK
            }),
            mgr.withTransaction(async (tx) => {
                await tx.run(`INSERT INTO t (v) VALUES (?)`, ['y']);
                return 'ok';
            }),
        ]);

        expect(settled[0]?.status).toBe('rejected');
        expect(settled[1]?.status).toBe('fulfilled');
        // 'x' rolled back, 'y' committed → il mutex non ha propagato il fallimento alla coda.
        const rows = await raw.all<{ v: string }[]>(`SELECT v FROM t`);
        expect(rows.map((r) => r.v)).toEqual(['y']);
        await raw.close();
    });
});
