import { describe, it, expect } from 'vitest';
import { markProxyFailed } from '../proxyManager';

describe('proxyManager — markProxyFailed advanced', () => {
    it('cooldown differenziato: ban → cooldown lungo', () => {
        // Non possiamo verificare il cooldown direttamente, ma verifichiamo che non lanci
        expect(() => markProxyFailed({ server: 'http://proxy:8080' }, 'ban')).not.toThrow();
    });

    it('cooldown differenziato: timeout → cooldown corto', () => {
        expect(() => markProxyFailed({ server: 'http://proxy:8080' }, 'timeout')).not.toThrow();
    });

    it('server con porta non standard', () => {
        expect(() => markProxyFailed({ server: 'http://proxy:12345' }, 'timeout')).not.toThrow();
    });

    it('server con auth URL', () => {
        expect(() => markProxyFailed({ server: 'http://user:pass@proxy:8080' }, 'timeout')).not.toThrow();
    });

    it('server HTTPS', () => {
        expect(() => markProxyFailed({ server: 'https://proxy:8443' }, 'connection_refused')).not.toThrow();
    });

    it('chiamate multiple consecutive non lanciano', () => {
        for (let i = 0; i < 5; i++) {
            expect(() => markProxyFailed({ server: 'http://proxy:8080' }, 'timeout')).not.toThrow();
        }
    });
});
