import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SemanticChecker } from '../ai/semanticChecker';

// Mock OpenAI: forza fallback Jaccard puro (no API calls)
vi.mock('../ai/openaiClient', () => ({
    isOpenAIConfigured: () => false,
    requestOpenAIEmbeddings: async () => [],
}));

// ═══════════════════════════════════════════════════════════════════════════════
// SemanticChecker — isTooSimilar + remember (Jaccard fallback, no OpenAI)
// ═══════════════════════════════════════════════════════════════════════════════

describe('SemanticChecker — Jaccard similarity', () => {
    beforeEach(() => {
        // Reset internal memory tra i test
        // @ts-expect-error accessing private static for test cleanup
        SemanticChecker.memory = new Map();
    });

    it('testi identici → troppo simili', async () => {
        await SemanticChecker.remember('Ciao Marco, ho visto il tuo profilo e mi piacerebbe connetterci.', 1);
        const result = await SemanticChecker.isTooSimilar(
            'Ciao Marco, ho visto il tuo profilo e mi piacerebbe connetterci.',
            0.8,
            1,
        );
        expect(result).toBe(true);
    });

    it('testi completamente diversi → non simili', async () => {
        await SemanticChecker.remember('Ciao Marco, ho visto il tuo profilo e mi piacerebbe connetterci.', 1);
        const result = await SemanticChecker.isTooSimilar(
            'Il mercato azionario ha subito un forte calo questa settimana a causa della crisi geopolitica.',
            0.8,
            1,
        );
        expect(result).toBe(false);
    });

    it('testi molto simili con piccole variazioni → troppo simili', async () => {
        await SemanticChecker.remember(
            'Ciao Marco, ho trovato il tuo profilo molto interessante e vorrei aggiungerti alla mia rete.',
            1,
        );
        const result = await SemanticChecker.isTooSimilar(
            'Ciao Marco, ho trovato il tuo profilo davvero interessante e vorrei aggiungerti alla mia rete professionale.',
            0.7,
            1,
        );
        expect(result).toBe(true);
    });

    it('leadId diverso → memorie separate', async () => {
        await SemanticChecker.remember('Testo per lead 1.', 1);
        const result = await SemanticChecker.isTooSimilar('Testo per lead 1.', 0.8, 2);
        // Lead 2 non ha memoria → non può essere simile
        expect(result).toBe(false);
    });

    it('senza leadId → nessun confronto, sempre false', async () => {
        await SemanticChecker.remember('Un messaggio qualsiasi.', 1);
        const result = await SemanticChecker.isTooSimilar('Un messaggio qualsiasi.', 0.8);
        expect(result).toBe(false);
    });

    it('threshold 0 → qualsiasi testo è simile (se c\u2019è memoria)', async () => {
        await SemanticChecker.remember('Qualcosa.', 1);
        // Con threshold 0, anche testi diversi superano la soglia se hanno almeno 1 bigram in comune
        // Testi completamente diversi non condividono bigrammi → false
        const result = await SemanticChecker.isTooSimilar('Completamente diverso qui.', 0, 1);
        // Nessun bigram in comune → Jaccard = 0 → NON supera threshold 0 (> 0 richiesto)
        expect(result).toBe(false);
    });

    it('threshold 0.99 → solo testi (quasi) identici passano', async () => {
        await SemanticChecker.remember('Ciao Mario, come stai oggi?', 1);
        // Jaccard = 1.0 per testi identici, > 0.99 → true
        const exact = await SemanticChecker.isTooSimilar('Ciao Mario, come stai oggi?', 0.99, 1);
        expect(exact).toBe(true);
        const slightDiff = await SemanticChecker.isTooSimilar('Ciao Mario, come stai domani?', 0.99, 1);
        expect(slightDiff).toBe(false);
    });

    it('threshold 1.0 stretto → nessun testo supera (> non >=)', async () => {
        await SemanticChecker.remember('Ciao Mario, come stai oggi?', 1);
        // Jaccard = 1.0 per identici, ma 1.0 > 1.0 è false
        const result = await SemanticChecker.isTooSimilar('Ciao Mario, come stai oggi?', 1.0, 1);
        expect(result).toBe(false);
    });

    it('memoria vuota → sempre false', async () => {
        const result = await SemanticChecker.isTooSimilar('Qualunque testo.', 0.1, 999);
        expect(result).toBe(false);
    });
});

describe('SemanticChecker — remember', () => {
    beforeEach(() => {
        // @ts-expect-error accessing private static for test cleanup
        SemanticChecker.memory = new Map();
    });

    it('stringa vuota → non salvata', async () => {
        await SemanticChecker.remember('', 1);
        await SemanticChecker.remember('   ', 1);
        // @ts-expect-error accessing private static
        const entries = SemanticChecker.memory.get(1);
        expect(entries).toBeUndefined();
    });

    it('senza leadId → non salvata', async () => {
        await SemanticChecker.remember('Testo valido');
        // @ts-expect-error accessing private static
        expect(SemanticChecker.memory.size).toBe(0);
    });

    it('LRU eviction dopo MAX_MEMORY_PER_LEAD (10)', async () => {
        for (let i = 0; i < 15; i++) {
            await SemanticChecker.remember(`Messaggio numero ${i} con contenuto diverso.`, 1);
        }
        // @ts-expect-error accessing private static
        const entries = SemanticChecker.memory.get(1);
        expect(entries).toBeDefined();
        if (entries) {
            expect(entries.length).toBeLessThanOrEqual(10);
            // Il primo messaggio dovrebbe essere stato evitato (LRU)
            expect(entries[0].text).not.toContain('numero 0');
        }
    });

    it('più lead → memorie indipendenti', async () => {
        await SemanticChecker.remember('Per lead 1.', 1);
        await SemanticChecker.remember('Per lead 2.', 2);
        // @ts-expect-error accessing private static
        expect(SemanticChecker.memory.size).toBe(2);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SemanticChecker — jaccardSimilarity edge cases (testato indirettamente)
// ═══════════════════════════════════════════════════════════════════════════════

describe('SemanticChecker — Jaccard edge cases', () => {
    beforeEach(() => {
        // @ts-expect-error accessing private static for test cleanup
        SemanticChecker.memory = new Map();
    });

    it('testi con una sola parola → 0 bigrammi → similarity 0', async () => {
        await SemanticChecker.remember('Ciao', 1);
        const result = await SemanticChecker.isTooSimilar('Ciao', 0.5, 1);
        // Una sola parola = 0 bigrammi da entrambi → Jaccard(∅, ∅) = 1.0
        expect(result).toBe(true);
    });

    it('punteggiatura ignorata nella similarità', async () => {
        await SemanticChecker.remember('Ciao Marco, come va?', 1);
        const result = await SemanticChecker.isTooSimilar('Ciao Marco come va', 0.8, 1);
        expect(result).toBe(true);
    });

    it('case insensitive', async () => {
        await SemanticChecker.remember('CIAO MARCO COME VA', 1);
        const result = await SemanticChecker.isTooSimilar('ciao marco come va', 0.8, 1);
        expect(result).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SemanticChecker — cosineSimilarity (testato indirettamente tramite mock)
// ═══════════════════════════════════════════════════════════════════════════════

describe('SemanticChecker — cosineSimilarity via direct call', () => {
    it('vettori identici → 1.0', () => {
        // @ts-expect-error accessing private static
        const sim = SemanticChecker.cosineSimilarity([1, 2, 3], [1, 2, 3]);
        expect(sim).toBeCloseTo(1.0);
    });

    it('vettori opposti → -1.0', () => {
        // @ts-expect-error accessing private static
        const sim = SemanticChecker.cosineSimilarity([1, 0], [-1, 0]);
        expect(sim).toBeCloseTo(-1.0);
    });

    it('vettori ortogonali → 0', () => {
        // @ts-expect-error accessing private static
        const sim = SemanticChecker.cosineSimilarity([1, 0], [0, 1]);
        expect(sim).toBeCloseTo(0);
    });

    it('lunghezze diverse → 0', () => {
        // @ts-expect-error accessing private static
        const sim = SemanticChecker.cosineSimilarity([1, 2], [1, 2, 3]);
        expect(sim).toBe(0);
    });

    it('vettore zero → 0', () => {
        // @ts-expect-error accessing private static
        const sim = SemanticChecker.cosineSimilarity([0, 0], [1, 2]);
        expect(sim).toBe(0);
    });
});
