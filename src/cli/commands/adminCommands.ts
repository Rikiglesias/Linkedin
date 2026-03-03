/**
 * adminCommands.ts — Comandi CLI di amministrazione del bot
 *
 * status, diagnostics, pause, resume, unquarantine, incident-resolve, privacy-cleanup, db-backup
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { config, getLocalDateString, getWeekStartDate, isGreenModeWindow } from '../../config';
import { backupDatabase } from '../../db';
import {
    buildFeatureDatasetVersion,
    cleanupPrivacyData,
    countWeeklyInvites,
    countCompanyTargets,
    getAccountAgeDays,
    getAutomationPauseState,
    getAiQualitySnapshot,
    getComplianceHealthMetrics,
    getDailyStatsSnapshot,
    getFeatureDatasetRows,
    getFeatureDatasetVersion,
    getOperationalObservabilitySnapshot,
    getJobStatusCounts,
    getLockContentionSummary,
    importFeatureDatasetVersion,
    listFeatureDatasetVersions,
    listReviewQueue,
    listSecretRotationStatus,
    listLockMetricsByDate,
    listOpenSelectorFailures,
    listSelectorFallbackAggregates,
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
    computeFeatureDatasetSignature,
} from '../../core/repositories';
import { runSecretRotationWorker } from '../../core/secretRotationWorker';
import { calculateDynamicWeeklyInviteLimit, evaluateComplianceHealthScore } from '../../risk/riskEngine';
import { setQuarantine } from '../../risk/incidentManager';
import { getEventSyncStatus } from '../../sync/eventSync';
import { getRuntimeAccountProfiles } from '../../accountManager';
import { getIntegrationProxyPoolStatus, getProxyPoolStatus } from '../../proxyManager';
import { isOpenAIConfigured } from '../../ai/openaiClient';
import { runRestoreDrill } from '../../scripts/restoreDb';
import { getSecurityAdvisorPosture, runSecurityAdvisor } from '../../core/securityAdvisor';
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
const DR_RESTORE_TEST_LAST_RUN_KEY = 'dr_restore_test_last_run_at';
const DR_RESTORE_TEST_LAST_STATUS_KEY = 'dr_restore_test_last_status';
const DR_RESTORE_TEST_LAST_REPORT_KEY = 'dr_restore_test_last_report_path';
const DIAGNOSTIC_SECTIONS = ['health', 'locks', 'queue', 'sync', 'selectors'] as const;
type DiagnosticSection = (typeof DIAGNOSTIC_SECTIONS)[number];
const DIAGNOSTIC_SECTION_SET = new Set<DiagnosticSection>(DIAGNOSTIC_SECTIONS);

function parseDiagnosticDate(raw: string | undefined): string {
    if (!raw || !raw.trim()) {
        return getLocalDateString();
    }
    const normalized = raw.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        throw new Error('Formato data non valido per --date (atteso YYYY-MM-DD).');
    }
    const parsed = Date.parse(`${normalized}T00:00:00Z`);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Data non valida per --date: ${raw}`);
    }
    return normalized;
}

function parseDiagnosticSections(raw: string | undefined): DiagnosticSection[] {
    if (!raw || !raw.trim()) {
        return [...DIAGNOSTIC_SECTIONS];
    }
    const requested = raw
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0);

    if (requested.length === 0 || requested.includes('all')) {
        return [...DIAGNOSTIC_SECTIONS];
    }

    const sections: DiagnosticSection[] = [];
    for (const value of requested) {
        if (!DIAGNOSTIC_SECTION_SET.has(value as DiagnosticSection)) {
            throw new Error(
                `Sezione diagnostica non supportata: ${value}. Valori ammessi: ${DIAGNOSTIC_SECTIONS.join(', ')}, all.`
            );
        }
        const typed = value as DiagnosticSection;
        if (!sections.includes(typed)) {
            sections.push(typed);
        }
    }
    return sections;
}

function parseSelectorJson(raw: string): string[] {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
            .slice(0, 12);
    } catch {
        return [];
    }
}

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
        drRestoreLastRunAt,
        drRestoreLastStatus,
        drRestoreLastReportPath,
        latestAccountHealth,
        secretRotationStatus,
        securityAdvisorPosture,
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
        getRuntimeFlag(DR_RESTORE_TEST_LAST_RUN_KEY),
        getRuntimeFlag(DR_RESTORE_TEST_LAST_STATUS_KEY),
        getRuntimeFlag(DR_RESTORE_TEST_LAST_REPORT_KEY),
        listLatestAccountHealthSnapshots(20),
        listSecretRotationStatus(config.securitySecretMaxAgeDays, config.securitySecretWarnDays),
        getSecurityAdvisorPosture(),
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
        proxy: {
            integrationProxyPoolEnabled: config.integrationProxyPoolEnabled,
            session: getProxyPoolStatus(),
            integration: getIntegrationProxyPoolStatus(),
        },
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
        disasterRecovery: {
            restoreTestEnabled: config.disasterRecoveryRestoreTestEnabled,
            restoreTestIntervalDays: config.disasterRecoveryRestoreTestIntervalDays,
            restoreTestKeepArtifacts: config.disasterRecoveryRestoreKeepArtifacts,
            lastRunAt: drRestoreLastRunAt,
            lastStatus: drRestoreLastStatus,
            lastReportPath: drRestoreLastReportPath,
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
        securityAdvisor: {
            ...securityAdvisorPosture,
            docMaxAgeDays: config.securityAdvisorDocMaxAgeDays,
            auditLookbackDays: config.securityAdvisorAuditLookbackDays,
            minAuditEvents: config.securityAdvisorMinAuditEvents,
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

export async function runDiagnosticsCommand(args: string[]): Promise<void> {
    const explicitDate = getOptionValue(args, '--date');
    const positionalDate = (!explicitDate && args[0] && !args[0].startsWith('--')) ? args[0] : undefined;
    const localDate = parseDiagnosticDate(explicitDate ?? positionalDate);
    const sections = parseDiagnosticSections(getOptionValue(args, '--sections'));
    const lockMetricsLimitRaw = getOptionValue(args, '--lock-metrics-limit');
    const selectorLimitRaw = getOptionValue(args, '--selector-limit');
    const selectorMinSuccessRaw = getOptionValue(args, '--selector-min-success');

    const lockMetricsLimit = lockMetricsLimitRaw
        ? Math.max(1, parseIntStrict(lockMetricsLimitRaw, '--lock-metrics-limit'))
        : 50;
    const selectorLimit = selectorLimitRaw
        ? Math.max(1, parseIntStrict(selectorLimitRaw, '--selector-limit'))
        : 20;
    const selectorMinSuccess = selectorMinSuccessRaw
        ? Math.max(1, parseIntStrict(selectorMinSuccessRaw, '--selector-min-success'))
        : 3;

    const includeSection = (section: DiagnosticSection): boolean => sections.includes(section);
    const needsObservability = includeSection('health')
        || includeSection('locks')
        || includeSection('queue')
        || includeSection('selectors');
    const observability = needsObservability
        ? await getOperationalObservabilitySnapshot(localDate)
        : null;

    const payload: Record<string, unknown> = {
        generatedAt: new Date().toISOString(),
        localDate,
        sections,
    };

    if (includeSection('health')) {
        const [pauseState, complianceMetrics, accountAgeDays, weeklyInvitesSent, latestAccountHealth] = await Promise.all([
            getAutomationPauseState(),
            getComplianceHealthMetrics(localDate, config.complianceHealthLookbackDays, config.hardInviteCap),
            getAccountAgeDays(),
            countWeeklyInvites(getWeekStartDate(new Date(`${localDate}T00:00:00Z`))),
            listLatestAccountHealthSnapshots(10),
        ]);

        const weeklyInviteLimitEffective = config.complianceDynamicWeeklyLimitEnabled
            ? calculateDynamicWeeklyInviteLimit(
                accountAgeDays,
                config.complianceDynamicWeeklyMinInvites,
                config.complianceDynamicWeeklyMaxInvites,
                config.complianceDynamicWeeklyWarmupDays
            )
            : config.weeklyInviteLimit;
        const complianceScore = evaluateComplianceHealthScore({
            acceptanceRatePct: complianceMetrics.acceptanceRatePct,
            engagementRatePct: complianceMetrics.engagementRatePct,
            pendingRatio: complianceMetrics.pendingRatio,
            invitesSentToday: observability?.invitesSent ?? 0,
            messagesSentToday: observability?.messagesSent ?? 0,
            weeklyInvitesSent,
            dailyInviteLimit: config.hardInviteCap,
            dailyMessageLimit: config.hardMsgCap,
            weeklyInviteLimit: weeklyInviteLimitEffective,
            pendingWarnThreshold: config.complianceHealthPendingWarnThreshold,
        });
        const hasSufficientSample = complianceMetrics.invitesSentLookback >= config.complianceHealthMinInviteSample
            && complianceMetrics.messagedLookback >= config.complianceHealthMinMessageSample;

        payload.health = {
            pauseState,
            compliance: {
                enabled: config.complianceEnforced,
                lookbackDays: config.complianceHealthLookbackDays,
                minInviteSample: config.complianceHealthMinInviteSample,
                minMessageSample: config.complianceHealthMinMessageSample,
                hasSufficientSample,
                score: complianceScore.score,
                breakdown: complianceScore,
                pauseThreshold: config.complianceHealthPauseThreshold,
                pendingWarnThreshold: config.complianceHealthPendingWarnThreshold,
                shouldPause: hasSufficientSample && complianceScore.score < config.complianceHealthPauseThreshold,
                metrics: complianceMetrics,
            },
            limits: {
                dailyInviteLimit: config.hardInviteCap,
                dailyMessageLimit: config.hardMsgCap,
                weeklyInvitesSent,
                weeklyInviteLimitEffective,
                weeklyInvitesRemaining: Math.max(0, weeklyInviteLimitEffective - weeklyInvitesSent),
            },
            slo: observability?.slo ?? null,
            latestAccountHealth,
        };
    }

    if (includeSection('locks')) {
        const [summary, metrics, runnerLock] = await Promise.all([
            getLockContentionSummary(localDate),
            listLockMetricsByDate(localDate),
            getRuntimeLock(WORKFLOW_RUNNER_LOCK_KEY),
        ]);
        payload.locks = {
            summary,
            metrics: metrics.slice(0, lockMetricsLimit),
            metricsTotal: metrics.length,
            runnerLockKey: WORKFLOW_RUNNER_LOCK_KEY,
            runnerLock,
        };
    }

    if (includeSection('queue')) {
        const jobStatusCounts = await getJobStatusCounts();
        payload.queue = {
            jobStatusCounts,
            queuedJobs: observability?.queuedJobs ?? 0,
            runningJobs: observability?.runningJobs ?? 0,
            queueLagSeconds: observability?.queueLagSeconds ?? 0,
            oldestRunningJobSeconds: observability?.oldestRunningJobSeconds ?? 0,
            pendingOutbox: observability?.pendingOutbox ?? 0,
            runErrorsToday: observability?.runErrors ?? 0,
        };
    }

    if (includeSection('sync')) {
        const sync = await getEventSyncStatus();
        payload.sync = sync;
    }

    if (includeSection('selectors')) {
        const [openFailures, topFallbacks] = await Promise.all([
            listOpenSelectorFailures(selectorLimit),
            listSelectorFallbackAggregates(selectorMinSuccess, selectorLimit),
        ]);
        payload.selectors = {
            dailyFailures: observability?.selectorFailures ?? 0,
            challengesToday: observability?.challengesCount ?? 0,
            openFailures: openFailures.map((row) => ({
                id: row.id,
                actionLabel: row.action_label,
                url: row.url,
                selectors: parseSelectorJson(row.selectors_json),
                errorMessage: row.error_message,
                occurrences: row.occurrences,
                firstSeenAt: row.first_seen_at,
                lastSeenAt: row.last_seen_at,
                status: row.status,
            })),
            topFallbacks: topFallbacks.map((row) => ({
                actionLabel: row.action_label,
                selector: row.selector,
                successCount: row.success_count,
                lastSuccessAt: row.last_success_at,
            })),
        };
    }

    if (observability) {
        payload.alerts = observability.alerts;
    }

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

export async function runRestoreDrillCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const backupFile = getOptionValue(args, '--backup') ?? positional[0] ?? undefined;
    const keepArtifacts = hasOption(args, '--keep-artifacts');
    const reportDir = getOptionValue(args, '--report-dir') ?? undefined;
    const triggeredBy = getOptionValue(args, '--by') ?? 'cli';

    const report = await runRestoreDrill({
        backupFile,
        keepArtifacts,
        reportDir,
        triggeredBy,
        persistRuntimeFlags: true,
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.status === 'FAILED') {
        throw new Error('Restore drill fallito: verificare reportPath e backup.');
    }
}

export async function runSecurityAdvisorCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const triggeredBy = getOptionValue(args, '--by') ?? positional[0] ?? 'cli';
    const reportDir = getOptionValue(args, '--report-dir') ?? undefined;
    const persistRuntimeFlags = !hasOption(args, '--no-persist-flags');

    const report = await runSecurityAdvisor({
        triggeredBy,
        reportDir,
        persistRuntimeFlags,
    });
    console.log(JSON.stringify(report, null, 2));
}

export async function runReviewQueueCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const limitRaw = getOptionValue(args, '--limit') ?? positional[0];
    const limit = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : 50;
    const rows = await listReviewQueue(limit);
    console.log(JSON.stringify({
        total: rows.length,
        rows,
    }, null, 2));
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

export async function runSecretsRotateCommand(args: string[]): Promise<void> {
    const apply = hasOption(args, '--apply');
    const intervalDaysRaw = getOptionValue(args, '--interval-days');
    const intervalDays = intervalDaysRaw
        ? Math.max(1, parseIntStrict(intervalDaysRaw, '--interval-days'))
        : 7;
    const actor = (getOptionValue(args, '--actor') ?? 'secret_rotation_worker').trim() || 'secret_rotation_worker';
    const envFilePath = getOptionValue(args, '--env-file') ?? undefined;
    const includeRaw = getOptionValue(args, '--include');
    const includeSecrets = includeRaw
        ? includeRaw.split(',').map((value) => value.trim()).filter((value) => value.length > 0)
        : undefined;

    const result = await runSecretRotationWorker({
        apply,
        intervalDays,
        actor,
        envFilePath,
        includeSecrets,
    });
    console.log(JSON.stringify(result, null, 2));
}

type FeatureStoreActionFlag = 'invite' | 'message';

interface FeatureStoreDatasetManifest {
    datasetName: string;
    datasetVersion: string;
    actionScope: string;
    lookbackDays: number;
    splitTrainPct: number;
    splitValidationPct: number;
    seed: string;
    rowCount: number;
    signatureSha256: string;
    sourceStats: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    exportedAt: string;
    dataFile: string;
    dataFileSha256: string;
}

interface FeatureStoreJsonlRow {
    sampleKey: string;
    leadId: number;
    action: FeatureStoreActionFlag;
    eventAt: string;
    label: number;
    split: 'train' | 'validation' | 'test';
    features: Record<string, unknown>;
    metadata: Record<string, unknown>;
}

function parseFeatureStoreActions(raw: string | undefined): FeatureStoreActionFlag[] | undefined {
    if (!raw || !raw.trim()) return undefined;
    const tokens = raw
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0);
    if (tokens.length === 0) return undefined;
    const result = new Set<FeatureStoreActionFlag>();
    for (const token of tokens) {
        if (token === 'invite' || token === 'message') {
            result.add(token);
            continue;
        }
        throw new Error(`Azione feature-store non supportata: ${token}. Valori ammessi: invite,message`);
    }
    return Array.from(result);
}

function parseJsonObjectSafe(raw: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        return {};
    } catch {
        return {};
    }
}

function safeFeatureFileBase(datasetName: string, datasetVersion: string): string {
    return `${datasetName}.${datasetVersion}`.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function sha256File(filePath: string): string {
    const buffer = fs.readFileSync(filePath);
    return createHash('sha256').update(buffer).digest('hex');
}

export async function runFeatureStoreCommand(args: string[]): Promise<void> {
    const positional = getPositionalArgs(args);
    const mode = (getOptionValue(args, '--mode') ?? positional[0] ?? 'build').trim().toLowerCase();

    if (mode === 'versions') {
        const datasetName = getOptionValue(args, '--dataset') ?? positional[1];
        const limitRaw = getOptionValue(args, '--limit') ?? positional[2];
        const limit = limitRaw ? Math.max(1, parseIntStrict(limitRaw, '--limit')) : 20;
        const rows = await listFeatureDatasetVersions(limit, datasetName ?? undefined);
        console.log(JSON.stringify({ total: rows.length, rows }, null, 2));
        return;
    }

    if (mode === 'build') {
        const datasetName = getOptionValue(args, '--dataset') ?? positional[1] ?? 'default_feature_store';
        const datasetVersion = getOptionValue(args, '--version') ?? undefined;
        const lookbackRaw = getOptionValue(args, '--lookback-days') ?? positional[2];
        const splitTrainRaw = getOptionValue(args, '--split-train-pct');
        const splitValidationRaw = getOptionValue(args, '--split-validation-pct');
        const seed = getOptionValue(args, '--seed') ?? undefined;
        const actions = parseFeatureStoreActions(getOptionValue(args, '--actions'));
        const forceRebuild = hasOption(args, '--force');

        const result = await buildFeatureDatasetVersion({
            datasetName,
            datasetVersion,
            actions,
            lookbackDays: lookbackRaw ? Math.max(1, parseIntStrict(lookbackRaw, '--lookback-days')) : undefined,
            splitTrainPct: splitTrainRaw ? Math.max(1, parseIntStrict(splitTrainRaw, '--split-train-pct')) : undefined,
            splitValidationPct: splitValidationRaw ? Math.max(1, parseIntStrict(splitValidationRaw, '--split-validation-pct')) : undefined,
            seed,
            forceRebuild,
            metadata: {
                trigger: 'cli',
                mode: 'build',
            },
        });
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    if (mode === 'export') {
        const datasetName = getOptionValue(args, '--dataset') ?? positional[1];
        if (!datasetName) {
            throw new Error('Specifica --dataset <nome_dataset> per export.');
        }
        let datasetVersion = getOptionValue(args, '--version') ?? positional[2] ?? null;
        if (!datasetVersion) {
            const latest = await listFeatureDatasetVersions(1, datasetName);
            datasetVersion = latest[0]?.dataset_version ?? null;
        }
        if (!datasetVersion) {
            throw new Error(`Nessuna versione trovata per dataset "${datasetName}".`);
        }
        const version = await getFeatureDatasetVersion(datasetName, datasetVersion);
        if (!version) {
            throw new Error(`Dataset non trovato: ${datasetName}@${datasetVersion}`);
        }
        const rows = await getFeatureDatasetRows(datasetName, datasetVersion);
        const outDir = path.resolve(getOptionValue(args, '--out-dir') ?? path.join('data', 'feature_store'));
        fs.mkdirSync(outDir, { recursive: true });

        const fileBase = safeFeatureFileBase(datasetName, datasetVersion);
        const jsonlFileName = `${fileBase}.jsonl`;
        const manifestFileName = `${fileBase}.manifest.json`;
        const jsonlPath = path.join(outDir, jsonlFileName);
        const manifestPath = path.join(outDir, manifestFileName);

        const jsonlRows: FeatureStoreJsonlRow[] = rows.map((row) => ({
            sampleKey: row.sample_key,
            leadId: row.lead_id,
            action: row.action,
            eventAt: row.event_at,
            label: row.label,
            split: row.split,
            features: parseJsonObjectSafe(row.features_json),
            metadata: parseJsonObjectSafe(row.metadata_json),
        }));
        fs.writeFileSync(
            jsonlPath,
            jsonlRows.map((row) => JSON.stringify(row)).join('\n') + (jsonlRows.length > 0 ? '\n' : ''),
            'utf8'
        );

        const manifest: FeatureStoreDatasetManifest = {
            datasetName: version.dataset_name,
            datasetVersion: version.dataset_version,
            actionScope: version.action_scope,
            lookbackDays: version.lookback_days,
            splitTrainPct: version.split_train_pct,
            splitValidationPct: version.split_validation_pct,
            seed: version.seed,
            rowCount: version.row_count,
            signatureSha256: version.signature_sha256,
            sourceStats: parseJsonObjectSafe(version.source_stats_json),
            metadata: parseJsonObjectSafe(version.metadata_json),
            exportedAt: new Date().toISOString(),
            dataFile: jsonlFileName,
            dataFileSha256: sha256File(jsonlPath),
        };
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

        console.log(JSON.stringify({
            datasetName: version.dataset_name,
            datasetVersion: version.dataset_version,
            rowCount: version.row_count,
            signatureSha256: version.signature_sha256,
            manifestPath,
            dataPath: jsonlPath,
        }, null, 2));
        return;
    }

    if (mode === 'import') {
        const manifestPathRaw = getOptionValue(args, '--manifest') ?? positional[1];
        if (!manifestPathRaw) {
            throw new Error('Specifica --manifest <path_manifest.json>.');
        }
        const manifestPath = path.resolve(manifestPathRaw);
        if (!fs.existsSync(manifestPath)) {
            throw new Error(`Manifest non trovato: ${manifestPath}`);
        }
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as FeatureStoreDatasetManifest;
        const dataPathRaw = getOptionValue(args, '--data-file');
        const dataPath = path.resolve(
            dataPathRaw
                ? dataPathRaw
                : path.join(path.dirname(manifestPath), manifest.dataFile)
        );
        if (!fs.existsSync(dataPath)) {
            throw new Error(`File dataset non trovato: ${dataPath}`);
        }
        const computedFileSha = sha256File(dataPath);
        if (computedFileSha !== manifest.dataFileSha256) {
            throw new Error('Checksum file dataset non valido (sha256 mismatch).');
        }
        const content = fs.readFileSync(dataPath, 'utf8');
        const lines = content
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        const rows = lines.map((line) => JSON.parse(line) as FeatureStoreJsonlRow);
        const normalizedRows = rows.map((row) => ({
            sampleKey: row.sampleKey,
            leadId: row.leadId,
            action: row.action,
            eventAt: row.eventAt,
            label: row.label,
            split: row.split,
            features: row.features ?? {},
            metadata: row.metadata ?? {},
        }));
        const computedSignature = computeFeatureDatasetSignature(normalizedRows);
        if (computedSignature !== manifest.signatureSha256) {
            throw new Error('Signature dataset non valida (manifest vs contenuto JSONL).');
        }
        const forceRebuild = hasOption(args, '--force');
        const result = await importFeatureDatasetVersion({
            datasetName: manifest.datasetName,
            datasetVersion: manifest.datasetVersion,
            actionScope: manifest.actionScope,
            lookbackDays: manifest.lookbackDays,
            splitTrainPct: manifest.splitTrainPct,
            splitValidationPct: manifest.splitValidationPct,
            seed: manifest.seed,
            signatureSha256: manifest.signatureSha256,
            rows: normalizedRows,
            sourceStats: manifest.sourceStats,
            metadata: {
                ...(manifest.metadata ?? {}),
                importedAt: new Date().toISOString(),
                importedFromManifest: manifestPath,
                importedFromData: dataPath,
            },
            forceRebuild,
        });
        console.log(JSON.stringify({
            ...result,
            manifestPath,
            dataPath,
        }, null, 2));
        return;
    }

    throw new Error('Uso feature-store: feature-store <build|versions|export|import> [opzioni]');
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
