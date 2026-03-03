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

