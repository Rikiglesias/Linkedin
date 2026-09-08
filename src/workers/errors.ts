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

/**
 * Motivi per cui l'acquisizione dell'input-block puo' fallire (fail-closed di C29).
 *
 * Questa lista e' la FONTE del tipo usato da `src/browser/human/inputBlock.ts`: tipo e valori
 * runtime non possono divergere, quindi un motivo nuovo e' visibile sia al compilatore sia alla
 * sentinella di copertura (`inputBlockRetryPolicy.vitest.ts`) e non puo' cadere in silenzio nel
 * ramo di retry permissivo.
 */
export const INPUT_BLOCK_ACQUIRE_REASONS = ['page_closed', 'evaluate_failed'] as const;

export type InputBlockAcquireReason = (typeof INPUT_BLOCK_ACQUIRE_REASONS)[number];

/** Nome della classe d'errore, condiviso per riconoscerla senza importare la catena browser. */
export const INPUT_BLOCK_ACQUIRE_ERROR_NAME = 'InputBlockAcquireError';

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
    INVITE_NOT_CONFIRMED: { retryable: true, maxAttempts: 2, baseDelayMultiplier: 2, category: 'ui_selector' },
    PROFILE_NAVIGATION_FAILED: { retryable: true, maxAttempts: 2, baseDelayMultiplier: 2, category: 'workflow' },
    WORKER_REPORTED_FAILURE: { retryable: true, maxAttempts: 2, baseDelayMultiplier: 1.5, category: 'workflow' },
    ACCEPTANCE_PENDING: {
        retryable: true,
        maxAttempts: 40,
        baseDelayMultiplier: 0,
        fixedDelayMs: 30_000,
        category: 'workflow',
    },
    WEEKLY_LIMIT_REACHED: { retryable: false, maxAttempts: 1, baseDelayMultiplier: 0, category: 'quota' },
    SESSION_EXPIRED: { retryable: false, maxAttempts: 1, baseDelayMultiplier: 0, category: 'workflow' },
    LEAD_NOT_FOUND: { retryable: false, maxAttempts: 1, baseDelayMultiplier: 0, category: 'data' },
    UNKNOWN_JOB_TYPE: { retryable: false, maxAttempts: 1, baseDelayMultiplier: 0, category: 'data' },
};

const TRANSIENT_ERROR_PATTERNS = [/timeout/i, /target closed/i, /navigation/i, /net::/i, /context closed/i];

const PROXY_ERROR_PATTERNS = [
    /ERR_PROXY_CONNECTION_FAILED/i,
    /ERR_TUNNEL_CONNECTION_FAILED/i,
    /ERR_PROXY_AUTH_UNSUPPORTED/i,
    /ERR_SOCKS_CONNECTION_FAILED/i,
    /ERR_PROXY_CERTIFICATE_INVALID/i,
    /proxy.*refused/i,
    /proxy.*reset/i,
    /proxy.*unreachable/i,
];

export function isProxyConnectionError(error: unknown): boolean {
    if (!error) return false;
    const msg = error instanceof Error ? error.message : String(error);
    return PROXY_ERROR_PATTERNS.some((pattern) => pattern.test(msg));
}

/**
 * Policy per motivo dell'acquisizione fallita. Si legge il campo TIPIZZATO `reason`, mai il testo
 * del messaggio: la classificazione per stringa e' la fragilita' che ha prodotto la regressione
 * (`input_block_acquire_failed:page_closed` non contiene nessun pattern transitorio, quindi finiva
 * in `UNCLASSIFIED` = ritentabile a piena capacita' su una sessione ormai morta — ritmo anomalo
 * verso LinkedIn).
 */
const INPUT_BLOCK_RETRY_POLICY: Record<
    InputBlockAcquireReason,
    { code: string; retryable: boolean; maxAttempts: number; category: RetryCategory }
> = {
    // La pagina non c'e' piu': ritentare significa ri-navigare e ri-attendere per ri-fallire.
    page_closed: { code: 'INPUT_BLOCK_PAGE_CLOSED', retryable: false, maxAttempts: 1, category: 'workflow' },
    // La `evaluate` e' caduta durante una navigazione: transitorio vero, ma a capacita' ridotta.
    evaluate_failed: {
        code: 'INPUT_BLOCK_EVALUATE_FAILED',
        retryable: true,
        maxAttempts: 3,
        category: 'ui_transient',
    },
};

/**
 * Riconosce l'errore per NOME e forma, senza importare `src/browser/human/inputBlock.ts`: quel
 * modulo tira dentro playwright e l'intera catena browser, che non deve entrare nei worker.
 */
function isInputBlockAcquireError(error: unknown): error is Error & { reason: InputBlockAcquireReason } {
    if (!(error instanceof Error) || error.name !== INPUT_BLOCK_ACQUIRE_ERROR_NAME) return false;
    const reason = (error as { reason?: unknown }).reason;
    return (
        typeof reason === 'string' &&
        (INPUT_BLOCK_ACQUIRE_REASONS as readonly string[]).includes(reason)
    );
}

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

    if (isInputBlockAcquireError(error)) {
        const policy = INPUT_BLOCK_RETRY_POLICY[error.reason];
        return {
            code: policy.code,
            retryable: policy.retryable,
            maxAttempts: policy.retryable ? Math.max(1, Math.min(safeDefaultMaxAttempts, policy.maxAttempts)) : 1,
            baseDelayMs: policy.retryable ? Math.max(100, Math.floor(safeDefaultBaseDelay * 1.75)) : 0,
            fixedDelay: false,
            category: policy.category,
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
