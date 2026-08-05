import { describe, it, expect, vi } from 'vitest';

// Mock leggeri: isolano il test dalla config reale e dalla catena DB del logger.
vi.mock('../config', () => ({
    config: { ollamaEndpoint: 'http://127.0.0.1:11434', aiProvider: 'auto' },
}));
vi.mock('../telemetry/logger', () => ({
    logInfo: vi.fn(),
    logWarn: vi.fn(),
}));

// F-a3f17c02: `isLoopbackEndpoint` viveva in ollamaLifecycle ed era la quarta copia della regola.
// Il contratto («quale endpoint è un server che possiamo avviare noi») non cambia: cambia da dove
// viene la risposta. I casi storici restano tutti, per dimostrare che nulla si è perso (zero-Q).
import { isLoopbackAiHost } from '../config/env';

describe('ollamaLifecycle — endpoint avviabile localmente (regola dalla SSOT config/env)', () => {
    it('riconosce gli host loopback come locali (server gestibile da noi)', () => {
        expect(isLoopbackAiHost('http://127.0.0.1:11434')).toBe(true);
        expect(isLoopbackAiHost('http://localhost:11434')).toBe(true);
        expect(isLoopbackAiHost('http://[::1]:11434')).toBe(true);
        expect(isLoopbackAiHost('http://127.0.0.1:11434/')).toBe(true);
    });

    it('rifiuta endpoint remoti (gestiti altrove, mai avviati localmente)', () => {
        expect(isLoopbackAiHost('https://ollama.example.com')).toBe(false);
        expect(isLoopbackAiHost('http://192.168.1.10:11434')).toBe(false);
        expect(isLoopbackAiHost('http://10.0.0.5:11434')).toBe(false);
    });

    it('rifiuta input non validi senza lanciare', () => {
        expect(isLoopbackAiHost('')).toBe(false);
        expect(isLoopbackAiHost('not-a-url')).toBe(false);
    });

    it('guadagna i casi che la copia locale trattava per errore come remoti', () => {
        expect(isLoopbackAiHost('http://127.0.0.2:11434')).toBe(true);
        expect(isLoopbackAiHost('http://0.0.0.0:11434')).toBe(true);
    });
});
