/**
 * jsonStdoutGuard.vitest.ts — C15 del contratto `bot-operativo` (parte «stdout = solo JSON»).
 *
 * I comandi che rispondono con un JSON su stdout (`doctor`, `kpi`, `sync-status`, `config-validate`, `incidents`)
 * vengono sporcati dal bootstrap: dotenv stampa i suoi tip su stdout, `config/index.ts` logga il profilo attivo e il
 * logger scrive INFO con `console.log` — tutto PRIMA che il comando parta. La guardia, installata in testa a
 * `src/index.ts`, per quei soli comandi devia su stderr tutto ciò che passa da `process.stdout.write` (quindi anche
 * `console.log`), mette a tacere dotenv e tiene il vero stdout per il solo risultato JSON. Per gli altri comandi non
 * cambia nulla.
 */
import { Console } from 'node:console';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    installJsonStdoutGuard,
    isJsonStdoutCommand,
    resetJsonStdoutGuardForTests,
    writeJsonResult,
} from '../cli/jsonStdout';

describe('C15 — guardia stdout dei comandi JSON', () => {
    let out: string[];
    let err: string[];
    // Vitest sostituisce il `console` globale con il suo (l'output va al reporter, non a `process.stdout.write`).
    // Una Console legata ai VERI stream del processo fa quello che fa il `console` di Node fuori da vitest:
    // `stream.write(...)` risolto a ogni chiamata, quindi passa dalla proprietà che la guardia sostituisce.
    let realConsole: Console;
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    const originalQuiet = process.env.DOTENV_CONFIG_QUIET;

    beforeEach(() => {
        out = [];
        err = [];
        delete process.env.DOTENV_CONFIG_QUIET;
        process.stdout.write = ((chunk: string | Uint8Array) => {
            out.push(String(chunk));
            return true;
        }) as typeof process.stdout.write;
        process.stderr.write = ((chunk: string | Uint8Array) => {
            err.push(String(chunk));
            return true;
        }) as typeof process.stderr.write;
        realConsole = new Console({ stdout: process.stdout, stderr: process.stderr });
    });

    afterEach(() => {
        resetJsonStdoutGuardForTests();
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
        if (originalQuiet === undefined) delete process.env.DOTENV_CONFIG_QUIET;
        else process.env.DOTENV_CONFIG_QUIET = originalQuiet;
    });

    it('per `doctor` il rumore di bootstrap va su stderr e il JSON finale sul vero stdout', () => {
        expect(installJsonStdoutGuard(['node', 'dist/index.js', 'doctor', '--no-browser'])).toBe(true);

        realConsole.log('[CONFIG] Profilo attivo: dev');
        process.stdout.write('[dotenv@17.3.1] injecting env (333) from .env\n');
        realConsole.info('[INFO] plugin_loader.ready { count: 0 }');
        writeJsonResult({ ok: true, accountSessions: [] });

        expect(out.join('')).toBe(`${JSON.stringify({ ok: true, accountSessions: [] }, null, 2)}\n`);
        expect(JSON.parse(out.join(''))).toEqual({ ok: true, accountSessions: [] });
        const stderrText = err.join('');
        expect(stderrText).toContain('[CONFIG] Profilo attivo: dev');
        expect(stderrText).toContain('[dotenv@17.3.1]');
        expect(stderrText).toContain('plugin_loader.ready');
        expect(process.env.DOTENV_CONFIG_QUIET).toBe('true');
    });

    it('per un comando NON JSON non cambia nulla (stdout intatto, dotenv non zittito)', () => {
        expect(installJsonStdoutGuard(['node', 'dist/index.js', 'run', 'invite'])).toBe(false);
        realConsole.log('[LOOP] ciclo 1');
        expect(out.join('')).toContain('[LOOP] ciclo 1');
        expect(err.join('')).toBe('');
        expect(process.env.DOTENV_CONFIG_QUIET).toBeUndefined();
    });

    it('senza comando (help) o con argv corto non installa nulla', () => {
        expect(installJsonStdoutGuard(['node', 'dist/index.js'])).toBe(false);
        expect(installJsonStdoutGuard([])).toBe(false);
    });

    it("`doctor --help` è testo per umani: resta su stdout, la guardia non si installa", () => {
        expect(installJsonStdoutGuard(['node', 'dist/index.js', 'doctor', '--help'])).toBe(false);
        expect(installJsonStdoutGuard(['node', 'dist/index.js', 'kpi', '-h'])).toBe(false);
        realConsole.log('Usage: doctor [--no-browser]');
        expect(out.join('')).toContain('Usage: doctor');
        expect(err.join('')).toBe('');
    });

    it('i gemelli di `doctor` (stdout = JSON puro) sono coperti; i comandi a output umano no', () => {
        for (const command of ['doctor', 'kpi', 'sync-status', 'config-validate', 'incidents', 'status', 'diagnostics', 'diag']) {
            expect(isJsonStdoutCommand(command), command).toBe(true);
        }
        for (const command of ['run', 'run-loop', 'funnel', 'login', 'help', 'preflight-env', undefined]) {
            expect(isJsonStdoutCommand(command), String(command)).toBe(false);
        }
    });

    it('installazione idempotente: due install non incatenano due deviazioni', () => {
        expect(installJsonStdoutGuard(['node', 'x', 'kpi'])).toBe(true);
        expect(installJsonStdoutGuard(['node', 'x', 'kpi'])).toBe(true);
        realConsole.log('una volta');
        expect(err.filter((line) => line.includes('una volta'))).toHaveLength(1);
        expect(out.join('')).toBe('');
    });

    it('senza guardia installata writeJsonResult scrive sullo stdout corrente', () => {
        writeJsonResult({ a: 1 });
        expect(JSON.parse(out.join(''))).toEqual({ a: 1 });
        expect(err.join('')).toBe('');
    });

    it('rispetta un DOTENV_CONFIG_QUIET già impostato dall’utente', () => {
        process.env.DOTENV_CONFIG_QUIET = 'false';
        installJsonStdoutGuard(['node', 'x', 'doctor']);
        expect(process.env.DOTENV_CONFIG_QUIET).toBe('false');
    });
});
