import fs from 'fs';
import path from 'path';

let _windowsAclWarned = false;

function chmodSafe(targetPath: string, mode: number): void {
    if (process.platform === 'win32') {
        // On Windows, only grant permissions — never strip inheritance.
        // Stripping inheritance (/inheritance:r) combined with a wrong username
        // leaves files with ZERO ACLs, making them unreadable. -> hardening NO-OP qui.
        // Avvisa UNA volta: l'operatore deve sapere che DB/backup/sessioni non hanno ACL su Windows.
        if (!_windowsAclWarned) {
            _windowsAclWarned = true;
            console.warn(
                '[SECURITY] Hardening permessi file non applicato su Windows (ACL no-op). ' +
                    'In produzione usare Docker/Linux o configurare ACL via icacls/DPAPI.',
            );
        }
        return;
    }
    try {
        fs.chmodSync(targetPath, mode);
    } catch {
        // Best effort: non bloccare runtime in caso di FS non compatibile.
    }
}

export function ensureDirectoryPrivate(directoryPath: string): void {
    if (!fs.existsSync(directoryPath)) {
        fs.mkdirSync(directoryPath, { recursive: true });
    }
    chmodSafe(directoryPath, 0o700);
}

export function ensureParentDirectoryPrivate(filePath: string): void {
    const directoryPath = path.dirname(filePath);
    ensureDirectoryPrivate(directoryPath);
}

export function ensureFilePrivate(filePath: string): void {
    if (!fs.existsSync(filePath)) {
        return;
    }
    chmodSafe(filePath, 0o600);
}
