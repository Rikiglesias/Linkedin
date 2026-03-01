import { Pool } from 'pg';
import sqlite3 from 'sqlite3';
import { open, Database as SQLiteDatabase } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { ensureFilePrivate, ensureParentDirectoryPrivate } from './security/filesystem';

export interface DBRunResult {
    lastID?: number;
    changes?: number;
}

// ------------------------------------------------------------------
// INTERFACE ASTRAZIONE DB
// ------------------------------------------------------------------
export interface DatabaseManager {
    query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
    get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
    exec(sql: string, params?: unknown[]): Promise<void>;
    run(sql: string, params?: unknown[]): Promise<DBRunResult>;
    close(): Promise<void>;
}

// ------------------------------------------------------------------
// WRAPPER SQLITE
// ------------------------------------------------------------------
class SQLiteManager implements DatabaseManager {
    private db: SQLiteDatabase;

    constructor(db: SQLiteDatabase) {
        this.db = db;
    }

    async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
        return this.db.all<T[]>(sql, params);
    }

    async get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined> {
        return this.db.get<T>(sql, params);
    }

    async exec(sql: string, params?: unknown[]): Promise<void> {
        // execute only multiple statements without params or single with params avoiding conflicts
        if (params && params.length > 0) {
            await this.db.run(sql, params);
        } else {
            await this.db.exec(sql);
        }
    }

    async run(sql: string, params?: unknown[]): Promise<DBRunResult> {
        const result = await this.db.run(sql, params);
        return {
            lastID: result.lastID,
            changes: result.changes
        };
    }

    async close(): Promise<void> {
        await this.db.close();
    }
}

// ------------------------------------------------------------------
// WRAPPER POSTGRES
// ------------------------------------------------------------------
class PostgresManager implements DatabaseManager {
    private pool: Pool;

    constructor(connectionString: string) {
        this.pool = new Pool({ connectionString });
    }

    // Adattatore sintassi: converte i `?` di SQLite in `$1`, `$2` di Postgres
    private adaptParams(sql: string): string {
        let count = 1;
        return sql.replace(/\?/g, () => `$${count++}`);
    }

    async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
        const result = await this.pool.query(this.adaptParams(sql), params);
        return result.rows;
    }

    async get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined> {
        const result = await this.pool.query(this.adaptParams(sql), params);
        return result.rows[0];
    }

    async exec(sql: string, params?: unknown[]): Promise<void> {
        await this.pool.query(this.adaptParams(sql), params);
    }

    async run(sql: string, params?: unknown[]): Promise<DBRunResult> {
        // Se vogliamo fare insert e avere un lastID con postgres dovremmo usare `RETURNING id`
        // Per semplicità logica, mappiamo `rowCount` su changes
        const result = await this.pool.query(this.adaptParams(sql), params);
        return {
            changes: result.rowCount ?? undefined
        };
    }

    async close(): Promise<void> {
        await this.pool.end();
    }
}

// ------------------------------------------------------------------
// ISTANZA E INIZIALIZZAZIONE
// ------------------------------------------------------------------
let dbInstance: DatabaseManager | null = null;
let isPostgres = false;

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

async function ensureColumnPg(database: DatabaseManager, tableName: string, columnName: string, definition: string): Promise<void> {
    const exists = await database.get(
        `SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
        [tableName, columnName]
    );
    if (!exists) {
        // Strip out SQLite specific stuff
        const safeDef = definition.replace(/AUTOINCREMENT/ig, '').trim();
        await database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${safeDef}`);
    }
}

async function ensureColumnSqlite(database: DatabaseManager, tableName: string, columnName: string, definition: string): Promise<void> {
    const columns = await database.query<{ name: string }>(`PRAGMA table_info(${tableName})`);
    const exists = columns.some((column) => column.name === columnName);
    if (!exists) {
        await database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
}

async function applyMigrations(database: DatabaseManager): Promise<void> {

    if (isPostgres) {
        await database.exec(`
            CREATE TABLE IF NOT EXISTS _migrations (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
    } else {
        await database.exec(`
            CREATE TABLE IF NOT EXISTS _migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
    }

    const migrationDir = resolveMigrationDirectory();
    const files = fs
        .readdirSync(migrationDir)
        .filter((file) => file.endsWith('.sql'))
        .sort((a, b) => a.localeCompare(b));

    for (const fileName of files) {
        const alreadyApplied = await database.get<{ count: string | number }>(
            `SELECT COUNT(*) as count FROM _migrations WHERE name = ?`,
            [fileName]
        );

        // Postgres returns count as string (int8)
        const count = Number(alreadyApplied?.count ?? 0);
        if (count > 0) {
            continue;
        }

        let sql = fs.readFileSync(path.join(migrationDir, fileName), 'utf8');

        if (isPostgres) {
            // Semplice traduzione dialetto per file originariamente nati per sqlite
            sql = sql.replace(/DATETIME/ig, 'TIMESTAMP');
            sql = sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/ig, 'SERIAL PRIMARY KEY');
            sql = sql.replace(/IF NOT EXISTS/ig, 'IF NOT EXISTS'); // Valido
        }

        await database.exec('BEGIN');
        try {
            // Per postgres separare gli statement multipli
            if (isPostgres) {
                const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
                for (const stmt of statements) {
                    await database.exec(stmt);
                }
            } else {
                await database.exec(sql);
            }
            await database.run(`INSERT INTO _migrations (name) VALUES (?)`, [fileName]);
            await database.exec('COMMIT');
        } catch (error) {
            await database.exec('ROLLBACK');
            console.error(`Migration error on file ${fileName}`);
            throw error;
        }
    }

    // Hardening (Retrocompatibilità)
    if (isPostgres) {
        await ensureColumnPg(database, 'leads', 'list_name', `TEXT NOT NULL DEFAULT 'default'`);
        await ensureColumnPg(database, 'leads', 'last_site_check_at', 'TIMESTAMP');
        await ensureColumnPg(database, 'leads', 'last_error', 'TEXT');
        await ensureColumnPg(database, 'leads', 'blocked_reason', 'TEXT');
        await ensureColumnPg(database, 'leads', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
        await ensureColumnPg(database, 'lead_lists', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
        await ensureColumnPg(database, 'lead_lists', 'priority', 'INTEGER NOT NULL DEFAULT 100');
        await ensureColumnPg(database, 'lead_lists', 'daily_invite_cap', 'INTEGER');
        await ensureColumnPg(database, 'lead_lists', 'daily_message_cap', 'INTEGER');
        await ensureColumnPg(database, 'daily_stats', 'messages_sent', 'INTEGER NOT NULL DEFAULT 0');
        await ensureColumnPg(database, 'daily_stats', 'challenges_count', 'INTEGER NOT NULL DEFAULT 0');
        await ensureColumnPg(database, 'daily_stats', 'selector_failures', 'INTEGER NOT NULL DEFAULT 0');
        await ensureColumnPg(database, 'daily_stats', 'run_errors', 'INTEGER NOT NULL DEFAULT 0');
        await ensureColumnPg(database, 'jobs', 'account_id', `TEXT NOT NULL DEFAULT 'default'`);

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
        await database.exec(`CREATE INDEX IF NOT EXISTS idx_leads_status_last_site_check ON leads(status, last_site_check_at, created_at);`);
        await database.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_type_status_next_run ON jobs(type, status, next_run_at, priority, created_at);`);
        await database.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_account_status_next_run ON jobs(account_id, status, next_run_at, priority, created_at);`);

        await database.exec(`
            CREATE TABLE IF NOT EXISTS company_targets (
                id SERIAL PRIMARY KEY,
                list_name TEXT NOT NULL,
                account_name TEXT NOT NULL DEFAULT '',
                website TEXT NOT NULL DEFAULT '',
                source_file TEXT,
                status TEXT NOT NULL DEFAULT 'NEW',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await ensureColumnPg(database, 'company_targets', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
        await ensureColumnPg(database, 'company_targets', 'last_error', 'TEXT');
        await ensureColumnPg(database, 'company_targets', 'processed_at', 'TIMESTAMP');
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
                acquired_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                heartbeat_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await database.exec(`CREATE INDEX IF NOT EXISTS idx_runtime_locks_expires_at ON runtime_locks(expires_at);`);
    } else {
        await ensureColumnSqlite(database, 'leads', 'list_name', `TEXT NOT NULL DEFAULT 'default'`);
        await ensureColumnSqlite(database, 'leads', 'last_site_check_at', 'DATETIME');
        await ensureColumnSqlite(database, 'leads', 'last_error', 'TEXT');
        await ensureColumnSqlite(database, 'leads', 'blocked_reason', 'TEXT');
        await ensureColumnSqlite(database, 'leads', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
        await ensureColumnSqlite(database, 'lead_lists', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
        await ensureColumnSqlite(database, 'lead_lists', 'priority', 'INTEGER NOT NULL DEFAULT 100');
        await ensureColumnSqlite(database, 'lead_lists', 'daily_invite_cap', 'INTEGER');
        await ensureColumnSqlite(database, 'lead_lists', 'daily_message_cap', 'INTEGER');
        await ensureColumnSqlite(database, 'daily_stats', 'messages_sent', 'INTEGER NOT NULL DEFAULT 0');
        await ensureColumnSqlite(database, 'daily_stats', 'challenges_count', 'INTEGER NOT NULL DEFAULT 0');
        await ensureColumnSqlite(database, 'daily_stats', 'selector_failures', 'INTEGER NOT NULL DEFAULT 0');
        await ensureColumnSqlite(database, 'daily_stats', 'run_errors', 'INTEGER NOT NULL DEFAULT 0');
        await ensureColumnSqlite(database, 'jobs', 'account_id', `TEXT NOT NULL DEFAULT 'default'`);
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
        await database.exec(`CREATE INDEX IF NOT EXISTS idx_leads_status_last_site_check ON leads(status, last_site_check_at, created_at);`);
        await database.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_type_status_next_run ON jobs(type, status, next_run_at, priority, created_at);`);
        await database.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_account_status_next_run ON jobs(account_id, status, next_run_at, priority, created_at);`);
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
        await ensureColumnSqlite(database, 'company_targets', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
        await ensureColumnSqlite(database, 'company_targets', 'last_error', 'TEXT');
        await ensureColumnSqlite(database, 'company_targets', 'processed_at', 'DATETIME');
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
}

export async function getDatabase(): Promise<DatabaseManager> {
    if (dbInstance) return dbInstance;

    // Controlla se abbiamo il DATABASE_URL configurato (Postgres)
    if (config.databaseUrl && config.databaseUrl.startsWith('postgres')) {
        isPostgres = true;

        console.log(`📡 Connecting to PostgreSQL database...`);
        dbInstance = new PostgresManager(config.databaseUrl);

        // Verifica la connessione
        try {
            await dbInstance.query('SELECT 1');
        } catch (error) {
            console.error('❌ Failed to connect to PostgreSQL:', error);
            throw error;
        }

        return dbInstance;
    }

    // Default to SQLite
    if (process.env.NODE_ENV === 'production' && !config.allowSqliteInProduction) {
        throw new Error(
            'SQLite in produzione bloccato. Fornisci un DATABASE_URL (PostgreSQL) oppure imposta ALLOW_SQLITE_IN_PRODUCTION=true esplicitamente.'
        );
    }

    isPostgres = false;
    ensureParentDirectoryPrivate(config.dbPath);

    const sqliteDb = await open({
        filename: config.dbPath,
        driver: sqlite3.Database,
    });

    await sqliteDb.exec(`PRAGMA journal_mode = WAL;`);
    await sqliteDb.exec(`PRAGMA busy_timeout = 5000;`);
    await sqliteDb.exec(`PRAGMA synchronous = NORMAL;`);
    ensureFilePrivate(config.dbPath);

    dbInstance = new SQLiteManager(sqliteDb);
    return dbInstance;
}

export async function initDatabase(): Promise<void> {
    const database = await getDatabase();
    await applyMigrations(database);
}

export async function closeDatabase(): Promise<void> {
    if (dbInstance) {
        await dbInstance.close();
        dbInstance = null;
    }
}

export async function backupDatabase(): Promise<string> {
    if (isPostgres) {
        // I backup in postgres devono essere affidati a un container esterno o un servizio gestito (pg_dump)
        // Per ora facciamo return silenzioso per mantenere la compatibilità dell'interfaccia.
        return 'PostgreSQL backup must be handled by infrastructure (e.g. pg_dump script in cron)';
    }

    const database = await getDatabase();
    const parsedPath = path.parse(config.dbPath);
    const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const backupPath = path.join(parsedPath.dir, `${parsedPath.name}_backup_${dateStr}${parsedPath.ext}`);

    if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
    }

    ensureParentDirectoryPrivate(backupPath);
    const safePath = backupPath.replace(/'/g, "''");

    await database.exec(`VACUUM INTO '${safePath}';`);
    ensureFilePrivate(backupPath);

    return backupPath;
}
