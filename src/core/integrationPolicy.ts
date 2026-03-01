import { config } from '../config';

export type RetryClassification = 'transient' | 'terminal';

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
    consecutiveFailures: number;
    openUntilMs: number;
}

const circuitStates = new Map<string, CircuitState>();

export interface RetryPolicyOptions {
    integration: string;
    circuitKey?: string;
    timeoutMs?: number;
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    classifyError?: (error: unknown) => RetryClassification;
    classifyResponse?: (response: Response) => RetryClassification;
}

const DEFAULT_TRANSIENT_HTTP_STATUS = new Set<number>([408, 425, 429, 500, 502, 503, 504]);

function computeDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
    const exponent = Math.max(0, attempt - 1);
    const base = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, exponent));
    const jitter = Math.floor(Math.random() * Math.max(50, Math.floor(base * 0.25)));
    return Math.min(maxDelayMs, base + jitter);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTimedAbortController(parent: AbortSignal | null | undefined, timeoutMs: number): {
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

function isCircuitBreakerOpen(circuitKey: string): number | null {
    if (!config.integrationCircuitBreakerEnabled) {
        return null;
    }
    const state = circuitStates.get(circuitKey);
    if (!state) return null;
    const now = Date.now();
    if (state.openUntilMs > now) {
        return state.openUntilMs - now;
    }
    return null;
}

function registerCircuitFailure(circuitKey: string): void {
    if (!config.integrationCircuitBreakerEnabled) {
        return;
    }
    const now = Date.now();
    const state = circuitStates.get(circuitKey) ?? { consecutiveFailures: 0, openUntilMs: 0 };
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= config.integrationCircuitFailureThreshold) {
        state.openUntilMs = now + config.integrationCircuitOpenMs;
        state.consecutiveFailures = 0;
    }
    circuitStates.set(circuitKey, state);
}

function registerCircuitSuccess(circuitKey: string): void {
    if (!config.integrationCircuitBreakerEnabled) {
        return;
    }
    circuitStates.set(circuitKey, { consecutiveFailures: 0, openUntilMs: 0 });
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
    return normalized.includes('timeout')
        || normalized.includes('timed out')
        || normalized.includes('network')
        || normalized.includes('fetch failed')
        || normalized.includes('econnreset')
        || normalized.includes('econnrefused')
        || normalized.includes('enotfound')
        || normalized.includes('eai_again')
        || normalized.includes('socket hang up')
        || normalized.includes('temporarily unavailable');
}

export async function executeWithRetryPolicy<T>(
    operation: (attempt: number) => Promise<T>,
    options: RetryPolicyOptions
): Promise<T> {
    const maxAttempts = Math.max(1, options.maxAttempts ?? config.integrationRetryMaxAttempts);
    const baseDelayMs = Math.max(50, options.baseDelayMs ?? config.retryBaseMs);
    const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? config.integrationRetryMaxDelayMs);
    const circuitKey = options.circuitKey ?? options.integration;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const openForMs = isCircuitBreakerOpen(circuitKey);
        if (openForMs !== null) {
            throw new CircuitOpenError(circuitKey, openForMs);
        }
        try {
            const result = await operation(attempt);
            registerCircuitSuccess(circuitKey);
            return result;
        } catch (error) {
            lastError = error;
            const classification = options.classifyError
                ? options.classifyError(error)
                : (isLikelyTransientError(error) ? 'transient' : 'terminal');
            if (classification === 'terminal') {
                throw error;
            }
            registerCircuitFailure(circuitKey);
            if (attempt >= maxAttempts) {
                break;
            }
            await sleep(computeDelayMs(attempt, baseDelayMs, maxDelayMs));
        }
    }

    throw (lastError instanceof Error ? lastError : new Error(`${options.integration}: retry exhausted`));
}

export async function fetchWithRetryPolicy(
    url: string,
    init: RequestInit,
    options: RetryPolicyOptions
): Promise<Response> {
    const timeoutMs = Math.max(250, options.timeoutMs ?? config.integrationRequestTimeoutMs);
    const classifyResponse = options.classifyResponse
        ?? ((response: Response) => (isTransientHttpStatus(response.status) ? 'transient' : 'terminal'));

    return executeWithRetryPolicy<Response>(
        async () => {
            const controller = createTimedAbortController(init.signal, timeoutMs);
            try {
                const response = await fetch(url, {
                    ...init,
                    signal: controller.signal,
                });
                const classification = classifyResponse(response);
                if (classification === 'transient') {
                    throw new Error(`HTTP transient ${response.status}`);
                }
                return response;
            } finally {
                controller.cleanup();
            }
        },
        {
            ...options,
            classifyError: (error) => (isLikelyTransientError(error) ? 'transient' : 'terminal'),
        }
    );
}

export function getCircuitBreakerSnapshot(): Array<{ key: string; consecutiveFailures: number; openUntilMs: number }> {
    const rows: Array<{ key: string; consecutiveFailures: number; openUntilMs: number }> = [];
    for (const [key, value] of circuitStates.entries()) {
        rows.push({
            key,
            consecutiveFailures: value.consecutiveFailures,
            openUntilMs: value.openUntilMs,
        });
    }
    return rows.sort((a, b) => a.key.localeCompare(b.key));
}
