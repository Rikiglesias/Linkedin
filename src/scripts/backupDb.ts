import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { config } from '../config';
import { getDatabase } from '../db';
import { finalizeBackupRun, recordBackupRunStarted } from '../core/repositories';
import { sendTelegramAlert } from '../telemetry/alerts';

const BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');

function ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
}

function checksumSha256(filePath: string): string {
    const hash = createHash('sha256');
    const fileBuffer = fs.readFileSync(filePath);
    hash.update(fileBuffer);
    return hash.digest('hex');
}

function applyRetentionPolicy(): number {
    const retentionDays = config.backupRetentionDays;
    const cutoffMs = retentionDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const files = fs
        .readdirSync(BACKUP_DIR)
        .filter(
            (fileName) => fileName.startsWith('backup-') && (fileName.endsWith('.sqlite') || fileName.endsWith('.sql')),
        )
        .map((fileName) => ({ name: fileName, mtime: fs.statSync(path.join(BACKUP_DIR, fileName)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

    const toDelete = files.slice(1).filter((file) => now - file.mtime > cutoffMs);
    let removed = 0;
    for (const file of toDelete) {
        fs.unlinkSync(path.join(BACKUP_DIR, file.name));
        console.log(`🗑️  [RETENTION] Rimosso backup scaduto: ${file.name}`);
        removed += 1;
    }

    if (removed === 0) {
        console.log(`✅ [RETENTION] Nessun backup da eliminare (policy: ${retentionDays} giorni).`);
    } else {
        console.log(`✅ [RETENTION] Rimossi ${removed} backup scaduti.`);
    }
    return removed;
}

async function runSqliteBackup(timestamp: string): Promise<string> {
    const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}.sqlite`);
    if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
    }
    if (!/^[a-zA-Z0-9_\-. \\/:()\u00C0-\u024F]+$/.test(backupPath)) {
        throw new Error(`Backup path contains invalid characters: ${backupPath}`);
    }
    const safePath = backupPath.replace(/'/g, "''");
    const db = await getDatabase();
    await db.exec(`VACUUM INTO '${safePath}';`);
    console.log(`✅ [SQLite] Backup WAL-safe completato: ${backupPath}`);
    return backupPath;
}

function runPostgresBackup(timestamp: string): string {
    const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}.sql`);
    console.log(`⏳ Avvio backup PostgreSQL in ${backupPath}...`);

    if (config.databaseUrl.includes('@db:')) {
        const output = execFileSync('docker', ['exec', 'linkedin-pg', 'pg_dump', '-U', 'bot_user', '-d', 'linkedin_bot', '--clean']);
        fs.writeFileSync(backupPath, output);
        console.log(`✅ [PostgreSQL - Docker] Backup completato: ${backupPath}`);
    } else {
        const output = execFileSync('pg_dump', ['--dbname', config.databaseUrl, '--clean']);
        fs.writeFileSync(backupPath, output);
        console.log(`✅ [PostgreSQL - Cloud/Local] Backup completato: ${backupPath}`);
    }

    return backupPath;
}

export async function runBackup() {
    ensureBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const startedAtMs = Date.now();
    const isPostgres = config.databaseUrl.startsWith('postgres');
    const backupType = isPostgres ? 'postgres' : 'sqlite';
    const runId = await recordBackupRunStarted(backupType, config.databaseUrl || config.dbPath, {
        retentionDays: config.backupRetentionDays,
    });

    try {
        const backupPath = isPostgres ? runPostgresBackup(timestamp) : await runSqliteBackup(timestamp);
        const checksum = checksumSha256(backupPath);
        const removedCount = applyRetentionPolicy();
        const durationMs = Date.now() - startedAtMs;

        await finalizeBackupRun(runId, 'SUCCEEDED', {
            backupPath,
            checksumSha256: checksum,
            durationMs,
            details: {
                removedByRetention: removedCount,
            },
        });
        console.log(`🔐 SHA256: ${checksum}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await finalizeBackupRun(runId, 'FAILED', {
            durationMs: Date.now() - startedAtMs,
            details: { error: message },
        });
        await sendTelegramAlert(
            `Backup fallito.\nTipo: ${backupType}\nErrore: ${message}`,
            'Backup Failure',
            'critical',
        );
        throw error;
    }
}

// Esegui solo se invocato direttamente come script (non su import)
if (require.main === module) {
    runBackup().catch((error) => {
        console.error('❌ Errore durante il backup DB', error);
        process.exit(1);
    });
}
