import { describe, expect, test } from 'vitest';
import type { ParsedAutomationCommandRecord } from '../automation/types';
import { parseAutomationCommandRecord } from '../core/repositories/automationCommands';
import { toPublicAutomationCommandExecutionResult, toPublicAutomationCommandRecord } from '../api/helpers/automationReadModel';

describe('automation read model pubblico', () => {
    test('rimuove artifacts.extra e riduce il preflight a un summary stabile', () => {
        const command: ParsedAutomationCommandRecord = {
            id: 1,
            requestId: 'req-1',
            kind: 'send-invites',
            payload: { listName: 'lista-a' },
            source: 'api_v1',
            idempotencyKey: 'req-1',
            status: 'SUCCEEDED',
            claimedBy: 'loop:1',
            startedAt: '2026-04-01T10:00:00Z',
            finishedAt: '2026-04-01T10:01:00Z',
            result: {
                workflow: 'send-invites',
                success: true,
                blocked: null,
                summary: { invites_sent: 3 },
                errors: [],
                nextAction: 'send-messages',
                artifacts: {
                    preflight: {
                        answers: { listName: 'lista-a' },
                        rawAnswers: { listName: 'lista-a' },
                        dbStats: {
                            totalLeads: 10,
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
                        },
                        configStatus: {
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
                        },
                        warnings: [
                            { level: 'warn', message: 'warning' },
                            { level: 'critical', message: 'critical' },
                        ],
                        confirmed: true,
                        selectedAccountId: 'acc-1',
                        aiAdvice: {
                            available: true,
                            recommendation: 'PROCEED',
                            reasoning: 'ok',
                            suggestedActions: [],
                        },
                    },
                    previewLeads: [{ label: 'Lead A' }],
                    estimatedMinutes: 12,
                    candidateCount: 10,
                    report: {
                        workflow: 'send-invites',
                        startedAt: new Date('2026-04-01T10:00:00Z'),
                        finishedAt: new Date('2026-04-01T10:01:00Z'),
                        success: true,
                        summary: { invites_sent: 3 },
                        errors: [],
                        nextAction: 'send-messages',
                    },
                    extra: {
                        previewMessage: 'internal-only',
                    },
                },
                details: {
                    source: 'internal',
                },
            },
            lastError: null,
            createdAt: '2026-04-01T10:00:00Z',
            updatedAt: '2026-04-01T10:01:00Z',
        };

        const publicCommand = toPublicAutomationCommandRecord(command);

        expect(publicCommand.result?.artifacts).toEqual({
            preflight: {
                confirmed: true,
                selectedAccountId: 'acc-1',
                warningCount: 2,
                criticalWarningCount: 1,
                riskAssessment: undefined,
                hasAiAdvice: true,
            },
            previewLeads: [{ label: 'Lead A' }],
            estimatedMinutes: 12,
            candidateCount: 10,
            report: {
                workflow: 'send-invites',
                startedAt: new Date('2026-04-01T10:00:00Z'),
                finishedAt: new Date('2026-04-01T10:01:00Z'),
                success: true,
                summary: { invites_sent: 3 },
                errors: [],
                nextAction: 'send-messages',
            },
        });
        expect(publicCommand.result?.artifacts).not.toHaveProperty('extra');
        expect(publicCommand.result?.artifacts?.preflight).not.toHaveProperty('answers');
        expect(publicCommand.result?.artifacts?.preflight).not.toHaveProperty('dbStats');
    });

    test('gestisce result null senza inventare shape', () => {
        expect(toPublicAutomationCommandExecutionResult(null)).toBeNull();
    });

    test('mantiene stabile la shape persistita di NO_WORK_AVAILABLE', () => {
        const parsed = parseAutomationCommandRecord({
            id: 2,
            request_id: 'req-2',
            kind: 'send-messages',
            payload_json: JSON.stringify({ listName: 'lista-z' }),
            source: 'api_v1',
            idempotency_key: 'req-2',
            status: 'SUCCEEDED',
            claimed_by: 'loop:2',
            started_at: '2026-04-01T11:00:00Z',
            finished_at: '2026-04-01T11:01:00Z',
            result_json: JSON.stringify({
                workflow: 'send-messages',
                success: false,
                blocked: {
                    reason: 'NO_WORK_AVAILABLE',
                    message: 'Nessun lead disponibile',
                    details: {
                        listName: 'lista-z',
                    },
                },
                summary: {
                    lead_messaggiabili: 0,
                },
                errors: [],
                nextAction: 'Attendi nuove accettazioni',
                artifacts: {
                    candidateCount: 0,
                    extra: {
                        internalOnly: true,
                    },
                },
            }),
            last_error: null,
            created_at: '2026-04-01T11:00:00Z',
            updated_at: '2026-04-01T11:01:00Z',
        });

        const publicCommand = toPublicAutomationCommandRecord(parsed);

        expect(publicCommand.result).toEqual({
            workflow: 'send-messages',
            success: false,
            blocked: {
                reason: 'NO_WORK_AVAILABLE',
                message: 'Nessun lead disponibile',
                details: {
                    listName: 'lista-z',
                },
            },
            summary: {
                lead_messaggiabili: 0,
            },
            errors: [],
            nextAction: 'Attendi nuove accettazioni',
            artifacts: {
                candidateCount: 0,
            },
            details: undefined,
            riskAssessment: undefined,
        });
    });
});
