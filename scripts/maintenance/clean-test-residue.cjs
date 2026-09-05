#!/usr/bin/env node
'use strict';
/**
 * Pulizia C19 (goal `bot-operativo`, F1) — residui di test e polling rotto nel DB SQLite. QUESTO SCRIPT SCRIVE.
 *
 * Sicurezza:
 * - default = DRY-RUN: stampa i conteggi e NON cancella nulla; cancella SOLO con `--yes`;
 * - prima del DELETE crea un backup consistente con `VACUUM INTO` (`data/linkedin_bot_backup_clean-<ts>.sqlite`),
 *   salvo `--no-backup`; il backup viene provato con un COUNT prima di procedere;
 * - un'unica transazione `BEGIN IMMEDIATE`: o tutto o niente; `leads` e ogni altra tabella NON vengono toccate;
 * - solo SQLite (`DATABASE_URL` impostato → si ferma: in Postgres il perimetro va rimisurato).
 *
 * Livello 1 (sempre, CERTO rumore — binding § C12): `run_logs.event LIKE 'test.%'` · `run_logs.event =
 * 'telegram.polling_error'` · `selector_fallbacks.action_label LIKE 'unit.%'` · `dynamic_selectors.action_label
 * LIKE 'unit.%'`.
 * Livello 2 (`--level2`, PROBABILE rumore): `run_logs` `ab_bandit.%` / `plugin_loader.%` /
 * `ai.invite_note.too_similar_retry` SOLO con `created_at < '2026-08-05'` (data del primo run reale successivo ai test).
 *
 * Ultima riga stampata: `deleted=<test>,<polling>,<selector_fallbacks>,<dynamic_selectors>[;level2=<n>]`
 * (è il formato che il VERIFY C19 confronta: atteso `deleted=2980,2968,3,2`).
 * Uso: `node scripts/maintenance/clean-test-residue.cjs [--yes] [--level2] [--no-backup]` dalla radice del repo.
 * Verifica DOPO: `node scripts/probe/dbq.cjs` → 0/0/0/0 e `run_logs.total` diminuito della somma.
 */
const path = require('path');
const sqlite3 = require('sqlite3');
const { resolveDbPath } = require('../probe/_sqliteReadOnly.cjs');

const LEVEL2_CUTOFF = '2026-08-05';

const LEVEL1 = [
    { key: 'test', table: 'run_logs', where: `event LIKE 'test.%'` },
    { key: 'polling', table: 'run_logs', where: `event = 'telegram.polling_error'` },
    { key: 'selector_fallbacks', table: 'selector_fallbacks', where: `action_label LIKE 'unit.%'` },
    { key: 'dynamic_selectors', table: 'dynamic_selectors', where: `action_label LIKE 'unit.%'` },
];
const LEVEL2 = {
    key: 'level2',
    table: 'run_logs',
    where: `(event LIKE 'ab_bandit.%' OR event LIKE 'plugin_loader.%' OR event = 'ai.invite_note.too_similar_retry')
            AND created_at < '${LEVEL2_CUTOFF}'`,
};

const args = new Set(process.argv.slice(2));
const apply = args.has('--yes');
const level2 = args.has('--level2');
const backup = !args.has('--no-backup');

function openReadWrite(file) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(file, sqlite3.OPEN_READWRITE, (err) =>
            err ? reject(new Error(`DB non apribile: ${file} (${err.code || err.message})`)) : resolve(db),
        );
    });
}
const get = (db, sql, params = []) =>
    new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));
const run = (db, sql, params = []) =>
    new Promise((resolve, reject) => {
        db.run(sql, params, function onDone(err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
const close = (db) => new Promise((resolve) => db.close(() => resolve()));

async function countRule(db, rule) {
    const { n } = await get(db, `SELECT COUNT(*) AS n FROM ${rule.table} WHERE ${rule.where}`);
    return Number(n);
}

async function makeBackup(db, dbFile) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const target = path.join(path.dirname(dbFile), `linkedin_bot_backup_clean-${stamp}.sqlite`);
    await run(db, `VACUUM INTO ?`, [target]);
    const check = await new Promise((resolve, reject) => {
        const copy = new sqlite3.Database(target, sqlite3.OPEN_READONLY, (err) => {
            if (err) return reject(new Error(`backup non leggibile: ${target}`));
            copy.get(`SELECT COUNT(*) AS n FROM run_logs`, (qErr, row) => {
                copy.close(() => (qErr ? reject(qErr) : resolve(Number(row.n))));
            });
        });
    });
    return { target, runLogsInBackup: check };
}

(async () => {
    if (process.env.DATABASE_URL) {
        throw new Error(
            'DATABASE_URL impostato: questo script pulisce solo SQLite (in Postgres rimisurare il perimetro).',
        );
    }
    const dbFile = resolveDbPath();
    const rules = level2 ? [...LEVEL1, LEVEL2] : LEVEL1;
    const db = await openReadWrite(dbFile);
    try {
        await run(db, `PRAGMA busy_timeout = 5000`);
        const before = {};
        for (const rule of rules) before[rule.key] = await countRule(db, rule);
        const { n: totalBefore } = await get(db, `SELECT COUNT(*) AS n FROM run_logs`);
        process.stdout.write(
            `db=${dbFile}\nrun_logs.total(before)=${totalBefore}\ncandidati=${JSON.stringify(before)}\n`,
        );

        if (!apply) {
            process.stdout.write('DRY-RUN: nessuna riga cancellata. Rilancia con --yes per applicare.\n');
            return;
        }

        if (backup) {
            const { target, runLogsInBackup } = await makeBackup(db, dbFile);
            process.stdout.write(`backup=${target} (run_logs nel backup: ${runLogsInBackup})\n`);
        }

        await run(db, `BEGIN IMMEDIATE`);
        const deleted = {};
        try {
            for (const rule of rules) {
                deleted[rule.key] = await run(db, `DELETE FROM ${rule.table} WHERE ${rule.where}`);
            }
            await run(db, `COMMIT`);
        } catch (err) {
            await run(db, `ROLLBACK`).catch(() => {});
            throw err;
        }
        const { n: totalAfter } = await get(db, `SELECT COUNT(*) AS n FROM run_logs`);
        process.stdout.write(`run_logs.total(after)=${totalAfter}\n`);
        const line1 = LEVEL1.map((rule) => deleted[rule.key]).join(',');
        process.stdout.write(`deleted=${line1}${level2 ? `;level2=${deleted.level2}` : ''}\n`);
    } finally {
        await close(db);
    }
})().catch((err) => {
    process.stderr.write(`clean-test-residue: ${err.message}\n`);
    process.exit(2);
});
