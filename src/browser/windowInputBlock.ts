/**
 * browser/windowInputBlock.ts
 * ─────────────────────────────────────────────────────────────────
 * Blocco input utente a livello OS (Windows) tramite WS_EX_TRANSPARENT.
 *
 * Rende la finestra del browser "click-through": il mouse fisico dell'utente
 * passa SOTTO la finestra come se non esistesse. Il cursore non appare,
 * nessun evento mouse raggiunge il browser.
 *
 * L'input del bot (CDP/Juggler via Playwright) continua a funzionare
 * perché bypassa completamente il Windows message queue — va direttamente
 * al rendering engine del browser tramite WebSocket protocol.
 *
 * Usato DOPO il login. Disabilitato PRIMA del login e al cleanup.
 */

import { execSync } from 'child_process';
import { BrowserContext } from 'playwright';

/** Stato corrente del click-through per evitare chiamate duplicate. */
let _clickThroughActive = false;
let _lastPid: number | null = null;

/**
 * WeakMap per PID override — usato da Camoufox che non espone browser.process().
 * Il PID viene registrato da launcher.ts subito dopo il lancio.
 */
const _pidOverrides = new WeakMap<BrowserContext, number>();

/**
 * Registra manualmente il PID del browser per un BrowserContext.
 * Usato per Camoufox dove browser.process() non è disponibile.
 */
export function registerBrowserPid(ctx: BrowserContext, pid: number): void {
    _pidOverrides.set(ctx, pid);
}

/**
 * Ottiene i PID di tutti i processi il cui nome contiene 'firefox' o 'camoufox'.
 * Usato per snapshot pre/post lancio Camoufox → il PID nuovo è quello di Camoufox.
 */
export function getFirefoxLikePids(): number[] {
    if (process.platform !== 'win32') return [];
    try {
        const result = execSync(
            "powershell -NoProfile -NonInteractive -Command \"(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'firefox|camoufox' }).Id -join ','\"",
            { timeout: 5_000, encoding: 'utf-8', windowsHide: true },
        ).trim();
        if (!result) return [];
        return result
            .split(',')
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => n > 0);
    } catch {
        return [];
    }
}

/**
 * PowerShell script template per settare/rimuovere WS_EX_TRANSPARENT sulla finestra del browser.
 * - WS_EX_LAYERED (0x80000): prerequisito per WS_EX_TRANSPARENT su top-level window
 * - WS_EX_TRANSPARENT (0x20): rende la finestra invisibile al mouse (click-through)
 * - SetLayeredWindowAttributes con alpha=255: finestra resta 100% visibile
 *
 * IMPORTANTE: Applica a TUTTE le finestre visibili del processo (EnumThreadWindows),
 * non solo a MainWindowHandle. Firefox/Camoufox ha finestre child separate
 * (content area, chrome) che ricevono eventi mouse indipendentemente.
 */
function buildPowerShellScript(pid: number, enable: boolean): string {
    return `
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Diagnostics;
public class WinInputBlock {
    [DllImport("user32.dll", SetLastError=true)]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool SetLayeredWindowAttributes(IntPtr hWnd, uint crKey, byte bAlpha, uint dwFlags);
    [DllImport("user32.dll")]
    public static extern bool EnumThreadWindows(int dwThreadId, EnumWinProc lpfn, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    public delegate bool EnumWinProc(IntPtr hWnd, IntPtr lParam);

    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TRANSPARENT = 0x20;
    private const int WS_EX_LAYERED = 0x80000;
    private const uint LWA_ALPHA = 0x2;

    private static void ApplyStyle(IntPtr hwnd, bool enable) {
        int style = GetWindowLong(hwnd, GWL_EXSTYLE);
        if (enable) {
            style |= WS_EX_LAYERED | WS_EX_TRANSPARENT;
            SetWindowLong(hwnd, GWL_EXSTYLE, style);
            SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA);
        } else {
            style &= ~(WS_EX_LAYERED | WS_EX_TRANSPARENT);
            SetWindowLong(hwnd, GWL_EXSTYLE, style);
        }
    }

    public static int SetClickThrough(int pid, bool enable) {
        try {
            Process proc = Process.GetProcessById(pid);
            int count = 0;
            if (proc.MainWindowHandle != IntPtr.Zero) {
                ApplyStyle(proc.MainWindowHandle, enable);
                count++;
            }
            foreach (ProcessThread t in proc.Threads) {
                EnumThreadWindows(t.Id, (hwnd, lp) => {
                    if (IsWindowVisible(hwnd)) {
                        ApplyStyle(hwnd, enable);
                        count++;
                    }
                    return true;
                }, IntPtr.Zero);
            }
            return count;
        } catch { return 0; }
    }
}
"@ -Language CSharp
[WinInputBlock]::SetClickThrough(${pid}, $${enable ? 'True' : 'False'})
`.trim();
}

/**
 * Ottiene il PID del processo browser da un BrowserContext Playwright.
 * Supporta Camoufox (via WeakMap override), Firefox e Chromium.
 *
 * Ordine di priorità:
 * 1. PID registrato manualmente (WeakMap — per Camoufox)
 * 2. Playwright standard (browser.process().pid — per Chromium/Firefox diretto)
 */
function getBrowserPid(browserContext: BrowserContext): number | null {
    // 1. Override registrato (Camoufox non espone browser.process())
    const override = _pidOverrides.get(browserContext);
    if (override) return override;

    // 2. Playwright standard
    try {
        const browser = browserContext.browser();
        if (!browser) return null;
        // .process() exists at runtime on launched browsers but isn't in Playwright's TS types
        const proc = (browser as unknown as { process?: () => { pid?: number } | null }).process?.();
        return proc?.pid ?? null;
    } catch {
        return null;
    }
}

/**
 * Abilita click-through sulla finestra del browser.
 * Il mouse fisico dell'utente passa SOTTO la finestra — non la tocca mai.
 * CDP/Juggler input del bot continua a funzionare normalmente.
 *
 * @returns true se attivato con successo
 */
export function enableWindowClickThrough(browserContext: BrowserContext): boolean {
    if (process.platform !== 'win32') {
        return false;
    }

    const pid = getBrowserPid(browserContext);
    if (!pid) {
        console.warn('[WINDOW-BLOCK] Impossibile ottenere PID del browser');
        return false;
    }

    return _applyClickThrough(pid, true);
}

/**
 * Riapplica click-through usando l'ultimo PID noto.
 * Chiamato da blockUserInput dopo ogni navigazione — il browser crea nuove
 * finestre child durante page.goto e queste non ereditano WS_EX_TRANSPARENT.
 */
export function reapplyWindowClickThrough(): void {
    if (process.platform !== 'win32') return;
    if (!_lastPid) return;
    _applyClickThrough(_lastPid, true);
}

function _applyClickThrough(pid: number, enable: boolean): boolean {
    try {
        const script = buildPowerShellScript(pid, enable);
        const result = execSync(`powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`, {
            timeout: 10_000,
            encoding: 'utf-8',
            windowsHide: true,
        }).trim();

        const windowCount = parseInt(result, 10);
        if (windowCount > 0) {
            _clickThroughActive = enable;
            _lastPid = pid;
            if (enable) {
                console.log(
                    `[WINDOW-BLOCK] ✓ Click-through attivato (PID ${pid}, ${windowCount} finestre) — mouse utente bloccato`,
                );
            }
            return true;
        }
        console.warn(`[WINDOW-BLOCK] Nessuna finestra trovata per PID ${pid} (risultato: ${result})`);
        return false;
    } catch (err) {
        console.warn(`[WINDOW-BLOCK] Errore: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
}

/**
 * Disabilita click-through — ripristina il comportamento normale della finestra.
 * L'utente può di nuovo interagire col browser (usato per login manuale).
 *
 * @returns true se disattivato con successo
 */
export function disableWindowClickThrough(browserContext?: BrowserContext): boolean {
    if (process.platform !== 'win32') return false;

    const pid = browserContext ? getBrowserPid(browserContext) : _lastPid;
    if (!pid) return false;

    if (!_clickThroughActive) return true;

    const ok = _applyClickThrough(pid, false);
    if (ok) {
        _clickThroughActive = false;
        _lastPid = null;
        console.log(`[WINDOW-BLOCK] ✓ Click-through disattivato (PID ${pid}) — mouse utente sbloccato`);
    }
    return ok;
}

/**
 * Cleanup handler — disabilita click-through al termine del processo.
 * Registrare con process.on('exit', cleanupWindowClickThrough).
 */
export function cleanupWindowClickThrough(): void {
    if (_clickThroughActive && _lastPid) {
        try {
            disableWindowClickThrough();
        } catch {
            // Best effort al cleanup
        }
    }
}
