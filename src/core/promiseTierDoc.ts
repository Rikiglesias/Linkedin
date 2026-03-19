/**
 * A12: Classificazione fire-and-forget promises nel jobRunner.
 *
 * Ogni promise `.catch(() => null)` nel codebase è classificata in 3 tier:
 *
 * ## Tier 1 — MUST (await, errore bloccante)
 * Promise che DEVONO completare con successo. Se falliscono, il flusso è rotto.
 * - `lockNextQueuedJob()` — senza job lockato, il loop non procede
 * - `markJobSucceeded()` — il job resta RUNNING e viene ri-processato
 * - `checkAndIncrementDailyLimit()` — il cap non viene rispettato
 * - `transitionLead()` — lo stato lead è incoerente
 * Tutti i MUST sono già `await` senza catch — se falliscono, l'eccezione sale al caller.
 *
 * ## Tier 2 — SHOULD (await + try/catch + logWarn)
 * Promise che DOVREBBERO completare, ma il fallimento non rompe il flusso.
 * Loggare il fallimento è importante per debug.
 * - `recordSessionPattern()` — se fallisce, il pacing factor non si aggiorna
 * - `persistAccountHealth()` — se fallisce, il report salute è stale
 * - `updateAccountBackpressure()` — se fallisce, il batch size non si adatta
 * - `pushOutboxEvent()` — se fallisce, il cloud sync perde un evento
 * Questi usano `.catch(() => null)` — il fallimento è silenzioso.
 * **Azione**: aggiungere logWarn nel catch per tracciabilità.
 *
 * ## Tier 3 — NICE (fire-and-forget, catch silenzioso OK)
 * Promise dove il fallimento non ha conseguenze operative.
 * - `sendTelegramAlert()` — notifica persa, nessun dato rotto
 * - `setRuntimeFlag(browser_session_started_at)` — timestamp mancante, warmup skip logic degrada gracefully
 * - `page.evaluate(() => window.scrollBy(...))` — scroll mancato, bot prosegue
 * - `ensureVisualCursorOverlay()` — overlay mancante, bot prosegue
 * Questi possono restare `.catch(() => null)` — il catch silenzioso è intenzionale.
 *
 * ## Regola per nuove promises
 * - Se il fallimento rompe il flusso → Tier 1 (MUST await)
 * - Se il fallimento causa dati stale ma il flusso prosegue → Tier 2 (SHOULD logWarn)
 * - Se il fallimento è irrilevante → Tier 3 (NICE catch silenzioso)
 */

// Questo file è documentazione pura — non esporta nulla.
// Serve come riferimento per i reviewer e per future modifiche.
export {};
