import { checkLogin, closeBrowser, launchBrowser, runSelectorCanary } from '../browser';
import { getRuntimeAccountProfiles } from '../accountManager';
import { config, getLocalDateString, isWorkingHour } from '../config';
import { pauseAutomation, quarantineAccount } from '../risk/incidentManager';
import { evaluateCooldownDecision, evaluatePredictiveRiskAlerts, PredictiveRiskMetricSample } from '../risk/riskEngine';
import { logInfo, logWarn } from '../telemetry/logger';
import { runEventSyncOnce } from '../sync/eventSync';
import { workflowToJobTypes, scheduleJobs, WorkflowSelection } from './scheduler';
import { runSiteCheck } from './audit';

import { runQueuedJobs } from './jobRunner';
import { getAutomationPauseState, getDailyStat, getRecentDailyStats, getRuntimeFlag, pushOutboxEvent } from './repositories';
import { evaluateAiGuardian } from '../ai/guardian';
import { runRandomLinkedinActivity } from '../workers/randomActivityWorker';
import { sendTelegramAlert } from '../telemetry/alerts';

export interface RunWorkflowOptions {
    workflow: WorkflowSelection;
    dryRun: boolean;
}

function mapDailySnapshotToPredictiveSample(snapshot: {
    invitesSent: number;
    messagesSent: number;
    runErrors: number;
    selectorFailures: number;
    challengesCount: number;
}): PredictiveRiskMetricSample {
    const operations = Math.max(1, snapshot.invitesSent + snapshot.messagesSent);
    return {
        errorRate: snapshot.runErrors / operations,
        selectorFailureRate: snapshot.selectorFailures / operations,
        challengeCount: snapshot.challengesCount,
        inviteVelocityRatio: snapshot.invitesSent / Math.max(1, config.hardInviteCap),
    };
}

async function runCanaryIfNeeded(workflow: WorkflowSelection): Promise<boolean> {
    const touchesUi = workflow === 'all' || workflow === 'invite' || workflow === 'message' || workflow === 'check';
    if (!config.selectorCanaryEnabled || !touchesUi) {
        return true;
    }

    const accounts = getRuntimeAccountProfiles();
    for (const account of accounts) {
        const session = await launchBrowser({
            sessionDir: account.sessionDir,
            proxy: account.proxy,
        });
        try {
            const loggedIn = await checkLogin(session.page);
            if (!loggedIn) {
                return false;
            }
            const canaryOk = await runSelectorCanary(session.page);
            if (!canaryOk) {
                return false;
            }
        } finally {
            await closeBrowser(session);
        }
    }

    return true;
}

export async function runWorkflow(options: RunWorkflowOptions): Promise<void> {
    if (!options.dryRun) {
        const quarantine = (await getRuntimeFlag('account_quarantine')) === 'true';
        if (quarantine) {
            await logWarn('workflow.skipped.quarantine', { workflow: options.workflow });
            return;
        }

        const pauseState = await getAutomationPauseState();
        if (pauseState.paused) {
            await logWarn('workflow.skipped.paused', {
                workflow: options.workflow,
                reason: pauseState.reason,
                pausedUntil: pauseState.pausedUntil,
                remainingSeconds: pauseState.remainingSeconds,
            });
            return;
        }
    }

    if (!options.dryRun && !isWorkingHour()) {
        await logInfo('workflow.skipped.out_of_hours', {
            startHour: config.workingHoursStart,
            endHour: config.workingHoursEnd,
        });
        return;
    }

    if (!options.dryRun) {
        const localDate = getLocalDateString();
        const selectorFailures = await getDailyStat(localDate, 'selector_failures');
        if (selectorFailures >= config.maxSelectorFailuresPerDay) {
            await quarantineAccount('SELECTOR_FAILURE_BURST', {
                workflow: options.workflow,
                localDate,
                selectorFailures,
                threshold: config.maxSelectorFailuresPerDay,
            });
            return;
        }

        const runErrors = await getDailyStat(localDate, 'run_errors');
        if (runErrors >= config.maxRunErrorsPerDay) {
            await pauseAutomation(
                'RUN_ERRORS_BURST',
                {
                    workflow: options.workflow,
                    localDate,
                    runErrors,
                    threshold: config.maxRunErrorsPerDay,
                },
                config.autoPauseMinutesOnFailureBurst
            );
            await logWarn('workflow.skipped.run_error_burst', {
                workflow: options.workflow,
                localDate,
                runErrors,
                threshold: config.maxRunErrorsPerDay,
                pauseMinutes: config.autoPauseMinutesOnFailureBurst,
            });
            return;
        }

        const canaryOk = await runCanaryIfNeeded(options.workflow);
        if (!canaryOk) {
            await quarantineAccount('SELECTOR_CANARY_FAILED', { workflow: options.workflow });
            return;
        }
    }

    const schedule = await scheduleJobs(options.workflow, { dryRun: options.dryRun });

    if (!options.dryRun && config.riskPredictiveAlertsEnabled) {
        const recentStats = await getRecentDailyStats(config.riskPredictiveLookbackDays + 1);
        const historical = recentStats
            .filter((row) => row.date !== schedule.localDate)
            .slice(0, config.riskPredictiveLookbackDays)
            .map(mapDailySnapshotToPredictiveSample);
        const currentSample: PredictiveRiskMetricSample = {
            errorRate: schedule.riskSnapshot.errorRate,
            selectorFailureRate: schedule.riskSnapshot.selectorFailureRate,
            challengeCount: schedule.riskSnapshot.challengeCount,
            inviteVelocityRatio: schedule.riskSnapshot.inviteVelocityRatio,
        };
        const predictiveAlerts = evaluatePredictiveRiskAlerts(
            currentSample,
            historical,
            config.riskPredictiveSigma
        );
        if (predictiveAlerts.length > 0) {
            const topAlerts = predictiveAlerts.slice(0, 3);
            await logWarn('risk.predictive_alert', {
                workflow: options.workflow,
                localDate: schedule.localDate,
                alerts: topAlerts,
            });
            await pushOutboxEvent(
                'risk.predictive_alert',
                {
                    workflow: options.workflow,
                    localDate: schedule.localDate,
                    alerts: topAlerts,
                    sigma: config.riskPredictiveSigma,
                    lookbackDays: config.riskPredictiveLookbackDays,
                },
                `risk.predictive_alert:${schedule.localDate}:${options.workflow}`
            );
            const summary = topAlerts
                .map((alert) => `${alert.metric} z=${alert.zScore.toFixed(2)} curr=${alert.current.toFixed(3)} mean=${alert.mean.toFixed(3)}`)
                .join('\n');
            await sendTelegramAlert(
                `Anomalia predittiva rilevata.\nWorkflow: ${options.workflow}\n${summary}`,
                'Risk Predictive Alert',
                'warn'
            );
        }
    }

    if (options.dryRun) {
        console.log('[DRY_RUN] workflow.preview', {
            workflow: options.workflow,
            localDate: schedule.localDate,
            risk: schedule.riskSnapshot,
            queuedInviteJobs: schedule.queuedInviteJobs,
            queuedCheckJobs: schedule.queuedCheckJobs,
            queuedMessageJobs: schedule.queuedMessageJobs,
            inviteBudget: schedule.inviteBudget,
            messageBudget: schedule.messageBudget,
            listBreakdown: schedule.listBreakdown,
        });
        return;
    }

    await pushOutboxEvent(
        'scheduler.snapshot',
        {
            workflow: options.workflow,
            localDate: schedule.localDate,
            risk: schedule.riskSnapshot,
            queuedInviteJobs: schedule.queuedInviteJobs,
            queuedCheckJobs: schedule.queuedCheckJobs,
            queuedMessageJobs: schedule.queuedMessageJobs,
            inviteBudget: schedule.inviteBudget,
            messageBudget: schedule.messageBudget,
            listBreakdown: schedule.listBreakdown,
        },
        `scheduler.snapshot:${schedule.localDate}:${options.workflow}`
    );

    if (schedule.riskSnapshot.action === 'STOP') {
        await quarantineAccount('RISK_STOP_THRESHOLD', {
            workflow: options.workflow,
            riskSnapshot: schedule.riskSnapshot,
        });
        return;
    }

    const guardian = await evaluateAiGuardian(options.workflow, schedule);
    if (guardian.decision) {
        await pushOutboxEvent(
            'ai.guardian.decision',
            {
                workflow: options.workflow,
                localDate: schedule.localDate,
                executed: guardian.executed,
                reason: guardian.reason,
                decision: guardian.decision,
            },
            `ai.guardian.decision:${schedule.localDate}:${options.workflow}:${Date.now()}`
        );
        if (guardian.decision.severity === 'critical' && guardian.decision.pauseMinutes > 0) {
            await pauseAutomation(
                'AI_GUARDIAN_PREEMPTIVE',
                {
                    workflow: options.workflow,
                    localDate: schedule.localDate,
                    reason: guardian.reason,
                    decision: guardian.decision,
                },
                guardian.decision.pauseMinutes
            );
            await logWarn('ai.guardian.preemptive_pause', {
                workflow: options.workflow,
                localDate: schedule.localDate,
                reason: guardian.reason,
                pauseMinutes: guardian.decision.pauseMinutes,
                summary: guardian.decision.summary,
            });
            return;
        }
        if (guardian.decision.severity === 'watch') {
            await logWarn('ai.guardian.watch', {
                workflow: options.workflow,
                localDate: schedule.localDate,
                reason: guardian.reason,
                summary: guardian.decision.summary,
                recommendations: guardian.decision.recommendations,
            });
        } else {
            await logInfo('ai.guardian.normal', {
                workflow: options.workflow,
                localDate: schedule.localDate,
                reason: guardian.reason,
                summary: guardian.decision.summary,
            });
        }
    }

    const cooldown = evaluateCooldownDecision(schedule.riskSnapshot);
    if (cooldown.activate) {
        await pauseAutomation(
            'RISK_COOLDOWN',
            {
                workflow: options.workflow,
                localDate: schedule.localDate,
                riskSnapshot: schedule.riskSnapshot,
                tier: cooldown.tier,
                reason: cooldown.reason,
                listBreakdown: schedule.listBreakdown,
            },
            cooldown.minutes
        );
        await logWarn('risk.cooldown.activated', {
            workflow: options.workflow,
            localDate: schedule.localDate,
            tier: cooldown.tier,
            reason: cooldown.reason,
            pauseMinutes: cooldown.minutes,
            score: schedule.riskSnapshot.score,
            pendingRatio: schedule.riskSnapshot.pendingRatio,
        });
        return;
    }

    if (schedule.riskSnapshot.action === 'WARN') {
        await logWarn('risk.warn', {
            workflow: options.workflow,
            score: schedule.riskSnapshot.score,
            pendingRatio: schedule.riskSnapshot.pendingRatio,
        });
    }
    if (schedule.riskSnapshot.action === 'LOW_ACTIVITY') {
        await logWarn('risk.low_activity', {
            workflow: options.workflow,
            score: schedule.riskSnapshot.score,
            pendingRatio: schedule.riskSnapshot.pendingRatio,
            inviteBudget: schedule.inviteBudget,
            messageBudget: schedule.messageBudget,
        });
        if (options.workflow === 'all' || options.workflow === 'invite' || options.workflow === 'message') {
            const accounts = getRuntimeAccountProfiles();
            for (const acc of accounts) {
                await runRandomLinkedinActivity({
                    accountId: acc.id,
                    maxActions: 1 + Math.floor(Math.random() * 2),
                    dryRun: false,
                });
            }
        }
    }

    if (options.workflow === 'warmup') {
        if (!options.dryRun) {
            await logInfo('workflow.warmup.start', { localDate: schedule.localDate });
            const accounts = getRuntimeAccountProfiles();
            if (accounts.length > 0) {
                for (const acc of accounts) {
                    await runRandomLinkedinActivity({
                        accountId: acc.id,
                        maxActions: Math.floor(Math.random() * 4) + 3,
                        dryRun: false
                    });
                }
            }
            await logInfo('workflow.warmup.end', { localDate: schedule.localDate });
        }
        return;
    }

    await runQueuedJobs({
        localDate: schedule.localDate,
        allowedTypes: workflowToJobTypes(options.workflow),
        dryRun: options.dryRun,
    });

    if (config.postRunStateSyncEnabled) {
        const stateSyncReport = await runSiteCheck({
            limitPerStatus: config.postRunStateSyncLimit,
            autoFix: config.postRunStateSyncFix,
        });
        await logInfo('state.sync.post_run', {
            workflow: options.workflow,
            localDate: schedule.localDate,
            limitPerStatus: config.postRunStateSyncLimit,
            autoFix: config.postRunStateSyncFix,
            report: stateSyncReport,
        });
        await pushOutboxEvent(
            'state.sync.post_run',
            {
                workflow: options.workflow,
                localDate: schedule.localDate,
                limitPerStatus: config.postRunStateSyncLimit,
                autoFix: config.postRunStateSyncFix,
                report: stateSyncReport,
            },
            `state.sync.post_run:${schedule.localDate}:${options.workflow}:${Date.now()}`
        );
    }

    await runEventSyncOnce();
}
