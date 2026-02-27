/**
 * migrate-to-postgres.ts — Script di migrazione SQLite → PostgreSQL
 *
 * Applica tutte le migration SQL (src/db/migrations/*.sql) a un DB PostgreSQL.
 * Supporta SSL via `sslmode=require` o `ssl=true` nell'URL di connessione.
 *
 * Uso:
 *   npx ts-node scripts/migrate-to-postgres.ts
 *   npx ts-node scripts/migrate-to-postgres.ts --dry-run   (stampa senza applicare)
 *
 * Variabili richieste:
 *   DATABASE_URL = postgres://user:pass@host:5432/dbname?sslmode=require
 */

import { Pool, PoolConfig } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Carica .env se presente
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const DATABASE_URL = process.env.DATABASE_URL || '';
const DRY_RUN = process.argv.includes('--dry-run');
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'src', 'db', 'migrations');

// ─── SSL Detection ────────────────────────────────────────────────────────────

function buildPoolConfig(url: string): PoolConfig {
    const cfg: PoolConfig = { connectionString: url };
    const hasSSL = url.includes('sslmode=require')
        || url.includes('sslmode=verify-full')
        || url.includes('ssl=true');

    if (hasSSL) {
        const rejectUnauthorized = url.includes('sslmode=verify-full');
        cfg.ssl = { rejectUnauthorized };
        console.log(`🔒 SSL abilitato (rejectUnauthorized=${rejectUnauthorized})`);
    }
    return cfg;
}

// ─── Migration Tracker ────────────────────────────────────────────────────────

async function ensureMigrationsTable(pool: Pool): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version     TEXT    PRIMARY KEY,
            applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

async function getAppliedMigrations(pool: Pool): Promise<Set<string>> {
    const result = await pool.query<{ version: string }>(`SELECT version FROM schema_migrations ORDER BY version`);
    return new Set(result.rows.map(r => r.version));
}

async function markMigrationApplied(pool: Pool, version: string): Promise<void> {
    await pool.query(`INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING`, [version]);
}

// ─── SQL Compatibility Layer ──────────────────────────────────────────────────

/**
 * Converte SQLite-specific syntax a PostgreSQL-compatible syntax.
 */
function adaptSQLForPostgres(sql: string): string {
    return sql
        .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY')
        .replace(/REAL/gi, 'DOUBLE PRECISION')
        .replace(/TEXT NOT NULL DEFAULT \(datetime\('now'\)\)/gi, "TIMESTAMPTZ NOT NULL DEFAULT NOW()")
        .replace(/DEFAULT \(datetime\('now'\)\)/gi, "DEFAULT NOW()")
        .replace(/STRFTIME\('%[^']+',\s*[^)]+\)/gi, match => {
            // Lascia i STRFTIME nei SELECT — Postgres usa TO_CHAR. Non possiamo auto-convertire tutto.
            console.warn(`  ⚠️  STRFTIME rilevato — verifica manuale richiesta: ${match.substring(0, 60)}...`);
            return match;
        })
        .replace(/INSERT OR IGNORE/gi, 'INSERT')
        .replace(/INSERT OR REPLACE/gi, 'INSERT')
        .replace(/ON CONFLICT\s*\([^)]+\)\s*DO NOTHING/gi, sql => sql) // già PG-compatible
        .replace(/\bIF NOT EXISTS\b/gi, 'IF NOT EXISTS'); // già supportato
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
    if (!DATABASE_URL || !DATABASE_URL.startsWith('postgres')) {
        console.error('❌ DATABASE_URL non configurata o non è PostgreSQL.');
        console.error('   Imposta DATABASE_URL=postgres://user:pass@host:5432/dbname nel file .env');
        process.exit(1);
    }

    console.log(`\n🐘 LinkedIn Bot — Migration to PostgreSQL`);
    console.log(`   DATABASE_URL: ${DATABASE_URL.replace(/:([^@]+)@/, ':***@')}`);
    console.log(`   MIGRATIONS_DIR: ${MIGRATIONS_DIR}`);
    if (DRY_RUN) console.log(`   MODE: DRY RUN (nessuna modifica applicata)\n`);

    const pool = new Pool(buildPoolConfig(DATABASE_URL));

    try {
        // Test connessione
        await pool.query('SELECT 1');
        console.log('✅ Connessione a PostgreSQL riuscita.\n');

        await ensureMigrationsTable(pool);
        const applied = await getAppliedMigrations(pool);

        // Leggi e ordina i file di migrazione
        const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
            .filter(f => f.endsWith('.sql'))
            .sort();

        let appliedCount = 0;
        let skippedCount = 0;

        for (const file of migrationFiles) {
            const version = file.replace('.sql', '');

            if (applied.has(version)) {
                console.log(`  ⏭  [SKIP] ${file} — già applicata`);
                skippedCount++;
                continue;
            }

            const filePath = path.join(MIGRATIONS_DIR, file);
            const rawSQL = fs.readFileSync(filePath, 'utf-8');
            const pgSQL = adaptSQLForPostgres(rawSQL);

            console.log(`  🔄 [APPLY] ${file}`);

            if (DRY_RUN) {
                // In dry-run mode: stampa le prime 3 righe
                const preview = pgSQL.split('\n').filter(l => l.trim()).slice(0, 3).join('\n');
                console.log(`       Preview: ${preview}`);
            } else {
                // Esegui in transazione
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    await client.query(pgSQL);
                    await markMigrationApplied(pool, version);
                    await client.query('COMMIT');
                    console.log(`       ✅ Applicata con successo.`);
                } catch (err) {
                    await client.query('ROLLBACK');
                    console.error(`       ❌ ERRORE: ${err instanceof Error ? err.message : String(err)}`);
                    throw err;
                } finally {
                    client.release();
                }
            }
            appliedCount++;
        }

        console.log(`\n📊 Summary:`);
        console.log(`   Applicate: ${appliedCount}`);
        console.log(`   Già presenti (skip): ${skippedCount}`);
        console.log(`   Totale migration: ${migrationFiles.length}`);
        if (DRY_RUN) console.log(`\n   ⚠️  DRY RUN completato — nessuna modifica apportata al DB.`);
        else console.log(`\n✅ Migrazione completata con successo.`);

    } finally {
        await pool.end();
    }
}

run().catch(err => {
    console.error('\n💥 Migrazione fallita:', err instanceof Error ? err.message : err);
    process.exit(1);
});
