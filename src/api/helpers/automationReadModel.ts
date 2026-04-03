import type {
    AutomationCommandExecutionResult,
    ParsedAutomationCommandRecord,
} from '../../automation/types';
import type {
    SessionRiskAssessment,
    WorkflowBlockedState,
    WorkflowExecutionArtifacts,
    WorkflowPreviewLead,
    WorkflowReport,
    WorkflowSummary,
} from '../../workflows/types';

export interface PublicPreflightSummary {
    confirmed: boolean;
    selectedAccountId?: string;
    warningCount: number;
    criticalWarningCount: number;
    riskAssessment?: SessionRiskAssessment;
    hasAiAdvice: boolean;
}

export interface PublicWorkflowExecutionArtifacts {
    preflight?: PublicPreflightSummary;
    previewLeads?: WorkflowPreviewLead[];
    estimatedMinutes?: number;
    candidateCount?: number;
    report?: WorkflowReport;
}

export interface PublicAutomationCommandExecutionResult {
    workflow?: string;
    success: boolean;
    blocked: WorkflowBlockedState | null;
    summary: WorkflowSummary;
    errors: string[];
    nextAction: string;
    riskAssessment?: SessionRiskAssessment;
    artifacts?: PublicWorkflowExecutionArtifacts;
    details?: Record<string, unknown>;
}

export interface PublicAutomationCommandRecord {
    id: number;
    requestId: string;
    kind: ParsedAutomationCommandRecord['kind'];
    payload: ParsedAutomationCommandRecord['payload'];
    source: string;
    idempotencyKey: string;
    status: ParsedAutomationCommandRecord['status'];
    claimedBy: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    result: PublicAutomationCommandExecutionResult | null;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
}

function toPublicPreflightSummary(
    preflight: NonNullable<WorkflowExecutionArtifacts['preflight']>,
): PublicPreflightSummary {
    return {
        confirmed: preflight.confirmed,
        selectedAccountId: preflight.selectedAccountId,
        warningCount: preflight.warnings.length,
        criticalWarningCount: preflight.warnings.filter((warning) => warning.level === 'critical').length,
        riskAssessment: preflight.riskAssessment,
        hasAiAdvice: !!preflight.aiAdvice,
    };
}

export function toPublicWorkflowExecutionArtifacts(
    artifacts?: WorkflowExecutionArtifacts,
): PublicWorkflowExecutionArtifacts | undefined {
    if (!artifacts) {
        return undefined;
    }

    const publicArtifacts: PublicWorkflowExecutionArtifacts = {};

    if (artifacts.preflight) {
        publicArtifacts.preflight = toPublicPreflightSummary(artifacts.preflight);
    }
    if (artifacts.previewLeads) {
        publicArtifacts.previewLeads = artifacts.previewLeads;
    }
    if (typeof artifacts.estimatedMinutes === 'number') {
        publicArtifacts.estimatedMinutes = artifacts.estimatedMinutes;
    }
    if (typeof artifacts.candidateCount === 'number') {
        publicArtifacts.candidateCount = artifacts.candidateCount;
    }
    if (artifacts.report) {
        publicArtifacts.report = artifacts.report;
    }

    return Object.keys(publicArtifacts).length > 0 ? publicArtifacts : undefined;
}

export function toPublicAutomationCommandExecutionResult(
    result: AutomationCommandExecutionResult | null | undefined,
): PublicAutomationCommandExecutionResult | null {
    if (!result) {
        return null;
    }

    return {
        workflow: result.workflow,
        success: result.success,
        blocked: result.blocked,
        summary: result.summary,
        errors: result.errors,
        nextAction: result.nextAction,
        riskAssessment: result.riskAssessment,
        artifacts: toPublicWorkflowExecutionArtifacts(result.artifacts),
        details: result.details,
    };
}

export function toPublicAutomationCommandRecord(command: ParsedAutomationCommandRecord): PublicAutomationCommandRecord {
    return {
        id: command.id,
        requestId: command.requestId,
        kind: command.kind,
        payload: command.payload,
        source: command.source,
        idempotencyKey: command.idempotencyKey,
        status: command.status,
        claimedBy: command.claimedBy,
        startedAt: command.startedAt,
        finishedAt: command.finishedAt,
        result: toPublicAutomationCommandExecutionResult(command.result),
        lastError: command.lastError,
        createdAt: command.createdAt,
        updatedAt: command.updatedAt,
    };
}
