import { config, getLocalDateString, getWeekStartDate } from '../config';
import {
    countWeeklyInvites,
    getAccountAgeDays,
    getComplianceHealthMetrics,
    getDailyStat,
    getRampUpState,
    getRiskInputs,
    getRuntimeFlag,
    listLeadCampaignConfigs,
    setRuntimeFlag,
    updateLeadCampaignConfig,
    upsertRampUpState,
} from '../core/repositories';
import { computeNonLinearRampCap } from '../ml/rampModel';
import { calculateDynamicWeeklyInviteLimit, evaluateComplianceHealthScore, evaluateRisk } from '../risk/riskEngine';
import { logInfo, logWarn } from '../telemetry/logger';

export interface RampUpWorkerReport {
    executed: boolean;
    localDate: string;
    mode: 'linear' | 'non_linear';
    reason: string;
    riskAction: string;
    riskScore: number;
    healthScore: number;
    updatedLists: number;
    skippedLists: number;
}

function computeNextCapLinear(current: number, increase: number, hardMax: number): number {
    if (current <= 0) return Math.min(hardMax, 1);
    const grown = Math.floor(current * (1 + increase));
    const minBump = current + 1;
    return Math.min(hardMax, Math.max(minBump, grown));
}

export async function runRampUpWorker(): Promise<RampUpWorkerReport> {
    const localDate = getLocalDateString();
    const mode: RampUpWorkerReport['mode'] = config.rampUpNonLinearModelEnabled ? 'non_linear' : 'linear';
    if (!config.rampUpEnabled) {
        return {
            executed: false,
            localDate,
            mode,
            reason: 'rampup_disabled',
            riskAction: 'UNKNOWN',
            riskScore: 0,
            healthScore: 0,
            updatedLists: 0,
            skippedLists: 0,
        };
    }

    const lastRunDate = await getRuntimeFlag('rampup.last_run_date');
    if (lastRunDate === localDate) {
        return {
            executed: false,
            localDate,
            mode,
            reason: 'already_executed_today',
            riskAction: 'UNKNOWN',
            riskScore: 0,
            healthScore: 0,
            updatedLists: 0,
            skippedLists: 0,
        };
    }

    const weekStartDate = getWeekStartDate();
    const [riskInputs, accountAgeDays, invitesSentToday, messagesSentToday, weeklyInvitesSent, complianceMetrics] = await Promise.all([
        getRiskInputs(localDate, config.hardInviteCap),
        getAccountAgeDays(),
        getDailyStat(localDate, 'invites_sent'),
        getDailyStat(localDate, 'messages_sent'),
        countWeeklyInvites(weekStartDate),
        getComplianceHealthMetrics(localDate, config.complianceHealthLookbackDays, config.hardInviteCap),
    ]);
    const risk = evaluateRisk(riskInputs);
    const weeklyInviteLimitEffective = config.complianceDynamicWeeklyLimitEnabled
        ? calculateDynamicWeeklyInviteLimit(
            accountAgeDays,
            config.complianceDynamicWeeklyMinInvites,
            config.complianceDynamicWeeklyMaxInvites,
            config.complianceDynamicWeeklyWarmupDays
        )
        : config.weeklyInviteLimit;
    const complianceHealth = evaluateComplianceHealthScore({
        acceptanceRatePct: complianceMetrics.acceptanceRatePct,
        engagementRatePct: complianceMetrics.engagementRatePct,
        pendingRatio: riskInputs.pendingRatio,
        invitesSentToday,
        messagesSentToday,
        weeklyInvitesSent,
        dailyInviteLimit: config.hardInviteCap,
        dailyMessageLimit: config.hardMsgCap,
        weeklyInviteLimit: weeklyInviteLimitEffective,
        pendingWarnThreshold: config.complianceHealthPendingWarnThreshold,
    });

    if (!config.rampUpNonLinearModelEnabled && risk.action !== 'NORMAL') {
        await logWarn('rampup.skipped_risk', { localDate, riskAction: risk.action, score: risk.score });
        return {
            executed: false,
            localDate,
            mode,
            reason: `risk_${risk.action.toLowerCase()}`,
            riskAction: risk.action,
            riskScore: risk.score,
            healthScore: complianceHealth.score,
            updatedLists: 0,
            skippedLists: 0,
        };
    }

    const lists = await listLeadCampaignConfigs(true);
    let updatedLists = 0;
    let skippedLists = 0;
    const inviteHardMax = Math.min(config.rampUpMaxCap, config.complianceMaxHardInviteCap);
    const messageHardMax = Math.min(config.rampUpMaxCap, config.complianceMaxHardMsgCap);

    for (const list of lists) {
        const state = await getRampUpState(list.name);
        if (state?.last_run_date === localDate) {
            skippedLists += 1;
            continue;
        }

        const currentInvite = list.dailyInviteCap ?? config.softInviteCap;
        const currentMessage = list.dailyMessageCap ?? config.softMsgCap;

        let nextInvite: number;
        let nextMessage: number;

        if (config.rampUpNonLinearModelEnabled) {
            const inviteModel = computeNonLinearRampCap({
                channel: 'invite',
                currentCap: currentInvite,
                hardMaxCap: inviteHardMax,
                baseDailyIncrease: config.rampUpDailyIncrease,
                accountAgeDays,
                warmupDays: config.rampUpModelWarmupDays,
                riskAction: risk.action,
                riskScore: risk.score,
                pendingRatio: riskInputs.pendingRatio,
                errorRate: riskInputs.errorRate,
                healthScore: complianceHealth.score,
            });
            const messageModel = computeNonLinearRampCap({
                channel: 'message',
                currentCap: currentMessage,
                hardMaxCap: messageHardMax,
                baseDailyIncrease: config.rampUpDailyIncrease,
                accountAgeDays,
                warmupDays: config.rampUpModelWarmupDays,
                riskAction: risk.action,
                riskScore: risk.score,
                pendingRatio: riskInputs.pendingRatio,
                errorRate: riskInputs.errorRate,
                healthScore: complianceHealth.score,
            });
            nextInvite = inviteModel.nextCap;
            nextMessage = messageModel.nextCap;

            // Safety-first: in warning/degraded states never increase caps.
            if (risk.action !== 'NORMAL') {
                nextInvite = Math.min(nextInvite, currentInvite);
                nextMessage = Math.min(nextMessage, currentMessage);
            }
        } else {
            nextInvite = computeNextCapLinear(currentInvite, config.rampUpDailyIncrease, inviteHardMax);
            nextMessage = computeNextCapLinear(currentMessage, config.rampUpDailyIncrease, messageHardMax);
        }

        if (nextInvite === currentInvite && nextMessage === currentMessage) {
            skippedLists += 1;
            continue;
        }

        await updateLeadCampaignConfig(list.name, {
            dailyInviteCap: nextInvite,
            dailyMessageCap: nextMessage,
            isActive: true,
        });
        await upsertRampUpState(list.name, nextInvite, nextMessage, config.rampUpDailyIncrease, localDate);
        updatedLists += 1;
    }

    await setRuntimeFlag('rampup.last_run_date', localDate);
    await logInfo('rampup.completed', {
        localDate,
        mode,
        riskAction: risk.action,
        riskScore: risk.score,
        healthScore: complianceHealth.score,
        accountAgeDays,
        updatedLists,
        skippedLists,
        dailyIncrease: config.rampUpDailyIncrease,
        maxCap: config.rampUpMaxCap,
    });

    return {
        executed: true,
        localDate,
        mode,
        reason: 'ok',
        riskAction: risk.action,
        riskScore: risk.score,
        healthScore: complianceHealth.score,
        updatedLists,
        skippedLists,
    };
}
