import * as net from 'net';
import { config } from '../config';
import { logInfo, logWarn } from '../telemetry/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Ja3Status = 'SECURE' | 'GAP' | 'DIRECT';

export interface Ja3ValidationReport {
    status: Ja3Status;
    cycleTlsActive: boolean;
    cycleTlsPort: number;
    useJa3ProxyConfigured: boolean;
    ja3FingerprintConfigured: boolean;
    uaBrowserFamily: string;
    ja3BrowserFamily: string;
    uaJa3Coherent: boolean;
    recommendation: string;
    checkedAt: string;
}

// ─── Browser family detection from User-Agent ─────────────────────────────────

type BrowserFamily = 'chrome' | 'firefox' | 'safari' | 'edge' | 'unknown';

export function detectBrowserFamily(userAgent: string): BrowserFamily {
    if (!userAgent) return 'unknown';
    const ua = userAgent.toLowerCase();

    // Order matters: Edge contains "chrome", Safari iOS contains "safari" but also "crios"
    if (ua.includes('edg/') || ua.includes('edge/')) return 'edge';
    if (ua.includes('firefox/') || ua.includes('gecko/')) return 'firefox';
    if (ua.includes('crios/')) return 'chrome'; // Chrome on iOS
    if (ua.includes('chrome/') || ua.includes('chromium/')) return 'chrome';
    if (ua.includes('safari/') && !ua.includes('chrome/')) return 'safari';

    return 'unknown';
}

// ─── JA3 fingerprint → browser family mapping ────────────────────────────────

// Known JA3 fingerprint prefixes per browser family.
// JA3 format: TLSVersion,Ciphers,Extensions,EllipticCurves,EllipticCurvePointFormats
// Chrome and Edge share the same TLS stack → same ciphers order.
// Firefox has a distinct cipher suite ordering.

const JA3_CHROME_CIPHERS_PREFIX = '4865-4866-4867-49195-49199-49196-49200';
const JA3_FIREFOX_CIPHERS_PREFIX = '4865-4867-4866-49195-49199-52393-52392-49196-49200';
const JA3_SAFARI_CIPHERS_PREFIX = '4865-4866-4867-49196-49195';

export function detectJa3BrowserFamily(ja3: string): BrowserFamily {
    if (!ja3) return 'unknown';

    // Extract ciphers section (second field, comma-separated)
    const parts = ja3.split(',');
    if (parts.length < 2) return 'unknown';
    const ciphers = parts[1] ?? '';

    if (ciphers.startsWith(JA3_SAFARI_CIPHERS_PREFIX)) return 'safari';
    if (ciphers.startsWith(JA3_FIREFOX_CIPHERS_PREFIX)) return 'firefox';
    if (ciphers.startsWith(JA3_CHROME_CIPHERS_PREFIX)) return 'chrome'; // Also matches Edge

    return 'unknown';
}

// ─── UA ↔ JA3 coherence check ────────────────────────────────────────────────

export function isUaJa3Coherent(uaFamily: BrowserFamily, ja3Family: BrowserFamily): boolean {
    if (uaFamily === 'unknown' || ja3Family === 'unknown') return true; // Can't determine → assume ok
    // Edge uses Chrome TLS stack → coherent
    if (uaFamily === 'edge' && ja3Family === 'chrome') return true;
    return uaFamily === ja3Family;
}

// ─── CycleTLS port reachability check ─────────────────────────────────────────

async function isCycleTlsReachable(port: number, timeoutMs: number = 3000): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(timeoutMs);

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

        socket.connect(port, '127.0.0.1');
    });
}

// ─── Main validation function ─────────────────────────────────────────────────

let lastReport: Ja3ValidationReport | null = null;

export async function validateJa3Configuration(): Promise<Ja3ValidationReport> {
    const useJa3Proxy = config.useJa3Proxy;
    const ja3Fingerprint = config.ja3Fingerprint;
    const ja3UserAgent = config.ja3UserAgent;
    const ja3Port = config.ja3ProxyPort;
    const hasProxy = !!config.proxyUrl || !!config.proxyListPath;

    const uaFamily = detectBrowserFamily(ja3UserAgent);
    const ja3Family = detectJa3BrowserFamily(ja3Fingerprint);
    const coherent = isUaJa3Coherent(uaFamily, ja3Family);

    // Check if CycleTLS proxy is actually running
    let cycleTlsActive = false;
    if (useJa3Proxy) {
        cycleTlsActive = await isCycleTlsReachable(ja3Port);
    }

    // Determine status
    let status: Ja3Status;
    let recommendation: string;

    if (cycleTlsActive && coherent) {
        status = 'SECURE';
        recommendation = 'JA3 spoofing attivo e coerente con User-Agent — configurazione ottimale';
    } else if (cycleTlsActive && !coherent) {
        status = 'GAP';
        recommendation = `Incoerenza UA↔JA3: UA=${uaFamily} ma JA3=${ja3Family}. Allineare JA3_USER_AGENT con il fingerprint JA3 configurato`;
    } else if (useJa3Proxy && !cycleTlsActive) {
        status = 'GAP';
        recommendation = `USE_JA3_PROXY=true ma CycleTLS non raggiungibile su porta ${ja3Port}. Avviare CycleTLS o disabilitare USE_JA3_PROXY`;
    } else if (hasProxy && !useJa3Proxy) {
        status = 'GAP';
        recommendation =
            'Proxy configurato ma JA3 spoofing disabilitato — LinkedIn può rilevare incoerenza UA↔TLS fingerprint. Configurare CycleTLS e abilitare USE_JA3_PROXY';
    } else {
        status = 'DIRECT';
        recommendation =
            'Connessione diretta senza proxy — JA3 spoofing non applicabile. Configurare proxy residenziali per anti-ban';
    }

    const report: Ja3ValidationReport = {
        status,
        cycleTlsActive,
        cycleTlsPort: ja3Port,
        useJa3ProxyConfigured: useJa3Proxy,
        ja3FingerprintConfigured: !!ja3Fingerprint,
        uaBrowserFamily: uaFamily,
        ja3BrowserFamily: ja3Family,
        uaJa3Coherent: coherent,
        recommendation,
        checkedAt: new Date().toISOString(),
    };

    // Log status
    if (status === 'SECURE') {
        await logInfo('proxy.ja3.validation', { status, uaFamily, ja3Family });
    } else if (status === 'GAP') {
        await logWarn('proxy.ja3.validation_gap', { status, recommendation, uaFamily, ja3Family, cycleTlsActive });
    }

    lastReport = report;
    return report;
}

export function getLastJa3Report(): Ja3ValidationReport | null {
    return lastReport;
}
