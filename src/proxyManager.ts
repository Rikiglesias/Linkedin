import fs from 'fs';
import path from 'path';
import * as net from 'net';
import { config } from './config';
import { logInfo, logWarn } from './telemetry/logger';

export interface ProxyConfig {
    server: string;
    username?: string;
    password?: string;
}

interface ProxyPoolCache {
    proxies: ProxyConfig[];
    signature: string;
}

export interface ProxyPoolStatus {
    configured: boolean;
    total: number;
    ready: number;
    cooling: number;
    rotationCursor: number;
}

const proxyFailureUntil = new Map<string, number>();
const stickyProxySessions = new Map<string, ProxyConfig>();
let rotationCursor = 0;
let cachedPool: ProxyPoolCache = { proxies: [], signature: '' };

function normalizeProxyServer(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)) {
        return trimmed;
    }
    return `http://${trimmed}`;
}

function isLikelyHostPortUserPass(value: string): boolean {
    if (value.includes('://')) return false;
    const parts = value.split(':');
    return parts.length === 4 && !parts[0].includes('/') && !parts[1].includes('/');
}

// Funzione Helper esportabile per parsare ProxyConfig raw
export function parseProxyEntry(rawValue: string): ProxyConfig | null {
    const raw = rawValue.trim();
    if (!raw || raw.startsWith('#')) return null;

    if (isLikelyHostPortUserPass(raw)) {
        const [host, port, username, password] = raw.split(':');
        return {
            server: `http://${host}:${port}`,
            username: username || undefined,
            password: password || undefined,
        };
    }

    const normalized = normalizeProxyServer(raw);
    try {
        const parsed = new URL(normalized);
        const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
        const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
        return {
            server: `${parsed.protocol}//${parsed.host}`,
            username,
            password,
        };
    } catch {
        return null;
    }
}

function applyGlobalCredentials(proxy: ProxyConfig): ProxyConfig {
    const username = proxy.username ?? config.proxyUsername;
    const password = proxy.password ?? config.proxyPassword;
    return {
        server: proxy.server,
        username: username || undefined,
        password: password || undefined,
    };
}

function proxyKey(proxy: ProxyConfig): string {
    return [proxy.server, proxy.username ?? '', proxy.password ?? ''].join('|');
}

function signatureForPool(proxyListPath: string | null, proxyUrl: string): string {
    if (proxyListPath) {
        try {
            const stats = fs.statSync(proxyListPath);
            return `${proxyListPath}:${stats.mtimeMs}:${stats.size}`;
        } catch {
            return `${proxyListPath}:missing`;
        }
    }
    return `single:${proxyUrl}:${config.proxyUsername}:${config.proxyPassword}`;
}

function loadProxiesFromList(proxyListPath: string): ProxyConfig[] {
    let content = '';
    try {
        content = fs.readFileSync(proxyListPath, 'utf8');
    } catch {
        return [];
    }

    const lines = content.split(/\r?\n/);
    const proxies: ProxyConfig[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
        const parsed = parseProxyEntry(line);
        if (!parsed) continue;
        const normalized = applyGlobalCredentials(parsed);
        const key = proxyKey(normalized);
        if (seen.has(key)) continue;
        seen.add(key);
        proxies.push(normalized);
    }
    return proxies;
}

function resolveProxyListPath(): string | null {
    if (!config.proxyListPath) return null;
    const raw = config.proxyListPath.trim();
    if (!raw) return null;
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function loadProxyPool(): ProxyConfig[] {
    const proxyListPath = resolveProxyListPath();
    const signature = signatureForPool(proxyListPath, config.proxyUrl);
    if (cachedPool.signature === signature) {
        return cachedPool.proxies;
    }

    let proxies: ProxyConfig[] = [];
    if (proxyListPath) {
        proxies = loadProxiesFromList(proxyListPath);
    } else if (config.proxyUrl) {
        const parsed = parseProxyEntry(config.proxyUrl);
        if (parsed) {
            proxies = [applyGlobalCredentials(parsed)];
        }
    }

    cachedPool = {
        proxies,
        signature,
    };
    if (rotationCursor >= proxies.length) {
        rotationCursor = 0;
    }
    return proxies;
}

function orderByRotation(pool: ProxyConfig[]): ProxyConfig[] {
    if (pool.length <= 1) {
        return pool.slice();
    }

    const start = rotationCursor % pool.length;
    rotationCursor = (start + 1) % pool.length;

    const ordered: ProxyConfig[] = [];
    for (let i = 0; i < pool.length; i++) {
        ordered.push(pool[(start + i) % pool.length]);
    }
    return ordered;
}

function splitByCooldown(orderedPool: ProxyConfig[]): { ready: ProxyConfig[]; cooling: ProxyConfig[] } {
    const now = Date.now();
    const ready: ProxyConfig[] = [];
    const cooling: ProxyConfig[] = [];

    for (const proxy of orderedPool) {
        const cooldownUntil = proxyFailureUntil.get(proxyKey(proxy)) ?? 0;
        if (cooldownUntil > now) {
            cooling.push(proxy);
        } else {
            ready.push(proxy);
        }
    }

    return { ready, cooling };
}

/**
 * Contatta API Esterna Provider (BrightData, Oxylabs, JSON-Server) per
 * richiedere urgentemente un nuovo indirizzo Proxy IP rotazionale
 * quando il pool è interamente bruciato o sotto 429.
 */
export async function fetchFallbackProxyFromProvider(): Promise<boolean> {
    if (!config.proxyProviderApiEndpoint) return false;

    console.log(`[PROXY] Fetching proxy d'emergenza da: ${config.proxyProviderApiEndpoint}`);
    try {
        const headers: Record<string, string> = { 'Accept': 'application/json' };
        if (config.proxyProviderApiKey) {
            headers['Authorization'] = `Bearer ${config.proxyProviderApiKey}`;
        }

        const response = await fetch(config.proxyProviderApiEndpoint, { headers, method: 'GET' });
        if (!response.ok) {
            throw new Error(`Proxy Provider HTTP ${response.status}`);
        }

        // Esempi previsti di output dal provider:
        // { "proxy": "http://user:pass@host:port" } 
        // { "ip": "1.2.3.4", "port": "8080" ... }
        const json = await response.json();

        let newProxyRaw = '';
        if (json.proxy && typeof json.proxy === 'string') {
            newProxyRaw = json.proxy;
        } else if (json.ip && json.port) {
            const auth = json.username ? `${json.username}:${json.password}@` : '';
            newProxyRaw = `http://${auth}${json.ip}:${json.port}`;
        } else {
            console.warn(`[PROXY] Payload API sconosciuto:`, json);
            return false;
        }

        const parsed = parseProxyEntry(newProxyRaw);
        if (parsed) {
            const finalProxy = applyGlobalCredentials(parsed);

            // Unshift nel Pool in Memoria
            cachedPool.proxies.unshift(finalProxy);
            // Forza invalidazione timestamp su signature esistente localmente per precludere ri-load dal file
            cachedPool.signature = `api-injected:${Date.now()}`;

            // Cancella eventuali penalty per questo preciso nuovo proxy
            markProxyHealthy(finalProxy);
            await logInfo('proxy.api.fallback_success', { newServer: finalProxy.server });
            return true;
        }
        return false;
    } catch (e) {
        await logWarn('proxy.api.fallback_failed', { error: e instanceof Error ? e.message : String(e) });
        return false;
    }
}

/**
 * Restituisce una chain di proxy ordinata:
 * - round-robin sul pool
 * - prima i proxy non in cooldown
 * - poi eventuali proxy in cooldown (fallback estremo)
 */
export async function getProxyFailoverChainAsync(): Promise<ProxyConfig[]> {
    const pool = loadProxyPool();
    if (pool.length === 0) return [];

    const rotated = orderByRotation(pool);
    const { ready, cooling } = splitByCooldown(rotated);
    if (ready.length > 0) {
        return ready.concat(cooling);
    }

    // Tutti in cooldown? Scalo il provider esterno se configurato.
    if (config.proxyProviderApiEndpoint) {
        const injected = await fetchFallbackProxyFromProvider();
        if (injected) {
            // Reinvochiamo noi stessi per prendere il top della catena che ora è fresco
            const refreshedPool = loadProxyPool();
            const reSplit = splitByCooldown(refreshedPool);
            return reSplit.ready.concat(reSplit.cooling);
        }
    }

    return rotated;
}

/**
 * Retrocompatibilità sincrona. Senza API Provider.
 */
export function getProxyFailoverChain(): ProxyConfig[] {
    const pool = loadProxyPool();
    if (pool.length === 0) return [];

    const rotated = orderByRotation(pool);
    const { ready, cooling } = splitByCooldown(rotated);
    if (ready.length > 0) {
        return ready.concat(cooling);
    }
    return rotated;
}

/**
 * Retrocompatibilità sincrona: restituisce il primo proxy disponibile (non usa API Provider on-demand).
 */
export function getProxy(): ProxyConfig | undefined {
    const chain = getProxyFailoverChain();
    return chain[0];
}

/**
 * Esegue un ping TCP sulla porta del proxy per verificare se è raggiungibile.
 */
export async function checkProxyHealth(proxy: ProxyConfig): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            const url = new URL(proxy.server);
            const port = url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80);

            const socket = new net.Socket();
            socket.setTimeout(config.proxyHealthCheckTimeoutMs ?? 5000);

            socket.on('connect', () => {
                socket.end();
                resolve(true);
            });

            socket.on('timeout', () => {
                socket.destroy();
                resolve(false);
            });

            socket.on('error', () => {
                socket.destroy();
                resolve(false);
            });

            socket.connect(port, url.hostname);
        } catch {
            resolve(false);
        }
    });
}

/**
 * Restituisce il primo proxy disponibile, interpellando l'API Provider se necessario, 
 * ed eseguendo anche un health check proattivo prima di restituirlo.
 */
export async function getProxyAsync(): Promise<ProxyConfig | undefined> {
    const chain = await getProxyFailoverChainAsync();

    for (const proxy of chain) {
        const isHealthy = await checkProxyHealth(proxy);
        if (isHealthy) {
            markProxyHealthy(proxy); // Resetta penalty su successo
            return proxy;
        } else {
            console.warn(`[PROXY] Health check fallito per proxy: ${proxy.server}`);
            markProxyFailed(proxy);
        }
    }

    // Se tutti i ping falliscono, ritentiamo caricando di nuovo la fallback logic,
    // oppure ritorniamo il primo (se non c'è fallback)
    const refreshedChain = await getProxyFailoverChainAsync();
    return refreshedChain[0];
}

/**
 * Restituisce o alloca un proxy permanente per una specifica sessionId.
 * Assicura che la sessione usi costantemente lo stesso nodo per non allertare Linkedin con cambi IP anomali.
 */
export async function getStickyProxy(sessionId: string): Promise<ProxyConfig | undefined> {
    // 1. Check if we already have a sticky proxy for this session
    const existing = stickyProxySessions.get(sessionId);
    if (existing) {
        // Verifichiamo proattivamente anche il proxy sticky
        const isHealthy = await checkProxyHealth(existing);
        if (isHealthy) {
            return existing;
        } else {
            console.warn(`[PROXY] Sticky proxy ${existing.server} per sessione ${sessionId} fallito health check. Ne cerco uno nuovo.`);
            markProxyFailed(existing);
            stickyProxySessions.delete(sessionId);
        }
    }

    // 2. Otherwise allocate a new proxy from the best available chain
    const proxy = await getProxyAsync();
    if (proxy) {
        stickyProxySessions.set(sessionId, proxy);
    }
    return proxy;
}

export function releaseStickyProxy(sessionId: string): void {
    stickyProxySessions.delete(sessionId);
}

export function markProxyFailed(proxy: ProxyConfig): void {
    const cooldownMs = config.proxyFailureCooldownMinutes * 60_000;
    proxyFailureUntil.set(proxyKey(proxy), Date.now() + cooldownMs);
}

export function markProxyHealthy(proxy: ProxyConfig): void {
    proxyFailureUntil.delete(proxyKey(proxy));
}

export function getProxyPoolStatus(): ProxyPoolStatus {
    const pool = loadProxyPool();
    if (pool.length === 0) {
        return {
            configured: false,
            total: 0,
            ready: 0,
            cooling: 0,
            rotationCursor: 0,
        };
    }

    const now = Date.now();
    let ready = 0;
    let cooling = 0;
    for (const proxy of pool) {
        const cooldownUntil = proxyFailureUntil.get(proxyKey(proxy)) ?? 0;
        if (cooldownUntil > now) {
            cooling += 1;
        } else {
            ready += 1;
        }
    }

    return {
        configured: true,
        total: pool.length,
        ready,
        cooling,
        rotationCursor,
    };
}
