/**
 * adminCommands.ts — Comandi CLI di amministrazione del bot
 *
 * status, pause, resume, unquarantine, incident-resolve, privacy-cleanup, db-backup
 */

import { config } from '../../config';
import { getLocalDateString, isGreenModeWindow } from '../../config';
import { backupDatabase } from '../../db';
import {
    cleanupPrivacyData,
    countCompanyTargets,
    getAutomationPauseState,
    getAiQualitySnapshot,
    getDailyStatsSnapshot,
    getOperationalObservabilitySnapshot,
    getJobStatusCounts,
    listSecretRotationStatus,
    getRuntimeFlag,
    getRuntimeLock,
    listLatestAccountHealthSnapshots,
    listCompanyTargets,
    listLeadCampaignConfigs,
    listOpenIncidents,
    resolveIncident,
    runAiValidationPipeline,
    clearAutomationPause as clearPauseState,
    setAutomationPause,
    upsertSecretRotation,
    updateLeadCampaignConfig,
} from '../../core/repositories';
import { setQuarantine } from '../../risk/incidentManager';
import { getEventSyncStatus } from '../../sync/eventSync';
import { getRuntimeAccountProfiles } from '../../accountManager';
import { getProxyPoolStatus } from '../../proxyManager';
import { isOpenAIConfigured } from '../../ai/openaiClient';
import {
    getOptionValue,
    hasOption,
    parseBoolStrict,
    parseIntStrict,
    parseNullableCap,
    parsePauseMinutes,
    getPositionalArgs,
} from '../cliParser';

const WORKFLOW_RUNNER_LOCK_KEY = 'workflow.runner';
const AUTO_SITE_CHECK_LAST_RUN_KEY = 'site_check.last_run_at';
const SALESNAV_LAST_SYNC_KEY = 'salesnav.last_sync_at';

// ─── Command handlers ─────────────────────────────────────────────────────────

export async function runStatusCommand(): Promise<void> {
    const localDate = getLocalDateString();
    const [
        quarantineFlag,
        pauseState,
        incidents,
        jobStatusCounts,
        dailyStats,
        syncStatus,
        runnerLock,
        autoSiteCheckLastRunAt,
        salesNavSyncLastRunAt,
        latestAccountHealth,
        secretRotationStatus,
    ] = await Promise.all([
        getRuntimeFlag('account_quarantine'),
        getAutomationPauseState(),
        listOpenIncidents(),
        getJobStatusCounts(),
        getDailyStatsSnapshot(localDate),
        getEventSyncStatus(),
        getRuntimeLock(WORKFLOW_RUNNER_LOCK_KEY),
        getRuntimeFlag(AUTO_SITE_CHECK_LAST_RUN_KEY),
        getRuntimeFlag(SALESNAV_LAST_SYNC_KEY),
        listLatestAccountHealthSnapshots(20),
        listSecretRotationStatus(config.securitySecretMaxAgeDays, config.securitySecretWarnDays),
    ]);

    const payload = {
        localDate,
        quarantine: quarantineFlag === 'true',
        accounts: getRuntimeAccountProfiles().map((account) => ({
            id: account.id,
            sessionDir: account.sessionDir,
            dedicatedProxy: !!account.proxy,
        })),
        pause: pauseState,
        openIncidents: incidents.length,
        jobs: jobStatusCounts,
        proxy: getProxyPoolStatus(),
        dailyStats,
        sync: syncStatus,
        runnerLock,
        autoSiteCheck: {
            enabled: config.autoSiteCheckEnabled,
            fix: config.autoSiteCheckFix,
            limitPerStatus: config.autoSiteCheckLimit,
            intervalHours: config.autoSiteCheckIntervalHours,
            staleDays: config.siteCheckStaleDays,
            lastRunAt: autoSiteCheckLastRunAt,
        },
        stateSync: {
            postRunEnabled: config.postRunStateSyncEnabled,
            postRunLimit: config.postRunStateSyncLimit,
            postRunFix: config.postRunStateSyncFix,
        },
        salesNavSync: {
            enabled: config.salesNavSyncEnabled,
            listName: config.salesNavSyncListName,
            listUrlConfigured: !!config.salesNavSyncListUrl.trim(),
            maxPages: config.salesNavSyncMaxPages,
            intervalHours: config.salesNavSyncIntervalHours,
            limitPerList: config.salesNavSyncLimit,
            accountId: config.salesNavSyncAccountId || null,
            lastRunAt: salesNavSyncLastRunAt,
        },
        randomActivity: {
            enabled: config.randomActivityEnabled,
            probability: config.randomActivityProbability,
            maxActions: config.randomActivityMaxActions,
        },
        observability: await getOperationalObservabilitySnapshot(localDate),
        accountHealth: latestAccountHealth,
        secretRotation: {
            maxAgeDays: config.securitySecretMaxAgeDays,
            warnDays: config.securitySecretWarnDays,
            summary: secretRotationStatus.reduce<Record<string, number>>((acc, row) => {
                acc[row.status] = (acc[row.status] ?? 0) + 1;
                return acc;
            }, {}),
            rows: secretRotationStatus,
        },
        rampUp: {
            enabled: config.rampUpEnabled,
            dailyIncrease: config.rampUpDailyIncrease,
            maxCap: config.rampUpMaxCap,
        },
        greenMode: {
            enabled: config.greenModeEnabled,
            activeNow: isGreenModeWindow(),
            startHour: config.greenModeStartHour,
            endHour: config.greenModeEndHour,
            budgetFactor: config.greenModeBudgetFactor,
            intervalMultiplier: config.greenModeIntervalMultiplier,
            aiGreenModel: config.aiGreenModel,
        },
        ai: {
            personalizationEnabled: config.aiPersonalizationEnabled,
            sentimentEnabled: config.aiSentimentEnabled,
            guardianEnabled: config.aiGuardianEnabled,
            model: config.aiModel,
            openaiConfigured: isOpenAIConfigured(),
            guardianMinIntervalMinutes: config.aiGuardianMinIntervalMinutes,
            guardianPauseMinutes: config.aiGuardianPauseMinutes,
        },
    };
    console.log(JSON.stringify(payload, null, 2));
}

export async function runPauseCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const minutesRaw = getOptionValue(args, '--minutes') ?? positional[0];
    const reasonRaw = getOptionValue(args, '--reason') ?? (positional.length > 1 ? positional.slice(1).join(' ') : 'manual_pause');

    const minutes = minutesRaw
        ? parsePauseMinutes(minutesRaw, '--minutes')
        : config.autoPauseMinutesOnFailureBurst;
    const pausedUntil = await setAutomationPause(minutes, reasonRaw);
    const renderedUntil = pausedUntil ?? 'manual resume';
    console.log(`Automazione in pausa.pausedUntil=${renderedUntil} reason = ${reasonRaw} `);
}

export async function runResumeCommand(): Promise<void> {
    await clearPauseState();
    console.log('Pausa automazione rimossa.');
}

export async function runUnquarantineCommand(): Promise<void> {
    await setQuarantine(false);
    await clearPauseState();
    console.log('Quarantine disattivata e pausa rimossa.');
}

export async function runResolveIncidentCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const idRaw = getOptionValue(args, '--id') ?? positional[0];
    if (!idRaw) {
        throw new Error('Specifica ID incidente: npm start -- incident-resolve <id>');
    }
    const incidentId = parseIntStrict(idRaw, '--id');
    if (incidentId < 1) {
        throw new Error('--id deve essere >= 1');
    }
    await resolveIncident(incidentId);
    console.log(`Incidente ${incidentId} risolto.`);
}

export async function runPrivacyCleanupCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const daysRaw = getOptionValue(args, '--days') ?? positional[0];
    const days = daysRaw ? Math.max(7, parseIntStrict(daysRaw, '--days')) : config.retentionDays;
    const result = await cleanupPrivacyData(days);
    console.log(JSON.stringify({ retentionDays: days, ...result }, null, 2));
}

export async function runDbBackupCommand(): Promise<void> {
    console.log('Avvio backup database manuale...');
    try {
        const backupPath = await backupDatabase();
        console.log(`Backup completato con successo.File salvato in: ${backupPath} `);
    } catch (e) {
        console.error('Errore durante il backup del database:', e);
    }
}

export async function runCompanyTargetsCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const listName = getOptionValue(args, '--list') ?? positional[0] ?? null;
    const limitRaw = getOptionValue(args, '--limit') ?? positional[1];
    const limit = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : 50;
    const [total, items] = await Promise.all([
        countCompanyTargets(listName ?? undefined),
        listCompanyTargets(listName, limit),
    ]);
    console.log(JSON.stringify({ list: listName ?? 'all', total, shown: items.length, items }, null, 2));
}

export async function runListConfigCommand(commandArgs: string[]): Promise<void> {
    const positional = getPositionalArgs(commandArgs);
    const listName = getOptionValue(commandArgs, '--list') ?? positional[0];
    if (!listName) {
        throw new Error('Specifica la lista: npm start -- list-config --list <nome_lista> ...');
    }

    const patch: {
        priority?: number;
        dailyInviteCap?: number | null;
        dailyMessageCap?: number | null;
        isActive?: boolean;
    } = {};

    const priorityRaw = getOptionValue(commandArgs, '--priority') ?? positional[1];
    if (hasOption(commandArgs, '--priority') || priorityRaw !== undefined) {
        const raw = priorityRaw;
        if (!raw) throw new Error('Manca valore per --priority');
        const parsed = parseIntStrict(raw, '--priority');
        if (parsed < 1) throw new Error('--priority deve essere >= 1');
        patch.priority = parsed;
    }
    const inviteCapRaw = getOptionValue(commandArgs, '--invite-cap') ?? positional[2];
    if (hasOption(commandArgs, '--invite-cap') || inviteCapRaw !== undefined) {
        const raw = inviteCapRaw;
        if (!raw) throw new Error('Manca valore per --invite-cap');
        patch.dailyInviteCap = parseNullableCap(raw, '--invite-cap');
    }
    const messageCapRaw = getOptionValue(commandArgs, '--message-cap') ?? positional[3];
    if (hasOption(commandArgs, '--message-cap') || messageCapRaw !== undefined) {
        const raw = messageCapRaw;
        if (!raw) throw new Error('Manca valore per --message-cap');
        patch.dailyMessageCap = parseNullableCap(raw, '--message-cap');
    }
    const activeRaw = getOptionValue(commandArgs, '--active') ?? positional[4];
    if (hasOption(commandArgs, '--active') || activeRaw !== undefined) {
        const raw = activeRaw;
        if (!raw) throw new Error('Manca valore per --active');
        patch.isActive = parseBoolStrict(raw, '--active');
    }

    const updated = await updateLeadCampaignConfig(listName, patch);
    console.log(JSON.stringify(updated, null, 2));
}

export async function runListsCommand(): Promise<void> {
    const lists = await listLeadCampaignConfigs(false);
    console.log(JSON.stringify(lists, null, 2));
}

export async function runSecretsStatusCommand(): Promise<void> {
    const rows = await listSecretRotationStatus(config.securitySecretMaxAgeDays, config.securitySecretWarnDays);
    const summary = rows.reduce<Record<string, number>>((acc, row) => {
        acc[row.status] = (acc[row.status] ?? 0) + 1;
        return acc;
    }, {});
    console.log(JSON.stringify({
        maxAgeDays: config.securitySecretMaxAgeDays,
        warnDays: config.securitySecretWarnDays,
        summary,
        rows,
    }, null, 2));
}

export async function runSecretRotatedCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const secretName = getOptionValue(args, '--name') ?? positional[0];
    if (!secretName || !secretName.trim()) {
        throw new Error('Specifica --name <SECRET_NAME>');
    }

    const owner = getOptionValue(args, '--owner') ?? null;
    const notes = getOptionValue(args, '--notes') ?? null;
    const rotatedAtRaw = getOptionValue(args, '--rotated-at');
    const rotatedAt = rotatedAtRaw && Number.isFinite(Date.parse(rotatedAtRaw))
        ? new Date(rotatedAtRaw).toISOString()
        : new Date().toISOString();

    const expiresDaysRaw = getOptionValue(args, '--expires-days');
    let expiresAt: string | null = null;
    if (expiresDaysRaw) {
        const expiresDays = Math.max(1, parseIntStrict(expiresDaysRaw, '--expires-days'));
        expiresAt = new Date(Date.now() + (expiresDays * 86_400_000)).toISOString();
    }

    await upsertSecretRotation(secretName.trim(), rotatedAt, owner, expiresAt, notes);
    console.log(JSON.stringify({
        secret: secretName.trim(),
        owner,
        rotatedAt,
        expiresAt,
        notes,
        status: 'updated',
    }, null, 2));
}

export async function runAiQualityCommand(args: string[]): Promise<void> {
    const daysRaw = getOptionValue(args, '--days');
    const days = daysRaw ? Math.max(1, parseIntStrict(daysRaw, '--days')) : 30;
    const shouldRunValidation = hasOption(args, '--run');
    const validationRun = shouldRunValidation ? await runAiValidationPipeline('cli') : null;
    const snapshot = await getAiQualitySnapshot(days);
    console.log(JSON.stringify({
        validationRun,
        snapshot,
    }, null, 2));
}
