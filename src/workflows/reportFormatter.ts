/**
 * Formattazione report condivisa per tutti i workflow.
 * Include sia formato console che formato Telegram (HTML).
 */

import type { WorkflowExecutionResult, WorkflowReport } from './types';
import type { AlertSeverity } from '../telemetry/alerts';

const BOX_WIDTH = 64;
const SEP = '─'.repeat(BOX_WIDTH);

export function formatWorkflowReport(report: WorkflowReport): string {
    const lines: string[] = [];
    const elapsed = Math.round((report.finishedAt.getTime() - report.startedAt.getTime()) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;

    lines.push('');
    lines.push(SEP);
    lines.push(`  REPORT: ${report.workflow.toUpperCase()}`);
    lines.push(SEP);
    lines.push(`  Status:    ${report.success ? 'COMPLETATO' : 'FALLITO'}`);
    lines.push(`  Durata:    ${minutes}m ${seconds}s`);
    lines.push('');

    for (const [key, value] of Object.entries(report.summary)) {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        lines.push(`  ${label.padEnd(24)} ${value ?? 'N/A'}`);
    }

    if (report.errors.length > 0) {
        lines.push('');
        lines.push('  ERRORI:');
        for (const err of report.errors.slice(0, 10)) {
            lines.push(`    - ${err}`);
        }
        if (report.errors.length > 10) {
            lines.push(`    ... e altri ${report.errors.length - 10}`);
        }
    }

    // Per-List Performance (5.2)
    if (report.listBreakdown && report.listBreakdown.length > 0) {
        lines.push('');
        lines.push('  PER-LISTA:');
        for (const lb of report.listBreakdown) {
            const flag = lb.flag === 'critical' ? ' [CRITICA]' : lb.flag === 'underperforming' ? ' [SOTTO]' : '';
            lines.push(
                `    ${lb.listName.padEnd(20)} inv:${lb.invitesSent} msg:${lb.messagesSent} acc:${(isNaN(lb.acceptanceRatePct) ? 0 : lb.acceptanceRatePct).toFixed(1)}%${flag}`,
            );
        }
    }

    if (report.riskAssessment) {
        const ra = report.riskAssessment;
        const riskIcon = ra.level === 'GO' ? '[OK]' : ra.level === 'CAUTION' ? '[!]' : '[!!!]';
        lines.push('');
        lines.push(`  ${riskIcon} Risk: ${ra.level} (score: ${ra.score}/100)`);
        if (ra.score > 30) {
            const factors = Object.entries(ra.factors)
                .filter(([, v]) => v > 0)
                .map(([k, v]) => `${k}=${v}`)
                .join(', ');
            if (factors) lines.push(`      Fattori: ${factors}`);
        }
    }

    lines.push('');
    lines.push(`  Prossima azione: ${report.nextAction ?? 'N/A'}`);
    lines.push(SEP);
    lines.push('');

    return lines.join('\n');
}

export function formatWorkflowExecutionResult(result: WorkflowExecutionResult): string {
    if (result.artifacts?.report) {
        return formatWorkflowReport(result.artifacts.report);
    }

    const lines: string[] = [];
    const status = result.success ? 'COMPLETATO' : result.blocked ? 'BLOCCATO' : 'FALLITO';
    lines.push('');
    lines.push(SEP);
    lines.push(`  REPORT: ${result.workflow.toUpperCase()}`);
    lines.push(SEP);
    lines.push(`  Status:    ${status}`);

    if (result.blocked) {
        lines.push(`  Motivo:    ${result.blocked.reason}`);
        lines.push(`  Messaggio: ${result.blocked.message}`);
    }

    if (Object.keys(result.summary).length > 0) {
        lines.push('');
        for (const [key, value] of Object.entries(result.summary)) {
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            lines.push(`  ${label.padEnd(24)} ${value ?? 'N/A'}`);
        }
    }

    if (result.errors.length > 0) {
        lines.push('');
        lines.push('  ERRORI:');
        for (const err of result.errors.slice(0, 10)) {
            lines.push(`    - ${err}`);
        }
        if (result.errors.length > 10) {
            lines.push(`    ... e altri ${result.errors.length - 10}`);
        }
    }

    if (result.riskAssessment) {
        const ra = result.riskAssessment;
        const riskIcon = ra.level === 'GO' ? '[OK]' : ra.level === 'CAUTION' ? '[!]' : '[!!!]';
        lines.push('');
        lines.push(`  ${riskIcon} Risk: ${ra.level} (score: ${ra.score}/100)`);
    }

    lines.push('');
    lines.push(`  Prossima azione: ${result.nextAction ?? 'N/A'}`);
    lines.push(SEP);
    lines.push('');

    return lines.join('\n');
}

/**
 * Formatta il report workflow per Telegram (HTML compatto).
 * Invia automaticamente se Telegram e' configurato.
 */
export async function sendWorkflowTelegramReport(report: WorkflowReport): Promise<void> {
    try {
        const { sendTelegramAlert } = await import('../telemetry/alerts');

        const elapsed = Math.round((report.finishedAt.getTime() - report.startedAt.getTime()) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        const status = report.success ? 'COMPLETATO' : 'FALLITO';

        const summaryLines = Object.entries(report.summary)
            .map(([k, v]) => `${k.replace(/_/g, ' ')}: <b>${v ?? 'N/A'}</b>`)
            .join('\n');

        const errorSection =
            report.errors.length > 0
                ? `\n\nErrori:\n${report.errors
                      .slice(0, 3)
                      .map((e) => `- ${e}`)
                      .join('\n')}`
                : '';

        const listSection =
            report.listBreakdown && report.listBreakdown.length > 0
                ? `\n\nPer lista:\n${report.listBreakdown
                      .map((lb) => {
                          const flag = lb.flag === 'critical' ? ' [!!!]' : lb.flag === 'underperforming' ? ' [!]' : '';
                          return `${lb.listName}: inv=${lb.invitesSent} msg=${lb.messagesSent} acc=${lb.acceptanceRatePct.toFixed(0)}%${flag}`;
                      })
                      .join('\n')}`
                : '';

        const riskSection = report.riskAssessment
            ? `\nRisk: ${report.riskAssessment.level} (${report.riskAssessment.score}/100)`
            : '';

        const message = `Status: <b>${status}</b>\nDurata: ${minutes}m ${seconds}s\n\n${summaryLines}${errorSection}${listSection}${riskSection}\n\nProssima: ${report.nextAction ?? 'N/A'}`;

        const severity: AlertSeverity = !report.success
            ? 'critical'
            : report.riskAssessment?.level === 'CAUTION'
              ? 'warn'
              : 'info';
        const title = `Workflow ${report.workflow.toUpperCase()} — ${status}`;

        await sendTelegramAlert(message, title, severity);
    } catch {
        // Telegram report e' best-effort — non deve mai bloccare il workflow
    }
}

export async function sendWorkflowExecutionTelegramReport(result: WorkflowExecutionResult): Promise<void> {
    if (result.artifacts?.report) {
        await sendWorkflowTelegramReport(result.artifacts.report);
        return;
    }

    if (result.blocked?.reason === 'USER_CANCELLED') {
        return;
    }

    try {
        const { sendTelegramAlert } = await import('../telemetry/alerts');
        const status = result.success ? 'COMPLETATO' : result.blocked ? 'BLOCCATO' : 'FALLITO';
        const summaryLines = Object.entries(result.summary)
            .map(([k, v]) => `${k.replace(/_/g, ' ')}: <b>${v ?? 'N/A'}</b>`)
            .join('\n');
        const errorSection =
            result.errors.length > 0
                ? `\n\nErrori:\n${result.errors
                      .slice(0, 3)
                      .map((e) => `- ${e}`)
                      .join('\n')}`
                : '';
        const riskSection = result.riskAssessment
            ? `\nRisk: ${result.riskAssessment.level} (${result.riskAssessment.score}/100)`
            : '';
        const blockedSection = result.blocked
            ? `\n\nBlocco: <b>${result.blocked.reason}</b>\n${result.blocked.message}`
            : '';
        const message = `Status: <b>${status}</b>\nWorkflow: <b>${result.workflow}</b>${
            summaryLines ? `\n\n${summaryLines}` : ''
        }${blockedSection}${errorSection}${riskSection}\n\nProssima: ${result.nextAction ?? 'N/A'}`;
        const severity: AlertSeverity = result.success ? 'info' : result.blocked ? 'warn' : 'critical';
        const title = `Workflow ${result.workflow.toUpperCase()} — ${status}`;
        await sendTelegramAlert(message, title, severity);
    } catch {
        // Telegram report e' best-effort — non deve mai bloccare il workflow
    }
}

export function formatPreflightSection(title: string, entries: Array<[string, string]>): string {
    const lines: string[] = [];
    lines.push(SEP);
    lines.push(`  ${title}`);
    lines.push(SEP);
    for (const [label, value] of entries) {
        lines.push(`  ${label.padEnd(30)} ${value}`);
    }
    return lines.join('\n');
}
