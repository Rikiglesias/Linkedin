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
    randomMouseMove,
    humanType,
    simulateHumanReading,
    interJobDelay,
    performDecoyAction,
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
