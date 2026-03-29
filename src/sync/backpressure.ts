import { getRuntimeFlag, setRuntimeFlag } from '../core/repositories';

export interface BackpressureSample {
    currentLevel: number;
    sent: number;
    failed: number;
    permanentFailures: number;
}

const MIN_LEVEL = 1;
const MAX_LEVEL = 8;

export function clampBackpressureLevel(level: number): number {
    if (!Number.isFinite(level)) return MIN_LEVEL;
    return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.floor(level)));
}

export function computeBackpressureBatchSize(baseBatch: number, level: number): number {
    const safeBaseBatch = Math.max(1, Math.floor(baseBatch));
    const safeLevel = clampBackpressureLevel(level);
    return Math.max(1, Math.floor(safeBaseBatch / safeLevel));
}

export function computeNextBackpressureLevel(sample: BackpressureSample): number {
    const currentLevel = clampBackpressureLevel(sample.currentLevel);
    const sent = Math.max(0, Math.floor(sample.sent));
    const failed = Math.max(0, Math.floor(sample.failed));
    const permanentFailures = Math.max(0, Math.floor(sample.permanentFailures));

    if (failed === 0) {
        if (sent > 0) {
            return clampBackpressureLevel(currentLevel - 1);
        }
        return currentLevel;
    }

    const severeBurst = permanentFailures > 0 || failed >= Math.max(1, sent);
    const delta = severeBurst ? 2 : 1;
    return clampBackpressureLevel(currentLevel + delta);
}

// ─── Account-Scoped Distributed Backpressure ─────────────────────────────────

function accountBackpressureKey(accountId: string): string {
    return `backpressure.account.${accountId}.level`;
}

/**
 * Legge il livello di backpressure per un account dal DB.
 * Persistente tra riavvii e condiviso tra processi.
 */
export async function getAccountBackpressureLevel(accountId: string): Promise<number> {
    const raw = await getRuntimeFlag(accountBackpressureKey(accountId));
    const parsed = raw ? Number.parseInt(raw, 10) : 1;
    return clampBackpressureLevel(parsed);
}

/**
 * Scrive il livello di backpressure aggiornato per un account nel DB.
 */
export async function setAccountBackpressureLevel(accountId: string, level: number): Promise<void> {
    await setRuntimeFlag(accountBackpressureKey(accountId), String(clampBackpressureLevel(level)));
}

/**
 * Aggiorna il livello di backpressure per un account in base ai risultati dell'ultimo batch.
 * Ritorna il nuovo livello.
 */
export async function updateAccountBackpressure(
    accountId: string,
    sample: Omit<BackpressureSample, 'currentLevel'>,
): Promise<number> {
    const currentLevel = await getAccountBackpressureLevel(accountId);
    const nextLevel = computeNextBackpressureLevel({
        currentLevel,
        ...sample,
    });
    if (nextLevel !== currentLevel) {
        await setAccountBackpressureLevel(accountId, nextLevel);
    }
    return nextLevel;
}

export interface AccountBackpressureSnapshot {
    accountId: string;
    level: number;
    effectiveBatchSize: number;
}

// ─── M20: Worker-Type-Scoped Backpressure ────────────────────────────────────
// Estende il sistema account-scoped per avere granularità per JobType.
// Se inviti hanno alta failure rate ma messaggi no, solo il batch inviti viene ridotto.

function workerTypeBackpressureKey(accountId: string, jobType: string): string {
    return `backpressure.worker.${accountId}.${jobType}.level`;
}

export async function getWorkerTypeBackpressureLevel(accountId: string, jobType: string): Promise<number> {
    const raw = await getRuntimeFlag(workerTypeBackpressureKey(accountId, jobType));
    const parsed = raw ? Number.parseInt(raw, 10) : 1;
    return clampBackpressureLevel(parsed);
}

export async function updateWorkerTypeBackpressure(
    accountId: string,
    jobType: string,
    sample: Omit<BackpressureSample, 'currentLevel'>,
): Promise<number> {
    const currentLevel = await getWorkerTypeBackpressureLevel(accountId, jobType);
    const nextLevel = computeNextBackpressureLevel({ currentLevel, ...sample });
    if (nextLevel !== currentLevel) {
        await setRuntimeFlag(workerTypeBackpressureKey(accountId, jobType), String(clampBackpressureLevel(nextLevel)));
    }
    return nextLevel;
}
