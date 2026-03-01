import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { config } from '../config';
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

    const files = fs.readdirSync(BACKUP_DIR)
        .filter((fileName) => fileName.startsWith('backup-') && (fileName.endsWith('.sqlite') || fileName.endsWith('.sql')))
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

function runSqliteBackup(timestamp: string): string {
    const dbPath = config.databaseUrl
        ? config.databaseUrl.replace('file:', '')
        : path.join(process.cwd(), 'data', 'db.sqlite');
    const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}.sqlite`);
    fs.copyFileSync(dbPath, backupPath);
    console.log(`✅ [SQLite] Backup completato: ${backupPath}`);
    return backupPath;
}

function runPostgresBackup(timestamp: string): string {
    const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}.sql`);
    console.log(`⏳ Avvio backup PostgreSQL in ${backupPath}...`);

    if (config.databaseUrl.includes('@db:')) {
        const command = `docker exec linkedin-pg pg_dump -U bot_user -d linkedin_bot --clean > "${backupPath}"`;
        execSync(command, { stdio: 'inherit' });
        console.log(`✅ [PostgreSQL - Docker] Backup completato: ${backupPath}`);
    } else {
        const command = `pg_dump "${config.databaseUrl}" --clean > "${backupPath}"`;
        execSync(command, { stdio: 'inherit' });
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
        const backupPath = isPostgres
            ? runPostgresBackup(timestamp)
            : runSqliteBackup(timestamp);
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
            'critical'
        );
        throw error;
    }
}

runBackup().catch((error) => {
    console.error('❌ Errore durante il backup DB', error);
    process.exit(1);
});

