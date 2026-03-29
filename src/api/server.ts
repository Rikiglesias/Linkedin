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
import { getABTestingStats, recordSecurityAuditEvent } from '../core/repositories';
import { getDatabase } from '../db';
import campaignsRouter from './routes/campaigns';
import exportRouter from './routes/export';
import blacklistRouter from './routes/blacklist';
import leadsRouter from './routes/leads';
import controlsRouter from './routes/controls';
import { statsRouter } from './routes/stats';
import { aiRouter } from './routes/ai';
import { securityRouter } from './routes/security';
import { healthRouter } from './routes/health';
import { linkedinChangeAlertRouter } from './routes/linkedinChangeAlert';
import { handleApiError } from './utils';
import v1AutomationRouter from './routes/v1Automation';
import metricsRouter from './routes/metrics';
import { isTotpEnabled, validateTotpCode } from '../security/totp';
import { config } from '../config';
import { subscribeLiveEvents, getLiveEventSubscribersCount, type LiveEventMessage } from '../telemetry/liveEvents';
import { resolveCorrelationId, runWithCorrelationId } from '../telemetry/correlation';
import { WebSocketServer, WebSocket } from 'ws';

export const app = express();
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
function normalizeIpForRateLimit(ip: string): string {
    if (!ip) return 'unknown';
    // IPv6-mapped IPv4 (::ffff:127.0.0.1 → 127.0.0.1)
    if (ip.startsWith('::ffff:')) return ip.slice(7);
    // Collapse IPv6 to /64 prefix to treat the same subnet equally
    if (ip.includes(':')) {
        const parts = ip.split(':').slice(0, 4);
        return parts.join(':');
    }
    return ip;
}

function rateLimitKeyGenerator(req: Request): string {
    const rawIp = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const ip = normalizeIpForRateLimit(rawIp);
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
    validate: { keyGeneratorIpFallback: false },
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
    validate: { keyGeneratorIpFallback: false },
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
    const isSecure = req ? req.secure || req.headers['x-forwarded-proto'] === 'https' : Boolean(config.databaseUrl);
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

const MAX_ACTIVE_DASHBOARD_SESSIONS = 5;

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

    // Enforce max concurrent sessions: revoke oldest if limit reached
    const activeSessions = await db.query<{ token_hash: string; created_at: string }>(
        `SELECT token_hash, created_at FROM dashboard_sessions
         WHERE expires_at > ? AND revoked_at IS NULL
         ORDER BY created_at ASC`,
        [nowIso],
    );
    if (activeSessions.length >= MAX_ACTIVE_DASHBOARD_SESSIONS) {
        const toRevoke = activeSessions.slice(0, activeSessions.length - MAX_ACTIVE_DASHBOARD_SESSIONS + 1);
        for (const session of toRevoke) {
            await db.run(`UPDATE dashboard_sessions SET revoked_at = ? WHERE token_hash = ?`, [
                nowIso,
                session.token_hash,
            ]);
        }
    }

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

// ApiV1Envelope importato da ./utils

function writeSseEvent(res: Response, eventType: string, data: unknown): void {
    res.write(`event: ${eventType}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ── Helper condivisi controls (estratti in api/helpers/controlActions.ts) ──

app.use('/api', dashboardAuthMiddleware);
app.use('/api', statsRouter);
app.use('/api', aiRouter);
app.use('/api', securityRouter);

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
    if (isApiKeyAuthValid(req) || isBasicAuthValid(req) || (await hasValidDashboardSession(req))) {
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

// ── Static (Dashboard UI) ────────────────────────────────────────────────────
const publicDir = path.resolve(__dirname, '../../public');
app.use(express.static(publicDir));

// ── Health — routes/health.ts ────────────────────────────────────────────────
app.use('/api/health', healthRouter);

// ── LinkedIn Change Alert — routes/linkedinChangeAlert.ts ────────────────────
// Webhook per ricevere alert dal workflow n8n di monitoring cambiamenti LinkedIn
app.use('/api/linkedin-change-alert', linkedinChangeAlertRouter);

// ── Prometheus Metrics — routes/metrics.ts ──────────────────────────────────
app.use('/metrics', metricsRouter);

// ── API v1 (automazioni esterne) — routes/v1Automation.ts ───────────────────
app.use('/api/v1', v1AutomationRouter);

// ── Session bootstrap (cookie-based auth for browser SSE/fetch) ─────────────
app.post('/api/auth/session', async (req, res) => {
    try {
        const requestIp = resolveRequestIp(req);

        // Verifica credenziali PRIMA di creare la sessione
        if (config.dashboardAuthEnabled) {
            if (!isApiKeyAuthValid(req) && !isBasicAuthValid(req)) {
                auditSecurityEvent({
                    category: 'dashboard_auth',
                    action: 'session_auth_failed',
                    actor: requestIp,
                    result: 'DENY',
                    metadata: { reason: 'invalid_credentials' },
                });
                res.status(401).json({ error: 'Unauthorized', totpRequired: false });
                return;
            }

            // TOTP 2FA: se abilitato, richiede codice valido nel body
            if (isTotpEnabled()) {
                const totpCode = typeof req.body?.totp_code === 'string' ? req.body.totp_code : '';
                if (!totpCode) {
                    res.status(403).json({ error: 'TOTP code required', totpRequired: true });
                    return;
                }
                if (!validateTotpCode(totpCode)) {
                    auditSecurityEvent({
                        category: 'dashboard_auth',
                        action: 'session_totp_failed',
                        actor: requestIp,
                        result: 'DENY',
                        metadata: { reason: 'invalid_totp_code' },
                    });
                    res.status(403).json({ error: 'Invalid TOTP code', totpRequired: true });
                    return;
                }
            }
        }

        await createDashboardSessionCookie(req, res);
        await cleanupExpiredDashboardSessions();
        auditSecurityEvent({
            category: 'dashboard_auth',
            action: 'session_created',
            actor: requestIp,
            result: 'ALLOW',
            metadata: {
                userAgent: req.header('user-agent') ?? '',
                totpVerified: isTotpEnabled(),
            },
        });
        res.json({
            success: true,
            ttlSeconds: Math.floor(DASHBOARD_SESSION_TTL_MS / 1000),
            totpVerified: isTotpEnabled(),
        });
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

// ── KPIs, Runs, Trend, Observability, Risk, Incidents → routes/stats.ts ──

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

// Incidents → routes/stats.ts

// Trend, Observability, Risk → routes/stats.ts

// AI routes (quality, comment-suggestions) → routes/ai.ts
// Security routes (audit, backups, accounts/health, review-queue) → routes/security.ts

// ── Controls ──────────────────────────────────────────────────────────────────
// CONTROLS (routes in api/routes/controls.ts)
app.use('/api/controls', controlsRouter);

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
    message: { error: "Troppe richieste export. Riprova tra un'ora." },
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

    wss.on('connection', (ws, req) => {
        // CC-10: Auth token-based per WebSocket
        if (config.dashboardAuthEnabled && config.dashboardApiKey) {
            const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
            const token = url.searchParams.get('token') ?? '';
            if (!secureEquals(token, config.dashboardApiKey)) {
                ws.close(4401, 'Unauthorized');
                return;
            }
        }
        const onEvent = (event: LiveEventMessage): void => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(event));
            }
        };
        const unsubscribe = subscribeLiveEvents(onEvent);

        ws.send(
            JSON.stringify({
                type: 'connected',
                payload: { subscribers: getLiveEventSubscribersCount() },
                timestamp: new Date().toISOString(),
            }),
        );

        const heartbeat = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                    JSON.stringify({
                        type: 'heartbeat',
                        payload: {},
                        timestamp: new Date().toISOString(),
                    }),
                );
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
