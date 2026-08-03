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
// DEVE stare qui e non in `browser/index.ts`: questo file OSCURA la directory omonima
// nella risoluzione dei moduli (`from '../browser'` → questo file), quindi il barrel
// `browser/index.ts` non è importato da nessuno e la sua registrazione non è mai stata
// eseguita in esercizio — callDismissOverlays tornava 0 e callMouseMove era un no-op.
// Regressione coperta da test/unit/browserBridgeRegistration.test.ts.
import { registerDismissOverlaysFn, registerMouseMoveFn, registerInteractWithFeedFn } from './browser/overlayBridge';
import { dismissKnownOverlays as _dismissKnownOverlays } from './browser/overlayDismisser';
import { humanMouseMoveToCoords as _humanMouseMoveToCoords } from './browser/humanBehavior';
import { interactWithFeed as _interactWithFeed } from './browser/organicContent';
registerDismissOverlaysFn(_dismissKnownOverlays);
registerMouseMoveFn(_humanMouseMoveToCoords);
registerInteractWithFeedFn(_interactWithFeed);
