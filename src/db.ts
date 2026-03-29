import { Pool, PoolClient } from 'pg';
import sqlite3 from 'sqlite3';
import { open, Database as SQLiteDatabase } from 'sqlite';
import { AsyncLocalStorage } from 'async_hooks';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { config } from './config';
import { ensureFilePrivate, ensureParentDirectoryPrivate } from './security/filesystem';

// ─── Transaction Context ────────────────────────────────────────────────────
// AsyncLocalStorage permette a getDatabase() di restituire il client
// transazionale quando siamo dentro un withTransaction(), senza cambiare
// la firma di nessuna funzione repository.
const transactionContext = new AsyncLocalStorage<DatabaseManager>();

export interface DBRunResult {
    lastID?: number;
    changes?: number;
}

// ─── Query Profiling ─────────────────────────────────────────────────────────
const QUERY_PROFILING_ENABLED = process.env.DB_QUERY_PROFILING === 'true';
const QUERY_PROFILING_THRESHOLD_MS = Math.max(
    1,
    Number.parseInt(process.env.DB_QUERY_PROFILING_THRESHOLD_MS ?? '50', 10) || 50,
);

async function profileQuery<T>(label: string, sql: string, fn: () => Promise<T>): Promise<T> {
    if (!QUERY_PROFILING_ENABLED) return fn();
    const start = performance.now();
    try {
        return await fn();
    } finally {
        const elapsed = performance.now() - start;
        if (elapsed >= QUERY_PROFILING_THRESHOLD_MS) {
            const truncatedSql = sql.length > 200 ? sql.substring(0, 200) + '...' : sql;
            console.warn(`[DB-PROFILE] ${label} ${elapsed.toFixed(1)}ms: ${truncatedSql}`);
        }
    }
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
    withTransaction<T>(callback: (tx: DatabaseManager) => Promise<T>): Promise<T>;
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
        return profileQuery('sqlite.query', sql, () => this.db.all<T[]>(sql, params));
    }

    async get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined> {
        return profileQuery('sqlite.get', sql, () => this.db.get<T>(sql, params));
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
        const result = await profileQuery('sqlite.run', sql, () => this.db.run(sql, params));
        return {
            lastID: result.lastID,
            changes: result.changes,
        };
    }

    async withTransaction<T>(callback: (tx: DatabaseManager) => Promise<T>): Promise<T> {
        // SQLite is single-connection, so BEGIN/COMMIT on `this` is safe.
        // transactionContext permette a getDatabase() di restituire `this`
        // quando chiamato da funzioni nested nel callback.
        const isNested = transactionContext.getStore() === this;
        if (isNested) {
            // Nested transaction: usa SAVEPOINT per evitare "cannot start
            // a transaction within a transaction" (SQLite supporta SAVEPOINT ≥3.6.8)
            const sp = `sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            await this.exec(`SAVEPOINT ${sp}`);
            try {
                const result = await callback(this);
                await this.exec(`RELEASE SAVEPOINT ${sp}`);
                return result;
            } catch (error) {
                await this.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
                throw error;
            }
        }
        await this.exec('BEGIN');
        try {
            const result = await transactionContext.run(this, () => callback(this));
            await this.exec('COMMIT');
            return result;
        } catch (error) {
            await this.exec('ROLLBACK');
            throw error;
        }
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
    private sqlCache = new Map<string, string>();
    private static readonly SQL_CACHE_MAX = 500;

    constructor(connectionString: string) {
        this.pool = new Pool({
            connectionString,
            max: 10,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
            statement_timeout: 30_000,
        });
    }

    // Adattatore sintassi: converte i `?` di SQLite in `$1`, `$2` di Postgres
    private adaptParams(sql: string): string {
        let count = 1;
        return sql.replace(/\?/g, () => `$${count++}`);
    }

    private normalizeSql(sql: string): string {
        const cached = this.sqlCache.get(sql);
        if (cached) return cached;

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

        // A21: STRFTIME → EXTRACT per PostgreSQL (STRFTIME è SQLite-only)
        // CAST(STRFTIME('%H', col) AS INTEGER) → EXTRACT(HOUR FROM col)::integer
        // CAST(STRFTIME('%w', col) AS INTEGER) → EXTRACT(DOW FROM col)::integer
        normalized = normalized.replace(
            /CAST\s*\(\s*STRFTIME\s*\(\s*'%H'\s*,\s*(\w+)\s*\)\s*AS\s+INTEGER\s*\)/gi,
            'EXTRACT(HOUR FROM $1)::integer',
        );
        normalized = normalized.replace(
            /CAST\s*\(\s*STRFTIME\s*\(\s*'%w'\s*,\s*(\w+)\s*\)\s*AS\s+INTEGER\s*\)/gi,
            'EXTRACT(DOW FROM $1)::integer',
        );

        const hadInsertOrIgnore = /\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(normalized);
        normalized = normalized.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO');
        if (hadInsertOrIgnore && !/\bON\s+CONFLICT\b/i.test(normalized)) {
            normalized = normalized.replace(/;\s*$/, '');
            normalized = `${normalized} ON CONFLICT DO NOTHING`;
        }

        // Cache il risultato per evitare 8 regex ad ogni query ripetuta
        if (this.sqlCache.size >= PostgresManager.SQL_CACHE_MAX) {
            const firstKey = this.sqlCache.keys().next().value;
            if (firstKey !== undefined) this.sqlCache.delete(firstKey);
        }
        this.sqlCache.set(sql, normalized);

        return normalized;
    }

    async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
        const normalized = this.normalizeSql(sql);
        const result = await profileQuery('pg.query', normalized, () => this.pool.query(normalized, params));
        return result.rows;
    }

    async get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined> {
        const normalized = this.normalizeSql(sql);
        const result = await profileQuery('pg.get', normalized, () => this.pool.query(normalized, params));
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
            normalizedSql = normalizedSql.replace(/;\s*$/, '') + ' RETURNING *';
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

    async withTransaction<T>(callback: (tx: DatabaseManager) => Promise<T>): Promise<T> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const txManager = new PostgresClientManager(client, (sql: string) => this.normalizeSql(sql));
            const result = await transactionContext.run(txManager, () => callback(txManager));
            await client.query('COMMIT');
            return result;
        } catch (error) {
            try {
                await client.query('ROLLBACK');
            } catch {
                // ROLLBACK best-effort: il client potrebbe essere già disconnesso
            }
            throw error;
        } finally {
            client.release();
        }
    }

    async close(): Promise<void> {
        await this.pool.end();
    }
}

// ------------------------------------------------------------------
// WRAPPER POSTGRES SINGLE-CLIENT (per transazioni)
// ------------------------------------------------------------------
// Usa un singolo PoolClient dedicato garantendo che tutte le query
// della transazione vadano sulla stessa connessione PostgreSQL.
class PostgresClientManager implements DatabaseManager {
    readonly isPostgres = true;
    private client: PoolClient;
    private normalize: (sql: string) => string;

    constructor(client: PoolClient, normalize: (sql: string) => string) {
        this.client = client;
        this.normalize = normalize;
    }

    async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
        const normalized = this.normalize(sql);
        const result = await profileQuery('pg-tx.query', normalized, () => this.client.query(normalized, params));
        return result.rows;
    }

    async get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined> {
        const normalized = this.normalize(sql);
        const result = await profileQuery('pg-tx.get', normalized, () => this.client.query(normalized, params));
        return result.rows[0];
    }

    async exec(sql: string, params?: unknown[]): Promise<void> {
        await this.client.query(this.normalize(sql), params);
    }

    async run(sql: string, params?: unknown[], options?: RunOptions): Promise<DBRunResult> {
        let normalizedSql = this.normalize(sql);

        const shouldReturn = options?.returning !== false;
        const isInsert = /^\s*INSERT\b/i.test(normalizedSql);
        const hasReturning = /\bRETURNING\b/i.test(normalizedSql);
        if (shouldReturn && isInsert && !hasReturning) {
            normalizedSql = normalizedSql.replace(/;\s*$/, '') + ' RETURNING *';
        }

        const result = await this.client.query(normalizedSql, params);
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

    async withTransaction<T>(callback: (tx: DatabaseManager) => Promise<T>): Promise<T> {
        // Transazione nidificata: usa SAVEPOINT per simulare sub-transazioni
        const savepointName = `sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await this.client.query(`SAVEPOINT ${savepointName}`);
        try {
            const result = await callback(this);
            await this.client.query(`RELEASE SAVEPOINT ${savepointName}`);
            return result;
        } catch (error) {
            try {
                await this.client.query(`ROLLBACK TO SAVEPOINT ${savepointName}`);
            } catch {
                // best-effort
            }
            throw error;
        }
    }

    async close(): Promise<void> {
        // No-op: il client è gestito da PostgresManager.withTransaction()
    }
}

/**
 * Espone la logica di normalizzazione SQL SQLite→PG per testing.
 * Replica la logica di PostgresManager.normalizeSql senza richiedere un'istanza.
 */
export function normalizeSqlForPg(sql: string): string {
    let count = 1;
    let normalized = sql.replace(/\?/g, () => `$${count++}`);

    normalized = normalized.replace(
        /strftime\('%Y-%m-%dT%H:%M:%f',\s*'now'\)/gi,
        `TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD"T"HH24:MI:SS.MS')`,
    );
    normalized = normalized.replace(/\bDATETIME\('now'\)/gi, 'CURRENT_TIMESTAMP');
    normalized = normalized.replace(/\bDATE\('now'\)/gi, 'CURRENT_DATE');

    normalized = normalized.replace(
        /\bDATETIME\('now',\s*'([+-])\s*(\d+)\s*(seconds?|minutes?|hours?|days?)'\s*\)/gi,
        (_match: string, sign: string, amount: string, unit: string) => {
            const op = sign === '+' ? '+' : '-';
            return `CURRENT_TIMESTAMP ${op} INTERVAL '${amount} ${unit.toLowerCase()}'`;
        },
    );
    normalized = normalized.replace(
        /\bDATE\('now',\s*'([+-])\s*(\d+)\s*(days?)'\s*\)/gi,
        (_match: string, sign: string, amount: string, unit: string) => {
            const op = sign === '+' ? '+' : '-';
            return `CURRENT_DATE ${op} INTERVAL '${amount} ${unit.toLowerCase()}'`;
        },
    );
    normalized = normalized.replace(
        /\bDATETIME\('now',\s*'([+-])'\s*\|\|\s*(\$\d+)\s*\|\|\s*'\s*(seconds?|minutes?|hours?|days?)'\s*\)/gi,
        (_match: string, sign: string, paramRef: string, unit: string) => {
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
        .filter((file) => file.endsWith('.sql') && !file.endsWith('.down.sql'))
        .sort((a, b) => a.localeCompare(b));

    // Load all already-applied migrations in a single query instead of one per file.
    const appliedRows = await database.query<{ name: string }>(`SELECT name FROM _migrations`);
    const applied = new Set(appliedRows.map((row) => row.name));

    // Fast path: if all migration files are already applied, skip file I/O and ensureColumn.
    // Saves ~50 fs.readFileSync + ~20 ALTER TABLE idempotent calls per boot.
    const pendingFiles = files.filter((f) => !applied.has(f));
    if (pendingFiles.length === 0) {
        return;
    }

    for (const fileName of pendingFiles) {
        let sql = fs.readFileSync(path.join(migrationDir, fileName), 'utf8');

        if (isPostgres) {
            // Semplice traduzione dialetto per file originariamente nati per sqlite
            sql = sql.replace(/\bDATETIME\b(?!\s*\()/gi, 'TIMESTAMP');
            sql = sql.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
            sql = sql.replace(/strftime\('%Y-%m-%dT%H:%M:%f',\s*'now'\)/gi, 'CURRENT_TIMESTAMP');
            sql = sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
        }

        try {
            await database.withTransaction(async (tx) => {
                // Eseguiamo il file SQL intero: evita parser naive su ';'
                // che rompe blocchi complessi (es. funzioni/DO blocks in Postgres).
                await tx.exec(sql);
                await tx.run(`INSERT OR IGNORE INTO _migrations (name) VALUES (?)`, [fileName]);
            });
        } catch (error) {
            console.error(`Migration error on file ${fileName}`);
            throw error;
        }
    }

    // Hardening (Retrocompatibilità) — colonne aggiunte su tabelle esistenti.
    // Le tabelle (list_daily_stats, company_targets, runtime_locks, etc.) sono
    // ora create dalla migration 041_hardening_tables.sql.
    // Le colonne di hardening restano qui perché ensureColumn* è idempotente
    // e gestisce il dialetto SQLite/Postgres in modo diverso.
    // Eseguite SOLO quando ci sono nuove migrazioni (primo boot o aggiornamento).
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

/**
 * Rollback a specific migration by executing its `.down.sql` file.
 * Returns true if the rollback was applied, false if no down file exists.
 */
export async function rollbackMigration(migrationName: string): Promise<boolean> {
    const db = await getDatabase();
    const migrationDir = resolveMigrationDirectory();

    // Check if migration was applied
    const row = await db.get<{ name: string }>(`SELECT name FROM _migrations WHERE name = ?`, [migrationName]);
    if (!row) {
        throw new Error(`Migration "${migrationName}" non trovata tra le migration applicate.`);
    }

    // Look for .down.sql file
    const baseName = migrationName.replace(/\.sql$/, '');
    const downFile = path.join(migrationDir, `${baseName}.down.sql`);

    if (!fs.existsSync(downFile)) {
        return false;
    }

    let sql = fs.readFileSync(downFile, 'utf8');
    if (isPostgres) {
        sql = sql.replace(/\bDATETIME\b(?!\s*\()/gi, 'TIMESTAMP');
        sql = sql.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
    }

    await db.withTransaction(async (tx) => {
        await tx.exec(sql);
        await tx.run(`DELETE FROM _migrations WHERE name = ?`, [migrationName]);
    });
    return true;
}

/**
 * List all applied migrations with their applied_at timestamp.
 */
export async function listAppliedMigrations(): Promise<Array<{ name: string; applied_at: string }>> {
    const db = await getDatabase();
    return db.query<{ name: string; applied_at: string }>(`SELECT name, applied_at FROM _migrations ORDER BY name`);
}

export async function getDatabase(): Promise<DatabaseManager> {
    // Se siamo dentro un withTransaction(), restituisce il client TX
    // garantendo che tutte le query vadano sulla stessa connessione.
    const txStore = transactionContext.getStore();
    if (txStore) return txStore;

    if (dbInstance) return dbInstance;

    // Controlla se abbiamo il DATABASE_URL configurato (Postgres)
    if (config.databaseUrl && config.databaseUrl.startsWith('postgres')) {
        isPostgres = true;

        console.log(`📡 Connecting to PostgreSQL database...`);
        const pgManager = new PostgresManager(config.databaseUrl);

        // Verifica la connessione
        try {
            await pgManager.query('SELECT 1');
        } catch (error) {
            console.error('❌ Failed to connect to PostgreSQL:', error);
            throw error;
        }

        dbInstance = pgManager;
        return pgManager;
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
    await sqliteDb.exec(`PRAGMA auto_vacuum = INCREMENTAL;`);
    ensureFilePrivate(config.dbPath);

    dbInstance = new SQLiteManager(sqliteDb);
    return dbInstance;
}

// ------------------------------------------------------------------
// DISK SPACE CHECK (SQLite only)
// ------------------------------------------------------------------
const DISK_CRITICAL_MB = 100;
const DISK_WARN_MB = 500;

export interface DiskSpaceStatus {
    ok: boolean;
    level: 'ok' | 'warn' | 'critical';
    freeMb: number;
    message: string;
}

/**
 * Controlla lo spazio disco disponibile per il database SQLite.
 * Per PostgreSQL restituisce sempre ok (il disco è gestito lato server).
 * Soglie: < 100MB = critical (blocco scritture consigliato), < 500MB = warn.
 */
export function checkDiskSpace(): DiskSpaceStatus {
    if (isPostgres) {
        return { ok: true, level: 'ok', freeMb: -1, message: 'PostgreSQL: disco gestito lato server' };
    }

    try {
        const dbDir = path.dirname(path.resolve(config.dbPath));
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        const stats = fs.statfsSync(dbDir);
        const freeBytes = stats.bavail * stats.bsize;
        const freeMb = Math.round(freeBytes / (1024 * 1024));

        if (freeMb < DISK_CRITICAL_MB) {
            return {
                ok: false,
                level: 'critical',
                freeMb,
                message: `Spazio disco CRITICO: ${freeMb}MB liberi (soglia: ${DISK_CRITICAL_MB}MB). Rischio SQLITE_FULL.`,
            };
        }
        if (freeMb < DISK_WARN_MB) {
            return {
                ok: true,
                level: 'warn',
                freeMb,
                message: `Spazio disco basso: ${freeMb}MB liberi (soglia warning: ${DISK_WARN_MB}MB).`,
            };
        }
        return { ok: true, level: 'ok', freeMb, message: `Spazio disco OK: ${freeMb}MB liberi` };
    } catch {
        return {
            ok: true,
            level: 'ok',
            freeMb: -1,
            message: 'Impossibile verificare spazio disco (statfsSync non disponibile)',
        };
    }
}

/**
 * Rileva se un errore è SQLITE_FULL o SQLITE_IOERR legato a disco pieno.
 * Utilizzabile da qualsiasi modulo per gestire uniformemente l'errore.
 */
export function isSqliteFullError(error: unknown): boolean {
    if (!error || isPostgres) return false;
    const msg = error instanceof Error ? error.message : String(error);
    return /SQLITE_FULL|SQLITE_IOERR.*full|disk.*full|no space left/i.test(msg);
}

export async function initDatabase(): Promise<void> {
    const diskStatus = checkDiskSpace();
    if (diskStatus.level === 'critical') {
        console.error(`[DB] ${diskStatus.message}`);
        throw new Error(diskStatus.message);
    }
    if (diskStatus.level === 'warn') {
        console.warn(`[DB] ${diskStatus.message}`);
    }
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
        const backupsDir = path.resolve('data', 'backups');
        ensureParentDirectoryPrivate(path.join(backupsDir, '_'));
        if (!fs.existsSync(backupsDir)) {
            fs.mkdirSync(backupsDir, { recursive: true });
        }
        const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backupPath = path.join(backupsDir, `pg_backup_${dateStr}.sql`);
        try {
            await new Promise<void>((resolve, reject) => {
                execFile(
                    'pg_dump',
                    [
                        '--dbname',
                        config.databaseUrl,
                        '--format',
                        'plain',
                        '--no-owner',
                        '--no-privileges',
                        '--file',
                        backupPath,
                    ],
                    { timeout: 120_000 },
                    (error) => {
                        if (error) reject(error);
                        else resolve();
                    },
                );
            });
            ensureFilePrivate(backupPath);
            return backupPath;
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            const safeMsg = msg.replace(/postgres:\/\/[^\s]+/g, 'postgres://***');
            if (safeMsg.includes('ENOENT') || safeMsg.includes('not found') || safeMsg.includes('not recognized')) {
                console.warn(
                    "[BACKUP] pg_dump non trovato. Installare postgresql-client o delegare il backup all'infrastruttura.",
                );
                return 'pg_dump not available — install postgresql-client for automated backups';
            }
            throw new Error(`pg_dump failed: ${safeMsg}`);
        }
    }

    const database = await getDatabase();
    const parsedPath = path.parse(config.dbPath);
    const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const backupPath = path.join(parsedPath.dir, `${parsedPath.name}_backup_${dateStr}${parsedPath.ext}`);

    if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
    }

    ensureParentDirectoryPrivate(backupPath);

    // Checkpoint WAL per assicurare che tutti i dati siano scritti nel file principale,
    // poi copia atomica del file DB. Evita VACUUM INTO con path interpolato nella SQL
    // (anti-pattern SQL injection anche con regex validation).
    await database.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    fs.copyFileSync(config.dbPath, backupPath);
    ensureFilePrivate(backupPath);

    return backupPath;
}
