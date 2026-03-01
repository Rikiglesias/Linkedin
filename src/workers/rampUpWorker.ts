import { config, getLocalDateString } from '../config';
import {
    getRampUpState,
    getRiskInputs,
    getRuntimeFlag,
    listLeadCampaignConfigs,
    setRuntimeFlag,
    updateLeadCampaignConfig,
    upsertRampUpState,
} from '../core/repositories';
import { evaluateRisk } from '../risk/riskEngine';
import { logInfo, logWarn } from '../telemetry/logger';

export interface RampUpWorkerReport {
    executed: boolean;
    localDate: string;
    reason: string;
    updatedLists: number;
    skippedLists: number;
}

function computeNextCap(current: number, increase: number, hardMax: number): number {
    if (current <= 0) return Math.min(hardMax, 1);
    const grown = Math.floor(current * (1 + increase));
    const minBump = current + 1;
    return Math.min(hardMax, Math.max(minBump, grown));
}

export async function runRampUpWorker(): Promise<RampUpWorkerReport> {
    const localDate = getLocalDateString();
    if (!config.rampUpEnabled) {
        return {
            executed: false,
            localDate,
            reason: 'rampup_disabled',
            updatedLists: 0,
            skippedLists: 0,
        };
    }

    const lastRunDate = await getRuntimeFlag('rampup.last_run_date');
    if (lastRunDate === localDate) {
        return {
            executed: false,
            localDate,
            reason: 'already_executed_today',
            updatedLists: 0,
            skippedLists: 0,
        };
    }

    const riskInputs = await getRiskInputs(localDate, config.hardInviteCap);
    const risk = evaluateRisk(riskInputs);
    if (risk.action !== 'NORMAL') {
        await logWarn('rampup.skipped_risk', { localDate, riskAction: risk.action, score: risk.score });
        return {
            executed: false,
            localDate,
            reason: `risk_${risk.action.toLowerCase()}`,
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
        const nextInvite = computeNextCap(currentInvite, config.rampUpDailyIncrease, inviteHardMax);
        const nextMessage = computeNextCap(currentMessage, config.rampUpDailyIncrease, messageHardMax);

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
        updatedLists,
        skippedLists,
        dailyIncrease: config.rampUpDailyIncrease,
        maxCap: config.rampUpMaxCap,
    });

    return {
        executed: true,
        localDate,
        reason: 'ok',
        updatedLists,
        skippedLists,
    };
}

