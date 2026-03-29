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
     * Genera un singolo segmento curvo (cubic Bézier + fractal noise + micro-tremor).
     * Usato internamente da generateHumanPath per ogni fase del movimento.
     */
    public static generatePath(start: Point, target: Point, steps: number = 20): Point[] {
        const path: Point[] = [];
        const dx = target.x - start.x;
        const dy = target.y - start.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const curveSize = Math.max(20, dist * 0.4);

        const cp1: Point = {
            x: start.x + dx * (0.25 + Math.random() * 0.15) + (Math.random() - 0.5) * curveSize,
            y: start.y + dy * (0.25 + Math.random() * 0.15) + (Math.random() - 0.5) * curveSize,
        };
        const cp2: Point = {
            x: start.x + dx * (0.6 + Math.random() * 0.15) + (Math.random() - 0.5) * curveSize * 0.6,
            y: start.y + dy * (0.6 + Math.random() * 0.15) + (Math.random() - 0.5) * curveSize * 0.6,
        };

        const noiseOffsetX = Math.random() * 1000;
        const noiseOffsetY = Math.random() * 1000;
        const tremorFreq = 8 + Math.random() * 4;
        const tremorAmpX = 1 + Math.random() * 2;
        const tremorAmpY = 1 + Math.random() * 2;
        const tremorPhaseX = Math.random() * Math.PI * 2;
        const tremorPhaseY = Math.random() * Math.PI * 2;

        const fittsEase = (t: number): number => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2);

        for (let i = 0; i <= steps; i++) {
            const rawT = i / steps;
            const t = fittsEase(rawT);
            const m1 = 1 - t;
            const bx = m1 * m1 * m1 * start.x + 3 * m1 * m1 * t * cp1.x + 3 * m1 * t * t * cp2.x + t * t * t * target.x;
            const by = m1 * m1 * m1 * start.y + 3 * m1 * m1 * t * cp1.y + 3 * m1 * t * t * cp2.y + t * t * t * target.y;

            let fractalX = 0;
            let fractalY = 0;
            for (const { freq, weight } of FRACTAL_OCTAVES) {
                fractalX += Math.sin(noiseOffsetX + t / freq) * weight;
                fractalY += Math.cos(noiseOffsetY + t / freq) * weight;
            }
            const fractalScale = 3 / FRACTAL_OCTAVES.reduce((s, o) => s + o.weight, 0);
            fractalX *= fractalScale;
            fractalY *= fractalScale;

            const pseudoTimeSec = rawT * (steps / 60);
            const tremorX = Math.sin(2 * Math.PI * tremorFreq * pseudoTimeSec + tremorPhaseX) * tremorAmpX;
            const tremorY = Math.sin(2 * Math.PI * tremorFreq * pseudoTimeSec + tremorPhaseY) * tremorAmpY;

            const dampening = Math.sin(rawT * Math.PI);
            path.push({
                x: bx + (fractalX + tremorX) * dampening,
                y: by + (fractalY + tremorY) * dampening,
            });
        }

        path[path.length - 1] = { ...target };
        return path;
    }

    /**
     * Genera un percorso mouse umano multi-fase realistico.
     *
     * Un umano reale NON va mai diretto dal punto A al punto B. Il percorso ha fasi:
     *   1. DRIFT: movimento verso l'area generale del target (con offset laterale)
     *   2. APPROACH: avvicinamento al target (ancora impreciso)
     *   3. OVERSHOOT (40%): supera il target di qualche pixel
     *   4. CORRECTION: micro-correzione verso il punto esatto
     *
     * Il risultato è un array piatto di punti da eseguire in sequenza.
     * Per distanze brevi (<80px) usa un singolo segmento (non serve multi-fase).
     */
    public static generateHumanPath(
        start: Point,
        target: Point,
        viewport?: { width: number; height: number },
    ): Point[] {
        const dist = Math.sqrt((target.x - start.x) ** 2 + (target.y - start.y) ** 2);
        const vw = viewport?.width ?? 1920;
        const vh = viewport?.height ?? 1080;

        // Distanze brevi: un singolo segmento Bézier è sufficiente
        if (dist < 80) {
            const steps = Math.max(5, Math.min(10, Math.round(dist / 10)));
            return MouseGenerator.generatePath(start, target, steps);
        }

        const allPoints: Point[] = [];

        // --- FASE 1: DRIFT verso area generale (non dritto al target) ---
        // L'offset laterale simula il fatto che un umano muove il polso/braccio
        // verso la zona giusta, non verso il pixel esatto.
        const driftOffset = Math.min(60, dist * 0.15);
        const driftAngle = Math.random() * Math.PI * 2;
        const driftTarget: Point = {
            x: Math.max(
                5,
                Math.min(vw - 5, target.x + Math.cos(driftAngle) * driftOffset + (Math.random() - 0.5) * 30),
            ),
            y: Math.max(
                5,
                Math.min(vh - 5, target.y + Math.sin(driftAngle) * driftOffset + (Math.random() - 0.5) * 20),
            ),
        };
        const driftSteps = Math.max(6, Math.min(12, Math.round(dist / 80)));
        const driftPath = MouseGenerator.generatePath(start, driftTarget, driftSteps);
        allPoints.push(...driftPath);

        // --- FASE 2: APPROACH verso il target (più preciso) ---
        const approachSteps = Math.max(4, Math.min(8, Math.round(dist / 120)));
        const approachPath = MouseGenerator.generatePath(driftTarget, target, approachSteps);
        // Skip il primo punto (è uguale all'ultimo di driftPath)
        allPoints.push(...approachPath.slice(1));

        // --- FASE 3: OVERSHOOT (40% delle volte per distanze >200px) ---
        if (dist > 200 && Math.random() < 0.4) {
            const overshootDist = 5 + Math.random() * 15; // 5-20px oltre il target
            const overshootAngle = Math.atan2(target.y - start.y, target.x - start.x) + (Math.random() - 0.5) * 0.5;
            const overshootPoint: Point = {
                x: Math.max(5, Math.min(vw - 5, target.x + Math.cos(overshootAngle) * overshootDist)),
                y: Math.max(5, Math.min(vh - 5, target.y + Math.sin(overshootAngle) * overshootDist)),
            };
            const overshootPath = MouseGenerator.generatePath(target, overshootPoint, 3);
            allPoints.push(...overshootPath.slice(1));

            // --- FASE 4: CORRECTION (torna al target) ---
            const correctionPath = MouseGenerator.generatePath(overshootPoint, target, 3);
            allPoints.push(...correctionPath.slice(1));
        }

        // Forza atterraggio esatto
        allPoints[allPoints.length - 1] = { ...target };
        return allPoints;
    }
}
