/**
 * testIsolation.vitest.ts — C28/C45: la suite resta isolata ANCHE con un ambiente ostile.
 *
 * Perché un processo figlio: `process.env.DATABASE_URL === undefined` dentro la suite normale è
 * una tautologia dell'ambiente (la macchina non lo imposta). La prova vera è lanciare vitest con
 * `DATABASE_URL=postgres://fittizio` e `SUPABASE_URL=https://fittizio` e pretendere che il worker
 * (`testIsolationWorker.vitest.ts`) non li veda e non tocchi Postgres.
 *
 * Rosso-prima: `vitestSetup.ts` imposta solo `DB_PATH`, quindi con `DATABASE_URL` postgres
 * `db.ts` sceglie Postgres (`initializeDatabaseInstance`) → il worker costruisce un `Pool` → fail.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { describe, expect, it } from 'vitest';

const WORKER = 'src/tests/testIsolationWorker.vitest.ts';

describe('isolamento della suite in processo figlio', () => {
    it(
        'con DATABASE_URL/SUPABASE_URL fittizi nell ambiente il worker resta su SQLite in tmpdir (0 Pool Postgres)',
        () => {
            const env = {
                ...process.env,
                DATABASE_URL: 'postgres://fittizio:fittizio@127.0.0.1:1/fittizio',
                SUPABASE_URL: 'https://fittizio.invalid',
            };
            const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
            const run = spawnSync(cmd, ['vitest', 'run', WORKER, '--reporter=dot'], {
                cwd: process.cwd(),
                env,
                encoding: 'utf8',
                shell: process.platform === 'win32',
                timeout: 120_000,
            });
            const output = `${run.stdout}\n${run.stderr}`;
            expect(run.status, `exit del figlio ≠ 0 (${path.basename(WORKER)}):\n${output.slice(-1500)}`).toBe(0);
        },
        150_000,
    );
});
