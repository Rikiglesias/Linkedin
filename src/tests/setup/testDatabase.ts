import path from 'path';

/** Database reale del bot: sorgente della copia, mai aperto in scrittura dai test. */
export const SOURCE_DB_PATH = path.resolve(process.cwd(), 'data', 'linkedin_bot.sqlite');

/** Chiave con cui `globalSetup` comunica ai test dove si trova la copia. */
export const TEST_DB_KEY = 'testDbPath';

declare module 'vitest' {
    interface ProvidedContext {
        [TEST_DB_KEY]: string;
    }
}
