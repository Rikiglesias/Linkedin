export type DashboardVoiceAction =
    | { kind: 'refresh' }
    | { kind: 'pause'; minutes: number }
    | { kind: 'resume' }
    | { kind: 'resolve_selected' }
    | { kind: 'trigger_run'; workflow: string }
    | { kind: 'export_csv' }
    | { kind: 'toggle_theme' }
    | { kind: 'print_report' };

function normalizeTranscript(raw: string): string {
    return raw
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parsePauseMinutes(normalized: string): number {
    const match = normalized.match(/(?:pausa|ferma|stop)\s+(\d{1,4})\s*(?:min|minute|minuti)?/i);
    if (!match) return 60;
    const parsed = Number.parseInt(match[1] ?? '', 10);
    if (!Number.isFinite(parsed)) return 60;
    return Math.max(1, Math.min(10_080, parsed));
}

export function parseVoiceCommand(transcript: string): DashboardVoiceAction | null {
    const normalized = normalizeTranscript(transcript);
    if (!normalized) return null;

    if (normalized.includes('aggiorna') || normalized.includes('refresh') || normalized.includes('ricarica')) {
        return { kind: 'refresh' };
    }

    if (normalized.includes('pausa') || normalized.includes('ferma') || normalized.includes('stop automazione')) {
        return { kind: 'pause', minutes: parsePauseMinutes(normalized) };
    }

    if (
        normalized.includes('riprendi') ||
        normalized.includes('resume') ||
        normalized.includes('riattiva') ||
        normalized.includes('riparti')
    ) {
        return { kind: 'resume' };
    }

    if (
        normalized.includes('risolvi selezionati') ||
        normalized.includes('risolvi incidenti selezionati') ||
        normalized.includes('chiudi selezionati')
    ) {
        return { kind: 'resolve_selected' };
    }

    if (
        normalized.includes('avvia run') ||
        normalized.includes('start run') ||
        normalized.includes('lancia workflow') ||
        normalized.includes('esegui workflow')
    ) {
        const workflow = parseWorkflowFromTranscript(normalized);
        return { kind: 'trigger_run', workflow };
    }

    if (
        normalized.includes('esporta') ||
        normalized.includes('export') ||
        normalized.includes('scarica csv')
    ) {
        return { kind: 'export_csv' };
    }

    if (
        normalized.includes('tema') ||
        normalized.includes('dark mode') ||
        normalized.includes('modalita scura') ||
        normalized.includes('cambia tema')
    ) {
        return { kind: 'toggle_theme' };
    }

    if (normalized.includes('stampa') || normalized.includes('print')) {
        return { kind: 'print_report' };
    }

    return null;
}

function parseWorkflowFromTranscript(normalized: string): string {
    if (normalized.includes('invit')) return 'invite';
    if (normalized.includes('messag')) return 'message';
    if (normalized.includes('check') || normalized.includes('verifica')) return 'check';
    if (normalized.includes('warmup') || normalized.includes('riscaldamento')) return 'warmup';
    return 'all';
}

export function isCriticalVoiceAction(action: DashboardVoiceAction): boolean {
    return action.kind === 'pause' || action.kind === 'resume' || action.kind === 'resolve_selected' || action.kind === 'trigger_run';
}

export function describeVoiceAction(action: DashboardVoiceAction): string {
    switch (action.kind) {
        case 'refresh': return 'Aggiorna dashboard';
        case 'pause': return `Pausa automazione (${action.minutes} min)`;
        case 'resume': return 'Riprendi automazione';
        case 'resolve_selected': return 'Risolvi incidenti selezionati';
        case 'trigger_run': return `Avvia run workflow "${action.workflow}"`;
        case 'export_csv': return 'Esporta trend CSV';
        case 'toggle_theme': return 'Cambia tema';
        case 'print_report': return 'Stampa report';
    }
}
