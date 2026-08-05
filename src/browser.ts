/**
 * browser.ts
 * ─────────────────────────────────────────────────────────────────
 * Entry-point retrocompatibile del browser layer.
 * Re-exporta launcher, auth, human behavior e fallback UI.
 */

export { launchBrowser, closeBrowser, performBrowserGC } from './browser/launcher';
export type { BrowserSession, CloudFingerprint, LaunchBrowserOptions } from './browser/launcher';

export {
    humanDelay,
    humanMouseMove,
    enableVisualCursorOverlay,
    pulseVisualCursorOverlay,
    humanTap,
    humanSwipe,
    randomMouseMove,
    humanType,
    simulateHumanReading,
    contextualReadingPause,
    interJobDelay,
    performDecoyAction,
    performDecoyBurst,
} from './browser/humanBehavior';
export { clickCoordinatesHumanLike, clickLocatorHumanLike } from './browser/humanClick';
export type { HumanLocatorClickOptions } from './browser/humanClick';
export { runSelectorCanaryDetailed, runSelectorCanary } from './browser/selectorCanary';
export type { SelectorCanaryStepResult, SelectorCanaryReport } from './browser/selectorCanary';

export { clickWithFallback, waitForSelectorWithFallback, typeWithFallback } from './browser/uiFallback';

export { isLoggedIn, checkLogin, detectChallenge, probeLinkedInStatus } from './browser/auth';
export type { LinkedInProbeResult } from './browser/auth';

export { dismissKnownOverlays, hasBlockingOverlay } from './browser/overlayDismisser';

// ─── Bridge registration ─────────────────────────────────────────────────────
// Collega le funzioni che romperebbero il ciclo humanBehavior ↔ overlayDismisser.
// DEVE stare qui, ed è l'UNICO punto: questo file è il solo entry point del layer browser.
//
// Storia, perché la motivazione non si perda: le registrazioni vivevano in un secondo barrel
// (`src/browser/index.ts`) che era irraggiungibile per costruzione — questo file OSCURA la
// directory omonima nella risoluzione dei moduli, quindi ogni `from '../browser'` prende il file.
// Risultato: non venivano MAI eseguite, `callDismissOverlays` tornava 0 e `callMouseMove` era un
// no-op, cioè click di dismiss senza movimento del mouse. Il barrel è stato poi rimosso del tutto
// (nessun consumatore), così un secondo punto di registrazione non può più nascere per sbaglio.
// Invariante MECCANICA, non affidata a questo commento: `src/tests/browserBridgeRegistration.vitest.ts`
// asserisce che le registrazioni stiano qui, che `src/browser/index.ts` non esista, e che nessun
// modulo di `src/browser/**` importi un barrel `./index`.
import { registerDismissOverlaysFn, registerMouseMoveFn, registerInteractWithFeedFn } from './browser/overlayBridge';
import { dismissKnownOverlays as _dismissKnownOverlays } from './browser/overlayDismisser';
import { humanMouseMoveToCoords as _humanMouseMoveToCoords } from './browser/humanBehavior';
import { interactWithFeed as _interactWithFeed } from './browser/organicContent';
registerDismissOverlaysFn(_dismissKnownOverlays);
registerMouseMoveFn(_humanMouseMoveToCoords);
registerInteractWithFeedFn(_interactWithFeed);
