import { describe, it, expect } from 'vitest';
import { createTestAppContext } from '../core/appContext';
import { bridgeLeadStatus, bridgeAccountHealth } from '../cloud/cloudBridge';

describe('appContext — createTestAppContext', () => {
    it('crea contesto con logger noop', () => {
        const ctx = createTestAppContext({});
        expect(ctx.logger).toBeDefined();
        expect(typeof ctx.logger.info).toBe('function');
        expect(typeof ctx.logger.warn).toBe('function');
        expect(typeof ctx.logger.error).toBe('function');
    });

    it('accetta overrides parziali', () => {
        const customLogger = {
            info: async () => {},
            warn: async () => {},
            error: async () => {},
        };
        const ctx = createTestAppContext({ logger: customLogger });
        expect(ctx.logger).toBe(customLogger);
    });

    it('db è un oggetto (anche mock vuoto)', () => {
        const ctx = createTestAppContext({});
        expect(ctx.db).toBeDefined();
    });
});

describe('cloudBridge — fire-and-forget', () => {
    it('bridgeLeadStatus non lancia (fire-and-forget)', () => {
        // Senza Supabase configurato, dovrebbe ritornare silenziosamente
        expect(() => bridgeLeadStatus('https://www.linkedin.com/in/test', 'INVITED')).not.toThrow();
    });

    it('bridgeAccountHealth non lancia', () => {
        expect(() => bridgeAccountHealth('test-account', 'GREEN')).not.toThrow();
    });
});
