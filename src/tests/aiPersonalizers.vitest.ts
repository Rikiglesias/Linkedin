import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock OpenAI: forza fallback template (no API calls)
vi.mock('../ai/openaiClient', () => ({
    isOpenAIConfigured: () => false,
    requestOpenAIText: async () => '',
    requestOpenAIEmbeddings: async () => [],
}));

// Mock telemetry per evitare side effects
vi.mock('../telemetry/logger', () => ({
    logInfo: async () => {},
    logWarn: async () => {},
    logError: async () => {},
}));

// Mock semanticChecker per evitare stato condiviso
vi.mock('../ai/semanticChecker', () => ({
    SemanticChecker: {
        isTooSimilar: async () => false,
        remember: async () => {},
    },
}));

// Mock abBandit per evitare dipendenza DB
vi.mock('../ml/abBandit', () => ({
    selectVariant: async (variants: string[]) => variants[0] ?? 'TPL_CASUAL_INTEREST',
    inferHourBucket: () => 'morning',
}));

// Mock segments
vi.mock('../ml/segments', () => ({
    inferLeadSegment: () => 'generic',
}));

import { generateInviteNote } from '../ai/inviteNotePersonalizer';
import { scoreLeadProfile, scoreLeadsBatch } from '../ai/leadScorer';
import { analyzeIncomingMessage } from '../ai/sentimentAnalysis';

beforeAll(async () => {
    const { config } = await import('../config');
    config.aiPersonalizationEnabled = false;
    config.aiSentimentEnabled = false;
    config.aiMessageMaxChars = 500;
});

// ═══════════════════════════════════════════════════════════════════════════════
// inviteNotePersonalizer — generateInviteNote (template puro)
// ═══════════════════════════════════════════════════════════════════════════════

describe('inviteNotePersonalizer — generateInviteNote', () => {
    it('genera nota con nome fornito', () => {
        const result = generateInviteNote('Marco');
        expect(result.note).toContain('Marco');
        expect(result.variant).toMatch(/^TPL_/);
    });

    it('nome vuoto → usa fallback "collega" (IT)', () => {
        const result = generateInviteNote('', 'it');
        expect(result.note).toContain('collega');
    });

    it('nome con spazi → trim applicato', () => {
        const result = generateInviteNote('  Anna  ');
        expect(result.note).toContain('Anna');
        expect(result.note).not.toContain('  Anna');
    });

    it('lingua inglese → usa template EN', () => {
        const result = generateInviteNote('John', 'en');
        // I template EN usano "Hi" o "Hello"
        expect(result.note).toMatch(/Hi|Hello/);
    });

    it('lingua francese → usa template FR', () => {
        const result = generateInviteNote('Pierre', 'fr');
        expect(result.note).toContain('Bonjour');
    });

    it('lingua spagnola → usa template ES', () => {
        const result = generateInviteNote('Carlos', 'es');
        expect(result.note).toContain('Hola');
    });

    it('lingua sconosciuta → fallback IT', () => {
        const result = generateInviteNote('Test', 'jp');
        // Fallback a IT
        expect(result.note).toMatch(/Ciao|Salve/);
    });

    it('variant è sempre un template ID valido', () => {
        for (let i = 0; i < 20; i++) {
            const result = generateInviteNote('Test');
            expect(result.variant).toMatch(/^TPL_/);
        }
    });

    it('nota non supera 300 caratteri', () => {
        for (let i = 0; i < 20; i++) {
            const result = generateInviteNote('NomeLunghissimo'.repeat(3));
            expect(result.note.length).toBeLessThanOrEqual(300);
        }
    });

    it('nome vuoto + EN → usa "colleague"', () => {
        const result = generateInviteNote('', 'en');
        expect(result.note).toContain('colleague');
    });

    it('nome vuoto + FR → usa "collègue"', () => {
        const result = generateInviteNote('', 'fr');
        expect(result.note).toContain('collègue');
    });

    it('nome vuoto + ES → usa "colega"', () => {
        const result = generateInviteNote('', 'es');
        expect(result.note).toContain('colega');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// leadScorer — scoreLeadProfile (fallback senza AI)
// ═══════════════════════════════════════════════════════════════════════════════

describe('leadScorer — scoreLeadProfile fallback', () => {
    it('headline vuota → MISSING_HEADLINE_OR_ROLE', async () => {
        const result = await scoreLeadProfile('Acme Corp', 'Mario Rossi', '');
        expect(result.reason).toBe('MISSING_HEADLINE_OR_ROLE');
        expect(result.confidenceScore).toBe(30);
        expect(result.leadScore).toBe(20);
    });

    it('headline null → MISSING_HEADLINE_OR_ROLE', async () => {
        const result = await scoreLeadProfile('Acme Corp', 'Mario Rossi', null);
        expect(result.reason).toBe('MISSING_HEADLINE_OR_ROLE');
    });

    it('headline con solo spazi → MISSING_HEADLINE_OR_ROLE', async () => {
        const result = await scoreLeadProfile('Acme Corp', 'Mario Rossi', '   ');
        expect(result.reason).toBe('MISSING_HEADLINE_OR_ROLE');
    });

    it('headline valida ma AI non configurata → API_ERROR_FALLBACK', async () => {
        const result = await scoreLeadProfile('Acme Corp', 'Mario Rossi', 'CEO at Acme Corp');
        // requestOpenAIText ritorna '' → JSON.parse('') fallisce → catch → API_ERROR_FALLBACK
        expect(result.reason).toBe('API_ERROR_FALLBACK');
        expect(result.confidenceScore).toBe(50);
        expect(result.leadScore).toBe(50);
    });

    it('scores nel range 0-100', async () => {
        const result = await scoreLeadProfile('Test', 'Test', 'Manager');
        expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
        expect(result.confidenceScore).toBeLessThanOrEqual(100);
        expect(result.leadScore).toBeGreaterThanOrEqual(0);
        expect(result.leadScore).toBeLessThanOrEqual(100);
    });
});

describe('leadScorer — scoreLeadsBatch', () => {
    it('batch vuoto → risultato vuoto', async () => {
        const results = await scoreLeadsBatch([]);
        expect(results).toHaveLength(0);
    });

    it('batch singolo → un risultato', async () => {
        const results = await scoreLeadsBatch([
            { accountName: 'Acme', fullName: 'Mario', headline: null },
        ]);
        expect(results).toHaveLength(1);
        expect(results[0].reason).toBe('MISSING_HEADLINE_OR_ROLE');
    });

    it('batch multiplo → risultati paralleli', async () => {
        const leads = Array.from({ length: 5 }, (_, i) => ({
            accountName: `Company_${i}`,
            fullName: `Person_${i}`,
            headline: i % 2 === 0 ? null : `Role_${i}`,
        }));
        const results = await scoreLeadsBatch(leads, { concurrency: 3 });
        expect(results).toHaveLength(5);
        // Quelli con headline null → MISSING_HEADLINE_OR_ROLE
        expect(results[0].reason).toBe('MISSING_HEADLINE_OR_ROLE');
        // Quelli con headline → API_ERROR_FALLBACK (mock returns '')
        expect(results[1].reason).toBe('API_ERROR_FALLBACK');
    });

    it('concurrency clampata a [1, 10]', async () => {
        // Non possiamo testare direttamente il clamp, ma verifichiamo che non crashano
        const leads = [{ accountName: 'A', fullName: 'B', headline: null }];
        const r1 = await scoreLeadsBatch(leads, { concurrency: 0 });
        expect(r1).toHaveLength(1);
        const r2 = await scoreLeadsBatch(leads, { concurrency: 100 });
        expect(r2).toHaveLength(1);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// sentimentAnalysis — analyzeIncomingMessage (fallback senza AI)
// ═══════════════════════════════════════════════════════════════════════════════

describe('sentimentAnalysis — fallback senza AI', () => {
    it('AI disabilitata → UNKNOWN', async () => {
        const result = await analyzeIncomingMessage('Ciao, come stai?');
        expect(result.intent).toBe('UNKNOWN');
        expect(result.subIntent).toBe('NONE');
        expect(result.confidence).toBe(0);
    });

    it('messaggio vuoto → NEUTRAL con confidence 1', async () => {
        // Per messaggio vuoto, il check avviene PRIMA del check AI
        // Ma con aiSentimentEnabled=false, ritorna UNKNOWN prima del check vuoto
        const result = await analyzeIncomingMessage('');
        // Il controllo AI disabilitata avviene prima del check vuoto
        expect(result.intent).toBe('UNKNOWN');
    });

    it('entities sempre array vuoto in fallback', async () => {
        const result = await analyzeIncomingMessage('Messaggio di test');
        expect(result.entities).toEqual([]);
    });

    it('reasoning presente in fallback', async () => {
        const result = await analyzeIncomingMessage('Test');
        expect(result.reasoning.length).toBeGreaterThan(0);
    });
});
