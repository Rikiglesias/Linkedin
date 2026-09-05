'use strict';
/**
 * Apertura SOLA LETTURA del DB SQLite del bot per le sonde di `scripts/probe/`.
 * - `OPEN_READONLY`: la sonda non può scrivere né CREARE il file (DB assente → errore, mai un DB vuoto nuovo).
 * - Path: `DB_PATH` se impostato (stessa semantica di `config.dbPath`), altrimenti `data/linkedin_bot.sqlite`
 *   relativo alla radice del repo. Non carica `.env`: le sonde DB non hanno bisogno di segreti.
 */
const path = require('path');
const sqlite3 = require('sqlite3');

const repoRoot = path.resolve(__dirname, '..', '..');

function resolveDbPath() {
    const configured = process.env.DB_PATH || path.join('data', 'linkedin_bot.sqlite');
    return path.isAbsolute(configured) ? configured : path.join(repoRoot, configured);
}

function openReadOnly() {
    const file = resolveDbPath();
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(file, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                reject(new Error(`DB non apribile in sola lettura: ${file} (${err.code || err.message})`));
                return;
            }
            resolve(db);
        });
    });
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
}

function close(db) {
    return new Promise((resolve) => db.close(() => resolve()));
}

module.exports = { openReadOnly, all, close, resolveDbPath };
