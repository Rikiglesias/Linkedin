import { describe, it, expect } from 'vitest';
import { buildPowerShellScript } from '../browser/windowInputBlock';

// [WINDOW-BLOCK] fix (2026-06-09): lo script PowerShell contiene un here-string C# (Add-Type @"..."@)
// con virgolette interne. Va passato via -EncodedCommand (base64 UTF-16LE), NON via -Command "..."
// inline con escaping (che rompeva sia l'here-string sia il C# → click-through non applicato →
// mouse utente non bloccato sul 2° monitor). Questi test blindano: (a) lo script resta ben formato,
// (b) l'encoding UTF-16LE round-trippa senza corrompere lo script.

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
