import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    setOverrideAccountId: vi.fn(),
    getRuntimeAccountProfiles: vi.fn(),
    getWeekStartDate: vi.fn(),
    pauseAutomation: vi.fn(),
    quarantineAccount: vi.fn(),
    evaluateComplianceHealthScore: vi.fn(),
    evaluateCooldownDecision: vi.fn(),
    evaluatePredictiveRiskAlerts: vi.fn(),
    estimateBanProbability: vi.fn(),
    logInfo: vi.fn(),
    logWarn: vi.fn(),
    runEventSyncOnce: vi.fn(),
    scheduleJobs: vi.fn(),
    runSiteCheck: vi.fn(),
    runQueuedJobs: vi.fn(),
    countWeeklyInvites: vi.fn(),
    getComplianceHealthMetrics: vi.fn(),
    getDailyStat: vi.fn(),
    getRecentDailyStats: vi.fn(),
    getRuntimeFlag: vi.fn(),
    pushOutboxEvent: vi.fn(),
    setRuntimeFlag: vi.fn(),
    evaluateAiGuardian: vi.fn(),
    runRandomLinkedinActivity: vi.fn(),
    sendTelegramAlert: vi.fn(),
    evaluateWorkflowEntryGuards: vi.fn(),
}));

vi.mock('../accountManager', () => ({
    setOverrideAccountId: mocks.setOverrideAccountId,
    getRuntimeAccountProfiles: mocks.getRuntimeAccountProfiles,
}));

vi.mock('../browser/sessionCookieMonitor', () => ({
    getSessionMaturity: vi.fn(),
}));

vi.mock('../config', () => ({
    config: {
        complianceHealthScoreEnabled: true,
        complianceHealthLookbackDays: 7,
        hardInviteCap: 20,
        softInviteCap: 10,
        softMsgCap: 10,
        weeklyInviteLimit: 100,
        complianceHealthPendingWarnThreshold: 0.5,
        complianceHealthPauseThreshold: 70,
        compliancePendingRatioAlertThreshold: 0.9,
        compliancePendingRatioAlertMinInvited: 999,
        complianceHealthMinInviteSample: 1,
        complianceHealthMinMessageSample: 1,
        riskPredictiveAlertsEnabled: false,
        autoPauseMinutesOnFailureBurst: 60,
    },
    getWeekStartDate: mocks.getWeekStartDate,
}));

vi.mock('../risk/incidentManager', () => ({
    pauseAutomation: mocks.pauseAutomation,
    quarantineAccount: mocks.quarantineAccount,
}));

vi.mock('../risk/riskEngine', () => ({
    evaluateComplianceHealthScore: mocks.evaluateComplianceHealthScore,
    evaluateCooldownDecision: mocks.evaluateCooldownDecision,
    evaluatePredictiveRiskAlerts: mocks.evaluatePredictiveRiskAlerts,
    estimateBanProbability: mocks.estimateBanProbability,
}));

vi.mock('../telemetry/logger', () => ({
    logInfo: mocks.logInfo,
    logWarn: mocks.logWarn,
}));

vi.mock('../sync/eventSync', () => ({
    runEventSyncOnce: mocks.runEventSyncOnce,
}));

vi.mock('../core/scheduler', () => ({
    scheduleJobs: mocks.scheduleJobs,
    workflowToJobTypes: vi.fn(),
}));

vi.mock('../core/audit', () => ({
    runSiteCheck: mocks.runSiteCheck,
}));

vi.mock('../core/jobRunner', () => ({
    runQueuedJobs: mocks.runQueuedJobs,
}));

vi.mock('../core/repositories', () => ({
    countWeeklyInvites: mocks.countWeeklyInvites,
    getComplianceHealthMetrics: mocks.getComplianceHealthMetrics,
    getDailyStat: mocks.getDailyStat,
    getRecentDailyStats: mocks.getRecentDailyStats,
    getRuntimeFlag: mocks.getRuntimeFlag,
    pushOutboxEvent: mocks.pushOutboxEvent,
    setRuntimeFlag: mocks.setRuntimeFlag,
}));

vi.mock('../ai/guardian', () => ({
    evaluateAiGuardian: mocks.evaluateAiGuardian,
}));

vi.mock('../workers/randomActivityWorker', () => ({
    runRandomLinkedinActivity: mocks.runRandomLinkedinActivity,
}));

vi.mock('../telemetry/alerts', () => ({
    sendTelegramAlert: mocks.sendTelegramAlert,
}));

vi.mock('../core/workflowEntryGuards', () => ({
    evaluateWorkflowEntryGuards: mocks.evaluateWorkflowEntryGuards,
}));

import { runWorkflow } from '../core/orchestrator';

function buildSchedule() {
    return {
        localDate: '2026-04-01',
        riskSnapshot: {
            score: 42,
            pendingRatio: 0.1,
            errorRate: 0,
            selectorFailureRate: 0,
            challengeCount: 0,
            inviteVelocityRatio: 0.2,
            action: 'GO',
        },
        inviteBudget: 8,
        messageBudget: 6,
        weeklyInvitesSent: 12,
        weeklyInviteLimitEffective: 100,
        weeklyInvitesRemaining: 88,
        queuedInviteJobs: 1,
        queuedCheckJobs: 0,
        queuedMessageJobs: 0,
        listBreakdown: [],
        dryRun: false,
    };
}

function buildComplianceMetrics() {
    return {
        acceptanceRatePct: 25,
        engagementRatePct: 20,
        pendingRatio: 0.1,
        invitesSentLookback: 5,
        messagedLookback: 5,
    };
}

describe('orchestrator blocked outcomes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getWeekStartDate.mockReturnValue('2026-03-31');
        mocks.getRuntimeAccountProfiles.mockReturnValue([{ id: 'acc-1' }]);
        mocks.evaluateWorkflowEntryGuards.mockResolvedValue({ allowed: true, blocked: null });
        mocks.scheduleJobs.mockResolvedValue(buildSchedule());
        mocks.countWeeklyInvites.mockResolvedValue(0);
        mocks.getComplianceHealthMetrics.mockResolvedValue(buildComplianceMetrics());
        mocks.getDailyStat.mockResolvedValue(0);
        mocks.getRecentDailyStats.mockResolvedValue([]);
        mocks.getRuntimeFlag.mockResolvedValue(null);
        mocks.pushOutboxEvent.mockResolvedValue(undefined);
        mocks.setRuntimeFlag.mockResolvedValue(undefined);
        mocks.evaluateComplianceHealthScore.mockReturnValue({ score: 90 });
        mocks.evaluateCooldownDecision.mockReturnValue({ activate: false });
        mocks.evaluatePredictiveRiskAlerts.mockReturnValue([]);
        mocks.estimateBanProbability.mockReturnValue({
            score: 10,
            level: 'LOW',
            factors: {},
            recommendation: 'ok',
        });
        mocks.evaluateAiGuardian.mockResolvedValue({ decision: null, executed: false, reason: 'none' });
        mocks.runQueuedJobs.mockResolvedValue(undefined);
        mocks.runSiteCheck.mockResolvedValue(undefined);
        mocks.runEventSyncOnce.mockResolvedValue(undefined);
        mocks.sendTelegramAlert.mockResolvedValue(undefined);
    });

    test('ritorna COMPLIANCE_HEALTH_BLOCKED quando il compliance guard ferma il workflow', async () => {
        mocks.evaluateComplianceHealthScore.mockReturnValue({ score: 40 });

        const result = await runWorkflow({ workflow: 'invite', dryRun: false });

        expect(result).toEqual({
            status: 'blocked',
            blocked: {
                reason: 'COMPLIANCE_HEALTH_BLOCKED',
                message: 'Workflow bloccato dal compliance health guard',
                details: {
                    workflow: 'invite',
                    localDate: '2026-04-01',
                },
            },
            localDate: '2026-04-01',
        });
        expect(mocks.pauseAutomation).toHaveBeenCalledWith(
            'COMPLIANCE_HEALTH_LOW',
            expect.objectContaining({
                workflow: 'invite',
                localDate: '2026-04-01',
                threshold: 70,
            }),
            60,
        );
    });

    test('ritorna RISK_COOLDOWN quando la risk snapshot richiede cooldown', async () => {
        mocks.evaluateCooldownDecision.mockReturnValue({
            activate: true,
            tier: 'medium',
            reason: 'Cooldown precauzionale',
            minutes: 45,
        });

        const result = await runWorkflow({ workflow: 'invite', dryRun: false });

        expect(result).toEqual({
            status: 'blocked',
            blocked: {
                reason: 'RISK_COOLDOWN',
                message: 'Cooldown precauzionale',
                details: {
                    workflow: 'invite',
                    localDate: '2026-04-01',
                    tier: 'medium',
                    pauseMinutes: 45,
                },
            },
            localDate: '2026-04-01',
        });
        expect(mocks.pauseAutomation).toHaveBeenCalledWith(
            'RISK_COOLDOWN',
            expect.objectContaining({
                workflow: 'invite',
                localDate: '2026-04-01',
                tier: 'medium',
            }),
            45,
        );
    });

    test('ritorna RISK_STOP_THRESHOLD quando la risk snapshot è STOP', async () => {
        mocks.scheduleJobs.mockResolvedValue({
            ...buildSchedule(),
            riskSnapshot: {
                ...buildSchedule().riskSnapshot,
                score: 97,
                action: 'STOP',
            },
        });

        const result = await runWorkflow({ workflow: 'invite', dryRun: false });

        expect(result).toEqual({
            status: 'blocked',
            blocked: {
                reason: 'RISK_STOP_THRESHOLD',
                message: 'Workflow bloccato da risk snapshot STOP',
                details: {
                    workflow: 'invite',
                    localDate: '2026-04-01',
                    score: 97,
                },
            },
            localDate: '2026-04-01',
        });
        expect(mocks.quarantineAccount).toHaveBeenCalledWith('RISK_STOP_THRESHOLD', {
            workflow: 'invite',
            riskSnapshot: expect.objectContaining({
                action: 'STOP',
                score: 97,
            }),
        });
    });

    test('ritorna AI_GUARDIAN_PREEMPTIVE quando il guardian chiede pausa critica', async () => {
        mocks.evaluateAiGuardian.mockResolvedValue({
            executed: true,
            reason: 'predictive-anomaly',
            decision: {
                severity: 'critical',
                pauseMinutes: 30,
                summary: 'Fermare il workflow per anomalia',
                recommendations: ['attendere'],
            },
        });

        const result = await runWorkflow({ workflow: 'invite', dryRun: false });

        expect(result).toEqual({
            status: 'blocked',
            blocked: {
                reason: 'AI_GUARDIAN_PREEMPTIVE',
                message: 'Fermare il workflow per anomalia',
                details: {
                    workflow: 'invite',
                    localDate: '2026-04-01',
                    pauseMinutes: 30,
                    reason: 'predictive-anomaly',
                },
            },
            localDate: '2026-04-01',
        });
        expect(mocks.pauseAutomation).toHaveBeenCalledWith(
            'AI_GUARDIAN_PREEMPTIVE',
            expect.objectContaining({
                workflow: 'invite',
                localDate: '2026-04-01',
                reason: 'predictive-anomaly',
            }),
            30,
        );
    });
});
