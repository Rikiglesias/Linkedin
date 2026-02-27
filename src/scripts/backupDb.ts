import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { config } from '../config';

const BACKUP_DIR = path.join(process.cwd(), 'data', 'backups');

function ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
}

/**
 * Applica la retention policy: elimina i backup più vecchi di BACKUP_RETENTION_DAYS.
 * Mantiene sempre almeno 1 backup indipendentemente dall'età.
 */
function applyRetentionPolicy(): void {
    const retentionDays = config.backupRetentionDays;
    const cutoffMs = retentionDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('backup-') && (f.endsWith('.sqlite') || f.endsWith('.sql')))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime); // più recente prima

    // Mantieni almeno 1 backup
    const toDelete = files.slice(1).filter(file => now - file.mtime > cutoffMs);

    let removed = 0;
    for (const file of toDelete) {
        fs.unlinkSync(path.join(BACKUP_DIR, file.name));
        console.log(`🗑️  [RETENTION] Rimosso backup scaduto: ${file.name}`);
        removed++;
    }

    if (removed === 0) {
        console.log(`✅ [RETENTION] Nessun backup da eliminare (policy: ${retentionDays} giorni).`);
    } else {
        console.log(`✅ [RETENTION] Rimossi ${removed} backup scaduti.`);
    }
}

export async function runBackup() {
    ensureBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // SQLite
    if (!config.databaseUrl || config.databaseUrl.startsWith('file:') || config.databaseUrl.includes('.sqlite')) {
        const dbPath = config.databaseUrl ? config.databaseUrl.replace('file:', '') : path.join(process.cwd(), 'data', 'db.sqlite');
        const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}.sqlite`);
        fs.copyFileSync(dbPath, backupPath);
        console.log(`✅ [SQLite] Backup completato: ${backupPath}`);
        applyRetentionPolicy();
        return;
    }

    // PostgreSQL
    if (config.databaseUrl.startsWith('postgres')) {
        const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}.sql`);
        console.log(`⏳ Avvio backup PostgreSQL in ${backupPath}...`);

        try {
            if (config.databaseUrl.includes('@db:')) {
                const command = `docker exec linkedin-pg pg_dump -U bot_user -d linkedin_bot --clean > "${backupPath}"`;
                execSync(command, { stdio: 'inherit' });
                console.log(`✅ [PostgreSQL - Docker] Backup completato: ${backupPath}`);
            } else {
                const command = `pg_dump "${config.databaseUrl}" --clean > "${backupPath}"`;
                execSync(command, { stdio: 'inherit' });
                console.log(`✅ [PostgreSQL - Cloud/Local] Backup completato: ${backupPath}`);
            }
        } catch (err) {
            console.error('❌ Errore durante il backup Postgres. Assicurati che pg_dump o Docker siano installati e raggiungibili.');
            console.error(err);
            process.exit(1);
        }

        applyRetentionPolicy();
    }
}

runBackup().catch(console.error);
