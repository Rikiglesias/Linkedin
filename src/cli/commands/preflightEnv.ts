import { config } from '../../config';
import { getRuntimeAccountProfiles } from '../../accountManager';
import { checkProxyHealth } from '../../proxyManager';
import fs from 'fs';
import path from 'path';

interface PreflightCheck {
    name: string;
    status: 'OK' | 'WARN' | 'FAIL';
    detail: string;
}

export async function runPreflightEnvCommand(): Promise<void> {
    console.log('\n  Preflight Environment Check\n');
    const checks: PreflightCheck[] = [];

    // 1. Disk space check (data/ directory)
    try {
        const dataDir = path.resolve('data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        const stats = fs.statfsSync(dataDir);
        const freeGb = (stats.bavail * stats.bsize) / (1024 * 1024 * 1024);
        checks.push({
            name: 'Disk space (data/)',
            status: freeGb < 1 ? 'FAIL' : freeGb < 5 ? 'WARN' : 'OK',
            detail: `${freeGb.toFixed(1)} GB liberi`,
        });
    } catch {
        checks.push({ name: 'Disk space', status: 'WARN', detail: 'Impossibile verificare spazio disco' });
    }

    // 2. Proxy reachability
    const accounts = getRuntimeAccountProfiles();
    for (const account of accounts) {
        if (account.proxy) {
            try {
                const healthy = await checkProxyHealth(account.proxy);
                checks.push({
                    name: `Proxy (${account.id})`,
                    status: healthy ? 'OK' : 'FAIL',
                    detail: healthy ? account.proxy.server : `NON raggiungibile: ${account.proxy.server}`,
                });
            } catch {
                checks.push({
                    name: `Proxy (${account.id})`,
                    status: 'FAIL',
                    detail: `Errore verifica: ${account.proxy.server}`,
                });
            }
        } else {
            checks.push({
                name: `Proxy (${account.id})`,
                status: 'WARN',
                detail: 'Nessun proxy configurato — connessione diretta',
            });
        }
    }

    // 3. Ollama reachability (if AI local-first configured)
    if (config.ollamaEndpoint) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(`${config.ollamaEndpoint}/api/tags`, {
                signal: controller.signal,
            });
            clearTimeout(timeout);
            checks.push({
                name: 'Ollama',
                status: res.ok ? 'OK' : 'WARN',
                detail: res.ok ? config.ollamaEndpoint : `Status ${res.status}`,
            });
        } catch {
            checks.push({
                name: 'Ollama',
                status: config.aiAllowRemoteEndpoint ? 'WARN' : 'FAIL',
                detail: `NON raggiungibile: ${config.ollamaEndpoint}`,
            });
        }
    }

    // 4. Session directories exist
    for (const account of accounts) {
        const sessionDir = path.resolve(account.sessionDir);
        const exists = fs.existsSync(sessionDir);
        checks.push({
            name: `Session dir (${account.id})`,
            status: exists ? 'OK' : 'WARN',
            detail: exists ? sessionDir : 'Directory non trovata — verrà creata al primo avvio',
        });
    }

    // 5. LinkedIn session cookie validation
    for (const account of accounts) {
        const sessionDir = path.resolve(account.sessionDir);
        const metaPath = path.join(sessionDir, 'session_meta.json');
        const hasSessionMeta = fs.existsSync(metaPath);
        if (hasSessionMeta) {
            try {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                const lastVerified = meta?.lastVerifiedAt;
                checks.push({
                    name: `LinkedIn session (${account.id})`,
                    status: lastVerified ? 'OK' : 'WARN',
                    detail: lastVerified
                        ? `Ultimo login verificato: ${lastVerified}`
                        : 'session_meta.json presente ma lastVerifiedAt mancante',
                });
            } catch {
                checks.push({
                    name: `LinkedIn session (${account.id})`,
                    status: 'WARN',
                    detail: 'session_meta.json corrotto — eseguire `login` per ri-autenticarsi',
                });
            }
        } else {
            checks.push({
                name: `LinkedIn session (${account.id})`,
                status: 'FAIL',
                detail: 'Nessuna sessione LinkedIn trovata — eseguire `login` prima di avviare il bot',
            });
        }
    }

    // 6. Database accessible
    try {
        const { getDatabase } = await import('../../db');
        const db = await getDatabase();
        await db.query('SELECT 1');
        checks.push({ name: 'Database', status: 'OK', detail: config.databaseUrl ? 'PostgreSQL' : 'SQLite' });
    } catch (err) {
        checks.push({
            name: 'Database',
            status: 'FAIL',
            detail: `NON accessibile: ${err instanceof Error ? err.message : String(err)}`,
        });
    }

    // Print results
    let hasFailure = false;
    for (const check of checks) {
        const icon = check.status === 'OK' ? '✅' : check.status === 'WARN' ? '⚠️' : '❌';
        console.log(`  ${icon} ${check.name}: ${check.detail}`);
        if (check.status === 'FAIL') hasFailure = true;
    }

    console.log('');
    if (hasFailure) {
        console.error('  ❌ Preflight FALLITO — correggi i problemi sopra prima di avviare il bot.\n');
        process.exitCode = 1;
    } else {
        console.log('  ✅ Ambiente OK — pronto per il bot.\n');
    }
}
