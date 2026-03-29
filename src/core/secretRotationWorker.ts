import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import {
    listSecretRotationStatus,
    pushOutboxEvent,
    recordSecurityAuditEvent,
    upsertSecretRotation,
} from './repositories';

interface SecretRotationSpec {
    name: string;
    owner: string;
    autoRotatable: boolean;
}

const SECRET_ROTATION_SPECS: SecretRotationSpec[] = [
    { name: 'DASHBOARD_API_KEY', owner: 'dashboard', autoRotatable: true },
    { name: 'WEBHOOK_SYNC_SECRET', owner: 'integrations', autoRotatable: true },
    { name: 'SUPABASE_SERVICE_ROLE_KEY', owner: 'supabase', autoRotatable: false },
    { name: 'HUBSPOT_API_KEY', owner: 'hubspot', autoRotatable: false },
    { name: 'SALESFORCE_CLIENT_SECRET', owner: 'salesforce', autoRotatable: false },
    { name: 'HUNTER_API_KEY', owner: 'hunter', autoRotatable: false },
    { name: 'CLEARBIT_API_KEY', owner: 'clearbit', autoRotatable: false },
    { name: 'PROXY_PROVIDER_API_KEY', owner: 'proxy', autoRotatable: false },
    { name: 'OPENAI_API_KEY', owner: 'ai', autoRotatable: false },
];

function toIsoAfterDays(days: number): string {
    return new Date(Date.now() + days * 86_400_000).toISOString();
}

function generateRotatedSecret(): string {
    return randomBytes(32).toString('base64url');
}

function parseEnvFile(content: string): Array<{ key: string; value: string; raw: string }> {
    const rows: Array<{ key: string; value: string; raw: string }> = [];
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            rows.push({ key: '', value: '', raw: line });
            continue;
        }
        const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
        if (!match) {
            rows.push({ key: '', value: '', raw: line });
            continue;
        }
        rows.push({
            key: match[1] ?? '',
            value: match[2] ?? '',
            raw: line,
        });
    }
    return rows;
}

function serializeEnvFile(
    parsed: Array<{ key: string; value: string; raw: string }>,
    updates: Map<string, string>,
): string {
    const touched = new Set<string>();
    const nextLines = parsed.map((row) => {
        if (!row.key) return row.raw;
        const nextValue = updates.get(row.key);
        if (nextValue === undefined) return row.raw;
        touched.add(row.key);
        return `${row.key}=${nextValue}`;
    });

    for (const [key, value] of updates) {
        if (touched.has(key)) continue;
        nextLines.push(`${key}=${value}`);
    }
    return `${nextLines.join('\n').replace(/\n+$/g, '')}\n`;
}

function resolveEnvFilePath(explicitPath?: string): string {
    if (!explicitPath || !explicitPath.trim()) {
        return path.resolve(process.cwd(), '.env');
    }
    return path.isAbsolute(explicitPath) ? explicitPath : path.resolve(process.cwd(), explicitPath);
}

function normalizeSecretList(includeSecrets?: string[]): Set<string> | null {
    if (!includeSecrets || includeSecrets.length === 0) return null;
    const entries = includeSecrets.map((value) => value.trim().toUpperCase()).filter((value) => value.length > 0);
    if (entries.length === 0) return null;
    return new Set(entries);
}

export interface SecretRotationWorkerOptions {
    apply: boolean;
    intervalDays: number;
    actor: string;
    envFilePath?: string;
    includeSecrets?: string[];
}

export interface SecretRotationWorkerRow {
    secretName: string;
    owner: string;
    hasValue: boolean;
    status: 'ROTATED' | 'DUE_MANUAL' | 'DUE_DRY_RUN' | 'SEEDED' | 'SKIPPED';
    reason: string;
    autoRotatable: boolean;
    daysSinceRotation: number | null;
}

export interface SecretRotationWorkerResult {
    apply: boolean;
    intervalDays: number;
    actor: string;
    envFilePath: string;
    rotated: number;
    dueManual: number;
    dueDryRun: number;
    seeded: number;
    skipped: number;
    rows: SecretRotationWorkerRow[];
}

export async function runSecretRotationWorker(
    options: SecretRotationWorkerOptions,
): Promise<SecretRotationWorkerResult> {
    const intervalDays = Math.max(1, Math.floor(options.intervalDays));
    const nowIso = new Date().toISOString();
    const expiresAt = toIsoAfterDays(config.securitySecretMaxAgeDays);
    const includeSet = normalizeSecretList(options.includeSecrets);
    const envFilePath = resolveEnvFilePath(options.envFilePath);

    const statusRows = await listSecretRotationStatus(config.securitySecretMaxAgeDays, config.securitySecretWarnDays);
    const bySecret = new Map(statusRows.map((row) => [row.secretName.toUpperCase(), row]));

    const envUpdates = new Map<string, string>();
    const rows: SecretRotationWorkerRow[] = [];
    let rotated = 0;
    let dueManual = 0;
    let dueDryRun = 0;
    let seeded = 0;
    let skipped = 0;

    const specs = SECRET_ROTATION_SPECS.filter((spec) => !includeSet || includeSet.has(spec.name));
    for (const spec of specs) {
        const currentValue = process.env[spec.name]?.trim() ?? '';
        const hasValue = currentValue.length > 0;
        const existing = bySecret.get(spec.name);

        if (!hasValue) {
            skipped += 1;
            rows.push({
                secretName: spec.name,
                owner: spec.owner,
                hasValue: false,
                status: 'SKIPPED',
                reason: 'secret_missing_in_env',
                autoRotatable: spec.autoRotatable,
                daysSinceRotation: existing?.daysSinceRotation ?? null,
            });
            continue;
        }

        if (!existing) {
            await upsertSecretRotation(
                spec.name,
                nowIso,
                spec.owner,
                expiresAt,
                'seeded_by_rotation_worker_unknown_history',
            );
            await recordSecurityAuditEvent({
                category: 'secret_rotation',
                action: 'seed_inventory',
                actor: options.actor,
                result: 'ALLOW',
                metadata: {
                    secretName: spec.name,
                    owner: spec.owner,
                },
            });
            seeded += 1;
            rows.push({
                secretName: spec.name,
                owner: spec.owner,
                hasValue: true,
                status: 'SEEDED',
                reason: 'seeded_inventory_unknown_history',
                autoRotatable: spec.autoRotatable,
                daysSinceRotation: null,
            });
            continue;
        }

        const daysSince = existing.daysSinceRotation;
        const due = daysSince >= intervalDays || existing.status === 'EXPIRED';
        if (!due) {
            skipped += 1;
            rows.push({
                secretName: spec.name,
                owner: spec.owner,
                hasValue: true,
                status: 'SKIPPED',
                reason: 'within_rotation_window',
                autoRotatable: spec.autoRotatable,
                daysSinceRotation: daysSince,
            });
            continue;
        }

        if (!options.apply) {
            dueDryRun += 1;
            rows.push({
                secretName: spec.name,
                owner: spec.owner,
                hasValue: true,
                status: 'DUE_DRY_RUN',
                reason: 'dry_run_rotation_due',
                autoRotatable: spec.autoRotatable,
                daysSinceRotation: daysSince,
            });
            continue;
        }

        if (!spec.autoRotatable) {
            dueManual += 1;
            await recordSecurityAuditEvent({
                category: 'secret_rotation',
                action: 'rotation_due_manual',
                actor: options.actor,
                result: 'ALLOW',
                metadata: {
                    secretName: spec.name,
                    owner: spec.owner,
                    daysSinceRotation: daysSince,
                    intervalDays,
                },
            });
            await pushOutboxEvent(
                'security.secret_rotation_due',
                {
                    secretName: spec.name,
                    owner: spec.owner,
                    daysSinceRotation: daysSince,
                    intervalDays,
                    autoRotatable: false,
                },
                `security.secret_rotation_due:${spec.name}:${nowIso.slice(0, 10)}`,
            );
            rows.push({
                secretName: spec.name,
                owner: spec.owner,
                hasValue: true,
                status: 'DUE_MANUAL',
                reason: 'provider_managed_secret_requires_manual_rotation',
                autoRotatable: false,
                daysSinceRotation: daysSince,
            });
            continue;
        }

        const nextValue = generateRotatedSecret();
        envUpdates.set(spec.name, nextValue);
        process.env[spec.name] = nextValue;
        await upsertSecretRotation(
            spec.name,
            nowIso,
            spec.owner,
            expiresAt,
            `rotated_automatically_by_worker_interval_${intervalDays}d`,
        );
        await recordSecurityAuditEvent({
            category: 'secret_rotation',
            action: 'rotated_auto',
            actor: options.actor,
            result: 'ALLOW',
            metadata: {
                secretName: spec.name,
                owner: spec.owner,
                daysSinceRotation: daysSince,
                intervalDays,
            },
        });
        await pushOutboxEvent(
            'security.secret_rotated',
            {
                secretName: spec.name,
                owner: spec.owner,
                rotatedAt: nowIso,
                intervalDays,
                autoRotatable: true,
            },
            `security.secret_rotated:${spec.name}:${nowIso.slice(0, 10)}`,
        );
        rotated += 1;
        rows.push({
            secretName: spec.name,
            owner: spec.owner,
            hasValue: true,
            status: 'ROTATED',
            reason: 'auto_rotated_and_inventory_updated',
            autoRotatable: true,
            daysSinceRotation: daysSince,
        });
    }

    if (options.apply && envUpdates.size > 0) {
        const envContent = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
        const parsedEnv = parseEnvFile(envContent);
        const nextContent = serializeEnvFile(parsedEnv, envUpdates);
        // Atomic write: backup → write tmp → rename
        const backupPath = `${envFilePath}.backup.${Date.now()}`;
        const tmpPath = `${envFilePath}.tmp`;
        if (fs.existsSync(envFilePath)) {
            fs.copyFileSync(envFilePath, backupPath);
        }
        fs.writeFileSync(tmpPath, nextContent, 'utf8');
        if (process.platform === 'win32') {
            // Windows: renameSync fails if target exists
            fs.copyFileSync(tmpPath, envFilePath);
            fs.unlinkSync(tmpPath);
        } else {
            fs.renameSync(tmpPath, envFilePath);
        }
        // Retention: keep max 5 backup files
        const dir = path.dirname(envFilePath);
        const base = path.basename(envFilePath);
        const backups = fs
            .readdirSync(dir)
            .filter((f) => f.startsWith(`${base}.backup.`))
            .sort()
            .reverse();
        for (const old of backups.slice(5)) {
            fs.unlinkSync(path.join(dir, old));
        }
    }

    return {
        apply: options.apply,
        intervalDays,
        actor: options.actor,
        envFilePath,
        rotated,
        dueManual,
        dueDryRun,
        seeded,
        skipped,
        rows,
    };
}
