import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    setOverrideAccountId: vi.fn(),
    getOverrideAccountId: vi.fn(),
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
    getQuarantineStatus: vi.fn(),
    getRuntimeFlag: vi.fn(),
    pushOutboxEvent: vi.fn(),
    setRuntimeFlag: vi.fn(),
    deleteQueuedJobsByIds: vi.fn(),
    evaluateAiGuardian: vi.fn(),
    runRandomLinkedinActivity: vi.fn(),
    sendTelegramAlert: vi.fn(),
    evaluateWorkflowEntryGuards: vi.fn(),
    closeBrowser: vi.fn(),
    disableWindowClickThrough: vi.fn(),
    getSessionMaturity: vi.fn(),
    getAutomationPauseState: vi.fn(),
}));

vi.mock('../accountManager', () => ({
    setOverrideAccountId: mocks.setOverrideAccountId,
    getOverrideAccountId: mocks.getOverrideAccountId,
    getRuntimeAccountProfiles: mocks.getRuntimeAccountProfiles,
}));

vi.mock('../browser/sessionCookieMonitor', () => ({
    getSessionMaturity: mocks.getSessionMaturity,
}));

vi.mock('../browser', () => ({
    closeBrowser: mocks.closeBrowser,
}));

vi.mock('../browser/windowInputBlock', () => ({
    disableWindowClickThrough: mocks.disableWindowClickThrough,
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
    getQuarantineStatus: mocks.getQuarantineStatus,
    getRuntimeFlag: mocks.getRuntimeFlag,
    pushOutboxEvent: mocks.pushOutboxEvent,
    setRuntimeFlag: mocks.setRuntimeFlag,
    deleteQueuedJobsByIds: mocks.deleteQueuedJobsByIds,
    getAutomationPauseState: mocks.getAutomationPauseState,
}));

vi.mock('../ai/guardian', () => ({
    evaluateAiGuardian: mocks.evaluateAiGuardian,
    MIN_CRITICAL_PAUSE_MINUTES: 30,
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
        mocks.deleteQueuedJobsByIds.mockResolvedValue(0);
        mocks.getComplianceHealthMetrics.mockResolvedValue(buildComplianceMetrics());
        mocks.getDailyStat.mockResolvedValue(0);
        mocks.getRecentDailyStats.mockResolvedValue([]);
        mocks.getRuntimeFlag.mockResolvedValue(null);
        mocks.getQuarantineStatus.mockResolvedValue({ global: false, accounts: [], any: false });
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
        mocks.closeBrowser.mockResolvedValue(undefined);
        mocks.disableWindowClickThrough.mockReturnValue(true);
        mocks.getSessionMaturity.mockReturnValue({ forceRandomActivityFirst: false });
        mocks.getAutomationPauseState.mockResolvedValue({
            paused: false,
            reason: null,
            pausedUntil: null,
            remainingSeconds: 0,
        });
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

    test('T8: ripristina override account anche su early return (no leak cross-account)', async () => {
        mocks.getOverrideAccountId.mockReturnValue('prev-acc');
        mocks.evaluateWorkflowEntryGuards.mockResolvedValue({
            allowed: false,
            blocked: { reason: 'ENTRY_GUARD', message: 'stop', details: {} },
        });

        const result = await runWorkflow({ workflow: 'invite', dryRun: false, accountId: 'acc-override' });

        expect(result.status).toBe('blocked');
        // 1ª chiamata: set con l'accountId della run; 2ª (nel finally): ripristino del precedente
        expect(mocks.setOverrideAccountId).toHaveBeenNthCalledWith(1, 'acc-override');
        expect(mocks.setOverrideAccountId).toHaveBeenNthCalledWith(2, 'prev-acc');
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

    test('A1 fail-closed: severity critical con pauseMinutes 0 → pausa comunque al floor MIN (30)', async () => {
        mocks.evaluateAiGuardian.mockResolvedValue({
            executed: true,
            reason: 'guardian-critical-zero-pause',
            decision: {
                severity: 'critical',
                pauseMinutes: 0,
                summary: 'Critico senza pausa esplicita',
                recommendations: ['attendere'],
            },
        });

        const result = await runWorkflow({ workflow: 'invite', dryRun: false });

        expect(result).toEqual({
            status: 'blocked',
            blocked: {
                reason: 'AI_GUARDIAN_PREEMPTIVE',
                message: 'Critico senza pausa esplicita',
                details: {
                    workflow: 'invite',
                    localDate: '2026-04-01',
                    pauseMinutes: 30,
                    reason: 'guardian-critical-zero-pause',
                },
            },
            localDate: '2026-04-01',
        });
        expect(mocks.pauseAutomation).toHaveBeenCalledWith(
            'AI_GUARDIAN_PREEMPTIVE',
            expect.objectContaining({
                workflow: 'invite',
                localDate: '2026-04-01',
                reason: 'guardian-critical-zero-pause',
            }),
            30,
        );
    });

    test('A4: blocco DOPO scheduleJobs → i job accodati di questo run vengono cancellati', async () => {
        mocks.scheduleJobs.mockResolvedValue({ ...buildSchedule(), enqueuedJobIds: [101, 102] });
        mocks.evaluateAiGuardian.mockResolvedValue({
            executed: true,
            reason: 'guardian-critical',
            decision: { severity: 'critical', pauseMinutes: 60, summary: 'stop', recommendations: [] },
        });

        const result = await runWorkflow({ workflow: 'invite', dryRun: false });

        expect(result.status).toBe('blocked');
        // i job accodati prima del blocco non devono restare eseguibili → cancellati per ID
        expect(mocks.deleteQueuedJobsByIds).toHaveBeenCalledWith([101, 102]);
    });

    test('AB11: un blocco tra il canary e runQueuedJobs chiude la sessione handoff (no browser orfano)', async () => {
        // Il guard ritorna una sessione handoff (single-account); poi il compliance guard blocca.
        // La sessione NON arriva a runQueuedJobs → deve essere chiusa dal finally di runWorkflow.
        const handoffSession = { browser: {} };
        mocks.evaluateWorkflowEntryGuards.mockResolvedValue({
            allowed: true,
            blocked: null,
            session: handoffSession,
            sessionAccountId: 'acc-1',
        });
        mocks.evaluateComplianceHealthScore.mockReturnValue({ score: 40 }); // → COMPLIANCE_HEALTH_BLOCKED

        const result = await runWorkflow({ workflow: 'invite', dryRun: false });

        expect(result.status).toBe('blocked');
        expect(mocks.runQueuedJobs).not.toHaveBeenCalled();
        expect(mocks.closeBrowser).toHaveBeenCalledWith(handoffSession);
        expect(mocks.disableWindowClickThrough).toHaveBeenCalledWith(handoffSession.browser);
    });

    test('AB11: path felice consegna la sessione handoff a runQueuedJobs e NON la chiude nell orchestrator', async () => {
        const handoffSession = { browser: {} };
        mocks.evaluateWorkflowEntryGuards.mockResolvedValue({
            allowed: true,
            blocked: null,
            session: handoffSession,
            sessionAccountId: 'acc-1',
        });

        const result = await runWorkflow({ workflow: 'invite', dryRun: false });

        expect(result.status).toBe('completed');
        // Ownership trasferita a runQueuedJobs via initialSession…
        expect(mocks.runQueuedJobs).toHaveBeenCalledWith(
            expect.objectContaining({ initialSession: { accountId: 'acc-1', session: handoffSession } }),
        );
        // …quindi l'orchestrator NON la chiude (la chiude il jobRunner nel suo finally).
        expect(mocks.closeBrowser).not.toHaveBeenCalled();
    });

    test('AB11: senza handoff (guard senza session) runQueuedJobs riceve initialSession undefined', async () => {
        // Anti-regressione: il default (nessun handoff) non passa initialSession e non chiude nulla.
        const result = await runWorkflow({ workflow: 'invite', dryRun: false });

        expect(result.status).toBe('completed');
        expect(mocks.runQueuedJobs).toHaveBeenCalledWith(
            expect.objectContaining({ initialSession: undefined }),
        );
        expect(mocks.closeBrowser).not.toHaveBeenCalled();
    });
});
