/**
 * browser/windowInputBlockScript.ts
 * Generazione dello script PowerShell + interop C#/Win32 per il click-through (WS_EX_TRANSPARENT).
 * Estratto da windowInputBlock.ts (SRP + soglia 300 righe): qui SOLO il template Win32;
 * lì l'orchestrazione (stato multi-PID, timer di re-apply, enable/disable).
 */

/**
 * PowerShell script template per settare/rimuovere WS_EX_TRANSPARENT sulla finestra del browser.
 * - WS_EX_LAYERED (0x80000): prerequisito per WS_EX_TRANSPARENT su top-level window
 * - WS_EX_TRANSPARENT (0x20): rende la finestra invisibile al mouse (click-through)
 * - SetLayeredWindowAttributes con alpha=255: finestra resta 100% visibile
 *
 * IMPORTANTE: Applica a TUTTE le finestre visibili del processo (EnumThreadWindows),
 * non solo a MainWindowHandle. Firefox/Camoufox ha finestre child separate
 * (content area, chrome) che ricevono eventi mouse indipendentemente.
 *
 * @internal Esportata anche per il test del fix [WINDOW-BLOCK] (here-string + encoding).
 */
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
