import { DatabaseManager } from '../../db';
import { LeadStatus } from '../../types/domain';

export function parsePayload<T>(raw: string): T {
    try {
        return JSON.parse(raw) as T;
    } catch {
        return {} as T;
    }
}

/**
 * Variante OSSERVABILE di parsePayload: dice se il parse e' riuscito.
 *
 * Perche' esiste: parsePayload ripiega su `{}` e un payload CORROTTO diventa indistinguibile da uno
 * legittimamente vuoto. Nei rami che decidono un'azione in base a un campo (es. campaign advance in
 * jobRunner) questo produce un fallimento SILENZIOSO: nessuna eccezione viene lanciata, quindi il
 * `catch` del chiamante non scatta e la sua logica di recupero non parte mai.
 *
 * Non sostituisce parsePayload e non ne cambia il comportamento: i chiamanti che devono distinguere
 * "assente" da "corrotto" usano questa, gli altri restano invariati. Nessun logger qui dentro: questo
 * modulo e' raggiunto da telemetry/logger via repositories/system e importarlo creerebbe un ciclo —
 * il log lo fa il CHIAMANTE, che ha gia' il contesto (jobId, tipo, account) per renderlo utile.
 */
export function tryParsePayload<T>(raw: string): { ok: boolean; value: T } {
    try {
        return { ok: true, value: JSON.parse(raw) as T };
    } catch {
        return { ok: false, value: {} as T };
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
