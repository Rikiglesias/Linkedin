/**
 * Formattazione report condivisa per tutti i workflow.
 */

import type { WorkflowReport } from './types';

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
        lines.push(`  ${label.padEnd(24)} ${value}`);
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

    lines.push('');
    lines.push(`  Prossima azione: ${report.nextAction}`);
    lines.push(SEP);
    lines.push('');

    return lines.join('\n');
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
