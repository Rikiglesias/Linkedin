const DASHBOARD_API_KEY_PARAM = 'api_key';
function ensureArray(value) {
    return Array.isArray(value) ? value : [];
}
function ensureObject(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return {};
    }
    return value;
}
export class DashboardApi {
    bootstrapApiKey = '';
    async apiFetch(path, init = {}, apiKeyOverride = '') {
        const headers = new Headers(init.headers ?? {});
        const apiKey = (apiKeyOverride || this.bootstrapApiKey || '').trim();
        if (apiKey && !headers.has('x-api-key')) {
            headers.set('x-api-key', apiKey);
        }
        return fetch(path, { ...init, headers });
    }
    async bootstrapSessionFromUrl() {
        let url;
        try {
            url = new URL(window.location.href);
        }
        catch {
            return;
        }
        const apiKey = (url.searchParams.get(DASHBOARD_API_KEY_PARAM) ?? '').trim();
        if (!apiKey) {
            return;
        }
        this.bootstrapApiKey = apiKey;
        try {
            const resp = await this.apiFetch('/api/auth/session', { method: 'POST' }, apiKey);
            if (resp.ok) {
                url.searchParams.delete(DASHBOARD_API_KEY_PARAM);
                window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
            }
        }
        catch {
            // Keep standard auth flow as fallback.
        }
        finally {
            this.bootstrapApiKey = '';
        }
    }
    async readJson(path, fallback) {
        const resp = await this.apiFetch(path);
        if (!resp.ok) {
            return fallback;
        }
        const raw = (await resp.json());
        return raw;
    }
    async pause(minutes) {
        const resp = await this.apiFetch('/api/controls/pause', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ minutes }),
        });
        return resp.ok;
    }
    async resume() {
        const resp = await this.apiFetch('/api/controls/resume', { method: 'POST' });
        return resp.ok;
    }
    async resolveIncident(id) {
        const resp = await this.apiFetch(`/api/incidents/${id}/resolve`, { method: 'POST' });
        return resp.ok;
    }
    async loadSnapshot() {
        const [kpis, runs, incidents, trend, predictive, reviewQueue, ab, timingSlots] = await Promise.all([
            this.readJson('/api/kpis', {
                funnel: { totalLeads: 0, invited: 0, accepted: 0, readyMessage: 0, messaged: 0, replied: 0 },
                system: { pausedUntil: null, quarantined: false },
            }),
            this.readJson('/api/runs', []),
            this.readJson('/api/incidents', []),
            this.readJson('/api/stats/trend', []),
            this.readJson('/api/risk/predictive', { enabled: false, lookbackDays: 0, alerts: [] }),
            this.readJson('/api/review-queue?limit=25', {
                pending: false,
                lastIncidentId: null,
                reviewLeadCount: 0,
                challengeIncidentCount: 0,
                leads: [],
                incidents: [],
            }),
            this.readJson('/api/ml/ab-leaderboard', []),
            this.readJson('/api/ml/timing-slots?n=8', []),
        ]);
        const safeKpis = ensureObject(kpis);
        return {
            kpis: safeKpis,
            runs: ensureArray(runs),
            incidents: ensureArray(incidents),
            trend: ensureArray(trend),
            predictive: ensureObject(predictive),
            reviewQueue: ensureObject(reviewQueue),
            ab: ensureArray(ab),
            timingSlots: ensureArray(timingSlots),
        };
    }
}
