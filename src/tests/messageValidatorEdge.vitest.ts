import { describe, it, expect } from 'vitest';
import { validateMessageContent, extractUnresolvedPlaceholders, hashMessage } from '../validation/messageValidator';

describe('messageValidator — edge cases finali', () => {
    it('messaggio con solo emoji → valido', () => {
        const result = validateMessageContent('👋🎉🚀', { duplicateCountLast24h: 0 });
        expect(result.valid).toBe(true);
    });

    it('messaggio con newline → valido', () => {
        const result = validateMessageContent('Ciao!\n\nCome stai?', { duplicateCountLast24h: 0 });
        expect(result.valid).toBe(true);
    });

    it('messaggio con caratteri speciali → valido', () => {
        const result = validateMessageContent('Café résumé naïve über straße', { duplicateCountLast24h: 0 });
        expect(result.valid).toBe(true);
    });

    it('messaggio esattamente al maxLen → valido', () => {
        const msg = 'a'.repeat(550);
        const result = validateMessageContent(msg, { duplicateCountLast24h: 0 });
        expect(result.valid).toBe(true);
    });

    it('messaggio 1 char sopra maxLen → invalido', () => {
        const msg = 'a'.repeat(551);
        const result = validateMessageContent(msg, { duplicateCountLast24h: 0 });
        expect(result.valid).toBe(false);
    });

    it('duplicateCountLast24h esattamente 2 → valido', () => {
        const result = validateMessageContent('Test', { duplicateCountLast24h: 2 });
        expect(result.valid).toBe(true);
    });

    it('duplicateCountLast24h esattamente 3 → invalido', () => {
        const result = validateMessageContent('Test', { duplicateCountLast24h: 3 });
        expect(result.valid).toBe(false);
    });

    it('placeholder {{}} vuoto → rilevato', () => {
        expect(extractUnresolvedPlaceholders('{{}}').length).toBe(0); // {{}} senza contenuto non matcha il regex
    });

    it('placeholder con spazi {{nome}} → rilevato', () => {
        expect(extractUnresolvedPlaceholders('{{ nome }}').length).toBe(1);
    });

    it('hashMessage di messaggi lunghi → hash 64 char', () => {
        const hash = hashMessage('a'.repeat(10000));
        expect(hash.length).toBe(64);
    });

    it('hashMessage è case-sensitive', () => {
        expect(hashMessage('Hello')).not.toBe(hashMessage('hello'));
    });
});
