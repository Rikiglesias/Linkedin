import { Router } from 'express';
import { config, getLocalDateString } from '../../config';
import { getDatabase } from '../../db';
import {
    getDailyStat,
    getGlobalKPIData,
    getOperationalObservabilitySnapshot,
    getRecentDailyStats,
    getRiskInputs,
    getRuntimeFlag,
    listOpenIncidents,
    resolveIncident,
} from '../../core/repositories';
import { evaluateRisk, explainRisk, evaluatePredictiveRiskAlerts } from '../../risk/riskEngine';
import { getCircuitBreakerSnapshot } from '../../core/integrationPolicy';
import { publishLiveEvent } from '../../telemetry/liveEvents';
import { handleApiError } from '../utils';
import { resolveRequestIp } from '../helpers/requestIp';
import { auditSecurityEvent } from '../helpers/audit';

interface CampaignRunRecord {
    id: number;
    start_time: string;
    end_time: string | null;
    status: string;
    profiles_discovered: number;
    invites_sent: number;
    messages_sent: number;
    errors_count: number;
    created_at: string;
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

export const statsRouter = Router();

statsRouter.get('/kpis', async (_req, res) => {
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

statsRouter.get('/runs', async (_req, res) => {
    try {
        const db = await getDatabase();
        const runs = await db.query<CampaignRunRecord>(
            `SELECT id, start_time, end_time, status, profiles_discovered, invites_sent, messages_sent, errors_count, created_at
             FROM campaign_runs ORDER BY id DESC LIMIT 10`,
        );
        res.json(runs);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.runs');
    }
});

statsRouter.get('/stats/trend', async (req, res) => {
    try {
        const rawDays = Number.parseInt(String(req.query.days ?? '7'), 10);
        const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(30, rawDays)) : 7;
        const today = new Date();
        const localDate = getLocalDateString();
        const currentRiskInputs = await getRiskInputs(localDate, config.hardInviteCap);
        const pendingRatioReference = currentRiskInputs.pendingRatio;
        const trend: Array<{
            date: string; invitesSent: number; messagesSent: number;
            acceptances: number; runErrors: number; challenges: number; estimatedRiskScore: number;
        }> = [];
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
            trend.push({ date: dateStr, invitesSent: invites, messagesSent: messages, acceptances, runErrors, challenges, estimatedRiskScore: estimatedRisk.score });
        }
        res.json({ days, rows: trend });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.stats.trend');
    }
});

statsRouter.get('/observability', async (_req, res) => {
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

statsRouter.get('/observability/slo', async (_req, res) => {
    try {
        const localDate = getLocalDateString();
        const snapshot = await getOperationalObservabilitySnapshot(localDate);
        res.json(snapshot.slo);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.observability.slo');
    }
});

statsRouter.get('/risk/explain', async (_req, res) => {
    try {
        const localDate = getLocalDateString();
        const riskInputs = await getRiskInputs(localDate, config.hardInviteCap);
        const explanation = explainRisk(riskInputs);
        res.json(explanation);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.risk.explain');
    }
});

statsRouter.get('/risk/predictive', async (_req, res) => {
    try {
        const localDate = getLocalDateString();
        const lookbackDays = config.riskPredictiveLookbackDays;
        const rows = await getRecentDailyStats(lookbackDays + 1);
        const todayRow = rows.find((row) => row.date === localDate) ?? null;
        const historySamples = rows.filter((row) => row.date !== localDate).slice(0, lookbackDays).map(mapDailyToPredictiveSample);
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

statsRouter.get('/incidents', async (_req, res) => {
    try {
        const incidents = await listOpenIncidents();
        res.json(incidents);
    } catch (err: unknown) {
        handleApiError(res, err, 'api.incidents.list');
    }
});

statsRouter.post('/incidents/:id/resolve', async (req, res) => {
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
