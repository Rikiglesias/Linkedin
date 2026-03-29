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
export { runSelectorCanaryDetailed, runSelectorCanary } from './browser/selectorCanary';
export type { SelectorCanaryStepResult, SelectorCanaryReport } from './browser/selectorCanary';

export { clickWithFallback, waitForSelectorWithFallback, typeWithFallback } from './browser/uiFallback';

export { isLoggedIn, checkLogin, detectChallenge, probeLinkedInStatus } from './browser/auth';
export type { LinkedInProbeResult } from './browser/auth';

export { dismissKnownOverlays, hasBlockingOverlay } from './browser/overlayDismisser';
