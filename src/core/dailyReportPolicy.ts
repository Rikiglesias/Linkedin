export type AutoDailyReportDecisionReason = 'disabled' | 'already_sent' | 'before_cutoff' | 'ready';

export interface AutoDailyReportDecisionInput {
    enabled: boolean;
    localDate: string;
    lastSentDate: string | null;
    currentHour: number;
    reportHour: number;
}

export interface AutoDailyReportDecision {
    shouldRun: boolean;
    reason: AutoDailyReportDecisionReason;
}

export function evaluateAutoDailyReportDecision(input: AutoDailyReportDecisionInput): AutoDailyReportDecision {
    if (!input.enabled) {
        return { shouldRun: false, reason: 'disabled' };
    }
    if (input.lastSentDate === input.localDate) {
        return { shouldRun: false, reason: 'already_sent' };
    }
    if (input.currentHour < input.reportHour) {
        return { shouldRun: false, reason: 'before_cutoff' };
    }
    return { shouldRun: true, reason: 'ready' };
}
