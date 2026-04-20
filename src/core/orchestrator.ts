import { getRuntimeAccountProfiles, setOverrideAccountId } from '../accountManager';
import { getSessionMaturity } from '../browser/sessionCookieMonitor';
import { config, getWeekStartDate } from '../config';
import { pauseAutomation, quarantineAccount } from '../risk/incidentManager';
import {
    estimateBanProbability,
    evaluateComplianceHealthScore,
    evaluateCooldownDecision,
    evaluatePredictiveRiskAlerts,
    PredictiveRiskMetricSample,
} from '../risk/riskEngine';
import { logInfo, logWarn } from '../telemetry/logger';
import { runEventSyncOnce } from '../sync/eventSync';
import { ListScheduleBreakdown, scheduleJobs, workflowToJobTypes } from './scheduler';
import { runSiteCheck } from './audit';

import { runQueuedJobs } from './jobRunner';
import {
    countWeeklyInvites,
    getAutomationPauseState,
    getComplianceHealthMetrics,
    getDailyStat,
    getRecentDailyStats,
    getRuntimeFlag,
    pushOutboxEvent,
    setRuntimeFlag,
} from './repositories';
import { evaluateAiGuardian } from '../ai/guardian';
import { runRandomLinkedinActivity } from '../workers/randomActivityWorker';
import { sendTelegramAlert } from '../telemetry/alerts';
import { evaluateWorkflowEntryGuards } from './workflowEntryGuards';
import type { WorkflowSelection } from './workflowSelection';
import type { WorkflowBlockedState } from '../workflows/types';

export interface RunWorkflowOptions {
    workflow: WorkflowSelection;
    dryRun: boolean;
    /** Filtra solo lead di questa lista (null = tutte le liste attive) */
    listFilter?: string | null;
    /** Score minimo per inviti (default: nessun filtro) */
    minScore?: number;
    /** Limite massimo job per questa sessione (sovrascrive budget giornaliero) */
    sessionLimit?: number;
    /** Modalità nota invito: 'ai', 'template', 'none' */
    noteMode?: 'ai' | 'template' | 'none';
    /** Lingua preferita per AI generation (it, en, fr, es, nl) */
    lang?: string;
    /** Modalità messaggio: 'ai' (default) o 'template' (forza template senza AI) */
    messageMode?: 'ai' | 'template';
    /** Account ID override (forza un account specifico per il workflow) */
    accountId?: string;
    /** Internal: salta le entry guard già valutate da un adapter esterno. */
    skipEntryGuards?: boolean;
}

export interface RunWorkflowOutcome {
    status: 'completed' | 'blocked' | 'dry_run';
    blocked: WorkflowBlockedState | null;
    localDate?: string;
}

function toFlagSafeToken(value: string): string {
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return normalized || 'unknown';
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

async function evaluateComplianceHealthGuard(
    workflow: WorkflowSelection,
    localDate: string,
    inviteBudget: number,
    messageBudget: number,
    listBreakdown: ListScheduleBreakdown[],
): Promise<boolean> {
    if (!config.complianceHealthScoreEnabled) {
        return true;
    }

    const [metrics, invitesSentToday, messagesSentToday, weeklyInvitesSent] = await Promise.all([
        getComplianceHealthMetrics(localDate, config.complianceHealthLookbackDays, config.hardInviteCap),
        getDailyStat(localDate, 'invites_sent'),
        getDailyStat(localDate, 'messages_sent'),
        countWeeklyInvites(getWeekStartDate()),
    ]);

    const healthSnapshot = evaluateComplianceHealthScore({
        acceptanceRatePct: metrics.acceptanceRatePct,
        engagementRatePct: metrics.engagementRatePct,
        pendingRatio: metrics.pendingRatio,
        invitesSentToday,
        messagesSentToday,
        weeklyInvitesSent,
        dailyInviteLimit: Math.max(1, inviteBudget > 0 ? inviteBudget : config.softInviteCap),
        dailyMessageLimit: Math.max(1, messageBudget > 0 ? messageBudget : config.softMsgCap),
        weeklyInviteLimit: Math.max(1, config.weeklyInviteLimit),
        pendingWarnThreshold: config.complianceHealthPendingWarnThreshold,
    });

    await pushOutboxEvent(
        'compliance.health.snapshot',
        {
            workflow,
            localDate,
            metrics,
            health: healthSnapshot,
            thresholds: {
                pauseThreshold: config.complianceHealthPauseThreshold,
                pendingAlertThreshold: config.compliancePendingRatioAlertThreshold,
                pendingWarnThreshold: config.complianceHealthPendingWarnThreshold,
                minInviteSample: config.complianceHealthMinInviteSample,
                minMessageSample: config.complianceHealthMinMessageSample,
            },
        },
        `compliance.health.snapshot:${localDate}:${workflow}`,
    );

    const hasInviteSample = metrics.invitesSentLookback >= config.complianceHealthMinInviteSample;
    const hasMessageSample = metrics.messagedLookback >= config.complianceHealthMinMessageSample;
    const hasSufficientSample = hasInviteSample && hasMessageSample;

    if (
        metrics.pendingRatio >= config.compliancePendingRatioAlertThreshold &&
        metrics.invitesSentLookback >= config.compliancePendingRatioAlertMinInvited
    ) {
        const accounts = getRuntimeAccountProfiles()
            .map((entry) => entry.id)
            .filter((id) => !!id.trim());
        const dueAccountAlerts: string[] = [];
        for (const accountId of accounts) {
            const accountKey = `compliance_pending_alert_account:${toFlagSafeToken(accountId)}`;
            const accountAlertDate = await getRuntimeFlag(accountKey);
            if (accountAlertDate !== localDate) {
                dueAccountAlerts.push(accountId);
                await setRuntimeFlag(accountKey, localDate);
            }
        }

        const pendingAlertDate = await getRuntimeFlag('compliance_pending_alert_date');
        if (pendingAlertDate !== localDate || dueAccountAlerts.length > 0) {
            await setRuntimeFlag('compliance_pending_alert_date', localDate);
            const accountSuffix = dueAccountAlerts.length > 0 ? `\nAccount: ${dueAccountAlerts.join(', ')}` : '';
            await sendTelegramAlert(
                `Pending ratio elevato (${(metrics.pendingRatio * 100).toFixed(1)}%).\nWorkflow: ${workflow}\nDate: ${localDate}${accountSuffix}`,
                'Compliance Pending Alert',
                'warn',
            );
        }
    }

    const worstPendingList = [...listBreakdown]
        .filter((entry) => entry.pendingRatio >= config.compliancePendingRatioAlertThreshold)
        .sort((a, b) => b.pendingRatio - a.pendingRatio)[0];
    if (worstPendingList) {
        const listFlagKey = `compliance_pending_alert_list:${toFlagSafeToken(worstPendingList.listName)}`;
        const listAlertDate = await getRuntimeFlag(listFlagKey);
        if (listAlertDate !== localDate) {
            await setRuntimeFlag(listFlagKey, localDate);
            await sendTelegramAlert(
                `Pending ratio elevato nella lista "${worstPendingList.listName}" (${(worstPendingList.pendingRatio * 100).toFixed(1)}%).\nWorkflow: ${workflow}\nDate: ${localDate}`,
                'Compliance Pending List Alert',
                'warn',
            );
        }
    }

    if (!hasSufficientSample) {
        await logInfo('compliance.health.sample_insufficient', {
            workflow,
            localDate,
            invitesSentLookback: metrics.invitesSentLookback,
            messagedLookback: metrics.messagedLookback,
            minInviteSample: config.complianceHealthMinInviteSample,
            minMessageSample: config.complianceHealthMinMessageSample,
            score: healthSnapshot.score,
        });
        return true;
    }

    if (healthSnapshot.score < config.complianceHealthPauseThreshold) {
        await pauseAutomation(
            'COMPLIANCE_HEALTH_LOW',
            {
                workflow,
                localDate,
                healthSnapshot,
                metrics,
                threshold: config.complianceHealthPauseThreshold,
            },
            config.autoPauseMinutesOnFailureBurst,
        );
        await logWarn('compliance.health.pause', {
            workflow,
            localDate,
            score: healthSnapshot.score,
            threshold: config.complianceHealthPauseThreshold,
            acceptanceRatePct: metrics.acceptanceRatePct,
            engagementRatePct: metrics.engagementRatePct,
            pendingRatio: metrics.pendingRatio,
        });
        return false;
    }

    await logInfo('compliance.health.ok', {
        workflow,
        localDate,
        score: healthSnapshot.score,
        acceptanceRatePct: metrics.acceptanceRatePct,
        engagementRatePct: metrics.engagementRatePct,
        pendingRatio: metrics.pendingRatio,
    });
    return true;
}

export async function runWorkflow(options: RunWorkflowOptions): Promise<RunWorkflowOutcome> {
    if (options.accountId) {
        setOverrideAccountId(options.accountId);
    }

    if (!options.skipEntryGuards) {
        const entryGuardDecision = await evaluateWorkflowEntryGuards({
            workflow: options.workflow,
            dryRun: options.dryRun,
            accountId: options.accountId,
        });
        if (!entryGuardDecision.allowed) {
            return {
                status: 'blocked',
                blocked: entryGuardDecision.blocked,
            };
        }
    }

    const schedule = await scheduleJobs(options.workflow, {
        dryRun: options.dryRun,
        listFilter: options.listFilter,
        minScore: options.minScore,
        sessionLimit: options.sessionLimit,
        noteMode: options.noteMode,
        lang: options.lang,
        messageMode: options.messageMode,
    });

    if (!options.dryRun) {
        const touchesOutreach =
            options.workflow === 'all' || options.workflow === 'invite' || options.workflow === 'message';
        if (touchesOutreach) {
            const canProceed = await evaluateComplianceHealthGuard(
                options.workflow,
                schedule.localDate,
                schedule.inviteBudget,
                schedule.messageBudget,
                schedule.listBreakdown,
            );
            if (!canProceed) {
                return {
                    status: 'blocked',
                    blocked: {
                        reason: 'COMPLIANCE_HEALTH_BLOCKED',
                        message: 'Workflow bloccato dal compliance health guard',
                        details: {
                            workflow: options.workflow,
                            localDate: schedule.localDate,
                        },
                    },
                    localDate: schedule.localDate,
                };
            }
        }
    }

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
        const predictiveAlerts = evaluatePredictiveRiskAlerts(currentSample, historical, config.riskPredictiveSigma);
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
                `risk.predictive_alert:${schedule.localDate}:${options.workflow}`,
            );
            const summary = topAlerts
                .map(
                    (alert) =>
                        `${alert.metric} z=${alert.zScore.toFixed(2)} curr=${alert.current.toFixed(3)} mean=${alert.mean.toFixed(3)}`,
                )
                .join('\n');
            await sendTelegramAlert(
                `Anomalia predittiva rilevata.\nWorkflow: ${options.workflow}\n${summary}`,
                'Risk Predictive Alert',
                'warn',
            );
        }
    }

    // Ban Probability Score (5.4 wire): stima probabilità ban 0-100.
    // Fuori dal blocco riskPredictiveAlertsEnabled perché il ban score è utile SEMPRE,
    // anche se l'utente disabilita gli alert predittivi (troppo rumorosi).
    if (!options.dryRun) {
        const banProb = estimateBanProbability(
            [], // predictiveAlerts non disponibili se alerts disabilitati — score usa gli altri 3 fattori
            schedule.riskSnapshot.pendingRatio > 0 ? (1 - schedule.riskSnapshot.pendingRatio) * 100 : 50,
            schedule.riskSnapshot.challengeCount,
            schedule.riskSnapshot.pendingRatio,
        );
        await logInfo('risk.ban_probability', {
            workflow: options.workflow,
            localDate: schedule.localDate,
            score: banProb.score,
            level: banProb.level,
            factors: banProb.factors,
        });
        await pushOutboxEvent(
            'risk.ban_probability',
            { ...banProb, workflow: options.workflow, localDate: schedule.localDate },
            `risk.ban_probability:${schedule.localDate}:${options.workflow}`,
        );
        if (banProb.level === 'HIGH' || banProb.level === 'CRITICAL') {
            await sendTelegramAlert(
                `Ban Probability: ${banProb.score}/100 (${banProb.level})\n${banProb.recommendation}`,
                'Ban Risk Alert',
                banProb.level === 'CRITICAL' ? 'critical' : 'warn',
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
        return { status: 'dry_run', blocked: null, localDate: schedule.localDate };
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
        `scheduler.snapshot:${schedule.localDate}:${options.workflow}`,
    );

    if (schedule.riskSnapshot.action === 'STOP') {
        await quarantineAccount('RISK_STOP_THRESHOLD', {
            workflow: options.workflow,
            riskSnapshot: schedule.riskSnapshot,
        });
        return {
            status: 'blocked',
            blocked: {
                reason: 'RISK_STOP_THRESHOLD',
                message: 'Workflow bloccato da risk snapshot STOP',
                details: {
                    workflow: options.workflow,
                    localDate: schedule.localDate,
                    score: schedule.riskSnapshot.score,
                },
            },
            localDate: schedule.localDate,
        };
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
            `ai.guardian.decision:${schedule.localDate}:${options.workflow}:${Date.now()}`,
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
                guardian.decision.pauseMinutes,
            );
            await logWarn('ai.guardian.preemptive_pause', {
                workflow: options.workflow,
                localDate: schedule.localDate,
                reason: guardian.reason,
                pauseMinutes: guardian.decision.pauseMinutes,
                summary: guardian.decision.summary,
            });
            return {
                status: 'blocked',
                blocked: {
                    reason: 'AI_GUARDIAN_PREEMPTIVE',
                    message: guardian.decision.summary,
                    details: {
                        workflow: options.workflow,
                        localDate: schedule.localDate,
                        pauseMinutes: guardian.decision.pauseMinutes,
                        reason: guardian.reason,
                    },
                },
                localDate: schedule.localDate,
            };
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
            cooldown.minutes,
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
        return {
            status: 'blocked',
            blocked: {
                reason: 'RISK_COOLDOWN',
                message: cooldown.reason ?? 'Cooldown di rischio attivato',
                details: {
                    workflow: options.workflow,
                    localDate: schedule.localDate,
                    tier: cooldown.tier,
                    pauseMinutes: cooldown.minutes,
                },
            },
            localDate: schedule.localDate,
        };
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
                    dryRun: options.dryRun,
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
                        dryRun: options.dryRun,
                    });
                }
            }
            await logInfo('workflow.warmup.end', { localDate: schedule.localDate });
        }
        return { status: 'completed', blocked: null, localDate: schedule.localDate };
    }

    // Session maturity guard: force random LinkedIn activity before outreach
    // when cookies are < 2 days old to avoid triggering detection on fresh sessions
    if (!options.dryRun) {
        const touchesOutreach =
            options.workflow === 'all' || options.workflow === 'invite' || options.workflow === 'message';
        if (touchesOutreach) {
            const allAccounts = getRuntimeAccountProfiles();
            for (const acc of allAccounts) {
                const maturity = getSessionMaturity(acc.sessionDir);
                if (maturity.forceRandomActivityFirst) {
                    await logInfo('workflow.maturity.force_random_first', {
                        accountId: acc.id,
                        maturity: maturity.maturity,
                        ageDays: maturity.ageDays,
                        budgetFactor: maturity.budgetFactor,
                    });
                    await runRandomLinkedinActivity({
                        accountId: acc.id,
                        maxActions: 2 + Math.floor(Math.random() * 3),
                        dryRun: false,
                    });
                }
            }
        }
    }

    await runQueuedJobs({
        localDate: schedule.localDate,
        allowedTypes: workflowToJobTypes(options.workflow),
        dryRun: options.dryRun,
    });

    // Propagate mid-run pause/quarantine triggered inside runQueuedJobs
    const quarantinedMidRun = (await getRuntimeFlag('account_quarantine')) === 'true';
    if (quarantinedMidRun) {
        return {
            status: 'blocked',
            blocked: {
                reason: 'ACCOUNT_QUARANTINED',
                message: 'Account messo in quarantena durante la run',
            },
            localDate: schedule.localDate,
        };
    }
    const pauseStateMidRun = await getAutomationPauseState();
    if (pauseStateMidRun.paused) {
        return {
            status: 'blocked',
            blocked: {
                reason: 'AUTOMATION_PAUSED',
                message: `Automazione messa in pausa durante la run: ${pauseStateMidRun.reason ?? 'motivo sconosciuto'}`,
                details: {
                    pausedUntil: pauseStateMidRun.pausedUntil,
                    remainingSeconds: pauseStateMidRun.remainingSeconds,
                },
            },
            localDate: schedule.localDate,
        };
    }

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
            `state.sync.post_run:${schedule.localDate}:${options.workflow}:${Date.now()}`,
        );
    }

    await runEventSyncOnce();
    return { status: 'completed', blocked: null, localDate: schedule.localDate };
}
