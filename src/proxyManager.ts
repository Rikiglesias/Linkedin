import fs from 'fs';
import path from 'path';
import { config } from './config';

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

function parseProxyEntry(rawValue: string): ProxyConfig | null {
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
 * Restituisce una chain di proxy ordinata:
 * - round-robin sul pool
 * - prima i proxy non in cooldown
 * - poi eventuali proxy in cooldown (fallback estremo)
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
 * Retrocompatibilità: restituisce il primo proxy disponibile.
 */
export function getProxy(): ProxyConfig | undefined {
    const chain = getProxyFailoverChain();
    return chain[0];
}

/**
 * Restituisce o alloca un proxy permanente per una specifica sessionId.
 * Assicura che la sessione usi costantemente lo stesso nodo per non allertare Linkedin con cambi IP anomali.
 */
export function getStickyProxy(sessionId: string): ProxyConfig | undefined {
    // 1. Check if we already have a sticky proxy for this session
    const existing = stickyProxySessions.get(sessionId);
    if (existing) {
        // Option to verify if it's failed/cooling, but for sticky IPs, 
        // it's generally better to wait or fail than swap IP mid-session.
        return existing;
    }

    // 2. Otherwise allocate a new proxy from the best available chain
    const proxy = getProxy();
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
