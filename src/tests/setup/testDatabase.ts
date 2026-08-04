import os from 'os';
import path from 'path';

/**
 * Percorso del database usato dalla suite di test: una COPIA del DB reale,
 * creata fuori dal repository.
 *
 * Il valore è calcolato (non passato) perché `globalSetup` — che crea la copia —
 * e `setupFiles` — che la espone tramite `DB_PATH` — girano in processi diversi:
 * un percorso deterministico è l'unico canale affidabile fra i due.
 */
export const TEST_DB_DIR = path.join(os.tmpdir(), 'linkedin-bot-test-db');

export const TEST_DB_PATH = path.join(TEST_DB_DIR, 'linkedin_bot.sqlite');

/** Database reale del bot: sorgente della copia, mai aperto in scrittura dai test. */
export const SOURCE_DB_PATH = path.resolve(process.cwd(), 'data', 'linkedin_bot.sqlite');
