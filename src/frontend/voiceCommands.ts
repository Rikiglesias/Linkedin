export type DashboardVoiceAction =
    | { kind: 'refresh' }
    | { kind: 'pause'; minutes: number }
    | { kind: 'resume' }
    | { kind: 'resolve_selected' };

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

    return null;
}

export function isCriticalVoiceAction(action: DashboardVoiceAction): boolean {
    return action.kind === 'pause' || action.kind === 'resume' || action.kind === 'resolve_selected';
}

export function describeVoiceAction(action: DashboardVoiceAction): string {
    if (action.kind === 'refresh') return 'Aggiorna dashboard';
    if (action.kind === 'pause') return `Pausa automazione (${action.minutes} min)`;
    if (action.kind === 'resume') return 'Riprendi automazione';
    return 'Risolvi incidenti selezionati';
}
