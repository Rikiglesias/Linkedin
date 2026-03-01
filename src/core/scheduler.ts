import { config, getLocalDateString, getWeekStartDate, getWorkingHourIntensity } from '../config';
import { pickAccountIdForLead, getRuntimeAccountProfiles } from '../accountManager';
import { evaluateRisk, calculateDynamicBudget, calculateAccountWarmupMultiplier } from '../risk/riskEngine';
import { JobType, RiskSnapshot } from '../types/domain';
import {
    countWeeklyInvites,
    ensureLeadList,
    enqueueJob,
    getDailyStat,
    getLeadStatusCountsForLists,
    getLeadsByStatusForList,
    getListDailyStat,
    getRuntimeFlag,
    getRiskInputs,
    listLeadCampaignConfigs,
    promoteNewLeadsToReadyInvite,
    syncLeadListsFromLeads,
    getAccountAgeDays
} from './repositories';
import { transitionLead } from './leadStateService';

export type WorkflowSelection = 'invite' | 'check' | 'message' | 'warmup' | 'all';

export interface ScheduleResult {
    localDate: string;
    riskSnapshot: RiskSnapshot;
    inviteBudget: number;
    messageBudget: number;
    queuedInviteJobs: number;
    queuedCheckJobs: number;
    queuedMessageJobs: number;
    listBreakdown: ListScheduleBreakdown[];
    dryRun: boolean;
}

export interface ScheduleOptions {
    dryRun?: boolean;
}

export interface ListScheduleBreakdown {
    listName: string;
    inviteBudget: number;
    messageBudget: number;
    queuedInviteJobs: number;
    queuedCheckJobs: number;
    queuedMessageJobs: number;
    adaptiveFactor: number;
    adaptiveReasons: string[];
    pendingRatio: number;
    blockedRatio: number;
    maxScheduledDelaySec: number;
}

export function workflowToJobTypes(workflow: WorkflowSelection): JobType[] {
    if (workflow === 'all') return ['INVITE', 'ACCEPTANCE_CHECK', 'MESSAGE', 'HYGIENE'];
    if (workflow === 'invite') return ['INVITE'];
    if (workflow === 'check') return ['ACCEPTANCE_CHECK', 'HYGIENE'];
    if (workflow === 'warmup') return [];
    return ['MESSAGE', 'HYGIENE'];
}

function buildInviteKey(leadId: number, localDate: string): string {
    return `invite:${leadId}:${localDate}`;
}

function buildMessageKey(leadId: number, acceptedAtDate: string): string {
    return `message:${leadId}:${acceptedAtDate}`;
}

function buildCheckKey(leadId: number, localDate: string): string {
    return `check:${leadId}:${localDate}`;
}

function computeListBudget(globalRemaining: number, listCap: number | null, alreadyConsumed: number): number {
    const listRemaining = listCap === null
        ? globalRemaining
        : Math.max(0, listCap - alreadyConsumed);
    return Math.max(0, Math.min(globalRemaining, listRemaining));
}

interface AdaptiveBudgetContext {
    factor: number;
    reasons: string[];
    pendingRatio: number;
    blockedRatio: number;
}

interface NoBurstPlanner {
    nextDelaySec: () => number;
}

function toNonNegativeInt(value: number): number {
    return Math.max(0, Math.floor(value));
}

function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function pickRandomInt(min: number, max: number): number {
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    if (high <= low) return low;
    return Math.floor(Math.random() * (high - low + 1)) + low;
}

function applyAdaptiveFactor(rawBudget: number, factor: number): number {
    if (rawBudget <= 0 || factor <= 0) {
        return 0;
    }
    const computed = Math.floor(rawBudget * factor);
    if (computed <= 0) {
        return 1;
    }
    return Math.min(rawBudget, computed);
}

function clampInt(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(value)));
}

function parseSsiScore(rawValue: string | null, fallback: number): number {
    if (!rawValue) return clampInt(fallback, 0, 100);

    const direct = Number.parseFloat(rawValue);
    if (Number.isFinite(direct)) {
        return clampInt(direct, 0, 100);
    }

    try {
        const parsed = JSON.parse(rawValue) as { score?: number; ssi?: number };
        const candidate = parsed?.score ?? parsed?.ssi;
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
            return clampInt(candidate, 0, 100);
        }
    } catch {
        // ignore malformed payload and fallback
    }

    return clampInt(fallback, 0, 100);
}

function capFromSsi(score: number, minCap: number, maxCap: number): number {
    const low = Math.max(1, Math.min(minCap, maxCap));
    const high = Math.max(1, Math.max(minCap, maxCap));
    const ratio = Math.max(0, Math.min(1, score / 100));
    const cap = low + (high - low) * ratio;
    return clampInt(cap, low, high);
}

function resolveCapPair(staticSoft: number, staticHard: number, dynamicCap: number): { soft: number; hard: number } {
    const hard = Math.max(1, Math.min(staticHard, dynamicCap));
    const soft = Math.max(1, Math.min(staticSoft, hard));
    return { soft, hard };
}

function applyHourIntensityToBudget(budget: number, intensity: number): number {
    if (budget <= 0) return 0;
    if (intensity >= 0.999) return budget;
    if (intensity <= 0) return 0;
    const scaled = Math.floor(budget * intensity);
    if (scaled <= 0) return 1;
    return Math.min(budget, scaled);
}

function evaluateAdaptiveBudgetContext(
    statusCounts: Record<string, number>,
    riskAction: RiskSnapshot['action']
): AdaptiveBudgetContext {
    if (!config.adaptiveCapsEnabled) {
        return {
            factor: riskAction === 'STOP' ? 0 : 1,
            reasons: riskAction === 'STOP' ? ['global_risk_stop'] : [],
            pendingRatio: 0,
            blockedRatio: 0,
        };
    }

    const invited = statusCounts.INVITED ?? 0;
    const acceptedLike = (statusCounts.ACCEPTED ?? 0) + (statusCounts.READY_MESSAGE ?? 0) + (statusCounts.MESSAGED ?? 0);
    const blockedSkipped = (statusCounts.BLOCKED ?? 0) + (statusCounts.SKIPPED ?? 0);

    const pendingRatioDenominator = Math.max(1, invited + acceptedLike);
    const pendingRatio = invited / pendingRatioDenominator;

    const blockedRatioDenominator = Math.max(1, invited + acceptedLike + blockedSkipped);
    const blockedRatio = blockedSkipped / blockedRatioDenominator;

    let factor = 1;
    const reasons: string[] = [];

    if (riskAction === 'STOP') {
        factor = 0;
        reasons.push('global_risk_stop');
    } else if (riskAction === 'LOW_ACTIVITY') {
        factor = Math.min(factor, clamp01(config.lowActivityBudgetFactor));
        reasons.push('global_risk_low_activity');
    } else if (riskAction === 'WARN') {
        factor = Math.min(factor, clamp01(config.adaptiveCapsWarnFactor));
        reasons.push('global_risk_warn');
    }

    if (pendingRatio >= config.adaptiveCapsPendingStop) {
        factor = Math.min(factor, clamp01(config.adaptiveCapsMinFactor));
        reasons.push('list_pending_high');
    } else if (pendingRatio >= config.adaptiveCapsPendingWarn) {
        factor = Math.min(factor, 0.5);
        reasons.push('list_pending_warn');
    }

    if (blockedRatio >= config.adaptiveCapsBlockedWarn) {
        factor = Math.min(factor, 0.6);
        reasons.push('list_blocked_warn');
    }

    return {
        factor: clamp01(factor),
        reasons,
        pendingRatio: Number.parseFloat(pendingRatio.toFixed(4)),
        blockedRatio: Number.parseFloat(blockedRatio.toFixed(4)),
    };
}

function createNoBurstPlanner(): NoBurstPlanner {
    const minDelay = toNonNegativeInt(config.noBurstMinDelaySec);
    const maxDelay = toNonNegativeInt(config.noBurstMaxDelaySec);
    const longBreakEvery = toNonNegativeInt(config.noBurstLongBreakEvery);
    const longBreakMin = toNonNegativeInt(config.noBurstLongBreakMinSec);
    const longBreakMax = toNonNegativeInt(config.noBurstLongBreakMaxSec);

    let totalDelaySec = 0;
    let queuedJobs = 0;

    return {
        nextDelaySec: () => {
            queuedJobs += 1;
            totalDelaySec += pickRandomInt(minDelay, maxDelay);

            if (longBreakEvery > 0 && queuedJobs % longBreakEvery === 0) {
                totalDelaySec += pickRandomInt(longBreakMin, longBreakMax);
            }

            return totalDelaySec;
        },
    };
}

async function resolveActiveLists(): Promise<string[]> {
    await syncLeadListsFromLeads();
    let lists = await listLeadCampaignConfigs(true);
    if (lists.length === 0) {
        await ensureLeadList('default');
        lists = await listLeadCampaignConfigs(true);
    }
    return lists.map((list) => list.name);
}

function initListBreakdown(listNames: string[]): Map<string, ListScheduleBreakdown> {
    const map = new Map<string, ListScheduleBreakdown>();
    for (const listName of listNames) {
        map.set(listName, {
            listName,
            inviteBudget: 0,
            messageBudget: 0,
            queuedInviteJobs: 0,
            queuedCheckJobs: 0,
            queuedMessageJobs: 0,
            adaptiveFactor: 1,
            adaptiveReasons: [],
            pendingRatio: 0,
            blockedRatio: 0,
            maxScheduledDelaySec: 0,
        });
    }
    return map;
}

export async function scheduleJobs(workflow: WorkflowSelection, options: ScheduleOptions = {}): Promise<ScheduleResult> {
    const dryRun = options.dryRun ?? false;
    const localDate = getLocalDateString();
    const riskInputs = await getRiskInputs(localDate, config.hardInviteCap);
    const riskSnapshot = evaluateRisk(riskInputs);

    const dailyInvitesSent = await getDailyStat(localDate, 'invites_sent');
    const dailyMessagesSent = await getDailyStat(localDate, 'messages_sent');
    const weekStartDate = getWeekStartDate();
    const weeklyInvitesSent = await countWeeklyInvites(weekStartDate);
    const weeklyRemaining = Math.max(0, config.weeklyInviteLimit - weeklyInvitesSent);
    const ssiRaw = config.ssiDynamicLimitsEnabled
        ? await getRuntimeFlag(config.ssiStateKey)
        : null;
    const ssiScore = parseSsiScore(ssiRaw, config.ssiDefaultScore);
    const ssiInviteCap = config.ssiDynamicLimitsEnabled
        ? capFromSsi(ssiScore, config.ssiInviteMin, config.ssiInviteMax)
        : config.softInviteCap;
    const ssiMessageCap = config.ssiDynamicLimitsEnabled
        ? capFromSsi(ssiScore, config.ssiMessageMin, config.ssiMessageMax)
        : config.softMsgCap;
    const hourIntensity = getWorkingHourIntensity();

    const dbAccountAgeDays = await getAccountAgeDays();
    const accounts = getRuntimeAccountProfiles();

    let inviteBudget = 0;
    let messageBudget = 0;

    for (const account of accounts) {
        let ageDays = dbAccountAgeDays;
        if (account.warmupEnabled && account.warmupStartDate) {
            const startMs = new Date(account.warmupStartDate).getTime();
            if (!Number.isNaN(startMs)) {
                ageDays = Math.max(0, Math.floor((Date.now() - startMs) / 86400000));
            }
        }

        let warmupFactor = 1.0;
        if (account.warmupEnabled) {
            warmupFactor = calculateAccountWarmupMultiplier(ageDays, account.warmupMaxDays || 30);
        }

        const avgDailyInvites = Math.floor(dailyInvitesSent / accounts.length);
        const avgDailyMessages = Math.floor(dailyMessagesSent / accounts.length);

        const inviteCaps = resolveCapPair(config.softInviteCap, config.hardInviteCap, ssiInviteCap);
        const messageCaps = resolveCapPair(config.softMsgCap, config.hardMsgCap, ssiMessageCap);

        const limitInvite = calculateDynamicBudget(inviteCaps.soft, inviteCaps.hard, avgDailyInvites, riskSnapshot.action);
        const limitMessage = calculateDynamicBudget(messageCaps.soft, messageCaps.hard, avgDailyMessages, riskSnapshot.action);

        const accountInviteLimit = warmupFactor < 1.0
            ? Math.max(account.warmupMinActions || 5, Math.floor(limitInvite * warmupFactor))
            : limitInvite;

        const accountMessageLimit = warmupFactor < 1.0
            ? Math.max(account.warmupMinActions || 5, Math.floor(limitMessage * warmupFactor))
            : limitMessage;

        inviteBudget += accountInviteLimit;
        messageBudget += accountMessageLimit;
    }

    inviteBudget = Math.min(inviteBudget, weeklyRemaining);
    inviteBudget = applyHourIntensityToBudget(inviteBudget, hourIntensity);
    messageBudget = applyHourIntensityToBudget(messageBudget, hourIntensity);

    // WARMUP BYPASS: nessun invio email/connessioni
    const effectiveInviteBudget = workflow === 'warmup' ? 0 : inviteBudget;
    const effectiveMessageBudget = workflow === 'warmup' ? 0 : messageBudget;

    let queuedInviteJobs = 0;
    let queuedCheckJobs = 0;
    let queuedMessageJobs = 0;
    await syncLeadListsFromLeads();
    let listConfigs = await listLeadCampaignConfigs(true);
    if (listConfigs.length === 0) {
        await ensureLeadList('default');
        listConfigs = await listLeadCampaignConfigs(true);
    }
    const activeListNames = listConfigs.length > 0
        ? listConfigs.map((list) => list.name)
        : await resolveActiveLists();
    const listBreakdown = initListBreakdown(activeListNames);
    const listConfigMap = new Map(listConfigs.map((list) => [list.name, list]));
    const statusRows = await getLeadStatusCountsForLists(activeListNames);
    const listStatusCounts = new Map<string, Record<string, number>>();
    for (const row of statusRows) {
        const statusName = row.status === 'PENDING' ? 'READY_INVITE' : row.status;
        if (!listStatusCounts.has(row.list_name)) {
            listStatusCounts.set(row.list_name, {});
        }
        const target = listStatusCounts.get(row.list_name);
        if (!target) continue;
        target[statusName] = (target[statusName] ?? 0) + row.total;
    }
    const adaptiveContextMap = new Map<string, AdaptiveBudgetContext>();
    for (const listName of activeListNames) {
        const statusCounts = listStatusCounts.get(listName) ?? {};
        const context = evaluateAdaptiveBudgetContext(statusCounts, riskSnapshot.action);
        adaptiveContextMap.set(listName, context);
        const breakdown = listBreakdown.get(listName);
        if (breakdown) {
            breakdown.adaptiveFactor = context.factor;
            breakdown.adaptiveReasons = context.reasons;
            breakdown.pendingRatio = context.pendingRatio;
            breakdown.blockedRatio = context.blockedRatio;
        }
    }
    const noBurstPlanner = !dryRun && config.noBurstEnabled ? createNoBurstPlanner() : null;

    if (!dryRun && riskSnapshot.action !== 'STOP') {
        await promoteNewLeadsToReadyInvite(config.hardInviteCap * 4);
    }

    if (workflow === 'all' || workflow === 'invite') {
        let remainingInviteBudget = effectiveInviteBudget;
        for (const listName of activeListNames) {
            if (remainingInviteBudget <= 0) break;
            const breakdown = listBreakdown.get(listName);
            if (!breakdown) continue;

            const listConfig = listConfigMap.get(listName);
            const listInvitesSent = await getListDailyStat(localDate, listName, 'invites_sent');
            const rawListBudget = computeListBudget(remainingInviteBudget, listConfig?.dailyInviteCap ?? null, listInvitesSent);
            const adaptive = adaptiveContextMap.get(listName);
            const listBudget = applyAdaptiveFactor(rawListBudget, adaptive?.factor ?? 1);
            breakdown.inviteBudget = listBudget;
            if (listBudget <= 0) continue;

            if (dryRun) {
                const readyCandidates = await getLeadsByStatusForList('READY_INVITE', listName, listBudget);
                const newCandidates = await getLeadsByStatusForList('NEW', listName, listBudget);
                const candidateIds = new Set<number>();
                for (const lead of readyCandidates) candidateIds.add(lead.id);
                for (const lead of newCandidates) candidateIds.add(lead.id);
                const planned = Math.min(listBudget, candidateIds.size);
                breakdown.queuedInviteJobs += planned;
                queuedInviteJobs += planned;
                remainingInviteBudget -= planned;
                continue;
            }

            const inviteCandidates = await getLeadsByStatusForList('READY_INVITE', listName, listBudget);

            let insertedForList = 0;
            for (const lead of inviteCandidates) {
                const initialDelaySec = noBurstPlanner ? noBurstPlanner.nextDelaySec() : 0;
                const accountId = pickAccountIdForLead(lead.id);
                const inserted = await enqueueJob(
                    'INVITE',
                    { leadId: lead.id, localDate },
                    buildInviteKey(lead.id, localDate),
                    10,
                    config.retryMaxAttempts,
                    initialDelaySec,
                    accountId
                );
                if (inserted) {
                    insertedForList += 1;
                    queuedInviteJobs += 1;
                    breakdown.maxScheduledDelaySec = Math.max(breakdown.maxScheduledDelaySec, initialDelaySec);
                }
            }
            breakdown.queuedInviteJobs += insertedForList;
            remainingInviteBudget -= insertedForList;
        }
    }

    if (workflow === 'all' || workflow === 'check') {
        const checkLimitPerList = Math.max(25, config.hardInviteCap * 3);
        for (const listName of activeListNames) {
            const breakdown = listBreakdown.get(listName);
            if (!breakdown) continue;
            const invitedLeads = await getLeadsByStatusForList('INVITED', listName, checkLimitPerList);
            if (dryRun) {
                breakdown.queuedCheckJobs += invitedLeads.length;
                queuedCheckJobs += invitedLeads.length;
                continue;
            }

            let insertedForList = 0;
            for (const lead of invitedLeads) {
                const initialDelaySec = noBurstPlanner ? noBurstPlanner.nextDelaySec() : 0;
                const accountId = pickAccountIdForLead(lead.id);
                const inserted = await enqueueJob(
                    'ACCEPTANCE_CHECK',
                    { leadId: lead.id },
                    buildCheckKey(lead.id, localDate),
                    30,
                    config.retryMaxAttempts,
                    initialDelaySec,
                    accountId
                );
                if (inserted) {
                    insertedForList += 1;
                    queuedCheckJobs += 1;
                    breakdown.maxScheduledDelaySec = Math.max(breakdown.maxScheduledDelaySec, initialDelaySec);
                }
            }
            breakdown.queuedCheckJobs += insertedForList;
        }
    }

    if (workflow === 'all' || workflow === 'message') {
        let remainingMessageBudget = effectiveMessageBudget;
        for (const listName of activeListNames) {
            if (remainingMessageBudget <= 0) break;
            const breakdown = listBreakdown.get(listName);
            if (!breakdown) continue;

            const listConfig = listConfigMap.get(listName);
            const listMessagesSent = await getListDailyStat(localDate, listName, 'messages_sent');
            const rawListBudget = computeListBudget(remainingMessageBudget, listConfig?.dailyMessageCap ?? null, listMessagesSent);
            const adaptive = adaptiveContextMap.get(listName);
            const listBudget = applyAdaptiveFactor(rawListBudget, adaptive?.factor ?? 1);
            breakdown.messageBudget = listBudget;
            if (listBudget <= 0) continue;

            if (dryRun) {
                const accepted = await getLeadsByStatusForList('ACCEPTED', listName, listBudget);
                const readyToMessage = await getLeadsByStatusForList('READY_MESSAGE', listName, listBudget);
                const uniqueLeadIds = new Set<number>();
                for (const lead of accepted) uniqueLeadIds.add(lead.id);
                for (const lead of readyToMessage) uniqueLeadIds.add(lead.id);
                const planned = Math.min(listBudget, uniqueLeadIds.size);
                breakdown.queuedMessageJobs += planned;
                queuedMessageJobs += planned;
                remainingMessageBudget -= planned;
                continue;
            }

            const accepted = await getLeadsByStatusForList('ACCEPTED', listName, Math.max(50, listBudget));
            for (const lead of accepted) {
                await transitionLead(lead.id, 'READY_MESSAGE', 'scheduler_promote_to_ready_message');
            }
            const readyToMessage = await getLeadsByStatusForList('READY_MESSAGE', listName, listBudget);

            let insertedForList = 0;
            for (const lead of readyToMessage) {
                const acceptedAtDate = lead.accepted_at ? lead.accepted_at.slice(0, 10) : localDate;
                const minDelayHours = Math.max(0, config.messageScheduleMinDelayHours);
                const maxDelayHours = Math.max(minDelayHours, config.messageScheduleMaxDelayHours);
                let acceptanceDelaySec = 0;
                if (maxDelayHours > 0) {
                    const targetDelaySec = pickRandomInt(minDelayHours * 3600, maxDelayHours * 3600);
                    const acceptedAtMs = lead.accepted_at ? Date.parse(lead.accepted_at) : NaN;
                    const elapsedSec = Number.isFinite(acceptedAtMs)
                        ? Math.max(0, Math.floor((Date.now() - acceptedAtMs) / 1000))
                        : 0;
                    acceptanceDelaySec = Math.max(0, targetDelaySec - elapsedSec);
                }

                const noBurstDelaySec = noBurstPlanner ? noBurstPlanner.nextDelaySec() : 0;
                const initialDelaySec = acceptanceDelaySec + noBurstDelaySec;
                const accountId = pickAccountIdForLead(lead.id);
                const inserted = await enqueueJob(
                    'MESSAGE',
                    { leadId: lead.id, acceptedAtDate },
                    buildMessageKey(lead.id, acceptedAtDate),
                    20,
                    config.retryMaxAttempts,
                    initialDelaySec,
                    accountId
                );
                if (inserted) {
                    insertedForList += 1;
                    queuedMessageJobs += 1;
                    breakdown.maxScheduledDelaySec = Math.max(breakdown.maxScheduledDelaySec, initialDelaySec);
                }
            }
            breakdown.queuedMessageJobs += insertedForList;
            remainingMessageBudget -= insertedForList;
        }
    }

    if (!dryRun && config.withdrawInvitesEnabled && workflow !== 'warmup') {
        const accounts = await getRuntimeAccountProfiles();
        for (const acc of accounts) {
            await enqueueJob(
                'HYGIENE',
                { accountId: acc.id },
                `hygiene:${acc.id}:${localDate}`,
                5,
                1,
                pickRandomInt(1800, 14400),
                acc.id
            );
        }
    }

    return {
        localDate,
        riskSnapshot,
        inviteBudget: effectiveInviteBudget,
        messageBudget: effectiveMessageBudget,
        queuedInviteJobs,
        queuedCheckJobs,
        queuedMessageJobs,
        listBreakdown: Array.from(listBreakdown.values()),
        dryRun,
    };
}
