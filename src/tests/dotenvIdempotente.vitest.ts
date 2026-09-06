/**
 * dotenvIdempotente.vitest.ts — C28/C45: `loadDotEnv()` carica i file UNA volta per processo.
 *
 * Perché conta: chi isola una suite o un harness cancella `DATABASE_URL`/`SUPABASE_URL` da
 * `process.env` PRIMA di importare `src/config`. Con dotenv `override=false` una chiave assente
 * viene però RI-AGGIUNTA dal `.env` a ogni nuova `dotenv.config()`: se `loadDotEnv()` ricaricasse i
 * file a ogni chiamata, la cancellazione sarebbe annullata dall'import successivo e la suite
 * finirebbe su Postgres. Rosso-prima: `loadDotEnv()` chiamava `dotenv.config` a ogni invocazione.
 *
 * Il modulo viene importato FRESCO (`vi.resetModules`) perché `vitestSetup` lo ha già usato in
 * questo processo: la guardia per-processo vale per istanza di modulo.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CHIAVE = 'DOTENV_IDEMPOTENTE_PROVA';
let cwdOriginale = '';
let cartella = '';

describe('loadDotEnv è idempotente per processo', () => {
    beforeEach(() => {
        cwdOriginale = process.cwd();
        cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenv-idempotente-'));
        fs.writeFileSync(path.join(cartella, '.env'), `${CHIAVE}=dal-file\n`, 'utf8');
        delete process.env[CHIAVE];
        process.chdir(cartella);
        vi.resetModules();
    });

    afterEach(() => {
        process.chdir(cwdOriginale);
        delete process.env[CHIAVE];
        fs.rmSync(cartella, { recursive: true, force: true });
    });

    it('una chiave cancellata dopo il primo caricamento NON viene rimessa da una seconda chiamata', async () => {
        const { loadDotEnv } = await import('../config/env');

        loadDotEnv();
        // Se il primo caricamento non l'ha letta, il test non prova nulla: verifica la premessa.
        expect(process.env[CHIAVE], 'premessa: il primo loadDotEnv legge il .env del cwd').toBe('dal-file');

        delete process.env[CHIAVE];
        loadDotEnv();

        expect(process.env[CHIAVE]).toBeUndefined();
    });
});
