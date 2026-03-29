/**
 * A20: Session Performance Tracker — instrumentazione granulare per fase.
 *
 * Raccoglie timing precisi per ogni fase della sessione (warmup, navigate,
 * action, delay, enrichment, overhead) e produce un report breakdown a fine
 * sessione. Permette di identificare delay creep e bottleneck.
 *
 * Usa performance.now() per precisione sub-millisecondo dove disponibile,
 * fallback a Date.now() altrimenti.
 */

const now = typeof performance !== 'undefined' && performance.now ? () => performance.now() : () => Date.now();

export type SessionPhase =
    | 'warmup'
    | 'navigate'
    | 'action'
    | 'delay'
    | 'enrichment'
    | 'inbox'
    | 'wind_down'
    | 'overhead';

interface PhaseAccumulator {
    totalMs: number;
    count: number;
    maxMs: number;
    minMs: number;
}

export interface SessionPerformanceReport {
    totalSessionMs: number;
    phases: Record<SessionPhase, PhaseAccumulator>;
    breakdown: Record<SessionPhase, { ms: number; pct: number; count: number }>;
    delayCreepAlert: boolean;
    dominantPhase: SessionPhase;
}

const PHASES: SessionPhase[] = [
    'warmup',
    'navigate',
    'action',
    'delay',
    'enrichment',
    'inbox',
    'wind_down',
    'overhead',
];

function emptyAccumulator(): PhaseAccumulator {
    return { totalMs: 0, count: 0, maxMs: 0, minMs: Infinity };
}

/**
 * Tracker per singola sessione. Crea una nuova istanza per ogni sessione.
 */
export class SessionPerformanceTracker {
    private sessionStartMs: number;
    private phases: Map<SessionPhase, PhaseAccumulator>;
    private activeMarks: Map<string, number> = new Map();

    constructor() {
        this.sessionStartMs = now();
        this.phases = new Map();
        for (const phase of PHASES) {
            this.phases.set(phase, emptyAccumulator());
        }
    }

    /**
     * Segna l'inizio di una fase. Restituisce un markId univoco.
     * Chiamare `endMark(markId)` per registrare la durata.
     */
    markStart(phase: SessionPhase, context?: string): string {
        const markId = `${phase}:${context ?? ''}:${Date.now()}`;
        this.activeMarks.set(markId, now());
        return markId;
    }

    /**
     * Segna la fine di una fase e accumula la durata.
     * Restituisce la durata in ms o 0 se il markId non è trovato.
     */
    endMark(markId: string): number {
        const startMs = this.activeMarks.get(markId);
        if (startMs === undefined) return 0;
        this.activeMarks.delete(markId);
        const durationMs = now() - startMs;
        const phase = markId.split(':')[0] as SessionPhase;
        this.addDuration(phase, durationMs);
        return durationMs;
    }

    /**
     * Registra direttamente una durata per una fase (se il timing
     * è già calcolato esternamente, es. da Date.now() esistente).
     */
    addDuration(phase: SessionPhase, durationMs: number): void {
        const acc = this.phases.get(phase);
        if (!acc) return;
        // L3: guardia NaN/negativo — previene corruzione del report
        if (!Number.isFinite(durationMs) || durationMs < 0) return;
        acc.totalMs += durationMs;
        acc.count += 1;
        if (durationMs > acc.maxMs) acc.maxMs = durationMs;
        if (durationMs < acc.minMs) acc.minMs = durationMs;
    }

    /**
     * Produce il report finale della sessione con breakdown per fase.
     */
    getReport(): SessionPerformanceReport {
        const totalSessionMs = now() - this.sessionStartMs;
        const breakdown = {} as SessionPerformanceReport['breakdown'];
        let trackedMs = 0;
        let dominantPhase: SessionPhase = 'overhead';
        let dominantMs = 0;

        for (const phase of PHASES) {
            const acc = this.phases.get(phase) ?? emptyAccumulator();
            const ms = Math.round(acc.totalMs);
            trackedMs += ms;
            const pct = totalSessionMs > 0 ? Math.round((ms / totalSessionMs) * 100) : 0;
            breakdown[phase] = { ms, pct, count: acc.count };
            if (ms > dominantMs) {
                dominantMs = ms;
                dominantPhase = phase;
            }
        }

        // Tutto ciò che non è stato tracciato è overhead
        const untrackedMs = Math.max(0, Math.round(totalSessionMs) - trackedMs);
        if (untrackedMs > 0) {
            breakdown.overhead.ms += untrackedMs;
            breakdown.overhead.pct =
                totalSessionMs > 0 ? Math.round((breakdown.overhead.ms / totalSessionMs) * 100) : 0;
            if (breakdown.overhead.ms > dominantMs) {
                dominantPhase = 'overhead';
            }
        }

        const delayPct = breakdown.delay?.pct ?? 0;

        return {
            totalSessionMs: Math.round(totalSessionMs),
            phases: Object.fromEntries(this.phases) as Record<SessionPhase, PhaseAccumulator>,
            breakdown,
            delayCreepAlert: delayPct > 60,
            dominantPhase,
        };
    }

    /**
     * Serializza il report in formato compatto per log/DB.
     */
    toLogPayload(): Record<string, unknown> {
        const report = this.getReport();
        return {
            perfDominantPhase: report.dominantPhase,
            perfDelayCreepAlert: report.delayCreepAlert,
            perfWarmupMs: report.breakdown.warmup.ms,
            perfNavigateMs: report.breakdown.navigate.ms,
            perfNavigateCount: report.breakdown.navigate.count,
            perfActionMs: report.breakdown.action.ms,
            perfActionCount: report.breakdown.action.count,
            perfDelayMs: report.breakdown.delay.ms,
            perfDelayPct: report.breakdown.delay.pct,
            perfEnrichmentMs: report.breakdown.enrichment.ms,
            perfInboxMs: report.breakdown.inbox.ms,
            perfWindDownMs: report.breakdown.wind_down.ms,
            perfOverheadMs: report.breakdown.overhead.ms,
            perfOverheadPct: report.breakdown.overhead.pct,
        };
    }
}
