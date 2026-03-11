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
