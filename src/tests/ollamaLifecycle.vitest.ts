import { describe, it, expect, vi } from 'vitest';

// Mock leggeri: isolano il test dalla config reale e dalla catena DB del logger.
vi.mock('../config', () => ({
    config: { ollamaEndpoint: 'http://127.0.0.1:11434', aiProvider: 'auto' },
}));
vi.mock('../telemetry/logger', () => ({
    logInfo: vi.fn(),
    logWarn: vi.fn(),
}));

import { isLoopbackEndpoint } from '../ai/ollamaLifecycle';

describe('ollamaLifecycle.isLoopbackEndpoint', () => {
    it('riconosce gli host loopback come locali (server gestibile da noi)', () => {
        expect(isLoopbackEndpoint('http://127.0.0.1:11434')).toBe(true);
        expect(isLoopbackEndpoint('http://localhost:11434')).toBe(true);
        expect(isLoopbackEndpoint('http://[::1]:11434')).toBe(true);
        expect(isLoopbackEndpoint('http://127.0.0.1:11434/')).toBe(true);
    });

    it('rifiuta endpoint remoti (gestiti altrove, mai avviati localmente)', () => {
        expect(isLoopbackEndpoint('https://ollama.example.com')).toBe(false);
        expect(isLoopbackEndpoint('http://192.168.1.10:11434')).toBe(false);
        expect(isLoopbackEndpoint('http://10.0.0.5:11434')).toBe(false);
    });

    it('rifiuta input non validi senza lanciare', () => {
        expect(isLoopbackEndpoint('')).toBe(false);
        expect(isLoopbackEndpoint('not-a-url')).toBe(false);
    });
});
