import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ParsedAutomationCommandRecord } from '../automation/types';
import type { PreflightResult, WorkflowExecutionResult, WorkflowReport } from '../workflows/types';
import { buildPreflightBlockedResult, buildResultFromReport } from '../workflows/services/shared';

const mocks = vi.hoisted(() => ({
    executeSyncSearchWorkflow: vi.fn(),
    executeSyncListWorkflow: vi.fn(),
    executeSendInvitesWorkflow: vi.fn(),
    executeSendMessagesWorkflow: vi.fn(),
    runWorkflow: vi.fn(),
    runSyncSearchWorkflow: vi.fn(),
    formatWorkflowExecutionResult: vi.fn(),
    sendWorkflowExecutionTelegramReport: vi.fn(),
    askConfirmation: vi.fn(),
    isInteractiveTTY: vi.fn(),
    readLineFromStdin: vi.fn(),
    askChoice: vi.fn(),
    askNumber: vi.fn(),
    getRuntimeFlag: vi.fn(),
    selectAccount: vi.fn(),
    collectDbStats: vi.fn(),
    collectConfigStatus: vi.fn(),
    appendProxyReputationWarning: vi.fn(),
    computeSessionRiskLevel: vi.fn(),
    runAiAdvisor: vi.fn(),
    displayAiAdvice: vi.fn(),
    displayConfigStatus: vi.fn(),
    displayDbStats: vi.fn(),
    displayWarnings: vi.fn(),
    runAntiBanChecklist: vi.fn(),
}));

vi.mock('../workflows/services/syncSearchService', () => ({
    executeSyncSearchWorkflow: mocks.executeSyncSearchWorkflow,
}));

vi.mock('../workflows/services/syncListService', () => ({
    executeSyncListWorkflow: mocks.executeSyncListWorkflow,
}));

vi.mock('../workflows/services/sendInvitesService', () => ({
    executeSendInvitesWorkflow: mocks.executeSendInvitesWorkflow,
}));

vi.mock('../workflows/services/sendMessagesService', () => ({
    executeSendMessagesWorkflow: mocks.executeSendMessagesWorkflow,
}));

vi.mock('../core/orchestrator', () => ({
    runWorkflow: mocks.runWorkflow,
}));

vi.mock('../workflows/syncSearchWorkflow', () => ({
    runSyncSearchWorkflow: mocks.runSyncSearchWorkflow,
}));

vi.mock('../workflows/reportFormatter', () => ({
    formatWorkflowExecutionResult: mocks.formatWorkflowExecutionResult,
    sendWorkflowExecutionTelegramReport: mocks.sendWorkflowExecutionTelegramReport,
}));

vi.mock('../cli/stdinHelper', () => ({
    askConfirmation: mocks.askConfirmation,
    isInteractiveTTY: mocks.isInteractiveTTY,
    readLineFromStdin: mocks.readLineFromStdin,
    askChoice: mocks.askChoice,
    askNumber: mocks.askNumber,
}));

vi.mock('../core/repositories', async () => {
    const actual = await vi.importActual<typeof import('../core/repositories')>('../core/repositories');
    return {
        ...actual,
        getRuntimeFlag: mocks.getRuntimeFlag,
    };
});

vi.mock('../workflows/preflight/accountSelector', () => ({
    selectAccount: mocks.selectAccount,
}));

vi.mock('../workflows/preflight/statsCollector', () => ({
    collectDbStats: mocks.collectDbStats,
}));

vi.mock('../workflows/preflight/configInspector', () => ({
    collectConfigStatus: mocks.collectConfigStatus,
    appendProxyReputationWarning: mocks.appendProxyReputationWarning,
}));

vi.mock('../workflows/preflight/riskAssessor', () => ({
    computeSessionRiskLevel: mocks.computeSessionRiskLevel,
}));

vi.mock('../workflows/preflight/aiAdvisor', () => ({
    runAiAdvisor: mocks.runAiAdvisor,
}));

vi.mock('../workflows/preflight/presenter', () => ({
    displayAiAdvice: mocks.displayAiAdvice,
    displayConfigStatus: mocks.displayConfigStatus,
    displayDbStats: mocks.displayDbStats,
    displayWarnings: mocks.displayWarnings,
}));

vi.mock('../workflows/preflight/antiBanChecklist', () => ({
    runAntiBanChecklist: mocks.runAntiBanChecklist,
}));

import { dispatchAutomationCommand } from '../automation/dispatcher';
import { runPreflight } from '../workflows/preflight';
import { runSendInvitesWorkflow } from '../workflows/sendInvitesWorkflow';

function buildDbStats() {
    return {
        totalLeads: 0,
        byStatus: {},
        byList: {},
        withEmail: 0,
        withoutEmail: 0,
        withScore: 0,
        withJobTitle: 0,
        withPhone: 0,
        withLocation: 0,
        lastSyncAt: null,
        trend: null,
    };
}

function buildConfigStatus() {
    return {
        proxyConfigured: true,
        apolloConfigured: true,
        hunterConfigured: true,
        clearbitConfigured: false,
        aiConfigured: true,
        supabaseConfigured: true,
        growthModelEnabled: true,
        weeklyStrategyEnabled: true,
        warmupEnabled: false,
        budgetInvites: 10,
        budgetMessages: 10,
        invitesSentToday: 0,
        messagesSentToday: 0,
        weeklyInvitesSent: 0,
        weeklyInviteLimit: 100,
        proxyIpReputation: null,
        staleAccounts: [],
        noLoginAccounts: [],
    };
}

function buildPreflight(
    overrides: Partial<PreflightResult<Record<string, unknown>>> = {},
): PreflightResult<Record<string, unknown>> {
    return {
        answers: {},
        rawAnswers: {},
        dbStats: buildDbStats(),
        configStatus: buildConfigStatus(),
        warnings: [],
        confirmed: false,
        ...overrides,
    };
}

function resetCommonMocks(): void {
    vi.clearAllMocks();
    mocks.formatWorkflowExecutionResult.mockReturnValue('formatted report');
    mocks.sendWorkflowExecutionTelegramReport.mockResolvedValue(undefined);
    mocks.askConfirmation.mockResolvedValue(false);
    mocks.isInteractiveTTY.mockReturnValue(false);
    mocks.readLineFromStdin.mockResolvedValue('');
    mocks.askChoice.mockResolvedValue('');
    mocks.askNumber.mockResolvedValue(0);
    mocks.getRuntimeFlag.mockResolvedValue(null);
    mocks.selectAccount.mockResolvedValue(null);
    mocks.collectDbStats.mockResolvedValue(buildDbStats());
    mocks.collectConfigStatus.mockResolvedValue(buildConfigStatus());
    mocks.computeSessionRiskLevel.mockResolvedValue({
        level: 'GO',
        score: 10,
        factors: {},
        recommendation: 'OK',
    });
    mocks.runAiAdvisor.mockResolvedValue(undefined);
    mocks.runAntiBanChecklist.mockResolvedValue(true);
    mocks.runSyncSearchWorkflow.mockResolvedValue(undefined);
}

describe('workflow result helpers', () => {
    test('preflight cancel produce USER_CANCELLED', () => {
        const result = buildPreflightBlockedResult('send-invites', buildPreflight());

        expect(result.success).toBe(false);
        expect(result.blocked?.reason).toBe('USER_CANCELLED');
        expect(result.artifacts?.preflight).toBeTruthy();
    });

    test('preflight con warning critico produce PRECONDITION_FAILED', () => {
        const result = buildPreflightBlockedResult(
            'send-messages',
            buildPreflight({
                warnings: [{ level: 'critical', message: 'budget esaurito' }],
            }),
        );

        expect(result.blocked?.reason).toBe('PRECONDITION_FAILED');
    });

    test('formatter gestisce un blocked result strutturato', async () => {
        const { formatWorkflowExecutionResult: actualFormatWorkflowExecutionResult } =
            await vi.importActual<typeof import('../workflows/reportFormatter')>('../workflows/reportFormatter');
        const output = actualFormatWorkflowExecutionResult({
            workflow: 'sync-list',
            success: false,
            blocked: {
                reason: 'AUTOMATION_PAUSED',
                message: 'Automazione in pausa',
            },
            summary: {
                lista: 'target-a',
            },
            errors: [],
            nextAction: 'Riprendi il bot prima di rilanciare.',
        });

        expect(output).toContain('AUTOMATION_PAUSED');
        expect(output).toContain('target-a');
    });

    test('buildResultFromReport mantiene il report negli artifacts', () => {
        const report: WorkflowReport = {
            workflow: 'sync-search',
            startedAt: new Date('2026-04-01T10:00:00Z'),
            finishedAt: new Date('2026-04-01T10:05:00Z'),
            success: true,
            summary: { lead_inseriti: 12 },
            errors: [],
            nextAction: 'Esegui send-invites',
        };

        const result = buildResultFromReport('sync-search', report, {
            candidateCount: 12,
        });

        expect(result.success).toBe(true);
        expect(result.artifacts?.report).toEqual(report);
        expect(result.artifacts?.candidateCount).toBe(12);
    });
});

describe('automation dispatcher', () => {
    beforeEach(() => {
        resetCommonMocks();
    });

    test('propaga il risultato strutturato del service pubblico', async () => {
        const serviceResult: WorkflowExecutionResult = {
            workflow: 'sync-search',
            success: true,
            blocked: null,
            summary: { lista_target: 'lista-a' },
            errors: [],
            nextAction: 'send-invites',
        };
        mocks.executeSyncSearchWorkflow.mockResolvedValue(serviceResult);

        const command: ParsedAutomationCommandRecord = {
            id: 1,
            requestId: 'req-1',
            kind: 'sync-search',
            payload: { listName: 'lista-a' },
            source: 'n8n',
            idempotencyKey: 'sync-search:req-1',
            status: 'RUNNING',
            claimedBy: 'loop:1',
            startedAt: null,
            finishedAt: null,
            result: null,
            lastError: null,
            createdAt: '2026-04-01T10:00:00Z',
            updatedAt: '2026-04-01T10:00:00Z',
        };

        const result = await dispatchAutomationCommand(command);

        expect(result).toEqual(serviceResult);
        expect(mocks.executeSyncSearchWorkflow).toHaveBeenCalledWith({
            listName: 'lista-a',
            dryRun: false,
            skipPreflight: true,
        });
    });

    test('mappa il workflow legacy bloccato in un risultato strutturato', async () => {
        mocks.runWorkflow.mockResolvedValue({
            status: 'blocked',
            blocked: {
                reason: 'AUTOMATION_PAUSED',
                message: 'Automazione in pausa',
            },
            localDate: '2026-04-01',
        });

        const command: ParsedAutomationCommandRecord = {
            id: 2,
            requestId: 'req-2',
            kind: 'workflow-check',
            payload: { workflow: 'check' },
            source: 'legacy',
            idempotencyKey: 'workflow-check:req-2',
            status: 'RUNNING',
            claimedBy: 'loop:1',
            startedAt: null,
            finishedAt: null,
            result: null,
            lastError: null,
            createdAt: '2026-04-01T10:00:00Z',
            updatedAt: '2026-04-01T10:00:00Z',
        };

        const result = await dispatchAutomationCommand(command);

        expect(result.success).toBe(false);
        expect(result.workflow).toBe('workflow-check');
        expect(result.blocked?.reason).toBe('AUTOMATION_PAUSED');
        expect(result.summary).toEqual({ workflow: 'check' });
    });

    test('sync-list forza interactive false e skipPreflight true', async () => {
        const serviceResult: WorkflowExecutionResult = {
            workflow: 'sync-list',
            success: true,
            blocked: null,
            summary: { lista_target: 'lista-a' },
            errors: [],
            nextAction: 'send-invites',
        };
        mocks.executeSyncListWorkflow.mockResolvedValue(serviceResult);

        const command: ParsedAutomationCommandRecord = {
            id: 3,
            requestId: 'req-3',
            kind: 'sync-list',
            payload: { listName: 'lista-a', maxPages: 2 },
            source: 'n8n',
            idempotencyKey: 'sync-list:req-3',
            status: 'RUNNING',
            claimedBy: 'loop:1',
            startedAt: null,
            finishedAt: null,
            result: null,
            lastError: null,
            createdAt: '2026-04-01T10:00:00Z',
            updatedAt: '2026-04-01T10:00:00Z',
        };

        const result = await dispatchAutomationCommand(command);

        expect(result).toEqual(serviceResult);
        expect(mocks.executeSyncListWorkflow).toHaveBeenCalledWith({
            listName: 'lista-a',
            maxPages: 2,
            dryRun: false,
            interactive: false,
            skipPreflight: true,
        });
    });

    test('mappa il workflow legacy completato in shape stabile', async () => {
        mocks.runWorkflow.mockResolvedValue({
            status: 'completed',
            blocked: null,
            localDate: '2026-04-01',
        });

        const command: ParsedAutomationCommandRecord = {
            id: 4,
            requestId: 'req-4',
            kind: 'workflow-warmup',
            payload: { workflow: 'warmup' },
            source: 'legacy',
            idempotencyKey: 'workflow-warmup:req-4',
            status: 'RUNNING',
            claimedBy: 'loop:1',
            startedAt: null,
            finishedAt: null,
            result: null,
            lastError: null,
            createdAt: '2026-04-01T10:00:00Z',
            updatedAt: '2026-04-01T10:00:00Z',
        };

        const result = await dispatchAutomationCommand(command);

        expect(result).toEqual({
            workflow: 'workflow-warmup',
            success: true,
            blocked: null,
            summary: {
                workflow: 'warmup',
                status: 'completed',
            },
            errors: [],
            nextAction: 'Workflow legacy warmup completato',
            details: {
                workflow: 'warmup',
                status: 'completed',
            },
        });
    });
});

describe('workflow characterization', () => {
    beforeEach(() => {
        resetCommonMocks();
    });

    test('runPreflight con skipPreflight tipizza le answers senza prompt interattivi', async () => {
        const result = await runPreflight<{ listName: string; limit: number }>({
            workflowName: 'send-invites',
            questions: [
                {
                    id: 'listName',
                    prompt: 'Lista',
                    type: 'string',
                    defaultValue: 'lista-a',
                },
                {
                    id: 'limit',
                    prompt: 'Limite',
                    type: 'number',
                    defaultValue: '5',
                },
            ],
            generateWarnings: () => [{ level: 'info', message: 'ok' }],
            skipPreflight: true,
            parseAnswers: (answers) => ({
                listName: answers['listName'] ?? '',
                limit: Number(answers['limit'] ?? 0),
            }),
        });

        expect(result.confirmed).toBe(true);
        expect(result.answers).toEqual({ listName: 'lista-a', limit: 5 });
        expect(result.warnings).toEqual([{ level: 'info', message: 'ok' }]);
        expect(mocks.askConfirmation).not.toHaveBeenCalled();
        expect(mocks.runAntiBanChecklist).not.toHaveBeenCalled();
    });

    test('runPreflight non interattivo blocca su rischio STOP', async () => {
        mocks.isInteractiveTTY.mockReturnValue(false);
        mocks.computeSessionRiskLevel.mockResolvedValue({
            level: 'STOP',
            score: 91,
            factors: { risk: 91 },
            recommendation: 'stop',
        });

        const result = await runPreflight({
            workflowName: 'send-messages',
            questions: [],
            generateWarnings: () => [],
        });

        expect(result.confirmed).toBe(false);
        expect(result.riskAssessment).toEqual({
            level: 'STOP',
            score: 91,
            factors: { risk: 91 },
            recommendation: 'stop',
        });
        expect(mocks.runAntiBanChecklist).not.toHaveBeenCalled();
    });

    test('adapter CLI send-invites lancia fallback sync-search quando non cè lavoro', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mocks.executeSendInvitesWorkflow.mockResolvedValue({
            workflow: 'send-invites',
            success: false,
            blocked: {
                reason: 'NO_WORK_AVAILABLE',
                message: 'Nessun lead READY_INVITE disponibile',
                details: { listName: 'lista-a' },
            },
            summary: {},
            errors: [],
            nextAction: 'Esegui sync-search',
            artifacts: {
                preflight: buildPreflight({
                    confirmed: true,
                    selectedAccountId: 'acc-1',
                }),
                extra: {
                    totalInDb: 0,
                    newCount: 0,
                },
            },
        });
        mocks.isInteractiveTTY.mockReturnValue(true);
        mocks.askConfirmation.mockResolvedValue(true);
        mocks.readLineFromStdin.mockResolvedValueOnce('search-a').mockResolvedValueOnce('lista-b');

        await runSendInvitesWorkflow({
            dryRun: false,
            listName: 'lista-a',
            accountId: 'acc-fallback',
        });

        expect(mocks.runSyncSearchWorkflow).toHaveBeenCalledWith({
            searchName: 'search-a',
            listName: 'lista-b',
            enrichment: true,
            dryRun: false,
            accountId: 'acc-1',
            skipPreflight: true,
        });
        expect(mocks.sendWorkflowExecutionTelegramReport).toHaveBeenCalledTimes(1);
        logSpy.mockRestore();
    });

    test('adapter CLI send-invites non lancia fallback se il TTY non è interattivo', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mocks.executeSendInvitesWorkflow.mockResolvedValue({
            workflow: 'send-invites',
            success: false,
            blocked: {
                reason: 'NO_WORK_AVAILABLE',
                message: 'Nessun lead READY_INVITE disponibile',
            },
            summary: {},
            errors: [],
            nextAction: 'Esegui sync-search',
        });
        mocks.isInteractiveTTY.mockReturnValue(false);

        await runSendInvitesWorkflow({
            dryRun: false,
        });

        expect(mocks.askConfirmation).not.toHaveBeenCalled();
        expect(mocks.runSyncSearchWorkflow).not.toHaveBeenCalled();
        logSpy.mockRestore();
    });
});
