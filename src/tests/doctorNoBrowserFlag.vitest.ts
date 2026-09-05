/**
 * doctorNoBrowserFlag.vitest.ts — C15 del contratto `bot-operativo`: `doctor --no-browser` in CLI.
 *
 * Flag presente → `runDoctor({ skipBrowserSessionCheck: true })` (nessun browser aperto solo per verificare il login);
 * flag assente → `{ skipBrowserSessionCheck: false }` (check completo, come oggi). Lo stdout del comando è SOLO il JSON
 * del report (chi lo consuma da script deve poterlo parsare senza filtrare log di bootstrap). L'help del comando
 * documenta il flag e `src/index.ts` delega il case `doctor` al comando, così il flag arriva davvero alla CLI costruita.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    runDoctor: vi.fn(),
}));

vi.mock('../core/doctor', () => ({
    runDoctor: mocks.runDoctor,
}));

import { runDoctorCommand } from '../cli/commands/doctorCommand';
import { printCommandHelp } from '../cli/commandHelp';

const FAKE_REPORT = {
    dbIntegrityOk: true,
    sessionLoginOk: true,
    quarantine: false,
    compliance: { ok: true, enforced: true, violations: [] },
    accountSessions: [{ accountId: 'default', sessionDir: 'data/session', sessionLoginOk: true }],
};

describe('C15 — doctor --no-browser', () => {
    let stdout: string[];
    let stdoutSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        stdout = [];
        mocks.runDoctor.mockReset();
        mocks.runDoctor.mockResolvedValue(FAKE_REPORT);
        stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
            stdout.push(String(chunk));
            return true;
        }) as typeof process.stdout.write);
    });

    afterEach(() => {
        stdoutSpy.mockRestore();
    });

    it('con --no-browser chiama runDoctor con skipBrowserSessionCheck: true', async () => {
        await runDoctorCommand(['--no-browser']);
        expect(mocks.runDoctor).toHaveBeenCalledTimes(1);
        expect(mocks.runDoctor).toHaveBeenCalledWith({ skipBrowserSessionCheck: true });
    });

    it('senza flag chiama runDoctor con skipBrowserSessionCheck: false (check completo come oggi)', async () => {
        await runDoctorCommand([]);
        expect(mocks.runDoctor).toHaveBeenCalledTimes(1);
        expect(mocks.runDoctor).toHaveBeenCalledWith({ skipBrowserSessionCheck: false });
    });

    it('lo stdout del comando è SOLO il JSON del report (parsabile da uno script)', async () => {
        await runDoctorCommand(['--no-browser']);
        const printed = stdout.join('');
        expect(printed.trim().length).toBeGreaterThan(0);
        const parsed = JSON.parse(printed) as typeof FAKE_REPORT;
        expect(parsed).toEqual(FAKE_REPORT);
        expect(Array.isArray(parsed.accountSessions)).toBe(true);
        expect(parsed.compliance).toBeTruthy();
    });

    it("l'help di `doctor` documenta --no-browser", () => {
        const lines: string[] = [];
        const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            lines.push(args.map(String).join(' '));
        });
        try {
            expect(printCommandHelp('doctor')).toBe(true);
        } finally {
            logSpy.mockRestore();
        }
        expect(lines.join('\n')).toContain('--no-browser');
    });

    it('src/index.ts delega il case `doctor` al comando (il flag arriva alla CLI costruita)', () => {
        const source = readFileSync(path.resolve(__dirname, '..', 'index.ts'), 'utf8');
        // Fra il case e la chiamata è ammesso solo un commento: nessun'altra istruzione deve intromettersi.
        expect(source).toMatch(/case 'doctor':\s*\{?\s*(\/\/[^\n]*\n\s*)*await runDoctorCommand\(commandArgs\)/);
        // Il vecchio dispatch chiamava runDoctor() senza opzioni direttamente da index.ts: non deve tornare.
        expect(source).not.toMatch(/case 'doctor':\s*\{?\s*const report = await runDoctor\(\)/);
    });
});
