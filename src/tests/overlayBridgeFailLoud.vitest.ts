import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Un bridge non registrato è muto: `callDismissOverlays` torna 0 e le altre due `undefined`, cioè
 * esattamente ciò che restituirebbero avendo lavorato. È la forma che ha tenuto i tre bridge
 * scollegati per mesi. Qui si verifica che la chiamata a vuoto lasci una traccia.
 *
 * `resetModules` è necessario perché il bridge tiene stato a livello di modulo: senza, il conteggio
 * sarebbe sporcato dagli altri test (e da `browser.ts`, che registra le funzioni all'import).
 */

const pageFinta = {} as never;

describe('overlayBridge — la chiamata a vuoto non è più silenziosa', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.resetModules();
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('senza registrazione, ogni funzione conta la propria chiamata mancata', async () => {
        const bridge = await import('../browser/overlayBridge');

        expect(bridge.getBridgeMisses()).toEqual({ dismissOverlays: 0, mouseMove: 0, interactWithFeed: 0 });

        await bridge.callDismissOverlays(pageFinta);
        await bridge.callMouseMove(pageFinta, 10, 20);
        await bridge.callInteractWithFeed(pageFinta, 0.2);

        expect(bridge.getBridgeMisses()).toEqual({ dismissOverlays: 1, mouseMove: 1, interactWithFeed: 1 });
    });

    it('il valore di ritorno resta invariato: il fix non cambia il contratto', async () => {
        const bridge = await import('../browser/overlayBridge');

        // Restano quelli di prima — il punto del fix è la traccia, non un cambio di comportamento
        // per i chiamanti (che non sanno gestire un valore nuovo).
        await expect(bridge.callDismissOverlays(pageFinta)).resolves.toBe(0);
        await expect(bridge.callMouseMove(pageFinta, 1, 2)).resolves.toBeUndefined();
        await expect(bridge.callInteractWithFeed(pageFinta, 1)).resolves.toBeUndefined();
    });

    it('avvisa una volta sola per funzione, non a ogni ciclo', async () => {
        const bridge = await import('../browser/overlayBridge');

        for (let i = 0; i < 5; i++) {
            await bridge.callDismissOverlays(pageFinta);
        }

        expect(bridge.getBridgeMisses().dismissOverlays).toBe(5);
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('con le registrazioni vere il conteggio resta a zero', async () => {
        // `../browser` è l'entry point reale: importarlo registra tutte e tre le funzioni.
        await import('../browser');
        const bridge = await import('../browser/overlayBridge');

        await bridge.callDismissOverlays(pageFinta).catch(() => undefined);
        await bridge.callMouseMove(pageFinta, 5, 5).catch(() => undefined);

        expect(bridge.getBridgeMisses().dismissOverlays).toBe(0);
        expect(bridge.getBridgeMisses().mouseMove).toBe(0);
        expect(warnSpy).not.toHaveBeenCalled();
    });
});
