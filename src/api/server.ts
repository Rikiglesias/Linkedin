import express from 'express';
import cors from 'cors';
import path from 'path';
import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { getGlobalKPIData, getRiskInputs, getABTestingStats } from '../core/repositories';
import { getDatabase } from '../db';
import { evaluateRisk } from '../risk/riskEngine';
import { getLocalDateString, config } from '../config';
import { pauseAutomation, resumeAutomation, setQuarantine } from '../risk/incidentManager';
import { CampaignRunRecord } from '../types/domain';

const app = express();
app.use(cors());
app.use(express.json());

function secureEquals(a: string, b: string): boolean {
    const aBuffer = Buffer.from(a);
    const bBuffer = Buffer.from(b);
    if (aBuffer.length !== bBuffer.length) {
        return false;
    }
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
    const forwardedFor = req.header('x-forwarded-for');
    if (forwardedFor) {
        const first = forwardedFor.split(',')[0] ?? '';
        const normalized = normalizeIp(first);
        if (normalized) return normalized;
    }
    const fallback = req.ip ?? (req.socket?.remoteAddress ?? '');
    return normalizeIp(fallback);
}

function isTrustedIp(ip: string): boolean {
    const trusted = new Set<string>(['127.0.0.1', ...config.dashboardTrustedIps.map(normalizeIp)]);
    return trusted.has(ip);
}

function isApiKeyAuthValid(req: Request): boolean {
    if (!config.dashboardApiKey) return false;

    const fromHeader = req.header('x-api-key');
    if (fromHeader && secureEquals(fromHeader.trim(), config.dashboardApiKey)) {
        return true;
    }

    const authorization = req.header('authorization') ?? '';
    if (!authorization.toLowerCase().startsWith('bearer ')) {
        return false;
    }

    const token = authorization.slice('bearer '.length).trim();
    return token.length > 0 && secureEquals(token, config.dashboardApiKey);
}

function isBasicAuthValid(req: Request): boolean {
    if (!config.dashboardBasicUser || !config.dashboardBasicPassword) return false;
    const authorization = req.header('authorization') ?? '';
    if (!authorization.toLowerCase().startsWith('basic ')) {
        return false;
    }

    const encoded = authorization.slice('basic '.length).trim();
    if (!encoded) return false;

    let decoded = '';
    try {
        decoded = Buffer.from(encoded, 'base64').toString('utf8');
    } catch {
        return false;
    }

    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex <= 0) {
        return false;
    }

    const user = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);
    return secureEquals(user, config.dashboardBasicUser) && secureEquals(password, config.dashboardBasicPassword);
}

function dashboardAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!config.dashboardAuthEnabled) {
        next();
        return;
    }

    if (req.path === '/api/health') {
        next();
        return;
    }

    const requestIp = resolveRequestIp(req);
    if (isTrustedIp(requestIp)) {
        next();
        return;
    }

    const authConfigured = !!config.dashboardApiKey || (!!config.dashboardBasicUser && !!config.dashboardBasicPassword);
    if (!authConfigured) {
        res.status(503).json({
            error: 'Dashboard auth enabled but no credentials configured. Set DASHBOARD_API_KEY or DASHBOARD_BASIC_USER/PASSWORD.',
        });
        return;
    }

    if (isApiKeyAuthValid(req) || isBasicAuthValid(req)) {
        next();
        return;
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="LinkedIn Bot Dashboard"');
    res.status(401).json({ error: 'Unauthorized' });
}

app.use(dashboardAuthMiddleware);

// Serves the public directory (Dashboard UI)
const publicDir = path.resolve(__dirname, '../../public');
app.use(express.static(publicDir));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// KPIs endpoint
app.get('/api/kpis', async (req, res) => {
    try {
        const kpi = await getGlobalKPIData();
        const localDate = getLocalDateString();
        const riskInputs = await getRiskInputs(localDate, config.hardInviteCap);
        const risk = await evaluateRisk(riskInputs);
        const db = await getDatabase();

        const runtimePause = await db.get<{ value: string }>(`SELECT value FROM runtime_flags WHERE key = 'automation_paused_until'`);
        const isQuarantined = await db.get<{ value: string }>(`SELECT value FROM runtime_flags WHERE key = 'account_quarantine'`);

        res.json({
            funnel: {
                totalLeads: kpi.totalLeads,
                invited: kpi.statusCounts['INVITED'] || 0,
                accepted: kpi.statusCounts['ACCEPTED'] || 0,
                readyMessage: kpi.statusCounts['READY_MESSAGE'] || 0,
                messaged: kpi.statusCounts['MESSAGED'] || 0,
                replied: kpi.statusCounts['REPLIED'] || 0,
                withdrawn: kpi.statusCounts['WITHDRAWN'] || 0
            },
            risk: risk,
            activeCampaigns: kpi.activeCampaigns,
            system: {
                pausedUntil: runtimePause?.value || null,
                quarantined: isQuarantined?.value === 'true'
            }
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('API Error', message);
        res.status(500).json({ error: message });
    }
});

// Recent runs
app.get('/api/runs', async (req, res) => {
    try {
        const db = await getDatabase();
        const runs = await db.query<CampaignRunRecord>(`SELECT * FROM campaign_runs ORDER BY id DESC LIMIT 10`);
        res.json(runs);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('API Error', message);
        res.status(500).json({ error: message });
    }
});

// A/B Testing Stats (legacy endpoint)
app.get('/api/ab-testing/stats', async (req, res) => {
    try {
        const stats = await getABTestingStats();
        res.json(stats);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('API Error /ab-testing/stats', message);
        res.status(500).json({ error: message });
    }
});

// A/B Bandit Leaderboard (Phase 7/8)
app.get('/api/ml/ab-leaderboard', async (req, res) => {
    try {
        const { getVariantLeaderboard } = await import('../ml/abBandit');
        const leaderboard = await getVariantLeaderboard();
        res.json(leaderboard);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
    }
});

// Timing Optimizer — top slot temporali
app.get('/api/ml/timing-slots', async (req, res) => {
    try {
        const { getTopTimeSlots } = await import('../ml/timingOptimizer');
        const n = Math.min(10, parseInt(String(req.query.n || '5'), 10));
        const slots = await getTopTimeSlots(n);
        res.json(slots);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
    }
});

// Controls
app.post('/api/controls/pause', async (req, res) => {
    try {
        const minutes = req.body.minutes || 1440; // Default 24h
        await pauseAutomation('MANUAL_UI_PAUSE', { source: 'dashboard' }, minutes);
        res.json({ success: true, message: `Paused for ${minutes} minutes` });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
    }
});

app.post('/api/controls/resume', async (req, res) => {
    try {
        await resumeAutomation();
        res.json({ success: true, message: 'Resumed' });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
    }
});

app.post('/api/controls/quarantine', async (req, res) => {
    try {
        const enabled = req.body.enabled === true;
        await setQuarantine(enabled);
        res.json({ success: true, message: `Quarantine set to ${enabled}` });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
    }
});

export function startServer(port: number = 3000) {
    return app.listen(port, () => {
        console.log(`\n🚀 Dashboard & Web API is running on http://localhost:${port}\n`);
    });
}
