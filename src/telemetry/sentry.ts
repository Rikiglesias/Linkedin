import * as Sentry from '@sentry/node';
import { parseStringEnv } from '../config/env';
import { sanitizeForLogs } from '../security/redaction';

let _initialized = false; // true dopo initSentry() con DSN valido

export function initSentry(): void {
    const dsn = parseStringEnv('SENTRY_DSN');
    if (!dsn) return;

    Sentry.init({
        dsn,
        environment: parseStringEnv('NODE_ENV', 'production'),
        tracesSampleRate: 0,
        defaultIntegrations: false,
        // H8 fix (security/privacy): difesa-in-profondita a livello SDK. Il payload e' gia'
        // sanitizzato al choke-point captureError (sanitizeForLogs), ma sendDefaultPii:false
        // impedisce a Sentry di allegare automaticamente PII (IP, cookie, headers) agli eventi.
        sendDefaultPii: false,
    });
    _initialized = true;
}

export function captureError(event: string, payload: Record<string, unknown>): void {
    if (!_initialized) return;
    const err = new Error(event);
    // Choke-point unico: ogni payload diretto a Sentry passa da redaction (PII/secret),
    // a prescindere dal chiamante. logError() passa il payload raw (vedi logger.ts).
    const safePayload = sanitizeForLogs(payload);
    Sentry.captureException(err, { extra: safePayload });
}

export async function flushSentry(): Promise<void> {
    if (!_initialized) return;
    await Sentry.flush(2000);
}
