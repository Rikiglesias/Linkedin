import { describe, it, expect } from 'vitest';
import { createTestAppContext } from '../core/appContext';

describe('appContext — advanced', () => {
    it('logger noop non lancia', async () => {
        const ctx = createTestAppContext({});
        await expect(ctx.logger.info('test', {})).resolves.not.toThrow();
        await expect(ctx.logger.warn('test', {})).resolves.not.toThrow();
        await expect(ctx.logger.error('test', {})).resolves.not.toThrow();
    });

    it('config override funziona', () => {
        const mockConfig = { timezone: 'UTC' } as never;
        const ctx = createTestAppContext({ config: mockConfig });
        expect(ctx.config).toBe(mockConfig);
    });

    it('db override funziona', () => {
        const mockDb = { query: async () => [], get: async () => undefined, run: async () => ({ changes: 0 }) } as never;
        const ctx = createTestAppContext({ db: mockDb });
        expect(ctx.db).toBe(mockDb);
    });

    it('logger override funziona', () => {
        let logged = false;
        const ctx = createTestAppContext({
            logger: { info: async () => { logged = true; }, warn: async () => {}, error: async () => {} },
        });
        void ctx.logger.info('test');
        expect(logged).toBe(true);
    });
});
