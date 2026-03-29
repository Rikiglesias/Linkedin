/**
 * tests/stealth.vitest.ts
 * ─────────────────────────────────────────────────────────────────
 * Test di regressione per lo script stealth. Verifica che il JS
 * generato da buildStealthInitScript() contenga tutti i mock
 * anti-detection critici e sia sintatticamente valido.
 */

import { describe, test, expect } from 'vitest';
import { buildStealthInitScript } from '../browser/stealthScripts';

describe('Stealth Regression Tests', () => {
    const defaultScript = buildStealthInitScript({
        locale: 'it-IT',
        languages: ['it-IT', 'it', 'en-US', 'en'],
        isHeadless: false,
    });

    test('script è JS parsabile senza errori di sintassi', () => {
        expect(() => new Function(defaultScript)).not.toThrow();
    });

    test('script ha lunghezza ragionevole (> 5KB)', () => {
        expect(defaultScript.length).toBeGreaterThan(5000);
    });

    test('navigator.webdriver override presente', () => {
        expect(defaultScript).toContain('webdriver');
    });

    test('navigator.plugins mock presente', () => {
        expect(defaultScript).toContain('plugins');
        expect(defaultScript).toContain('PluginArray');
    });

    test('chrome.runtime mock presente', () => {
        expect(defaultScript).toContain('chrome');
        expect(defaultScript).toContain('runtime');
    });

    test('WebRTC leak prevention presente', () => {
        expect(defaultScript).toContain('RTCPeerConnection');
    });

    test('Notification permission mock presente', () => {
        expect(defaultScript).toContain('Notification');
        expect(defaultScript).toContain('permission');
    });

    test('Battery API mock presente', () => {
        expect(defaultScript).toContain('getBattery');
    });

    test('AudioContext fingerprint protection presente', () => {
        expect(defaultScript).toContain('AudioContext');
    });

    test('CDP leak prevention presente', () => {
        expect(defaultScript).toContain('Runtime');
    });

    test('headless mode aggiunge guard extra', () => {
        const headlessScript = buildStealthInitScript({
            locale: 'en-US',
            languages: ['en-US', 'en'],
            isHeadless: true,
        });
        expect(headlessScript.length).toBeGreaterThan(defaultScript.length);
    });

    test('skip sections rispettate', () => {
        const withSkip = buildStealthInitScript({
            locale: 'it-IT',
            languages: ['it-IT'],
            isHeadless: false,
            skipSections: new Set(['webrtc', 'battery']),
        });
        // Lo script con skip dovrebbe essere più corto
        expect(withSkip.length).toBeLessThan(defaultScript.length);
    });

    test('hwConcurrency override presente', () => {
        expect(defaultScript).toContain('hardwareConcurrency');
    });

    test('deviceMemory override presente', () => {
        expect(defaultScript).toContain('deviceMemory');
    });

    test('language consistency presente', () => {
        expect(defaultScript).toContain('it-IT');
    });

    test('iframe chrome consistency presente', () => {
        expect(defaultScript).toContain('iframe');
    });
});

describe('Stealth Runtime Execution Tests', () => {
    // Esegue lo script stealth in un contesto JS simulato per verificare
    // che non lanci errori a runtime (TypeError, ReferenceError, ecc.)
    // Questo cattura bug che i test string-based non vedono.

    function createMockBrowserGlobals(): Record<string, unknown> {
        const mockElement = {
            id: '',
            style: { cssText: '' },
            textContent: '',
            classList: { add: () => {}, remove: () => {}, contains: () => false },
            setAttribute: () => {},
            removeAttribute: () => {},
            appendChild: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => true,
        };
        const mockDocument = {
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            createElement: () => ({ ...mockElement }),
            documentElement: {
                appendChild: () => {},
                classList: { add: () => {}, remove: () => {} },
            },
            addEventListener: () => {},
            dispatchEvent: () => true,
            visibilityState: 'visible',
            hidden: false,
        };
        const mockNavigator = {
            webdriver: false,
            plugins: [],
            languages: ['it-IT', 'it', 'en-US', 'en'],
            language: 'it-IT',
            hardwareConcurrency: 8,
            deviceMemory: 8,
            platform: 'Win32',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            permissions: {
                query: () =>
                    Promise.resolve({
                        state: 'prompt',
                        onchange: null,
                        addEventListener: () => {},
                        removeEventListener: () => {},
                        dispatchEvent: () => true,
                    }),
            },
            getBattery: undefined,
            connection: undefined,
        };
        return {
            window: {
                chrome: undefined,
                RTCPeerConnection: undefined,
                webkitRTCPeerConnection: undefined,
                AudioContext: undefined,
                webkitAudioContext: undefined,
                dispatchEvent: () => true,
                addEventListener: () => {},
            },
            document: mockDocument,
            navigator: mockNavigator,
            Object,
            Promise,
            Math,
            Date,
            Array,
            Set,
            Map,
            Notification: { permission: 'default' },
            AudioBuffer: { prototype: { getChannelData: () => new Float32Array(0) } },
            HTMLCanvasElement: { prototype: { getContext: () => null } },
            setTimeout,
            clearTimeout,
            console,
        };
    }

    function executeStealthInMockContext(script: string, globals: Record<string, unknown>): void {
        // L'IIFE accede a globali come `window`, `document`, `navigator` direttamente.
        // In Node.js non esistono — li iniettiamo via `with` statement simulato
        // wrappando lo script in una funzione che li riceve come variabili locali.
        const paramNames = Object.keys(globals);
        const paramValues = paramNames.map((k) => globals[k]);
        const wrappedBody = `"use strict"; ${script}`;
        const fn = new Function(...paramNames, wrappedBody);
        fn(...paramValues);
    }

    test('script stealth default esegue senza errori runtime', () => {
        const script = buildStealthInitScript({
            locale: 'it-IT',
            languages: ['it-IT', 'it', 'en-US', 'en'],
            isHeadless: false,
        });
        expect(() => executeStealthInMockContext(script, createMockBrowserGlobals())).not.toThrow();
    });

    test('script stealth headless esegue senza errori runtime', () => {
        const script = buildStealthInitScript({
            locale: 'en-US',
            languages: ['en-US', 'en'],
            isHeadless: true,
        });
        expect(() => executeStealthInMockContext(script, createMockBrowserGlobals())).not.toThrow();
    });

    test('script stealth con skip sections esegue senza errori runtime', () => {
        const script = buildStealthInitScript({
            locale: 'it-IT',
            languages: ['it-IT'],
            isHeadless: false,
            skipSections: new Set(['webrtc', 'battery', 'audio', 'plugins']),
        });
        expect(() => executeStealthInMockContext(script, createMockBrowserGlobals())).not.toThrow();
    });
});
