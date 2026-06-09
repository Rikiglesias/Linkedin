/**
 * browser/windowInputBlock.ts
 * Blocco input utente a livello OS (Windows) via WS_EX_TRANSPARENT: la finestra del browser diventa
 * "click-through" — il mouse fisico dell'utente la attraversa, nessun evento mouse la raggiunge.
 * L'input del bot (CDP/Juggler via Playwright) bypassa il message queue Windows e continua a funzionare.
 * Usato DOPO il login, disabilitato prima del login e al cleanup.
 * Hardening 2026-06-09: stato MULTI-PID (Set) → protegge canary + sync insieme; re-apply continuo
 * asincrono (timer ~1s, execFile non-bloccante) → copre i child da page.goto senza bloccare
 * l'event-loop (timing anti-ban intatto); stderr CLIXML della PS non risale più a node (stdio/execFile).
 */

import { execSync, execFile } from 'child_process';
import { BrowserContext } from 'playwright';

/** PID delle finestre browser del bot attualmente protette (click-through ON). */
const _activePids = new Set<number>();

/** Timer di re-apply continuo: ri-protegge tutte le finestre attive (copre i child nati da goto). */
let _reapplyTimer: ReturnType<typeof setInterval> | null = null;
const REAPPLY_INTERVAL_MS = 1_000;

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
            { timeout: 5_000, encoding: 'utf-8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
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
/** @internal Esportata per il test del fix [WINDOW-BLOCK] (here-string + encoding). */
export function buildPowerShellScript(pid: number, enable: boolean): string {
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

// ── Apply helpers ─────────────────────────────────────────────────

/**
 * Applica/rimuove il click-through in modo SINCRONO, ritornando il successo.
 * Usato per enable/disable espliciti (serve sapere se ha trovato finestre).
 * Chiamato di rado (inizio/fine sessione), quindi il blocco sincrono è accettabile.
 */
function _applyClickThroughSync(pid: number, enable: boolean): boolean {
    try {
        const script = buildPowerShellScript(pid, enable);
        // -EncodedCommand (base64 UTF-16LE): nessun escaping, here-string e virgolette intatte.
        const encoded = Buffer.from(script, 'utf16le').toString('base64');
        const result = execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
            timeout: 10_000,
            encoding: 'utf-8',
            windowsHide: true,
            // stdio esplicito: lo stderr CLIXML della PS viene CATTURATO qui, non inoltrato
            // allo stderr di node (che bot.ps1 proverebbe a deserializzare come XML → errore).
            stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();

        const windowCount = parseInt(result, 10);
        if (windowCount > 0) {
            if (enable) {
                console.log(
                    `[WINDOW-BLOCK] ✓ Click-through attivato (PID ${pid}, ${windowCount} finestre) — mouse utente bloccato`,
                );
            }
            return true;
        }
        if (enable) {
            console.warn(`[WINDOW-BLOCK] Nessuna finestra trovata per PID ${pid} (risultato: ${result})`);
        }
        return false;
    } catch (err) {
        console.warn(`[WINDOW-BLOCK] Errore: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
}

/**
 * Ri-applica il click-through in modo ASINCRONO (fire-and-forget) — NON blocca l'event-loop,
 * così il re-apply periodico non altera il timing delle azioni del bot (anti-ban).
 * `execFile` bufferizza lo stderr del figlio nel callback → nessun rumore CLIXML su node.
 */
function _applyClickThroughAsync(pid: number): void {
    try {
        const script = buildPowerShellScript(pid, true);
        const encoded = Buffer.from(script, 'utf16le').toString('base64');
        execFile(
            'powershell',
            ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
            { timeout: 10_000, windowsHide: true },
            () => {
                /* best-effort: ri-protezione periodica, output ed errori ignorati di proposito */
            },
        );
    } catch {
        /* best-effort */
    }
}

function _ensureReapplyTimer(): void {
    if (_reapplyTimer) return;
    _reapplyTimer = setInterval(() => {
        for (const pid of _activePids) _applyClickThroughAsync(pid);
    }, REAPPLY_INTERVAL_MS);
    // Non tenere vivo il processo solo per questo timer.
    if (typeof _reapplyTimer.unref === 'function') _reapplyTimer.unref();
}

function _stopReapplyTimerIfIdle(): void {
    if (_reapplyTimer && _activePids.size === 0) {
        clearInterval(_reapplyTimer);
        _reapplyTimer = null;
    }
}

// ── API pubblica ──────────────────────────────────────────────────

/**
 * Abilita click-through sulla finestra del browser.
 * Il mouse fisico dell'utente passa SOTTO la finestra — non la tocca mai.
 * CDP/Juggler input del bot continua a funzionare normalmente.
 * Aggiunge il PID al set protetto e avvia il re-apply continuo.
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

    const ok = _applyClickThroughSync(pid, true);
    if (ok) {
        _activePids.add(pid);
        _ensureReapplyTimer();
    }
    return ok;
}

/**
 * Riapplica click-through a TUTTE le finestre bot attive.
 * Chiamato da blockUserInput dopo ogni navigazione — il browser crea nuove
 * finestre child durante page.goto e queste non ereditano WS_EX_TRANSPARENT.
 * Async (non-bloccante): copertura immediata post-navigazione, oltre al timer di fondo.
 */
export function reapplyWindowClickThrough(): void {
    if (process.platform !== 'win32') return;
    for (const pid of _activePids) _applyClickThroughAsync(pid);
}

/**
 * Disabilita click-through.
 * - con `browserContext`: sblocca SOLO quella finestra (le altre restano protette).
 * - senza argomento: sblocca TUTTE le finestre attive (cleanup).
 *
 * @returns true se almeno una finestra è stata sbloccata
 */
export function disableWindowClickThrough(browserContext?: BrowserContext): boolean {
    if (process.platform !== 'win32') return false;

    // Nessun context → disabilita TUTTE le finestre attive (cleanup globale).
    if (!browserContext) {
        let any = false;
        for (const pid of [..._activePids]) {
            _activePids.delete(pid);
            if (_applyClickThroughSync(pid, false)) {
                any = true;
                console.log(`[WINDOW-BLOCK] ✓ Click-through disattivato (PID ${pid}) — mouse utente sbloccato`);
            }
        }
        _stopReapplyTimerIfIdle();
        return any;
    }

    const pid = getBrowserPid(browserContext);
    if (!pid) return false;

    const wasActive = _activePids.delete(pid);
    _stopReapplyTimerIfIdle();
    if (!wasActive) return true; // già disattivo per questo PID — niente da fare

    const ok = _applyClickThroughSync(pid, false);
    if (ok) {
        console.log(`[WINDOW-BLOCK] ✓ Click-through disattivato (PID ${pid}) — mouse utente sbloccato`);
    }
    return ok;
}

/**
 * Cleanup handler — disabilita click-through su tutte le finestre al termine del processo.
 * Registrare con process.on('exit', cleanupWindowClickThrough).
 */
export function cleanupWindowClickThrough(): void {
    if (_activePids.size > 0) {
        try {
            disableWindowClickThrough();
        } catch {
            // Best effort al cleanup
        }
    }
    if (_reapplyTimer) {
        clearInterval(_reapplyTimer);
        _reapplyTimer = null;
    }
}
