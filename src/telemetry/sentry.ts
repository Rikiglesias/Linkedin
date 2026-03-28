import * as Sentry from '@sentry/node';
import { parseStringEnv } from '../config/env';

let _initialized = false; // true dopo initSentry() con DSN valido

export function initSentry(): void {
    const dsn = parseStringEnv('SENTRY_DSN');
    if (!dsn) return;

    Sentry.init({
        dsn,
        environment: parseStringEnv('NODE_ENV', 'production'),
        tracesSampleRate: 0,
        defaultIntegrations: false,
    });
    _initialized = true;
}

export function captureError(event: string, payload: Record<string, unknown>): void {
    if (!_initialized) return;
    const err = new Error(event);
    Sentry.captureException(err, { extra: payload });
}

export async function flushSentry(): Promise<void> {
    if (!_initialized) return;
    await Sentry.flush(2000);
}
