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
    await database.exec('BEGIN');
    try {
        const result = await callback();
        await database.exec('COMMIT');
        return result;
    } catch (error) {
        await database.exec('ROLLBACK');
        throw error;
    }
}

export function normalizeLegacyStatus(status: LeadStatus): LeadStatus {
    if (status === 'PENDING') {
        return 'READY_INVITE';
    }
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
