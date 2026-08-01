import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadDotEnv } from '../config/env';

/**
 * Protegge la divisione segreti/configurazione introdotta il 2026-08-01:
 *   `.env`                     -> segreti, gestito solo dall'utente
 *   `config/bot-settings.conf` -> parametri non segreti, modificabili anche dall'assistente AI
 *
 * L'invariante critica e' la PRECEDENZA: il `.env` dell'utente deve vincere sempre. E' una
 * garanzia data all'utente, e dipende da due dettagli fragili — l'ordine delle due chiamate in
 * `loadDotEnv()` e il default `override:false` di dotenv. Invertire l'ordine (o passare
 * `override:true` un domani) romperebbe la garanzia SENZA far fallire nessun altro test.
 */

const KEY_ONLY_CONF = 'TEST_TWOFILE_ONLY_IN_CONF';
const KEY_IN_BOTH = 'TEST_TWOFILE_IN_BOTH';

const origEnv = { ...process.env };
const origCwd = process.cwd();
let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-twofile-'));
    fs.mkdirSync(path.join(tmpDir, 'config'));
    // Le due chiavi non devono preesistere: dotenv non sovrascrive cio' che e' gia' in process.env,
    // quindi un residuo renderebbe il test verde per il motivo sbagliato.
    delete process.env[KEY_ONLY_CONF];
    delete process.env[KEY_IN_BOTH];
});

afterEach(() => {
    process.chdir(origCwd);
    process.env = { ...origEnv };
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeEnv(content: string): void {
    fs.writeFileSync(path.join(tmpDir, '.env'), content, 'utf8');
}

function writeConf(content: string): void {
    fs.writeFileSync(path.join(tmpDir, 'config', 'bot-settings.conf'), content, 'utf8');
}

describe('config/env — caricamento a due file (.env + config/bot-settings.conf)', () => {
    it('legge una chiave presente SOLO in bot-settings.conf', () => {
        writeEnv('UNRELATED=1\n');
        writeConf(`${KEY_ONLY_CONF}=1500\n`);
        process.chdir(tmpDir);

        loadDotEnv();

        expect(process.env[KEY_ONLY_CONF]).toBe('1500');
    });

    it('su chiave presente in ENTRAMBI vince il .env (garanzia utente, non invertire)', () => {
        writeEnv(`${KEY_IN_BOTH}=valore-utente\n`);
        writeConf(`${KEY_IN_BOTH}=valore-ai\n`);
        process.chdir(tmpDir);

        loadDotEnv();

        expect(process.env[KEY_IN_BOTH]).toBe('valore-utente');
    });

    it('non esplode se bot-settings.conf manca (file opzionale)', () => {
        writeEnv(`${KEY_IN_BOTH}=solo-env\n`);
        process.chdir(tmpDir);

        expect(() => loadDotEnv()).not.toThrow();
        expect(process.env[KEY_IN_BOTH]).toBe('solo-env');
    });

    it('non esplode se manca anche il .env (entrambi opzionali)', () => {
        process.chdir(tmpDir);

        expect(() => loadDotEnv()).not.toThrow();
        expect(process.env[KEY_ONLY_CONF]).toBeUndefined();
    });
});
