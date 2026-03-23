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

export function registerDismissOverlaysFn(fn: DismissFn): void {
    _dismissFn = fn;
}

export function registerMouseMoveFn(fn: MouseMoveFn): void {
    _mouseMoveFn = fn;
}

export async function callDismissOverlays(page: Page): Promise<number> {
    if (!_dismissFn) return 0;
    return _dismissFn(page);
}

export async function callMouseMove(page: Page, x: number, y: number): Promise<void> {
    if (!_mouseMoveFn) return;
    return _mouseMoveFn(page, x, y);
}

// ─── Bridge per organicContent (stessa logica) ───────────────────────────────

type InteractWithFeedFn = (page: Page, probability: number) => Promise<void>;
let _interactWithFeedFn: InteractWithFeedFn | null = null;

export function registerInteractWithFeedFn(fn: InteractWithFeedFn): void {
    _interactWithFeedFn = fn;
}

export async function callInteractWithFeed(page: Page, probability: number): Promise<void> {
    if (!_interactWithFeedFn) return;
    return _interactWithFeedFn(page, probability);
}
