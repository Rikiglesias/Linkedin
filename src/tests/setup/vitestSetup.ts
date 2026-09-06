import { inject } from 'vitest';

import { loadDotEnv } from '../../config/env';
import { TEST_DB_KEY } from './testDatabase';

/**
 * C28/C45 — la suite non deve MAI vedere un backend remoto: `DATABASE_URL` farebbe scegliere Postgres a
 * `db.ts` e `SUPABASE_URL` accenderebbe i client cloud. I file `.env`/`bot-settings.conf` si caricano QUI
 * (una volta per processo: `loadDotEnv` è idempotente) e le due chiavi si cancellano DOPO, così nessun
 * import successivo di `src/config` può rimetterle.
 */
loadDotEnv();
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;

/**
 * Dirotta la suite sulla copia del database preparata da `globalSetup`.
 *
 * Perché qui e non altrove: `src/config/index.ts` costruisce `config.dbPath` nel
 * momento in cui viene importato, quindi `DB_PATH` deve essere già presente prima
 * di quell'import — e i file di setup girano nello stesso processo dei test, prima
 * di essi. `dotenv` non sovrascrive le variabili già impostate, quindi questo
 * valore ha la precedenza su quello eventualmente presente nel `.env`.
 */
process.env.DB_PATH = inject(TEST_DB_KEY);
