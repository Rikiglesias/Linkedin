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
import { computeSessionTypoRate, determineNextKeystroke, getWordFlowMultiplier } from '../ai/typoGenerator';
import { shouldAccidentalNav, performAccidentalNavigation } from './missclick';
import { randomElement, randomInt, logNormalDelayMs } from '../utils/random';

// ─── Stato Memoria Mouse (estratto in human/mouseState.ts, A13) ───────────────
// initializeMouseState/releaseMouseConfinement re-esportati → API pubblica invariata;
// pageMouseState/getStartingPoint/updateMouseState ora usati nei moduli human/*.
import { initializeMouseState, releaseMouseConfinement } from './human/mouseState';
export { initializeMouseState, releaseMouseConfinement };

// Movimenti mouse (Bézier/Fitts) estratti in human/mouseMovement.ts (A13, TIMING-CORE verbatim).
// randomMouseMove usata internamente (interJobDelay); le 3 funzioni pubbliche re-esportate.
import { humanMouseMove, humanMouseMoveToCoords, randomMouseMove } from './human/mouseMovement';
export { humanMouseMove, humanMouseMoveToCoords, randomMouseMove };

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
 * AD-04: Simulazione sfocamento tab (cambio scheda utente).
 * Mockerà attivamente la *Page Visibility API* per dimostrare ai tracker
 * che siamo veri umani che hanno cambiato tab.
 */
export async function simulateTabSwitch(page: Page, maxAwayTimeMs: number): Promise<void> {
    if (isMobilePage(page)) {
        // Su mobile il comportamento multi-tab è meno lineare da tracciare, saltiamo.
        return;
    }

    try {
        const jitter = () => Math.round((Math.random() - 0.5) * 20);

        // H18: Usare solo eventi DOM (blur/focus/visibilitychange) SENZA override
        // di document.visibilityState. Il mock via Object.defineProperty è rilevabile
        // perché: 1) lascia tracce su window (__origVisDesc), 2) configurable:true
        // non è il default del browser, 3) CDP può verificare lo stato reale del tab.
        // I listener JavaScript di LinkedIn reagiscono agli EVENTI, non allo stato —
        // quindi dispatching blur/focus/visibilitychange è sufficiente e non rilevabile.
        await page.evaluate((ts) => {
            window.dispatchEvent(new Event('blur', { timeStamp: ts } as EventInit));
        }, Date.now() + jitter());
        await page.waitForTimeout(5 + Math.random() * 25);
        await page.evaluate((ts) => {
            document.dispatchEvent(new Event('visibilitychange', { timeStamp: ts } as EventInit));
        }, Date.now() + jitter());

        const awayTime = Math.max(3000, Math.min(maxAwayTimeMs, 3000 + Math.random() * maxAwayTimeMs));
        await page.waitForTimeout(awayTime);

        await page.evaluate((ts) => {
            document.dispatchEvent(new Event('visibilitychange', { timeStamp: ts } as EventInit));
            window.dispatchEvent(new Event('focus', { timeStamp: ts } as EventInit));
        }, Date.now() + jitter());
        await page.waitForTimeout(5 + Math.random() * 25);
        await page.evaluate((ts) => {
            document.dispatchEvent(new Event('visibilitychange', { timeStamp: ts } as EventInit));
        }, Date.now() + jitter());

        await page.waitForTimeout(500 + Math.random() * 800);
    } catch {
        // Best effort
    }
}

/**
 * Digita il testo carattere per carattere con delay variabile.
 * Include il 3% di probabilità di errore di battitura + correzione (Backspace).
 */
export async function humanType(page: Page, selector: string, text: string): Promise<void> {
    const element = page.locator(selector).first();
    await element.click();
    await humanDelay(page, 200, 500);

    // Context-aware WPM: testi lunghi → ritmo più lento (affaticamento naturale).
    // Testi brevi (< 30 char): veloce. Medi (30-150): normale. Lunghi (> 150): lento.
    const lengthSlowFactor = text.length <= 30 ? 0.85 : text.length <= 150 ? 1.0 : text.length <= 400 ? 1.15 : 1.3;

    // Typing Flow State (6.3): pre-calcola le parole e i loro flow multiplier.
    // Parole comuni → 0.7x delay (flow state), parole rare → 1.4x delay (pensiero).
    const words = text.split(/(?<=\s)|(?=\s)/);
    let charIndex = 0;
    let currentWordIdx = 0;
    let currentWordMultiplier = words.length > 0 ? getWordFlowMultiplier(words[0]) : 1.0;

    for (let i = 0; i < text.length; i++) {
        const originalChar = text[i] ?? '';
        const { char: typedChar, isTypo } = determineNextKeystroke(originalChar, computeSessionTypoRate());

        // Aggiorna il word flow multiplier quando passiamo a una nuova parola
        charIndex++;
        if (currentWordIdx < words.length) {
            const currentWordLen = words[currentWordIdx].length;
            if (charIndex > currentWordLen && currentWordIdx < words.length - 1) {
                charIndex = 1;
                currentWordIdx++;
                currentWordMultiplier = getWordFlowMultiplier(words[currentWordIdx]);
            }
        }

        // AD-11: Implementazione Delay Bimodale + context-aware per lunghezza testo
        // + Typing Flow State (6.3): parole comuni più veloci, parole rare più lente
        const isSpaceOrPunctuation = /[\s.,!?-]/.test(typedChar);
        // B2 (2026-06-07): delay inter-keystroke LOG-NORMALE (right-skew = biometric umano reale)
        // invece di uniforme (Math.random()*range = istogramma piatto rilevabile dall'ML di LinkedIn).
        // Mediana ≈ media vecchia → throughput preservato; coda destra naturale. Fonti: keystroke
        // dynamics (flight time log-normale/ex-gaussian).
        const rawDelay = isSpaceOrPunctuation
            ? logNormalDelayMs(200, 0.42, 90, 650)
            : logNormalDelayMs(95, 0.42, 45, 320);
        // Floor ASSOLUTO post-moltiplicatore: lengthSlowFactor*currentWordMultiplier può scendere
        // a 0.595x e, applicato DOPO il clamp di logNormalDelayMs, bypassava il floor → keystroke
        // <28ms = oltre il record mondiale (firma key-injection). Il floor fisico umano va imposto
        // QUI, sull'effettivo.
        // W3/SOTA-2026 (keystroke dynamics): i keystroke <50ms (0.05s) sono la "zona bot" — la ricerca
        // mostra ~21% dei keystroke bot sotto 0.05s contro solo ~5.8% umani. Il floor char a 40ms
        // cadeva ancora in quella zona → alzato a 55ms (sopra 0.05s con margine). Spazio/punteggiatura
        // ≥80ms (flight time naturalmente più lungo, già ben sopra la soglia).
        const keystrokeFloorMs = isSpaceOrPunctuation ? 80 : 55;
        const delayBase = Math.max(keystrokeFloorMs, Math.round(rawDelay * lengthSlowFactor * currentWordMultiplier));

        await element.pressSequentially(typedChar, { delay: delayBase });

        if (isTypo) {
            // H17: Variare il pattern di correzione typo — un umano non corregge
            // sempre allo stesso modo. Pattern fisso = fingerprint rilevabile.
            const correctionStyle = Math.random();
            if (correctionStyle < 0.55) {
                // Stile 1 (55%): Backspace singolo + retype (classico)
                await page.waitForTimeout(280 + Math.random() * 420);
                await element.press('Backspace');
                await page.waitForTimeout(180 + Math.random() * 250);
                await element.pressSequentially(originalChar, { delay: Math.floor(Math.random() * 80) + 60 });
            } else if (correctionStyle < 0.75) {
                // Stile 2 (20%): Cancella 2-3 char + riscrive (ha visto l'errore tardi)
                const charsBack = Math.min(i, 1 + Math.floor(Math.random() * 2));
                await page.waitForTimeout(350 + Math.random() * 500);
                for (let b = 0; b <= charsBack; b++) {
                    await element.press('Backspace');
                    await page.waitForTimeout(60 + Math.random() * 80);
                }
                await page.waitForTimeout(200 + Math.random() * 300);
                const retypeFrom = Math.max(0, i - charsBack);
                for (let r = retypeFrom; r <= i; r++) {
                    await element.pressSequentially(text[r] ?? '', { delay: Math.floor(Math.random() * 70) + 50 });
                }
            } else if (correctionStyle < 0.9) {
                // Stile 3 (15%): Ignora l'errore — un umano a volte non se ne accorge
                // (il typo resta nel testo, verrà comunque capito)
            } else {
                // Stile 4 (10%): Seleziona char sbagliato + sovrascrive (Shift+Left → type)
                await page.waitForTimeout(300 + Math.random() * 400);
                await page.keyboard.down('Shift');
                await element.press('ArrowLeft');
                await page.keyboard.up('Shift');
                await page.waitForTimeout(100 + Math.random() * 150);
                await element.pressSequentially(originalChar, { delay: Math.floor(Math.random() * 80) + 60 });
            }
        }

        if (Math.random() < 0.04) {
            await humanDelay(page, 400, 1100);
        }

        // AB-4: Micro-pause "distrazione" — un umano si distrae durante la digitazione.
        // Ogni ~30 caratteri, 6% di probabilità di una micro-pausa riflessiva.
        if (i > 0 && i % 30 === 0 && Math.random() < 0.06) {
            const distractionType = Math.random();
            if (distractionType < 0.5) {
                // Tipo 1: Pausa lunga "rileggere il testo" (2-5s)
                await page.waitForTimeout(2000 + Math.random() * 3000);
            } else if (distractionType < 0.8) {
                // Tipo 2: Correzione riflessiva — cancella e riscrive ultimi 2-3 char
                const charsToRetype = Math.min(i, 2 + Math.floor(Math.random() * 2));
                for (let b = 0; b < charsToRetype; b++) {
                    await element.press('Backspace');
                    await page.waitForTimeout(80 + Math.random() * 120);
                }
                await page.waitForTimeout(400 + Math.random() * 600);
                const retypeStart = Math.max(0, i - charsToRetype + 1);
                for (let r = retypeStart; r <= i; r++) {
                    const ch = text[r] ?? '';
                    await element.pressSequentially(ch, { delay: Math.floor(Math.random() * 60) + 50 });
                }
            } else {
                // Tipo 3: Micro-pausa "controllo telefono" (1-3s, nessuna azione)
                await page.waitForTimeout(1000 + Math.random() * 2000);
            }
        }
    }
}

/**
 * Scroll con MOMENTUM: decompone un delta totale in una raffica di tick wheel
 * decrescenti (ease-out), come una rotellina/trackpad reale. Un singolo
 * page.mouse.wheel(0, big) sposta la scrollbar in un frame = firma robotica (teletrasporto),
 * il pattern #1 che la behavioral-biometrics cerca sullo scroll.
 */
async function wheelWithMomentum(page: Page, totalDeltaY: number): Promise<void> {
    const ticks = 4 + Math.floor(Math.random() * 5); // 4-8 tick
    let remaining = totalDeltaY;
    for (let i = 0; i < ticks; i++) {
        const isLast = i === ticks - 1;
        // ease-out: i primi tick spostano di più, gli ultimi rallentano (decelerazione naturale)
        const step = isLast ? remaining : Math.round(remaining * (0.35 + Math.random() * 0.25));
        remaining -= step;
        await page.mouse.wheel(0, step);
        if (!isLast) {
            await page.waitForTimeout(12 + Math.floor(Math.random() * 28)); // 12-40ms tra tick
        }
    }
}

/**
 * Scrolling variabile con 3-7 movimenti, velocità diversa e 30% di probabilità
 * di tornare in cima (comportamento dei lettori reali).
 */
export async function simulateHumanReading(page: Page): Promise<void> {
    const mobile = isMobilePage(page);
    const isScrollable = await page.evaluate(() => document.body.scrollHeight > window.innerHeight).catch(() => false);
    if (!isScrollable) return;
    const scrollCount = mobile ? 2 + Math.floor(Math.random() * 4) : 3 + Math.floor(Math.random() * 5);

    // Scroll a 3 fasi (3.2): simula pattern reale di lettura pagina.
    // Fase 1 "orientation": scroll veloce per orientarsi nella pagina
    // Fase 2 "reading": scroll lento per leggere contenuto interessante
    // Fase 3 "skip": scroll veloce per saltare contenuto non rilevante
    // Transizioni probabilistiche: orientation→reading (60%), reading→skip (40%), skip→reading (30%)
    type ScrollPhase = 'orientation' | 'reading' | 'skip';
    let phase: ScrollPhase = 'orientation';

    for (let i = 0; i < scrollCount; i++) {
        let deltaY: number;
        let delayMin: number;
        let delayMax: number;

        if (mobile) {
            deltaY = 220 + Math.random() * 420;
            delayMin = 700;
            delayMax = 2200;
        } else {
            switch (phase) {
                case 'orientation':
                    deltaY = 400 + Math.random() * 200; // 400-600px
                    delayMin = 300;
                    delayMax = 800;
                    break;
                case 'reading':
                    deltaY = 100 + Math.random() * 150; // 100-250px
                    delayMin = 500;
                    delayMax = 2000;
                    break;
                case 'skip':
                    deltaY = 500 + Math.random() * 300; // 500-800px
                    delayMin = 200;
                    delayMax = 500;
                    break;
            }
        }

        await wheelWithMomentum(page, deltaY);
        if (mobile && Math.random() < 0.4) {
            await humanSwipe(page, 'up');
        }
        await humanDelay(page, delayMin, delayMax);

        // Transizione fase (solo desktop — mobile usa pattern uniforme)
        if (!mobile) {
            const roll = Math.random();
            switch (phase) {
                case 'orientation':
                    phase = roll < 0.6 ? 'reading' : 'orientation';
                    break;
                case 'reading':
                    phase = roll < 0.4 ? 'skip' : 'reading';
                    break;
                case 'skip':
                    phase = roll < 0.3 ? 'reading' : 'skip';
                    break;
            }
        }

        // AD-04: 15% di probabilità di cambiare tab temporaneamente mentre legge
        if (Math.random() < 0.15) {
            await simulateTabSwitch(page, 5000 + Math.random() * 15000);
        }
    }
    if (Math.random() < 0.3) {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await humanDelay(page, 500, 1400);
    }
}

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

/**
 * Content-Aware Profile Reading (3.4 fix): funzione UNIFICATA che fa
 * scroll + dwell in un budget di tempo TOTALE proporzionale alla ricchezza
 * del profilo. SOSTITUISCE simulateHumanReading + contextualReadingPause
 * quando siamo su un profilo LinkedIn.
 *
 * Budget totale:
 *   Profilo sparse (solo nome e titolo): 4-8s totali
 *   Profilo medio: 7-14s totali
 *   Profilo ricco (about lungo, molte esperienze): 12-20s totali
 *
 * Include: scroll a fasi, pause di lettura, tab switch occasionale.
 * MAI > 20s per singolo profilo — un umano decide velocemente se connettersi.
 */
export async function computeProfileDwellTime(page: Page): Promise<void> {
    const mobile = isMobilePage(page);
    try {
        const profileRichness = await page.evaluate(() => {
            const aboutText = document.querySelector('[id*="about"]')?.textContent?.trim().length ?? 0;
            const experienceItems = document.querySelectorAll('li.artdeco-list__item, [id*="experience"] li').length;
            const totalText = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().length;
            return { aboutText, experienceItems, totalText };
        });

        const aboutScore = Math.min(1, profileRichness.aboutText / 500);
        const expScore = Math.min(1, profileRichness.experienceItems / 5);
        const textScore = Math.min(1, profileRichness.totalText / 3000);
        const richness = aboutScore * 0.35 + expScore * 0.35 + textScore * 0.3;

        // Budget totale: sparse 4-8s, medio 7-14s, ricco 12-20s
        const budgetMs = 4000 + Math.floor(richness * 12_000) + Math.floor(Math.random() * 4000);
        const startMs = Date.now();

        // Fase 1: scroll veloce (orientation) — 30-40% del budget
        const isScrollable = await page
            .evaluate(() => document.body.scrollHeight > window.innerHeight)
            .catch(() => false);
        if (isScrollable) {
            const scrollSteps = mobile ? randomInt(1, 3) : randomInt(2, 4);
            for (let i = 0; i < scrollSteps; i++) {
                if (Date.now() - startMs > budgetMs * 0.7) break; // Non sforare il budget
                const deltaY =
                    richness > 0.5
                        ? 100 + Math.random() * 200 // Profilo ricco: scroll lento per leggere
                        : 300 + Math.random() * 300; // Profilo sparse: scroll veloce
                await wheelWithMomentum(page, deltaY);
                if (mobile && Math.random() < 0.3) await humanSwipe(page, 'up');
                // Pausa tra scroll proporzionale a richness
                const pauseMs = 400 + Math.floor(richness * 1200) + Math.floor(Math.random() * 600);
                await page.waitForTimeout(pauseMs);
            }
        }

        // Fase 2: dwell residuo (lettura + decisione) — tempo restante nel budget
        const elapsed = Date.now() - startMs;
        const remainingMs = Math.max(500, budgetMs - elapsed);
        await page.waitForTimeout(remainingMs);

        // 10% tab switch durante lettura profilo
        if (Math.random() < 0.1) {
            await simulateTabSwitch(page, 2000 + Math.random() * 5000);
        }
    } catch {
        // Fallback: dwell time breve se DOM extraction fallisce
        await page.waitForTimeout(3000 + Math.floor(Math.random() * 5000));
    }
}

type DecoyStep = 'feed' | 'network' | 'notifications' | 'search' | 'back';

function shuffle<T>(items: T[]): T[] {
    const clone = items.slice();
    for (let i = clone.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = clone[i];
        clone[i] = clone[j] as T;
        clone[j] = tmp as T;
    }
    return clone;
}

async function runDecoyStep(page: Page, step: DecoyStep, contextTerms?: readonly string[]): Promise<void> {
    if (step === 'feed') {
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
        await ensureVisualCursorOverlay(page);
        await ensureInputBlock(page);
        await humanDelay(page, 1200, 2600);
        await simulateHumanReading(page);
        return;
    }
    if (step === 'network') {
        await page.goto('https://www.linkedin.com/mynetwork/', { waitUntil: 'domcontentloaded' });
        await ensureVisualCursorOverlay(page);
        await ensureInputBlock(page);
        await humanDelay(page, 1200, 2400);
        await simulateHumanReading(page);
        return;
    }
    if (step === 'notifications') {
        await page.goto('https://www.linkedin.com/notifications/', { waitUntil: 'domcontentloaded' });
        await ensureVisualCursorOverlay(page);
        await ensureInputBlock(page);
        await humanDelay(page, 1200, 2400);
        return;
    }
    if (step === 'search') {
        // M15/M16: Se termini context-aware disponibili, usali (70%); altrimenti generici.
        const useContext = contextTerms && contextTerms.length > 0 && Math.random() < 0.7;
        const term = randomElement(useContext ? contextTerms : DECOY_SEARCH_TERMS);
        await page.goto(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(term)}`, {
            waitUntil: 'domcontentloaded',
        });
        await ensureVisualCursorOverlay(page);
        await ensureInputBlock(page);
        await humanDelay(page, 1200, 2600);
        await simulateHumanReading(page);
        return;
    }
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
    await ensureVisualCursorOverlay(page);
    await ensureInputBlock(page);
    await humanDelay(page, 800, 1600);
}

export async function performDecoyBurst(page: Page, contextTerms?: readonly string[]): Promise<void> {
    const baseSteps: DecoyStep[] = ['feed', 'notifications', 'network', 'search', 'back'];
    const steps = shuffle(baseSteps).slice(0, randomInt(2, 4));
    for (const step of steps) {
        await runDecoyStep(page, step, contextTerms).catch(() => null);
    }
}

/**
 * Azioni Diversive Mute (Decoy):
 * naviga in sezioni casuali di LinkedIn prima dei veri task
 * per mascherare pattern lineari da bot.
 */
const DECOY_SEARCH_TERMS: readonly string[] = [
    // Business roles
    'ceo',
    'cto',
    'cfo',
    'coo',
    'cmo',
    'vp sales',
    'vp engineering',
    'head of marketing',
    'head of product',
    'head of operations',
    'director of sales',
    'director of engineering',
    'director of hr',
    'product manager',
    'program manager',
    'account executive',
    'business development',
    'chief of staff',
    'general manager',
    // Industries
    'fintech',
    'saas',
    'edtech',
    'healthtech',
    'biotech',
    'cleantech',
    'proptech',
    'insurtech',
    'agritech',
    'legaltech',
    'martech',
    'e-commerce',
    'cybersecurity',
    'artificial intelligence',
    'blockchain',
    'renewable energy',
    'logistics',
    'telecommunications',
    'media',
    // Skills
    'project management',
    'data analysis',
    'cloud computing',
    'machine learning',
    'digital marketing',
    'ux design',
    'ui design',
    'full stack developer',
    'devops engineer',
    'data scientist',
    'product design',
    'agile methodology',
    'business intelligence',
    'supply chain management',
    'financial analysis',
    'content strategy',
    'software architecture',
    'sales operations',
    'customer success',
    // General professional terms
    'marketing',
    'developer',
    'sales',
    'hr',
    'tech',
    'design',
    'consultant',
    'entrepreneur',
    'startup',
    'venture capital',
    'growth hacking',
    'talent acquisition',
    'brand strategy',
    'operations manager',
    'frontend developer',
    'backend engineer',
    'cloud architect',
    'scrum master',
    'ux researcher',
] as const;

export async function performDecoyAction(page: Page, contextTerms?: readonly string[]): Promise<void> {
    // M15/M16: Se termini context-aware forniti, mescola con generici (coerenza settore)
    const terms =
        contextTerms && contextTerms.length > 0
            ? [...contextTerms, ...Array.from(DECOY_SEARCH_TERMS).slice(0, 15)]
            : DECOY_SEARCH_TERMS;
    const reInjectOverlay = async () => {
        await ensureVisualCursorOverlay(page);
        await ensureInputBlock(page);
    };
    const actions = [
        async () => {
            await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
            await reInjectOverlay();
            await simulateHumanReading(page);
            // AD-02: Interviene sul Feed con una probabilità del 20%
            try {
                const { callInteractWithFeed } = await import('./overlayBridge');
                await callInteractWithFeed(page, 0.2);
            } catch {
                // organicContent import/exec fallito — skip decoy interaction
            }
        },
        async () => {
            await page.goto('https://www.linkedin.com/mynetwork/', { waitUntil: 'domcontentloaded' });
            await reInjectOverlay();
            await humanDelay(page, 2000, 5000);
            await simulateHumanReading(page);
        },
        async () => {
            const search = randomElement(terms);
            await page.goto(`https://www.linkedin.com/search/results/people/?keywords=${search}`, {
                waitUntil: 'domcontentloaded',
            });
            await reInjectOverlay();
            await humanDelay(page, 1500, 4000);
            await simulateHumanReading(page);
        },
        async () => {
            // AD-10: Ondivagous navigation (history.back)
            const historyState = await page.evaluate(() => window.history.length).catch(() => 0);
            if (historyState > 2) {
                await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
                await reInjectOverlay();
                await humanDelay(page, 1000, 3000);
                await simulateHumanReading(page);
            } else {
                // Fallback action
                await page.goto('https://www.linkedin.com/notifications/', { waitUntil: 'domcontentloaded' });
                await reInjectOverlay();
                await humanDelay(page, 1200, 2400);
            }
        },
    ];

    try {
        const decoy = randomElement(actions);
        await Promise.race([
            decoy(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Decoy timeout 15s')), 15_000)),
        ]);
    } catch {
        // Ignora silenziosamente — è solo noise decoy
    }
}

// Selector canary (buildSelectorCanaryPlan, evaluateCanaryStep, runSelectorCanaryDetailed, runSelectorCanary)
// estratto in browser/selectorCanary.ts (A17: split file >1000 righe)
