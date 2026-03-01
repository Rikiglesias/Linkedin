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

    private normalizeSql(sql: string): string {
        let normalized = this.adaptParams(sql);

        normalized = normalized.replace(
            /strftime\('%Y-%m-%dT%H:%M:%f',\s*'now'\)/gi,
            `TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS.MS')`
        );
        normalized = normalized.replace(/\bDATETIME\('now'\)/gi, 'CURRENT_TIMESTAMP');
        normalized = normalized.replace(/\bDATE\('now'\)/gi, 'CURRENT_DATE');

        normalized = normalized.replace(
            /\bDATETIME\('now',\s*'([+-])\s*(\d+)\s*(seconds?|minutes?|hours?|days?)'\s*\)/gi,
            (_match, sign: string, amount: string, unit: string) => {
                const op = sign === '+' ? '+' : '-';
                return `CURRENT_TIMESTAMP ${op} INTERVAL '${amount} ${unit.toLowerCase()}'`;
            }
        );
        normalized = normalized.replace(
            /\bDATE\('now',\s*'([+-])\s*(\d+)\s*(days?)'\s*\)/gi,
            (_match, sign: string, amount: string, unit: string) => {
                const op = sign === '+' ? '+' : '-';
                return `CURRENT_DATE ${op} INTERVAL '${amount} ${unit.toLowerCase()}'`;
            }
        );
        normalized = normalized.replace(
            /\bDATETIME\('now',\s*'([+-])'\s*\|\|\s*(\$\d+)\s*\|\|\s*'\s*(seconds?|minutes?|hours?|days?)'\s*\)/gi,
            (_match, sign: string, paramRef: string, unit: string) => {
                const op = sign === '+' ? '+' : '-';
                return `CURRENT_TIMESTAMP ${op} ((${paramRef} || ' ${unit.toLowerCase()}')::interval)`;
            }
        );

        const hadInsertOrIgnore = /\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(normalized);
        normalized = normalized.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO');
        if (hadInsertOrIgnore && !/\bON\s+CONFLICT\b/i.test(normalized)) {
            normalized = normalized.replace(/;\s*$/, '');
            normalized = `${normalized} ON CONFLICT DO NOTHING`;
        }

        return normalized;
    }

    async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
        const result = await this.pool.query(this.normalizeSql(sql), params);
        return result.rows;
    }

    async get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined> {
        const result = await this.pool.query(this.normalizeSql(sql), params);
        return result.rows[0];
    }

    async exec(sql: string, params?: unknown[]): Promise<void> {
        await this.pool.query(this.normalizeSql(sql), params);
    }

    async run(sql: string, params?: unknown[]): Promise<DBRunResult> {
        // Se vogliamo fare insert e avere un lastID con postgres dovremmo usare `RETURNING id`
        // Per semplicità logica, mappiamo `rowCount` su changes
        const result = await this.pool.query(this.normalizeSql(sql), params);
        const row = (result.rows[0] ?? {}) as Record<string, unknown>;
        const rowId = row.id;
        const parsedLastId = typeof rowId === 'number'
            ? rowId
            : (typeof rowId === 'string' && /^[0-9]+$/.test(rowId) ? Number.parseInt(rowId, 10) : undefined);
        return {
            lastID: parsedLastId,
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
            sql = sql.replace(/\bDATETIME\b(?!\s*\()/ig, 'TIMESTAMP');
            sql = sql.replace(/datetime\('now'\)/ig, 'CURRENT_TIMESTAMP');
            sql = sql.replace(/strftime\('%Y-%m-%dT%H:%M:%f',\s*'now'\)/ig, 'CURRENT_TIMESTAMP');
            sql = sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/ig, 'SERIAL PRIMARY KEY');
        }

        await database.exec('BEGIN');
        try {
            // Eseguiamo il file SQL intero: evita parser naive su ';'
            // che rompe blocchi complessi (es. funzioni/DO blocks in Postgres).
            await database.exec(sql);
            await database.run(`INSERT OR IGNORE INTO _migrations (name) VALUES (?)`, [fileName]);
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
        await ensureColumnPg(database, 'lead_intents', 'entities_json', 'TEXT');

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
        await database.exec(`
            CREATE TABLE IF NOT EXISTS ab_variant_stats_segment (
                segment_key TEXT NOT NULL,
                variant_id TEXT NOT NULL,
                sent INTEGER NOT NULL DEFAULT 0,
                accepted INTEGER NOT NULL DEFAULT 0,
                replied INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (segment_key, variant_id)
            );
        `);
        await database.exec(`
            CREATE TABLE IF NOT EXISTS dynamic_selectors (
                id SERIAL PRIMARY KEY,
                action_label TEXT NOT NULL,
                selector TEXT NOT NULL,
                confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
                source TEXT NOT NULL DEFAULT 'learner',
                active INTEGER NOT NULL DEFAULT 1,
                success_count INTEGER NOT NULL DEFAULT 0,
                last_validated_at TIMESTAMP,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(action_label, selector)
            );
        `);
        await database.exec(`
            CREATE TABLE IF NOT EXISTS selector_failures (
                id SERIAL PRIMARY KEY,
                action_label TEXT NOT NULL,
                url TEXT NOT NULL,
                selectors_json TEXT NOT NULL,
                error_message TEXT,
                occurrences INTEGER NOT NULL DEFAULT 1,
                first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                resolved_at TIMESTAMP,
                status TEXT NOT NULL DEFAULT 'OPEN',
                UNIQUE(action_label, url)
            );
        `);
        await database.exec(`
            CREATE TABLE IF NOT EXISTS selector_fallbacks (
                id SERIAL PRIMARY KEY,
                action_label TEXT NOT NULL,
                selector TEXT NOT NULL,
                url TEXT,
                success_count INTEGER NOT NULL DEFAULT 1,
                last_success_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(action_label, selector)
            );
        `);
        await database.exec(`
            CREATE TABLE IF NOT EXISTS list_rampup_state (
                list_name TEXT PRIMARY KEY,
                last_run_date TEXT,
                current_invite_cap INTEGER NOT NULL DEFAULT 0,
                current_message_cap INTEGER NOT NULL DEFAULT 0,
                daily_increase DOUBLE PRECISION NOT NULL DEFAULT 0.05,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        `);
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
        await ensureColumnSqlite(database, 'lead_intents', 'entities_json', 'TEXT');
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
        await database.exec(`
            CREATE TABLE IF NOT EXISTS ab_variant_stats_segment (
                segment_key TEXT NOT NULL,
                variant_id TEXT NOT NULL,
                sent INTEGER NOT NULL DEFAULT 0,
                accepted INTEGER NOT NULL DEFAULT 0,
                replied INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (segment_key, variant_id)
            );
        `);
        await database.exec(`
            CREATE TABLE IF NOT EXISTS dynamic_selectors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_label TEXT NOT NULL,
                selector TEXT NOT NULL,
                confidence REAL NOT NULL DEFAULT 0.5,
                source TEXT NOT NULL DEFAULT 'learner',
                active INTEGER NOT NULL DEFAULT 1,
                success_count INTEGER NOT NULL DEFAULT 0,
                last_validated_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(action_label, selector)
            );
        `);
        await database.exec(`
            CREATE TABLE IF NOT EXISTS selector_failures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_label TEXT NOT NULL,
                url TEXT NOT NULL,
                selectors_json TEXT NOT NULL,
                error_message TEXT,
                occurrences INTEGER NOT NULL DEFAULT 1,
                first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
                last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
                resolved_at TEXT,
                status TEXT NOT NULL DEFAULT 'OPEN',
                UNIQUE(action_label, url)
            );
        `);
        await database.exec(`
            CREATE TABLE IF NOT EXISTS selector_fallbacks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_label TEXT NOT NULL,
                selector TEXT NOT NULL,
                url TEXT,
                success_count INTEGER NOT NULL DEFAULT 1,
                last_success_at TEXT NOT NULL DEFAULT (datetime('now')),
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(action_label, selector)
            );
        `);
        await database.exec(`
            CREATE TABLE IF NOT EXISTS list_rampup_state (
                list_name TEXT PRIMARY KEY,
                last_run_date TEXT,
                current_invite_cap INTEGER NOT NULL DEFAULT 0,
                current_message_cap INTEGER NOT NULL DEFAULT 0,
                daily_increase REAL NOT NULL DEFAULT 0.05,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
        `);
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
