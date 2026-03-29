import { config, getHourInTimezone } from '../config';

export interface TimingContext {
    actionType: 'read' | 'click' | 'type' | 'scroll' | 'interJob';
    contentLength?: number;
    baseMin: number;
    baseMax: number;
    /** Per-account click delay multiplier from behavioral profile (NEW-4).
     * Derived from avgClickDelayMs / 1000. Default 1.0. */
    profileMultiplier?: number;
}

// Box-Muller transform: genera un numero da distribuzione normale standard N(0,1).
function normalRandom(): number {
    let u1: number;
    do {
        u1 = Math.random();
    } while (u1 === 0); // evita log(0)
    const u2 = Math.random();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

export function calculateContextualDelay(context: TimingContext): number {
    // Log-normale: la mediana è al centro del range, con coda lunga a destra
    // (occasionali pause lunghe, tipiche di un umano reale).
    const safeMin = Math.max(1, context.baseMin);
    const safeMax = Math.max(safeMin + 1, context.baseMax);
    const mu = Math.log((safeMin + safeMax) / 2);
    const sigma = (Math.log(safeMax) - Math.log(safeMin)) / 4;
    const rawDelay = Math.max(safeMin, Math.min(safeMax * 1.3, Math.exp(mu + sigma * normalRandom())));

    // Fatigue factor: simula lentezza fuori orario lavorativo o post-pranzo
    const hour = getHourInTimezone(new Date(), config.timezone);
    let fatigueMultiplier = 1.0;

    if (hour >= 18 || hour <= 8) {
        fatigueMultiplier = 1.35; // Lentezza serale/notturna
    } else if (hour >= 13 && hour <= 14) {
        fatigueMultiplier = 1.25; // Lentezza post-pranzo
    }

    // Content factor: leggere contenuti lunghi richiede più tempo
    let contentMultiplier = 1.0;
    if (context.actionType === 'read' && context.contentLength) {
        // Approssimiamo 1000 caratteri come base di riferimento 1.0
        contentMultiplier = Math.max(0.6, Math.min(2.5, context.contentLength / 1000));
    }

    // Per-account behavioral profile multiplier (NEW-4)
    const profileFactor = Math.max(0.5, Math.min(2.0, context.profileMultiplier ?? 1.0));

    // Jitter per evitare timing piatti
    const jitter = 0.85 + Math.random() * 0.3; // 0.85 -> 1.15

    return Math.round(rawDelay * fatigueMultiplier * contentMultiplier * profileFactor * jitter);
}
