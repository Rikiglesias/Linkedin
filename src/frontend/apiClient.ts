import {
    AbLeaderboardRow,
    CampaignRunRecord,
    DashboardSnapshot,
    IncidentRecord,
    KpiResponse,
    PredictiveRiskResponse,
    ReviewQueueResponse,
    TimingSlotRow,
    TrendRow,
} from './types';

const DASHBOARD_API_KEY_PARAM = 'api_key';

function ensureArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function ensureObject(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

export class DashboardApi {
    private bootstrapApiKey = '';

    private async apiFetch(path: string, init: RequestInit = {}, apiKeyOverride = ''): Promise<Response> {
        const headers = new Headers(init.headers ?? {});
        const apiKey = (apiKeyOverride || this.bootstrapApiKey || '').trim();
        if (apiKey && !headers.has('x-api-key')) {
            headers.set('x-api-key', apiKey);
        }
        return fetch(path, { ...init, headers });
    }

    async bootstrapSessionFromUrl(): Promise<void> {
        let url: URL;
        try {
            url = new URL(window.location.href);
        } catch {
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
        } catch {
            // Keep standard auth flow as fallback.
        } finally {
            this.bootstrapApiKey = '';
        }
    }

    private async readJson<T>(path: string, fallback: T): Promise<T> {
        const resp = await this.apiFetch(path);
        if (!resp.ok) {
            return fallback;
        }
        const raw = (await resp.json()) as unknown;
        return raw as T;
    }

    async pause(minutes: number): Promise<boolean> {
        const resp = await this.apiFetch('/api/controls/pause', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ minutes }),
        });
        return resp.ok;
    }

    async resume(): Promise<boolean> {
        const resp = await this.apiFetch('/api/controls/resume', { method: 'POST' });
        return resp.ok;
    }

    async resolveIncident(id: number): Promise<boolean> {
        const resp = await this.apiFetch(`/api/incidents/${id}/resolve`, { method: 'POST' });
        return resp.ok;
    }

    async loadSnapshot(): Promise<DashboardSnapshot> {
        const [kpis, runs, incidents, trend, predictive, reviewQueue, ab, timingSlots] = await Promise.all([
            this.readJson<KpiResponse>('/api/kpis', {
                funnel: { totalLeads: 0, invited: 0, accepted: 0, readyMessage: 0, messaged: 0, replied: 0 },
                system: { pausedUntil: null, quarantined: false },
            }),
            this.readJson<CampaignRunRecord[]>('/api/runs', []),
            this.readJson<IncidentRecord[]>('/api/incidents', []),
            this.readJson<TrendRow[]>('/api/stats/trend', []),
            this.readJson<PredictiveRiskResponse>('/api/risk/predictive', { enabled: false, lookbackDays: 0, alerts: [] }),
            this.readJson<ReviewQueueResponse>('/api/review-queue?limit=25', {
                pending: false,
                lastIncidentId: null,
                reviewLeadCount: 0,
                challengeIncidentCount: 0,
                leads: [],
                incidents: [],
            }),
            this.readJson<AbLeaderboardRow[]>('/api/ml/ab-leaderboard', []),
            this.readJson<TimingSlotRow[]>('/api/ml/timing-slots?n=8', []),
        ]);

        const safeKpis = ensureObject(kpis) as unknown as KpiResponse;

        return {
            kpis: safeKpis,
            runs: ensureArray<CampaignRunRecord>(runs),
            incidents: ensureArray<IncidentRecord>(incidents),
            trend: ensureArray<TrendRow>(trend),
            predictive: ensureObject(predictive) as unknown as PredictiveRiskResponse,
            reviewQueue: ensureObject(reviewQueue) as unknown as ReviewQueueResponse,
            ab: ensureArray<AbLeaderboardRow>(ab),
            timingSlots: ensureArray<TimingSlotRow>(timingSlots),
        };
    }
}
