#!/usr/bin/env node
'use strict';
/**
 * Sonda C18 (goal `bot-operativo`, F1) — incidenti CRITICAL OPEN. SOLA LETTURA.
 *
 * Stampa:
 *   riga 1  → `open=[...]` (id con `status='OPEN'`, ordinati) — confronto letterale col binding
 *   poi     → JSON con `tracked` (id 1-6 del contratto: status + resolved_at), `maxId`,
 *             `newOpenBeyondContract` (id OPEN ≥ 7: vanno DICHIARATI nel binding, non fanno rosso C18)
 *
 * EXPECT (binding C18): PRIMA della leva `open=[1,2,3,4,5,6]`; DOPO `.\bot.ps1 incident-resolve 1..6`
 * `open` senza 1-6 E i sei con `status=RESOLVED` e `resolved_at` non nullo.
 * Uso: `node scripts/probe/incidents-open.cjs` dalla radice del repo.
 */
const { openReadOnly, all, close } = require('./_sqliteReadOnly.cjs');

const CONTRACT_IDS = [1, 2, 3, 4, 5, 6];

(async () => {
    const db = await openReadOnly();
    try {
        const open = (await all(db, `SELECT id FROM account_incidents WHERE status = 'OPEN' ORDER BY id`)).map(
            (row) => row.id,
        );
        const tracked = await all(
            db,
            `SELECT id, type, severity, status, opened_at, resolved_at
             FROM account_incidents
             WHERE id BETWEEN ? AND ?
             ORDER BY id`,
            [CONTRACT_IDS[0], CONTRACT_IDS[CONTRACT_IDS.length - 1]],
        );
        const [{ maxId }] = await all(db, `SELECT MAX(id) AS maxId FROM account_incidents`);
        const newOpenBeyondContract = open.filter((id) => !CONTRACT_IDS.includes(id));

        process.stdout.write(`open=[${open.join(',')}]\n`);
        process.stdout.write(`${JSON.stringify({ open, tracked, maxId, newOpenBeyondContract }, null, 2)}\n`);
    } finally {
        await close(db);
    }
})().catch((err) => {
    process.stderr.write(`incidents-open: ${err.message}\n`);
    process.exit(2);
});
