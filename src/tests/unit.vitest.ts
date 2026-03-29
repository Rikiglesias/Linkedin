/**
 * tests/unit.vitest.ts
 * ─────────────────────────────────────────────────────────────────
 * Test Suite unificata (fonde unit.vitest.ts e il legacy unit.ts)
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { AccountProfileConfig, config } from '../config';
import { isValidLeadTransition } from '../core/leadStateService';
import {
    calculateDynamicBudget,
    calculateDynamicWeeklyInviteLimit,
    evaluateComplianceHealthScore,
    evaluateCooldownDecision,
    evaluateRisk,
} from '../risk/riskEngine';
import { hashMessage, validateMessageContent } from '../validation/messageValidator';
import { isProfileUrl, isSalesNavigatorUrl, normalizeLinkedInUrl } from '../linkedinUrl';
import { buildPersonalizedFollowUpMessage } from '../ai/messagePersonalizer';
import { buildPersonalizedInviteNote } from '../ai/inviteNotePersonalizer';
import { evaluateAiGuardian } from '../ai/guardian';
import { ScheduleResult, workflowToJobTypes } from '../core/scheduler';
import { LeadRecord } from '../types/domain';
import {
    getIntegrationProxyFailoverChain,
    getIntegrationProxyPoolStatus,
    getProxy,
    getProxyFailoverChain,
    getProxyPoolStatus,
    markIntegrationProxyFailed,
    markIntegrationProxyHealthy,
    markProxyFailed,
    markProxyHealthy,
} from '../proxyManager';
import { getSchedulingAccountIds, pickAccountIdForLead } from '../accountManager';
import { generateInviteNote } from '../ai/inviteNotePersonalizer';
import { classifySiteMismatch, isMismatchAmbiguous } from '../core/audit';
import { SELECTORS } from '../selectors';
import { computeTwoProportionSignificance } from '../core/repositories/aiQuality';
import { resolveWorkerRetryPolicy, RetryableWorkerError } from '../workers/errors';
import { clickWithFallback, rankSelectorCandidates, resetSelectorContextCacheForTests } from '../browser/uiFallback';
import { resolveFollowUpCadence } from '../workers/followUpWorker';
import { assessSelectorModelDegradation } from '../selectors/learner';
import { computeNonLinearRampCap } from '../ml/rampModel';
import { computeBayesianBanditScore, evaluateBanditDecision } from '../ml/abBandit';
import {
    CircuitOpenError,
    executeWithRetryPolicy,
    getCircuitBreakerSnapshot,
    resetCircuitBreakersForTests,
} from '../core/integrationPolicy';
// backpressure imports moved to backpressure.vitest.ts

import { describe, test, expect } from 'vitest';
// HttpResponseThrottler imports moved to httpThrottler.vitest.ts
import { generatePostContent } from '../ai/postContentGenerator';
import { checkSessionFreshness } from '../browser/sessionCookieMonitor';

// Stealth Init Script tests → stealth.vitest.ts (16 test + 3 runtime)
// Fingerprint Pool tests → fingerprint-coherence.vitest.ts (14 test)
// HTTP Response Throttler tests → httpThrottler.vitest.ts
// Backpressure tests → backpressure.vitest.ts

describe('Post Content Generator', () => {
    test('genera contenuto template o AI fallback', async () => {
        const result = await generatePostContent({ topic: 'test' });
        expect(result.content.length).toBeGreaterThan(50);
        expect(['template', 'ai']).toContain(result.source);
        expect(result.estimatedReadTimeSeconds).toBeGreaterThan(0);
    });
});

describe('Session Cookie Monitor', () => {
    test('sessione senza meta file è sempre fresh', () => {
        const freshness = checkSessionFreshness('/tmp/nonexistent-session-dir', 7);
        expect(freshness.fresh).toBe(true);
        expect(freshness.needsRotation).toBe(false);
        expect(freshness.lastVerifiedAt).toBeNull();
    });
});

// Zod Schemas + API Error Format tests moved to api.vitest.ts

describe('Legacy Core Domain Unit Tests', () => {
    test('executes all internal domain assertions correctly', async () => {
        assert.equal(isValidLeadTransition('NEW', 'READY_INVITE'), true);
        assert.equal(isValidLeadTransition('READY_INVITE', 'INVITED'), true);
        assert.equal(isValidLeadTransition('INVITED', 'MESSAGED'), false);
        assert.equal(isValidLeadTransition('READY_MESSAGE', 'REVIEW_REQUIRED'), true);

        const ambiguousMismatch = classifySiteMismatch('READY_MESSAGE', {
            pendingInvite: false,
            connected: false,
            messageButton: false,
            canConnect: true,
        });
        assert.equal(ambiguousMismatch, 'ready_message_but_not_connected');
        assert.equal(ambiguousMismatch ? isMismatchAmbiguous(ambiguousMismatch) : false, true);

        const reconcilableMismatch = classifySiteMismatch('INVITED', {
            pendingInvite: false,
            connected: false,
            messageButton: false,
            canConnect: true,
        });
        assert.equal(reconcilableMismatch, 'invited_but_connect_available');
        assert.equal(reconcilableMismatch ? isMismatchAmbiguous(reconcilableMismatch) : true, false);
        assert.deepEqual(workflowToJobTypes('warmup'), []);
        assert.deepEqual(workflowToJobTypes('check'), ['ACCEPTANCE_CHECK', 'HYGIENE']);
        assert.deepEqual(workflowToJobTypes('invite'), ['INVITE']);

        const risk = evaluateRisk({
            pendingRatio: 0.4,
            errorRate: 0.1,
            selectorFailureRate: 0.05,
            challengeCount: 0,
            inviteVelocityRatio: 0.3,
        });
        assert.equal(
            risk.action === 'NORMAL' ||
                risk.action === 'WARN' ||
                risk.action === 'LOW_ACTIVITY' ||
                risk.action === 'STOP',
            true,
        );

        // test dynamic budget
        const budgetNormal = calculateDynamicBudget(25, 35, 5, 'NORMAL');
        const budgetWarn = calculateDynamicBudget(25, 35, 5, 'WARN');
        const budgetLowActivity = calculateDynamicBudget(25, 35, 5, 'LOW_ACTIVITY');
        assert.equal(budgetNormal, 20); // 25-5
        assert.equal(budgetWarn, 7); // floor(25*0.5)-5 = floor(12.5)-5 = 12-5 = 7
        assert.equal(budgetLowActivity >= 0, true);

        const cooldownDecision = evaluateCooldownDecision({
            ...risk,
            action: 'WARN',
            score: 72,
            pendingRatio: 0.7,
        });
        assert.equal(cooldownDecision.activate, true);
        assert.equal(cooldownDecision.minutes > 0, true);

        const healthyComplianceScore = evaluateComplianceHealthScore({
            acceptanceRatePct: 78,
            engagementRatePct: 72,
            pendingRatio: 0.28,
            invitesSentToday: 9,
            messagesSentToday: 6,
            weeklyInvitesSent: 34,
            dailyInviteLimit: 15,
            dailyMessageLimit: 20,
            weeklyInviteLimit: 80,
            pendingWarnThreshold: 0.65,
        });
        assert.equal(healthyComplianceScore.score >= 70, true);

        const unhealthyComplianceScore = evaluateComplianceHealthScore({
            acceptanceRatePct: 35,
            engagementRatePct: 18,
            pendingRatio: 0.82,
            invitesSentToday: 25,
            messagesSentToday: 40,
            weeklyInvitesSent: 120,
            dailyInviteLimit: 12,
            dailyMessageLimit: 20,
            weeklyInviteLimit: 80,
            pendingWarnThreshold: 0.65,
        });
        assert.equal(unhealthyComplianceScore.score < 70, true);
        assert.equal(unhealthyComplianceScore.penalty > 0, true);

        const weeklyLimitEarly = calculateDynamicWeeklyInviteLimit(10, 20, 80, 180);
        const weeklyLimitMature = calculateDynamicWeeklyInviteLimit(365, 20, 80, 180);
        assert.equal(weeklyLimitEarly >= 20 && weeklyLimitEarly <= 80, true);
        assert.equal(weeklyLimitMature, 80);

        const goodMessage = 'Ciao Mario, grazie per il collegamento.';
        const hash = hashMessage(goodMessage);
        assert.equal(hash.length, 64);
        const goodValidation = validateMessageContent(goodMessage, { duplicateCountLast24h: 0 });
        assert.equal(goodValidation.valid, true);

        const badValidation = validateMessageContent('Ciao {{firstName}}', { duplicateCountLast24h: 5 });
        assert.equal(badValidation.valid, false);

        assert.equal(isSalesNavigatorUrl('https://www.linkedin.com/sales/lead/ACwAA123,NAME_SEARCH/'), true);
        assert.equal(isProfileUrl('https://www.linkedin.com/in/mario-rossi-123/'), true);
        assert.equal(isProfileUrl('https://www.linkedin.com/sales/lead/ACwAA123,NAME_SEARCH/'), false);
        assert.equal(
            normalizeLinkedInUrl('https://it.linkedin.com/in/mario-rossi-123/detail/recent-activity/?trk=abc'),
            'https://www.linkedin.com/in/mario-rossi-123/',
        );

        const lead: LeadRecord = {
            id: 99,
            account_name: 'Demo Srl',
            first_name: 'Mario',
            last_name: 'Rossi',
            job_title: 'CEO',
            website: 'https://demo.example',
            linkedin_url: 'https://www.linkedin.com/in/mario-rossi-123/',
            status: 'READY_MESSAGE',
            list_name: 'default',
            invited_at: null,
            accepted_at: null,
            messaged_at: null,
            last_error: null,
            blocked_reason: null,
            about: null,
            experience: null,
            invite_prompt_variant: null,
            lead_score: null,
            confidence_score: null,
            created_at: '2026-02-25T00:00:00.000Z',
            updated_at: '2026-02-25T00:00:00.000Z',
        };
        const personalized = await buildPersonalizedFollowUpMessage(lead);
        assert.equal(personalized.message.length > 0, true);
        assert.equal(personalized.source === 'template' || personalized.source === 'ai', true);
        const personalizedInviteNote = await buildPersonalizedInviteNote(lead);
        assert.equal(personalizedInviteNote.note.length > 0, true);
        assert.equal(personalizedInviteNote.note.length <= 300, true);
        assert.equal(personalizedInviteNote.source === 'template' || personalizedInviteNote.source === 'ai', true);

        const schedule: ScheduleResult = {
            localDate: '2026-02-25',
            riskSnapshot: {
                score: 40,
                pendingRatio: 0.3,
                errorRate: 0.05,
                selectorFailureRate: 0.02,
                challengeCount: 0,
                inviteVelocityRatio: 0.2,
                action: 'NORMAL',
            },
            inviteBudget: 10,
            messageBudget: 10,
            weeklyInvitesSent: 12,
            weeklyInviteLimitEffective: 80,
            weeklyInvitesRemaining: 68,
            queuedInviteJobs: 5,
            queuedCheckJobs: 4,
            queuedMessageJobs: 3,
            listBreakdown: [
                {
                    listName: 'default',
                    inviteBudget: 10,
                    messageBudget: 10,
                    queuedInviteJobs: 5,
                    queuedCheckJobs: 4,
                    queuedMessageJobs: 3,
                    adaptiveFactor: 1,
                    adaptiveReasons: [],
                    pendingRatio: 0.3,
                    blockedRatio: 0.1,
                    maxScheduledDelaySec: 30,
                },
            ],
            dryRun: false,
        };
        const guardian = await evaluateAiGuardian('all', schedule);
        // Con AI_GUARDIAN_ENABLED=true, il guardian potrebbe essere rate-limited
        // (interval_not_elapsed) da un run precedente nel test → decision=null è valido.
        assert.equal(typeof guardian.executed, 'boolean');

        // ── accountManager: round-robin uniforme/stabile ────────────────────────
        const originalMultiAccountEnabled = config.multiAccountEnabled;
        const originalAccountProfiles = config.accountProfiles.slice();
        const originalSessionDir = config.sessionDir;
        const mockedProfiles: AccountProfileConfig[] = [
            {
                id: 'main',
                sessionDir: path.resolve(process.cwd(), 'data', 'session_test_main'),
                proxyUrl: '',
                proxyUsername: '',
                proxyPassword: '',
                proxyType: 'unknown',
                inviteWeight: 1,
                messageWeight: 1,
                warmupEnabled: false,
                warmupMaxDays: 30,
                warmupMinActions: 5,
            },
            {
                id: 'backup',
                sessionDir: path.resolve(process.cwd(), 'data', 'session_test_backup'),
                proxyUrl: '',
                proxyUsername: '',
                proxyPassword: '',
                proxyType: 'unknown',
                inviteWeight: 1,
                messageWeight: 1,
                warmupEnabled: false,
                warmupMaxDays: 30,
                warmupMinActions: 5,
            },
        ];
        try {
            config.multiAccountEnabled = true;
            config.accountProfiles = mockedProfiles;
            config.sessionDir = path.resolve(process.cwd(), 'data', 'session_test_default');
            const schedulingAccounts = getSchedulingAccountIds();
            assert.deepEqual(schedulingAccounts, ['main', 'backup']);
            const assignmentCounts = new Map<string, number>();
            for (let leadId = 1; leadId <= 200; leadId++) {
                const assigned = pickAccountIdForLead(leadId);
                assert.equal(assigned, pickAccountIdForLead(leadId)); // mapping stabile per lead
                assignmentCounts.set(assigned, (assignmentCounts.get(assigned) ?? 0) + 1);
            }
            const mainCount = assignmentCounts.get('main') ?? 0;
            const backupCount = assignmentCounts.get('backup') ?? 0;
            assert.equal(Math.abs(mainCount - backupCount) <= 1, true);
        } finally {
            config.multiAccountEnabled = originalMultiAccountEnabled;
            config.accountProfiles = originalAccountProfiles;
            config.sessionDir = originalSessionDir;
        }

        // ── proxyManager: PROXY_LIST/PROXY_URL + cooldown failover ──────────────
        const originalProxyListPath = config.proxyListPath;
        const originalProxyUrl = config.proxyUrl;
        const originalProxyUsername = config.proxyUsername;
        const originalProxyPassword = config.proxyPassword;
        const proxyListPath = path.resolve(process.cwd(), 'data', 'test_proxy_list.txt');
        fs.writeFileSync(
            proxyListPath,
            ['# proxy pool test', '127.0.0.1:8080:userA:passA', 'http://127.0.0.2:8081', 'http://127.0.0.2:8081'].join(
                '\n',
            ),
            'utf8',
        );
        try {
            config.proxyListPath = proxyListPath;
            config.proxyUrl = 'http://unused-fallback-proxy:9999';
            config.proxyUsername = '';
            config.proxyPassword = '';

            const poolFromList = getProxyPoolStatus();
            assert.equal(poolFromList.configured, true);
            assert.equal(poolFromList.total, 2);

            const chainFromList = getProxyFailoverChain();
            assert.equal(chainFromList.length, 2);
            const failedProxy = chainFromList[0];
            markProxyFailed(failedProxy);
            const poolAfterFailure = getProxyPoolStatus();
            assert.equal(poolAfterFailure.cooling >= 1, true);

            const chainAfterFailure = getProxyFailoverChain();
            if (chainAfterFailure.length > 1) {
                assert.equal(chainAfterFailure[0].server !== failedProxy.server, true);
            }
            markProxyHealthy(failedProxy);

            // Session pool e integration pool devono avere cooldown indipendenti.
            const integrationStatusBefore = getIntegrationProxyPoolStatus();
            assert.equal(integrationStatusBefore.cooling, 0);

            markProxyFailed(failedProxy);
            const sessionAfterSessionFailure = getProxyPoolStatus();
            const integrationAfterSessionFailure = getIntegrationProxyPoolStatus();
            assert.equal(sessionAfterSessionFailure.cooling >= 1, true);
            assert.equal(integrationAfterSessionFailure.cooling, 0);
            markProxyHealthy(failedProxy);

            markIntegrationProxyFailed(failedProxy);
            const sessionAfterIntegrationFailure = getProxyPoolStatus();
            const integrationAfterIntegrationFailure = getIntegrationProxyPoolStatus();
            assert.equal(sessionAfterIntegrationFailure.cooling, 0);
            assert.equal(integrationAfterIntegrationFailure.cooling >= 1, true);

            const integrationChainAfterFailure = getIntegrationProxyFailoverChain();
            if (integrationChainAfterFailure.length > 1) {
                assert.equal(integrationChainAfterFailure[0].server !== failedProxy.server, true);
            }
            markIntegrationProxyHealthy(failedProxy);

            config.proxyListPath = '';
            config.proxyUrl = 'http://singleUser:singlePass@127.0.0.3:8082';
            const poolFromUrl = getProxyPoolStatus();
            assert.equal(poolFromUrl.configured, true);
            assert.equal(poolFromUrl.total, 1);

            const singleProxy = getProxy();
            assert.equal(singleProxy?.server, 'http://127.0.0.3:8082');
            assert.equal(singleProxy?.username, 'singleUser');
            assert.equal(singleProxy?.password, 'singlePass');
        } finally {
            config.proxyListPath = originalProxyListPath;
            config.proxyUrl = originalProxyUrl;
            config.proxyUsername = originalProxyUsername;
            config.proxyPassword = originalProxyPassword;
            if (fs.existsSync(proxyListPath)) {
                fs.unlinkSync(proxyListPath);
            }
        }

        // ── integrationPolicy: circuit breaker OPEN/HALF_OPEN/CLOSED ───────────
        const originalCircuitEnabled = config.integrationCircuitBreakerEnabled;
        const originalCircuitThreshold = config.integrationCircuitFailureThreshold;
        const originalCircuitOpenMs = config.integrationCircuitOpenMs;
        const originalIntegrationRetryMaxAttempts = config.integrationRetryMaxAttempts;
        try {
            config.integrationCircuitBreakerEnabled = true;
            config.integrationCircuitFailureThreshold = 1;
            config.integrationCircuitOpenMs = 60;
            config.integrationRetryMaxAttempts = 1;
            resetCircuitBreakersForTests();

            await assert.rejects(() =>
                executeWithRetryPolicy(
                    async () => {
                        throw new Error('timeout while calling remote');
                    },
                    {
                        integration: 'unit.circuit.failure',
                        circuitKey: 'unit.circuit',
                        maxAttempts: 1,
                    },
                ),
            );

            const afterOpen = getCircuitBreakerSnapshot().find((row) => row.key === 'unit.circuit');
            assert.ok(afterOpen);
            assert.equal(afterOpen?.status, 'OPEN');
            assert.equal((afterOpen?.openedCount ?? 0) >= 1, true);
            assert.equal((afterOpen?.totalFailures ?? 0) >= 1, true);

            await assert.rejects(
                () =>
                    executeWithRetryPolicy(async () => 'should-not-run', {
                        integration: 'unit.circuit.blocked',
                        circuitKey: 'unit.circuit',
                        maxAttempts: 1,
                    }),
                (error: unknown) => error instanceof CircuitOpenError,
            );

            const afterBlocked = getCircuitBreakerSnapshot().find((row) => row.key === 'unit.circuit');
            assert.ok(afterBlocked);
            assert.equal((afterBlocked?.blockedCount ?? 0) >= 1, true);

            await new Promise((resolve) => setTimeout(resolve, 80));
            const probeResult = await executeWithRetryPolicy(async () => 'ok-half-open-probe', {
                integration: 'unit.circuit.recovery',
                circuitKey: 'unit.circuit',
                maxAttempts: 1,
            });
            assert.equal(probeResult, 'ok-half-open-probe');

            const afterRecovery = getCircuitBreakerSnapshot().find((row) => row.key === 'unit.circuit');
            assert.ok(afterRecovery);
            assert.equal(afterRecovery?.status, 'CLOSED');
            assert.equal((afterRecovery?.halfOpenCount ?? 0) >= 1, true);
            assert.equal((afterRecovery?.closedCount ?? 0) >= 1, true);
            assert.equal((afterRecovery?.totalSuccesses ?? 0) >= 1, true);
        } finally {
            config.integrationCircuitBreakerEnabled = originalCircuitEnabled;
            config.integrationCircuitFailureThreshold = originalCircuitThreshold;
            config.integrationCircuitOpenMs = originalCircuitOpenMs;
            config.integrationRetryMaxAttempts = originalIntegrationRetryMaxAttempts;
            resetCircuitBreakersForTests();
        }

        // ── noteGenerator ────────────────────────────────────────────────────────
        const note1 = generateInviteNote('Mario');
        assert.equal(note1.note.length > 0, true);
        assert.equal(note1.note.includes('Mario'), true);
        assert.equal(note1.note.length <= 300, true);

        const note2 = generateInviteNote('');
        assert.equal(note2.note.length > 0, true); // fallback su 'collega'

        const significantLift = computeTwoProportionSignificance(80, 400, 120, 400, 0.05);
        assert.equal(significantLift.significant, true);
        assert.equal(significantLift.pValue !== null && significantLift.pValue < 0.05, true);

        const nonSignificantLift = computeTwoProportionSignificance(20, 200, 22, 200, 0.05);
        assert.equal(nonSignificantLift.significant, false);

        const bayesLowDataScore = computeBayesianBanditScore(5, 1, 100);
        const bayesHighDataScore = computeBayesianBanditScore(200, 80, 1000);
        assert.equal(Number.isFinite(bayesLowDataScore), true);
        assert.equal(Number.isFinite(bayesHighDataScore), true);

        const significantBanditDecision = evaluateBanditDecision(
            ['A', 'B'],
            [
                { variantId: 'A', sent: 500, accepted: 100, replied: 40 },
                { variantId: 'B', sent: 500, accepted: 150, replied: 60 },
            ],
            {
                alpha: 0.05,
                minSampleSize: 50,
            },
        );
        assert.equal(significantBanditDecision.mode, 'significant_winner');
        assert.equal(significantBanditDecision.selectedVariant, 'B');
        assert.equal(significantBanditDecision.winner?.baselineVariant, 'A');
        assert.equal((significantBanditDecision.winner?.pValue ?? 1) < 0.05, true);

        const bayesBanditDecision = evaluateBanditDecision(
            ['A', 'B'],
            [
                { variantId: 'A', sent: 20, accepted: 6, replied: 1 },
                { variantId: 'B', sent: 18, accepted: 7, replied: 2 },
            ],
            {
                alpha: 0.05,
                minSampleSize: 50,
            },
        );
        assert.equal(bayesBanditDecision.mode, 'bayes');
        assert.equal(['A', 'B'].includes(bayesBanditDecision.selectedVariant), true);
        assert.equal(bayesBanditDecision.winner, null);

        // ── uiFallback ranking + post-action verification ──────────────────────
        const rankedSelectors = rankSelectorCandidates([
            {
                selector: '//button[contains(.,"Send")]',
                source: 'static',
                confidence: 0.35,
                successCount: 0,
                order: 2,
            },
            {
                selector: 'button[data-control-name="send"]',
                source: 'dynamic',
                confidence: 0.9,
                successCount: 12,
                order: 0,
            },
            {
                selector: 'button.msg-form__send-button',
                source: 'static',
                confidence: 0.35,
                successCount: 0,
                order: 0,
            },
        ]);
        assert.equal(rankedSelectors[0]?.selector, 'button[data-control-name="send"]');
        assert.equal(rankedSelectors[0]?.source, 'dynamic');
        assert.equal((rankedSelectors[0]?.score ?? 0) > (rankedSelectors[1]?.score ?? 0), true);

        const clickAttempts: string[] = [];
        const verifyAttempts: string[] = [];
        const fakePage = {
            locator: (selector: string) => ({
                first: () => ({
                    click: async () => {
                        clickAttempts.push(selector);
                    },
                    boundingBox: async () => null,
                }),
            }),
            waitForTimeout: async () => undefined,
            url: () => 'https://example.test/profile',
            screenshot: async () => Buffer.from(''),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        await clickWithFallback(fakePage, ['button.bad-target', 'button.good-target'], 'unit.click.verify', {
            timeoutPerSelector: 50,
            verify: async (_page, selectedSelector) => {
                verifyAttempts.push(selectedSelector);
                return selectedSelector === 'button.good-target';
            },
        });
        assert.deepEqual(verifyAttempts, ['button.bad-target', 'button.good-target']);
        assert.deepEqual(clickAttempts, ['button.bad-target', 'button.good-target']);

        // Context cache: il selettore che ha funzionato viene privilegiato nello stesso contesto pagina.
        resetSelectorContextCacheForTests();
        const cacheAttempts: string[] = [];
        const fakeCachePage = {
            locator: (selector: string) => ({
                first: () => ({
                    click: async () => {
                        cacheAttempts.push(selector);
                    },
                    boundingBox: async () => null,
                }),
            }),
            waitForTimeout: async () => undefined,
            url: () => 'https://www.linkedin.com/in/cache-test-user/',
            screenshot: async () => Buffer.from(''),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        await clickWithFallback(
            fakeCachePage,
            ['button.cached-target', 'button.other-target'],
            'unit.context.cache',
            50,
        );
        await clickWithFallback(
            fakeCachePage,
            ['button.other-target', 'button.cached-target'],
            'unit.context.cache',
            50,
        );

        // 1st click usa l'ordine input, 2nd click riusa il target in cache e lo mette in testa.
        assert.deepEqual(cacheAttempts, ['button.cached-target', 'button.cached-target']);

        // Retry policy contestuale per tipo errore worker.
        const selectorRetryPolicy = resolveWorkerRetryPolicy(
            new RetryableWorkerError('Textbox non trovata', 'TEXTBOX_NOT_FOUND'),
            5,
            1000,
        );
        assert.equal(selectorRetryPolicy.retryable, true);
        assert.equal(selectorRetryPolicy.maxAttempts, 2);
        assert.equal(selectorRetryPolicy.category, 'ui_selector');
        assert.equal(selectorRetryPolicy.baseDelayMs >= 2000, true);

        const quotaRetryPolicy = resolveWorkerRetryPolicy(
            new RetryableWorkerError('Limite settimanale raggiunto', 'WEEKLY_LIMIT_REACHED'),
            5,
            1000,
        );
        assert.equal(quotaRetryPolicy.retryable, false);
        assert.equal(quotaRetryPolicy.maxAttempts, 1);
        assert.equal(quotaRetryPolicy.baseDelayMs, 0);
        assert.equal(quotaRetryPolicy.category, 'quota');

        const transientRetryPolicy = resolveWorkerRetryPolicy(new Error('Timeout 30000ms exceeded'), 5, 1000);
        assert.equal(transientRetryPolicy.retryable, true);
        assert.equal(transientRetryPolicy.maxAttempts <= 3, true);
        assert.equal(transientRetryPolicy.category, 'ui_transient');

        // Follow-up cadence intent-aware con jitter deterministico + escalation.
        const originalFollowUpDelayDays = config.followUpDelayDays;
        const originalFollowUpQuestionsDelayDays = config.followUpQuestionsDelayDays;
        const originalFollowUpNegativeDelayDays = config.followUpNegativeDelayDays;
        const originalFollowUpNotInterestedDelayDays = config.followUpNotInterestedDelayDays;
        const originalFollowUpDelayStddevDays = config.followUpDelayStddevDays;
        const originalFollowUpDelayEscalationFactor = config.followUpDelayEscalationFactor;
        try {
            config.followUpDelayDays = 5;
            config.followUpQuestionsDelayDays = 3;
            config.followUpNegativeDelayDays = 30;
            config.followUpNotInterestedDelayDays = 60;
            config.followUpDelayStddevDays = 0;
            config.followUpDelayEscalationFactor = 0.5;

            const cadenceQuestions = resolveFollowUpCadence(
                {
                    id: 101,
                    messaged_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
                    follow_up_sent_at: null,
                    follow_up_count: 0,
                },
                {
                    intent: 'QUESTIONS',
                    subIntent: 'PRICE_INQUIRY',
                    confidence: 0.9,
                    entities: ['prezzo'],
                },
            );
            assert.equal(cadenceQuestions.baseDelayDays, 3);
            assert.equal(cadenceQuestions.requiredDelayDays, 3);
            assert.equal(cadenceQuestions.reason, 'intent_questions');

            const cadenceNotInterested = resolveFollowUpCadence(
                {
                    id: 102,
                    messaged_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
                    follow_up_sent_at: null,
                    follow_up_count: 0,
                },
                {
                    intent: 'NOT_INTERESTED',
                    subIntent: 'NONE',
                    confidence: 0.95,
                    entities: [],
                },
            );
            assert.equal(cadenceNotInterested.baseDelayDays, 60);
            // M29: requiredDelayDays = baseDelay(60) + stepDelay(0) + jitter(seededUnit(102*7)=1) = 61
            assert.equal(cadenceNotInterested.requiredDelayDays, 61);
            assert.equal(cadenceNotInterested.reason, 'intent_not_interested');

            const cadenceEscalated = resolveFollowUpCadence(
                {
                    id: 103,
                    messaged_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
                    follow_up_sent_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
                    follow_up_count: 2,
                },
                {
                    intent: 'NEGATIVE',
                    subIntent: 'OBJECTION_HANDLING',
                    confidence: 0.85,
                    entities: [],
                },
            );
            assert.equal(cadenceEscalated.baseDelayDays >= config.followUpQuestionsDelayDays, true);
            assert.equal(cadenceEscalated.escalationMultiplier > 1, true);
            assert.equal(cadenceEscalated.requiredDelayDays > cadenceEscalated.baseDelayDays, true);
            assert.equal(cadenceEscalated.referenceAt !== null, true);

            // Con stddev=0 la cadenza e' deterministica e ripetibile.
            const cadenceRepeatA = resolveFollowUpCadence(
                {
                    id: 104,
                    messaged_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
                    follow_up_sent_at: null,
                    follow_up_count: 1,
                },
                {
                    intent: 'NEUTRAL',
                    subIntent: 'NONE',
                    confidence: 0.7,
                    entities: [],
                },
            );
            const cadenceRepeatB = resolveFollowUpCadence(
                {
                    id: 104,
                    messaged_at: cadenceRepeatA.referenceAt,
                    follow_up_sent_at: null,
                    follow_up_count: 1,
                },
                {
                    intent: 'NEUTRAL',
                    subIntent: 'NONE',
                    confidence: 0.7,
                    entities: [],
                },
            );
            assert.equal(cadenceRepeatA.requiredDelayDays, cadenceRepeatB.requiredDelayDays);
            assert.equal(cadenceRepeatA.jitterDays, cadenceRepeatB.jitterDays);
        } finally {
            config.followUpDelayDays = originalFollowUpDelayDays;
            config.followUpQuestionsDelayDays = originalFollowUpQuestionsDelayDays;
            config.followUpNegativeDelayDays = originalFollowUpNegativeDelayDays;
            config.followUpNotInterestedDelayDays = originalFollowUpNotInterestedDelayDays;
            config.followUpDelayStddevDays = originalFollowUpDelayStddevDays;
            config.followUpDelayEscalationFactor = originalFollowUpDelayEscalationFactor;
        }

        const selectorModelStable = assessSelectorModelDegradation({
            baselineOpenFailures: 6,
            currentOpenFailures: 7,
            degradeRatio: 0.35,
            degradeMinDelta: 2,
        });
        assert.equal(selectorModelStable.degraded, false);
        assert.equal(selectorModelStable.requiredIncrease, 3);

        const selectorModelDegraded = assessSelectorModelDegradation({
            baselineOpenFailures: 6,
            currentOpenFailures: 9,
            degradeRatio: 0.35,
            degradeMinDelta: 2,
        });
        assert.equal(selectorModelDegraded.degraded, true);
        assert.equal(selectorModelDegraded.absoluteIncrease, 3);

        const selectorModelColdStart = assessSelectorModelDegradation({
            baselineOpenFailures: 0,
            currentOpenFailures: 2,
            degradeRatio: 0.35,
            degradeMinDelta: 2,
        });
        assert.equal(selectorModelColdStart.degraded, true);

        const rampHealthy = computeNonLinearRampCap({
            channel: 'invite',
            currentCap: 5,
            hardMaxCap: 20,
            baseDailyIncrease: 0.05,
            accountAgeDays: 120,
            warmupDays: 180,
            riskAction: 'NORMAL',
            riskScore: 28,
            pendingRatio: 0.2,
            errorRate: 0.05,
            healthScore: 84,
        });
        assert.equal(rampHealthy.nextCap >= 5, true);
        assert.equal(rampHealthy.nextCap <= 20, true);
        assert.equal(rampHealthy.safetyFactor > 0.7, true);

        const rampWarn = computeNonLinearRampCap({
            channel: 'invite',
            currentCap: 12,
            hardMaxCap: 20,
            baseDailyIncrease: 0.05,
            accountAgeDays: 120,
            warmupDays: 180,
            riskAction: 'WARN',
            riskScore: 65,
            pendingRatio: 0.7,
            errorRate: 0.22,
            healthScore: 55,
        });
        assert.equal(rampWarn.nextCap <= 12, true);
        assert.equal(rampWarn.safetyFactor < rampHealthy.safetyFactor, true);

        const rampStop = computeNonLinearRampCap({
            channel: 'message',
            currentCap: 18,
            hardMaxCap: 30,
            baseDailyIncrease: 0.05,
            accountAgeDays: 300,
            warmupDays: 180,
            riskAction: 'STOP',
            riskScore: 95,
            pendingRatio: 0.85,
            errorRate: 0.3,
            healthScore: 45,
        });
        assert.equal(rampStop.nextCap <= 9, true);
        assert.equal(rampStop.nextCap >= 1, true);

        // ── plugin loader security policy ───────────────────────────────────────
        const { PluginRegistry } = await import('../plugins/pluginLoader');
        const pluginDir = path.resolve(process.cwd(), 'data', 'test_plugins_secure');
        const pluginEntry = 'securePlugin.js';
        const pluginPath = path.join(pluginDir, pluginEntry);
        const pluginManifestPath = path.join(pluginDir, 'securePlugin.manifest.json');
        const pluginCode = [
            'module.exports = {',
            '  default: {',
            "    name: 'secure-test-plugin',",
            "    version: '1.0.0',",
            '    async onIdle() { return; }',
            '  }',
            '};',
        ].join('\n');
        const pluginHash = createHash('sha256').update(pluginCode).digest('hex');

        const originalPluginDir = process.env.PLUGIN_DIR;
        const originalPluginDirAllowlist = process.env.PLUGIN_DIR_ALLOWLIST;
        const originalPluginAllowlist = process.env.PLUGIN_ALLOWLIST;
        const originalPluginAllowTs = process.env.PLUGIN_ALLOW_TS;
        const originalPluginExampleMarkerFile = process.env.PLUGIN_EXAMPLE_MARKER_FILE;
        fs.mkdirSync(pluginDir, { recursive: true });
        fs.writeFileSync(pluginPath, pluginCode, 'utf8');

        try {
            process.env.PLUGIN_DIR = pluginDir;
            process.env.PLUGIN_DIR_ALLOWLIST = pluginDir;
            process.env.PLUGIN_ALLOWLIST = 'secure-test-plugin';
            process.env.PLUGIN_ALLOW_TS = 'false';

            fs.writeFileSync(
                pluginManifestPath,
                JSON.stringify({
                    name: 'secure-test-plugin',
                    version: '1.0.0',
                    entry: pluginEntry,
                    enabled: true,
                    integritySha256: pluginHash,
                    allowedHooks: ['onIdle'],
                }),
                'utf8',
            );
            const validRegistry = new PluginRegistry();
            await validRegistry.load();
            assert.equal(validRegistry.count, 1);

            fs.writeFileSync(
                pluginManifestPath,
                JSON.stringify({
                    name: 'secure-test-plugin',
                    version: '1.0.0',
                    entry: pluginEntry,
                    enabled: true,
                    integritySha256: 'deadbeef',
                    allowedHooks: ['onIdle'],
                }),
                'utf8',
            );
            const invalidRegistry = new PluginRegistry();
            await invalidRegistry.load();
            assert.equal(invalidRegistry.count, 0);

            // Smoke test plugin reale in codebase (JS + manifest + hook execution).
            const markerPath = path.resolve(process.cwd(), 'data', 'test_example_plugin.marker.jsonl');
            if (fs.existsSync(markerPath)) {
                fs.unlinkSync(markerPath);
            }

            process.env.PLUGIN_DIR = path.resolve(process.cwd(), 'plugins');
            process.env.PLUGIN_DIR_ALLOWLIST = path.resolve(process.cwd(), 'plugins/examples');
            process.env.PLUGIN_DIR = path.resolve(process.cwd(), 'plugins/examples');
            process.env.PLUGIN_ALLOWLIST = 'example-engagement-booster';
            process.env.PLUGIN_ALLOW_TS = 'false';
            process.env.PLUGIN_EXAMPLE_MARKER_FILE = markerPath;

            const exampleRegistry = new PluginRegistry();
            await exampleRegistry.load();
            assert.equal(exampleRegistry.count, 1);
            await exampleRegistry.init();
            await exampleRegistry.fireIdle({
                cycle: 1,
                workflow: 'all',
                localDate: '2026-03-02',
            });
            await exampleRegistry.fireDailyReport({
                date: '2026-03-02',
                invited: 3,
                accepted: 2,
                messaged: 1,
                replied: 1,
                acceptRate: 2 / 3,
                replyRate: 1 / 3,
            });
            // fireIdle/fireDailyReport sono non bloccanti: lasciamo completare hook async.
            await new Promise((resolve) => setTimeout(resolve, 30));
            await exampleRegistry.shutdown();

            assert.equal(fs.existsSync(markerPath), true);
            const markerLines = fs
                .readFileSync(markerPath, 'utf8')
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.length > 0);
            assert.equal(markerLines.length >= 4, true);
            const markerEvents = markerLines
                .map((line) => JSON.parse(line) as { event?: string })
                .map((entry) => entry.event ?? '');
            assert.equal(markerEvents.includes('onInit'), true);
            assert.equal(markerEvents.includes('onIdle'), true);
            assert.equal(markerEvents.includes('onDailyReport'), true);
            assert.equal(markerEvents.includes('onShutdown'), true);

            fs.unlinkSync(markerPath);
        } finally {
            if (originalPluginDir === undefined) delete process.env.PLUGIN_DIR;
            else process.env.PLUGIN_DIR = originalPluginDir;
            if (originalPluginDirAllowlist === undefined) delete process.env.PLUGIN_DIR_ALLOWLIST;
            else process.env.PLUGIN_DIR_ALLOWLIST = originalPluginDirAllowlist;
            if (originalPluginAllowlist === undefined) delete process.env.PLUGIN_ALLOWLIST;
            else process.env.PLUGIN_ALLOWLIST = originalPluginAllowlist;
            if (originalPluginAllowTs === undefined) delete process.env.PLUGIN_ALLOW_TS;
            else process.env.PLUGIN_ALLOW_TS = originalPluginAllowTs;
            if (originalPluginExampleMarkerFile === undefined) delete process.env.PLUGIN_EXAMPLE_MARKER_FILE;
            else process.env.PLUGIN_EXAMPLE_MARKER_FILE = originalPluginExampleMarkerFile;

            if (fs.existsSync(pluginDir)) {
                fs.rmSync(pluginDir, { recursive: true, force: true });
            }
        }

        // ── selectors ────────────────────────────────────────────────────────────
        // SELECTORS è ora un array di priorità (readonly string[]).
        // Ogni chiave deve avere almeno 2 selettori per garantire fault-tolerance UI.
        for (const [key, value] of Object.entries(SELECTORS)) {
            if (Array.isArray(value)) {
                assert.equal(
                    value.length >= 2,
                    true,
                    `Selector "${key}" ha meno di 2 alternative (${value.length}). Aggiungere almeno un fallback per fault-tolerance UI.`,
                );
            }
        }

        // ── Mouse Trajectories & AI Typos & Timing ─────────────────────────────
        const { MouseGenerator } = await import('../ml/mouseGenerator');
        const mousePath = MouseGenerator.generatePath({ x: 0, y: 0 }, { x: 100, y: 100 }, 10);
        assert.equal(mousePath.length, 11);
        assert.equal(mousePath[0]?.x, 0);
        assert.equal(mousePath[mousePath.length - 1]?.x, 100);
        assert.equal(mousePath[mousePath.length - 1]?.y, 100);

        const { determineNextKeystroke } = await import('../ai/typoGenerator');
        let typoFound = false;
        for (let i = 0; i < 100; i++) {
            const { isTypo } = determineNextKeystroke('a', 0.5);
            if (isTypo) typoFound = true;
        }
        assert.equal(typoFound, true);

        const { calculateContextualDelay } = await import('../ml/timingModel');
        const testDelay = calculateContextualDelay({
            actionType: 'read',
            baseMin: 100,
            baseMax: 200,
            contentLength: 500,
        });
        assert.equal(testDelay > 0, true);

        // ── Vision Solver (P1-06) ──────────────────────────────────────────────
        const { VisionSolver } = await import('../captcha/solver');
        const solver = new VisionSolver({ endpoint: 'http://test-endpoint.local' });
        assert.equal(solver !== undefined, true);

        // rimosso stealth
        // rimosso throttler
    });
});
