const MAX_RECURSION_DEPTH = 6;
const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERN = /(token|secret|password|pass|key|cookie|authorization|session|bearer)/i;

const JWT_PATTERN = /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g;
const SUPABASE_KEY_PATTERN = /\bsb_(publishable|secret)_[A-Za-z0-9_-]{20,}\b/gi;
const API_KEY_PATTERN = /\b(sk|pk|rk)_[A-Za-z0-9_-]{16,}\b/gi;
const TELEGRAM_BOT_TOKEN_PATTERN = /\b\d{8,}:[A-Za-z0-9_-]{20,}\b/g;

function sanitizeString(input: string): string {
    return input
        .replace(JWT_PATTERN, REDACTED)
        .replace(SUPABASE_KEY_PATTERN, REDACTED)
        .replace(API_KEY_PATTERN, REDACTED)
        .replace(TELEGRAM_BOT_TOKEN_PATTERN, REDACTED);
}

function sanitizeArray(input: unknown[], depth: number): unknown[] {
    if (depth > MAX_RECURSION_DEPTH) {
        return ['[MAX_DEPTH_REACHED]'];
    }
    return input.map((item) => sanitizeForLogs(item, depth + 1));
}

function sanitizeObject(input: Record<string, unknown>, depth: number): Record<string, unknown> {
    if (depth > MAX_RECURSION_DEPTH) {
        return { note: '[MAX_DEPTH_REACHED]' };
    }

    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
            output[key] = REDACTED;
            continue;
        }
        output[key] = sanitizeForLogs(value, depth + 1);
    }
    return output;
}

export function sanitizeForLogs<T>(value: T, depth: number = 0): T {
    if (value === null || value === undefined) {
        return value;
    }

    if (typeof value === 'string') {
        return sanitizeString(value) as T;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (Array.isArray(value)) {
        return sanitizeArray(value, depth) as T;
    }

    if (typeof value === 'object') {
        return sanitizeObject(value as Record<string, unknown>, depth) as T;
    }

    return String(value) as T;
}
