import { recordRunLog } from '../core/repositories/system';
import { sanitizeForLogs } from '../security/redaction';
import { publishLiveEvent } from './liveEvents';
import { getCorrelationId } from './correlation';
import { captureError } from './sentry';

function enrichWithCorrelation(payload: Record<string, unknown>): Record<string, unknown> {
    if (typeof payload.correlationId === 'string' && payload.correlationId.trim().length > 0) {
        return payload;
    }
    const correlationId = getCorrelationId();
    if (!correlationId) {
        return payload;
    }
    return {
        ...payload,
        correlationId,
    };
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR';
const consoleMethods: Record<LogLevel, (...args: unknown[]) => void> = {
    INFO: console.log,
    WARN: console.warn,
    ERROR: console.error,
};

async function log(level: LogLevel, event: string, payload: Record<string, unknown>): Promise<void> {
    const safePayload = sanitizeForLogs(enrichWithCorrelation(payload));
    consoleMethods[level](`[${level}] ${event}`, safePayload);
    await recordRunLog(level, event, safePayload);
    publishLiveEvent('run.log', { level, event, payload: safePayload });
}

export async function logInfo(event: string, payload: Record<string, unknown> = {}): Promise<void> {
    return log('INFO', event, payload);
}

export async function logWarn(event: string, payload: Record<string, unknown> = {}): Promise<void> {
    return log('WARN', event, payload);
}

export async function logError(event: string, payload: Record<string, unknown> = {}): Promise<void> {
    captureError(event, payload);
    return log('ERROR', event, payload);
}
