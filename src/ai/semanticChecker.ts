import { requestOpenAIEmbeddings, isOpenAIConfigured } from './openaiClient';

interface MemoryItem {
    text: string;
    embedding?: number[];
}

export class SemanticChecker {
    private static memory: MemoryItem[] = [];
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

    private static cosineSimilarity(vec1: number[], vec2: number[]): number {
        if (vec1.length !== vec2.length) return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vec1.length; i++) {
            dotProduct += vec1[i] * vec2[i];
            normA += vec1[i] * vec1[i];
            normB += vec2[i] * vec2[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Verifica se il nuovo testo è troppo simile ad uno degli ultimi messaggi inviati.
     * @param text Testo da verificare.
     * @param threshold Soglia (es. 0.8 per 80% di similarità).
     * @returns True se è troppo simile a qualcosa in memoria.
     */
    public static async isTooSimilar(text: string, threshold: number = 0.8): Promise<boolean> {
        let queryEmbedding: number[] | undefined;

        if (isOpenAIConfigured()) {
            try {
                queryEmbedding = await requestOpenAIEmbeddings(text);
            } catch {
                // Fallback silently to Jaccard
            }
        }

        for (const pastMsg of this.memory) {
            if (queryEmbedding && pastMsg.embedding) {
                const sim = this.cosineSimilarity(queryEmbedding, pastMsg.embedding);
                if (sim > threshold) return true;
            } else {
                if (this.jaccardSimilarity(text, pastMsg.text) > threshold) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Aggiunge un nuovo messaggio alla memoria (se non è vuoto).
     */
    public static async remember(text: string): Promise<void> {
        const t = text.trim();
        if (!t) return;

        let embedding: number[] | undefined;
        if (isOpenAIConfigured()) {
            try {
                embedding = await requestOpenAIEmbeddings(t);
            } catch {
                // Ignore, will fallback to jaccard
            }
        }

        this.memory.push({ text: t, embedding });
        if (this.memory.length > this.MAX_MEMORY) {
            this.memory.shift();
        }
    }
}
