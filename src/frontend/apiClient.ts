import {
    AbLeaderboardRow,
    ApiError,
    CampaignRunRecord,
    CommentSuggestionQueueResponse,
    DashboardSnapshot,
    FetchState,
    IncidentRecord,
    KpiResponse,
    LeadDetailResponse,
    LeadSearchResponse,
    ObservabilitySnapshot,
    PredictiveRiskResponse,
    ReviewQueueResponse,
    TimingSlotRow,
    TrendRow,
} from './types';

const DASHBOARD_API_KEY_PARAM = 'api_key';
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;

export type AuthErrorCallback = (status: number, path: string) => void;
export type FetchStateCallback = (state: FetchState) => void;

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
    private cache = new Map<string, { data: unknown; cachedAt: number }>();
    private _fetchState: FetchState = 'idle';
    private _lastError: ApiError | null = null;
    private _onAuthError: AuthErrorCallback | null = null;
    private _onFetchStateChange: FetchStateCallback | null = null;

    get fetchState(): FetchState {
        return this._fetchState;
    }

    get lastError(): ApiError | null {
        return this._lastError;
    }

    onAuthError(cb: AuthErrorCallback): void {
        this._onAuthError = cb;
    }

    onFetchStateChange(cb: FetchStateCallback): void {
        this._onFetchStateChange = cb;
    }

    private setFetchState(state: FetchState): void {
        this._fetchState = state;
        this._onFetchStateChange?.(state);
    }

    private static readonly CACHE_TTL: Record<string, number> = {
        '/api/kpis': 15_000,
        '/api/runs': 30_000,
        '/api/incidents': 10_000,
        '/api/stats/trend': 60_000,
        '/api/risk/predictive': 60_000,
        '/api/review-queue': 20_000,
        '/api/ml/ab-leaderboard': 60_000,
        '/api/ml/timing-slots': 60_000,
        '/api/observability': 30_000,
        '/api/ai/comment-suggestions': 20_000,
    };

    private getCacheTtl(path: string): number {
        const basePath = path.split('?')[0];
        return DashboardApi.CACHE_TTL[basePath] ?? 15_000;
    }

    /** Invalida tutta la cache — il prossimo loadSnapshot farà fetch fresche. */
    forceRefresh(): void {
        this.cache.clear();
    }

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

    /**
     * Login via form POST — non espone la API key nella URL.
     * Ritorna: { success, totpRequired, error? }
     */
    async loginWithCredentials(
        apiKey: string,
        totpCode?: string,
    ): Promise<{ success: boolean; totpRequired: boolean; error?: string }> {
        try {
            const headers = new Headers({ 'Content-Type': 'application/json', 'x-api-key': apiKey });
            const body = totpCode ? JSON.stringify({ totp_code: totpCode }) : '{}';
            const resp = await fetch('/api/auth/session', { method: 'POST', headers, body });
            const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;

            if (resp.ok) {
                return { success: true, totpRequired: false };
            }
            if (resp.status === 403 && data.totpRequired === true) {
                return { success: false, totpRequired: true, error: String(data.error ?? 'TOTP code required') };
            }
            return { success: false, totpRequired: false, error: String(data.error ?? `HTTP ${resp.status}`) };
        } catch (err) {
            return { success: false, totpRequired: false, error: err instanceof Error ? err.message : 'Network error' };
        }
    }

    /**
     * Verifica se la sessione corrente è valida facendo un GET su /api/health.
     * Se ritorna 401 → sessione non valida, mostrare il form login.
     */
    async hasValidSession(): Promise<boolean> {
        try {
            const resp = await fetch('/api/kpis');
            return resp.ok;
        } catch {
            return true; // Network error → non mostrare login, potrebbe essere offline
        }
    }

    private async readJson<T>(path: string, fallback: T): Promise<T> {
        const now = Date.now();
        const cached = this.cache.get(path);
        if (cached && now - cached.cachedAt < this.getCacheTtl(path)) {
            return cached.data as T;
        }

        this.setFetchState('loading');

        let lastStatus = 0;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const resp = await this.apiFetch(path);
                lastStatus = resp.status;

                if (resp.ok) {
                    const raw = (await resp.json()) as unknown;
                    this.cache.set(path, { data: raw, cachedAt: Date.now() });
                    this._lastError = null;
                    this.setFetchState('success');
                    return raw as T;
                }

                if (resp.status === 401 || resp.status === 403) {
                    const err: ApiError = { status: resp.status, message: `Auth error on ${path}`, retryable: false };
                    this._lastError = err;
                    this.setFetchState('error');
                    this._onAuthError?.(resp.status, path);
                    return fallback;
                }

                if (RETRYABLE_STATUSES.has(resp.status) && attempt < MAX_RETRIES) {
                    const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
                    await new Promise((r) => setTimeout(r, delay));
                    continue;
                }

                const err: ApiError = {
                    status: resp.status,
                    message: `HTTP ${resp.status} on ${path}`,
                    retryable: false,
                };
                this._lastError = err;
                this.setFetchState('error');
                return fallback;
            } catch (e) {
                if (attempt < MAX_RETRIES) {
                    const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
                    await new Promise((r) => setTimeout(r, delay));
                    continue;
                }
                const err: ApiError = {
                    status: 0,
                    message: e instanceof Error ? e.message : 'Network error',
                    retryable: false,
                };
                this._lastError = err;
                this.setFetchState('error');
                return fallback;
            }
        }

        const err: ApiError = { status: lastStatus, message: `Max retries exceeded on ${path}`, retryable: false };
        this._lastError = err;
        this.setFetchState('error');
        return fallback;
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

    async triggerRun(workflow: string = 'all'): Promise<boolean> {
        const resp = await this.apiFetch('/api/controls/trigger-run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workflow }),
        });
        return resp.ok;
    }

    async resolveIncident(id: number): Promise<boolean> {
        const resp = await this.apiFetch(`/api/incidents/${id}/resolve`, { method: 'POST' });
        return resp.ok;
    }

    async approveCommentSuggestion(leadId: number, suggestionIndex: number, comment?: string): Promise<boolean> {
        const payload = typeof comment === 'string' && comment.trim().length > 0 ? { comment: comment.trim() } : {};
        const resp = await this.apiFetch(`/api/ai/comment-suggestions/${leadId}/${suggestionIndex}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        return resp.ok;
    }

    async rejectCommentSuggestion(leadId: number, suggestionIndex: number): Promise<boolean> {
        const resp = await this.apiFetch(`/api/ai/comment-suggestions/${leadId}/${suggestionIndex}/reject`, {
            method: 'POST',
        });
        return resp.ok;
    }

    async searchLeads(query: string, status?: string, list?: string, page: number = 1): Promise<LeadSearchResponse> {
        const params = new URLSearchParams();
        if (query) params.set('q', query);
        if (status) params.set('status', status);
        if (list) params.set('list', list);
        params.set('page', String(page));
        params.set('pageSize', '25');
        return this.readJson<LeadSearchResponse>(`/api/leads/search?${params.toString()}`, {
            leads: [],
            total: 0,
            page: 1,
            pageSize: 25,
        });
    }

    async getLeadDetail(id: number): Promise<LeadDetailResponse | null> {
        const resp = await this.apiFetch(`/api/leads/${id}`);
        if (!resp.ok) return null;
        return (await resp.json()) as LeadDetailResponse;
    }

    async simulateWhatIf(params: {
        softInviteCap: number;
        hardInviteCap: number;
        softMsgCap: number;
        hardMsgCap: number;
    }): Promise<Record<string, unknown>> {
        try {
            const resp = await this.apiFetch('/api/risk/what-if', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
            });
            if (!resp.ok) return {};
            return (await resp.json()) as Record<string, unknown>;
        } catch {
            return {};
        }
    }

    async loadSnapshot(): Promise<DashboardSnapshot> {
        const [
            kpis,
            runs,
            incidents,
            trendRaw,
            predictive,
            reviewQueue,
            ab,
            timingSlots,
            observability,
            commentSuggestions,
        ] = await Promise.all([
            this.readJson<KpiResponse>('/api/kpis', {
                funnel: { totalLeads: 0, invited: 0, accepted: 0, readyMessage: 0, messaged: 0, replied: 0 },
                system: { pausedUntil: null, quarantined: false },
            }),
            this.readJson<CampaignRunRecord[]>('/api/runs', []),
            this.readJson<IncidentRecord[]>('/api/incidents', []),
            this.readJson<unknown>('/api/stats/trend', []),
            this.readJson<PredictiveRiskResponse>('/api/risk/predictive', {
                enabled: false,
                lookbackDays: 0,
                alerts: [],
            }),
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
            this.readJson<ObservabilitySnapshot>('/api/observability', {}),
            this.readJson<CommentSuggestionQueueResponse>('/api/ai/comment-suggestions?limit=20', {
                status: 'REVIEW_PENDING',
                count: 0,
                rows: [],
            }),
        ]);
        const trend = Array.isArray(trendRaw) ? trendRaw : ensureArray<TrendRow>(ensureObject(trendRaw).rows);

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
            observability: ensureObject(observability) as unknown as ObservabilitySnapshot,
            commentSuggestions: ensureObject(commentSuggestions) as unknown as CommentSuggestionQueueResponse,
        };
    }

    async getBlacklist(): Promise<
        Array<{
            id: number;
            linkedin_url: string | null;
            company_domain: string | null;
            reason: string | null;
            created_at: string;
        }>
    > {
        const resp = await this.apiFetch('/api/blacklist');
        if (!resp.ok) return [];
        const data = (await resp.json()) as { entries?: unknown[] };
        return ensureArray(data.entries ?? data);
    }

    async addToBlacklist(linkedinUrl: string, companyDomain: string, reason: string): Promise<boolean> {
        const resp = await this.apiFetch('/api/blacklist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                linkedin_url: linkedinUrl || null,
                company_domain: companyDomain || null,
                reason: reason || 'manual_dashboard',
            }),
        });
        return resp.ok;
    }

    async removeFromBlacklist(id: number): Promise<boolean> {
        const resp = await this.apiFetch(`/api/blacklist/${id}`, { method: 'DELETE' });
        return resp.ok;
    }
}
