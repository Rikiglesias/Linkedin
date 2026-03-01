import { config } from '../config';
import { ProxyConfig } from '../proxyManager';
import { logInfo, logWarn } from '../telemetry/logger';

interface CycleTlsServerOptions {
    port: number;
    ja3: string;
    userAgent: string;
    proxy?: string;
}

interface CycleTlsServerHandle {
    close?: () => void | Promise<void>;
    stop?: () => void | Promise<void>;
    shutdown?: () => void | Promise<void>;
}

interface CycleTlsClient {
    server: (options: CycleTlsServerOptions) => CycleTlsServerHandle | Promise<CycleTlsServerHandle>;
    exit?: () => void | Promise<void>;
}

export interface CycleTlsStartOptions {
    upstreamProxy?: ProxyConfig;
    explicitUpstreamUrl?: string;
}

let cycleTlsClient: CycleTlsClient | null = null;
let cycleTlsServer: CycleTlsServerHandle | null = null;
let cycleTlsSignature = '';
let cycleTlsBootPromise: Promise<void> | null = null;

function buildProxyUrl(proxy: ProxyConfig): string {
    const base = proxy.server.trim();
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

function resolveUpstreamProxyUrl(options: CycleTlsStartOptions): string {
    const explicit = options.explicitUpstreamUrl?.trim();
    if (explicit) {
        return explicit;
    }

    if (options.upstreamProxy) {
        return buildProxyUrl(options.upstreamProxy);
    }

    const fromConfig = config.ja3ProxyUpstream.trim();
    if (fromConfig) {
        return fromConfig;
    }

    return '';
}

function buildSignature(options: CycleTlsStartOptions): string {
    const upstream = resolveUpstreamProxyUrl(options);
    return [
        config.ja3ProxyPort,
        config.ja3Fingerprint,
        config.ja3UserAgent,
        upstream,
    ].join('|');
}

async function closeServerHandle(server: CycleTlsServerHandle | null): Promise<void> {
    if (!server) return;
    if (typeof server.close === 'function') {
        await server.close();
        return;
    }
    if (typeof server.stop === 'function') {
        await server.stop();
        return;
    }
    if (typeof server.shutdown === 'function') {
        await server.shutdown();
    }
}

async function loadCycleTlsClient(): Promise<CycleTlsClient> {
    try {
        const dynamicImport = new Function('modulePath', 'return import(modulePath)') as (modulePath: string) => Promise<unknown>;
        const module = await dynamicImport('@ikechan8370/cycletls') as Record<string, unknown>;
        const init = (module.default ?? module) as unknown as () => Promise<CycleTlsClient>;
        return init();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('@ikechan8370/cycletls') || message.includes('Cannot find module')) {
            throw new Error('Modulo @ikechan8370/cycletls non installato. Esegui: npm install @ikechan8370/cycletls');
        }
        throw error;
    }
}

export function getCycleTlsProxyEndpoint(): string {
    return `http://127.0.0.1:${config.ja3ProxyPort}`;
}

export function isCycleTlsProxyRunning(): boolean {
    return !!cycleTlsClient;
}

export async function stopCycleTlsProxy(): Promise<void> {
    const currentServer = cycleTlsServer;
    const currentClient = cycleTlsClient;
    cycleTlsServer = null;
    cycleTlsClient = null;
    cycleTlsSignature = '';
    cycleTlsBootPromise = null;

    await closeServerHandle(currentServer).catch(() => { });
    if (currentClient?.exit) {
        await Promise.resolve(currentClient.exit()).catch(() => { });
    }
}

export async function startCycleTlsProxy(options: CycleTlsStartOptions = {}): Promise<void> {
    if (!config.useJa3Proxy) {
        return;
    }

    const targetSignature = buildSignature(options);
    if (cycleTlsClient && cycleTlsSignature === targetSignature) {
        return;
    }

    if (cycleTlsBootPromise) {
        await cycleTlsBootPromise;
        if (cycleTlsClient && cycleTlsSignature === targetSignature) {
            return;
        }
    }

    cycleTlsBootPromise = (async () => {
        if (cycleTlsClient && cycleTlsSignature !== targetSignature) {
            await stopCycleTlsProxy();
        }

        const client = await loadCycleTlsClient();
        const upstream = resolveUpstreamProxyUrl(options);
        const serverOptions: CycleTlsServerOptions = {
            port: config.ja3ProxyPort,
            ja3: config.ja3Fingerprint,
            userAgent: config.ja3UserAgent,
        };
        if (upstream) {
            serverOptions.proxy = upstream;
        }

        const server = await Promise.resolve(client.server(serverOptions));
        cycleTlsClient = client;
        cycleTlsServer = server;
        cycleTlsSignature = targetSignature;

        await logInfo('proxy.cycletls.started', {
            endpoint: getCycleTlsProxyEndpoint(),
            upstream: upstream || null,
        });
        console.log(`[CycleTLS] Proxy in ascolto su ${getCycleTlsProxyEndpoint()}`);
    })();

    try {
        await cycleTlsBootPromise;
    } catch (error) {
        cycleTlsBootPromise = null;
        cycleTlsClient = null;
        cycleTlsServer = null;
        cycleTlsSignature = '';
        await logWarn('proxy.cycletls.start_failed', {
            message: error instanceof Error ? error.message : String(error),
        });
        throw error;
    } finally {
        cycleTlsBootPromise = null;
    }
}

export async function ensureCycleTlsProxy(options: CycleTlsStartOptions = {}): Promise<string | null> {
    if (!config.useJa3Proxy) {
        return null;
    }
    await startCycleTlsProxy(options);
    return getCycleTlsProxyEndpoint();
}
