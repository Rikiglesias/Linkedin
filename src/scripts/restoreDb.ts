import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { config } from '../config';
import { closeDatabase, initDatabase } from '../db';
import { setRuntimeFlag } from '../core/repositories';

const DRILL_REPORT_DIR = path.resolve(process.cwd(), 'data', 'restore-drill');
const DRILL_TEMP_DB_DIR = path.resolve(DRILL_REPORT_DIR, 'tmp');

export interface RestoreDrillTableCheck {
    table: string;
    exists: boolean;
    rowCount: number | null;
}

export interface RestoreDrillReport {
    status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
    reason: string;
    triggeredBy: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    backupPath: string | null;
    tempDbPath: string | null;
    integrityCheck: string | null;
    tableChecks: RestoreDrillTableCheck[];
    reportPath: string | null;
    errorMessage: string | null;
}

export interface RestoreDrillOptions {
    backupFile?: string;
    triggeredBy?: string;
    keepArtifacts?: boolean;
    reportDir?: string;
    persistRuntimeFlags?: boolean;
}

interface RestoreCommandOptions {
    backupFile: string;
}

function ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function resolveSqliteBackupCandidates(): string[] {
    const dbParsed = path.parse(config.dbPath);
    const localDir = dbParsed.dir;
    const backupDir = path.resolve(process.cwd(), 'data', 'backups');
    const dirs = Array.from(new Set([localDir, backupDir]));
    const files: string[] = [];
    for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        for (const fileName of fs.readdirSync(dir)) {
            if (!fileName.endsWith('.sqlite')) continue;
            files.push(path.resolve(dir, fileName));
        }
    }
    return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function resolveBackupPath(backupFile?: string): string | null {
    if (backupFile && backupFile.trim()) {
        const resolved = path.resolve(backupFile);
        return fs.existsSync(resolved) ? resolved : null;
    }
    const candidates = resolveSqliteBackupCandidates();
    const latest = candidates.find((candidate) => path.resolve(candidate) !== path.resolve(config.dbPath));
    return latest ?? null;
}

async function inspectSqliteDatabase(
    databasePath: string,
): Promise<{ integrity: string; tables: RestoreDrillTableCheck[] }> {
    const db = await open({
        filename: databasePath,
        driver: sqlite3.Database,
    });
    try {
        const integrityRow = await db.get<{ integrity_check?: string }>('PRAGMA integrity_check');
        const integrity = (integrityRow?.integrity_check ?? '').toLowerCase() || 'unknown';
        const candidateTables = ['leads', 'jobs', 'daily_stats', 'outbox_events'];
        const tables: RestoreDrillTableCheck[] = [];

        for (const tableName of candidateTables) {
            const existsRow = await db.get<{ total: number }>(
                `SELECT COUNT(*) as total
                 FROM sqlite_master
                 WHERE type = 'table'
                   AND name = ?`,
                [tableName],
            );
            const exists = (existsRow?.total ?? 0) > 0;
            let rowCount: number | null = null;
            if (exists) {
                const countRow = await db.get<{ total: number }>(`SELECT COUNT(*) as total FROM ${tableName}`);
                rowCount = countRow?.total ?? 0;
            }
            tables.push({ table: tableName, exists, rowCount });
        }

        return { integrity, tables };
    } finally {
        await db.close();
    }
}

function renderTimestampToken(date: Date = new Date()): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

async function persistDrillRuntimeFlags(report: RestoreDrillReport): Promise<void> {
    await setRuntimeFlag('dr_restore_test_last_run_at', report.finishedAt);
    await setRuntimeFlag('dr_restore_test_last_status', report.status);
    await setRuntimeFlag('dr_restore_test_last_reason', report.reason);
    await setRuntimeFlag('dr_restore_test_last_report_path', report.reportPath ?? '');
    await setRuntimeFlag('dr_restore_test_last_error', report.errorMessage ?? '');
}

function runSqliteRestore(backupPath: string): void {
    const dbPath = config.dbPath;
    fs.copyFileSync(backupPath, dbPath);
}

function runPostgresRestore(backupPath: string): void {
    if (config.databaseUrl.includes('@db:')) {
        const command = `docker exec -i linkedin-pg psql -U bot_user -d linkedin_bot < "${backupPath}"`;
        execSync(command, { stdio: 'inherit' });
        return;
    }
    const command = `psql "${config.databaseUrl}" < "${backupPath}"`;
    execSync(command, { stdio: 'inherit' });
}

export async function runRestoreCommand(options: RestoreCommandOptions): Promise<void> {
    const backupPath = path.resolve(options.backupFile);
    if (!fs.existsSync(backupPath)) {
        throw new Error(`Il file di backup non esiste: ${backupPath}`);
    }

    const isSqlite =
        !config.databaseUrl || config.databaseUrl.startsWith('file:') || config.databaseUrl.includes('.sqlite');
    if (isSqlite) {
        if (!backupPath.endsWith('.sqlite')) {
            throw new Error('Restore SQLite richiede un file .sqlite.');
        }
        runSqliteRestore(backupPath);
        return;
    }

    if (config.databaseUrl.startsWith('postgres')) {
        if (!backupPath.endsWith('.sql')) {
            throw new Error('Restore PostgreSQL richiede un file .sql.');
        }
        runPostgresRestore(backupPath);
        return;
    }

    throw new Error('Tipo database non supportato per restore.');
}

export async function runRestoreDrill(options: RestoreDrillOptions = {}): Promise<RestoreDrillReport> {
    const startedAtDate = new Date();
    const startedAt = startedAtDate.toISOString();
    const triggeredBy = (options.triggeredBy ?? 'manual').trim() || 'manual';
    const reportDir = path.resolve(options.reportDir ?? DRILL_REPORT_DIR);
    const keepArtifacts = options.keepArtifacts === true;
    const persistRuntimeFlags = options.persistRuntimeFlags !== false;

    const finalize = async (
        partial: Omit<RestoreDrillReport, 'startedAt' | 'finishedAt' | 'durationMs' | 'triggeredBy'>,
    ): Promise<RestoreDrillReport> => {
        const finishedAtDate = new Date();
        const report: RestoreDrillReport = {
            ...partial,
            triggeredBy,
            startedAt,
            finishedAt: finishedAtDate.toISOString(),
            durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
        };

        ensureDir(reportDir);
        const reportPath = path.resolve(reportDir, `restore-drill-${renderTimestampToken(finishedAtDate)}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
        report.reportPath = reportPath;

        if (persistRuntimeFlags) {
            await persistDrillRuntimeFlags(report);
        }

        return report;
    };

    const isSqlite =
        !config.databaseUrl || config.databaseUrl.startsWith('file:') || config.databaseUrl.includes('.sqlite');
    if (!isSqlite) {
        return finalize({
            status: 'SKIPPED',
            reason: 'non_sqlite_environment',
            backupPath: null,
            tempDbPath: null,
            integrityCheck: null,
            tableChecks: [],
            reportPath: null,
            errorMessage: null,
        });
    }

    const backupPath = resolveBackupPath(options.backupFile);
    if (!backupPath) {
        return finalize({
            status: 'SKIPPED',
            reason: 'backup_not_found',
            backupPath: null,
            tempDbPath: null,
            integrityCheck: null,
            tableChecks: [],
            reportPath: null,
            errorMessage: null,
        });
    }

    ensureDir(DRILL_TEMP_DB_DIR);
    const tempDbPath = path.resolve(DRILL_TEMP_DB_DIR, `restore-drill-${renderTimestampToken()}.sqlite`);

    try {
        fs.copyFileSync(backupPath, tempDbPath);
        const inspection = await inspectSqliteDatabase(tempDbPath);
        const requiredTablesPresent = inspection.tables.every((table) => table.exists);
        const success = inspection.integrity === 'ok' && requiredTablesPresent;
        const report = await finalize({
            status: success ? 'SUCCEEDED' : 'FAILED',
            reason: success ? 'ok' : 'integrity_or_schema_check_failed',
            backupPath,
            tempDbPath,
            integrityCheck: inspection.integrity,
            tableChecks: inspection.tables,
            reportPath: null,
            errorMessage: success
                ? null
                : `integrity=${inspection.integrity}, requiredTablesPresent=${requiredTablesPresent}`,
        });
        if (!keepArtifacts && fs.existsSync(tempDbPath)) {
            fs.unlinkSync(tempDbPath);
        }
        return report;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const report = await finalize({
            status: 'FAILED',
            reason: 'drill_execution_failed',
            backupPath,
            tempDbPath,
            integrityCheck: null,
            tableChecks: [],
            reportPath: null,
            errorMessage: message,
        });
        if (!keepArtifacts && fs.existsSync(tempDbPath)) {
            fs.unlinkSync(tempDbPath);
        }
        return report;
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const hasFlag = (flag: string): boolean => args.includes(flag);
    const getFlagValue = (flag: string): string | null => {
        const index = args.indexOf(flag);
        if (index < 0) return null;
        return args[index + 1] ?? null;
    };

    const drillMode = hasFlag('--drill');
    if (drillMode) {
        await initDatabase();
        try {
            const report = await runRestoreDrill({
                backupFile: getFlagValue('--backup') ?? undefined,
                keepArtifacts: hasFlag('--keep-artifacts'),
                reportDir: getFlagValue('--report-dir') ?? undefined,
                persistRuntimeFlags: true,
                triggeredBy: getFlagValue('--by') ?? 'cli',
            });
            console.log(JSON.stringify(report, null, 2));
            if (report.status === 'FAILED') {
                process.exitCode = 1;
            }
            return;
        } finally {
            await closeDatabase();
        }
    }

    try {
        const backupFile = args[0];
        if (!backupFile) {
            throw new Error(
                'Devi specificare il file di backup. Esempio: npm run db:restore data/backups/backup-123.sqlite',
            );
        }
        await runRestoreCommand({ backupFile });
        console.log(`Restore completato da: ${path.resolve(backupFile)}`);
    } finally {
        await closeDatabase().catch(() => null);
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error('[restore-db] failed', error);
        process.exit(1);
    });
}
