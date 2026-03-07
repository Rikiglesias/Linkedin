import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

function chmodSafe(targetPath: string, mode: number): void {
    if (process.platform === 'win32') {
        try {
            const username = process.env.USERNAME ?? process.env.USER ?? '';
            if (username) {
                execFileSync('icacls', [targetPath, '/inheritance:r', '/grant:r', `${username}:F`], { stdio: 'ignore' });
            }
        } catch {
            // Best effort on Windows
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
