import { config } from '../../config';
import { getRuntimeAccountProfiles } from '../../accountManager';
import { checkProxyHealth } from '../../proxyManager';
import fs from 'fs';
import path from 'path';
import { META_FILENAME } from '../../browser/sessionCookieMonitor';
// SSOT della località di un endpoint AI (`config/env.ts`, nata unificando 4 copie divergenti —
// F-a3f17c02). Ricopiarne la regola qui sarebbe la quinta copia: si importa, non si riscrive.
import { isLocalAiEndpoint, isLoopbackAiHost } from '../../config/env';

interface PreflightCheck {
    name: string;
    status: 'OK' | 'WARN' | 'FAIL';
    detail: string;
}

/**
 * Le DUE chiavi che descrivono lo stesso server Ollama puntano allo stesso posto?
 *
 * `OLLAMA_ENDPOINT` governa la sonda del preflight e l'avvio automatico del server
 * (`ollamaLifecycle.ensureOllamaRunning` → `${ollamaEndpoint}/api/tags`), mentre `OPENAI_BASE_URL`
 * governa la SCELTA del provider (`providerRegistry.isOllamaConfigured`) ed è l'endpoint verso cui
 * partono davvero le chiamate. Divergendo, il preflight dichiara «Ollama OK» su un server che
 * nessuno userà e il lifecycle avvia (o si astiene dall'avviare) quello sbagliato — due decisioni
 * prese su un endpoint diverso da quello usato, oggi senza alcun segnale. Coi default coincidono.
 *
 * 🔴 **Vale SOLO quando Ollama è davvero il provider risolto.** Con la config documentata
 * `OPENAI_BASE_URL=https://api.openai.com/v1` (`docs/CONFIG_REFERENCE.md`, con
 * `AI_ALLOW_REMOTE_ENDPOINT=true`) le due chiavi NON descrivono lo stesso server e `isOllamaConfigured`
 * è false: segnalare una divergenza lì significherebbe annunciare un guasto inesistente a ogni run.
 * Il gate è `isLocalAiEndpoint(openaiBaseUrl)`, lo stesso predicato che decide il provider.
 *
 * Il confronto usa `isLoopbackAiHost` (SSOT `config/env.ts`, nata unificando 4 copie divergenti):
 * `localhost`, `127.0.0.1`, `::1` e `0.0.0.0` sono LA STESSA macchina, un confronto testuale di
 * `origin` li direbbe diversi. Fuori dal loopback si confronta l'origin — non l'URL intera, perché
 * i path devono poter divergere (`/v1` = API OpenAI-compatible, nudo = API nativa di Ollama).
 *
 * @returns i due origin quando divergono davvero, `null` quando coincidono, quando sono entrambi
 *  loopback, quando Ollama non è il provider, o quando gli URL non sono confrontabili.
 */
export function rilevaDivergenzaEndpointOllama(
    ollamaEndpoint: string,
    openaiBaseUrl: string,
): { origineSonda: string; origineChiamate: string } | null {
    // Ollama non è il provider risolto ⇒ le due chiavi descrivono cose diverse per DESIGN.
    if (!isLocalAiEndpoint(openaiBaseUrl)) return null;

    const origine = (url: string): string | null => {
        try {
            return new URL(url).origin;
        } catch {
            return null; // URL malformato: non è questo check a doverlo diagnosticare
        }
    };
    const origineSonda = origine(ollamaEndpoint);
    const origineChiamate = origine(openaiBaseUrl);
    if (!origineSonda || !origineChiamate) return null;
    if (origineSonda === origineChiamate) return null;

    // Due modi diversi di scrivere «questa macchina» non sono una divergenza. La porta invece sì:
    // due server distinti sullo stesso host restano due server.
    const entrambiLoopback = isLoopbackAiHost(ollamaEndpoint) && isLoopbackAiHost(openaiBaseUrl);
    const stessaPorta = (() => {
        try {
            return new URL(ollamaEndpoint).port === new URL(openaiBaseUrl).port;
        } catch {
            return false;
        }
    })();
    if (entrambiLoopback && stessaPorta) return null;

    return { origineSonda, origineChiamate };
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

    // 3-bis. Le due chiavi dello stesso server Ollama devono puntare allo stesso posto (vedi
    // `rilevaDivergenzaEndpointOllama` per il perché: il check 3 qui sopra è uno dei due ingannati).
    if (config.ollamaEndpoint && config.openaiBaseUrl) {
        const divergenza = rilevaDivergenzaEndpointOllama(config.ollamaEndpoint, config.openaiBaseUrl);
        if (divergenza) {
            checks.push({
                name: 'Ollama (coerenza config)',
                status: 'WARN',
                detail:
                    `OLLAMA_ENDPOINT (${divergenza.origineSonda}) e OPENAI_BASE_URL ` +
                    `(${divergenza.origineChiamate}) puntano a server diversi: la sonda qui sopra e ` +
                    `l'avvio automatico valgono per il primo, le chiamate AI partono verso il secondo`,
            });
        }
    }

    // 3b. Anthropic reachability + validità key (F0 ai-stack — solo se configurato)
    if (config.anthropicApiKey) {
        const required = config.aiProvider === 'anthropic';
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            // GET /v1/models: endpoint di metadata, valida key e raggiungibilità senza consumare token.
            const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
                headers: {
                    'x-api-key': config.anthropicApiKey,
                    'anthropic-version': '2023-06-01',
                },
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (res.ok) {
                checks.push({
                    name: 'Anthropic',
                    status: 'OK',
                    detail: `key valida, modello ${config.anthropicModel}`,
                });
            } else if (res.status === 401) {
                checks.push({
                    name: 'Anthropic',
                    status: required ? 'FAIL' : 'WARN',
                    detail: 'ANTHROPIC_API_KEY non valida (401)',
                });
            } else {
                checks.push({ name: 'Anthropic', status: 'WARN', detail: `Status ${res.status}` });
            }
        } catch {
            checks.push({
                name: 'Anthropic',
                status: required ? 'FAIL' : 'WARN',
                detail: 'api.anthropic.com NON raggiungibile',
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
        const metaPath = path.join(sessionDir, META_FILENAME);
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
                        : `${META_FILENAME} presente ma lastVerifiedAt mancante`,
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
