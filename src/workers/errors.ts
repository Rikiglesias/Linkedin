export class RetryableWorkerError extends Error {
    public readonly code: string;

    constructor(message: string, code: string = 'RETRYABLE') {
        super(message);
        this.name = 'RetryableWorkerError';
        this.code = code;
    }
}

export class ChallengeDetectedError extends Error {
    constructor(message: string = 'Challenge/CAPTCHA rilevato') {
        super(message);
        this.name = 'ChallengeDetectedError';
    }
}

type RetryCategory = 'ui_selector' | 'ui_transient' | 'quota' | 'data' | 'workflow' | 'unknown';

interface RetryPolicyTemplate {
    retryable: boolean;
    maxAttempts: number;
    baseDelayMultiplier: number;
    fixedDelayMs?: number;
    category: RetryCategory;
}

export interface WorkerRetryPolicyDecision {
    code: string;
    retryable: boolean;
    maxAttempts: number;
    baseDelayMs: number;
    fixedDelay: boolean;
    category: RetryCategory;
}

const RETRY_POLICY_BY_CODE: Record<string, RetryPolicyTemplate> = {
    MESSAGE_BUTTON_NOT_FOUND: { retryable: true, maxAttempts: 2, baseDelayMultiplier: 2, category: 'ui_selector' },
    TEXTBOX_NOT_FOUND: { retryable: true, maxAttempts: 2, baseDelayMultiplier: 2, category: 'ui_selector' },
    SEND_NOT_AVAILABLE: { retryable: true, maxAttempts: 2, baseDelayMultiplier: 2, category: 'ui_selector' },
    TYPE_ERROR: { retryable: true, maxAttempts: 2, baseDelayMultiplier: 2, category: 'ui_selector' },
    SEND_WITH_NOTE_NOT_FOUND: { retryable: true, maxAttempts: 2, baseDelayMultiplier: 2, category: 'ui_selector' },
    SEND_BUTTON_NOT_FOUND: { retryable: true, maxAttempts: 2, baseDelayMultiplier: 2, category: 'ui_selector' },
    NO_PROOF_OF_SEND: { retryable: true, maxAttempts: 2, baseDelayMultiplier: 2, category: 'ui_selector' },
    WORKER_REPORTED_FAILURE: { retryable: true, maxAttempts: 2, baseDelayMultiplier: 1.5, category: 'workflow' },
    ACCEPTANCE_PENDING: { retryable: true, maxAttempts: 40, baseDelayMultiplier: 0, fixedDelayMs: 30_000, category: 'workflow' },
    WEEKLY_LIMIT_REACHED: { retryable: false, maxAttempts: 1, baseDelayMultiplier: 0, category: 'quota' },
    LEAD_NOT_FOUND: { retryable: false, maxAttempts: 1, baseDelayMultiplier: 0, category: 'data' },
    UNKNOWN_JOB_TYPE: { retryable: false, maxAttempts: 1, baseDelayMultiplier: 0, category: 'data' },
};

const TRANSIENT_ERROR_PATTERNS = [/timeout/i, /target closed/i, /navigation/i, /net::/i, /context closed/i];

export function resolveWorkerRetryPolicy(
    error: unknown,
    defaultMaxAttempts: number,
    defaultBaseDelayMs: number,
): WorkerRetryPolicyDecision {
    const safeDefaultMaxAttempts = Math.max(1, defaultMaxAttempts);
    const safeDefaultBaseDelay = Math.max(50, defaultBaseDelayMs);

    if (error instanceof RetryableWorkerError) {
        const policy = RETRY_POLICY_BY_CODE[error.code];
        if (policy) {
            const hasFixedDelay = typeof policy.fixedDelayMs === 'number';
            return {
                code: error.code,
                retryable: policy.retryable,
                maxAttempts: Math.max(1, Math.min(safeDefaultMaxAttempts, policy.maxAttempts)),
                baseDelayMs: hasFixedDelay
                    ? (policy.fixedDelayMs ?? 30_000)
                    : policy.retryable
                      ? Math.max(50, Math.floor(safeDefaultBaseDelay * policy.baseDelayMultiplier))
                      : 0,
                fixedDelay: hasFixedDelay,
                category: policy.category,
            };
        }

        return {
            code: error.code,
            retryable: true,
            maxAttempts: safeDefaultMaxAttempts,
            baseDelayMs: safeDefaultBaseDelay,
            fixedDelay: false,
            category: 'unknown',
        };
    }

    if (error instanceof Error) {
        const isTransient = TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(error.message));
        if (isTransient) {
            return {
                code: 'UNCLASSIFIED_TRANSIENT',
                retryable: true,
                maxAttempts: Math.max(2, Math.min(safeDefaultMaxAttempts, 3)),
                baseDelayMs: Math.max(100, Math.floor(safeDefaultBaseDelay * 1.75)),
                fixedDelay: false,
                category: 'ui_transient',
            };
        }
    }

    return {
        code: 'UNCLASSIFIED',
        retryable: true,
        maxAttempts: safeDefaultMaxAttempts,
        baseDelayMs: safeDefaultBaseDelay,
        fixedDelay: false,
        category: 'unknown',
    };
}
