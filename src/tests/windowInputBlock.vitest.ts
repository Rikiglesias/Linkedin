import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

// [WINDOW-BLOCK] fix (2026-06-09): lo script PowerShell contiene un here-string C# (Add-Type @"..."@)
// con virgolette interne. Va passato via -EncodedCommand (base64 UTF-16LE), NON via -Command "..."
// inline con escaping (che rompeva sia l'here-string sia il C# → click-through non applicato →
// mouse utente non bloccato sul 2° monitor). Questi test blindano: (a) lo script resta ben formato,
// (b) l'encoding UTF-16LE round-trippa senza corrompere lo script.

// Mock child_process + logger PRIMA dell'import del modulo runtime (vi.mock è hoisted): così i test
// runtime esercitano la LOGICA (stato multi-PID, observability) senza eseguire PowerShell reale.
const { execSyncMock, execFileMock, logWarnMock } = vi.hoisted(() => ({
    execSyncMock: vi.fn(() => ''),
    execFileMock: vi.fn(),
    logWarnMock: vi.fn(async () => undefined),
}));

vi.mock('child_process', () => ({ execSync: execSyncMock, execFile: execFileMock }));
vi.mock('../telemetry/logger', () => ({ logWarn: logWarnMock }));

import { buildPowerShellScript } from '../browser/windowInputBlockScript';
import {
    enableWindowClickThrough,
    disableWindowClickThrough,
    cleanupWindowClickThrough,
    registerBrowserPid,
} from '../browser/windowInputBlock';
import type { BrowserContext } from 'playwright';

describe('windowInputBlock — buildPowerShellScript + EncodedCommand', () => {
    it('here-string C# intatto + chiamata SetClickThrough(pid, $True)', () => {
        const s = buildPowerShellScript(12345, true);
        expect(s).toContain('Add-Type -TypeDefinition @"');
        expect(s).toContain('"@ -Language CSharp');
        expect(s).toContain('[WinInputBlock]::SetClickThrough(12345, $True)');
        // virgolette interne del C# presenti — è esattamente ciò che -Command inline distruggeva
        expect(s).toContain('[DllImport("user32.dll", SetLastError=true)]');
    });

    it('enable=false → SetClickThrough(pid, $False)', () => {
        expect(buildPowerShellScript(999, false)).toContain('[WinInputBlock]::SetClickThrough(999, $False)');
    });

    it('round-trip base64 UTF-16LE (come -EncodedCommand) preserva lo script', () => {
        const s = buildPowerShellScript(777, true);
        const encoded = Buffer.from(s, 'utf16le').toString('base64');
        const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
        expect(decoded).toBe(s);
    });
});

// Runtime: stato multi-PID + observability dei failure mode (fix 367b1af). NON verifica l'effetto OS
// reale (WS_EX_TRANSPARENT richiede Windows + una finestra) — esercita la logica JS di orchestrazione.
describe('windowInputBlock — runtime (stato multi-PID + observability)', () => {
    const realPlatform = process.platform;
    const setPlatform = (p: string) => Object.defineProperty(process, 'platform', { value: p, configurable: true });

    beforeEach(() => {
        setPlatform('win32');
        execSyncMock.mockReset();
        execSyncMock.mockReturnValue('');
        execFileMock.mockReset();
        logWarnMock.mockClear();
    });

    afterEach(() => {
        cleanupWindowClickThrough(); // svuota _activePids e ferma il re-apply timer tra i test
        setPlatform(realPlatform);
    });

    it('platform non-win32 → no-op (false), niente PowerShell', () => {
        setPlatform('linux');
        expect(enableWindowClickThrough({} as BrowserContext)).toBe(false);
        expect(execSyncMock).not.toHaveBeenCalled();
    });

    it('PID non ottenibile → logWarn window_block.pid_unavailable + false (failure mode visibile)', () => {
        const ctx = { browser: () => null } as unknown as BrowserContext;
        expect(enableWindowClickThrough(ctx)).toBe(false);
        expect(logWarnMock).toHaveBeenCalledWith('window_block.pid_unavailable', expect.any(Object));
    });

    it('PID valido + finestre trovate → true, PID protetto (disable lo sblocca)', () => {
        const ctx = {} as BrowserContext;
        registerBrowserPid(ctx, 4242);
        execSyncMock.mockReturnValue('2'); // 2 finestre rese click-through
        expect(enableWindowClickThrough(ctx)).toBe(true);
        expect(disableWindowClickThrough(ctx)).toBe(true); // il PID era attivo → sbloccato
    });

    it('nessuna finestra per il PID → logWarn window_block.no_windows + false', () => {
        const ctx = {} as BrowserContext;
        registerBrowserPid(ctx, 4243);
        execSyncMock.mockReturnValue('0');
        expect(enableWindowClickThrough(ctx)).toBe(false);
        expect(logWarnMock).toHaveBeenCalledWith('window_block.no_windows', expect.any(Object));
    });

    it('cleanupWindowClickThrough sblocca tutte le finestre attive', () => {
        const ctx = {} as BrowserContext;
        registerBrowserPid(ctx, 4244);
        execSyncMock.mockReturnValue('1');
        enableWindowClickThrough(ctx);
        cleanupWindowClickThrough();
        // dopo il cleanup il PID non è più attivo → un nuovo disable non ha nulla da fare (true)
        expect(disableWindowClickThrough(ctx)).toBe(true);
    });
});
