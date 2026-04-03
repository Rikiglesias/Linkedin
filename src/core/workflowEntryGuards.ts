import { checkLogin, closeBrowser, launchBrowser, runSelectorCanaryDetailed } from '../browser';
import { getRuntimeAccountProfiles } from '../accountManager';
import { config, getLocalDateString, isWorkingHour } from '../config';
import { checkDiskSpace } from '../db';
import { quarantineAccount, pauseAutomation } from '../risk/incidentManager';
import { logInfo, logWarn } from '../telemetry/logger';
import { pushOutboxEvent, getAutomationPauseState, getDailyStat, getRuntimeFlag, setRuntimeFlag } from './repositories';
import { getSessionVarianceFactor, runPreventiveGuards } from './preventiveGuards';
import type { WorkflowSelection } from './workflowSelection';
import type { GuardDecision, WorkflowKind } from '../workflows/types';

export type WorkflowEntryKind = WorkflowSelection | WorkflowKind;

function touchesUi(workflow: WorkflowEntryKind): boolean {
    return workflow === 'all' || workflow === 'check' || workflow === 'invite' || workflow === 'message' || workflow === 'sync-list' || workflow === 'sync-search';
}

async function runCanaryIfNeeded(workflow: WorkflowEntryKind): Promise<boolean> {
    if (!config.selectorCanaryEnabled || !touchesUi(workflow)) {
        return true;
    }

    const lastCanaryOk = await getRuntimeFlag('canary_last_ok_at').catch(() => null);
    if (lastCanaryOk && Date.now() - Date.parse(lastCanaryOk) < 4 * 60 * 60 * 1000) {
        return true;
    }

    const canaryWorkflow: WorkflowSelection =
        workflow === 'invite' || workflow === 'message' || workflow === 'check' ? workflow : 'all';
    const localDate = getLocalDateString();
    const accounts = getRuntimeAccountProfiles();
    for (const account of accounts) {
        const session = await launchBrowser({
            sessionDir: account.sessionDir,
            proxy: account.proxy,
            forceDesktop: true,
        });
        try {
            const loggedIn = await checkLogin(session.page);
            if (!loggedIn) {
                return false;
            }

            const restrictionIndicators = [
                'restricted',
                'under review',
                'temporarily limited',
                'limitato',
                'attività sospetta',
                'account bloccato',
                'your account has been restricted',
                'account is restricted',
            ];
            const pageText = (await session.page.textContent('body').catch(() => '')) ?? '';
            const lowerText = pageText.toLowerCase();
            const restriction = restrictionIndicators.find((ind) => lowerText.includes(ind));
            if (restriction) {
                await quarantineAccount('ACCOUNT_RESTRICTED', {
                    accountId: account.id,
                    indicator: restriction,
                    url: session.page.url(),
                });
                return false;
            }
            const currentUrl = session.page.url();
            if (/\/(checkpoint|challenge)\b/.test(currentUrl)) {
                await quarantineAccount('CHALLENGE_AT_LOGIN', {
                    accountId: account.id,
                    url: currentUrl,
                });
                return false;
            }

            const report = await runSelectorCanaryDetailed(session.page, canaryWorkflow);
            await pushOutboxEvent(
                'selector.canary.report',
                {
                    localDate,
                    workflow,
                    accountId: account.id,
                    report,
                },
                `selector.canary.report:${localDate}:${workflow}:${account.id}:${Date.now()}`,
            );

            if (report.optionalFailed > 0) {
                await logWarn('selector.canary.optional_failed', {
                    localDate,
                    workflow,
                    accountId: account.id,
                    optionalFailed: report.optionalFailed,
                    steps: report.steps.filter((step) => !step.required && !step.ok),
                });
            }

            if (!report.ok) {
                await logWarn('selector.canary.critical_failed', {
                    localDate,
                    workflow,
                    accountId: account.id,
                    criticalFailed: report.criticalFailed,
                    steps: report.steps.filter((step) => step.required && !step.ok),
                });
                return false;
            }

            await logInfo('selector.canary.ok', {
                localDate,
                workflow,
                accountId: account.id,
                steps: report.steps.length,
                optionalFailed: report.optionalFailed,
            });
        } finally {
            await closeBrowser(session);
        }
    }

    await setRuntimeFlag('canary_last_ok_at', new Date().toISOString()).catch(() => null);
    return true;
}

export interface EvaluateWorkflowEntryGuardsOptions {
    workflow: WorkflowEntryKind;
    dryRun: boolean;
    accountId?: string;
}

function block(reason: GuardDecision['blocked']): GuardDecision {
    return { allowed: false, blocked: reason };
}

export async function evaluateWorkflowEntryGuards(
    options: EvaluateWorkflowEntryGuardsOptions,
): Promise<GuardDecision> {
    if (options.dryRun) {
        return { allowed: true, blocked: null };
    }

    await runPreventiveGuards();

    const accounts = getRuntimeAccountProfiles();
    const varianceAccountId = options.accountId ?? accounts[0]?.id ?? 'default';
    const varianceFactor = getSessionVarianceFactor(varianceAccountId);
    if (varianceFactor === 0) {
        await logInfo('workflow.session_variance.skip_day', {
            workflow: options.workflow,
            accountId: varianceAccountId,
        });
        return block({
            reason: 'SESSION_VARIANCE_SKIP_DAY',
            message: 'Sessione saltata per varianza giornaliera anti-pattern',
            details: { workflow: options.workflow, accountId: varianceAccountId },
        });
    }

    const quarantine = (await getRuntimeFlag('account_quarantine')) === 'true';
    if (quarantine) {
        await logWarn('workflow.skipped.quarantine', { workflow: options.workflow });
        return block({
            reason: 'ACCOUNT_QUARANTINED',
            message: 'Account in quarantina',
            details: { workflow: options.workflow },
        });
    }

    const pauseState = await getAutomationPauseState();
    if (pauseState.paused) {
        await logWarn('workflow.skipped.paused', {
            workflow: options.workflow,
            reason: pauseState.reason,
            pausedUntil: pauseState.pausedUntil,
            remainingSeconds: pauseState.remainingSeconds,
        });
        return block({
            reason: 'AUTOMATION_PAUSED',
            message: `Automazione in pausa: ${pauseState.reason ?? 'motivo sconosciuto'}`,
            details: {
                workflow: options.workflow,
                pausedUntil: pauseState.pausedUntil,
                remainingSeconds: pauseState.remainingSeconds,
            },
        });
    }

    const diskStatus = checkDiskSpace();
    if (diskStatus.level === 'critical') {
        await pauseAutomation(
            'DISK_SPACE_CRITICAL',
            { freeMb: diskStatus.freeMb, message: diskStatus.message },
            60,
        );
        await logWarn('workflow.skipped.disk_critical', { freeMb: diskStatus.freeMb });
        return block({
            reason: 'DISK_CRITICAL',
            message: diskStatus.message,
            details: { freeMb: diskStatus.freeMb, workflow: options.workflow },
        });
    }
    if (diskStatus.level === 'warn') {
        await logWarn('workflow.disk_warn', { freeMb: diskStatus.freeMb, message: diskStatus.message });
    }

    if (!isWorkingHour()) {
        await logInfo('workflow.skipped.out_of_hours', {
            workflow: options.workflow,
            startHour: config.workingHoursStart,
            endHour: config.workingHoursEnd,
        });
        return block({
            reason: 'OUT_OF_HOURS',
            message: 'Workflow fuori orario lavorativo',
            details: {
                workflow: options.workflow,
                startHour: config.workingHoursStart,
                endHour: config.workingHoursEnd,
            },
        });
    }

    const localDate = getLocalDateString();
    const selectorFailures = await getDailyStat(localDate, 'selector_failures');
    if (selectorFailures >= config.maxSelectorFailuresPerDay) {
        await quarantineAccount('SELECTOR_FAILURE_BURST', {
            workflow: options.workflow,
            localDate,
            selectorFailures,
            threshold: config.maxSelectorFailuresPerDay,
        });
        return block({
            reason: 'SELECTOR_FAILURE_BURST',
            message: 'Troppi selector failure oggi',
            details: { workflow: options.workflow, localDate, selectorFailures },
        });
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
            config.autoPauseMinutesOnFailureBurst,
        );
        await logWarn('workflow.skipped.run_error_burst', {
            workflow: options.workflow,
            localDate,
            runErrors,
            threshold: config.maxRunErrorsPerDay,
            pauseMinutes: config.autoPauseMinutesOnFailureBurst,
        });
        return block({
            reason: 'RUN_ERROR_BURST',
            message: 'Troppi errori runtime oggi',
            details: { workflow: options.workflow, localDate, runErrors },
        });
    }

    const canaryOk = await runCanaryIfNeeded(options.workflow);
    if (!canaryOk) {
        await quarantineAccount('SELECTOR_CANARY_FAILED', { workflow: options.workflow });
        return block({
            reason: 'SELECTOR_CANARY_FAILED',
            message: 'Selector canary fallito',
            details: { workflow: options.workflow },
        });
    }

    return { allowed: true, blocked: null };
}
