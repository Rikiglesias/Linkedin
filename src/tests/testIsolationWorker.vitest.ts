/**
 * testIsolationWorker.vitest.ts — asserti di isolamento ESEGUITI DENTRO UN WORKER vitest (C28/C45).
 *
 * Da solo, nella suite normale, questo file passa (l'ambiente della macchina non ha DATABASE_URL).
 * Il suo valore si vede quando lo lancia `testIsolation.vitest.ts` in un PROCESSO FIGLIO con
 * `DATABASE_URL=postgres://fittizio` e `SUPABASE_URL=https://fittizio` nell'ambiente: la suite
 * deve restare su una copia SQLite in tmpdir e non tentare MAI una connessione Postgres.
 *
 * `pg` è mockato: ogni `new Pool()` viene contato. Zero tentativi = isolamento vero.
 */
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

const poolConstructions = vi.hoisted(() => ({ count: 0 }));

vi.mock('pg', () => ({
    Pool: class {
        constructor() {
            poolConstructions.count++;
        }
        query(): never {
            throw new Error('PG_CONNECT_ATTEMPT: la suite non deve mai aprire Postgres');
        }
        end(): Promise<void> {
            return Promise.resolve();
        }
    },
}));

const DB_REALE = path.resolve(process.cwd(), 'data', 'linkedin_bot.sqlite');

describe('isolamento della suite (worker)', () => {
    it('DATABASE_URL e SUPABASE_URL non arrivano al worker', () => {
        expect(process.env.DATABASE_URL).toBeUndefined();
        expect(process.env.SUPABASE_URL).toBeUndefined();
    });

    it('getDatabase() apre la copia SQLite in tmpdir e non costruisce alcun Pool Postgres', async () => {
        const { getDatabase } = await import('../db');
        const { config } = await import('../config');
        const db = await getDatabase();
        const row = await db.get<{ uno: number }>('SELECT 1 as uno');

        expect(Number(row?.uno)).toBe(1);
        expect(poolConstructions.count, 'pgConnectAttempts').toBe(0);
        expect(config.dbPath.startsWith(os.tmpdir()), `dbPathUsato=${config.dbPath}`).toBe(true);
        expect(path.resolve(config.dbPath)).not.toBe(DB_REALE);
    });
});
