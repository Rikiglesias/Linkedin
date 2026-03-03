export interface TimingContext {
    actionType: 'read' | 'click' | 'type' | 'scroll' | 'interJob';
    contentLength?: number;
    baseMin: number;
    baseMax: number;
}

export function calculateContextualDelay(context: TimingContext): number {
    const rawDelay = context.baseMin + Math.random() * (context.baseMax - context.baseMin);

    // Fatigue factor: simula lentezza fuori orario lavorativo o post-pranzo
    const hour = new Date().getHours();
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

    // Jitter per evitare timing piatti
    const jitter = 0.85 + Math.random() * 0.3; // 0.85 -> 1.15

    return Math.round(rawDelay * fatigueMultiplier * contentMultiplier * jitter);
}
