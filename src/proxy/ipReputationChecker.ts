/**
 * proxy/ipReputationChecker.ts
 * ─────────────────────────────────────────────────────────────────
 * Verifica la reputazione IP dei proxy via AbuseIPDB API.
 * Cache 24h per IP per non sprecare quota (free tier: 1000 req/day).
 *
 * Un proxy con IP in blacklist LinkedIn è uno spreco di sessione:
 * il bot viene immediatamente rate-limitato o bloccato.
 */

import { config } from '../config';
import { logInfo, logWarn } from '../telemetry/logger';

export interface IpReputationResult {
    ip: string;
    abuseConfidenceScore: number;
    countryCode: string;
    isp: string;
    isWhitelisted: boolean;
    totalReports: number;
    isSafe: boolean;
    checkedAt: string;
    fromCache: boolean;
}

// Cache 24h per IP
const reputationCache = new Map<string, { result: IpReputationResult; expiresAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function extractIpFromProxyServer(server: string): string | null {
    try {
        // Formati: http://1.2.3.4:8080, socks5://host:port, host:port
        const cleaned = server.replace(/^(https?|socks[45]):\/\//i, '');
        const host = cleaned.split(':')[0] ?? '';
        // Verifica che sia un IP (non un hostname)
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
            return host;
        }
        return null; // È un hostname, non possiamo fare lookup diretto
    } catch {
        return null;
    }
}

/**
 * Controlla la reputazione di un IP via AbuseIPDB.
 * Restituisce null se l'API key non è configurata o se l'IP non è risolvibile.
 */
export async function checkIpReputation(proxyServer: string): Promise<IpReputationResult | null> {
    if (!config.ipReputationApiKey) return null;

    const ip = extractIpFromProxyServer(proxyServer);
    if (!ip) return null;

    // Check cache
    const cached = reputationCache.get(ip);
    if (cached && cached.expiresAt > Date.now()) {
        return { ...cached.result, fromCache: true };
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(
            `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`,
            {
                headers: {
                    Key: config.ipReputationApiKey,
                    Accept: 'application/json',
                },
                signal: controller.signal,
            },
        );
        clearTimeout(timeout);

        if (!response.ok) {
            await logWarn('ip_reputation.api_error', { ip, status: response.status });
            return null;
        }

        const body = (await response.json()) as {
            data?: {
                abuseConfidenceScore?: number;
                countryCode?: string;
                isp?: string;
                isWhitelisted?: boolean;
                totalReports?: number;
            };
        };

        const data = body.data;
        if (!data) return null;

        const abuseScore = data.abuseConfidenceScore ?? 0;
        const result: IpReputationResult = {
            ip,
            abuseConfidenceScore: abuseScore,
            countryCode: data.countryCode ?? 'XX',
            isp: data.isp ?? 'unknown',
            isWhitelisted: data.isWhitelisted ?? false,
            totalReports: data.totalReports ?? 0,
            isSafe: abuseScore <= config.ipReputationMaxAbuseScore,
            checkedAt: new Date().toISOString(),
            fromCache: false,
        };

        // Cache result
        reputationCache.set(ip, { result, expiresAt: Date.now() + CACHE_TTL_MS });

        if (!result.isSafe) {
            await logWarn('ip_reputation.blacklisted', {
                ip,
                abuseScore,
                totalReports: result.totalReports,
                isp: result.isp,
                countryCode: result.countryCode,
                threshold: config.ipReputationMaxAbuseScore,
            });
        } else {
            await logInfo('ip_reputation.clean', {
                ip,
                abuseScore,
                countryCode: result.countryCode,
                isp: result.isp,
            });
        }

        return result;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (!msg.includes('abort')) {
            await logWarn('ip_reputation.check_failed', { ip, error: msg });
        }
        return null;
    }
}

/**
 * Pulisce la cache delle reputazioni IP scadute.
 */
export function cleanExpiredReputationCache(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [ip, entry] of reputationCache) {
        if (entry.expiresAt <= now) {
            reputationCache.delete(ip);
            cleaned++;
        }
    }
    return cleaned;
}

export function getReputationCacheSize(): number {
    return reputationCache.size;
}
