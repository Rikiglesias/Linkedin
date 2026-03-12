/**
 * api/routes/v1Automation.ts
 * ─────────────────────────────────────────────────────────────────
 * Endpoint API v1 per automazione esterna: meta, snapshot, incidents, controls.
 * Estratto da server.ts per ridurre la dimensione del file principale.
 */

import { Router } from 'express';
import {
    getGlobalKPIData,
    getOperationalObservabilitySnapshot,
    getRiskInputs,
    getRuntimeFlag,
    listOpenIncidents,
} from '../../core/repositories';
import { handlePauseAction, handleResumeAction, handleQuarantineAction } from '../helpers/controlActions';
import { sendApiV1, handleApiError } from '../utils';
import { evaluateRisk } from '../../risk/riskEngine';
import { getLocalDateString, config } from '../../config';

const router = Router();

router.get('/meta', (_req, res) => {
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

router.get('/automation/snapshot', async (_req, res) => {
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

router.get('/automation/incidents', async (req, res) => {
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

router.post('/automation/controls/pause', async (req, res) => {
    try {
        const result = await handlePauseAction(req, 'api_v1', 1440);
        sendApiV1(res, { ...result, action: 'pause' });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.v1.automation.controls.pause');
    }
});

router.post('/automation/controls/resume', async (req, res) => {
    try {
        await handleResumeAction(req, 'api_v1');
        sendApiV1(res, { success: true, action: 'resume' });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.v1.automation.controls.resume');
    }
});

router.post('/automation/controls/quarantine', async (req, res) => {
    try {
        const result = await handleQuarantineAction(req, 'api_v1');
        sendApiV1(res, { success: true, action: 'quarantine', enabled: result.enabled });
    } catch (err: unknown) {
        handleApiError(res, err, 'api.v1.automation.controls.quarantine');
    }
});

export default router;
