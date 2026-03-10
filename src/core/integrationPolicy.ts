import { config, ProxyType } from '../config';
import { sleep } from '../utils/async';
import {
    buildProxyUrl,
    getIntegrationProxyAsync,
    markIntegrationProxyFailed,
    markIntegrationProxyHealthy,
    type ProxyConfig,
} from '../proxyManager';
import { getRuntimeFlag, setRuntimeFlag } from './repositories';

export type RetryClassification = 'transient' | 'terminal';
export type CircuitBreakerStatus = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitOpenError extends Error {
    readonly circuitKey: string;
    readonly retryAfterMs: number;

    constructor(circuitKey: string, retryAfterMs: number) {
        super(`Circuit breaker aperto per "${circuitKey}". Retry after ${retryAfterMs}ms.`);
        this.name = 'CircuitOpenError';
        this.circuitKey = circuitKey;
        this.retryAfterMs = retryAfterMs;
    }
}

interface CircuitState {
    status: CircuitBreakerStatus;
    consecutiveFailures: number;
    openUntilMs: number;
    halfOpenProbeInFlight: boolean;
    openedCount: number;
    halfOpenCount: number;
    closedCount: number;
    blockedCount: number;
    totalFailures: number;
    totalSuccesses: number;
    lastFailureAtMs: number;
    lastSuccessAtMs: number;
    lastTransitionAtMs: number;
    lastError: string | null;
}

const circuitStates = new Map<string, CircuitState>();
const circuitLoadedFromDb = new Set<string>();

const CB_FLAG_PREFIX = 'cb::';

interface PersistedCircuitState {
    status: CircuitBreakerStatus;
    openUntilMs: number;
    totalFailures: number;
    totalSuccesses: number;
    lastError: string | null;
    lastTransitionAtMs: number;
}

function persistCircuitStateAsync(circuitKey: string, state: CircuitState): void {
    const payload: PersistedCircuitState = {
        status: state.status,
        openUntilMs: state.openUntilMs,
        totalFailures: state.totalFailures,
        totalSuccesses: state.totalSuccesses,
        lastError: state.lastError,
        lastTransitionAtMs: state.lastTransitionAtMs,
    };
    setRuntimeFlag(`${CB_FLAG_PREFIX}${circuitKey}`, JSON.stringify(payload)).catch(() => {});
}

async function loadCircuitStateFromDb(circuitKey: string): Promise<CircuitState | null> {
    try {
        const raw = await getRuntimeFlag(`${CB_FLAG_PREFIX}${circuitKey}`);
        if (!raw) return null;
        const persisted = JSON.parse(raw) as PersistedCircuitState;
        const now = Date.now();
        let status = persisted.status;
        let openUntilMs = persisted.openUntilMs;
        if (status === 'OPEN' && openUntilMs <= now) {
            status = 'HALF_OPEN';
            openUntilMs = 0;
        }
        return {
            status,
            consecutiveFailures: 0,
            openUntilMs,
            halfOpenProbeInFlight: false,
            openedCount: 0,
            halfOpenCount: 0,
            closedCount: 0,
            blockedCount: 0,
            totalFailures: persisted.totalFailures,
            totalSuccesses: persisted.totalSuccesses,
            lastFailureAtMs: 0,
            lastSuccessAtMs: 0,
            lastTransitionAtMs: persisted.lastTransitionAtMs,
            lastError: persisted.lastError,
        };
    } catch {
        return null;
    }
}

interface CircuitAttemptAccess {
    allowed: boolean;
    retryAfterMs: number;
    halfOpenProbe: boolean;
}

export interface CircuitBreakerSnapshotRow {
    key: string;
    status: CircuitBreakerStatus;
    consecutiveFailures: number;
    openUntilMs: number;
    halfOpenProbeInFlight: boolean;
    openedCount: number;
    halfOpenCount: number;
    closedCount: number;
    blockedCount: number;
    totalFailures: number;
    totalSuccesses: number;
    lastFailureAtMs: number;
    lastSuccessAtMs: number;
    lastTransitionAtMs: number;
    lastError: string | null;
}

export interface RetryPolicyOptions {
    integration: string;
    circuitKey?: string;
    timeoutMs?: number;
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    classifyError?: (error: unknown) => RetryClassification;
    classifyResponse?: (response: Response) => RetryClassification;
    proxyMode?: 'none' | 'integration_pool';
    proxyPreferredType?: ProxyType;
    proxyForceMobile?: boolean;
}

const DEFAULT_TRANSIENT_HTTP_STATUS = new Set<number>([408, 425, 429, 500, 502, 503, 504]);

function computeDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
    const exponent = Math.max(0, attempt - 1);
    const base = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, exponent));
    const jitter = Math.floor(Math.random() * Math.max(50, Math.floor(base * 0.25)));
    return Math.min(maxDelayMs, base + jitter);
}

function createTimedAbortController(
    parent: AbortSignal | null | undefined,
    timeoutMs: number,
): {
    signal: AbortSignal;
    cleanup: () => void;
} {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Integration timeout')), timeoutMs);

    const onAbort = () => controller.abort(parent?.reason);
    if (parent) {
        if (parent.aborted) {
            controller.abort(parent.reason);
        } else {
            parent.addEventListener('abort', onAbort, { once: true });
        }
    }

    return {
        signal: controller.signal,
        cleanup: () => {
            clearTimeout(timeout);
            if (parent) {
                parent.removeEventListener('abort', onAbort);
            }
        },
    };
}

async function createProxyDispatcher(proxy: ProxyConfig): Promise<{
    dispatcher: unknown | null;
    close: () => Promise<void>;
}> {
    const proxyUrl = buildProxyUrl(proxy);
    if (!proxyUrl) {
        return {
            dispatcher: null,
            close: async () => {},
        };
    }

    try {
        const dynamicImporter = new Function('specifier', 'return import(specifier)') as (
            specifier: string,
        ) => Promise<unknown>;
        const undiciModule = await dynamicImporter('undici');
        const ProxyAgentCtor = (undiciModule as unknown as { ProxyAgent?: new (proxy: string) => unknown }).ProxyAgent;
        if (typeof ProxyAgentCtor !== 'function') {
            return {
                dispatcher: null,
                close: async () => {},
            };
        }
        const dispatcher = new ProxyAgentCtor(proxyUrl) as {
            close?: () => Promise<void> | void;
            destroy?: () => void;
        };
        return {
            dispatcher,
            close: async () => {
                if (typeof dispatcher.close === 'function') {
                    await dispatcher.close();
                    return;
                }
                if (typeof dispatcher.destroy === 'function') {
                    dispatcher.destroy();
                }
            },
        };
    } catch {
        return {
            dispatcher: null,
            close: async () => {},
        };
    }
}

function ensureCircuitState(circuitKey: string): CircuitState {
    const existing = circuitStates.get(circuitKey);
    if (existing) {
        return existing;
    }
    const created: CircuitState = {
        status: 'CLOSED',
        consecutiveFailures: 0,
        openUntilMs: 0,
        halfOpenProbeInFlight: false,
        openedCount: 0,
        halfOpenCount: 0,
        closedCount: 0,
        blockedCount: 0,
        totalFailures: 0,
        totalSuccesses: 0,
        lastFailureAtMs: 0,
        lastSuccessAtMs: 0,
        lastTransitionAtMs: 0,
        lastError: null,
    };
    circuitStates.set(circuitKey, created);
    if (!circuitLoadedFromDb.has(circuitKey)) {
        circuitLoadedFromDb.add(circuitKey);
        loadCircuitStateFromDb(circuitKey).then((persisted) => {
            if (!persisted) return;
            const current = circuitStates.get(circuitKey);
            if (!current || current.lastTransitionAtMs > 0) return;
            Object.assign(current, persisted);
        }).catch(() => {});
    }
    return created;
}

function transitionCircuitState(state: CircuitState, status: CircuitBreakerStatus): void {
    if (state.status !== status) {
        state.status = status;
        state.lastTransitionAtMs = Date.now();
    }
}

function openCircuit(state: CircuitState, now: number, circuitKey?: string): void {
    transitionCircuitState(state, 'OPEN');
    state.openedCount += 1;
    state.openUntilMs = now + config.integrationCircuitOpenMs;
    state.consecutiveFailures = 0;
    state.halfOpenProbeInFlight = false;
    if (circuitKey) persistCircuitStateAsync(circuitKey, state);
}

function closeCircuit(state: CircuitState, circuitKey?: string): void {
    transitionCircuitState(state, 'CLOSED');
    state.closedCount += 1;
    state.consecutiveFailures = 0;
    state.openUntilMs = 0;
    state.halfOpenProbeInFlight = false;
    if (circuitKey) persistCircuitStateAsync(circuitKey, state);
}

function moveToHalfOpen(state: CircuitState): void {
    transitionCircuitState(state, 'HALF_OPEN');
    state.halfOpenCount += 1;
    state.openUntilMs = 0;
    state.halfOpenProbeInFlight = false;
}

function acquireCircuitAttempt(circuitKey: string): CircuitAttemptAccess {
    if (!config.integrationCircuitBreakerEnabled) {
        return {
            allowed: true,
            retryAfterMs: 0,
            halfOpenProbe: false,
        };
    }

    const now = Date.now();
    const state = ensureCircuitState(circuitKey);

    if (state.status === 'OPEN') {
        if (state.openUntilMs > now) {
            state.blockedCount += 1;
            return {
                allowed: false,
                retryAfterMs: state.openUntilMs - now,
                halfOpenProbe: false,
            };
        }
        moveToHalfOpen(state);
    }

    if (state.status === 'HALF_OPEN') {
        if (state.halfOpenProbeInFlight) {
            state.blockedCount += 1;
            return {
                allowed: false,
                retryAfterMs: Math.max(1, config.integrationCircuitOpenMs),
                halfOpenProbe: false,
            };
        }
        state.halfOpenProbeInFlight = true;
        return {
            allowed: true,
            retryAfterMs: 0,
            halfOpenProbe: true,
        };
    }

    return {
        allowed: true,
        retryAfterMs: 0,
        halfOpenProbe: false,
    };
}

function registerCircuitFailure(circuitKey: string, error: unknown, access: CircuitAttemptAccess): void {
    if (!config.integrationCircuitBreakerEnabled) {
        return;
    }

    const now = Date.now();
    const state = ensureCircuitState(circuitKey);
    state.totalFailures += 1;
    state.lastFailureAtMs = now;
    state.lastError = error instanceof Error ? error.message : String(error);

    if (access.halfOpenProbe || state.status === 'HALF_OPEN') {
        openCircuit(state, now, circuitKey);
        return;
    }

    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= config.integrationCircuitFailureThreshold) {
        openCircuit(state, now, circuitKey);
    }
}

function registerCircuitSuccess(circuitKey: string, access: CircuitAttemptAccess): void {
    if (!config.integrationCircuitBreakerEnabled) {
        return;
    }

    const now = Date.now();
    const state = ensureCircuitState(circuitKey);
    state.totalSuccesses += 1;
    state.lastSuccessAtMs = now;
    state.lastError = null;

    if (access.halfOpenProbe || state.status === 'HALF_OPEN') {
        closeCircuit(state, circuitKey);
        return;
    }

    state.consecutiveFailures = 0;
    state.openUntilMs = 0;
}

function releaseHalfOpenProbeOnTerminal(circuitKey: string, access: CircuitAttemptAccess): void {
    if (!config.integrationCircuitBreakerEnabled || !access.halfOpenProbe) {
        return;
    }
    const state = circuitStates.get(circuitKey);
    if (!state || state.status !== 'HALF_OPEN') {
        return;
    }
    closeCircuit(state, circuitKey);
}

export function isTransientHttpStatus(status: number): boolean {
    return DEFAULT_TRANSIENT_HTTP_STATUS.has(status);
}

export function isLikelyTransientError(error: unknown): boolean {
    if (error instanceof CircuitOpenError) {
        return false;
    }
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    if (normalized.includes('http transient')) {
        return true;
    }
    return (
        normalized.includes('timeout') ||
        normalized.includes('timed out') ||
        normalized.includes('network') ||
        normalized.includes('fetch failed') ||
        normalized.includes('econnreset') ||
        normalized.includes('econnrefused') ||
        normalized.includes('enotfound') ||
        normalized.includes('eai_again') ||
        normalized.includes('socket hang up') ||
        normalized.includes('temporarily unavailable')
    );
}

export async function executeWithRetryPolicy<T>(
    operation: (attempt: number) => Promise<T>,
    options: RetryPolicyOptions,
): Promise<T> {
    const maxAttempts = Math.max(1, options.maxAttempts ?? config.integrationRetryMaxAttempts);
    const baseDelayMs = Math.max(50, options.baseDelayMs ?? config.retryBaseMs);
    const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? config.integrationRetryMaxDelayMs);
    const circuitKey = options.circuitKey ?? options.integration;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const circuitAccess = acquireCircuitAttempt(circuitKey);
        if (!circuitAccess.allowed) {
            throw new CircuitOpenError(circuitKey, circuitAccess.retryAfterMs);
        }
        try {
            const result = await operation(attempt);
            registerCircuitSuccess(circuitKey, circuitAccess);
            return result;
        } catch (error) {
            lastError = error;
            const classification = options.classifyError
                ? options.classifyError(error)
                : isLikelyTransientError(error)
                  ? 'transient'
                  : 'terminal';
            if (classification === 'terminal') {
                releaseHalfOpenProbeOnTerminal(circuitKey, circuitAccess);
                throw error;
            }
            registerCircuitFailure(circuitKey, error, circuitAccess);
            if (attempt >= maxAttempts) {
                break;
            }
            await sleep(computeDelayMs(attempt, baseDelayMs, maxDelayMs));
        }
    }

    throw lastError instanceof Error ? lastError : new Error(`${options.integration}: retry exhausted`);
}

export async function fetchWithRetryPolicy(
    url: string,
    init: RequestInit,
    options: RetryPolicyOptions,
): Promise<Response> {
    const timeoutMs = Math.max(250, options.timeoutMs ?? config.integrationRequestTimeoutMs);
    const classifyResponse =
        options.classifyResponse ??
        ((response: Response) => (isTransientHttpStatus(response.status) ? 'transient' : 'terminal'));
    const proxyMode: 'none' | 'integration_pool' =
        options.proxyMode ?? (config.integrationProxyPoolEnabled ? 'integration_pool' : 'none');

    return executeWithRetryPolicy<Response>(
        async () => {
            const controller = createTimedAbortController(init.signal, timeoutMs);
            let selectedProxy: ProxyConfig | undefined;
            let proxyDispatcherClose: (() => Promise<void>) | null = null;
            try {
                let requestInit: RequestInit & { dispatcher?: unknown } = {
                    ...init,
                    signal: controller.signal,
                };
                if (proxyMode === 'integration_pool') {
                    selectedProxy = await getIntegrationProxyAsync({
                        preferredType: options.proxyPreferredType,
                        forceMobile: options.proxyForceMobile,
                    });
                    if (selectedProxy) {
                        const proxyDispatcher = await createProxyDispatcher(selectedProxy);
                        if (proxyDispatcher.dispatcher) {
                            requestInit = {
                                ...requestInit,
                                dispatcher: proxyDispatcher.dispatcher,
                            };
                            proxyDispatcherClose = proxyDispatcher.close;
                        }
                    }
                }
                const response = await fetch(url, requestInit);
                const classification = classifyResponse(response);
                if (classification === 'transient') {
                    if (selectedProxy) {
                        markIntegrationProxyFailed(selectedProxy);
                    }
                    throw new Error(`HTTP transient ${response.status}`);
                }
                if (selectedProxy) {
                    markIntegrationProxyHealthy(selectedProxy);
                }
                return response;
            } catch (error) {
                if (selectedProxy && isLikelyTransientError(error)) {
                    markIntegrationProxyFailed(selectedProxy);
                }
                throw error;
            } finally {
                if (proxyDispatcherClose) {
                    await proxyDispatcherClose().catch(() => null);
                }
                controller.cleanup();
            }
        },
        {
            ...options,
            classifyError: options.classifyError ?? ((error) => (isLikelyTransientError(error) ? 'transient' : 'terminal')),
        },
    );
}

export function getCircuitBreakerSnapshot(): CircuitBreakerSnapshotRow[] {
    const rows: CircuitBreakerSnapshotRow[] = [];
    for (const [key, value] of circuitStates.entries()) {
        rows.push({
            key,
            status: value.status,
            consecutiveFailures: value.consecutiveFailures,
            openUntilMs: value.openUntilMs,
            halfOpenProbeInFlight: value.halfOpenProbeInFlight,
            openedCount: value.openedCount,
            halfOpenCount: value.halfOpenCount,
            closedCount: value.closedCount,
            blockedCount: value.blockedCount,
            totalFailures: value.totalFailures,
            totalSuccesses: value.totalSuccesses,
            lastFailureAtMs: value.lastFailureAtMs,
            lastSuccessAtMs: value.lastSuccessAtMs,
            lastTransitionAtMs: value.lastTransitionAtMs,
            lastError: value.lastError,
        });
    }
    return rows.sort((a, b) => a.key.localeCompare(b.key));
}

export function resetCircuitBreakersForTests(): void {
    circuitStates.clear();
    circuitLoadedFromDb.clear();
}
