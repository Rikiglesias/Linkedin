import { DatabaseManager } from '../../db';
import { LeadStatus } from '../../types/domain';

export function parsePayload<T>(raw: string): T {
    try {
        return JSON.parse(raw) as T;
    } catch {
        return {} as T;
    }
}

export async function withTransaction<T>(database: DatabaseManager, callback: () => Promise<T>): Promise<T> {
    return database.withTransaction(() => callback());
}

export function normalizeLegacyStatus(status: LeadStatus): LeadStatus {
    // Runtime guard: migration 002 backfilled all PENDING → READY_INVITE,
    // but keep this for safety if old data somehow surfaces from DB.
    if ((status as string) === 'PENDING') return 'READY_INVITE';
    return status;
}

export function normalizeTextValue(value: string): string {
    return (value ?? '').trim();
}

export function mergedLeadValue(current: string, incoming: string): string {
    const normalizedIncoming = normalizeTextValue(incoming);
    if (!normalizedIncoming) {
        return current;
    }
    if (normalizeTextValue(current) === normalizedIncoming) {
        return current;
    }
    return normalizedIncoming;
}
