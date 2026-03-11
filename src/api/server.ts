/**
 * api/server.ts
 * ─────────────────────────────────────────────────────────────────
 * Express API server per la dashboard e il controllo del bot.
 *
 * API Versioning:
 *   /api/v1/*  — Route versionizzate (nuove feature)
 *   /api/*     — Route legacy (backward compatible, deprecate progressivamente)
 *
 * Router modulari:
 *   /api/v1/campaigns  → routes/campaigns.ts
 *   /api/v1/export     → routes/export.ts
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import rateLimit from 'express-rate-limit';
import type { NextFunction, Request, Response } from 'express';
import {
    getABTestingStats,
    getAiQualitySnapshot,
    getDailyStat,
    getGlobalKPIData,
    getLeadsByStatus,
    getOperationalObservabilitySnapshot,
    getRecentDailyStats,
    getRiskInputs,
    getRuntimeFlag,
    listAccountHealthSnapshots,
    listLatestAccountHealthSnapshots,
    listOpenIncidents,
    listRecentBackupRuns,
    listSecurityAuditEvents,
    listCommentSuggestionsForReview,
    recordSecurityAuditEvent,
    reviewCommentSuggestion,
    resolveIncident,
    runAiValidationPipeline,
    setRuntimeFlag,
    countPendingOutboxEvents,
    getAutomationPauseState,
} from '../core/repositories';
import { getDatabase } from '../db';
import campaignsRouter from './routes/campaigns';
import exportRouter from './routes/export';
import blacklistRouter from './routes/blacklist';
import leadsRouter from './routes/leads';
import { handlePauseAction, handleResumeAction, handleQuarantineAction } from './helpers/controlActions';
import { sendApiV1, handleApiError } from './utils';
import { evaluatePredictiveRiskAlerts, evaluateRisk, explainRisk } from '../risk/riskEngine';
import { getLocalDateString, config } from '../config';
import { CampaignRunRecord } from '../types/domain';
import {
    publishLiveEvent,
    subscribeLiveEvents,
    getLiveEventSubscribersCount,
    type LiveEventMessage,
} from '../telemetry/liveEvents';
import { resolveCorrelationId, runWithCorrelationId } from '../telemetry/correlation';
import { getCircuitBreakerSnapshot } from '../core/integrationPolicy';
import { WebSocketServer, WebSocket } from 'ws';

const app = express();
app.set('trust proxy', false);
const DASHBOARD_SESSION_COOKIE = 'dashboard_session';
const DASHBOARD_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DASHBOARD_AUTH_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const DASHBOARD_AUTH_MAX_FAILURES = 5;
const DASHBOARD_AUTH_LOCKOUT_MS = 30 * 60 * 1000;
const sessionCleanupTimer = setInterval(
    () => {
        void cleanupExpiredDashboardSessions().catch(() => null);
    },
    15 * 60 * 1000,
);
sessionCleanupTimer.unref();

// ── CORS ristretto ──────────────────────────────────────────────────────────
// Accetta solo richieste da localhost o se non c'è origin (es. curl / stesso server)
app.use(
    cors({
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
    }),
);

app.use(express.json({ limit: '64kb' }));

app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const origin = req.header('origin');
        const referer = req.header('referer');
        const source = origin || referer || '';
        if (source) {
            const allowedPatterns = [
                /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i,
                ...config.dashboardTrustedIps.map(
                    (ip) => new RegExp(`^https?://${ip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(:\\d+)?`, 'i'),
                ),
            ];
            const allowed = allowedPatterns.some((pattern) => pattern.test(source));
            if (!allowed) {
                res.status(403).json({ error: { code: 'CSRF_ORIGIN_REJECTED', message: 'Origin non consentita' } });
                return;
            }
        }
    }
    next();
});

app.use((req, res, next) => {
    const incomingCorrelation = req.header('x-correlation-id') ?? req.header('x-request-id');
    const correlationId = resolveCorrelationId(incomingCorrelation);
    res.setHeader('x-correlation-id', correlationId);
    runWithCorrelationId(correlationId, () => {
        res.locals.correlationId = correlationId;
        next();
    });
});

// ── Rate Limiting ────────────────────────────────────────────────────────────
// keyGenerator: identifica il client per session token o API key, non solo IP.
// Dietro NAT/proxy tutti condividono l'IP → il rate limit per IP è insufficiente.
function rateLimitKeyGenerator(req: Request): string {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const apiKey = (req.header('x-api-key') ?? '').trim();
    if (apiKey) return `apikey:${apiKey.slice(0, 8)}`;
    const sessionToken = parseCookieHeader(req)[DASHBOARD_SESSION_COOKIE];
    if (sessionToken) return `session:${sessionToken.slice(0, 8)}`;
    return `ip:${ip}`;
}

// Limite globale: 120 req/min per client su tutti gli endpoint /api/
const globalLimiter = rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: rateLimitKeyGenerator,
    skip: (req) => {
        const path = req.path ?? '';
        const originalUrl = req.originalUrl ?? '';
        return path === '/events' || path === '/api/events' || originalUrl.startsWith('/api/events');
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
    keyGenerator: rateLimitKeyGenerator,
    message: { error: 'Troppe operazioni di controllo. Attendi prima di riprovare.' },
});
app.use('/api/controls/', controlsLimiter);

const authSessionLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Troppi tentativi auth. Riprova più tardi.' },
});
app.use('/api/auth/session', authSessionLimiter);

// ── Sicurezza Header HTTP ────────────────────────────────────────────────────
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
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

function getDashboardSessionTokenFromRequest(req: Request): string | null {
    const token = parseCookieHeader(req)[DASHBOARD_SESSION_COOKIE];
    if (!token) return null;
    const trimmed = token.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function hashDashboardSessionToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function buildDashboardSessionCookie(token: string, maxAgeSec: number, req?: Request): string {
    const isSecure = req ? (req.secure || req.headers['x-forwarded-proto'] === 'https') : Boolean(config.databaseUrl);
    const secureFlag = isSecure ? '; Secure' : '';
    return `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secureFlag}`;
}

interface DashboardSessionRow {
    expires_at: string;
    revoked_at: string | null;
}

interface DashboardAuthAttemptRow {
    failed_count: number;
    first_failed_at: string | null;
    locked_until: string | null;
}

async function revokeDashboardSession(token: string): Promise<void> {
    const tokenHash = hashDashboardSessionToken(token);
    const db = await getDatabase();
    const nowIso = new Date().toISOString();
    await db.run(
        `UPDATE dashboard_sessions
            SET revoked_at = ?, last_seen_at = ?
          WHERE token_hash = ? AND revoked_at IS NULL`,
        [nowIso, nowIso, tokenHash],
    );
}

async function hasValidDashboardSession(req: Request): Promise<boolean> {
    const token = getDashboardSessionTokenFromRequest(req);
    if (!token) return false;

    const tokenHash = hashDashboardSessionToken(token);
    const db = await getDatabase();
    const row = await db.get<DashboardSessionRow>(
        `SELECT expires_at, revoked_at
           FROM dashboard_sessions
          WHERE token_hash = ?
          LIMIT 1`,
        [tokenHash],
    );

    if (!row || row.revoked_at) {
        return false;
    }

    const expiresAtMs = Date.parse(row.expires_at);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        return false;
    }

    const nowIso = new Date().toISOString();
    const refreshedExpiry = new Date(Date.now() + DASHBOARD_SESSION_TTL_MS).toISOString();
    await db.run(
        `UPDATE dashboard_sessions
            SET last_seen_at = ?, expires_at = ?
          WHERE token_hash = ?`,
        [nowIso, refreshedExpiry, tokenHash],
    );
    return true;
}

async function createDashboardSessionCookie(req: Request, res: Response): Promise<void> {
    const currentToken = getDashboardSessionTokenFromRequest(req);
    if (currentToken) {
        await revokeDashboardSession(currentToken);
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = hashDashboardSessionToken(token);
    const nowIso = new Date().toISOString();
    const expiresAtIso = new Date(Date.now() + DASHBOARD_SESSION_TTL_MS).toISOString();
    const maxAgeSec = Math.floor(DASHBOARD_SESSION_TTL_MS / 1000);
    const userAgent = (req.header('user-agent') ?? '').slice(0, 255);
    const requestIp = resolveRequestIp(req);

    const db = await getDatabase();
    await db.run(
        `INSERT INTO dashboard_sessions (
            token_hash,
            created_at,
            expires_at,
            last_seen_at,
            created_ip,
            user_agent
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [tokenHash, nowIso, expiresAtIso, nowIso, requestIp, userAgent],
    );
    res.setHeader('Set-Cookie', buildDashboardSessionCookie(token, maxAgeSec, req));
}

function clearDashboardSessionCookie(req: Request, res: Response): void {
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const secureFlag = isSecure ? '; Secure' : '';
    res.setHeader(
        'Set-Cookie',
        `${DASHBOARD_SESSION_COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secureFlag}`,
    );
}

async function cleanupExpiredDashboardSessions(): Promise<void> {
    const nowIso = new Date().toISOString();
    const db = await getDatabase();
    await db.run(
        `DELETE FROM dashboard_sessions
          WHERE expires_at <= ?
             OR revoked_at IS NOT NULL`,
        [nowIso],
    );
}

async function isDashboardAuthLocked(requestIp: string): Promise<boolean> {
    const db = await getDatabase();
    const row = await db.get<{ locked_until: string | null }>(
        `SELECT locked_until
           FROM dashboard_auth_attempts
          WHERE ip = ?
          LIMIT 1`,
        [requestIp],
    );
    if (!row?.locked_until) return false;
    const lockedUntilMs = Date.parse(row.locked_until);
    return Number.isFinite(lockedUntilMs) && lockedUntilMs > Date.now();
}

async function clearDashboardAuthFailures(requestIp: string): Promise<void> {
    const db = await getDatabase();
    await db.run(`DELETE FROM dashboard_auth_attempts WHERE ip = ?`, [requestIp]);
}

async function recordDashboardAuthFailure(requestIp: string): Promise<{ locked: boolean; lockedUntil: string | null }> {
    const db = await getDatabase();
    const now = new Date();
    const nowIso = now.toISOString();
    const nowMs = now.getTime();
    const existing = await db.get<DashboardAuthAttemptRow>(
        `SELECT failed_count, first_failed_at, locked_until
           FROM dashboard_auth_attempts
          WHERE ip = ?
          LIMIT 1`,
        [requestIp],
    );

    let failedCount = 1;
    let firstFailedAt = nowIso;
    if (existing) {
        const previousFirstMs = existing.first_failed_at ? Date.parse(existing.first_failed_at) : Number.NaN;
        if (Number.isFinite(previousFirstMs) && nowMs - previousFirstMs <= DASHBOARD_AUTH_ATTEMPT_WINDOW_MS) {
            failedCount = Number(existing.failed_count ?? 0) + 1;
            firstFailedAt = existing.first_failed_at ?? nowIso;
        }
    }

    const shouldLock = failedCount >= DASHBOARD_AUTH_MAX_FAILURES;
    const lockedUntil = shouldLock ? new Date(nowMs + DASHBOARD_AUTH_LOCKOUT_MS).toISOString() : null;

    if (existing) {
        await db.run(
            `UPDATE dashboard_auth_attempts
                SET failed_count = ?,
                    first_failed_at = ?,
                    last_failed_at = ?,
                    locked_until = ?,
                    updated_at = ?
              WHERE ip = ?`,
            [failedCount, firstFailedAt, nowIso, lockedUntil, nowIso, requestIp],
        );
    } else {
        await db.run(
            `INSERT INTO dashboard_auth_attempts (
                ip,
                failed_count,
                first_failed_at,
                last_failed_at,
                locked_until,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [requestIp, failedCount, firstFailedAt, nowIso, lockedUntil, nowIso],
        );
    }

    return { locked: shouldLock, lockedUntil };
}

async function dashboardAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!config.dashboardAuthEnabled) {
        next();
        return;
    }
    if (req.path === '/health') {
        next();
        return;
    }

    const requestIp = resolveRequestIp(req);

    try {
        if (isTrustedIp(requestIp)) {
            auditSecurityEvent({
                category: 'dashboard_auth',
                action: 'trusted_ip_access',
                actor: requestIp,
                result: 'ALLOW',
                metadata: { path: req.path, method: req.method },
            });
            next();
            return;
        }
        if (await hasValidDashboardSession(req)) {
            next();
            return;
        }

        const authConfigured =
            !!config.dashboardApiKey || (!!config.dashboardBasicUser && !!config.dashboardBasicPassword);
        if (!authConfigured) {
            res.status(503).json({ error: 'Dashboard auth enabled but no credentials configured.' });
            return;
        }

        const isAuthBootstrapPath = req.path === '/auth/session';
        if (isApiKeyAuthValid(req) || isBasicAuthValid(req)) {
            if (isAuthBootstrapPath) {
                await clearDashboardAuthFailures(requestIp);
            }
            auditSecurityEvent({
                category: 'dashboard_auth',
                action: 'auth_credentials_valid',
                actor: requestIp,
                result: 'ALLOW',
                metadata: {
                    path: req.path,
                    method: req.method,
                    bootstrap: isAuthBootstrapPath,
                },
            });
            next();
            return;
        }

        if (isAuthBootstrapPath) {
            const alreadyLocked = await isDashboardAuthLocked(requestIp);
            if (alreadyLocked) {
                auditSecurityEvent({
                    category: 'dashboard_auth',
                    action: 'auth_locked',
                    actor: requestIp,
                    result: 'DENY',
                    metadata: {
                        path: req.path,
                    },
                });
                res.status(429).json({ error: 'Troppi tentativi auth falliti. Riprova più tardi.' });
                return;
            }
            const lockState = await recordDashboardAuthFailure(requestIp);
            if (lockState.locked) {
                auditSecurityEvent({
                    category: 'dashboard_auth',
                    action: 'auth_lock_triggered',
                    actor: requestIp,
                    result: 'DENY',
                    metadata: {
                        path: req.path,
                        lockedUntil: lockState.lockedUntil,
                    },
                });
                res.status(429).json({
                    error: 'Troppi tentativi auth falliti. Accesso temporaneamente bloccato.',
                    lockedUntil: lockState.lockedUntil,
                });
                return;
            }
            auditSecurityEvent({
                category: 'dashboard_auth',
                action: 'auth_failure',
                actor: requestIp,
                result: 'DENY',
                metadata: {
                    path: req.path,
                },
            });
        }

        auditSecurityEvent({
            category: 'dashboard_auth',
            action: 'auth_unauthorized',
            actor: requestIp,
            result: 'DENY',
            metadata: {
                path: req.path,
                method: req.method,
            },
        });
        res.setHeader('WWW-Authenticate', 'Basic realm="LinkedIn Bot Dashboard"');
        res.status(401).json({ error: 'Unauthorized' });
    } catch (error) {
        handleApiError(res, error, 'api.auth.middleware');
    }
}

// ── Helper centralizzato per errori API ──────────────────────────────────────
// (Ora importato da ./utils)

function auditSecurityEvent(payload: {
    category: string;
    action: string;
    actor?: string | null;
    accountId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    result: string;
    metadata?: Record<string, unknown>;
}): void {
    void recordSecurityAuditEvent(payload).catch(() => null);
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

// ApiV1Envelope importato da ./utils

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

// ── Helper condivisi controls (estratti in api/helpers/controlActions.ts) ──

app.use('/api', dashboardAuthMiddleware);

async function apiV1AuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!config.dashboardAuthEnabled) {
        next();
        return;
    }
    const requestIp = resolveRequestIp(req);
    const authConfigured = !!config.dashboardApiKey || (!!config.dashboardBasicUser && !!config.dashboardBasicPassword);
    if (!authConfigured) {
        res.status(503).json({ error: 'API v1 auth enabled but no credentials configured.' });
        return;
    }
    if (isApiKeyAuthValid(req) || isBasicAuthValid(req) || await hasValidDashboardSession(req)) {
        auditSecurityEvent({
            category: 'api_v1_auth',
            action: 'auth_credentials_valid',
            actor: requestIp,
            result: 'ALLOW',
            metadata: {
                path: req.path,
                method: req.method,
            },
        });
        next();
        return;
    }
    auditSecurityEvent({
        category: 'api_v1_auth',
        action: 'auth_unauthorized',
        actor: requestIp,
        result: 'DENY',
        metadata: {
            path: req.path,
            method: req.method,
        },
    });
    res.setHeader('WWW-Authenticate', 'Bearer realm="LinkedIn Bot API v1"');
    res.status(401).json({ error: 'Unauthorized' });
}

app.use('/api/v1', apiV1AuthMiddleware);
app.use('/api/v1/campaigns', campaignsRouter);

// sendApiV1 importato da ./utils

// ── Static (Dashboard UI) ────────────────────────────────────────────────────
const publicDir = path.resolve(__dirname, '../../public');
app.use(express.static(publicDir));

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/health/deep', async (_req, res) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};
    let allOk = true;

    // 1. Connettività DB
    try {
        const db = await getDatabase();
        await db.get<{ v: number }>('SELECT 1 as v');
        checks.database = { ok: true };
    } catch (err: unknown) {
        checks.database = { ok: false, detail: err instanceof Error ? err.message : String(err) };
        allOk = false;
    }

    // 2. Stato pausa/quarantine
    try {
        const pause = await getAutomationPauseState();
        checks.automation = {
            ok: !pause.paused,
            detail: pause.paused ? `Paused: ${pause.reason ?? 'unknown'}` : 'running',
        };
    } catch {
        checks.automation = { ok: false, detail: 'Unable to read pause state' };
        allOk = false;
    }

    // 3. Outbox backlog
    try {
        const pendingOutbox = await countPendingOutboxEvents();
        const threshold = config.outboxAlertBacklog ?? 1000;
        checks.outbox = {
            ok: pendingOutbox < threshold,
            detail: `${pendingOutbox} pending (threshold: ${threshold})`,
        };
        if (pendingOutbox >= threshold) allOk = false;
    } catch {
        checks.outbox = { ok: false, detail: 'Unable to read outbox' };
        allOk = false;
    }

    // 4. Queue depth
    try {
        const db = await getDatabase();
        const row = await db.get<{ total: number }>('SELECT COUNT(*) as total FROM jobs WHERE status = \'QUEUED\'');
        const queueDepth = row ? Number(row.total) : 0;
        checks.queue = { ok: true, detail: `${queueDepth} queued jobs` };
    } catch {
        checks.queue = { ok: false, detail: 'Unable to read job queue' };
        allOk = false;
    }

    const statusCode = allOk ? 200 : 503;
    res.status(statusCode).json({
        status: allOk ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        checks,
    });
});

// ── API v1 (automazioni esterne) ────────────────────────────────────────────
app.get('/api/v1/meta', (_req, res) => {
    sendApiV1(res, {
        service: 'linkedin-bot',
        supportedVersions: ['v1'],
        auth: {
            required: true,
            schemes: ['x-api-key', 'authorization: bearer', 'authorization: basic'],
        },
        endpoints: [
            { method: 'GET', path: '/api/v1/meta' },
            { method: 'GET', path: '/api/v1/automation/snapshot' },
            { method: 'GET', path: '/api/v1/automation/incidents?limit=25' },
            { method: 'POST', path: '/api/v1/automation/controls/pause' },
            { method: 'POST', path: '/api/v1/automation/controls/resume' },
            { method: 'POST', path: '/api/v1/automation/controls/quarantine' },
        ],
    });
});

app.get('/api/v1/automation/snapshot', async (_req, res) => {
    try {
        const localDate = getLocalDateString();
        const [kpi, riskInputs, runtimePause, isQuarantinedRaw, incidents, observability] = await Promise.all([
            getGlobalKPIData(),
            getRiskInputs(localDate, config.hardInviteCap),
            getRuntimeFlag('automation_paused_until'),
            getRuntimeFlag('account_quarantine'),
            listOpenIncidents(),
            getOperationalObservabilitySnapshot(localDate),
        ]);
        const risk = evaluateRisk(riskInputs);
        const isQuarantined = isQuarantinedRaw === 'true';
        const criticalIncidents = incidents.filter((incident) => incident.severity === 'CRITICAL');

        sendApiV1(res, {
            localDate,
            system: {
                pausedUntil: runtimePause ?? null,
                quarantined: isQuarantined,
            },
            funnel: {
                totalLeads: kpi.totalLeads,
                invited: kpi.statusCounts['INVITED'] ?? 0,
                accepted: kpi.statusCounts['ACCEPTED'] ?? 0,
                readyMessage: kpi.statusCounts['READY_MESSAGE'] ?? 0,
                messaged: kpi.statusCounts['MESSAGED'] ?? 0,
                replied: kpi.statusCounts['REPLIED'] ?? 0,
            },
            risk: {
                score: risk.score,
                action: risk.action,
                pendingRatio: risk.pendingRatio,
                errorRate: risk.errorRate,
                selectorFailureRate: risk.selectorFailureRate,
                challengeCount: risk.challengeCount,
                inviteVelocityRatio: risk.inviteVelocityRatio,
            },
            incidents: {
                openCount: incidents.length,
                criticalCount: criticalIncidents.length,
            },
            observability: {
                queueLagSeconds: observability.queueLagSeconds,
                oldestRunningJobSeconds: observability.oldestRunningJobSeconds,
                runErrors: observability.runErrors,
                selectorFailures: observability.selectorFailures,
                challengesCount: observability.challengesCount,
                sloStatus: observability.slo.status,
                selectorCacheKpi: {
                    windowDays: observability.selectorCacheKpi.windowDays,
                    currentFailures: observability.selectorCacheKpi.currentFailures,
                    previousFailures: observability.selectorCacheKpi.previousFailures,
                    reductionPct: observability.selectorCacheKpi.reductionPct,
                    targetReductionPct: Number.parseFloat(
                        (observability.selectorCacheKpi.targetReductionRate * 100).toFixed(2),
                    ),
                    minBaselineFailures: observability.selectorCacheKpi.minBaselineFailures,
                    baselineSufficient: observability.selectorCacheKpi.baselineSufficient,
                    validationStatus: observability.selectorCacheKpi.validationStatus,
                    targetMet: observability.selectorCacheKpi.targetMet,
                },
            },
        });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.v1.automation.snapshot');
    }
});

app.get('/api/v1/automation/incidents', async (req, res) => {
    try {
        const rawLimit = Number.parseInt(String(req.query.limit ?? '25'), 10);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 25;
        const incidents = await listOpenIncidents();
        sendApiV1(res, {
            count: incidents.length,
            limit,
            rows: incidents.slice(0, limit),
        });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.v1.automation.incidents');
    }
});

app.post('/api/v1/automation/controls/pause', async (req, res) => {
    try {
        const result = await handlePauseAction(req, 'api_v1', 1440);
        sendApiV1(res, { ...result, action: 'pause' });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.v1.automation.controls.pause');
    }
});

app.post('/api/v1/automation/controls/resume', async (req, res) => {
    try {
        await handleResumeAction(req, 'api_v1');
        sendApiV1(res, { success: true, action: 'resume' });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.v1.automation.controls.resume');
    }
});

app.post('/api/v1/automation/controls/quarantine', async (req, res) => {
    try {
        const result = await handleQuarantineAction(req, 'api_v1');
        sendApiV1(res, { success: true, action: 'quarantine', enabled: result.enabled });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.v1.automation.controls.quarantine');
    }
});

// ── Session bootstrap (cookie-based auth for browser SSE/fetch) ─────────────
app.post('/api/auth/session', async (req, res) => {
    try {
        await createDashboardSessionCookie(req, res);
        await cleanupExpiredDashboardSessions();
        auditSecurityEvent({
            category: 'dashboard_auth',
            action: 'session_created',
            actor: resolveRequestIp(req),
            result: 'ALLOW',
            metadata: {
                userAgent: req.header('user-agent') ?? '',
            },
        });
        res.json({ success: true, ttlSeconds: Math.floor(DASHBOARD_SESSION_TTL_MS / 1000) });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.auth.session');
    }
});

app.post('/api/auth/logout', async (req, res) => {
    try {
        const token = getDashboardSessionTokenFromRequest(req);
        if (token) {
            await revokeDashboardSession(token);
        }
        clearDashboardSessionCookie(req, res);
        auditSecurityEvent({
            category: 'dashboard_auth',
            action: 'session_logout',
            actor: resolveRequestIp(req),
            result: 'ALLOW',
        });
        res.json({ success: true });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.auth.logout');
    }
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
        // SSE comment ping (keeps connection alive through corporate proxies)
        res.write(': ping\n\n');
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
        const risk = evaluateRisk(riskInputs);
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
        const runs = await db.query<CampaignRunRecord>(
            `SELECT id, start_time, end_time, status, profiles_discovered, invites_sent, messages_sent, errors_count, created_at
             FROM campaign_runs
             ORDER BY id DESC
             LIMIT 10`,
        );
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
        const { getTopTimeSlots, getTimingExperimentReport } = await import('../ml/timingOptimizer');
        const rawN = Number.parseInt(String(req.query.n ?? '5'), 10);
        const n = Number.isFinite(rawN) && rawN > 0 ? Math.min(10, rawN) : 5;
        const action = String(req.query.action ?? 'invite') === 'message' ? 'message' : 'invite';
        const includeExperiment = String(req.query.includeExperiment ?? 'false').toLowerCase() === 'true';
        const lookbackDaysRaw = Number.parseInt(String(req.query.lookbackDays ?? '30'), 10);
        const lookbackDays =
            Number.isFinite(lookbackDaysRaw) && lookbackDaysRaw > 0 ? Math.min(180, lookbackDaysRaw) : 30;
        const slots = await getTopTimeSlots(n, action);
        if (!includeExperiment) {
            res.json(slots);
            return;
        }
        const experiment = await getTimingExperimentReport(action, lookbackDays);
        res.json({
            action,
            slots,
            experiment,
        });
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
        auditSecurityEvent({
            category: 'incident',
            action: 'resolve',
            actor: resolveRequestIp(req),
            entityType: 'account_incident',
            entityId: String(id),
            result: 'ALLOW',
        });
        publishLiveEvent('incident.resolved', { incidentId: id });
        res.json({ success: true, message: `Incidente ${id} risolto.` });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.incidents.resolve');
    }
});

// ── Trend giornaliero (default 7 giorni, max 30) ─────────────────────────────
app.get('/api/stats/trend', async (req, res) => {
    try {
        const rawDays = Number.parseInt(String(req.query.days ?? '7'), 10);
        const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(30, rawDays)) : 7;
        const today = new Date();
        const trend: DailyTrendRow[] = [];
        const localDate = getLocalDateString();
        const currentRiskInputs = await getRiskInputs(localDate, config.hardInviteCap);
        const pendingRatioReference = currentRiskInputs.pendingRatio;

        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateStr = getLocalDateString(d);
            const [invites, messages, acceptances, runErrors, challenges] = await Promise.all([
                getDailyStat(dateStr, 'invites_sent'),
                getDailyStat(dateStr, 'messages_sent'),
                getDailyStat(dateStr, 'acceptances'),
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

        res.json({
            days,
            rows: trend,
        });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.stats.trend');
    }
});

app.get('/api/observability', async (_req, res) => {
    try {
        const localDate = getLocalDateString();
        const snapshot = await getOperationalObservabilitySnapshot(localDate);
        res.json({
            ...snapshot,
            thresholds: {
                maxSelectorFailuresPerDay: config.maxSelectorFailuresPerDay,
                maxRunErrorsPerDay: config.maxRunErrorsPerDay,
                jobStuckMinutes: config.jobStuckMinutes,
                workflowLoopIntervalMs: config.workflowLoopIntervalMs,
                slo: snapshot.slo.thresholds,
            },
            circuitBreakers: getCircuitBreakerSnapshot(),
        });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.observability');
    }
});

app.get('/api/observability/slo', async (_req, res) => {
    try {
        const localDate = getLocalDateString();
        const snapshot = await getOperationalObservabilitySnapshot(localDate);
        res.json(snapshot.slo);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.observability.slo');
    }
});

// ── Risk explain: contributo di ogni fattore allo score ──────────────────────
app.get('/api/risk/explain', async (_req, res) => {
    try {
        const localDate = getLocalDateString();
        const riskInputs = await getRiskInputs(localDate, config.hardInviteCap);
        const explanation = explainRisk(riskInputs);
        res.json(explanation);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.risk.explain');
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

        const alerts = evaluatePredictiveRiskAlerts(currentSample, historySamples, config.riskPredictiveSigma);

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

app.get('/api/ai/quality', async (req, res) => {
    try {
        const rawDays = Number.parseInt(String(req.query.days ?? '30'), 10);
        const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(180, rawDays)) : 30;
        const snapshot = await getAiQualitySnapshot(days);
        res.json(snapshot);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.ai.quality');
    }
});

app.post('/api/ai/quality/run', async (req, res) => {
    try {
        const triggeredBy =
            typeof req.body?.triggeredBy === 'string' && req.body.triggeredBy.trim()
                ? req.body.triggeredBy.trim()
                : 'dashboard';
        const run = await runAiValidationPipeline(triggeredBy);
        auditSecurityEvent({
            category: 'ai_quality',
            action: 'validation_run',
            actor: resolveRequestIp(req),
            result: 'ALLOW',
            metadata: {
                runId: run.id,
                status: run.status,
            },
        });
        res.json(run);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.ai.quality.run');
    }
});

app.get('/api/ai/comment-suggestions', async (req, res) => {
    try {
        const rawLimit = Number.parseInt(String(req.query.limit ?? '25'), 10);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 25;
        const rawStatus =
            typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : 'REVIEW_PENDING';
        if (rawStatus !== 'REVIEW_PENDING' && rawStatus !== 'APPROVED' && rawStatus !== 'REJECTED') {
            res.status(400).json({ error: 'Parametro status non valido.' });
            return;
        }

        const rows = await listCommentSuggestionsForReview(limit, rawStatus);
        res.json({
            status: rawStatus,
            count: rows.length,
            rows,
        });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.ai.comment-suggestions');
    }
});

app.post('/api/ai/comment-suggestions/:leadId/:suggestionIndex/approve', async (req, res) => {
    const leadId = Number.parseInt(String(req.params.leadId ?? ''), 10);
    const suggestionIndex = Number.parseInt(String(req.params.suggestionIndex ?? ''), 10);
    if (!Number.isFinite(leadId) || leadId <= 0 || !Number.isFinite(suggestionIndex) || suggestionIndex < 0) {
        res.status(400).json({ error: 'Parametri non validi.' });
        return;
    }

    try {
        const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : undefined;
        const result = await reviewCommentSuggestion({
            leadId,
            suggestionIndex,
            action: 'approve',
            reviewer: resolveRequestIp(req),
            comment,
        });
        auditSecurityEvent({
            category: 'ai_quality',
            action: 'comment_suggestion_approve',
            actor: resolveRequestIp(req),
            result: 'ALLOW',
            metadata: {
                leadId,
                suggestionIndex,
            },
        });
        res.json(result);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '';
        if (message.startsWith('lead_not_found:') || message.startsWith('comment_suggestion_not_found:')) {
            res.status(404).json({ error: 'Suggestion non trovata.' });
            return;
        }
        handleApiError(res, err, 'api.ai.comment-suggestions.approve');
    }
});

app.post('/api/ai/comment-suggestions/:leadId/:suggestionIndex/reject', async (req, res) => {
    const leadId = Number.parseInt(String(req.params.leadId ?? ''), 10);
    const suggestionIndex = Number.parseInt(String(req.params.suggestionIndex ?? ''), 10);
    if (!Number.isFinite(leadId) || leadId <= 0 || !Number.isFinite(suggestionIndex) || suggestionIndex < 0) {
        res.status(400).json({ error: 'Parametri non validi.' });
        return;
    }

    try {
        const result = await reviewCommentSuggestion({
            leadId,
            suggestionIndex,
            action: 'reject',
            reviewer: resolveRequestIp(req),
        });
        auditSecurityEvent({
            category: 'ai_quality',
            action: 'comment_suggestion_reject',
            actor: resolveRequestIp(req),
            result: 'ALLOW',
            metadata: {
                leadId,
                suggestionIndex,
            },
        });
        res.json(result);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '';
        if (message.startsWith('lead_not_found:') || message.startsWith('comment_suggestion_not_found:')) {
            res.status(404).json({ error: 'Suggestion non trovata.' });
            return;
        }
        handleApiError(res, err, 'api.ai.comment-suggestions.reject');
    }
});

app.get('/api/accounts/health', async (req, res) => {
    try {
        const rawLimit = Number.parseInt(String(req.query.limit ?? '25'), 10);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 25;
        const accountId = typeof req.query.accountId === 'string' ? req.query.accountId.trim() : '';
        const rows = accountId
            ? await listAccountHealthSnapshots(accountId, limit)
            : await listLatestAccountHealthSnapshots(limit);
        res.json({
            accountId: accountId || null,
            count: rows.length,
            rows,
        });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.accounts.health');
    }
});

app.get('/api/security/audit', async (req, res) => {
    try {
        const rawLimit = Number.parseInt(String(req.query.limit ?? '50'), 10);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 50;
        const category = typeof req.query.category === 'string' ? req.query.category.trim() : undefined;
        const rows = await listSecurityAuditEvents(limit, category);
        res.json({ count: rows.length, rows });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.security.audit');
    }
});

app.get('/api/backups', async (req, res) => {
    try {
        const rawLimit = Number.parseInt(String(req.query.limit ?? '20'), 10);
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 20;
        const rows = await listRecentBackupRuns(limit);
        res.json({ count: rows.length, rows });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.backups');
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
        const result = await handlePauseAction(req, 'dashboard');
        res.json({ ...result, message: `Pausa attivata per ${result.minutes} minuti.` });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.controls.pause');
    }
});

app.post('/api/controls/resume', async (req, res) => {
    try {
        await handleResumeAction(req, 'dashboard');
        res.json({ success: true, message: 'Ripresa automazione.' });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.controls.resume');
    }
});

app.post('/api/controls/quarantine', async (req, res) => {
    try {
        const result = await handleQuarantineAction(req, 'dashboard');
        res.json({ success: true, message: `Quarantena ${result.enabled ? 'attivata' : 'disattivata'}.` });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.controls.quarantine');
    }
});

app.post('/api/controls/trigger-run', async (req, res) => {
    try {
        const workflow = typeof req.body?.workflow === 'string' ? req.body.workflow : 'all';
        const validWorkflows = ['invite', 'check', 'message', 'warmup', 'all'];
        if (!validWorkflows.includes(workflow)) {
            res.status(400).json({ success: false, error: `Workflow non valido: ${workflow}` });
            return;
        }
        await setRuntimeFlag('ui_trigger_run', JSON.stringify({
            workflow,
            requestedAt: new Date().toISOString(),
            source: 'dashboard',
        }));
        auditSecurityEvent({
            category: 'runtime_control',
            action: 'trigger_run',
            actor: resolveRequestIp(req),
            result: 'ALLOW',
            metadata: { workflow },
        });
        res.json({ success: true, message: `Run "${workflow}" schedulato. Verrà eseguito al prossimo ciclo.` });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.controls.trigger-run');
    }
});

// ==========================================
// LEAD SEARCH + DETAIL
// ==========================================

// LEADS (routes in api/routes/leads.ts)
app.use('/api/leads', leadsRouter);

// ==========================================
// CAMPAIGNS (Router Esterno)
// ==========================================
// Rate limit export: max 5 requests per hour
const exportLimiter = rateLimit({
    windowMs: 60 * 60_000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Troppe richieste export. Riprova tra un\'ora.' },
});
app.use('/api/v1/export', apiV1AuthMiddleware, exportLimiter, exportRouter);
app.use('/api/export', apiV1AuthMiddleware, exportLimiter, exportRouter);

// ==========================================
// BLACKLIST (routes in api/routes/blacklist.ts)
// ==========================================
app.use('/api/blacklist', blacklistRouter);

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

    // ── WebSocket server (real-time push, same port) ─────────────────────────
    const wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (ws) => {
        const onEvent = (event: LiveEventMessage): void => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(event));
            }
        };
        const unsubscribe = subscribeLiveEvents(onEvent);

        ws.send(JSON.stringify({
            type: 'connected',
            payload: { subscribers: getLiveEventSubscribersCount() },
            timestamp: new Date().toISOString(),
        }));

        const heartbeat = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'heartbeat',
                    payload: {},
                    timestamp: new Date().toISOString(),
                }));
            }
        }, 20_000);

        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(String(raw)) as { action?: string; channels?: string[] };
                if (msg.action === 'subscribe' && Array.isArray(msg.channels)) {
                    // Channel subscription stored for future per-channel filtering
                    (ws as WebSocket & { _channels?: Set<string> })._channels = new Set(msg.channels);
                }
            } catch {
                // ignore malformed messages
            }
        });

        ws.on('close', () => {
            clearInterval(heartbeat);
            unsubscribe();
        });

        ws.on('error', () => {
            clearInterval(heartbeat);
            unsubscribe();
        });
    });

    return server;
}
