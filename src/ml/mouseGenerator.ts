export interface Point {
    x: number;
    y: number;
}

/** Multi-octave fractal noise frequencies and corresponding weights. */
const FRACTAL_OCTAVES: ReadonlyArray<{ freq: number; weight: number }> = [
    { freq: 0.01, weight: 1.0 },
    { freq: 0.03, weight: 0.5 },
    { freq: 0.07, weight: 0.25 },
    { freq: 0.15, weight: 0.125 },
];

export class MouseGenerator {
    /**
     * Genera una traiettoria curva naturale (cubic Bézier + fractal noise + micro-tremor)
     * per simulare il movimento del mouse umano verso il target, evitando rette perfette.
     *
     * - Cubic Bézier with two control points for a smoother S-curve.
     * - Multi-octave fractal noise replaces the single harmonic.
     * - Micro-tremors (±1-3 px @ 8-12 Hz) emulate physiological EMG wrist tremor.
     * - Fitts's-Law easing: decelerates near the target for realistic hesitation.
     */
    public static generatePath(start: Point, target: Point, steps: number = 20): Point[] {
        const path: Point[] = [];
        const dx = target.x - start.x;
        const dy = target.y - start.y;

        // --- Cubic Bézier: two control points ---
        const dist = Math.sqrt(dx * dx + dy * dy);
        const curveSize = Math.max(20, dist * 0.4);

        // cp1: offset from start (first third of the segment)
        const cp1: Point = {
            x: start.x + dx * (0.25 + Math.random() * 0.15) + (Math.random() - 0.5) * curveSize,
            y: start.y + dy * (0.25 + Math.random() * 0.15) + (Math.random() - 0.5) * curveSize,
        };

        // cp2: offset from end (last third of the segment, smoother approach)
        const cp2: Point = {
            x: start.x + dx * (0.60 + Math.random() * 0.15) + (Math.random() - 0.5) * curveSize * 0.6,
            y: start.y + dy * (0.60 + Math.random() * 0.15) + (Math.random() - 0.5) * curveSize * 0.6,
        };

        // Random phase offsets for noise reproducibility within a single path
        const noiseOffsetX = Math.random() * 1000;
        const noiseOffsetY = Math.random() * 1000;

        // Micro-tremor parameters: frequency between 8-12 Hz, amplitude 1-3 px
        const tremorFreq = 8 + Math.random() * 4;          // Hz
        const tremorAmpX = 1 + Math.random() * 2;           // px
        const tremorAmpY = 1 + Math.random() * 2;           // px
        const tremorPhaseX = Math.random() * Math.PI * 2;
        const tremorPhaseY = Math.random() * Math.PI * 2;

        // Fitts's-Law easing: ease-out quint for stronger deceleration near t=1
        const fittsEase = (t: number): number => 1 - Math.pow(1 - t, 5);

        for (let i = 0; i <= steps; i++) {
            const rawT = i / steps;
            const t = fittsEase(rawT);

            // --- Cubic Bézier interpolation ---
            const m1 = 1 - t;
            const m1_2 = m1 * m1;
            const m1_3 = m1_2 * m1;
            const t2 = t * t;
            const t3 = t2 * t;
            const bx = m1_3 * start.x + 3 * m1_2 * t * cp1.x + 3 * m1 * t2 * cp2.x + t3 * target.x;
            const by = m1_3 * start.y + 3 * m1_2 * t * cp1.y + 3 * m1 * t2 * cp2.y + t3 * target.y;

            // --- Multi-octave fractal noise ---
            let fractalX = 0;
            let fractalY = 0;
            for (const { freq, weight } of FRACTAL_OCTAVES) {
                fractalX += Math.sin(noiseOffsetX + t / freq) * weight;
                fractalY += Math.cos(noiseOffsetY + t / freq) * weight;
            }
            // Scale to a comparable range (~3 px at peak)
            const fractalScale = 3 / FRACTAL_OCTAVES.reduce((s, o) => s + o.weight, 0);
            fractalX *= fractalScale;
            fractalY *= fractalScale;

            // --- Micro-tremor overlay (EMG wrist tremor) ---
            // Map rawT to a pseudo-time so tremor frequency is independent of step count
            const pseudoTimeSec = rawT * (steps / 60); // assume ~60 steps/sec baseline
            const tremorX = Math.sin(2 * Math.PI * tremorFreq * pseudoTimeSec + tremorPhaseX) * tremorAmpX;
            const tremorY = Math.sin(2 * Math.PI * tremorFreq * pseudoTimeSec + tremorPhaseY) * tremorAmpY;

            // --- Dampening near endpoints for precision start/end ---
            const dampening = Math.sin(rawT * Math.PI);

            path.push({
                x: bx + (fractalX + tremorX) * dampening,
                y: by + (fractalY + tremorY) * dampening,
            });
        }

        // Force exact landing on target
        path[path.length - 1] = { ...target };

        return path;
    }
}
