import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

interface CorrelationContext {
    correlationId: string;
}

const correlationStore = new AsyncLocalStorage<CorrelationContext>();

function sanitizeCorrelationId(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return randomUUID();
    return trimmed.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80) || randomUUID();
}

export function resolveCorrelationId(value?: string | null): string {
    if (!value) return randomUUID();
    return sanitizeCorrelationId(value);
}

export function runWithCorrelationId<T>(correlationId: string, callback: () => T): T {
    return correlationStore.run({ correlationId }, callback);
}

export function getCorrelationId(): string | null {
    return correlationStore.getStore()?.correlationId ?? null;
}
