import fs from 'fs';
import path from 'path';
import * as net from 'net';
import { config, ProxyType } from './config';
import type { ProxyConfig, GetProxyChainOptions } from './proxy/types';
import { logInfo, logWarn } from './telemetry/logger';
import { maskUrl } from './security/redaction';
import {
    checkAllProxiesQuality,
    shouldRunQualityCheck,
    getLastQualityReport,
    type ProxyQualityReport,
} from './proxy/proxyQualityChecker';
import { validateJa3Configuration, getLastJa3Report, type Ja3ValidationReport } from './proxy/ja3Validator';

// ProxyConfig importato da proxy/types.ts (circular dep fix)
export type { ProxyConfig, GetProxyChainOptions } from './proxy/types';

interface ProxyPoolCache {
    proxies: ProxyConfig[];
    signature: string;
}

export interface ProxyPoolStatus {
    configured: boolean;
    total: number;
    ready: number;
    cooling: number;
    mobile: number;
    residential: number;
    unknown: number;
    rotationCursor: number;
}

// GetProxyChainOptions rimosso — ora in proxy/types.ts (re-export sopra)

const proxyFailureUntil = new Map<string, number>();
const integrationProxyFailureUntil = new Map<string, number>();
const stickyProxySessions = new Map<string, ProxyConfig>();
let rotationCursor = 0;
let integrationRotationCursor = 0;
let cachedPool: ProxyPoolCache = { proxies: [], signature: '' };

function normalizeProxyType(value: ProxyType | string | undefined, fallback: ProxyType = 'unknown'): ProxyType {
    const normalized = (value ?? '').toString().trim().toLowerCase();
    if (normalized === 'mobile') return 'mobile';
    if (normalized === 'residential') return 'residential';
    if (normalized === 'unknown' || normalized === '') return fallback;
    return fallback;
}

function parseTypedProxyRaw(rawValue: string): { proxyRaw: string; type: ProxyType } {
    const trimmed = rawValue.trim();
    const match = trimmed.match(/^(mobile|residential|unknown)\s*[|,]\s*(.+)$/i);
    if (match) {
        const type = normalizeProxyType(match[1], 'unknown');
        const proxyRaw = match[2]?.trim() ?? '';
        return { proxyRaw, type };
    }
    return {
        proxyRaw: trimmed,
        type: normalizeProxyType(config.proxyTypeDefault, 'unknown'),
    };
}

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

    const { proxyRaw, type } = parseTypedProxyRaw(raw);
    if (!proxyRaw) return null;

    if (isLikelyHostPortUserPass(proxyRaw)) {
        const [host, port, username, password] = proxyRaw.split(':');
        return {
            server: `http://${host}:${port}`,
            username: username || undefined,
            password: password || undefined,
            type,
        };
    }

    const normalized = normalizeProxyServer(proxyRaw);
    try {
        const parsed = new URL(normalized);
        const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
        const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
        return {
            server: `${parsed.protocol}//${parsed.host}`,
            username,
            password,
            type,
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
        type: normalizeProxyType(proxy.type, 'unknown'),
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

function orderByIntegrationRotation(pool: ProxyConfig[]): ProxyConfig[] {
    if (pool.length <= 1) {
        return pool.slice();
    }

    const start = integrationRotationCursor % pool.length;
    integrationRotationCursor = (start + 1) % pool.length;

    const ordered: ProxyConfig[] = [];
    for (let i = 0; i < pool.length; i++) {
        ordered.push(pool[(start + i) % pool.length]);
    }
    return ordered;
}

function splitByCooldown(
    orderedPool: ProxyConfig[],
    cooldownRegistry: Map<string, number> = proxyFailureUntil,
): { ready: ProxyConfig[]; cooling: ProxyConfig[] } {
    const now = Date.now();
    const ready: ProxyConfig[] = [];
    const cooling: ProxyConfig[] = [];

    for (const proxy of orderedPool) {
        const cooldownUntil = cooldownRegistry.get(proxyKey(proxy)) ?? 0;
        if (cooldownUntil > now) {
            cooling.push(proxy);
        } else {
            ready.push(proxy);
        }
    }

    return { ready, cooling };
}

function proxyTypeScore(proxy: ProxyConfig, options: GetProxyChainOptions): number {
    const type = normalizeProxyType(proxy.type, 'unknown');
    const preferredType = options.preferredType;
    if (preferredType) {
        if (type === preferredType) return 0;
        return type === 'unknown' ? 2 : 1;
    }

    if (config.proxyMobilePriorityEnabled) {
        if (type === 'mobile') return 0;
        if (type === 'residential') return 1;
        return 2;
    }

    return 0;
}

function prioritizeProxyPool(pool: ProxyConfig[], options: GetProxyChainOptions): ProxyConfig[] {
    if (pool.length <= 1) {
        return pool.slice();
    }

    const forceMobile = options.forceMobile === true;
    const sourcePool = forceMobile
        ? (() => {
              const mobile = pool.filter((proxy) => normalizeProxyType(proxy.type, 'unknown') === 'mobile');
              return mobile.length > 0 ? mobile : pool;
          })()
        : pool;

    return sourcePool
        .map((proxy, index) => ({ proxy, index, score: proxyTypeScore(proxy, options) }))
        .sort((a, b) => a.score - b.score || a.index - b.index)
        .map((entry) => entry.proxy);
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
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (config.proxyProviderApiKey) {
            headers['Authorization'] = `Bearer ${config.proxyProviderApiKey}`;
        }

        let response: Response | null = null;
        let lastErr: Error | null = null;

        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 8000);
                response = await fetch(config.proxyProviderApiEndpoint, {
                    headers,
                    method: 'GET',
                    signal: controller.signal,
                });
                clearTimeout(timeout);

                if (!response.ok) {
                    throw new Error(`Proxy Provider HTTP ${response.status}`);
                }
                break;
            } catch (err: unknown) {
                lastErr = err instanceof Error ? err : new Error(String(err));
                if (attempt === 1) await new Promise((r) => setTimeout(r, 1000));
            }
        }

        if (!response || !response.ok) {
            throw lastErr || new Error('Fetch to proxy provider failed');
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
            console.warn(`[PROXY] Payload API sconosciuto: keys=${Object.keys(json as Record<string, unknown>).join(',')}`);
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
export async function getProxyFailoverChainAsync(options: GetProxyChainOptions = {}): Promise<ProxyConfig[]> {
    const pool = loadProxyPool();
    if (pool.length === 0) return [];

    const rotated = orderByRotation(pool);
    const { ready, cooling } = splitByCooldown(rotated);
    if (ready.length > 0) {
        const prioritizedReady = prioritizeProxyPool(ready, options);
        const prioritizedCooling = prioritizeProxyPool(cooling, options);
        return prioritizedReady.concat(prioritizedCooling);
    }

    // Tutti in cooldown? Scalo il provider esterno se configurato.
    if (config.proxyProviderApiEndpoint) {
        const injected = await fetchFallbackProxyFromProvider();
        if (injected) {
            // Reinvochiamo noi stessi per prendere il top della catena che ora è fresco
            const refreshedPool = loadProxyPool();
            const reSplit = splitByCooldown(refreshedPool);
            const prioritizedReady = prioritizeProxyPool(reSplit.ready, options);
            const prioritizedCooling = prioritizeProxyPool(reSplit.cooling, options);
            return prioritizedReady.concat(prioritizedCooling);
        }
    }

    // Tor before cooling proxies: fresh circuit is better than hammering a cooling proxy
    if (config.proxyTorSocks5Url) {
        const torParsed = parseProxyEntry(config.proxyTorSocks5Url);
        if (torParsed) {
            console.warn(
                `[PROXY] Pool esaurito e API provider non disp. Fallback su rete Tor: ${maskUrl(config.proxyTorSocks5Url)}`,
            );
            return [torParsed].concat(prioritizeProxyPool(rotated, options));
        }
    }

    return prioritizeProxyPool(rotated, options);
}

export async function getIntegrationProxyFailoverChainAsync(
    options: GetProxyChainOptions = {},
): Promise<ProxyConfig[]> {
    const pool = loadProxyPool();
    if (pool.length === 0) return [];

    const rotated = orderByIntegrationRotation(pool);
    const { ready, cooling } = splitByCooldown(rotated, integrationProxyFailureUntil);
    if (ready.length > 0) {
        const prioritizedReady = prioritizeProxyPool(ready, options);
        const prioritizedCooling = prioritizeProxyPool(cooling, options);
        return prioritizedReady.concat(prioritizedCooling);
    }

    if (config.proxyProviderApiEndpoint) {
        const injected = await fetchFallbackProxyFromProvider();
        if (injected) {
            const refreshedPool = loadProxyPool();
            const reSplit = splitByCooldown(refreshedPool, integrationProxyFailureUntil);
            const prioritizedReady = prioritizeProxyPool(reSplit.ready, options);
            const prioritizedCooling = prioritizeProxyPool(reSplit.cooling, options);
            return prioritizedReady.concat(prioritizedCooling);
        }
    }

    // Tor before cooling proxies: fresh circuit is better than hammering a cooling proxy
    if (config.proxyTorSocks5Url) {
        const torParsed = parseProxyEntry(config.proxyTorSocks5Url);
        if (torParsed) {
            console.warn(
                `[PROXY-INT] Pool esaurito e API provider non disp. Fallback su rete Tor: ${maskUrl(config.proxyTorSocks5Url)}`,
            );
            return [torParsed].concat(prioritizeProxyPool(rotated, options));
        }
    }

    return prioritizeProxyPool(rotated, options);
}

/**
 * Retrocompatibilità sincrona. Senza API Provider.
 */
export function getProxyFailoverChain(options: GetProxyChainOptions = {}): ProxyConfig[] {
    const pool = loadProxyPool();
    if (pool.length === 0) return [];

    const rotated = orderByRotation(pool);
    const { ready, cooling } = splitByCooldown(rotated);
    if (ready.length > 0) {
        const prioritizedReady = prioritizeProxyPool(ready, options);
        const prioritizedCooling = prioritizeProxyPool(cooling, options);
        return prioritizedReady.concat(prioritizedCooling);
    }
    return prioritizeProxyPool(rotated, options);
}

export function getIntegrationProxyFailoverChain(options: GetProxyChainOptions = {}): ProxyConfig[] {
    const pool = loadProxyPool();
    if (pool.length === 0) return [];

    const rotated = orderByIntegrationRotation(pool);
    const { ready, cooling } = splitByCooldown(rotated, integrationProxyFailureUntil);
    if (ready.length > 0) {
        const prioritizedReady = prioritizeProxyPool(ready, options);
        const prioritizedCooling = prioritizeProxyPool(cooling, options);
        return prioritizedReady.concat(prioritizedCooling);
    }

    return prioritizeProxyPool(rotated, options);
}

/**
 * Retrocompatibilità sincrona: restituisce il primo proxy disponibile (non usa API Provider on-demand).
 */
export function getProxy(): ProxyConfig | undefined {
    const chain = getProxyFailoverChain();
    return chain[0];
}

export function getIntegrationProxy(options: GetProxyChainOptions = {}): ProxyConfig | undefined {
    const chain = getIntegrationProxyFailoverChain(options);
    return chain[0];
}

/**
 * Esegue un ping TCP sulla porta del proxy per verificare se è raggiungibile.
 * Se IP_REPUTATION_API_KEY è configurata, verifica anche che l'IP non sia
 * in blacklist AbuseIPDB (NEW-15).
 */
export async function checkProxyHealth(proxy: ProxyConfig): Promise<boolean> {
    const tcpOk = await new Promise<boolean>((resolve) => {
        try {
            const url = new URL(proxy.server);
            const port = url.port ? parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80;

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

    if (!tcpOk) return false;

    // NEW-15: IP reputation check (non-bloccante se API key non configurata)
    if (config.ipReputationApiKey) {
        try {
            const { checkIpReputation } = await import('./proxy/ipReputationChecker');
            const reputation = await checkIpReputation(proxy.server);
            if (reputation && !reputation.isSafe) {
                return false;
            }
        } catch {
            // Best-effort: se il check fallisce, procedi comunque
        }
    }

    return true;
}

/**
 * Restituisce il primo proxy disponibile, interpellando l'API Provider se necessario,
 * ed eseguendo anche un health check proattivo prima di restituirlo.
 */
export async function getProxyAsync(options: GetProxyChainOptions = {}): Promise<ProxyConfig | undefined> {
    const chain = await getProxyFailoverChainAsync(options);

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
    const refreshedChain = await getProxyFailoverChainAsync(options);
    return refreshedChain[0];
}

export async function getIntegrationProxyAsync(options: GetProxyChainOptions = {}): Promise<ProxyConfig | undefined> {
    const chain = await getIntegrationProxyFailoverChainAsync(options);

    for (const proxy of chain) {
        const isHealthy = await checkProxyHealth(proxy);
        if (isHealthy) {
            markIntegrationProxyHealthy(proxy);
            return proxy;
        } else {
            console.warn(`[PROXY] Health check fallito per integration proxy: ${proxy.server}`);
            markIntegrationProxyFailed(proxy);
        }
    }

    const refreshedChain = await getIntegrationProxyFailoverChainAsync(options);
    return refreshedChain[0];
}

/**
 * Restituisce o alloca un proxy permanente per una specifica sessionId.
 * Assicura che la sessione usi costantemente lo stesso nodo per non allertare Linkedin con cambi IP anomali.
 */
/**
 * AB-2: Calcola il week number corrente (stessa logica del fingerprint in pool.ts).
 * Lo sticky proxy ruota alla stessa frequenza del fingerprint → geo-consistency.
 */
function currentWeekNumber(): number {
    const now = new Date();
    return Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
}

/** AB-2: Persistenza sticky proxy su file per sopravvivere ai riavvii. */
function loadPersistedStickyProxy(sessionDir: string | undefined): { proxy: ProxyConfig; weekNumber: number } | null {
    if (!sessionDir) return null;
    try {
        const metaPath = path.join(sessionDir, '.session-meta.json');
        if (!fs.existsSync(metaPath)) return null;
        const raw = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
        const sp = raw.stickyProxy as { server?: string; username?: string; password?: string; type?: string; weekNumber?: number } | undefined;
        if (!sp?.server || typeof sp.weekNumber !== 'number') return null;
        return {
            proxy: { server: sp.server, username: sp.username, password: sp.password, type: sp.type as ProxyType },
            weekNumber: sp.weekNumber,
        };
    } catch { return null; }
}

function persistStickyProxy(sessionDir: string | undefined, proxy: ProxyConfig, weekNumber: number): void {
    if (!sessionDir) return;
    try {
        const metaPath = path.join(sessionDir, '.session-meta.json');
        let meta: Record<string, unknown> = {};
        if (fs.existsSync(metaPath)) {
            meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
        }
        meta.stickyProxy = { server: proxy.server, username: proxy.username, password: proxy.password, type: proxy.type, weekNumber };
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    } catch { /* best effort */ }
}

export async function getStickyProxy(
    sessionId: string,
    options: GetProxyChainOptions = {},
    sessionDir?: string,
): Promise<ProxyConfig | undefined> {
    const week = currentWeekNumber();

    // AB-2: Prova a ripristinare il proxy persistito (sopravvive ai riavvii)
    if (!stickyProxySessions.has(sessionId) && sessionDir) {
        const persisted = loadPersistedStickyProxy(sessionDir);
        if (persisted && persisted.weekNumber === week) {
            // Verifica che il proxy persistito sia ancora nel pool
            const pool = loadProxyPool();
            const stillInPool = pool.some(p => p.server === persisted.proxy.server);
            if (stillInPool) {
                stickyProxySessions.set(sessionId, persisted.proxy);
            }
        }
    }

    // 1. Check if we already have a sticky proxy for this session
    const existing = stickyProxySessions.get(sessionId);
    if (existing) {
        const existingType = normalizeProxyType(existing.type, 'unknown');
        const preferred = options.forceMobile ? 'mobile' : options.preferredType;
        if (preferred && existingType !== preferred && existingType !== 'unknown') {
            stickyProxySessions.delete(sessionId);
        } else {
            // Verifichiamo proattivamente anche il proxy sticky
            const isHealthy = await checkProxyHealth(existing);
            if (isHealthy) {
                return existing;
            } else {
                console.warn(
                    `[PROXY] Sticky proxy ${existing.server} per sessione ${sessionId} fallito health check. Ne cerco uno nuovo.`,
                );
                markProxyFailed(existing);
                stickyProxySessions.delete(sessionId);
            }
        }
    }

    // 2. Otherwise allocate a new proxy from the best available chain
    const proxy = await getProxyAsync(options);
    if (proxy) {
        stickyProxySessions.set(sessionId, proxy);
        persistStickyProxy(sessionDir, proxy, week);
    }
    return proxy;
}

export function releaseStickyProxy(sessionId: string): void {
    stickyProxySessions.delete(sessionId);
}

export function markProxyFailed(proxy: ProxyConfig, errorType?: 'timeout' | 'connection_refused' | 'ban' | 'unknown'): void {
    // M34: Cooldown differenziato per tipo di errore.
    // Prima: 10min fissi per qualsiasi errore. Ban IP e timeout hanno gravità molto diverse.
    let cooldownMs: number;
    switch (errorType) {
        case 'ban':
            cooldownMs = 120 * 60_000; // 2h — IP bannato, serve rotazione
            break;
        case 'connection_refused':
            cooldownMs = 15 * 60_000; // 15min — proxy potrebbe riprendersi
            break;
        case 'timeout':
            cooldownMs = 5 * 60_000; // 5min — rete lenta, retry rapido
            break;
        default:
            cooldownMs = config.proxyFailureCooldownMinutes * 60_000;
    }
    proxyFailureUntil.set(proxyKey(proxy), Date.now() + cooldownMs);
}

export function markProxyHealthy(proxy: ProxyConfig): void {
    proxyFailureUntil.delete(proxyKey(proxy));
}

export function markIntegrationProxyFailed(proxy: ProxyConfig): void {
    const cooldownMs = config.proxyFailureCooldownMinutes * 60_000;
    integrationProxyFailureUntil.set(proxyKey(proxy), Date.now() + cooldownMs);
}

export function markIntegrationProxyHealthy(proxy: ProxyConfig): void {
    integrationProxyFailureUntil.delete(proxyKey(proxy));
}

function getPoolStatusInternal(
    cooldownRegistry: Map<string, number>,
    cursor: number,
): ProxyPoolStatus {
    const pool = loadProxyPool();
    if (pool.length === 0) {
        return {
            configured: false,
            total: 0,
            ready: 0,
            cooling: 0,
            mobile: 0,
            residential: 0,
            unknown: 0,
            rotationCursor: 0,
        };
    }

    const now = Date.now();
    let ready = 0;
    let cooling = 0;
    for (const proxy of pool) {
        const cooldownUntil = cooldownRegistry.get(proxyKey(proxy)) ?? 0;
        if (cooldownUntil > now) {
            cooling += 1;
        } else {
            ready += 1;
        }
    }

    const mobile = pool.filter((proxy) => normalizeProxyType(proxy.type, 'unknown') === 'mobile').length;
    const residential = pool.filter((proxy) => normalizeProxyType(proxy.type, 'unknown') === 'residential').length;
    const unknown = Math.max(0, pool.length - mobile - residential);

    return {
        configured: true,
        total: pool.length,
        ready,
        cooling,
        mobile,
        residential,
        unknown,
        rotationCursor: cursor,
    };
}

export function getProxyPoolStatus(): ProxyPoolStatus {
    return getPoolStatusInternal(proxyFailureUntil, rotationCursor);
}

export function getIntegrationProxyPoolStatus(): ProxyPoolStatus {
    return getPoolStatusInternal(integrationProxyFailureUntil, integrationRotationCursor);
}

export interface ProxyQualityStatus {
    pool: ProxyPoolStatus;
    quality: ProxyQualityReport | null;
    ja3: Ja3ValidationReport | null;
}

export async function runProxyQualityCheckIfDue(): Promise<ProxyQualityReport | null> {
    if (!shouldRunQualityCheck()) return getLastQualityReport();

    const pool = loadProxyPool();
    if (pool.length === 0) return null;

    return checkAllProxiesQuality(pool);
}

export async function getProxyQualityStatus(): Promise<ProxyQualityStatus> {
    const pool = getProxyPoolStatus();
    const quality = getLastQualityReport();
    const ja3 = getLastJa3Report();
    return { pool, quality, ja3 };
}

export async function runFullProxyDiagnostic(): Promise<ProxyQualityStatus> {
    const pool = getProxyPoolStatus();

    const proxyList = loadProxyPool();
    const quality = proxyList.length > 0 ? await checkAllProxiesQuality(proxyList) : null;
    const ja3 = await validateJa3Configuration();

    return { pool, quality, ja3 };
}

export function buildProxyUrl(proxy: ProxyConfig): string {
    const base = proxy.server.trim();
    if (!base) return '';
    if (!proxy.username && !proxy.password) {
        return base;
    }

    try {
        const parsed = new URL(base);
        if (proxy.username) {
            parsed.username = encodeURIComponent(proxy.username);
        }
        if (proxy.password) {
            parsed.password = encodeURIComponent(proxy.password);
        }
        return parsed.toString();
    } catch {
        return base;
    }
}
