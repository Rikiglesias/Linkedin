import { config } from '../config';
import { logInfo, logWarn } from '../telemetry/logger';
import type { ProxyConfig } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProxyIpType = 'datacenter' | 'residential' | 'mobile' | 'unknown';

export interface ProxyQualityInfo {
    server: string;
    ip: string;
    type: ProxyIpType;
    asnOrg: string;
    asnNumber: number;
    country: string;
    latencyMs: number;
    score: number;
    checkedAt: string;
}

export interface ProxyQualityReport {
    lastCheckAt: string | null;
    overallScore: number;
    datacenterCount: number;
    residentialCount: number;
    mobileCount: number;
    unknownCount: number;
    proxies: ProxyQualityInfo[];
    degraded: boolean;
}

// ─── ASN-based datacenter detection ───────────────────────────────────────────

const DATACENTER_ASN_KEYWORDS = [
    'amazon', 'aws', 'google', 'gcp', 'microsoft', 'azure',
    'digitalocean', 'linode', 'akamai', 'vultr', 'hetzner',
    'ovh', 'scaleway', 'oracle', 'ibm', 'rackspace',
    'cloudflare', 'fastly', 'leaseweb', 'choopa', 'contabo',
    'hostinger', 'ionos', 'kamatera', 'upcloud', 'cherry servers',
    'data center', 'datacenter', 'hosting', 'server', 'cloud',
    'colocation', 'colo',
];

const MOBILE_ASN_KEYWORDS = [
    'vodafone', 'tim ', 't-mobile', 'verizon', 'at&t',
    'orange', 'telefonica', 'wind', 'iliad', '3 italia',
    'fastweb mobile', 'ho.', 'very mobile', 'kena',
    'mobile', 'wireless', 'cellular', 'lte', '5g',
];

export function classifyAsnOrg(asnOrg: string): ProxyIpType {
    if (!asnOrg) return 'unknown';
    const lower = asnOrg.toLowerCase();

    for (const keyword of MOBILE_ASN_KEYWORDS) {
        if (lower.includes(keyword)) return 'mobile';
    }

    for (const keyword of DATACENTER_ASN_KEYWORDS) {
        if (lower.includes(keyword)) return 'datacenter';
    }

    return 'residential';
}

// ─── Quality score computation ────────────────────────────────────────────────

const TYPE_BASE_SCORES: Record<ProxyIpType, number> = {
    mobile: 90,
    residential: 70,
    datacenter: 20,
    unknown: 40,
};

export function computeQualityScore(type: ProxyIpType, latencyMs: number): number {
    let score = TYPE_BASE_SCORES[type];

    // Latency bonus/penalty
    if (latencyMs > 0 && latencyMs < 500) {
        score += 10;
    } else if (latencyMs >= 500 && latencyMs < 1000) {
        // no change
    } else if (latencyMs >= 1000 && latencyMs < 2000) {
        score -= 10;
    } else if (latencyMs >= 2000) {
        score -= 20;
    }

    return Math.max(0, Math.min(100, score));
}

// ─── In-memory cache (TTL 24h) ───────────────────────────────────────────────

interface CacheEntry {
    info: ProxyQualityInfo;
    expiresAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const asnCache = new Map<string, CacheEntry>();

function getCachedInfo(server: string): ProxyQualityInfo | null {
    const entry = asnCache.get(server);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        asnCache.delete(server);
        return null;
    }
    return entry.info;
}

function setCachedInfo(server: string, info: ProxyQualityInfo): void {
    asnCache.set(server, { info, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── ASN lookup via ip-api.com ────────────────────────────────────────────────

interface IpApiResponse {
    status: string;
    query: string;
    country?: string;
    countryCode?: string;
    org?: string;
    as?: string;
    isp?: string;
    hosting?: boolean;
}

function extractIpFromProxy(server: string): string {
    try {
        const parsed = new URL(server);
        return parsed.hostname;
    } catch {
        return server;
    }
}

function extractAsnNumber(asField: string): number {
    const match = asField.match(/^AS(\d+)/i);
    return match ? parseInt(match[1], 10) : 0;
}

// Rate limit: max 1 request per second to respect free API limits
let lastApiCallMs = 0;

async function rateLimitedFetch(url: string, timeoutMs: number): Promise<Response> {
    const now = Date.now();
    const elapsed = now - lastApiCallMs;
    if (elapsed < 1000) {
        await new Promise((r) => setTimeout(r, 1000 - elapsed));
    }
    lastApiCallMs = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        return response;
    } finally {
        clearTimeout(timeout);
    }
}

async function lookupAsnInfo(
    ip: string,
    apiUrl: string,
): Promise<{ asnOrg: string; asnNumber: number; country: string; isHosting: boolean }> {
    try {
        const url = `${apiUrl.replace(/\/+$/, '')}/${ip}?fields=status,query,country,countryCode,org,as,isp,hosting`;
        const response = await rateLimitedFetch(url, 8000);

        if (!response.ok) {
            return { asnOrg: '', asnNumber: 0, country: '', isHosting: false };
        }

        const data = (await response.json()) as IpApiResponse;
        if (data.status !== 'success') {
            return { asnOrg: '', asnNumber: 0, country: '', isHosting: false };
        }

        return {
            asnOrg: data.org || data.isp || '',
            asnNumber: extractAsnNumber(data.as || ''),
            country: data.countryCode || data.country || '',
            isHosting: data.hosting === true,
        };
    } catch {
        return { asnOrg: '', asnNumber: 0, country: '', isHosting: false };
    }
}

// ─── Latency measurement ──────────────────────────────────────────────────────

async function measureProxyLatency(proxyServer: string): Promise<number> {
    const ip = extractIpFromProxy(proxyServer);
    try {
        const parsed = new URL(proxyServer);
        const port = parsed.port ? parseInt(parsed.port, 10) : 80;
        const start = Date.now();

        const { Socket } = await import('net');
        return await new Promise<number>((resolve) => {
            const socket = new Socket();
            socket.setTimeout(5000);

            socket.on('connect', () => {
                const elapsed = Date.now() - start;
                socket.end();
                resolve(elapsed);
            });

            socket.on('timeout', () => {
                socket.destroy();
                resolve(-1);
            });

            socket.on('error', () => {
                socket.destroy();
                resolve(-1);
            });

            socket.connect(port, ip);
        });
    } catch {
        return -1;
    }
}

// ─── Main check function ─────────────────────────────────────────────────────

export async function checkProxyQuality(proxy: ProxyConfig): Promise<ProxyQualityInfo> {
    const cached = getCachedInfo(proxy.server);
    if (cached) return cached;

    const ip = extractIpFromProxy(proxy.server);
    const apiUrl = config.proxyQualityAsnApiUrl || 'http://ip-api.com/json/';

    const [asnResult, latencyMs] = await Promise.all([
        lookupAsnInfo(ip, apiUrl),
        measureProxyLatency(proxy.server),
    ]);

    // If the API explicitly says "hosting=true", it's datacenter regardless of ASN org text
    let detectedType: ProxyIpType;
    if (asnResult.isHosting) {
        detectedType = 'datacenter';
    } else {
        detectedType = classifyAsnOrg(asnResult.asnOrg);
    }

    const score = computeQualityScore(detectedType, latencyMs);

    const info: ProxyQualityInfo = {
        server: proxy.server,
        ip,
        type: detectedType,
        asnOrg: asnResult.asnOrg,
        asnNumber: asnResult.asnNumber,
        country: asnResult.country,
        latencyMs,
        score,
        checkedAt: new Date().toISOString(),
    };

    setCachedInfo(proxy.server, info);
    return info;
}

// ─── Full pool check ──────────────────────────────────────────────────────────

let lastFullCheckAt: string | null = null;
let lastReport: ProxyQualityReport | null = null;

export async function checkAllProxiesQuality(
    proxies: ProxyConfig[],
): Promise<ProxyQualityReport> {
    if (proxies.length === 0) {
        const emptyReport: ProxyQualityReport = {
            lastCheckAt: new Date().toISOString(),
            overallScore: 0,
            datacenterCount: 0,
            residentialCount: 0,
            mobileCount: 0,
            unknownCount: 0,
            proxies: [],
            degraded: false,
        };
        lastReport = emptyReport;
        lastFullCheckAt = emptyReport.lastCheckAt;
        return emptyReport;
    }

    const results: ProxyQualityInfo[] = [];

    // Sequential to respect rate limit
    for (const proxy of proxies) {
        const info = await checkProxyQuality(proxy);
        results.push(info);
    }

    const totalScore = results.reduce((sum, r) => sum + r.score, 0);
    const overallScore = Math.round(totalScore / results.length);
    const minScore = config.proxyQualityMinScore;

    const report: ProxyQualityReport = {
        lastCheckAt: new Date().toISOString(),
        overallScore,
        datacenterCount: results.filter((r) => r.type === 'datacenter').length,
        residentialCount: results.filter((r) => r.type === 'residential').length,
        mobileCount: results.filter((r) => r.type === 'mobile').length,
        unknownCount: results.filter((r) => r.type === 'unknown').length,
        proxies: results,
        degraded: overallScore < minScore,
    };

    lastReport = report;
    lastFullCheckAt = report.lastCheckAt;

    if (report.degraded) {
        await logWarn('proxy.quality.degraded', {
            overallScore,
            minScore,
            datacenterCount: report.datacenterCount,
            totalProxies: results.length,
        });
    } else {
        await logInfo('proxy.quality.check_complete', {
            overallScore,
            totalProxies: results.length,
            datacenterCount: report.datacenterCount,
            residentialCount: report.residentialCount,
            mobileCount: report.mobileCount,
        });
    }

    return report;
}

// ─── Scheduled check with interval ───────────────────────────────────────────

export function shouldRunQualityCheck(): boolean {
    if (!config.proxyQualityCheckEnabled) return false;
    if (!lastFullCheckAt) return true;

    const intervalMs = config.proxyQualityCheckIntervalMinutes * 60_000;
    const elapsed = Date.now() - new Date(lastFullCheckAt).getTime();
    return elapsed >= intervalMs;
}

export function getLastQualityReport(): ProxyQualityReport | null {
    return lastReport;
}

