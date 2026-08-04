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

/**
 * Il mutex qui sopra serializza le transazioni DENTRO un processo. Fra processi diversi
 * (il bot, il server della dashboard, i worker aprono ognuno la propria connessione allo
 * stesso file) non c'è nessun mutex: lì contano le regole di lock di SQLite.
 *
 * Una transazione aperta con `BEGIN` è considerata di sola lettura finché non scrive: quando
 * poi prova a passare in scrittura e trova il database occupato, SQLite risponde SQLITE_BUSY
 * **subito, senza aspettare il `busy_timeout`** — perché aspettare rischierebbe un blocco
 * incrociato. Il `PRAGMA busy_timeout = 5000` che il progetto imposta (`db.ts:675`) quindi non
 * copre proprio il caso che serve. `BEGIN IMMEDIATE` prende il lock di scrittura all'inizio,
 * quando l'attesa è ancora sicura e il timeout viene rispettato.
 */
describe('SQLiteManager — il lock di scrittura si prende subito, non a metà transazione', () => {
    test('la transazione top-level apre con BEGIN IMMEDIATE', async () => {
        const raw = await openMemory();
        const eseguiti: string[] = [];
        const execOriginale = raw.exec.bind(raw);
        raw.exec = (async (sql: string) => {
            eseguiti.push(String(sql));
            return execOriginale(sql);
        }) as typeof raw.exec;

        const mgr = createSqliteManager(raw);
        await mgr.withTransaction(async (tx) => {
            await tx.run(`INSERT INTO t (v) VALUES (?)`, ['z']);
        });

        expect(eseguiti[0]).toBe('BEGIN IMMEDIATE');
        expect(eseguiti).toContain('COMMIT');
        await raw.close();
    });

    /** Doppio della connessione: risponde «occupato» per le prime `voltePeriodoOccupato` aperture. */
    function connessioneOccupataPer(voltePeriodoOccupato: number) {
        const eseguiti: string[] = [];
        let tentativiDiApertura = 0;
        const connessione = {
            exec: async (sql: string) => {
                eseguiti.push(sql);
                if (sql === 'BEGIN IMMEDIATE') {
                    tentativiDiApertura += 1;
                    if (tentativiDiApertura <= voltePeriodoOccupato) {
                        const errore = new Error('SQLITE_BUSY: database is locked') as Error & { code?: string };
                        errore.code = 'SQLITE_BUSY';
                        throw errore;
                    }
                }
            },
            run: async () => ({ lastID: 1, changes: 1 }),
            get: async () => undefined,
            all: async () => [],
            close: async () => undefined,
        };
        return { connessione, eseguiti, tentativi: () => tentativiDiApertura };
    }

    test('database occupato un istante: riprova e ce la fa', async () => {
        // La situazione reale: un altro processo stava scrivendo proprio in quel momento.
        const { connessione, eseguiti, tentativi } = connessioneOccupataPer(1);

        const mgr = createSqliteManager(connessione as never);
        const esito = await mgr.withTransaction(async () => 'fatto');

        expect(esito).toBe('fatto');
        expect(tentativi()).toBe(2);
        expect(eseguiti).toContain('COMMIT');
    });

    test('database occupato a lungo: si arrende e restituisce l errore, non aspetta all infinito', async () => {
        // Il tetto conta quanto il ritentativo: ogni tentativo può restare fermo dentro SQLite
        // fino al busy_timeout, quindi tentare all'infinito significherebbe bloccare chi chiama.
        const { connessione, eseguiti, tentativi } = connessioneOccupataPer(99);

        const mgr = createSqliteManager(connessione as never);

        await expect(mgr.withTransaction(async () => 'mai')).rejects.toThrow(/SQLITE_BUSY/);
        expect(tentativi()).toBe(2);
        // Nessuna transazione è rimasta aperta: se BEGIN non passa, non c'è niente da chiudere.
        expect(eseguiti).not.toContain('COMMIT');
        expect(eseguiti).not.toContain('ROLLBACK');
    });

    test('un errore che NON è «occupato» non viene ritentato', async () => {
        // Ritentare un errore di sintassi o di vincolo significa solo rifare lo stesso sbaglio
        // più volte, e nascondere la causa vera dietro un ritardo.
        let tentativiDiApertura = 0;
        const connessioneRotta = {
            exec: async (sql: string) => {
                if (sql === 'BEGIN IMMEDIATE') {
                    tentativiDiApertura += 1;
                    const errore = new Error('SQLITE_ERROR: no such table: t') as Error & { code?: string };
                    errore.code = 'SQLITE_ERROR';
                    throw errore;
                }
            },
            run: async () => ({ lastID: 1, changes: 1 }),
            get: async () => undefined,
            all: async () => [],
            close: async () => undefined,
        };

        const mgr = createSqliteManager(connessioneRotta as never);

        await expect(mgr.withTransaction(async () => 'mai')).rejects.toThrow(/no such table/);
        expect(tentativiDiApertura).toBe(1);
    });
});
