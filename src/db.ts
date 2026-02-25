import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { ensureFilePrivate, ensureParentDirectoryPrivate } from './security/filesystem';

let db: Database | null = null;

function resolveMigrationDirectory(): string {
    const cwdMigrations = path.resolve(process.cwd(), 'src', 'db', 'migrations');
    if (fs.existsSync(cwdMigrations)) {
        return cwdMigrations;
    }
    const compiledMigrations = path.resolve(__dirname, 'db', 'migrations');
    if (fs.existsSync(compiledMigrations)) {
        return compiledMigrations;
    }
    throw new Error('Cartella migrazioni non trovata.');
}

async function ensureColumn(database: Database, tableName: string, columnName: string, definition: string): Promise<void> {
    const columns = await database.all<{ name: string }[]>(`PRAGMA table_info(${tableName})`);
    const exists = columns.some((column) => column.name === columnName);
    if (!exists) {
        await database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
}

async function applyMigrations(database: Database): Promise<void> {
    await database.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    const migrationDir = resolveMigrationDirectory();
    const files = fs
        .readdirSync(migrationDir)
        .filter((file) => file.endsWith('.sql'))
        .sort((a, b) => a.localeCompare(b));

    for (const fileName of files) {
        const alreadyApplied = await database.get<{ count: number }>(
            `SELECT COUNT(*) as count FROM _migrations WHERE name = ?`,
            [fileName]
        );
        if ((alreadyApplied?.count ?? 0) > 0) {
            continue;
        }

        const sql = fs.readFileSync(path.join(migrationDir, fileName), 'utf8');
        await database.exec('BEGIN');
        try {
            await database.exec(sql);
            await database.run(`INSERT INTO _migrations (name) VALUES (?)`, [fileName]);
            await database.exec('COMMIT');
        } catch (error) {
            await database.exec('ROLLBACK');
            throw error;
        }
    }

    // Hardening per DB già esistenti creati prima del sistema migrazioni.
    await ensureColumn(database, 'leads', 'list_name', `TEXT NOT NULL DEFAULT 'default'`);
    await ensureColumn(database, 'leads', 'last_error', 'TEXT');
    await ensureColumn(database, 'leads', 'blocked_reason', 'TEXT');
    await ensureColumn(database, 'leads', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
    await ensureColumn(database, 'lead_lists', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
    await ensureColumn(database, 'lead_lists', 'priority', 'INTEGER NOT NULL DEFAULT 100');
    await ensureColumn(database, 'lead_lists', 'daily_invite_cap', 'INTEGER');
    await ensureColumn(database, 'lead_lists', 'daily_message_cap', 'INTEGER');
    await ensureColumn(database, 'daily_stats', 'messages_sent', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(database, 'daily_stats', 'challenges_count', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(database, 'daily_stats', 'selector_failures', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(database, 'daily_stats', 'run_errors', 'INTEGER NOT NULL DEFAULT 0');
    await database.exec(`
        CREATE TABLE IF NOT EXISTS list_daily_stats (
            date TEXT NOT NULL,
            list_name TEXT NOT NULL,
            invites_sent INTEGER NOT NULL DEFAULT 0,
            messages_sent INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (date, list_name)
        );
    `);
    await database.exec(`CREATE INDEX IF NOT EXISTS idx_list_daily_stats_list_date ON list_daily_stats(list_name, date);`);
    await database.exec(`CREATE INDEX IF NOT EXISTS idx_leads_status_list_created ON leads(status, list_name, created_at);`);
    await database.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_type_status_next_run ON jobs(type, status, next_run_at, priority, created_at);`);
    await database.exec(`
        CREATE TABLE IF NOT EXISTS company_targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            list_name TEXT NOT NULL,
            account_name TEXT NOT NULL DEFAULT '',
            website TEXT NOT NULL DEFAULT '',
            source_file TEXT,
            status TEXT NOT NULL DEFAULT 'NEW',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    await ensureColumn(database, 'company_targets', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(database, 'company_targets', 'last_error', 'TEXT');
    await ensureColumn(database, 'company_targets', 'processed_at', 'DATETIME');
    await database.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_company_targets_list_account_website
            ON company_targets(list_name, account_name, website);
    `);
    await database.exec(`
        CREATE INDEX IF NOT EXISTS idx_company_targets_list_status
            ON company_targets(list_name, status, created_at);
    `);
    await database.exec(`
        CREATE TABLE IF NOT EXISTS runtime_locks (
            lock_key TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL,
            acquired_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            heartbeat_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);
    await database.exec(`CREATE INDEX IF NOT EXISTS idx_runtime_locks_expires_at ON runtime_locks(expires_at);`);
}

export async function getDatabase(): Promise<Database> {
    if (db) return db;

    ensureParentDirectoryPrivate(config.dbPath);

    db = await open({
        filename: config.dbPath,
        driver: sqlite3.Database,
    });

    await db.exec(`PRAGMA journal_mode = WAL;`);
    await db.exec(`PRAGMA busy_timeout = 5000;`);
    await db.exec(`PRAGMA synchronous = NORMAL;`);
    ensureFilePrivate(config.dbPath);

    return db;
}

export async function initDatabase(): Promise<void> {
    const database = await getDatabase();
    await applyMigrations(database);
}

export async function closeDatabase(): Promise<void> {
    if (db) {
        await db.close();
        db = null;
    }
}
