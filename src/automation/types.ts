import type { WorkflowSelection } from '../core/workflowSelection';
import type {
    SessionRiskAssessment,
    WorkflowBlockedState,
    WorkflowExecutionArtifacts,
    WorkflowSummary,
} from '../workflows/types';

export type PublicAutomationCommandKind = 'sync-search' | 'sync-list' | 'send-invites' | 'send-messages';
export type LegacyAutomationCommandKind = 'workflow-all' | 'workflow-check' | 'workflow-warmup';
export type AutomationCommandKind = PublicAutomationCommandKind | LegacyAutomationCommandKind;
export type AutomationCommandStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

export interface SyncSearchAutomationPayload {
    searchName?: string;
    listName: string;
    maxPages?: number;
    limit?: number;
    enrichment?: boolean;
    accountId?: string;
    noProxy?: boolean;
}

export interface SyncListAutomationPayload {
    listName?: string;
    listUrl?: string;
    maxPages?: number;
    maxLeads?: number;
    enrichment?: boolean;
    accountId?: string;
    noProxy?: boolean;
}

export interface SendInvitesAutomationPayload {
    listName?: string;
    noteMode?: 'ai' | 'template' | 'none';
    minScore?: number;
    limit?: number;
    accountId?: string;
    skipEnrichment?: boolean;
}

export interface SendMessagesAutomationPayload {
    listName?: string;
    template?: string;
    lang?: string;
    limit?: number;
    accountId?: string;
    skipEnrichment?: boolean;
}

export interface WorkflowAutomationPayload {
    workflow: Extract<WorkflowSelection, 'all' | 'check' | 'warmup'>;
}

export interface AutomationCommandPayloadMap {
    'sync-search': SyncSearchAutomationPayload;
    'sync-list': SyncListAutomationPayload;
    'send-invites': SendInvitesAutomationPayload;
    'send-messages': SendMessagesAutomationPayload;
    'workflow-all': WorkflowAutomationPayload;
    'workflow-check': WorkflowAutomationPayload;
    'workflow-warmup': WorkflowAutomationPayload;
}

export type AutomationCommandPayload = AutomationCommandPayloadMap[AutomationCommandKind];

export interface AutomationCommandExecutionResult {
    workflow?: AutomationCommandKind;
    success: boolean;
    blocked: WorkflowBlockedState | null;
    summary: WorkflowSummary;
    errors: string[];
    nextAction: string;
    riskAssessment?: SessionRiskAssessment;
    artifacts?: WorkflowExecutionArtifacts;
    details?: Record<string, unknown>;
}

export interface AutomationCommandRecord {
    id: number;
    request_id: string;
    kind: AutomationCommandKind;
    payload_json: string;
    source: string;
    idempotency_key: string;
    status: AutomationCommandStatus;
    claimed_by: string | null;
    started_at: string | null;
    finished_at: string | null;
    result_json: string | null;
    last_error: string | null;
    created_at: string;
    updated_at: string;
}

export interface ParsedAutomationCommandRecord {
    id: number;
    requestId: string;
    kind: AutomationCommandKind;
    payload: AutomationCommandPayload;
    source: string;
    idempotencyKey: string;
    status: AutomationCommandStatus;
    claimedBy: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    result: AutomationCommandExecutionResult | null;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
}

export const PUBLIC_AUTOMATION_COMMAND_KINDS: readonly PublicAutomationCommandKind[] = [
    'sync-search',
    'sync-list',
    'send-invites',
    'send-messages',
];

export const TERMINAL_AUTOMATION_COMMAND_STATUSES: readonly AutomationCommandStatus[] = [
    'SUCCEEDED',
    'FAILED',
    'SKIPPED',
];

export function isPublicAutomationCommandKind(kind: string): kind is PublicAutomationCommandKind {
    return (PUBLIC_AUTOMATION_COMMAND_KINDS as readonly string[]).includes(kind);
}

export function isTerminalAutomationCommandStatus(status: AutomationCommandStatus): boolean {
    return (TERMINAL_AUTOMATION_COMMAND_STATUSES as readonly string[]).includes(status);
}

export function mapLegacyTriggerRunWorkflow(
    workflow: string,
): { kind: AutomationCommandKind; payload: AutomationCommandPayload } | null {
    switch (workflow) {
        case 'invite':
            return { kind: 'send-invites', payload: {} };
        case 'message':
            return { kind: 'send-messages', payload: {} };
        case 'all':
            return { kind: 'workflow-all', payload: { workflow: 'all' } };
        case 'check':
            return { kind: 'workflow-check', payload: { workflow: 'check' } };
        case 'warmup':
            return { kind: 'workflow-warmup', payload: { workflow: 'warmup' } };
        default:
            return null;
    }
}
