/**
 * browser/index.ts — Barrel re-export
 * ─────────────────────────────────────────────────────────────────
 * Export completi del browser layer in path modulare (`./browser/index`).
 */

export * from './launcher';
export * from './humanBehavior';
export * from './uiFallback';
export * from './auth';
export * from './stealth';
export * from './deviceProfile';
export * from './overlayDismisser';
export * from './navigationContext';
export * from './windowInputBlock';

// Bridge registration: collega le funzioni per rompere circular dep
// humanBehavior ↔ overlayDismisser. Deve avvenire DOPO che entrambi i moduli sono caricati.
import { registerDismissOverlaysFn, registerMouseMoveFn, registerInteractWithFeedFn } from './overlayBridge';
import { dismissKnownOverlays } from './overlayDismisser';
import { humanMouseMoveToCoords } from './humanBehavior';
import { interactWithFeed } from './organicContent';
registerDismissOverlaysFn(dismissKnownOverlays);
registerMouseMoveFn(humanMouseMoveToCoords);
registerInteractWithFeedFn(interactWithFeed);
