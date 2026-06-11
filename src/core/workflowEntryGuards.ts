import { checkLogin, closeBrowser, launchBrowser, runSelectorCanaryDetailed, type BrowserSession } from '../browser';
import { enableWindowClickThrough, disableWindowClickThrough } from '../browser/windowInputBlock';
import { getRuntimeAccountProfiles } from '../accountManager';
import { config, getLocalDateString, isWorkingHour } from '../config';
import { checkDiskSpace } from '../db';
import { quarantineAccount, pauseAutomation } from '../risk/incidentManager';
import { logInfo, logWarn } from '../telemetry/logger';
import {
    pushOutboxEvent,
    getAutomationPauseState,
    getDailyStat,
    getAccountQuarantine,
    getRuntimeFlag,
    setRuntimeFlag,
    acquireRuntimeLock,
    releaseRuntimeLock,
} from './repositories';
import { getSessionVarianceFactor, runPreventiveGuards } from './preventiveGuards';
import type { WorkflowSelection } from './workflowSelection';
import type { GuardDecision, WorkflowBlockedReason, WorkflowKind } from '../workflows/types';

export type WorkflowEntryKind = WorkflowSelection | WorkflowKind;

function touchesUi(workflow: WorkflowEntryKind): boolean {
    return workflow === 'all' || workflow === 'check' || workflow === 'invite' || workflow === 'message' || workflow === 'sync-list' || workflow === 'sync-search';
}

/**
 * Esito del canary, discriminato per CAUSA. Evita di collassare 4 modi di fallimento
 * diversi (logout / restricted / challenge / selettori) in un unico booleano: era la
 * fonte della diagnosi fuorviante "SELECTOR_CANARY_FAILED" anche quando il problema
 * reale era una sessione sloggata (cookie li_at assente).
 */
type CanaryOutcome =
    | { ok: true; session?: BrowserSession }
    | {
          ok: false;
          blockReason: WorkflowBlockedReason;
          quarantineType: string | null;
          message: string;
          /**
           * Account a cui attribuire la quarantena (G5-F2). Presente SOLO per fallimenti
           * account-specific (es. LOGIN_REQUIRED); assente per fallimenti platform-wide
           * (SELECTOR_CANARY_FAILED) → quarantena GLOBALE fail-safe su tutti gli account.
           */
          accountId?: string;
      };

async function runCanaryIfNeeded(
    workflow: WorkflowEntryKind,
    noProxy = false,
    reuseAccountId?: string,
): Promise<CanaryOutcome> {
    if (!config.selectorCanaryEnabled || !touchesUi(workflow)) {
        return { ok: true };
    }

    const lastCanaryOk = await getRuntimeFlag('canary_last_ok_at').catch(() => null);
    if (lastCanaryOk && Date.now() - Date.parse(lastCanaryOk) < 4 * 60 * 60 * 1000) {
        return { ok: true };
    }

    const canaryWorkflow: WorkflowSelection =
        workflow === 'invite' || workflow === 'message' || workflow === 'check' ? workflow : 'all';
    const localDate = getLocalDateString();
    const accounts = getRuntimeAccountProfiles();
    for (const account of accounts) {
        const session = await launchBrowser({
            sessionDir: account.sessionDir,
            // Coerenza IP: se l'operazione gira --no-proxy, anche il canary deve usare lo stesso
            // IP (reale), altrimenti la pre-verifica va sul proxy (lento/diverso) e fallisce o
            // crea un mismatch login-IP vs canary-IP.
            proxy: noProxy ? undefined : account.proxy,
            bypassProxy: noProxy,
            forceDesktop: true,
        });
        // [WINDOW-BLOCK] Proteggi ANCHE la finestra del canary: lancia il proprio browser e va su
        // LinkedIn, quindi il mouse fisico dell'utente deve passarci attraverso come per la sessione
        // sync. Senza, la finestra del canary resta cliccabile → un click la chiude e il workflow
        // muore più avanti ("Target page closed"). Solo click-through OS (no overlay DOM: il canary
        // testa i selettori e non va disturbato nel DOM).
        enableWindowClickThrough(session.browser);
        // Handoff opt-in: se questo è l'account operativo da riusare (reuseAccountId), a check superati
        // NON chiudere la sessione — passala al workflow per evitare il 2o launch sullo stesso profilo
        // persistente (lock conflict → timeout 180s). Per gli altri account il canary chiude come sempre.
        const reuseThisSession = reuseAccountId !== undefined && account.id === reuseAccountId;
        let handedOff = false;
        try {
            const loggedIn = await checkLogin(session.page);
            if (!loggedIn) {
                // Sessione sloggata (li_at assente / redirect a /login): NON è un selector-fail.
                // Reason dedicato LOGIN_REQUIRED → diagnosi corretta + azione chiara (`bot.ps1 login`).
                return {
                    ok: false,
                    blockReason: 'LOGIN_REQUIRED',
                    quarantineType: 'LOGIN_REQUIRED',
                    message: 'Sessione LinkedIn non autenticata (cookie li_at assente) — eseguire `bot.ps1 login`',
                    // Account-specific: è QUESTA sessione a essere sloggata → quarantena sul suo account.
                    accountId: account.id,
                };
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
                // Già quarantinato sopra con reason proprio: il caller NON deve ri-quarantinare.
                return {
                    ok: false,
                    blockReason: 'ACCOUNT_QUARANTINED',
                    quarantineType: null,
                    message: 'Account LinkedIn limitato / sotto revisione',
                };
            }
            const currentUrl = session.page.url();
            if (/\/(checkpoint|challenge)\b/.test(currentUrl)) {
                await quarantineAccount('CHALLENGE_AT_LOGIN', {
                    accountId: account.id,
                    url: currentUrl,
                });
                // Già quarantinato sopra con reason proprio: il caller NON deve ri-quarantinare.
                return {
                    ok: false,
                    blockReason: 'ACCOUNT_QUARANTINED',
                    quarantineType: null,
                    message: 'Challenge/checkpoint LinkedIn al login',
                };
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
                return {
                    ok: false,
                    blockReason: 'SELECTOR_CANARY_FAILED',
                    quarantineType: 'SELECTOR_CANARY_FAILED',
                    message: 'Selector canary fallito (selettori critici non trovati sul DOM LinkedIn)',
                };
            }

            await logInfo('selector.canary.ok', {
                localDate,
                workflow,
                accountId: account.id,
                steps: report.steps.length,
                optionalFailed: report.optionalFailed,
            });

            if (reuseThisSession) {
                // Check superati per l'account operativo → handoff: mantieni il click-through ATTIVO
                // (il workflow riusa la stessa finestra) e NON chiudere la sessione; la chiuderà il
                // caller (syncListService) nel suo finally. Setta qui il flag canary perché ritorniamo.
                handedOff = true;
                await setRuntimeFlag('canary_last_ok_at', new Date().toISOString()).catch(() => null);
                return { ok: true, session };
            }
        } finally {
            if (!handedOff) {
                // Il click-through resta attivo per tutto il wind-down di closeBrowser (la finestra è
                // ancora visibile e cliccabile); dopo la chiusura rimuovo il PID del canary dal set
                // protetto — la finestra sync (PID diverso) resta protetta grazie allo stato multi-PID.
                await closeBrowser(session);
                disableWindowClickThrough(session.browser);
            }
        }
    }

    await setRuntimeFlag('canary_last_ok_at', new Date().toISOString()).catch(() => null);
    return { ok: true };
}

export interface EvaluateWorkflowEntryGuardsOptions {
    workflow: WorkflowEntryKind;
    dryRun: boolean;
    accountId?: string;
    /** Se true, anche il selector canary gira senza proxy (coerenza IP con l'operazione --no-proxy). */
    noProxy?: boolean;
    /**
     * Se true, il canary NON chiude la sessione dell'account operativo (`accountId`) ma la ritorna in
     * `GuardDecisionWithSession.session`, così il workflow la riusa invece di aprire un 2° browser sullo
     * stesso profilo (lock conflict). Il CALLER è responsabile di chiuderla. Default false → comportamento
     * invariato per tutti gli altri workflow.
     */
    reuseSession?: boolean;
}

/** GuardDecision esteso con la sessione del canary da riusare (handoff opt-in, solo se `reuseSession`). */
export interface GuardDecisionWithSession extends GuardDecision {
    session?: BrowserSession;
    /**
     * Lock per-account acquisito dal guard (F1 anti-concorrenza): il CALLER lo rilascia nel `finally`
     * con `releaseRuntimeLock(lockKey, ownerId)`. Null se il workflow non usa il lock per-account.
     */
    accountLock?: { lockKey: string; ownerId: string } | null;
}

/** Contatore per ownerId univoco del lock per-account intra-processo (evita renew-as-acquire). */
let _syncLockCounter = 0;

function block(reason: GuardDecision['blocked']): GuardDecision {
    return { allowed: false, blocked: reason };
}

export async function evaluateWorkflowEntryGuards(
    options: EvaluateWorkflowEntryGuardsOptions,
): Promise<GuardDecisionWithSession> {
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

    // G5-F2: quarantena PER-ACCOUNT dell'account operativo (include il flag globale legacy,
    // che blocca ogni account). Un incidente su un altro account non ferma questo workflow.
    const quarantine = await getAccountQuarantine(varianceAccountId);
    if (quarantine) {
        await logWarn('workflow.skipped.quarantine', { workflow: options.workflow, accountId: varianceAccountId });
        return block({
            reason: 'ACCOUNT_QUARANTINED',
            message: 'Account in quarantina',
            details: { workflow: options.workflow, accountId: varianceAccountId },
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
        if (config.bypassWorkingHours) {
            // Override ESPLICITO (BYPASS_WORKING_HOURS=true): solo per testing. Logga un WARNING
            // perché operare fuori orario è un pattern anti-ban rischioso in produzione (ritmo circadiano).
            await logWarn('workflow.working_hours_bypassed', {
                workflow: options.workflow,
                startHour: config.workingHoursStart,
                endHour: config.workingHoursEnd,
                note: 'BYPASS_WORKING_HOURS attivo — fuori orario lavorativo, anti-ban-rischioso in produzione',
            });
        } else {
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

    // Guard anti-concorrenza per-account (F1): impedisce 2 sync-list/sync-search sullo STESSO account
    // in parallelo (2 CLI dirette o 2 comandi automation) che aprirebbero lo stesso profilo persistente
    // camoufox → lock conflict 180s. Riusa il lock distribuito atomico esistente (acquireRuntimeLock,
    // anti-TOCTOU H12); il CALLER lo rilascia nel finally. Acquisito PRIMA del canary (che apre il browser).
    let accountLock: { lockKey: string; ownerId: string } | null = null;
    if (options.workflow === 'sync-list' || options.workflow === 'sync-search') {
        const lockAccountId = options.accountId ?? accounts[0]?.id ?? 'default';
        const lockKey = `sync.account:${lockAccountId}`;
        const ownerId = `sync:${lockAccountId}:${process.pid}:${++_syncLockCounter}`;
        const lockResult = await acquireRuntimeLock(lockKey, ownerId, 1800, {
            workflow: options.workflow,
            accountId: lockAccountId,
        });
        if (!lockResult.acquired) {
            await logWarn('workflow.skipped.concurrent_sync', {
                workflow: options.workflow,
                accountId: lockAccountId,
                lockHolder: lockResult.lock?.owner_id ?? null,
            });
            return block({
                reason: 'SYNC_CONCURRENT_ON_ACCOUNT',
                message: `Sync già in esecuzione sullo stesso account (${lockAccountId})`,
                details: { workflow: options.workflow, accountId: lockAccountId },
            });
        }
        accountLock = { lockKey, ownerId };
    }

    const canary = await runCanaryIfNeeded(
        options.workflow,
        options.noProxy ?? false,
        // Handoff opt-in: passa l'account operativo SOLO se il caller ha chiesto reuseSession.
        options.reuseSession ? options.accountId : undefined,
    );
    if (!canary.ok) {
        // Il workflow non procede → rilascia subito il lock (non aspettare il TTL).
        if (accountLock) await releaseRuntimeLock(accountLock.lockKey, accountLock.ownerId);
        if (canary.quarantineType) {
            // G5-F2: attribuisci la quarantena all'account SOLO se il canary l'ha identificato
            // (fallimento account-specific, es. LOGIN_REQUIRED). Senza accountId → quarantena
            // globale fail-safe (fallimenti platform-wide come SELECTOR_CANARY_FAILED).
            await quarantineAccount(canary.quarantineType, {
                workflow: options.workflow,
                ...(canary.accountId ? { accountId: canary.accountId } : {}),
            });
        }
        return block({
            reason: canary.blockReason,
            message: canary.message,
            details: { workflow: options.workflow },
        });
    }

    // canary.session definita solo nel caso handoff; accountLock va rilasciato dal caller nel finally.
    return { allowed: true, blocked: null, session: canary.session, accountLock };
}
