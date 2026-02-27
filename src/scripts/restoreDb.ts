import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { config } from '../config';

export async function runRestore() {
    const args = process.argv.slice(2);
    const backupFile = args[0];

    if (!backupFile) {
        console.error('❌ Devi specificare il file di backup da ripristinare. Esempio: npm run db:restore data/backups/backup-123.sql');
        process.exit(1);
    }

    const backupPath = path.resolve(backupFile);
    if (!fs.existsSync(backupPath)) {
        console.error(`❌ Il file di backup non esiste: ${backupPath}`);
        process.exit(1);
    }

    // SQLite
    if (!config.databaseUrl || config.databaseUrl.startsWith('file:') || config.databaseUrl.includes('.sqlite')) {
        if (!backupFile.endsWith('.sqlite')) {
            console.error('❌ Stai usando SQLite ma stai provando a ripristinare un dump non-sqlite.');
            process.exit(1);
        }
        const dbPath = config.databaseUrl ? config.databaseUrl.replace('file:', '') : path.join(process.cwd(), 'data', 'db.sqlite');
        fs.copyFileSync(backupPath, dbPath);
        console.log(`✅ [SQLite] Restore completato con successo da: ${backupPath}`);
        return;
    }

    // PostgreSQL
    if (config.databaseUrl.startsWith('postgres')) {
        if (!backupFile.endsWith('.sql')) {
            console.error('❌ Stai usando Postgres ma stai provando a ripristinare un file non-sql.');
            process.exit(1);
        }

        console.log(`⏳ Avvio restore in PostgreSQL da ${backupPath}...`);

        try {
            if (config.databaseUrl.includes('@db:')) {
                // Docker expects file inside container, so we cat and pipe it:
                // Note: pipe behavior in command string works if it's evaluated by local shell
                // We use Windows/Powershell compatible < redirection
                const command = `docker exec -i linkedin-pg psql -U bot_user -d linkedin_bot < "${backupPath}"`;
                execSync(command, { stdio: 'inherit' });
                console.log(`✅ [PostgreSQL - Docker] Restore completato.`);
            } else {
                const command = `psql "${config.databaseUrl}" < "${backupPath}"`;
                execSync(command, { stdio: 'inherit' });
                console.log(`✅ [PostgreSQL - Cloud/Local] Restore completato.`);
            }
        } catch (err) {
            console.error('❌ Errore durante il restore Postgres.');
            console.error(err);
            process.exit(1);
        }
    }
}

runRestore().catch(console.error);
