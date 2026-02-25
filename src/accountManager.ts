import { AccountProfileConfig, config } from './config';
import { ProxyConfig } from './proxyManager';

export interface RuntimeAccountProfile {
    id: string;
    sessionDir: string;
    proxy?: ProxyConfig;
}

function parseProxyConfig(profile: AccountProfileConfig): ProxyConfig | undefined {
    const rawUrl = profile.proxyUrl.trim();
    if (!rawUrl) {
        return undefined;
    }

    const normalizedUrl = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(rawUrl) ? rawUrl : `http://${rawUrl}`;
    let server = normalizedUrl;
    let username = profile.proxyUsername.trim() || undefined;
    let password = profile.proxyPassword.trim() || undefined;

    try {
        const parsed = new URL(normalizedUrl);
        server = `${parsed.protocol}//${parsed.host}`;
        if (!username && parsed.username) {
            username = decodeURIComponent(parsed.username);
        }
        if (!password && parsed.password) {
            password = decodeURIComponent(parsed.password);
        }
    } catch {
        // Manteniamo rawUrl così com'è: Playwright valuterà la validità lato launch.
    }

    return {
        server,
        username,
        password,
    };
}

function toRuntimeProfile(profile: AccountProfileConfig): RuntimeAccountProfile {
    const fallbackId = 'default';
    const trimmedId = profile.id.trim();
    return {
        id: trimmedId || fallbackId,
        sessionDir: profile.sessionDir,
        proxy: parseProxyConfig(profile),
    };
}

function dedupeById(profiles: RuntimeAccountProfile[]): RuntimeAccountProfile[] {
    const unique = new Map<string, RuntimeAccountProfile>();
    for (const profile of profiles) {
        if (!unique.has(profile.id)) {
            unique.set(profile.id, profile);
        }
    }
    return Array.from(unique.values());
}

function getConfiguredRuntimeProfiles(): RuntimeAccountProfile[] {
    const runtime = config.accountProfiles.map(toRuntimeProfile);
    const deduped = dedupeById(runtime);
    return deduped.slice(0, 2);
}

export function getRuntimeAccountProfiles(): RuntimeAccountProfile[] {
    const configured = getConfiguredRuntimeProfiles();
    if (!config.multiAccountEnabled || configured.length === 0) {
        return [{
            id: 'default',
            sessionDir: config.sessionDir,
        }];
    }
    return configured;
}

export function isMultiAccountRuntimeEnabled(): boolean {
    return config.multiAccountEnabled && getRuntimeAccountProfiles().length > 1;
}

export function getSchedulingAccountIds(): string[] {
    return getRuntimeAccountProfiles().map((profile) => profile.id);
}

export function pickAccountIdForLead(leadId: number): string {
    const accountIds = getSchedulingAccountIds();
    if (accountIds.length === 0) {
        return 'default';
    }
    if (accountIds.length === 1) {
        return accountIds[0];
    }

    const normalizedLeadId = Number.isFinite(leadId) ? Math.abs(Math.trunc(leadId)) : 0;
    const index = normalizedLeadId % accountIds.length;
    return accountIds[index] ?? accountIds[0];
}

export function getAccountProfileById(accountId: string | null | undefined): RuntimeAccountProfile {
    const accounts = getRuntimeAccountProfiles();
    if (accounts.length === 0) {
        return {
            id: 'default',
            sessionDir: config.sessionDir,
        };
    }
    if (!accountId) {
        return accounts[0];
    }
    const found = accounts.find((profile) => profile.id === accountId);
    return found ?? accounts[0];
}
