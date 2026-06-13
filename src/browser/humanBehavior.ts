/**
 * browser/humanBehavior.ts
 * ─────────────────────────────────────────────────────────────────
 * Simula comportamento umano nel browser: delay log-normale,
 * movimenti mouse con curva Bézier, digitazione con typo,
 * reading scroll, decoy actions, inter-job delay.
 */

import { Page } from 'playwright';
import { config } from '../config';
// joinSelectors rimosso — ora usato solo in selectorCanary.ts
import { getPageDeviceProfile, isMobilePage } from './deviceProfile';
import { calculateContextualDelay } from '../ml/timingModel';
import { shouldAccidentalNav, performAccidentalNavigation } from './missclick';

// ─── Stato Memoria Mouse (estratto in human/mouseState.ts, A13) ───────────────
// initializeMouseState/releaseMouseConfinement re-esportati → API pubblica invariata;
// pageMouseState/getStartingPoint/updateMouseState ora usati nei moduli human/*.
import { initializeMouseState, releaseMouseConfinement } from './human/mouseState';
export { initializeMouseState, releaseMouseConfinement };

// Movimenti mouse (Bézier/Fitts) estratti in human/mouseMovement.ts (A13, TIMING-CORE verbatim).
// randomMouseMove usata internamente (interJobDelay); le 3 funzioni pubbliche re-esportate.
import { humanMouseMove, humanMouseMoveToCoords, randomMouseMove } from './human/mouseMovement';
export { humanMouseMove, humanMouseMoveToCoords, randomMouseMove };

// Simulazione lettura/scroll estratta in human/readingSimulation.ts (A13, timing verbatim).
// simulateTabSwitch usata da interJobDelay, simulateHumanReading dai decoy; tutte re-esportate.
import { simulateTabSwitch, simulateHumanReading, computeProfileDwellTime } from './human/readingSimulation';
export { simulateTabSwitch, simulateHumanReading, computeProfileDwellTime };

// Digitazione umana estratta in human/humanTyping.ts (A13, TIMING-CORE keystroke verbatim).
import { humanType } from './human/humanTyping';
export { humanType };

// Input-block (overlay full-screen che blocca l'utente) estratto in human/inputBlock.ts (A13).
// Funzioni re-esportate (caller invariati); pause/resumeInputBlockForMove usate da humanMouseMove.
import {
    ensureInputBlock,
    pauseInputBlockForMove,
    resumeInputBlockForMove,
    pauseInputBlock,
    resumeInputBlock,
    blockUserInput,
} from './human/inputBlock';
export { ensureInputBlock, pauseInputBlockForMove, resumeInputBlockForMove, pauseInputBlock, resumeInputBlock, blockUserInput };

// Overlay cursore visuale estratto in human/cursorOverlay.ts (A13). Funzioni pubbliche re-esportate
// → i caller non cambiano import.
import {
    ensureVisualCursorOverlay,
    enableVisualCursorOverlay,
    removeAllOverlays,
    pulseVisualCursorOverlay,
} from './human/cursorOverlay';
export { ensureVisualCursorOverlay, enableVisualCursorOverlay, removeAllOverlays, pulseVisualCursorOverlay };

// Gesture touch/tap estratte in human/touchGestures.ts (A13). humanSwipe usata internamente
// (humanMouseMove/randomMouseMove/simulateHumanReading/computeProfileDwellTime); entrambe re-esportate.
import { humanTap, humanSwipe } from './human/touchGestures';
export { humanTap, humanSwipe };

// Primitive timing PURE estratte in human/humanDelay.ts (A13, TIMING-CORE verbatim). humanDelay usata
// internamente (awaitManualLogin/humanType/simulateHumanReading/decoy*); tutte e tre re-esportate.
import { humanDelay, ensureViewportDwell, contextualReadingPause } from './human/humanDelay';
export { humanDelay, ensureViewportDwell, contextualReadingPause };

// Azioni diversive (decoy) estratte in human/decoyActions.ts (A13, behavioral-pattern verbatim).
// performDecoyAction usata internamente da interJobDelay; entrambe re-esportate.
import { performDecoyBurst, performDecoyAction } from './human/decoyActions';
export { performDecoyBurst, performDecoyAction };

/**
 * Attende che l'utente completi il login manualmente nel browser.
 * Funzione condivisa — usata da syncSearchWorkflow, salesNavigatorSync, e come modello
 * per waitForManualLogin in bulkSaveOrchestrator (che ha logica aggiuntiva con setInputBlockSuspended).
 *
 * 1. Rimuove TUTTI gli overlay (cursore, input block, toast) → l'utente ha pieno controllo
 * 2. Polling ogni 4-6s con isLoggedIn()
 * 3. Timeout configurabile (default 3 minuti)
 * 4. Ritorna true se login completato, false se timeout
 */
export async function awaitManualLogin(
    page: Page,
    context: string,
    options?: { timeoutMs?: number },
): Promise<boolean> {
    const maxWaitMs = options?.timeoutMs ?? 3 * 60 * 1000;
    const startTime = Date.now();

    await removeAllOverlays(page);
    releaseMouseConfinement();

    console.warn(`[${context}] Sessione non autenticata — in attesa del login manuale nel browser...`);
    console.warn(`[${context}] URL: ${page.url()}`);
    console.warn(`[${context}] Hai ${Math.round(maxWaitMs / 60_000)} minuti per completare il login.`);

    while (Date.now() - startTime < maxWaitMs) {
        await page.waitForTimeout(4000 + Math.floor(Math.random() * 2000));
        try {
            if (page.isClosed()) return false;
            const { isLoggedIn: checkIsLoggedIn } = await import('./auth');
            if (await checkIsLoggedIn(page)) {
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                console.log(`[${context}] Login completato dopo ${elapsed}s.`);
                await humanDelay(page, 1500, 2500);
                return true;
            }
        } catch {
            // isLoggedIn può fallire durante navigazione — riprova
        }
        const remaining = Math.round((maxWaitMs - (Date.now() - startTime)) / 1000);
        if (remaining > 0) {
            console.log(`[${context}] Ancora in attesa del login... (${remaining}s rimanenti)`);
        }
    }

    console.error(`[${context}] Timeout: login manuale non completato entro ${Math.round(maxWaitMs / 60_000)} minuti.`);
    return false;
}

// ─── Input Blocking Overlay (ID in human/overlayIds.ts, A13) ──────────────────

// getStartingPoint/updateMouseState estratti in human/mouseState.ts (A13), importati sopra.

// ─── Utility Generali (importate da ../utils/random) ─────────────────────────

/**
 * Pausa randomizzata tra un job e il successivo per evitare il pattern burst.
 * Range: 30–90s base + picco casuale (pausa caffè) con 8% di probabilità.
 * Se il throttleSignal indica rallentamento LinkedIn, moltiplica il delay:
 *   shouldSlow → ×1.5, shouldPause → pausa coffee break forzata 3-5 min.
 */
export async function interJobDelay(
    page: Page,
    throttleSignal?: { shouldSlow: boolean; shouldPause: boolean },
    pacingFactor?: number,
): Promise<void> {
    const minDelay = Math.max(1, config.interJobMinDelaySec) * 1000;
    const maxDelay = Math.max(config.interJobMinDelaySec, config.interJobMaxDelaySec) * 1000;

    let totalDelay = calculateContextualDelay({
        actionType: 'interJob',
        baseMin: minDelay,
        baseMax: maxDelay,
        profileMultiplier: getPageDeviceProfile(page).profileMultiplier,
    });

    // Pacing factor da sessionMemory: dopo challenge recenti il bot rallenta,
    // dopo giorni tranquilli può essere leggermente più veloce.
    // pacingFactor < 1.0 → delay più lungo (inverso: divido per il factor)
    // pacingFactor > 1.0 → delay leggermente più corto
    if (pacingFactor !== undefined && pacingFactor > 0 && pacingFactor !== 1.0) {
        totalDelay = Math.round(totalDelay / pacingFactor);
    }

    // Feedback loop reattivo: LinkedIn rallenta → il bot rallenta automaticamente
    if (throttleSignal?.shouldPause) {
        // Pausa coffee break forzata 3-5 min (LinkedIn è in stato critico)
        totalDelay = (180 + Math.floor(Math.random() * 120)) * 1000;
    } else if (throttleSignal?.shouldSlow) {
        // Moltiplica delay ×1.5 (LinkedIn sta rallentando)
        totalDelay = Math.round(totalDelay * 1.5);
    }

    if (Math.random() < (isMobilePage(page) ? 0.2 : 0.35)) {
        await randomMouseMove(page);
    }

    // AD-04: 40% di chance di "cambiare tab" per distrarsi durante job delay lunghi.
    const willSwitchTab = Math.random() < 0.4;

    const split = Math.floor(totalDelay * (0.4 + Math.random() * 0.2));
    await page.waitForTimeout(Math.max(0, split));

    if (willSwitchTab) {
        await simulateTabSwitch(page, totalDelay * 0.3); // Away per il 30% del delay totale
    }

    if (shouldAccidentalNav('feed')) {
        await performAccidentalNavigation(page);
    }

    // GAP #2: Micro-azione organica interleavata — 20% di probabilità.
    // LinkedIn analizza la diversità di azioni nella sessione.
    // Solo inviti consecutivi = segnale bot. Azioni organiche in mezzo = umano.
    if (Math.random() < 0.2) {
        await performDecoyAction(page);
    }

    if (Math.random() < (isMobilePage(page) ? 0.15 : 0.25)) {
        await randomMouseMove(page);
    }

    await page.waitForTimeout(Math.max(0, totalDelay - split));
}

// Selector canary (buildSelectorCanaryPlan, evaluateCanaryStep, runSelectorCanaryDetailed, runSelectorCanary)
// estratto in browser/selectorCanary.ts (A17: split file >1000 righe)
