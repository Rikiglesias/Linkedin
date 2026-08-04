import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import type { TestProject } from 'vitest/node';

import { SOURCE_DB_PATH, TEST_DB_KEY } from './testDatabase';

/** Directory temporanea di questa esecuzione, da rimuovere alla fine. */
let cartellaTemporanea: string | null = null;

/**
 * Prepara una copia usa-e-getta del database prima che la suite parta.
 *
 * Perché una copia e non un database vuoto: `getDatabase()` non esegue le
 * migration, quindi su un file vuoto ogni test che interroga una tabella reale
 * fallirebbe. La copia parte dallo schema e dai dati veri, e ogni scrittura dei
 * test resta confinata lì: il database di produzione non viene più toccato.
 *
 * La cartella è univoca per esecuzione: con un percorso fisso, due suite avviate
 * insieme (per esempio un `conta-problemi` mentre gira una singola esecuzione
 * mirata) si cancellerebbero il database a vicenda.
 */
export async function setup(project: TestProject): Promise<void> {
    if (!fs.existsSync(SOURCE_DB_PATH)) {
        throw new Error(
            `Database sorgente non trovato: ${SOURCE_DB_PATH}. ` +
                `La suite lavora su una sua copia e senza il sorgente non può partire.`,
        );
    }

    cartellaTemporanea = fs.mkdtempSync(path.join(os.tmpdir(), 'linkedin-bot-test-db-'));
    const copia = path.join(cartellaTemporanea, 'linkedin_bot.sqlite');

    // `VACUUM INTO` e non `copyFileSync`: con il journal in modalità WAL la copia
    // grezza del solo file .sqlite perderebbe le transazioni non ancora sottoposte
    // a checkpoint, producendo una copia incoerente.
    const sorgente = await open({
        filename: SOURCE_DB_PATH,
        driver: sqlite3.Database,
        mode: sqlite3.OPEN_READONLY,
    });

    try {
        await sorgente.exec(`VACUUM INTO '${copia.replace(/'/g, "''")}'`);
    } finally {
        await sorgente.close();
    }

    // Canale ufficiale verso i test: `provide` qui, `inject` in `vitestSetup.ts`.
    project.provide(TEST_DB_KEY, copia);
}

/**
 * Rimuove la copia a fine suite: nessun residuo fra un'esecuzione e la successiva.
 *
 * La rimozione non può far fallire la suite: su Windows SQLite può tenere il file
 * agganciato ancora per un istante dopo la chiusura (`EBUSY`), e una cartella
 * temporanea rimasta indietro è innocua — la ripulisce il sistema operativo.
 */
export async function teardown(): Promise<void> {
    if (!cartellaTemporanea) return;

    try {
        fs.rmSync(cartellaTemporanea, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 100,
        });
    } catch {
        // Volutamente silenzioso: vedi sopra.
    } finally {
        cartellaTemporanea = null;
    }
}
