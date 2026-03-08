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
export interface RunOptions {
    returning?: boolean;
}

export interface DatabaseManager {
    readonly isPostgres: boolean;
    query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
    get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
    exec(sql: string, params?: unknown[]): Promise<void>;
    run(sql: string, params?: unknown[], options?: RunOptions): Promise<DBRunResult>;
    close(): Promise<void>;
}

// ------------------------------------------------------------------
// WRAPPER SQLITE
// ------------------------------------------------------------------
class SQLiteManager implements DatabaseManager {
    readonly isPostgres = false;
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

    async run(sql: string, params?: unknown[], _options?: RunOptions): Promise<DBRunResult> {
        const result = await this.db.run(sql, params);
        return {
            lastID: result.lastID,
            changes: result.changes,
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
    readonly isPostgres = true;
    private pool: Pool;

    constructor(connectionString: string) {
        this.pool = new Pool({
            connectionString,
            max: 10,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
        });
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
            `TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS.MS')`,
        );
        normalized = normalized.replace(/\bDATETIME\('now'\)/gi, 'CURRENT_TIMESTAMP');
        normalized = normalized.replace(/\bDATE\('now'\)/gi, 'CURRENT_DATE');

        normalized = normalized.replace(
            /\bDATETIME\('now',\s*'([+-])\s*(\d+)\s*(seconds?|minutes?|hours?|days?)'\s*\)/gi,
            (_match, sign: string, amount: string, unit: string) => {
                const op = sign === '+' ? '+' : '-';
                return `CURRENT_TIMESTAMP ${op} INTERVAL '${amount} ${unit.toLowerCase()}'`;
            },
        );
        normalized = normalized.replace(
            /\bDATE\('now',\s*'([+-])\s*(\d+)\s*(days?)'\s*\)/gi,
            (_match, sign: string, amount: string, unit: string) => {
                const op = sign === '+' ? '+' : '-';
                return `CURRENT_DATE ${op} INTERVAL '${amount} ${unit.toLowerCase()}'`;
            },
        );
        normalized = normalized.replace(
            /\bDATETIME\('now',\s*'([+-])'\s*\|\|\s*(\$\d+)\s*\|\|\s*'\s*(seconds?|minutes?|hours?|days?)'\s*\)/gi,
            (_match, sign: string, paramRef: string, unit: string) => {
                const op = sign === '+' ? '+' : '-';
                return `CURRENT_TIMESTAMP ${op} ((${paramRef} || ' ${unit.toLowerCase()}')::interval)`;
            },
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

    async run(sql: string, params?: unknown[], options?: RunOptions): Promise<DBRunResult> {
        let normalizedSql = this.normalizeSql(sql);

        const shouldReturn = options?.returning !== false;
        const isInsert = /^\s*INSERT\b/i.test(normalizedSql);
        const hasReturning = /\bRETURNING\b/i.test(normalizedSql);
        if (shouldReturn && isInsert && !hasReturning) {
            normalizedSql = normalizedSql.replace(/;\s*$/, '') + ' RETURNING id';
        }

        const result = await this.pool.query(normalizedSql, params);
        const row = (result.rows[0] ?? {}) as Record<string, unknown>;
        const rowId = row.id;
        const parsedLastId =
            typeof rowId === 'number'
                ? rowId
                : typeof rowId === 'string' && /^[0-9]+$/.test(rowId)
                  ? Number.parseInt(rowId, 10)
                  : undefined;
        return {
            lastID: parsedLastId,
            changes: result.rowCount ?? undefined,
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

async function ensureColumnPg(
    database: DatabaseManager,
    tableName: string,
    columnName: string,
    definition: string,
): Promise<void> {
    const exists = await database.get(
        `SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
        [tableName, columnName],
    );
    if (!exists) {
        // Strip out SQLite specific stuff
        const safeDef = definition.replace(/AUTOINCREMENT/gi, '').trim();
        await database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${safeDef}`);
    }
}

async function ensureColumnSqlite(
    database: DatabaseManager,
    tableName: string,
    columnName: string,
    definition: string,
): Promise<void> {
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

    // Load all already-applied migrations in a single query instead of one per file.
    const appliedRows = await database.query<{ name: string }>(`SELECT name FROM _migrations`);
    const applied = new Set(appliedRows.map((row) => row.name));

    for (const fileName of files) {
        if (applied.has(fileName)) {
            continue;
        }

        let sql = fs.readFileSync(path.join(migrationDir, fileName), 'utf8');

        if (isPostgres) {
            // Semplice traduzione dialetto per file originariamente nati per sqlite
            sql = sql.replace(/\bDATETIME\b(?!\s*\()/gi, 'TIMESTAMP');
            sql = sql.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
            sql = sql.replace(/strftime\('%Y-%m-%dT%H:%M:%f',\s*'now'\)/gi, 'CURRENT_TIMESTAMP');
            sql = sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
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

    // Hardening (Retrocompatibilità) — colonne aggiunte su tabelle esistenti.
    // Le tabelle (list_daily_stats, company_targets, runtime_locks, etc.) sono
    // ora create dalla migration 041_hardening_tables.sql.
    // Le colonne di hardening restano qui perché ensureColumn* è idempotente
    // e gestisce il dialetto SQLite/Postgres in modo diverso.
    const ensureColumn = isPostgres ? ensureColumnPg : ensureColumnSqlite;
    const ts = isPostgres ? 'TIMESTAMP' : 'DATETIME';

    await ensureColumn(database, 'leads', 'list_name', `TEXT NOT NULL DEFAULT 'default'`);
    await ensureColumn(database, 'leads', 'lead_metadata', `TEXT NOT NULL DEFAULT '{}'`);
    await ensureColumn(database, 'leads', 'last_site_check_at', ts);
    await ensureColumn(database, 'leads', 'last_error', 'TEXT');
    await ensureColumn(database, 'leads', 'blocked_reason', 'TEXT');
    await ensureColumn(database, 'leads', 'updated_at', `${ts} DEFAULT CURRENT_TIMESTAMP`);
    await ensureColumn(database, 'lead_lists', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
    await ensureColumn(database, 'lead_lists', 'priority', 'INTEGER NOT NULL DEFAULT 100');
    await ensureColumn(database, 'lead_lists', 'daily_invite_cap', 'INTEGER');
    await ensureColumn(database, 'lead_lists', 'daily_message_cap', 'INTEGER');
    await ensureColumn(database, 'lead_lists', 'scoring_criteria', 'TEXT');
    await ensureColumn(database, 'leads', 'consent_basis', `TEXT DEFAULT 'legitimate_interest'`);
    await ensureColumn(database, 'leads', 'consent_recorded_at', ts);
    await ensureColumn(database, 'leads', 'gdpr_opt_out', 'INTEGER DEFAULT 0');
    await ensureColumn(database, 'daily_stats', 'messages_sent', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(database, 'daily_stats', 'challenges_count', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(database, 'daily_stats', 'selector_failures', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(database, 'daily_stats', 'run_errors', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(database, 'jobs', 'account_id', `TEXT NOT NULL DEFAULT 'default'`);
    await ensureColumn(database, 'lead_intents', 'entities_json', 'TEXT');
    await ensureColumn(database, 'company_targets', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumn(database, 'company_targets', 'last_error', 'TEXT');
    await ensureColumn(database, 'company_targets', 'processed_at', ts);
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
            'SQLite in produzione bloccato. Fornisci un DATABASE_URL (PostgreSQL) oppure imposta ALLOW_SQLITE_IN_PRODUCTION=true esplicitamente.',
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

    // Validate backup path to prevent SQL injection via path characters.
    if (!/^[a-zA-Z0-9_\-. \\/:()\u00C0-\u024F]+$/.test(backupPath)) {
        throw new Error(`Backup path contains invalid characters: ${backupPath}`);
    }
    const safePath = backupPath.replace(/'/g, "''");

    await database.exec(`VACUUM INTO '${safePath}';`);
    ensureFilePrivate(backupPath);

    return backupPath;
}
