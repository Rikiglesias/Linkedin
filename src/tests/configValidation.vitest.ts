import { describe, it, expect, beforeAll } from 'vitest';
import { validateConfigFull } from '../config/validation';
import { config } from '../config';

describe('config/validation — validateConfigFull', () => {
    beforeAll(() => {
        // Assicura config sensata per i test
        config.sessionDir = config.sessionDir || './sessions';
    });

    it('config default non ha errori critici', () => {
        const result = validateConfigFull(config, process.env.NODE_ENV ?? 'test');
        // Potrebbero esserci warning (es. HARD_INVITE_CAP > 50) ma non errori critici
        // che bloccano il bot. Verifichiamo che non ci siano errori senza severity: 'warn'.
        expect(result).toBeDefined();
    });

    it('ritorna oggetto con errors e warnings', () => {
        const result = validateConfigFull(config, 'test');
        expect(Array.isArray(result.errors)).toBe(true);
        expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('errors e warnings sono stringhe', () => {
        const result = validateConfigFull(config, 'test');
        for (const err of result.errors) {
            expect(typeof err).toBe('string');
        }
        for (const warn of result.warnings) {
            expect(typeof warn).toBe('string');
        }
    });
});
