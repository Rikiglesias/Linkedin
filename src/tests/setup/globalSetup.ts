import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import { SOURCE_DB_PATH, TEST_DB_DIR, TEST_DB_PATH } from './testDatabase';

/**
 * Prepara una copia usa-e-getta del database prima che la suite parta.
 *
 * Perché una copia e non un database vuoto: `getDatabase()` non esegue le
 * migration, quindi su un file vuoto ogni test che interroga una tabella reale
 * fallirebbe. La copia parte dallo schema e dai dati veri, e ogni scrittura dei
 * test resta confinata lì: il database di produzione non viene più toccato.
 *
 * Nota: questo file gira in un contesto separato, prima che i worker dei test
 * esistano — quello che imposta qui in `process.env` NON arriverebbe ai test.
 * Per questo il percorso della copia è calcolato (`testDatabase.ts`) e non passato.
 */
export async function setup(): Promise<void> {
    if (!fs.existsSync(SOURCE_DB_PATH)) {
        throw new Error(
            `Database sorgente non trovato: ${SOURCE_DB_PATH}. ` +
                `La suite lavora su una sua copia e senza il sorgente non può partire.`,
        );
    }

    // Copia sempre fresca: due esecuzioni consecutive devono partire dallo stesso stato.
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });

    // `VACUUM INTO` e non `copyFileSync`: con il journal in modalità WAL la copia
    // grezza del solo file .sqlite perderebbe le transazioni non ancora sottoposte
    // a checkpoint, producendo una copia incoerente.
    const source = await open({
        filename: SOURCE_DB_PATH,
        driver: sqlite3.Database,
        mode: sqlite3.OPEN_READONLY,
    });

    try {
        await source.exec(`VACUUM INTO '${TEST_DB_PATH.replace(/'/g, "''")}'`);
    } finally {
        await source.close();
    }
}

/** Rimuove la copia a fine suite: nessun residuo fra un'esecuzione e la successiva. */
export async function teardown(): Promise<void> {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
}
