export function tryParseUrl(raw: string): URL | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
        return new URL(trimmed);
    } catch {
        return null;
    }
}

export function isLinkedInHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    return host === 'linkedin.com' || host.endsWith('.linkedin.com');
}

export function isLinkedInUrl(raw: string): boolean {
    const parsed = tryParseUrl(raw);
    return !!parsed && isLinkedInHost(parsed.hostname);
}

export function isSalesNavigatorUrl(raw: string): boolean {
    const parsed = tryParseUrl(raw);
    if (!parsed || !isLinkedInHost(parsed.hostname)) return false;
    return parsed.pathname.toLowerCase().startsWith('/sales/');
}

export function isProfileUrl(raw: string): boolean {
    const parsed = tryParseUrl(raw);
    if (!parsed || !isLinkedInHost(parsed.hostname)) return false;
    const path = parsed.pathname.toLowerCase();
    return path.startsWith('/in/') || path.startsWith('/pub/');
}

export function normalizeLinkedInUrl(raw: string): string {
    const parsed = tryParseUrl(raw);
    if (!parsed || !isLinkedInHost(parsed.hostname)) {
        return raw.trim();
    }

    const normalized = new URL(parsed.toString());
    normalized.protocol = 'https:';
    normalized.hostname = 'www.linkedin.com';
    normalized.hash = '';

    // Canonicalizza i profili alla radice /in/<slug>/ per evitare varianti duplicate.
    const parts = normalized.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0].toLowerCase() === 'in') {
        normalized.pathname = `/in/${parts[1]}/`;
        normalized.search = '';
        return normalized.toString();
    }

    normalized.pathname = normalized.pathname.replace(/\/+$/, '');
    return normalized.toString();
}

