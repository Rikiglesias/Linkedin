const MAX_RECURSION_DEPTH = 6;
const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PARTS = new Set([
    'token', 'secret', 'password', 'passwd', 'key', 'cookie',
    'authorization', 'session', 'bearer', 'credential', 'credentials',
]);

function isSensitiveKey(key: string): boolean {
    const parts = key
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .toLowerCase()
        .split(/[_\-.\s]+/);
    return parts.some(part => SENSITIVE_KEY_PARTS.has(part));
}

const JWT_PATTERN = /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g;
const SUPABASE_KEY_PATTERN = /\bsb_(publishable|secret)_[A-Za-z0-9_-]{20,}\b/gi;
const API_KEY_PATTERN = /\b(sk|pk|rk)_[A-Za-z0-9_-]{16,}\b/gi;
const TELEGRAM_BOT_TOKEN_PATTERN = /\b\d{8,}:[A-Za-z0-9_-]{20,}\b/g;

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi;
const LINKEDIN_URL_PATTERN = /https?:\/\/(www\.)?linkedin\.com\/(in|profile)\/[A-Za-z0-9_-]+/gi;
const PHONE_PATTERNS: RegExp[] = [
    /\+\d{1,3}[\s.-]?\(?\d{1,5}\)?[\s.-]?\d{1,5}[\s.-]?\d{1,5}(?:[\s.-]?\d{1,5})?/g,
    /\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}/g,
    /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g,
    /\b3[0-9]{2}[\s.-]?\d{3}[\s.-]?\d{3,4}\b/g,
];
const PII_REDACTED = '[PII_REDACTED]';

function sanitizeString(input: string): string {
    let result = input
        .replace(JWT_PATTERN, REDACTED)
        .replace(SUPABASE_KEY_PATTERN, REDACTED)
        .replace(API_KEY_PATTERN, REDACTED)
        .replace(TELEGRAM_BOT_TOKEN_PATTERN, REDACTED)
        .replace(EMAIL_PATTERN, PII_REDACTED)
        .replace(LINKEDIN_URL_PATTERN, PII_REDACTED);
    for (const pattern of PHONE_PATTERNS) {
        result = result.replace(pattern, PII_REDACTED);
    }
    return result;
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
        if (isSensitiveKey(key)) {
            output[key] = REDACTED;
            continue;
        }
        output[key] = sanitizeForLogs(value, depth + 1);
    }
    return output;
}

/**
 * Mascheramento PII leggibile per log CLI di progresso.
 * Mantiene abbastanza contesto per l'operatore senza esporre dati completi.
 */
export function maskName(name: string | null | undefined): string {
    if (!name) return '(unknown)';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0) return '(unknown)';
    if (parts.length === 1) return parts[0].charAt(0) + '***';
    return parts[0].charAt(0) + '.' + parts[parts.length - 1].charAt(0) + '.';
}

export function maskEmail(email: string | null | undefined): string {
    if (!email) return '-';
    const atIndex = email.indexOf('@');
    if (atIndex <= 0) return '***@***';
    const local = email.slice(0, atIndex);
    const domain = email.slice(atIndex + 1);
    const maskedLocal = local.charAt(0) + '***';
    const domainParts = domain.split('.');
    const tld = domainParts.length > 1 ? '.' + domainParts[domainParts.length - 1] : '';
    return `${maskedLocal}@***${tld}`;
}

export function maskPhone(phone: string | null | undefined): string {
    if (!phone) return '-';
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 4) return '***';
    return '***' + digits.slice(-3);
}

export function maskUrl(url: string | null | undefined): string {
    if (!url) return '-';
    try {
        const parsed = new URL(url);
        // Rimuove credenziali dall'URL, mantiene host:port
        return `${parsed.protocol}//${parsed.hostname}${parsed.port ? ':' + parsed.port : ''}`;
    } catch {
        // Non è un URL valido — maschera tutto
        return '***';
    }
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
