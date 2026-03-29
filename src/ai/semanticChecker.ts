import { requestOpenAIEmbeddings, isOpenAIConfigured } from './openaiClient';

interface MemoryItem {
    text: string;
    embedding?: number[];
}

const MAX_MEMORY_PER_LEAD = 10;

export class SemanticChecker {
    private static memory: Map<number, MemoryItem[]> = new Map();

    /**
     * Calcola la Jaccard similarity (0-1) tra due stringhe,
     * basata su bigrammi di parole.
     */
    private static jaccardSimilarity(str1: string, str2: string): number {
        const getBigrams = (s: string) => {
            const words = s
                .toLowerCase()
                .replace(/[^\w\s]/g, '')
                .split(/\s+/)
                .filter((w) => w.length > 0);
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
     * Carica testi da DB per un lead se non presenti in memoria (persistenza cross-restart).
     */
    private static async loadFromDbIfNeeded(leadId: number): Promise<void> {
        if (this.memory.has(leadId)) return;
        try {
            const { getRecentMessageTexts } = await import('../core/repositories/leadsLearning');
            const texts = await getRecentMessageTexts(leadId, MAX_MEMORY_PER_LEAD);
            if (texts.length > 0) {
                this.memory.set(
                    leadId,
                    texts.map((t) => ({ text: t })),
                );
            }
        } catch {
            // DB non disponibile — procedi con memoria vuota
        }
    }

    /**
     * Verifica se il nuovo testo è troppo simile ad uno degli ultimi messaggi inviati.
     * Carica da DB al primo check per persistenza cross-restart.
     * @param text Testo da verificare.
     * @param threshold Soglia (es. 0.8 per 80% di similarità).
     * @returns True se è troppo simile a qualcosa in memoria.
     */
    public static async isTooSimilar(text: string, threshold: number = 0.8, leadId?: number): Promise<boolean> {
        if (leadId !== undefined) {
            await this.loadFromDbIfNeeded(leadId);
        }
        const entries = leadId !== undefined ? (this.memory.get(leadId) ?? []) : [];

        let queryEmbedding: number[] | undefined;

        if (isOpenAIConfigured()) {
            try {
                queryEmbedding = await requestOpenAIEmbeddings(text);
            } catch {
                // Fallback silently to Jaccard
            }
        }

        for (const pastMsg of entries) {
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
    public static async remember(text: string, leadId?: number): Promise<void> {
        const t = text.trim();
        if (!t || leadId === undefined) return;

        let embedding: number[] | undefined;
        if (isOpenAIConfigured()) {
            try {
                embedding = await requestOpenAIEmbeddings(t);
            } catch {
                // Ignore, will fallback to jaccard
            }
        }

        let entries = this.memory.get(leadId);
        if (!entries) {
            entries = [];
            this.memory.set(leadId, entries);
        }

        entries.push({ text: t, embedding });

        // LRU eviction: drop oldest entries when limit exceeded
        while (entries.length > MAX_MEMORY_PER_LEAD) {
            entries.shift();
        }
    }
}
