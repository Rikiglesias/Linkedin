export class SemanticChecker {
    private static memory: string[] = [];
    private static MAX_MEMORY = 50;

    /**
     * Calcola la Jaccard similarity (0-1) tra due stringhe,
     * basata su bigrammi di parole.
     */
    private static jaccardSimilarity(str1: string, str2: string): number {
        const getBigrams = (s: string) => {
            const words = s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 0);
            const bigrams = new Set<string>();
            for (let i = 0; i < words.length - 1; i++) {
                bigrams.add(`${words[i]} ${words[i + 1]}`);
            }
            return bigrams;
        };

        const set1 = getBigrams(str1);
        const set2 = getBigrams(str2);

        if (set1.size === 0 && set2.size === 0) return 1.0;
        if (set1.size === 0 || set2.size === 0) return 0.0;

        let intersectionSize = 0;
        for (const item of set1) {
            if (set2.has(item)) intersectionSize++;
        }

        const unionSize = set1.size + set2.size - intersectionSize;
        return intersectionSize / unionSize;
    }

    /**
     * Verifica se il nuovo testo è troppo simile ad uno degli ultimi messaggi inviati.
     * @param text Testo da verificare.
     * @param threshold Soglia (es. 0.8 per 80% di similarità).
     * @returns True se è troppo simile a qualcosa in memoria.
     */
    public static isTooSimilar(text: string, threshold: number = 0.8): boolean {
        for (const pastMsg of this.memory) {
            if (this.jaccardSimilarity(text, pastMsg) > threshold) {
                return true;
            }
        }
        return false;
    }

    /**
     * Aggiunge un nuovo messaggio alla memoria (se non è vuoto).
     */
    public static remember(text: string): void {
        const t = text.trim();
        if (!t) return;
        this.memory.push(t);
        if (this.memory.length > this.MAX_MEMORY) {
            this.memory.shift();
        }
    }
}
