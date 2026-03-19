import { describe, it, expect } from 'vitest';
import { validateMessageContentAsync } from '../validation/messageValidator';

describe('messageValidator — validateMessageContentAsync (M11)', () => {
    it('messaggio valido senza leadId → valido (skip semantic)', async () => {
        const result = await validateMessageContentAsync('Ciao Marco, ho visto il tuo profilo.', {
            duplicateCountLast24h: 0,
        });
        expect(result.valid).toBe(true);
    });

    it('messaggio vuoto → invalido (sync check prima di semantic)', async () => {
        const result = await validateMessageContentAsync('', { duplicateCountLast24h: 0 });
        expect(result.valid).toBe(false);
    });

    it('messaggio troppo lungo → invalido (sync check)', async () => {
        const result = await validateMessageContentAsync('a'.repeat(600), { duplicateCountLast24h: 0 });
        expect(result.valid).toBe(false);
    });

    it('con leadId → tenta semantic check (non lancia se AI non disponibile)', async () => {
        const result = await validateMessageContentAsync('Messaggio di test.', {
            duplicateCountLast24h: 0,
            leadId: 123,
        });
        // Se SemanticChecker non è inizializzato (nessun messaggio in memoria), ritorna valid
        expect(result.valid).toBe(true);
    });

    it('duplicato frequente → invalido prima del semantic check', async () => {
        const result = await validateMessageContentAsync('Messaggio ripetuto.', {
            duplicateCountLast24h: 5,
            leadId: 123,
        });
        expect(result.valid).toBe(false);
    });
});
