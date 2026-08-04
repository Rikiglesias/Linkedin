/**
 * browser/overlayBridge.ts — Bridge per rompere circular dep humanBehavior ↔ overlayDismisser.
 *
 * Problema: humanBehavior importa dismissKnownOverlays da overlayDismisser,
 * e overlayDismisser importa humanMouseMoveToCoords da humanBehavior → ciclo.
 *
 * Soluzione: questo bridge registra le funzioni a runtime (dependency injection).
 * - overlayDismisser registra dismissKnownOverlays qui al boot
 * - humanBehavior chiama getDismissOverlaysFn() senza importare overlayDismisser
 * - overlayDismisser chiama getMouseMoveFn() senza importare humanBehavior
 */

import type { Page } from 'playwright';

type DismissFn = (page: Page) => Promise<number>;
type MouseMoveFn = (page: Page, x: number, y: number) => Promise<void>;

let _dismissFn: DismissFn | null = null;
let _mouseMoveFn: MouseMoveFn | null = null;

/**
 * Conteggio delle chiamate arrivate quando la funzione NON era registrata.
 *
 * Serve perché un bridge non registrato è muto: `callDismissOverlays` torna 0 e le altre due tornano
 * `undefined`, cioè esattamente quello che restituirebbero avendo lavorato. È la forma che ha tenuto
 * i tre bridge scollegati per mesi senza che nulla lo segnalasse (registrazioni in `browser/index.ts`,
 * mai importato, invece che in `src/browser.ts`).
 *
 * Deliberatamente SENZA import: questo file esiste per rompere un ciclo di dipendenze, quindi non può
 * dipendere dal logger. Chi ha il logger legge `getBridgeMisses()`; l'avviso su console è solo la rete
 * immediata, ed è emesso una volta per funzione per non diventare rumore in un ciclo.
 */
const _misses: Record<string, number> = { dismissOverlays: 0, mouseMove: 0, interactWithFeed: 0 };

function registraMiss(nome: keyof typeof _misses): void {
    _misses[nome] += 1;
    if (_misses[nome] === 1) {
        console.warn(
            `[overlayBridge] "${nome}" chiamata ma non registrata: l'azione NON avviene e il ritorno è ` +
                `indistinguibile dal successo. Attesa la registrazione in src/browser.ts (entry point reale).`,
        );
    }
}

/** Chiamate andate a vuoto per funzione. Zero su tutte = i tre bridge sono collegati. */
export function getBridgeMisses(): Readonly<Record<string, number>> {
    return { ..._misses };
}

export function registerDismissOverlaysFn(fn: DismissFn): void {
    _dismissFn = fn;
}

export function registerMouseMoveFn(fn: MouseMoveFn): void {
    _mouseMoveFn = fn;
}

export async function callDismissOverlays(page: Page): Promise<number> {
    if (!_dismissFn) {
        registraMiss('dismissOverlays');
        return 0;
    }
    return _dismissFn(page);
}

export async function callMouseMove(page: Page, x: number, y: number): Promise<void> {
    if (!_mouseMoveFn) {
        registraMiss('mouseMove');
        return;
    }
    return _mouseMoveFn(page, x, y);
}

// ─── Bridge per organicContent (stessa logica) ───────────────────────────────

type InteractWithFeedFn = (page: Page, probability: number) => Promise<void>;
let _interactWithFeedFn: InteractWithFeedFn | null = null;

export function registerInteractWithFeedFn(fn: InteractWithFeedFn): void {
    _interactWithFeedFn = fn;
}

export async function callInteractWithFeed(page: Page, probability: number): Promise<void> {
    if (!_interactWithFeedFn) {
        registraMiss('interactWithFeed');
        return;
    }
    return _interactWithFeedFn(page, probability);
}
