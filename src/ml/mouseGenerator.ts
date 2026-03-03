export interface Point {
    x: number;
    y: number;
}

export class MouseGenerator {
    /**
     * Genera una traiettoria curva naturale (Bézier + Perlin-like noise) per simulare
     * il movimento del mouse umano verso il target, evitando rette perfette.
     */
    public static generatePath(start: Point, target: Point, steps: number = 20): Point[] {
        const path: Point[] = [];
        const dx = target.x - start.x;
        const dy = target.y - start.y;

        // Control point casuale per deviare dalla retta (Bézier quadratica)
        const curveSize = Math.max(20, Math.min(Math.abs(dx), Math.abs(dy)) * 0.4);
        const cp = {
            x: start.x + dx / 2 + (Math.random() - 0.5) * curveSize,
            y: start.y + dy / 2 + (Math.random() - 0.5) * curveSize
        };

        const noiseOffset = Math.random() * 100;

        // Funzione Easing: Ease Out Cubic (decelerazione naturale)
        const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

        for (let i = 0; i <= steps; i++) {
            const rawT = i / steps;
            const t = easeOutCubic(rawT);

            // Calcolo curva di Bézier
            const m1 = 1 - t;
            const bx = m1 * m1 * start.x + 2 * m1 * t * cp.x + t * t * target.x;
            const by = m1 * m1 * start.y + 2 * m1 * t * cp.y + t * t * target.y;

            // Perturbazione armonica (pseudo-Perlin)
            const noiseX = Math.sin(noiseOffset + t * 15) * 3;
            const noiseY = Math.cos(noiseOffset + t * 15) * 3;

            // Smorzamento del noise ai bordi per garantire che parta e arrivi preciso
            const dampening = Math.sin(t * Math.PI);

            path.push({
                x: bx + noiseX * dampening,
                y: by + noiseY * dampening
            });
        }

        // Forza esattezza dell'ultimo punto
        path[path.length - 1] = { ...target };

        return path;
    }
}
