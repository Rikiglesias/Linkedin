import { recordRunLog } from '../core/repositories';
import { sanitizeForLogs } from '../security/redaction';

export async function logInfo(event: string, payload: Record<string, unknown> = {}): Promise<void> {
    const safePayload = sanitizeForLogs(payload);
    console.log(`[INFO] ${event}`, safePayload);
    await recordRunLog('INFO', event, safePayload);
}

export async function logWarn(event: string, payload: Record<string, unknown> = {}): Promise<void> {
    const safePayload = sanitizeForLogs(payload);
    console.warn(`[WARN] ${event}`, safePayload);
    await recordRunLog('WARN', event, safePayload);
}

export async function logError(event: string, payload: Record<string, unknown> = {}): Promise<void> {
    const safePayload = sanitizeForLogs(payload);
    console.error(`[ERROR] ${event}`, safePayload);
    await recordRunLog('ERROR', event, safePayload);
}
