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
    humanTap,
    humanSwipe,
    randomMouseMove,
    humanType,
    simulateHumanReading,
    contextualReadingPause,
    interJobDelay,
    performDecoyAction,
    performDecoyBurst,
    runSelectorCanary,
} from './browser/humanBehavior';

export {
    clickWithFallback,
    waitForSelectorWithFallback,
    typeWithFallback,
} from './browser/uiFallback';

export {
    isLoggedIn,
    checkLogin,
    detectChallenge,
} from './browser/auth';
