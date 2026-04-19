import { config, getLocalDateString, getWeekStartDate, getWorkingHourIntensity, isGreenModeWindow } from '../config';
import { randomInt } from '../utils/random';
import { getSessionBudgetFactor } from './sessionWarmer';
import { getSessionMaturity } from '../browser/sessionCookieMonitor';
import { applyGrowthModel, calculateAccountTrustScore } from '../risk/accountBehaviorModel';
import { getSessionHistory } from '../risk/sessionMemory';
import { getTodayStrategy } from '../risk/strategyPlanner';
import { pickAccountIdForLead, getRuntimeAccountProfiles } from '../accountManager';
import {
    calculateAccountWarmupMultiplier,
    calculateDynamicBudget,
    calculateDynamicWeeklyInviteLimit,
    evaluateRisk,
} from '../risk/riskEngine';
import { JobType, RiskSnapshot } from '../types/domain';
import { getTimingDecisionForLead, TimingAction } from '../ml/timingOptimizer';
import { computeTimezoneDelaySec } from '../ml/locationTimezone';
import {
    countWeeklyInvites,
    countTodayPosts,
    ensureLeadList,
    enqueueJob,
    getDailyStat,
    getLeadStatusCountsForLists,
    getLeadsByStatusForList,
    getLeadsNeedingEnrichment,
    getListDailyStatsBatch,
    getRuntimeFlag,
    getRiskInputs,
    isBlacklisted,
    listLeadCampaignConfigs,
    promoteNewLeadsToReadyInvite,
    syncLeadListsFromLeads,
    getAccountAgeDays,
    getAccountTrustInputs,
    hasOtherAccountTargeted,
    computeListPerformanceMultiplier,
} from './repositories';
import { transitionLead } from './leadStateService';
import type { WorkflowSelection } from './workflowSelection';

export interface ScheduleResult {
    localDate: string;
    riskSnapshot: RiskSnapshot;
    inviteBudget: number;
    messageBudget: number;
    weeklyInvitesSent: number;
    weeklyInviteLimitEffective: number;
    weeklyInvitesRemaining: number;
    queuedInviteJobs: number;
    queuedCheckJobs: number;
    queuedMessageJobs: number;
    listBreakdown: ListScheduleBreakdown[];
    dryRun: boolean;
    moodFactor?: number;
    ratioShift?: number;
}

export interface ScheduleOptions {
    dryRun?: boolean;
    /** Filtra solo lead di questa lista (null = tutte le liste attive) */
    listFilter?: string | null;
    /** Score minimo per inviti (default: 0 = nessun filtro) */
    minScore?: number;
    /** Limite massimo job per questa sessione (sovrascrive budget giornaliero) */
    sessionLimit?: number;
    /** Modalità nota invito: 'ai', 'template', 'none' */
    noteMode?: 'ai' | 'template' | 'none';
    /** Lingua preferita per AI generation (it, en, fr, es, nl) */
    lang?: string;
    /** Modalità messaggio: 'ai' (default) o 'template' (forza template senza AI) */
    messageMode?: 'ai' | 'template';
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
    if (workflow === 'all')
        return ['INVITE', 'ACCEPTANCE_CHECK', 'MESSAGE', 'HYGIENE', 'POST_CREATION', 'ENRICHMENT', 'INTERACTION'];
    if (workflow === 'invite') return ['INVITE'];
    if (workflow === 'check') return ['ACCEPTANCE_CHECK', 'HYGIENE'];
    if (workflow === 'warmup') return [];
    return ['MESSAGE', 'HYGIENE'];
}

/** @internal — exported for testing */
export function buildInviteKey(leadId: number, localDate: string): string {
    return `invite:${leadId}:${localDate}`;
}

/** @internal */
export function buildMessageKey(leadId: number, acceptedAtDate: string): string {
    return `message:${leadId}:${acceptedAtDate}`;
}

/** @internal */
export function buildCheckKey(leadId: number, localDate: string): string {
    return `check:${leadId}:${localDate}`;
}

/** @internal */
export function computeListBudget(globalRemaining: number, listCap: number | null, alreadyConsumed: number): number {
    const listRemaining = listCap === null ? globalRemaining : Math.max(0, listCap - alreadyConsumed);
    return Math.max(0, Math.min(globalRemaining, listRemaining));
}

/** @internal */
export function computeAccountBudgetShares(
    accounts: ReturnType<typeof getRuntimeAccountProfiles>,
    totalBudget: number,
    channel: 'invite' | 'message',
): Map<string, number> {
    const safeTotal = Math.max(0, Math.floor(totalBudget));
    const shares = new Map<string, number>();
    if (safeTotal <= 0) {
        for (const account of accounts) {
            shares.set(account.id, 0);
        }
        return shares;
    }
    if (accounts.length === 0) {
        shares.set('default', safeTotal);
        return shares;
    }

    const weighted = accounts.map((account) => {
        const rawWeight = channel === 'invite' ? account.inviteWeight : account.messageWeight;
        const weight = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 1;
        return { accountId: account.id, weight };
    });

    const weightTotal = weighted.reduce((sum, item) => sum + item.weight, 0);
    const base = weighted.map((item) => {
        const rawShare = safeTotal * (item.weight / Math.max(0.0001, weightTotal));
        const floorShare = Math.floor(rawShare);
        shares.set(item.accountId, floorShare);
        return {
            accountId: item.accountId,
            fractional: rawShare - floorShare,
        };
    });

    let distributed = Array.from(shares.values()).reduce((sum, value) => sum + value, 0);
    const leftovers = safeTotal - distributed;
    if (leftovers > 0) {
        const sorted = [...base].sort((a, b) => b.fractional - a.fractional);
        for (let index = 0; index < leftovers; index++) {
            const target = sorted[index % sorted.length];
            if (!target) break;
            shares.set(target.accountId, (shares.get(target.accountId) ?? 0) + 1);
        }
    }

    distributed = Array.from(shares.values()).reduce((sum, value) => sum + value, 0);
    if (distributed < safeTotal) {
        const first = accounts[0];
        if (first) {
            shares.set(first.id, (shares.get(first.id) ?? 0) + (safeTotal - distributed));
        }
    }

    return shares;
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

/** @internal */
export function toNonNegativeInt(value: number): number {
    return Math.max(0, Math.floor(value));
}

/** @internal */
export function clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
}

/** @internal */
export function applyAdaptiveFactor(rawBudget: number, factor: number): number {
    if (rawBudget <= 0 || factor <= 0) {
        return 0;
    }
    const computed = Math.floor(rawBudget * factor);
    if (computed <= 0) {
        return 1;
    }
    return Math.min(rawBudget, computed);
}

/** @internal */
export function clampInt(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(value)));
}

/** @internal */
export function parseSsiScore(rawValue: string | null, fallback: number): number {
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

/** @internal */
export function capFromSsi(score: number, minCap: number, maxCap: number): number {
    const low = Math.max(1, Math.min(minCap, maxCap));
    const high = Math.max(1, Math.max(minCap, maxCap));
    const ratio = Math.max(0, Math.min(1, score / 100));
    const cap = low + (high - low) * ratio;
    return clampInt(cap, low, high);
}

/** @internal */
export function resolveCapPair(
    staticSoft: number,
    staticHard: number,
    dynamicCap: number,
): { soft: number; hard: number } {
    const hard = Math.max(1, Math.min(staticHard, dynamicCap));
    const soft = Math.max(1, Math.min(staticSoft, hard));
    return { soft, hard };
}

/** @internal */
export function applyHourIntensityToBudget(budget: number, intensity: number): number {
    if (budget <= 0) return 0;
    if (intensity >= 0.999) return budget;
    if (intensity <= 0) return 0;
    const scaled = Math.floor(budget * intensity);
    if (scaled <= 0) return 1;
    return Math.min(budget, scaled);
}

/** @internal */
export function evaluateAdaptiveBudgetContext(
    statusCounts: Record<string, number>,
    riskAction: RiskSnapshot['action'],
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
    const acceptedLike =
        (statusCounts.ACCEPTED ?? 0) + (statusCounts.READY_MESSAGE ?? 0) + (statusCounts.MESSAGED ?? 0);
    // Tutti i lead che hanno ricevuto un invito (allineato con stats.ts getRiskInputs
    // che usa `invited_at IS NOT NULL` come denominatore globale — CC-4 fix).
    const everInvitedOutcome =
        acceptedLike + (statusCounts.REPLIED ?? 0) + (statusCounts.CONNECTED ?? 0) + (statusCounts.WITHDRAWN ?? 0);
    const blockedSkipped = (statusCounts.BLOCKED ?? 0) + (statusCounts.SKIPPED ?? 0);

    const pendingRatioDenominator = Math.max(1, invited + everInvitedOutcome);
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

/** @internal */
export function createNoBurstPlanner(): NoBurstPlanner {
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
            totalDelaySec += randomInt(minDelay, maxDelay);

            if (longBreakEvery > 0 && queuedJobs % longBreakEvery === 0) {
                totalDelaySec += randomInt(longBreakMin, longBreakMax);
            }

            return totalDelaySec;
        },
    };
}

async function resolveActiveLists(): Promise<string[]> {
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

export async function scheduleJobs(
    workflow: WorkflowSelection,
    options: ScheduleOptions = {},
): Promise<ScheduleResult> {
    const dryRun = options.dryRun ?? false;
    const localDate = getLocalDateString();
    const riskInputs = await getRiskInputs(localDate, config.hardInviteCap);
    const riskSnapshot = evaluateRisk(riskInputs);

    const dailyInvitesSent = await getDailyStat(localDate, 'invites_sent');
    const dailyMessagesSent = await getDailyStat(localDate, 'messages_sent');
    const weekStartDate = getWeekStartDate();
    const weeklyInvitesSent = await countWeeklyInvites(weekStartDate);
    const { countWeeklyMessages } = await import('./repositories/stats');
    const weeklyMessagesSent = await countWeeklyMessages(weekStartDate);
    const dbAccountAgeDays = await getAccountAgeDays();
    const weeklyInviteLimitEffective = config.complianceDynamicWeeklyLimitEnabled
        ? calculateDynamicWeeklyInviteLimit(
              dbAccountAgeDays,
              config.complianceDynamicWeeklyMinInvites,
              Math.min(config.complianceDynamicWeeklyMaxInvites, config.weeklyInviteLimit),
              config.complianceDynamicWeeklyWarmupDays,
          )
        : config.weeklyInviteLimit;
    const weeklyRemaining = Math.max(0, weeklyInviteLimitEffective - weeklyInvitesSent);
    const ssiRaw = config.ssiDynamicLimitsEnabled ? await getRuntimeFlag(config.ssiStateKey) : null;
    const ssiScore = parseSsiScore(ssiRaw, config.ssiDefaultScore);
    const ssiInviteCap = config.ssiDynamicLimitsEnabled
        ? capFromSsi(ssiScore, config.ssiInviteMin, config.ssiInviteMax)
        : config.softInviteCap;
    const ssiMessageCap = config.ssiDynamicLimitsEnabled
        ? capFromSsi(ssiScore, config.ssiMessageMin, config.ssiMessageMax)
        : config.softMsgCap;
    const hourIntensity = getWorkingHourIntensity();

    const accounts = getRuntimeAccountProfiles();

    let inviteBudget = 0;
    let messageBudget = 0;

    // Trust Score (1.3 fix): query globale FUORI dal loop account.
    // acceptance rate, challenges 7d e pending ratio sono condivisi tra account —
    // non serve ricalcolarli per ogni account (evita N query identiche).
    const trustInputs = await getAccountTrustInputs(ssiScore, dbAccountAgeDays);
    const trustResult = calculateAccountTrustScore(trustInputs);

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

        const limitInvite = calculateDynamicBudget(
            inviteCaps.soft,
            inviteCaps.hard,
            avgDailyInvites,
            riskSnapshot.action,
        );
        const limitMessage = calculateDynamicBudget(
            messageCaps.soft,
            messageCaps.hard,
            avgDailyMessages,
            riskSnapshot.action,
        );

        let accountInviteLimit =
            warmupFactor < 1.0
                ? Math.max(account.warmupMinActions || 5, Math.floor(limitInvite * warmupFactor))
                : limitInvite;

        let accountMessageLimit =
            warmupFactor < 1.0
                ? Math.max(account.warmupMinActions || 5, Math.floor(limitMessage * warmupFactor))
                : limitMessage;

        // Growth model: cap per-account budget based on account age phase
        const growthResult = applyGrowthModel(accountInviteLimit, accountMessageLimit, ageDays);
        accountInviteLimit = growthResult.inviteBudget;
        accountMessageLimit = growthResult.messageBudget;

        // Trust Score (1.3): applica il multiplier calcolato fuori dal loop
        if (trustResult.budgetMultiplier < 1.0) {
            accountInviteLimit = Math.max(1, Math.floor(accountInviteLimit * trustResult.budgetMultiplier));
            accountMessageLimit = Math.max(1, Math.floor(accountMessageLimit * trustResult.budgetMultiplier));
        }

        inviteBudget += accountInviteLimit;
        messageBudget += accountMessageLimit;
    }

    inviteBudget = Math.min(inviteBudget, weeklyRemaining);
    const weeklyMessageRemaining = Math.max(0, config.weeklyMessageLimit - weeklyMessagesSent);
    messageBudget = Math.min(messageBudget, weeklyMessageRemaining);
    inviteBudget = applyHourIntensityToBudget(inviteBudget, hourIntensity);
    messageBudget = applyHourIntensityToBudget(messageBudget, hourIntensity);
    if (isGreenModeWindow()) {
        inviteBudget = applyHourIntensityToBudget(inviteBudget, config.greenModeBudgetFactor);
        messageBudget = applyHourIntensityToBudget(messageBudget, config.greenModeBudgetFactor);
    }

    // Two-session mode: halve budget per session, zero during gap
    const sessionFactor = getSessionBudgetFactor();
    if (sessionFactor < 1.0) {
        inviteBudget = applyHourIntensityToBudget(inviteBudget, sessionFactor);
        messageBudget = applyHourIntensityToBudget(messageBudget, sessionFactor);
    }

    // Cookie maturity: fresh sessions get reduced budget to avoid detection
    const maturityFactors = accounts.map((acc) => getSessionMaturity(acc.sessionDir).budgetFactor);
    const worstMaturityFactor = maturityFactors.length > 0 ? Math.min(...maturityFactors) : 1.0;
    if (worstMaturityFactor < 1.0) {
        inviteBudget = applyHourIntensityToBudget(inviteBudget, worstMaturityFactor);
        messageBudget = applyHourIntensityToBudget(messageBudget, worstMaturityFactor);
    }

    // Session memory: modulate budget based on recent behavioral history
    const primaryAccountId = accounts[0]?.id || 'default';
    const sessionHistory = await getSessionHistory(primaryAccountId, 7);
    if (sessionHistory.daysWithActivity > 0 && sessionHistory.pacingFactor < 1.0) {
        inviteBudget = applyHourIntensityToBudget(inviteBudget, sessionHistory.pacingFactor);
        messageBudget = applyHourIntensityToBudget(messageBudget, sessionHistory.pacingFactor);
    }

    // Weekly strategy: per-day-of-week activity multipliers
    const todayStrategy = getTodayStrategy();
    if (todayStrategy.inviteFactor < 1.0) {
        inviteBudget = applyHourIntensityToBudget(inviteBudget, todayStrategy.inviteFactor);
    } else if (todayStrategy.inviteFactor > 1.0) {
        inviteBudget = Math.floor(inviteBudget * todayStrategy.inviteFactor);
    }
    if (todayStrategy.messageFactor < 1.0) {
        messageBudget = applyHourIntensityToBudget(messageBudget, todayStrategy.messageFactor);
    } else if (todayStrategy.messageFactor > 1.0) {
        messageBudget = Math.floor(messageBudget * todayStrategy.messageFactor);
    }

    // Daily mood factor: varianza ±20% giornaliera sul budget per evitare durata sessione costante.
    // Un umano ha giorni dove fa di più e giorni dove fa di meno — la media settimanale resta uguale.
    // Il factor è deterministico per data (stessa giornata = stesso factor) ma diverso tra giorni.
    // Usa due seed separati: uno per il volume complessivo, uno per lo sbilancio invite/message.
    const moodSeed = `mood:${localDate}`;
    let moodHash = 0x811c9dc5;
    for (let i = 0; i < moodSeed.length; i++) {
        moodHash ^= moodSeed.charCodeAt(i);
        moodHash = Math.imul(moodHash, 0x01000193);
    }
    const moodFactor = 0.8 + ((moodHash >>> 0) % 41) / 100; // range [0.80, 1.20]

    // Ratio mood: sbilancia invite vs message indipendentemente.
    // Es. oggi "mood inviti" (invite ×1.15, message ×0.85), domani il contrario.
    const ratioSeed = `ratio:${localDate}`;
    let ratioHash = 0x811c9dc5;
    for (let i = 0; i < ratioSeed.length; i++) {
        ratioHash ^= ratioSeed.charCodeAt(i);
        ratioHash = Math.imul(ratioHash, 0x01000193);
    }
    const ratioShift = -0.15 + ((ratioHash >>> 0) % 31) / 100; // range [-0.15, +0.15]
    const inviteMoodFactor = moodFactor + ratioShift;
    const messageMoodFactor = moodFactor - ratioShift;

    inviteBudget = inviteBudget > 0 ? Math.max(1, Math.round(inviteBudget * inviteMoodFactor)) : 0;
    messageBudget = messageBudget > 0 ? Math.max(1, Math.round(messageBudget * messageMoodFactor)) : 0;

    // Session limit: cap budget per singola sessione workflow
    if (options.sessionLimit !== null && options.sessionLimit !== undefined && options.sessionLimit > 0) {
        inviteBudget = Math.min(inviteBudget, options.sessionLimit);
        messageBudget = Math.min(messageBudget, options.sessionLimit);
    }

    // WARMUP BYPASS: nessun invio email/connessioni
    const effectiveInviteBudget = workflow === 'warmup' ? 0 : inviteBudget;
    const effectiveMessageBudget = workflow === 'warmup' ? 0 : messageBudget;
    const accountInviteRemaining = computeAccountBudgetShares(accounts, effectiveInviteBudget, 'invite');
    const accountMessageRemaining = computeAccountBudgetShares(accounts, effectiveMessageBudget, 'message');

    let queuedInviteJobs = 0;
    let queuedCheckJobs = 0;
    let queuedMessageJobs = 0;
    await syncLeadListsFromLeads();
    let listConfigs = await listLeadCampaignConfigs(true);
    if (listConfigs.length === 0) {
        await ensureLeadList('default');
        listConfigs = await listLeadCampaignConfigs(true);
    }
    let activeListNames = listConfigs.length > 0 ? listConfigs.map((list) => list.name) : await resolveActiveLists();
    if (options.listFilter) {
        const filterName = options.listFilter;
        activeListNames = activeListNames.filter((name) => name === filterName);
        if (activeListNames.length === 0) {
            // Lista filtrata non trovata tra le attive — aggiungi comunque
            activeListNames = [filterName];
        }
    }
    const listBreakdown = initListBreakdown(activeListNames);
    const listConfigMap = new Map(listConfigs.map((list) => [list.name, list]));
    const statusRows = await getLeadStatusCountsForLists(activeListNames);
    const listStatusCounts = new Map<string, Record<string, number>>();
    for (const row of statusRows) {
        const statusName = row.status;
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

    async function resolveTimingDecision(action: TimingAction, jobTitle: string | null | undefined) {
        if (dryRun) {
            return {
                action,
                strategy: 'baseline' as const,
                segment: 'unknown' as const,
                delaySec: 0,
                score: 0,
                sampleSize: 0,
                slot: null,
                explored: false,
                reason: 'insufficient_data' as const,
                model: 'timing_optimizer_v2',
            };
        }
        return getTimingDecisionForLead(action, jobTitle);
    }

    if (!dryRun && riskSnapshot.action !== 'STOP') {
        try {
            await promoteNewLeadsToReadyInvite(config.hardInviteCap * 4);
        } catch (e) {
            console.error('[SCHEDULER] promoteNewLeadsToReadyInvite failed:', e instanceof Error ? e.message : e);
        }
    }

    if (workflow === 'all' || workflow === 'invite') {
        const inviteStatsMap = await getListDailyStatsBatch(localDate, 'invites_sent');
        let remainingInviteBudget = effectiveInviteBudget;
        for (const listName of activeListNames) {
            if (remainingInviteBudget <= 0) break;
            const breakdown = listBreakdown.get(listName);
            if (!breakdown) continue;

            // Circuit Breaker Per-Lista (6.6): se la lista ha un circuit break attivo, skip.
            // Le liste con errori ricorrenti vengono isolate senza fermare le altre.
            const listCbFlag = await getRuntimeFlag(`cb::list::${listName}`).catch(() => null);
            if (listCbFlag) {
                const cbExpiry = parseInt(listCbFlag, 10);
                if (cbExpiry > Date.now()) {
                    breakdown.inviteBudget = 0;
                    continue;
                }
            }

            const listConfig = listConfigMap.get(listName);
            const listInvitesSent = inviteStatsMap.get(listName) ?? 0;
            const rawListBudget = computeListBudget(
                remainingInviteBudget,
                listConfig?.dailyInviteCap ?? null,
                listInvitesSent,
            );
            const adaptive = adaptiveContextMap.get(listName);
            let listBudget = applyAdaptiveFactor(rawListBudget, adaptive?.factor ?? 1);

            // Outcome-Driven Budget (2.1): modula budget in base all'acceptance rate storico.
            // Liste con bassa acceptance ricevono meno budget → auto-throttle qualità scarsa.
            const listPerf = await computeListPerformanceMultiplier(listName, 30);
            if (listPerf.multiplier !== 1.0 && listPerf.sampleSize >= 5) {
                listBudget = Math.max(1, Math.floor(listBudget * listPerf.multiplier));
            }

            breakdown.inviteBudget = listBudget;
            if (listBudget <= 0) continue;

            if (dryRun) {
                const readyCandidates = await getLeadsByStatusForList(
                    'READY_INVITE',
                    listName,
                    listBudget,
                    options.minScore,
                );
                const newCandidates = await getLeadsByStatusForList('NEW', listName, listBudget);
                const orderedCandidates = [...readyCandidates, ...newCandidates];
                const seenLeadIds = new Set<number>();
                let planned = 0;
                for (const lead of orderedCandidates) {
                    if (seenLeadIds.has(lead.id)) continue;
                    seenLeadIds.add(lead.id);
                    const accountId = pickAccountIdForLead(lead.id);
                    const remainingForAccount = accountInviteRemaining.get(accountId) ?? 0;
                    if (remainingForAccount <= 0) continue;
                    accountInviteRemaining.set(accountId, remainingForAccount - 1);
                    planned += 1;
                    if (planned >= listBudget) break;
                }
                breakdown.queuedInviteJobs += planned;
                queuedInviteJobs += planned;
                remainingInviteBudget -= planned;
                continue;
            }

            const rawCandidates = await getLeadsByStatusForList('READY_INVITE', listName, listBudget, options.minScore);

            // Acceptance Probability Model: riordina i candidati per P(acceptance) composito
            // invece del semplice lead_score. Lead con alta probabilità di accettazione → prima.
            // Riduce il pending ratio alla fonte (prevenzione, non cura).
            let inviteCandidates = rawCandidates;
            try {
                const { predictAcceptanceBatch } = await import('../ml/acceptanceProbability');
                const predictions = await predictAcceptanceBatch(rawCandidates);
                const predMap = new Map(predictions.map((p) => [p.leadId, p.compositeScore]));
                inviteCandidates = [...rawCandidates].sort((a, b) => {
                    const scoreA = predMap.get(a.id) ?? a.lead_score ?? 0;
                    const scoreB = predMap.get(b.id) ?? b.lead_score ?? 0;
                    return scoreB - scoreA;
                });
            } catch (mlErr) {
                // Fallback: usa ordine originale (lead_score DESC) se il modello fallisce
                console.warn(
                    '[SCHEDULER] ML predictAcceptanceBatch fallito, fallback a lead_score:',
                    mlErr instanceof Error ? mlErr.message : String(mlErr),
                );
            }

            let insertedForList = 0;
            for (const lead of inviteCandidates) {
                // ── Blacklist check preventivo: skip lead in blacklist ──
                if (await isBlacklisted(lead.linkedin_url, lead.company_domain)) {
                    continue;
                }
                const accountId = pickAccountIdForLead(lead.id);
                const remainingForAccount = accountInviteRemaining.get(accountId) ?? 0;
                if (remainingForAccount <= 0) {
                    continue;
                }
                // Multi-Account Deconfliction (1.4): skip lead se un altro account
                // lo ha già targetizzato negli ultimi 30 giorni — previene detection coordinamento.
                if (accounts.length > 1) {
                    const alreadyTargeted = await hasOtherAccountTargeted(lead.linkedin_url, accountId, 30);
                    if (alreadyTargeted) {
                        continue;
                    }
                }

                const noBurstDelaySec = noBurstPlanner ? noBurstPlanner.nextDelaySec() : 0;
                const timingDecision = await resolveTimingDecision('invite', lead.job_title);
                const timezoneDelaySec = computeTimezoneDelaySec(lead.location);
                const initialDelaySec = noBurstDelaySec + timingDecision.delaySec + timezoneDelaySec;
                const invitePayload: Record<string, unknown> = {
                    leadId: lead.id,
                    localDate,
                    timing: {
                        strategy: timingDecision.strategy,
                        segment: timingDecision.segment,
                        score: timingDecision.score,
                        sampleSize: timingDecision.sampleSize,
                        slotHour: timingDecision.slot?.hour ?? null,
                        slotDow: timingDecision.slot?.dayOfWeek ?? null,
                        delaySec: timingDecision.delaySec,
                        reason: timingDecision.reason,
                        model: timingDecision.model,
                        explored: timingDecision.explored,
                    },
                };
                if (options.noteMode) {
                    invitePayload.metadata_json = JSON.stringify({ noteMode: options.noteMode });
                }
                // R07: priorità 30 — gli inviti sono ULTIMI tra i job outreach.
                // Ordine: HYGIENE(5) → ACCEPTANCE_CHECK(10) → MESSAGE(20) → INVITE(30)
                const inserted = await enqueueJob(
                    'INVITE',
                    invitePayload,
                    buildInviteKey(lead.id, localDate),
                    30,
                    config.retryMaxAttempts,
                    initialDelaySec,
                    accountId,
                );
                if (inserted) {
                    insertedForList += 1;
                    queuedInviteJobs += 1;
                    accountInviteRemaining.set(accountId, remainingForAccount - 1);
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
                // R07: priorità 10 — acceptance check PRIMA di message e invite.
                // Scopre chi ha accettato → abilita MESSAGE ai lead appena accettati.
                const inserted = await enqueueJob(
                    'ACCEPTANCE_CHECK',
                    { leadId: lead.id },
                    buildCheckKey(lead.id, localDate),
                    10,
                    config.retryMaxAttempts,
                    initialDelaySec,
                    accountId,
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
        const messageStatsMap = await getListDailyStatsBatch(localDate, 'messages_sent');
        let remainingMessageBudget = effectiveMessageBudget;
        for (const listName of activeListNames) {
            if (remainingMessageBudget <= 0) break;
            const breakdown = listBreakdown.get(listName);
            if (!breakdown) continue;

            const listConfig = listConfigMap.get(listName);
            const listMessagesSent = messageStatsMap.get(listName) ?? 0;
            const rawListBudget = computeListBudget(
                remainingMessageBudget,
                listConfig?.dailyMessageCap ?? null,
                listMessagesSent,
            );
            const adaptive = adaptiveContextMap.get(listName);
            const listBudget = applyAdaptiveFactor(rawListBudget, adaptive?.factor ?? 1);
            breakdown.messageBudget = listBudget;
            if (listBudget <= 0) continue;

            if (dryRun) {
                const accepted = await getLeadsByStatusForList('ACCEPTED', listName, listBudget);
                const readyToMessage = await getLeadsByStatusForList('READY_MESSAGE', listName, listBudget);
                const orderedCandidates = [...accepted, ...readyToMessage];
                const uniqueLeadIds = new Set<number>();
                let planned = 0;
                for (const lead of orderedCandidates) {
                    if (uniqueLeadIds.has(lead.id)) continue;
                    uniqueLeadIds.add(lead.id);
                    const accountId = pickAccountIdForLead(lead.id);
                    const remainingForAccount = accountMessageRemaining.get(accountId) ?? 0;
                    if (remainingForAccount <= 0) continue;
                    accountMessageRemaining.set(accountId, remainingForAccount - 1);
                    planned += 1;
                    if (planned >= listBudget) break;
                }
                breakdown.queuedMessageJobs += planned;
                queuedMessageJobs += planned;
                remainingMessageBudget -= planned;
                continue;
            }

            const accepted = await getLeadsByStatusForList('ACCEPTED', listName, Math.max(50, listBudget));
            for (const lead of accepted) {
                await transitionLead(lead.id, 'READY_MESSAGE', 'scheduler_promote_to_ready_message');

                // Engagement-Before-Message: schedula LIKE_POST prima del messaggio.
                // Un umano che ha appena accettato un invito spesso vede i post della persona
                // nei giorni successivi. Like 1-2 post crea "pre-riscaldamento relazionale".
                if (!dryRun && config.engagementBeforeMessageEnabled !== false) {
                    try {
                        const engagementDelaySec = randomInt(12 * 3600, 36 * 3600); // 12-36h dopo acceptance
                        await enqueueJob(
                            'INTERACTION',
                            { leadId: lead.id, actionType: 'LIKE_POST' },
                            `engagement_pre_msg:${lead.id}:${localDate}`,
                            15, // priorità tra check (10) e message (20)
                            1, // 1 solo tentativo — best-effort
                            engagementDelaySec,
                            pickAccountIdForLead(lead.id),
                        );
                    } catch {
                        // Best-effort: se enqueue fallisce, il messaggio parte comunque
                    }
                }
            }
            const readyToMessage = await getLeadsByStatusForList('READY_MESSAGE', listName, listBudget);

            let insertedForList = 0;
            for (const lead of readyToMessage) {
                // ── Blacklist check preventivo: skip lead in blacklist ──
                if (await isBlacklisted(lead.linkedin_url, lead.company_domain)) {
                    continue;
                }
                const accountId = pickAccountIdForLead(lead.id);
                const remainingForAccount = accountMessageRemaining.get(accountId) ?? 0;
                if (remainingForAccount <= 0) {
                    continue;
                }
                const acceptedAtDate = lead.accepted_at ? lead.accepted_at.slice(0, 10) : localDate;
                const minDelayHours = Math.max(0, config.messageScheduleMinDelayHours);
                const maxDelayHours = Math.max(minDelayHours, config.messageScheduleMaxDelayHours);
                let acceptanceDelaySec = 0;
                if (maxDelayHours > 0) {
                    const targetDelaySec = randomInt(minDelayHours * 3600, maxDelayHours * 3600);
                    const acceptedAtMs = lead.accepted_at ? Date.parse(lead.accepted_at) : NaN;
                    const elapsedSec = Number.isFinite(acceptedAtMs)
                        ? Math.max(0, Math.floor((Date.now() - acceptedAtMs) / 1000))
                        : 0;
                    acceptanceDelaySec = Math.max(0, targetDelaySec - elapsedSec);
                }

                const noBurstDelaySec = noBurstPlanner ? noBurstPlanner.nextDelaySec() : 0;
                const timingDecision = await resolveTimingDecision('message', lead.job_title);
                const initialDelaySec = acceptanceDelaySec + noBurstDelaySec + timingDecision.delaySec;
                const messagePayload: Record<string, unknown> = {
                    leadId: lead.id,
                    acceptedAtDate,
                    timing: {
                        strategy: timingDecision.strategy,
                        segment: timingDecision.segment,
                        score: timingDecision.score,
                        sampleSize: timingDecision.sampleSize,
                        slotHour: timingDecision.slot?.hour ?? null,
                        slotDow: timingDecision.slot?.dayOfWeek ?? null,
                        delaySec: timingDecision.delaySec,
                        reason: timingDecision.reason,
                        model: timingDecision.model,
                        explored: timingDecision.explored,
                    },
                };
                const msgMeta: Record<string, string> = {};
                if (options.lang) msgMeta.lang = options.lang;
                if (options.messageMode === 'template') msgMeta.messageMode = 'template';
                if (Object.keys(msgMeta).length > 0) {
                    messagePayload.metadata_json = JSON.stringify(msgMeta);
                }
                const inserted = await enqueueJob(
                    'MESSAGE',
                    messagePayload,
                    buildMessageKey(lead.id, acceptedAtDate),
                    20,
                    config.retryMaxAttempts,
                    initialDelaySec,
                    accountId,
                );
                if (inserted) {
                    insertedForList += 1;
                    queuedMessageJobs += 1;
                    accountMessageRemaining.set(accountId, remainingForAccount - 1);
                    breakdown.maxScheduledDelaySec = Math.max(breakdown.maxScheduledDelaySec, initialDelaySec);
                }
            }
            breakdown.queuedMessageJobs += insertedForList;
            remainingMessageBudget -= insertedForList;
        }
    }

    if (!dryRun && config.withdrawInvitesEnabled && workflow !== 'warmup') {
        const hygieneAccounts = getRuntimeAccountProfiles();
        for (const acc of hygieneAccounts) {
            await enqueueJob(
                'HYGIENE',
                { accountId: acc.id },
                `hygiene:${acc.id}:${localDate}`,
                5,
                1,
                randomInt(1800, 14400),
                acc.id,
            );
        }
    }

    // ─── Post Creation Scheduling ────────────────────────────────────────
    if (!dryRun && config.postCreationEnabled && workflow === 'all' && riskSnapshot.action !== 'STOP') {
        const postAccounts = getRuntimeAccountProfiles();
        for (const acc of postAccounts) {
            const todayPosts = await countTodayPosts(acc.id);
            if (todayPosts < config.postCreationMaxPerDay) {
                await enqueueJob(
                    'POST_CREATION',
                    {
                        accountId: acc.id,
                        tone: config.postCreationDefaultTone,
                    },
                    `post_creation:${acc.id}:${localDate}`,
                    1,
                    2,
                    randomInt(3600, 10800),
                    acc.id,
                );
            }
        }
    }

    // ─── Enrichment Scheduling ────────────────────────────────────────────
    if (!dryRun && (workflow === 'all' || workflow === 'invite') && riskSnapshot.action !== 'STOP') {
        const enrichAccounts = getRuntimeAccountProfiles();
        const primaryAccountId = enrichAccounts[0]?.id ?? 'default';

        // M19: Search query rate limit — enforce 30% safety margin.
        // LinkedIn allows ~300 search/enrichment queries per day. At 17% margin (250/day),
        // there is little buffer. Increase to 30% margin → cap at 200/day.
        // Dynamic: if risk score is elevated (>40), reduce further to 140/day (~53% margin).
        const ENRICHMENT_DAILY_HARD_CAP = riskSnapshot.score > 40 ? 140 : 200;
        const enrichmentCountKey = `enrichment_count:${localDate}`;
        const enrichmentDoneRaw = await getRuntimeFlag(enrichmentCountKey).catch(() => '0');
        const enrichmentDoneToday = parseInt(enrichmentDoneRaw ?? '0', 10) || 0;
        const enrichmentRemaining = Math.max(0, ENRICHMENT_DAILY_HARD_CAP - enrichmentDoneToday);

        // Per-run limit: 50 candidates max, further bounded by remaining daily quota
        const enrichCandidates = await getLeadsNeedingEnrichment(Math.min(50, enrichmentRemaining));
        for (const lead of enrichCandidates) {
            await enqueueJob(
                'ENRICHMENT',
                { leadId: lead.id },
                `enrichment:${lead.id}:${localDate}`,
                1,
                2,
                randomInt(300, 3600),
                primaryAccountId,
            );
        }
    }

    return {
        localDate,
        riskSnapshot,
        inviteBudget: effectiveInviteBudget,
        messageBudget: effectiveMessageBudget,
        weeklyInvitesSent,
        weeklyInviteLimitEffective,
        weeklyInvitesRemaining: weeklyRemaining,
        queuedInviteJobs,
        queuedCheckJobs,
        queuedMessageJobs,
        listBreakdown: Array.from(listBreakdown.values()),
        dryRun,
        moodFactor: Math.round(inviteMoodFactor * 100) / 100,
        ratioShift: Math.round(ratioShift * 100) / 100,
    };
}
