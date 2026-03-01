import express from 'express';
import cors from 'cors';
import path from 'path';
import { randomBytes, timingSafeEqual } from 'crypto';
import rateLimit from 'express-rate-limit';
import type { NextFunction, Request, Response } from 'express';
import { getGlobalKPIData, getRiskInputs, getABTestingStats, listOpenIncidents, resolveIncident, getDailyStat, getRuntimeFlag, getRecentDailyStats, getLeadsByStatus } from '../core/repositories';
import { getDatabase } from '../db';
import { evaluatePredictiveRiskAlerts, evaluateRisk } from '../risk/riskEngine';
import { getLocalDateString, config } from '../config';
import { pauseAutomation, resumeAutomation, setQuarantine } from '../risk/incidentManager';
import { logError } from '../telemetry/logger';
import { CampaignRunRecord } from '../types/domain';
import { publishLiveEvent, subscribeLiveEvents, getLiveEventSubscribersCount, type LiveEventMessage } from '../telemetry/liveEvents';

const app = express();
app.set('trust proxy', false);
const DASHBOARD_SESSION_COOKIE = 'dashboard_session';
const DASHBOARD_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const dashboardSessions = new Map<string, number>();
const sessionCleanupTimer = setInterval(cleanupExpiredDashboardSessions, 15 * 60 * 1000);
sessionCleanupTimer.unref();

// ── CORS ristretto ──────────────────────────────────────────────────────────
// Accetta solo richieste da localhost o se non c'è origin (es. curl / stesso server)
app.use(cors({
    origin: (origin, callback) => {
        // Nessun origin = same-origin o tool come curl → ok
        if (!origin) return callback(null, true);
        // Whitelist: localhost e IPs fidati configurati
        const allowedOrigins = [
            'http://localhost',
            'http://localhost:3000',
            'http://127.0.0.1',
            'http://127.0.0.1:3000',
            ...config.dashboardTrustedIps.map((ip) => `http://${ip}`),
            ...config.dashboardTrustedIps.map((ip) => `http://${ip}:3000`),
        ];
        return callback(null, allowedOrigins.includes(origin));
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    credentials: false,
}));

app.use(express.json({ limit: '64kb' }));

// ── Rate Limiting ────────────────────────────────────────────────────────────
// Limite globale: 120 req/min per IP su tutti gli endpoint /api/
const globalLimiter = rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        const path = req.path ?? '';
        const originalUrl = req.originalUrl ?? '';
        return path === '/events'
            || path === '/api/events'
            || originalUrl.startsWith('/api/events');
    },
    message: { error: 'Troppe richieste. Attendi prima di riprovare.' },
});
app.use('/api/', globalLimiter);

// Limite più stretto per i controlli (pause/resume/quarantine): 10 req/min
const controlsLimiter = rateLimit({
    windowMs: 60_000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Troppe operazioni di controllo. Attendi prima di riprovare.' },
});
app.use('/api/controls/', controlsLimiter);

// ── Sicurezza Header HTTP ────────────────────────────────────────────────────
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'"
    );
    next();
});

// ── Utility Auth ─────────────────────────────────────────────────────────────
function secureEquals(a: string, b: string): boolean {
    const aBuffer = Buffer.from(a);
    const bBuffer = Buffer.from(b);
    if (aBuffer.length !== bBuffer.length) return false;
    return timingSafeEqual(aBuffer, bBuffer);
}

function normalizeIp(rawIp: string): string {
    const trimmed = rawIp.trim();
    if (!trimmed) return '';
    if (trimmed === '::1') return '127.0.0.1';
    if (trimmed.startsWith('::ffff:')) return trimmed.slice('::ffff:'.length);
    return trimmed;
}

function resolveRequestIp(req: Request): string {
    // Non usare manualmente x-forwarded-for: è header spoofabile lato client.
    // req.ip usa la trust-proxy policy di Express (default: false).
    const fromExpress = normalizeIp(req.ip ?? '');
    if (fromExpress) return fromExpress;
    const fallback = req.socket?.remoteAddress ?? '';
    return normalizeIp(fallback);
}

function isTrustedIp(ip: string): boolean {
    const trusted = new Set<string>(config.dashboardTrustedIps.map(normalizeIp));
    return trusted.has(ip);
}

function isApiKeyAuthValid(req: Request): boolean {
    if (!config.dashboardApiKey) return false;
    const fromHeader = req.header('x-api-key');
    if (fromHeader && secureEquals(fromHeader.trim(), config.dashboardApiKey)) return true;
    const authorization = req.header('authorization') ?? '';
    if (!authorization.toLowerCase().startsWith('bearer ')) return false;
    const token = authorization.slice('bearer '.length).trim();
    return token.length > 0 && secureEquals(token, config.dashboardApiKey);
}

function isBasicAuthValid(req: Request): boolean {
    if (!config.dashboardBasicUser || !config.dashboardBasicPassword) return false;
    const authorization = req.header('authorization') ?? '';
    if (!authorization.toLowerCase().startsWith('basic ')) return false;
    const encoded = authorization.slice('basic '.length).trim();
    if (!encoded) return false;
    let decoded = '';
    try {
        decoded = Buffer.from(encoded, 'base64').toString('utf8');
    } catch {
        return false;
    }
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex <= 0) return false;
    const user = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);
    return secureEquals(user, config.dashboardBasicUser) && secureEquals(password, config.dashboardBasicPassword);
}

function parseCookieHeader(req: Request): Record<string, string> {
    const raw = req.header('cookie') ?? '';
    if (!raw) return {};
    const cookies: Record<string, string> = {};
    for (const pair of raw.split(';')) {
        const trimmed = pair.trim();
        if (!trimmed) continue;
        const idx = trimmed.indexOf('=');
        if (idx <= 0) continue;
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        if (!key) continue;
        try {
            cookies[key] = decodeURIComponent(value);
        } catch {
            cookies[key] = value;
        }
    }
    return cookies;
}

function hasValidDashboardSession(req: Request): boolean {
    const token = parseCookieHeader(req)[DASHBOARD_SESSION_COOKIE];
    if (!token) return false;
    const expiresAt = dashboardSessions.get(token);
    if (!expiresAt) return false;
    if (expiresAt <= Date.now()) {
        dashboardSessions.delete(token);
        return false;
    }
    return true;
}

function createDashboardSessionCookie(res: Response): void {
    const token = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + DASHBOARD_SESSION_TTL_MS;
    dashboardSessions.set(token, expiresAt);
    const maxAgeSec = Math.floor(DASHBOARD_SESSION_TTL_MS / 1000);
    const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    const cookie = `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secureFlag}`;
    res.setHeader('Set-Cookie', cookie);
}

function cleanupExpiredDashboardSessions(): void {
    const now = Date.now();
    for (const [token, expiresAt] of dashboardSessions.entries()) {
        if (expiresAt <= now) {
            dashboardSessions.delete(token);
        }
    }
}

function dashboardAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!config.dashboardAuthEnabled) { next(); return; }
    if (req.path === '/health') { next(); return; }
    const requestIp = resolveRequestIp(req);
    if (isTrustedIp(requestIp)) { next(); return; }
    if (hasValidDashboardSession(req)) { next(); return; }
    const authConfigured = !!config.dashboardApiKey || (!!config.dashboardBasicUser && !!config.dashboardBasicPassword);
    if (!authConfigured) {
        res.status(503).json({ error: 'Dashboard auth enabled but no credentials configured.' });
        return;
    }
    if (isApiKeyAuthValid(req) || isBasicAuthValid(req)) { next(); return; }
    res.setHeader('WWW-Authenticate', 'Basic realm="LinkedIn Bot Dashboard"');
    res.status(401).json({ error: 'Unauthorized' });
}

// ── Helper centralizzato per errori API ──────────────────────────────────────
function handleApiError(res: Response, err: unknown, context: string): void {
    const message = err instanceof Error ? err.message : String(err);
    // Non espone stack trace né dettagli interni in produzione
    void logError(context, { error: message });
    res.status(500).json({ error: 'Errore interno del server.' });
}

interface DailyTrendRow {
    date: string;
    invitesSent: number;
    messagesSent: number;
    acceptances: number;
    runErrors: number;
    challenges: number;
    estimatedRiskScore: number;
}

function writeSseEvent(res: Response, eventType: string, data: unknown): void {
    res.write(`event: ${eventType}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function mapDailyToPredictiveSample(day: {
    invitesSent: number;
    messagesSent: number;
    runErrors: number;
    selectorFailures: number;
    challengesCount: number;
}) {
    const operations = Math.max(1, day.invitesSent + day.messagesSent);
    return {
        errorRate: day.runErrors / operations,
        selectorFailureRate: day.selectorFailures / operations,
        challengeCount: day.challengesCount,
        inviteVelocityRatio: day.invitesSent / Math.max(1, config.hardInviteCap),
    };
}

app.use('/api', dashboardAuthMiddleware);

// ── Static (Dashboard UI) ────────────────────────────────────────────────────
const publicDir = path.resolve(__dirname, '../../public');
app.use(express.static(publicDir));

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Session bootstrap (cookie-based auth for browser SSE/fetch) ─────────────
app.post('/api/auth/session', (_req, res) => {
    createDashboardSessionCookie(res);
    cleanupExpiredDashboardSessions();
    res.json({ success: true, ttlSeconds: Math.floor(DASHBOARD_SESSION_TTL_MS / 1000) });
});

// ── SSE stream (real-time push notifications) ────────────────────────────────
app.get('/api/events', (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const onEvent = (event: LiveEventMessage): void => {
        writeSseEvent(res, event.type, event);
    };
    const unsubscribe = subscribeLiveEvents(onEvent);

    writeSseEvent(res, 'connected', {
        timestamp: new Date().toISOString(),
        subscribers: getLiveEventSubscribersCount(),
    });

    const heartbeat = setInterval(() => {
        writeSseEvent(res, 'heartbeat', {
            timestamp: new Date().toISOString(),
        });
    }, 20_000);

    res.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
    });
});

// ── KPIs ─────────────────────────────────────────────────────────────────────
app.get('/api/kpis', async (_req, res) => {
    try {
        const kpi = await getGlobalKPIData();
        const localDate = getLocalDateString();
        const riskInputs = await getRiskInputs(localDate, config.hardInviteCap);
        const risk = await evaluateRisk(riskInputs);
        const runtimePause = await getRuntimeFlag('automation_paused_until');
        const isQuarantined = await getRuntimeFlag('account_quarantine');

        res.json({
            funnel: {
                totalLeads: kpi.totalLeads,
                invited: kpi.statusCounts['INVITED'] ?? 0,
                accepted: kpi.statusCounts['ACCEPTED'] ?? 0,
                readyMessage: kpi.statusCounts['READY_MESSAGE'] ?? 0,
                messaged: kpi.statusCounts['MESSAGED'] ?? 0,
                replied: kpi.statusCounts['REPLIED'] ?? 0,
                withdrawn: kpi.statusCounts['WITHDRAWN'] ?? 0,
            },
            risk,
            activeCampaigns: kpi.activeCampaigns,
            system: {
                pausedUntil: runtimePause ?? null,
                quarantined: isQuarantined === 'true',
            },
        });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.kpis');
    }
});

// ── Runs recenti ─────────────────────────────────────────────────────────────
app.get('/api/runs', async (_req, res) => {
    try {
        const db = await getDatabase();
        const runs = await db.query<CampaignRunRecord>(`SELECT * FROM campaign_runs ORDER BY id DESC LIMIT 10`);
        res.json(runs);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.runs');
    }
});

// ── A/B Testing Stats ─────────────────────────────────────────────────────────
app.get('/api/ab-testing/stats', async (_req, res) => {
    try {
        const stats = await getABTestingStats();
        res.json(stats);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.ab-testing.stats');
    }
});

// ── A/B Bandit Leaderboard ────────────────────────────────────────────────────
app.get('/api/ml/ab-leaderboard', async (_req, res) => {
    try {
        const { getVariantLeaderboard } = await import('../ml/abBandit');
        const leaderboard = await getVariantLeaderboard();
        res.json(leaderboard);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.ml.ab-leaderboard');
    }
});

// ── Timing Optimizer ──────────────────────────────────────────────────────────
app.get('/api/ml/timing-slots', async (req, res) => {
    try {
        const { getTopTimeSlots } = await import('../ml/timingOptimizer');
        const rawN = Number.parseInt(String(req.query.n ?? '5'), 10);
        const n = Number.isFinite(rawN) && rawN > 0 ? Math.min(10, rawN) : 5;
        const slots = await getTopTimeSlots(n);
        res.json(slots);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.ml.timing-slots');
    }
});

// ── Incidents — lista aperti ──────────────────────────────────────────────────
app.get('/api/incidents', async (_req, res) => {
    try {
        const incidents = await listOpenIncidents();
        res.json(incidents);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.incidents.list');
    }
});

// ── Incidents — risolvi ───────────────────────────────────────────────────────
app.post('/api/incidents/:id/resolve', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id) || id <= 0) {
            res.status(400).json({ error: 'ID incidente non valido.' });
            return;
        }
        await resolveIncident(id);
        publishLiveEvent('incident.resolved', { incidentId: id });
        res.json({ success: true, message: `Incidente ${id} risolto.` });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.incidents.resolve');
    }
});

// ── Trend 7 giorni ────────────────────────────────────────────────────────────
app.get('/api/stats/trend', async (_req, res) => {
    try {
        const today = new Date();
        const trend: DailyTrendRow[] = [];
        const localDate = getLocalDateString();
        const currentRiskInputs = await getRiskInputs(localDate, config.hardInviteCap);
        const pendingRatioReference = currentRiskInputs.pendingRatio;

        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateStr = getLocalDateString(d);
            const [invites, messages, acceptances, runErrors, challenges] = await Promise.all([
                getDailyStat(dateStr, 'invites_sent'),
                getDailyStat(dateStr, 'messages_sent'),
                getDailyStat(dateStr, 'acceptances' as Parameters<typeof getDailyStat>[1]),
                getDailyStat(dateStr, 'run_errors'),
                getDailyStat(dateStr, 'challenges_count'),
            ]);
            const operations = Math.max(1, invites + messages);
            const estimatedRisk = evaluateRisk({
                pendingRatio: pendingRatioReference,
                errorRate: runErrors / operations,
                selectorFailureRate: 0,
                challengeCount: challenges,
                inviteVelocityRatio: invites / Math.max(1, config.hardInviteCap),
            });
            trend.push({
                date: dateStr,
                invitesSent: invites,
                messagesSent: messages,
                acceptances,
                runErrors,
                challenges,
                estimatedRiskScore: estimatedRisk.score,
            });
        }

        res.json(trend);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.stats.trend');
    }
});

// ── Predictive risk (baseline media mobile + sigma) ─────────────────────────
app.get('/api/risk/predictive', async (_req, res) => {
    try {
        const localDate = getLocalDateString();
        const lookbackDays = config.riskPredictiveLookbackDays;
        const rows = await getRecentDailyStats(lookbackDays + 1);
        const todayRow = rows.find((row) => row.date === localDate) ?? null;

        const historySamples = rows
            .filter((row) => row.date !== localDate)
            .slice(0, lookbackDays)
            .map(mapDailyToPredictiveSample);

        const currentRiskInputs = await getRiskInputs(localDate, config.hardInviteCap);
        const currentSample = {
            errorRate: currentRiskInputs.errorRate,
            selectorFailureRate: currentRiskInputs.selectorFailureRate,
            challengeCount: currentRiskInputs.challengeCount,
            inviteVelocityRatio: currentRiskInputs.inviteVelocityRatio,
        };

        const alerts = evaluatePredictiveRiskAlerts(
            currentSample,
            historySamples,
            config.riskPredictiveSigma
        );

        res.json({
            enabled: config.riskPredictiveAlertsEnabled,
            lookbackDays,
            sigma: config.riskPredictiveSigma,
            currentDate: localDate,
            currentSample,
            today: todayRow,
            historyCount: historySamples.length,
            alerts,
        });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.risk.predictive');
    }
});

// ── Review queue (challenge/manual review) ───────────────────────────────────
app.get('/api/review-queue', async (req, res) => {
    try {
        const rawLimit = Number.parseInt(String(req.query.limit ?? '25'), 10);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 25;

        const [reviewLeads, incidents, challengePendingFlag, lastIncidentId] = await Promise.all([
            getLeadsByStatus('REVIEW_REQUIRED', limit),
            listOpenIncidents(),
            getRuntimeFlag('challenge_review_pending'),
            getRuntimeFlag('challenge_review_last_incident_id'),
        ]);
        const challengeIncidents = incidents.filter((incident) => incident.type === 'CHALLENGE_DETECTED');

        res.json({
            pending: challengePendingFlag === 'true',
            lastIncidentId: lastIncidentId ? Number.parseInt(lastIncidentId, 10) : null,
            reviewLeadCount: reviewLeads.length,
            challengeIncidentCount: challengeIncidents.length,
            leads: reviewLeads.map((lead) => ({
                id: lead.id,
                status: lead.status,
                listName: lead.list_name,
                firstName: lead.first_name,
                lastName: lead.last_name,
                linkedinUrl: lead.linkedin_url,
                updatedAt: lead.updated_at,
                lastError: lead.last_error,
            })),
            incidents: challengeIncidents,
        });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.review-queue');
    }
});

// ── Controls ──────────────────────────────────────────────────────────────────
app.post('/api/controls/pause', async (req, res) => {
    try {
        const rawMinutes = req.body.minutes;
        const minutes = typeof rawMinutes === 'number' && rawMinutes > 0 ? Math.min(rawMinutes, 10080) : 1440;
        await pauseAutomation('MANUAL_UI_PAUSE', { source: 'dashboard' }, minutes);
        res.json({ success: true, message: `Pausa attivata per ${minutes} minuti.` });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.controls.pause');
    }
});

app.post('/api/controls/resume', async (_req, res) => {
    try {
        await resumeAutomation();
        res.json({ success: true, message: 'Ripresa automazione.' });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.controls.resume');
    }
});

app.post('/api/controls/quarantine', async (req, res) => {
    try {
        const enabled = req.body.enabled === true;
        await setQuarantine(enabled);
        res.json({ success: true, message: `Quarantena ${enabled ? 'attivata' : 'disattivata'}.` });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.controls.quarantine');
    }
});

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use('/api/', (_req, res) => {
    res.status(404).json({ error: 'Endpoint non trovato.' });
});

export function startServer(port: number = 3000) {
    const server = app.listen(port, () => {
        const address = server.address();
        const effectivePort = typeof address === 'object' && address ? address.port : port;
        console.log(`\n🚀 Dashboard & Web API is running on http://localhost:${effectivePort}\n`);
    });
    return server;
}
