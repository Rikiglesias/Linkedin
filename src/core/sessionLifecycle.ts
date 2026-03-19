/**
 * A02: Session Lifecycle — facade per le operazioni di ciclo di vita sessione browser.
 * Re-esporta le funzioni rilevanti da jobRunner e altri moduli per navigabilità.
 *
 * Ciclo di vita sessione:
 * 1. Launch browser (launcher.ts)
 * 2. Check login (auth.ts)
 * 3. Session freshness (sessionCookieMonitor.ts)
 * 4. Cookie anomaly detection (sessionCookieMonitor.ts)
 * 5. LinkedIn probe (probeLinkedInStatus)
 * 6. Session warmup (sessionWarmer.ts)
 * 7. Main job loop (jobRunner.ts)
 * 8. Wind-down (jobRunner.ts)
 * 9. Close browser (launcher.ts)
 * 10. Persist health + backpressure + session pattern
 */

export { launchBrowser, closeBrowser } from '../browser/launcher';
export { checkLogin, isLoggedIn } from '../browser/auth';
export { checkSessionFreshness, detectSessionCookieAnomaly, getBehavioralProfile } from '../browser/sessionCookieMonitor';
export { warmupSession } from './sessionWarmer';
export { probeLinkedInStatus } from '../browser';
export { runQueuedJobs } from './jobRunner';
export { getAccountBackpressureLevel, updateAccountBackpressure } from '../sync/backpressure';
