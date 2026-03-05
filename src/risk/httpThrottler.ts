/**
 * risk/httpThrottler.ts
 * ─────────────────────────────────────────────────────────────────
 * Monitora i response time delle API LinkedIn per segnalare quando
 * rallentare PRIMA di ricevere un HTTP 429. Sliding window con
 * baseline automatica e soglie progressive.
 */

export interface ThrottleSignal {
    shouldSlow: boolean;
    shouldPause: boolean;
    currentAvgMs: number;
    baselineMs: number;
    ratio: number;
}

interface TimingSample {
    url: string;
    responseTimeMs: number;
    timestamp: number;
}

const WINDOW_SIZE = 50;
const BASELINE_SAMPLES = 10;
const SLOW_THRESHOLD_RATIO = 2.0;
const PAUSE_THRESHOLD_RATIO = 3.5;
const SAMPLE_MAX_AGE_MS = 10 * 60 * 1000; // 10 min

export class HttpResponseThrottler {
    private samples: TimingSample[] = [];
    private baselineMs: number | null = null;
    private baselineLocked = false;

    /**
     * Registra un response time per un URL LinkedIn.
     * Filtra solo le API voyager (il traffico più rilevante).
     */
    recordResponseTime(url: string, responseTimeMs: number): void {
        if (responseTimeMs <= 0) return;

        this.samples.push({
            url,
            responseTimeMs,
            timestamp: Date.now(),
        });

        if (this.samples.length > WINDOW_SIZE * 2) {
            this.samples = this.samples.slice(-WINDOW_SIZE);
        }

        this.pruneExpiredSamples();

        if (!this.baselineLocked && this.samples.length >= BASELINE_SAMPLES) {
            this.computeBaseline();
        }
    }

    /**
     * Restituisce il segnale di throttling corrente.
     * Se non ci sono abbastanza campioni, restituisce un segnale neutro.
     */
    getThrottleSignal(): ThrottleSignal {
        const neutral: ThrottleSignal = {
            shouldSlow: false,
            shouldPause: false,
            currentAvgMs: 0,
            baselineMs: this.baselineMs ?? 0,
            ratio: 0,
        };

        if (!this.baselineLocked || this.baselineMs === null || this.baselineMs <= 0) {
            return neutral;
        }

        const recentSamples = this.getRecentSamples();
        if (recentSamples.length < 5) {
            return neutral;
        }

        const currentAvgMs = recentSamples.reduce((sum, s) => sum + s.responseTimeMs, 0) / recentSamples.length;
        const ratio = currentAvgMs / this.baselineMs;

        return {
            shouldSlow: ratio >= SLOW_THRESHOLD_RATIO,
            shouldPause: ratio >= PAUSE_THRESHOLD_RATIO,
            currentAvgMs: Math.round(currentAvgMs),
            baselineMs: Math.round(this.baselineMs),
            ratio: Math.round(ratio * 100) / 100,
        };
    }

    /**
     * Reset completo per nuova sessione o dopo pausa prolungata.
     */
    reset(): void {
        this.samples = [];
        this.baselineMs = null;
        this.baselineLocked = false;
    }

    /** Espone la baseline per test. */
    getBaseline(): number | null {
        return this.baselineMs;
    }

    /** Espone il conteggio campioni per diagnostica. */
    getSampleCount(): number {
        return this.samples.length;
    }

    private computeBaseline(): void {
        const sorted = this.samples
            .slice(0, BASELINE_SAMPLES)
            .map((s) => s.responseTimeMs)
            .sort((a, b) => a - b);

        // Trimmed mean: scarta il più alto e il più basso per robustezza
        const trimmed = sorted.length > 4 ? sorted.slice(1, -1) : sorted;

        this.baselineMs = trimmed.reduce((sum, v) => sum + v, 0) / trimmed.length;
        this.baselineLocked = true;
    }

    private getRecentSamples(): TimingSample[] {
        return this.samples.slice(-WINDOW_SIZE);
    }

    private pruneExpiredSamples(): void {
        const cutoff = Date.now() - SAMPLE_MAX_AGE_MS;
        this.samples = this.samples.filter((s) => s.timestamp >= cutoff);

        if (this.samples.length < BASELINE_SAMPLES) {
            this.baselineLocked = false;
            this.baselineMs = null;
        }
    }
}
