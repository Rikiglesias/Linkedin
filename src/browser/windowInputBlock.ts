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
 * PowerShell script template per settare/rimuovere WS_EX_TRANSPARENT sulla finestra del browser.
 * - WS_EX_LAYERED (0x80000): prerequisito per WS_EX_TRANSPARENT su top-level window
 * - WS_EX_TRANSPARENT (0x20): rende la finestra invisibile al mouse (click-through)
 * - SetLayeredWindowAttributes con alpha=255: finestra resta 100% visibile
 */
function buildPowerShellScript(pid: number, enable: boolean): string {
    // Escapare per embedding in PowerShell command
    return `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Diagnostics;
public class WinInputBlock {
    [DllImport("user32.dll", SetLastError=true)]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern bool SetLayeredWindowAttributes(IntPtr hWnd, uint crKey, byte bAlpha, uint dwFlags);

    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TRANSPARENT = 0x20;
    private const int WS_EX_LAYERED = 0x80000;
    private const uint LWA_ALPHA = 0x2;

    public static bool SetClickThrough(int pid, bool enable) {
        try {
            Process proc = Process.GetProcessById(pid);
            IntPtr hwnd = proc.MainWindowHandle;
            if (hwnd == IntPtr.Zero) return false;
            int style = GetWindowLong(hwnd, GWL_EXSTYLE);
            if (enable) {
                style |= WS_EX_LAYERED | WS_EX_TRANSPARENT;
                SetWindowLong(hwnd, GWL_EXSTYLE, style);
                SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA);
            } else {
                style &= ~(WS_EX_LAYERED | WS_EX_TRANSPARENT);
                SetWindowLong(hwnd, GWL_EXSTYLE, style);
            }
            return true;
        } catch { return false; }
    }
}
"@ -Language CSharp
[WinInputBlock]::SetClickThrough(${pid}, $${enable ? 'True' : 'False'})
`.trim();
}

/**
 * Ottiene il PID del processo browser da un BrowserContext Playwright.
 * Funziona con Camoufox, Firefox e Chromium.
 */
function getBrowserPid(browserContext: BrowserContext): number | null {
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
        // Su Linux/Mac non serve — si usa virtual display (Xvfb) o non è un problema
        return false;
    }

    const pid = getBrowserPid(browserContext);
    if (!pid) {
        console.warn('[WINDOW-BLOCK] Impossibile ottenere PID del browser');
        return false;
    }

    if (_clickThroughActive && _lastPid === pid) {
        return true; // Già attivo
    }

    try {
        const script = buildPowerShellScript(pid, true);
        const result = execSync(
            `powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
            { timeout: 8_000, encoding: 'utf-8', windowsHide: true },
        ).trim();

        if (result === 'True') {
            _clickThroughActive = true;
            _lastPid = pid;
            console.log(`[WINDOW-BLOCK] ✓ Click-through attivato (PID ${pid}) — mouse utente bloccato`);
            return true;
        }
        console.warn(`[WINDOW-BLOCK] PowerShell ha restituito: ${result}`);
        return false;
    } catch (err) {
        console.warn(`[WINDOW-BLOCK] Errore attivazione: ${err instanceof Error ? err.message : String(err)}`);
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

    if (!_clickThroughActive) return true; // Già disattivato

    try {
        const script = buildPowerShellScript(pid, false);
        execSync(
            `powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
            { timeout: 8_000, encoding: 'utf-8', windowsHide: true },
        );
        _clickThroughActive = false;
        _lastPid = null;
        console.log(`[WINDOW-BLOCK] ✓ Click-through disattivato (PID ${pid}) — mouse utente sbloccato`);
        return true;
    } catch (err) {
        console.warn(`[WINDOW-BLOCK] Errore disattivazione: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
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
