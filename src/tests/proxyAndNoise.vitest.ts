import { describe, it, expect } from 'vitest';
import { markProxyFailed } from '../proxyManager';

describe('proxyManager — markProxyFailed (M34)', () => {
    it('non lancia con proxy valido e timeout', () => {
        expect(() => markProxyFailed({ server: 'http://proxy.test:8080' }, 'timeout')).not.toThrow();
    });

    it('non lancia con proxy valido e ban', () => {
        expect(() => markProxyFailed({ server: 'http://proxy.test:8080' }, 'ban')).not.toThrow();
    });

    it('non lancia con proxy valido e connection_refused', () => {
        expect(() => markProxyFailed({ server: 'http://proxy.test:8080' }, 'connection_refused')).not.toThrow();
    });

    it('non lancia con errorType undefined', () => {
        expect(() => markProxyFailed({ server: 'http://proxy.test:8080' })).not.toThrow();
    });

    it('non lancia con errorType unknown', () => {
        expect(() => markProxyFailed({ server: 'http://proxy.test:8080' }, 'unknown')).not.toThrow();
    });
});
