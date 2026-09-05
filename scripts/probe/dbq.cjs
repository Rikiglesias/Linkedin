#!/usr/bin/env node
'use strict';
/**
 * Sonda C19 (goal `bot-operativo`, F1) — igiene DB: residui di test e polling rotto. SOLA LETTURA.
 *
 * Stampa un JSON con i 4 conteggi del contratto E il totale righe di ogni tabella (lo zero da solo
 * non basta: un totale che non cala = sonda rotta o pulizia mai avvenuta).
 *
 * EXPECT (binding C19): PRIMA della leva `run_logs.test=2980`, `run_logs.telegramPollingError=2968`,
 * `selector_fallbacks.unit=3` (su 3), `dynamic_selectors.unit=2` (su 2), `run_logs.total` ≥ 5948;
 * DOPO lo script di pulizia 0/0/0/0 E `run_logs.total` diminuito di 2980+2968.
 * Uso: `node scripts/probe/dbq.cjs` dalla radice del repo.
 */
const { openReadOnly, all, close } = require('./_sqliteReadOnly.cjs');

async function count(db, sql, params = []) {
    const [{ n }] = await all(db, sql, params);
    return Number(n);
}

(async () => {
    const db = await openReadOnly();
    try {
        const result = {
            run_logs: {
                total: await count(db, `SELECT COUNT(*) AS n FROM run_logs`),
                test: await count(db, `SELECT COUNT(*) AS n FROM run_logs WHERE event LIKE 'test.%'`),
                telegramPollingError: await count(
                    db,
                    `SELECT COUNT(*) AS n FROM run_logs WHERE event = 'telegram.polling_error'`,
                ),
            },
            selector_fallbacks: {
                total: await count(db, `SELECT COUNT(*) AS n FROM selector_fallbacks`),
                unit: await count(db, `SELECT COUNT(*) AS n FROM selector_fallbacks WHERE action_label LIKE 'unit.%'`),
            },
            dynamic_selectors: {
                total: await count(db, `SELECT COUNT(*) AS n FROM dynamic_selectors`),
                unit: await count(db, `SELECT COUNT(*) AS n FROM dynamic_selectors WHERE action_label LIKE 'unit.%'`),
            },
        };
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } finally {
        await close(db);
    }
})().catch((err) => {
    process.stderr.write(`dbq: ${err.message}\n`);
    process.exit(2);
});
