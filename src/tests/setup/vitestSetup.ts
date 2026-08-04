import { TEST_DB_PATH } from './testDatabase';

/**
 * Dirotta la suite sulla copia del database preparata da `globalSetup`.
 *
 * Perché qui e non altrove: `src/config/index.ts` costruisce `config.dbPath` nel
 * momento in cui viene importato, quindi `DB_PATH` deve essere già presente prima
 * di quell'import — e i file di setup girano nello stesso processo dei test, prima
 * di essi. `dotenv` non sovrascrive le variabili già impostate, quindi questo
 * valore ha la precedenza su quello eventualmente presente nel `.env`.
 */
process.env.DB_PATH = TEST_DB_PATH;
