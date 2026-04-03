import type { PreflightResult, WorkflowBlockedState, WorkflowExecutionArtifacts, WorkflowExecutionResult, WorkflowKind, WorkflowReport } from '../types';

export function estimateExecutionMinutes(
    dryRun: boolean,
    itemCount: number,
    setupSeconds: number,
    perItemSeconds: number,
): number | undefined {
    if (dryRun || itemCount <= 0) {
        return undefined;
    }
    return Math.ceil((setupSeconds + itemCount * perItemSeconds) / 60);
}

export function buildWorkflowArtifacts(
    artifacts?: WorkflowExecutionArtifacts,
): WorkflowExecutionArtifacts | undefined {
    if (!artifacts) {
        return undefined;
    }

    const normalized: WorkflowExecutionArtifacts = {};

    if (artifacts.preflight) normalized.preflight = artifacts.preflight;
    if (artifacts.previewLeads) normalized.previewLeads = artifacts.previewLeads;
    if (typeof artifacts.estimatedMinutes === 'number') normalized.estimatedMinutes = artifacts.estimatedMinutes;
    if (typeof artifacts.candidateCount === 'number') normalized.candidateCount = artifacts.candidateCount;
    if (artifacts.report) normalized.report = artifacts.report;
    if (artifacts.extra && Object.keys(artifacts.extra).length > 0) normalized.extra = artifacts.extra;

    return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function buildBlockedResult(
    workflow: WorkflowKind,
    blocked: WorkflowBlockedState,
    options?: {
        summary?: WorkflowExecutionResult['summary'];
        errors?: string[];
        nextAction?: string;
        riskAssessment?: WorkflowExecutionResult['riskAssessment'];
        artifacts?: WorkflowExecutionArtifacts;
    },
): WorkflowExecutionResult {
    return {
        workflow,
        success: false,
        blocked,
        summary: options?.summary ?? {},
        errors: options?.errors ?? [],
        nextAction: options?.nextAction ?? blocked.message,
        riskAssessment: options?.riskAssessment,
        artifacts: buildWorkflowArtifacts(options?.artifacts),
    };
}

export function buildPreflightBlockedResult<TAnswers extends object>(
    workflow: WorkflowKind,
    preflight: PreflightResult<TAnswers>,
): WorkflowExecutionResult {
    const hasCriticalWarnings = preflight.warnings.some((warning) => warning.level === 'critical');
    const riskStop = preflight.riskAssessment?.level === 'STOP';
    const blocked: WorkflowBlockedState =
        hasCriticalWarnings || riskStop
            ? {
                  reason: 'PRECONDITION_FAILED',
                  message: 'Preflight non superato: condizioni critiche o rischio troppo alto',
              }
            : {
                  reason: 'USER_CANCELLED',
                  message: "Operazione annullata dall'utente",
              };

    return buildBlockedResult(workflow, blocked, {
        riskAssessment: preflight.riskAssessment,
        artifacts: { preflight },
    });
}

export function buildResultFromReport(
    workflow: WorkflowKind,
    report: WorkflowReport,
    artifacts?: WorkflowExecutionArtifacts,
): WorkflowExecutionResult {
    return {
        workflow,
        success: report.success,
        blocked: null,
        summary: report.summary,
        errors: report.errors,
        nextAction: report.nextAction,
        riskAssessment: report.riskAssessment,
        artifacts: buildWorkflowArtifacts({
            ...artifacts,
            report,
        }),
    };
}
